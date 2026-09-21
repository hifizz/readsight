/**
 * WXT 构建配置。
 *
 * - 用 `@wxt-dev/module-react` 让所有 entrypoint 自动获得 JSX + React 19 支持
 * - 用 `@tailwindcss/vite` 接入 Tailwind v4（Vite 插件方式是 v4 官方推荐路径）
 * Relata 使用 Side Panel 作为主要界面。工具栏图标直接打开当前 tab 的 Side Panel，
 * 不设置 `default_popup`。
 */
import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

const backendUrl = process.env.WXT_BACKEND_URL ?? 'http://localhost:4010';
const backendMatchPattern = `${new URL(backendUrl).origin}/*`;

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  vite: () => ({
    plugins: [tailwindcss()],
  }),
  manifest: {
    name: 'Relata',
    description: "Connect what you discover to what you're working on.",
    minimum_chrome_version: '150',
    permissions: ['sidePanel', 'storage', 'activeTab', 'tabs', 'contextMenus', 'scripting', 'clipboardWrite'],
    host_permissions: [backendMatchPattern],
    action: {
      default_title: 'Relata',
    },
  },
});
