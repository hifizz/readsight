# 全页翻译注入：坑点笔记

记录 page-mode 抽取与译文注入 (`entrypoints/content/translate.tsx`) 上踩过的几个非显然的坑，方便下次改这块代码或在新站点出现类似问题时快速定位。

---

## 坑 1：`<main>` 里的 `<script type="application/json">` 让外层 block "祖先覆盖" 所有内容

**触发站点：** github.com（Primer Brand + contentful CMS）

**现象：**
- 顶部出现一大坨"翻译" —— 实际是把 SSR JSON payload 当英文丢给 LLM 翻译的产物
- 页面正文（hero `<h1>` 等）**完全不被翻译**

**根因：**
1. `extractPageBlocks` 的 text-walker 遍历到 `<script type="application/json">` 内的 JSON 文本时，往上找 PAGE_BLOCK_TAG 祖先 —— 最近命中往往是 `<main>` 或某个 wrapper `<div>`
2. 这个外层节点被加入 `units` 集合
3. 后续 walker 访问到 hero `<h1>` 时，dedup 逻辑发现"有祖先在 units 里"→ `coveredByAncestor` → 跳过
4. block.text 通过 `buildTextWithPreserves` 递归子节点收集，没排除 `<script>` 子树，整段 JSON 进了 text
5. LLM 拿到一坨 JSON 当英文翻译，乱码就这么注入到页面顶部

**修复：** commit `38b9f85`
- 新增 `NON_RENDERED_SELECTOR = 'script, style, noscript, template'`
- walker 中：`if (parent?.closest(NON_RENDERED_SELECTOR)) continue;`
- `buildTextWithPreserves` 中：`if (el.matches(NON_RENDERED_SELECTOR)) return '';`

**经验：** 任何会"收集 textContent"的逻辑都要先确认排除 `<script>` / `<style>` / `<template>`。`Node.textContent` 默认是包含的。

---

## 坑 2：`display: none` 的 a11y 隐藏文本被翻译，译文跑出来

**触发站点：** github.com header 下拉菜单

**现象：** 顶栏附近一条横向小字带，飘着零散中文

**根因：**
- GitHub header 用 `<details>` 折叠菜单，里面有 a11y 用的 `<h1>Navigation Menu</h1>` / `<h1>Saved searches</h1>` / `<h1>Provide feedback</h1>` 等
- 折叠态下这些标题 `display: none`，用户看不见
- 但 walker 不看渲染状态，照样把它们当 block 抽出来翻译
- 译文 div 被注入到 anchor 后面，因为 anchor 在 visible 容器里，div 跟着流出来挂在 header 上

**修复：** commit `38b9f85`
- 新增 `isRendered(el)`：`offsetParent !== null || rect.width > 0 || rect.height > 0`
- walker 中：`if (parent && !isRendered(parent)) continue;`

**注意事项：**
- `isRendered` 触发 layout，所以仅在抽取阶段（不频繁）调用，**不要**放进 hot path
- `visibility: hidden` 仍有 offsetParent，本函数检测不到 —— 目前没遇到此场景，先不优化
- `<details>` 折叠态正好让子节点 offsetParent = null，符合期望（折叠态没必要翻）

---

## 坑 3：表格上下文，`<div>` 译文被当成匿名 cell 渲染到右边

**触发站点：** news.ycombinator.com（也包括任何 `<table>` 布局站）

**现象：** 译文出现在原文**右侧**而不是下方，整行布局错乱

**根因：**
- HN 用 `<tr><td>` 表格布局，story 标题在 `<td class="title">` 内
- walker 把 `<td>` 当作 unit
- `injectTranslation` 用 `anchor.insertAdjacentElement('afterend', divNode)`，把 `<div>` 插成 `<td>` 的兄弟节点
- **HTML 规范不允许 `<div>` 直接做 `<tr>` 的子节点**。浏览器走 "foster parenting" 算法：
  - 要么把 div 提出 table 外
  - 要么当成匿名 table cell 渲染，挤在原 cell 右边
- HN 表现是后者

**修复：** commit `5bcdea5`
- 抽出 `insertTranslationNode(anchor, node)` 按 anchor 标签分发：
  - `TD` / `TH`：`anchor.appendChild(node)` —— div 是 block-level，自然换行到 cell 底部
  - `TR`：包一层 `<tr><td colspan=N>node</td></tr>` 作为合法表格行
  - 其它：维持 `afterend` sibling
- Cleanup（重试场景）兼容三种插入位置：nextElementSibling / lastElementChild / 包了的 tr

**沉浸式翻译同款思路：** 用 `<font>` 而不是 `<div>` 包裹（`<font>` 副作用最小），按 anchor 的 "父能接什么子" 决定插入位置。我们这版用 `<div>` 也 OK，碰到宿主 CSS 打架再改 `<font>`。

**通用规则：** 想在宿主页面 DOM 里"注入新节点"，先想清楚 anchor 的父容器**能不能合法接受**这个节点 —— `<table>` 系列最严，`<select>` / `<datalist>` 也不能塞任意标签。

---

## 坑 4：`sr-only` skip-link 让整页 wrapper DIV 成为单一 unit，正文被祖先覆盖全部跳过

**触发站点：** cerebras.ai（任何用 Tailwind `sr-only` / Bootstrap `.visually-hidden` 在顶层挂 a11y 跳转链接的站）

**现象：** 主内容区一整块都不被翻译；只有 footer / 顶栏 banner 这种"挂在 page wrapper 外面"的少量段落得到译文。

**根因：**
1. Cerebras 站结构：`<body> → <div class="min-h-screen"> (9100px) → 全页内容`
2. `min-h-screen` 内第一个子节点是 `<a class="sr-only ...">Skip to main content</a>`
3. `sr-only` 不是 `display:none`，offsetParent 非空、rect 是 1×1px（clip 到角落）。原 `isRendered` 检测 `rect.width > 0 || height > 0` → 视为已渲染
4. walker 从 "Skip to main content" 文本节点往上找 PAGE_BLOCK_TAG：A 不是 → DIV.min-h-screen 是 → `unit = DIV.min-h-screen`
5. units 已含覆盖整页的外层 DIV，后续所有文本节点的 unit 都被祖先覆盖 → 跳过
6. 仅 footer（挂在 min-h-screen 外面，是 body 的另一个直接子节点）能被收

**修复：** 收紧 `isRendered`：rect 必须 **width > 1 且 height > 1**。`sr-only` 的 1×1px clip 现在被识别为不可见。`<body>` 仍单独豁免。

**经验：** "offsetParent 非空" 不等于 "用户能看见"。a11y 库流行的 visually-hidden 技巧（position:absolute + 1×1 + overflow:hidden + clip）都属于这一类。任何"看不见但能被屏幕阅读器读到"的 trick 都会把不该当 block 的元素混进 walker。

---

## UX 坑 1：`auto: 'never'` 静默隐藏 FAB，用户无从恢复

**触发场景：** 用户在某站（典型：x.com / 任一复杂 WebApp）点过 FAB 菜单里的「从不在此站翻译」。

**现象：** FAB 直接消失，下次进同域名仍然没有 FAB。用户记不起来自己点过这个开关，会反过来觉得"扩展挂了 / 不支持这个站"。

**根因：** `translate.tsx` 的 `TranslateFab` 在 `rule?.auto === 'never'` 时直接不渲染（line 1298）。`'never'` 写进 `chrome.storage.sync` 的 `readsight:domain-rules`，跨设备同步、跨 tab 持续生效。唯一恢复路径是右键菜单「重置本站翻译规则 (见微)」—— 但用户的第一直觉是去找 FAB 上的开关，不会想到右键。

**当前规避：** 右键菜单 + Console `chrome.storage.sync.set({'readsight:domain-rules': {}})`。

**未来要改：** never 状态下保留一个超低调可恢复入口，让用户能"看见自己关掉了"。两个候选：
1. 角标：5×5px 半透明灰点，hover 才显形，文案"本站已禁用，点击恢复"
2. sidepanel：加「已禁用站点」列表，one-click 解禁

**经验：** 任何"静默隐藏自己"的功能都必须留一个用户能发现的恢复入口。隐藏得越彻底，用户越觉得是"产品坏了"而不是"自己关了"。

---

## 综合 checklist —— 改抽取 / 注入逻辑时过一遍

- [ ] 抽 text 的递归是否排除了 `script / style / noscript / template`？
- [ ] 是否过滤了 `display: none` 的元素？
- [ ] 是否过滤了 `sr-only` / `.visually-hidden` 这种 1×1 clip 的 a11y 隐藏元素？
- [ ] 选 unit 时是否考虑 anchor 的父容器对子节点的限制（table / list / select）？
- [ ] 重试场景的旧节点 cleanup 是否覆盖了所有可能的插入位置？
- [ ] 注入完后用 Playwright 在 github.com + news.ycombinator.com + cerebras.ai 三站回归
