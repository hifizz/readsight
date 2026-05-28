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
import type {
  AskWithSelectionPayload,
  BackgroundMessage,
  SelectionContext,
} from '@/lib/messaging';

const BACKEND = import.meta.env.WXT_BACKEND_URL ?? 'http://localhost:4010';
const STORAGE_KEY_LATEST = 'readsight:latest-selection-id';
const STORAGE_KEY_PREFIX = 'readsight:selection:';

/** 右键菜单 id —— 三项：选区翻译 / 整页翻译 / 重置本站规则（通用恢复入口） */
const MENU_ID_TRANSLATE_SELECTION = 'readsight-translate-selection';
const MENU_ID_TRANSLATE_PAGE = 'readsight-translate-page';
const MENU_ID_RESET_RULE = 'readsight-reset-rule';

/** 给 active tab 发消息的通用工具 —— 拿不到 tabId 时自动查 active tab */
function sendToActiveTab(message: BackgroundMessage, tabId?: number): void {
  if (tabId != null) {
    chrome.tabs.sendMessage(tabId, message).catch(() => {
      // content script 未注入（chrome:// 等内部页）—— 静默
    });
    return;
  }
  chrome.tabs
    .query({ active: true, currentWindow: true })
    .then((tabs) => {
      const id = tabs[0]?.id;
      if (id != null) {
        chrome.tabs.sendMessage(id, message).catch(() => {});
      }
    })
    .catch((err) => console.warn('[readsight] tabs.query failed', err));
}

/** 触发当前 tab 的 content script 切换全文翻译（右键 / 快捷键共用） */
function toggleTranslateInActiveTab(tabId?: number): void {
  sendToActiveTab({ type: 'TOGGLE_TRANSLATE' }, tabId);
}

/** 触发当前 tab 的 content script 打开划词 Dialog */
function translateSelectionInActiveTab(tabId?: number): void {
  sendToActiveTab({ type: 'TRANSLATE_SELECTION' }, tabId);
}

/** 触发当前 tab 的 content script 清除本域名规则（恢复 FAB 可见 / 取消 always） */
function resetDomainRuleInActiveTab(tabId?: number): void {
  sendToActiveTab({ type: 'RESET_DOMAIN_RULE' }, tabId);
}

export default defineBackground(() => {
  // 把"点扩展图标"绑成"打开 sidepanel"。Chrome MV3 默认是触发 default_popup，
  // 我们没有 popup，所以打开 side panel 是更对的语义。
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((err: unknown) => console.error('[readsight] setPanelBehavior failed', err));

  // 右键菜单：两项独立
  //   1. "翻译选中内容"：只在 selection 上下文显示，点 → 打开划词 Dialog
  //   2. "翻译整页 / 撤销整页翻译"：page+selection 都显示，标题随翻译状态切换
  // 在 onInstalled 里 create，避免 SW 重启 / 扩展更新时重复 create 抛"duplicate id"
  chrome.runtime.onInstalled.addListener(() => {
    try {
      chrome.contextMenus.create({
        id: MENU_ID_TRANSLATE_SELECTION,
        title: '翻译选中内容 (见微)',
        contexts: ['selection'],
      });
      chrome.contextMenus.create({
        id: MENU_ID_TRANSLATE_PAGE,
        title: '翻译整页 (见微)',
        contexts: ['page', 'selection'],
      });
      // 第三项 —— 通用恢复入口：清掉本站规则。FAB 被 never 隐藏时是用户唯一
      // 的回路；same item 也能让用户在 always 站上"今天就别自动翻了"。
      chrome.contextMenus.create({
        id: MENU_ID_RESET_RULE,
        title: '重置本站翻译规则 (见微)',
        contexts: ['page', 'selection'],
      });
    } catch (err) {
      console.warn('[readsight] contextMenus.create:', err);
    }
  });
  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === MENU_ID_TRANSLATE_SELECTION) {
      translateSelectionInActiveTab(tab?.id);
    } else if (info.menuItemId === MENU_ID_TRANSLATE_PAGE) {
      toggleTranslateInActiveTab(tab?.id);
    } else if (info.menuItemId === MENU_ID_RESET_RULE) {
      resetDomainRuleInActiveTab(tab?.id);
    }
  });

  // 快捷键：在 manifest.commands 里定义；按下时触发同一个 toggle 入口
  chrome.commands.onCommand.addListener((command) => {
    if (command === 'toggle-translate') {
      toggleTranslateInActiveTab();
    }
  });

  chrome.runtime.onMessage.addListener((message: BackgroundMessage, sender, sendResponse) => {
    if (message.type === 'ASK_WITH_SELECTION') {
      // CRITICAL: chrome.sidePanel.open() 必须在 user gesture 链路里同步发射 ——
      // 任何 await 都会让 gesture 失效（Chrome MV3）。所以这里 _不 await_，
      // 直接发火 + 后续工作走 handleAskWithSelection。
      if (sender.tab?.id != null) {
        chrome.sidePanel
          .open({ tabId: sender.tab.id })
          .catch((err: unknown) => console.warn('[readsight] sidePanel.open failed', err));
      }
      handleAskWithSelection(message.payload, sender)
        .then(() => sendResponse({ ok: true }))
        .catch((err) => {
          console.error('[readsight] handleAskWithSelection failed', err);
          sendResponse({ ok: false, error: String(err) });
        });
      return true; // 标记"我会异步 sendResponse"
    }
    if (message.type === 'PASSIVE_HITS') {
      // 转发给 /api/encounter；不需要等响应，content script 也不要回执
      fetch(`${BACKEND}/api/encounter`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: message.payload }),
      })
        .then((r) => {
          if (!r.ok) console.warn('[readsight] /api/encounter HTTP', r.status);
        })
        .catch((err) => console.warn('[readsight] /api/encounter failed', err));
      return false;
    }
    if (message.type === 'HIGHLIGHT_REQUEST') {
      handleHighlightRequest(message.payload)
        .then(() => sendResponse({ ok: true }))
        .catch((err) => sendResponse({ ok: false, error: String(err) }));
      return true;
    }
    if (message.type === 'TRANSLATE_BLOCKS') {
      // 转发到 /api/translate；用 sendResponse 把结果一次返回给 content script
      handleTranslateBlocks(message.payload)
        .then((results) => sendResponse({ ok: true, results }))
        .catch((err) => sendResponse({ ok: false, error: String(err) }));
      return true;
    }
    if (message.type === 'TRANSLATE_STATE_CHANGED') {
      // content script 通知翻译开 / 关 → 更新"翻译整页"项的标题
      // 注意：chrome.contextMenus 是全局的，多 tab 时按最近活动 tab 状态展示
      const title = message.payload.active
        ? '撤销整页翻译 (见微)'
        : '翻译整页 (见微)';
      chrome.contextMenus
        .update(MENU_ID_TRANSLATE_PAGE, { title })
        .catch?.(() => {
          /* 菜单还没 create / 已 remove，忽略 */
        });
      return false;
    }
    return false;
  });
});

async function handleTranslateBlocks(payload: {
  blocks: Array<{ id: string; text: string }>;
}) {
  const res = await fetch(`${BACKEND}/api/translate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as { results: unknown };
  return data.results;
}

/**
 * 在所有 tabs 里找一个 URL 匹配的（PRD §8.3 跳回原文），把 HIGHLIGHT_ANCHOR
 * 转发给那个 tab 的 content script，并把 tab 切到前台。
 * 没找到匹配 tab = 用户已关原文页 → 抛错让 sidepanel 提示。
 */
async function handleHighlightRequest(payload: {
  url: string;
  anchor: SelectionContext['anchor'];
}) {
  const tabs = await chrome.tabs.query({ url: payload.url });
  if (tabs.length === 0) {
    throw new Error('source tab is closed');
  }
  const tab = tabs[0];
  if (tab.id == null) throw new Error('tab has no id');
  await chrome.tabs.update(tab.id, { active: true });
  if (tab.windowId != null) await chrome.windows.update(tab.windowId, { focused: true });
  const msg: BackgroundMessage = { type: 'HIGHLIGHT_ANCHOR', payload: payload.anchor };
  await chrome.tabs.sendMessage(tab.id, msg);
}

async function handleAskWithSelection(
  payload: AskWithSelectionPayload,
  _sender: chrome.runtime.MessageSender,
) {
  // sidePanel.open() 已经在 onMessage 顶部同步分支里发射了 —— 那个分支
  // 必须无 await 才能保住 Chrome MV3 的 user gesture，这里就专注做剩下
  // 两件可以 async 的事：存 storage + 转发 SELECTION_READY。

  const { ctx } = payload;

  // 双键：用 id 索引完整 SelectionContext + 一个 "latest" 指针。
  // 后者让 sidepanel 启动时一行 get 就能拿到"最近一次选区"做兜底恢复。
  // payload 里的 actionTag/initialMessage 也一起存：sidepanel 启动晚于 ASK
  // 时（user gesture 第一次开 sidepanel）listener 没挂上，靠 storage 兜底。
  await chrome.storage.session.set({
    [STORAGE_KEY_PREFIX + ctx.id]: payload,
    [STORAGE_KEY_LATEST]: ctx.id,
  });

  // 推给 sidepanel。如果 sidepanel 刚被 open 还没挂载完，listener 还没注册，
  // sendMessage 会抛 "Could not establish connection" —— 没关系，sidepanel
  // 启动时也会主动读 session storage 兜底。
  const msg: BackgroundMessage = { type: 'SELECTION_READY', payload };
  try {
    await chrome.runtime.sendMessage(msg);
  } catch {
    // 故意吞 —— sidepanel 未挂载是正常情况。
  }
}
