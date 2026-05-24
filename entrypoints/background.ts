/**
 * Background Service Worker —— 消息总线 + 调度器（PRD §3.1）。
 *
 * 本期承担三件事：
 *   1. 让点扩展图标直接打开 sidepanel（不走 popup —— PRD 把 popup 列在"不在范围"）
 *   2. 接 content script 的 `ASK_WITH_SELECTION`，
 *      把 SelectionContext 缓存到 session storage（SW 复活兜底，PRD §10），
 *      调 chrome.sidePanel.open() 打开当前 tab 的侧栏，
 *      再以 `SELECTION_READY` 转发给 sidepanel
 *   3. 提供 background 唯一身份能调到的 chrome.sidePanel API；
 *      所有跨 context 通信都从这里过（PRD §3.1 隔离原则）
 *
 * MV3 service worker 是无状态、随时可被回收的。所以：
 *   - 不要在 SW 全局变量里存任何"用户状态"
 *   - 一切需要持久的瞬时状态写入 chrome.storage.session（key 即可寻址）
 */
import type { BackgroundMessage, SelectionContext } from '@/lib/messaging';

const STORAGE_KEY_LATEST = 'english-agent:latest-selection-id';
const STORAGE_KEY_PREFIX = 'english-agent:selection:';

export default defineBackground(() => {
  // 把"点扩展图标"绑成"打开 sidepanel"。Chrome MV3 默认是触发 default_popup，
  // 我们没有 popup，所以打开 side panel 是更对的语义。
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((err: unknown) => console.error('[english-agent] setPanelBehavior failed', err));

  chrome.runtime.onMessage.addListener((message: BackgroundMessage, sender, sendResponse) => {
    if (message.type === 'ASK_WITH_SELECTION') {
      // 用 .then().catch() 而不是直接 await —— chrome.runtime.onMessage 监听器只
      // 在返回 `true` 时才会等异步 sendResponse。
      handleAskWithSelection(message.payload, sender)
        .then(() => sendResponse({ ok: true }))
        .catch((err) => {
          console.error('[english-agent] handleAskWithSelection failed', err);
          sendResponse({ ok: false, error: String(err) });
        });
      return true; // 标记"我会异步 sendResponse"
    }
    return false;
  });
});

async function handleAskWithSelection(
  ctx: SelectionContext,
  sender: chrome.runtime.MessageSender,
) {
  // 双键：用 id 索引完整 SelectionContext + 一个 "latest" 指针。
  // 后者让 sidepanel 启动时一行 get 就能拿到"最近一次选区"做兜底恢复。
  await chrome.storage.session.set({
    [STORAGE_KEY_PREFIX + ctx.id]: ctx,
    [STORAGE_KEY_LATEST]: ctx.id,
  });

  // 必须在原始 user gesture 链路里调用 sidePanel.open()。
  // content script 的 pill onClick → runtime.sendMessage → 这里 —— Chrome 会把
  // 这条链路视为 user gesture 延续（至少 5s 窗口内）。
  if (sender.tab?.id != null) {
    try {
      await chrome.sidePanel.open({ tabId: sender.tab.id });
    } catch (err) {
      console.warn('[english-agent] sidePanel.open failed', err);
    }
  }

  // 推给 sidepanel。如果 sidepanel 刚被 open 还没挂载完，listener 还没注册，
  // sendMessage 会抛 "Could not establish connection" —— 没关系，sidepanel
  // 启动时也会主动读 session storage 兜底（lib/messaging 那条恢复路径）。
  const msg: BackgroundMessage = { type: 'SELECTION_READY', payload: ctx };
  try {
    await chrome.runtime.sendMessage(msg);
  } catch {
    // 故意吞 —— sidepanel 未挂载是正常情况。
  }
}
