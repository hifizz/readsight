import { captureItemFromTab, submitCaptures } from '@/lib/capture';

const MENU_ID_SAVE_TABS = 'relata-save-tabs';

type CaptureResultMessage = {
  type: 'RELATA_CAPTURE_RESULTS';
  payload: Awaited<ReturnType<typeof submitCaptures>>;
};

async function saveSelectedTabs(clickedTab: chrome.tabs.Tab | undefined): Promise<void> {
  const windowId = clickedTab?.windowId;
  const tabs = windowId === undefined
    ? clickedTab ? [clickedTab] : []
    : await chrome.tabs.query({ highlighted: true, windowId });
  const eligible = tabs
    .map((tab) => captureItemFromTab(tab, 'tab_context_menu'))
    .filter((item): item is NonNullable<typeof item> => item !== null);
  const rejected = tabs
    .filter((tab) => !captureItemFromTab(tab, 'tab_context_menu'))
    .map(() => ({
      ok: false as const,
      clientRequestId: null,
      error: 'restricted_tab',
      message: '此标签页的地址无法保存。',
    }));
  const results = [...await submitCaptures(eligible), ...rejected];
  const message: CaptureResultMessage = { type: 'RELATA_CAPTURE_RESULTS', payload: results };
  chrome.runtime.sendMessage(message).catch(() => {
    // Side Panel 尚未打开时没有 receiver；结果仍由下次列表加载反映。
  });
}

export default defineBackground(() => {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error: unknown) => console.warn('[relata] 无法配置侧栏：', error));

  chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.removeAll(() => {
      chrome.contextMenus.create({
        id: MENU_ID_SAVE_TABS,
        title: 'Save to Relata',
        // Chrome 150 起支持 tab-strip context。事件只传入被右键点击的 tab；
        // 多选集合由上面的 highlighted query 从同一窗口读取。
        // @types/chrome 尚未包含该 ContextType，因此保留窄范围转换。
        contexts: ['tab' as unknown as chrome.contextMenus.ContextType],
      });
    });
  });

  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId !== MENU_ID_SAVE_TABS) return;
    if (tab?.windowId !== undefined) {
      chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
    }
    void saveSelectedTabs(tab).catch((error: unknown) => {
      console.warn('[relata] 标签页保存失败：', error);
    });
  });
});
