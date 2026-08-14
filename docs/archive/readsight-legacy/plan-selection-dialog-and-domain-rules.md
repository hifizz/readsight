# Plan：划词 Dialog + 域名级持续翻译

## Context

当前 English Agent 在划词翻译和持续翻译两件事上都不够顺手：

1. **右键菜单只有一个二态切换**（"翻译/撤销翻译"），划词和翻译整页混在一起，用户没法只查一个词；
2. **翻译状态零持久化** —— 用户刷新页面、SPA 跳转、打开新文章都要重新点 FAB，而读 TechCrunch 这类站点的核心需求就是"打开就翻"；
3. **划词结果展示链路过长** —— 划词 → Pill → Popup → Sidepanel，体验上断了三跳，缺少类似 macOS Lookup 的轻量浮窗。

本计划新增 3 件事：右键菜单一拆为二、划词 inline Dialog（取代现有 Popup）、按域名记忆翻译偏好（三态：总是 / 仅本次 / 从不）。

## 核心设计

### 1. 域名规则数据模型

新建 `lib/domain-rules.ts`：

```ts
type DomainRule = {
  domain: string;          // hostname，去掉前导 www.（MVP 不处理 eTLD+1）
  auto: 'always' | 'never';// 不存 'session'：仅本次 = 无规则
  mode: 'article' | 'page';
};
```

- 存储：`chrome.storage.sync`，key `english-agent:domain-rules`，value 是 `Record<string, DomainRule>`
- 选 sync 而非 local：跨设备同步用户偏好，规则量级小
- 三态 UI 语义：
  - **总是自动** → 写入 `{ auto: 'always', mode }`，下次访问自动翻
  - **仅本次** → 删除规则，本次手动翻译不影响下次
  - **从不** → 写入 `{ auto: 'never' }`，排除 Gmail / 复杂 WebApp，规则命中时连 FAB 都不显示

### 2. 右键菜单一拆为二（`entrypoints/background.ts:27-74`）

替换现有单菜单 `english-agent-toggle-translate` 为两项：

- `english-agent-translate-selection` — `contexts: ['selection']`，标题固定 "翻译选中内容"
  - 点击 → 给 active tab 发 `TRANSLATE_SELECTION`，content script 取当前 selection 打开 Dialog
- `english-agent-translate-page` — `contexts: ['page', 'selection']`，标题动态在 "翻译整页" / "撤销整页翻译" 之间切换
  - 复用现有 `toggleTranslateInActiveTab()` 逻辑
  - 动态标题继续走 `chrome.tabs.onActivated` + 状态查询那套（已存在）

### 3. 划词 Dialog 取代 Popup

新建 `entrypoints/content/selection-dialog.tsx`，替换 `entrypoints/content/popup.tsx`（直接删，不保留兼容）：

- **触发口**：
  - 划词 Pill 点击（保留 `content/index.tsx:240-357` 的 Pill 检测）
  - 右键菜单 "翻译选中内容"
  - 未来：双击单词（先不做）
- **形态**：shadow DOM 里 fixed 定位浮窗，紧贴选区下方/上方（自动避让），点外部关闭
- **内容**（MVP）：
  - 选中原文 + 中文翻译（接现有 `/api/translate`，单 block）
  - "深入对话" 按钮 → 触发现有 `ASK_WITH_SELECTION` 流程，把上下文打到 Sidepanel
- **后续优化预留**（不在本 PR）：词典释义、发音、网络例句 —— Dialog 组件预留 slot

注意：现有 `popup.tsx` 的 4 个 action（definition / pronunciation / sentence-translate / usage）暂时舍弃 —— 用户原话是"Dialog 实现比较简单，后面会优化"。这些 action 后续作为 Dialog 内的二级按钮回归。

### 4. FAB ModeMenu 增加域名规则开关（`entrypoints/content/translate.tsx:996-1075`）

在 `ModeMenu` 下拉里 article / page 模式选项下方加一个分组：

```
─────────────────────
在 techcrunch.com 上：
  ○ 总是自动翻译
  ● 仅本次
  ○ 从不
```

- 单选 radio，hostname 由当前 `location.hostname` 提取（剥 `www.`）
- 切换时立即写 / 删 `chrome.storage.sync` 规则
- 选"从不"时同步 stop 当前翻译 + 撤销

### 5. 启动自动翻译 + SPA URL 监听（`entrypoints/content/translate.tsx`）

content script 挂载时新增逻辑：

```ts
// 入口处
const rule = await getDomainRule(location.hostname);
if (rule?.auto === 'never') { /* 不挂 FAB，return */ }
if (rule?.auto === 'always') { startTranslate(rule.mode); }

// SPA 跳转续翻
['pushState', 'replaceState'].forEach(patchHistoryMethod);
window.addEventListener('popstate', onUrlChange);

function onUrlChange() {
  if (lastUrl === location.href) return;
  lastUrl = location.href;
  if (currentRule?.auto === 'always') {
    undoAllTranslations();      // 清旧译文
    setTimeout(() => startTranslate(currentRule.mode), 500);  // 等 SPA 渲染
  }
}
```

现有 `MutationObserver` 续翻（针对同一文章内 lazy-load）保留，新增的 URL 监听只处理"换了一篇文章"。

## 关键文件清单

| 文件 | 改动 |
|---|---|
| `lib/domain-rules.ts` | **新建** — storage 读写 + hostname 规范化 |
| `entrypoints/background.ts` (L27-74, L127-137) | 拆右键菜单为 2 项；新增 `TRANSLATE_SELECTION` 转发 |
| `entrypoints/content/index.tsx` (L240-357) | Pill 点击改为打开 Dialog；监听 `TRANSLATE_SELECTION` |
| `entrypoints/content/selection-dialog.tsx` | **新建** — 取代 popup.tsx |
| `entrypoints/content/popup.tsx` | **删除** |
| `entrypoints/content/translate.tsx` (L800-832, L850, L996-1075) | ModeMenu 加规则开关；初始化读规则自动启动；hook history API |

## 复用现有代码

- 单 block 翻译：`/api/translate` 已经支持 `blocks: [{text, hash}]`，Dialog 传一个 block 即可
- "深入对话" 跳 Sidepanel：复用 `ASK_WITH_SELECTION` → `SELECTION_READY` 那条消息链（`background.ts:198-203`）
- 撤销翻译：`undoAllTranslations()` 已在 `translate.tsx:445-446`
- FAB 位置持久化模式：参考 `lib/use-draggable.ts:64-103` 的 storage 读写写法

## 验证

用 `CLAUDE.md` 里已有的 Playwright 配方：

1. `pnpm build` → `pnpm dev`（server）
2. **右键菜单**：在 TechCrunch 文章页选中一段话 → 右键应看到两项菜单
3. **Dialog**：点 "翻译选中内容" → shadow DOM 里弹出 Dialog，显示原文 + 中文 + "深入对话"按钮
4. **域名规则持久化**：
   - 点 FAB chevron → 选"总是自动"
   - 关掉 tab，重开同一 URL → 不点 FAB 应自动开始翻译
   - 打开 TC 另一篇文章 → 也应自动翻译
5. **SPA 续翻**：在 TC 文章页点导航跳到另一篇 → 应自动重新翻译
6. **"从不"模式**：在 gmail.com 选"从不" → 刷新后 FAB 不显示
7. `pnpm compile` + `cd server && pnpm exec tsc --noEmit` 通过

## 显式不做

- 词典级别的释义（要等 Dialog 优化阶段）、网络例句、TTS 发音
- 路径前缀规则（如 `github.com/anthropic/*`）—— MVP 只到 hostname
- options page / sidepanel 设置 tab —— ModeMenu 三态够用
- 跨设备同步冲突合并 —— `chrome.storage.sync` 默认覆盖即可
