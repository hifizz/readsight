/**
 * WXT 构建配置。
 *
 * - 用 `@wxt-dev/module-react` 让所有 entrypoint 自动获得 JSX + React 19 支持
 * - 用 `@tailwindcss/vite` 接入 Tailwind v4（Vite 插件方式是 v4 官方推荐路径）
 * - manifest 里显式声明 `action`（让工具栏图标可点）+ permissions
 *   （sidePanel: 调 chrome.sidePanel API；storage: SW 复活兜底；activeTab: 当前 tab 信息）
 *
 * 不要在这里加 `default_popup` —— 我们想点扩展图标直接开 sidepanel，default_popup
 * 会拦截掉这个行为。
 */
import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  vite: () => ({
    plugins: [tailwindcss()],
  }),
  // `pnpm dev` 启动 Chrome 时自动开这个页 —— 跳过 chrome://newtab 一步，
  // 直接落到我们的目标测试场（TC 长文 + 无限滚动）。
  // 想换页：直接改 URL 或塞多个进数组都行。
  webExt: {
    startUrls: [
      'https://techcrunch.com/2026/05/24/i-tried-amazons-bee-wearable-and-am-both-intrigued-and-slightly-creeped-out/',
    ],
  },
  manifest: {
    // 对外名 = 中文主名「见微」+ 英文 wordmark「Readsight」+ 角色定位
    // 见 docs/09-对外宣传与上架物料.md §二「名称候选 · 主推」
    name: '见微 Readsight：英文精读阅读伙伴',
    description: '沉浸式英语精读 (任意英文页 · 划词精读 + 双语翻译)',
    permissions: ['sidePanel', 'storage', 'activeTab', 'contextMenus'],
    action: {
      // 工具栏 hover tooltip 用短版，长版只用在商店列表
      default_title: '见微 Readsight',
    },
    commands: {
      'toggle-translate': {
        // 用 Alt+T：Chrome 没占；macOS 上不跟系统快捷键冲突
        suggested_key: { default: 'Alt+T', mac: 'Alt+T' },
        description: '翻译 / 撤销当前页面（见微）',
      },
    },
  },
});
