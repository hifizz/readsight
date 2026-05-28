# Plan: SidePanel 自动 Dark Mode

## Context

sidePanel 当前已经完整定义了 light / dark 两套 shadcn CSS 变量（`entrypoints/sidepanel/style.css` 的 `:root` 与 `.dark` 块），并且 Tailwind v4 用 `@custom-variant dark (&:is(.dark *))` 把 `dark:` 工具类绑死在 `.dark` 祖先上。assistant-ui 与 shadcn 组件（`components/ui/*`、`components/assistant-ui/*`）大量使用 `dark:bg-*` / `dark:text-*` —— 单靠 `@media (prefers-color-scheme)` 翻变量是不够的，必须真的把 `.dark` class 挂到 `<html>` 上，`dark:` 工具类才会一起切换。

目标：sidePanel 打开时跟随系统 dark mode 自动切换；用户在系统层面切换主题（不重开 sidePanel）也要实时跟随。

不在范围内：手动主题切换 UI、`localStorage` 覆盖。如果之后要做，再叠一层 `data-theme` 覆盖即可，本次不预埋。

## 方案

在 `<html>` 上根据 `prefers-color-scheme: dark` 增减 `.dark` class。两段代码协作：

1. **inline boot script（消除 FOUC）** —— 在 `index.html` 里，React bundle 之前同步执行一次，首帧就把 class 挂好。
2. **React 侧 matchMedia 监听** —— `main.tsx` 里订阅 `change` 事件，OS 主题切换时实时翻转。

不需要改任何 CSS，也不需要改 `App.tsx` / 组件，shadcn 变量和 `dark:` 工具类会自动响应。

## 改动文件

### `entrypoints/sidepanel/index.html`

在 `<head>` 末尾、`<body>` 之前插入一段 inline script（要在 `main.tsx` 之前执行，避免白底闪烁）：

```html
<script>
  (function () {
    try {
      if (matchMedia('(prefers-color-scheme: dark)').matches) {
        document.documentElement.classList.add('dark');
      }
    } catch (e) {}
  })();
</script>
```

### `entrypoints/sidepanel/main.tsx`

挂载前订阅 matchMedia 变化（不放进组件里，避免和 StrictMode 双调用纠缠）：

```ts
const mql = matchMedia('(prefers-color-scheme: dark)');
const apply = (dark: boolean) => {
  document.documentElement.classList.toggle('dark', dark);
};
apply(mql.matches);                       // 兜底覆盖 boot script
mql.addEventListener('change', (e) => apply(e.matches));
```

放在 `ReactDOM.createRoot(...)` 调用之前即可。

## 不动的部分

- `style.css` —— `.dark` 块和 `@custom-variant dark` 已就位。
- `App.tsx` 与所有 assistant-ui / shadcn 组件 —— 跟随变量自动适配。
- 内容脚本的 pill / popup / immersive-reader —— 它们各自有独立的 shadow DOM 配色逻辑（最近一笔 `feat(pill): 配色自适应 dark mode`），不影响也不被影响。

## 验证

1. `pnpm build`，在 `chrome://extensions/` 重载 unpacked。
2. 系统切到 Light → 打开 sidePanel → 检查背景白、文字深、assistant-ui Thread 区域是 light 配色。
3. 系统切到 Dark → 重开 sidePanel → 应为暗色（无白底闪烁）。
4. sidePanel 保持打开，OS 主题在 Light/Dark 之间切换 → sidePanel 应实时跟随翻转（验证 matchMedia 监听）。
5. DevTools 里确认 `<html>` 在 dark 模式下确实有 `class="dark"`。
