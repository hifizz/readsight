# Plan: 沉浸式对照阅读 (Immersive Side-by-Side Reader)

## Context

当前 content script 的"翻译正文"模式是把译文以小字 inline 注入到原段落下方，适合"边浏览原页面边瞄一眼中文"的场景。但对于深度阅读，用户希望有一种"左右对照"的沉浸视图：

- 打开一个全屏蒙层，屏蔽掉原页面的广告、侧栏、评论等干扰
- 左原文、右译文，每段顶部对齐，方便逐段对照
- 一个滚动条同时驱动两侧

这是一个新的"阅读模式"入口，与现有 inline 译文模式互补，不替代它。

## Decisions (已对齐)

1. **入口**：FAB 菜单第三个模式按钮，紧跟"翻译正文 / 翻译全页"，文案候选「对照阅读」。
2. **关闭**：ESC 键 + 右上角 × 按钮。**不**点击背景关闭（避免误触丢失阅读位置）。
3. **原文呈现**：仅取文本，复用 overlay 自己的一套通用排版（不克隆原页面 DOM、不拷 computed styles）。原文/译文用同样的字号、行高，便于对齐。
4. **同步滚动**：单一滚动容器 + CSS Grid（`grid-template-columns: 1fr 1fr; align-items: start;`）。每段是一个 grid row，行高自动取左右最大值，对齐和同步都是 CSS 天然结果，**零 JS**。

## Architecture

### 复用现有能力（不要重写）

| 能力 | 来源 | 复用方式 |
|------|------|---------|
| 正文抽取 | `entrypoints/content/translate.tsx` — `extractArticleBlocks('article')` | 直接复用 `ArticleBlock[]`，每个 block 提供 `id / text / restoreMap` |
| 翻译请求 | `translateBatchViaBackground()` (translate.tsx) | 直接复用，缓存命中后秒回 |
| 占位符还原 | `restoreMap`（⟪C1⟫ → 原始 code 文本） | 渲染前调用现有还原逻辑 |
| Shadow DOM 注册 | `entrypoints/content/index.tsx` 中 `createShadowRootUi()` 套路 | 新增第三个 shadow root |

### 新增文件

**`entrypoints/content/immersive-reader.tsx`** — 单文件 React 组件 + mount 函数。导出 `mountImmersiveReader(ctx)` 给 `index.tsx` 调用，导出 `openImmersiveReader()` 让 FAB 触发打开。

内部职责：
- 监听 `window` 上的自定义事件 `eag:open-immersive`（FAB 通过 `window.dispatchEvent` 触发，跨 shadow root 通讯）
- 打开时调 `extractArticleBlocks('article')`，立即渲染左侧原文 + 右侧 skeleton
- 分批调 `translateBatchViaBackground`，结果到达后渐进填充右侧
- 维护 `open / blocks / translations: Map<id, {zh, error}>` 状态
- 处理 ESC 键 + × 按钮关闭

### 修改文件

**`entrypoints/content/translate.tsx`**
- `TranslateMode` 类型扩展：增加 `'immersive'`（保留命名一致性，即便它不走 inline 注入）
- `modeItems` 数组（~line 1477）增加 `{ mode: 'immersive', label: '对照阅读', desc: '左右分屏沉浸式阅读' }`
- `onPickMode` 分支：若 `mode === 'immersive'`，**不**走现有 inline 翻译逻辑，直接 `window.dispatchEvent(new CustomEvent('eag:open-immersive'))` 后关闭菜单
- 把 `extractArticleBlocks` 和 `translateBatchViaBackground` 改为 `export`（目前是模块内函数）

**`entrypoints/content/index.tsx`**
- 仿照 FAB 那段，再 `createShadowRootUi()` 注册第三个 shadow root（host 为 `position: fixed; inset: 0; z-index: 2147483647; pointer-events: none`，子元素在 open 时切到 `pointer-events: auto`，避免常态遮挡页面）
- mount `<ImmersiveReader />`

## Reader UI 设计

```
┌──────────────────────────────────────────────────────────────┐
│  Backdrop  rgba(0,0,0,0.55)                                  │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  ░ Title bar (页面标题，可选)                       × │  │ ← sticky
│  │  ────────────────────────────────────────────────────  │  │
│  │  Scroll container (overflow-y: auto)                   │  │
│  │  ┌─────────── Grid (1fr 1fr, gap 32px) ───────────┐    │  │
│  │  │  原文 paragraph 1   │   译文 paragraph 1       │    │  │
│  │  │  ─────────────────  │   ─────────────────      │    │  │
│  │  │  原文 paragraph 2   │   译文 paragraph 2       │    │  │
│  │  │  ─────────────────  │   ─────────────────      │    │  │
│  │  │  原文 paragraph 3   │   [⋯ 翻译中]              │    │  │
│  │  └──────────────────────────────────────────────────┘    │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

**关键 CSS：**
- 外层容器：`max-width: min(1400px, 92vw); height: 90vh; margin: auto;` 居中
- Grid：`display: grid; grid-template-columns: 1fr 1fr; column-gap: 32px; row-gap: 18px; align-items: start;`
- 每段：`font: 16px/1.7 system-ui, ...; color: #1a1a1a;` (light 主题；深色主题切换见下)
- 译文额外：`font-weight: 300; opacity: 0.85`（贴近现有 `.english-agent-translation` 风格，但不再 inherit 原页面颜色，因为 overlay 有自己的背景）
- Skeleton：`background: linear-gradient(...)` 灰条 + shimmer 动画

**主题：** v1 固定 light 主题（白底深字）。Dark 模式留 follow-up。

## 流程

1. 用户点 FAB → "对照阅读"
2. translate.tsx `onPickMode` 派发 `eag:open-immersive`
3. ImmersiveReader 收到事件 → setOpen(true) → 调 `extractArticleBlocks('article')`
4. 若返回空：toast「未识别到正文」，自动关闭，不打开 overlay
5. 立即渲染左侧原文（直接 `block.text` 还原占位符），右侧每段显示 skeleton
6. 分批调 `translateBatchViaBackground`（沿用 translate.tsx 现有 batch size 与 30s 超时），结果 setState 填入
7. 单段失败：右侧显示「翻译失败」灰字
8. 用户按 ESC / 点 × → setOpen(false)，清空 state

## Verification

1. `pnpm build` 后用 CLAUDE.md 中的 Playwright recipe 加载 `.output/chrome-mv3`，打开一篇 TechCrunch 文章
2. 点击 FAB → 菜单出现「对照阅读」→ 点击
3. 验证：
   - Overlay 全屏覆盖，原页面无法滚动（lock body scroll）
   - 左右两侧段落数量相同，且每段顶部对齐（用 DevTools 看 grid row baseline）
   - 滚动 overlay 内部，左右同步移动；原页面不动
   - 右侧译文逐批填入，先到的先显示
   - ESC 关闭；× 按钮关闭；点击背景**不**关闭
4. 缓存验证：先用「翻译正文」模式翻译过一遍，再开「对照阅读」，右侧应秒回（DeepSeek cache hit）
5. 边界：在一个没有 `<article>` 的页面（如 google.com 首页）触发，应 toast 提示且不打开 overlay
6. 类型：`pnpm compile`
