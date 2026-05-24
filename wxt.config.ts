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
  manifest: {
    name: 'English Agent',
    description: 'TechCrunch 沉浸式精读 (划词精读 + 双语翻译)',
    permissions: ['sidePanel', 'storage', 'activeTab'],
    action: {
      default_title: 'English Agent',
    },
  },
});
