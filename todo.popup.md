# Todo —— 划词 popup 完整版（PRD §7.2 / §8.1）

> 分支：`m3-bilingual-translation`（顺手做，不另起分支）。
> 历史 todo：`todo.m0-m1.md` / `todo.m2.md` / `todo.md`（M3）。
> 每完成一项把 `- [ ]` 改成 `- [x]` 并标证据。`[!]` = 等用户/外部确认。

---

## Context

M1 当年把 PRD §8.1 完整 popup 简化成「pill 直跳 sidepanel」（见 `docs/PROJECT_STATUS.md`
L220），用户主动选的更轻量路径。M3 期间把 popup 又拉回 PRD 原版：选区
→ pill → popup 弹出（含类型徽章、快捷按钮、即时结果、输入框 + 深聊按钮）。

本期之前已完成的 popup 骨架（commit pending —— popup-phase-1 末尾）：
- popup 框架（header / buttons / 输入框 / footer）渲染齐
- 定位修复（按真实高度算，不再上飘）
- 拖拽：抽 `lib/use-draggable.ts`，FAB & popup 共用
- 深聊 + Enter → 发 `ASK_WITH_SELECTION` 打开 sidepanel
- 输入框 enabled 受控
- 临时：action 按钮也走深聊路径（占位）

**架构调整（2026-05-25 用户决策）**：
原 PRD §7.2 「轻路径」描述的是"popup 内联流式回结果"。实测后用户决定**简化**：

> popup 只做触发器；所有 action（包括按钮 + 自由输入）一律跳 sidepanel 由系统
> 代用户发一条对应消息。sidepanel 输入框上方加一排 suggestion 按钮镜像 popup 的
> 4 按钮 —— 这样不打断阅读、交互模型也只剩一个（sidepanel chat）。

得失：
- ✅ 不在 popup 内塞 streaming UI（之前 Phase B 加了 240 行，现在删干净）
- ✅ 对话历史天然连续（都在同一 thread）
- ✅ "重路径"概念消失 —— popup 没有"已有轮次"要搬迁
- ⚠️ 用户要看回答必须切到 sidepanel；不能"瞄一眼词义"

---

## 决策记录

1. **endpoint 复用 `/api/chat`**（PRD §9 明确「快捷动作与深聊共用」），扩展一个
   可选参数：`actionTag?: ActionTag` 切系统提示。所有响应都走默认 ui stream
   给 assistant-ui，不需要 text-stream 模式（已在简化中移除）。
2. **popup = 触发器**，不内联流式（架构调整决策，见 Context 末尾）。
3. **sidepanel SuggestionBar**：4 个按钮镜像 popup，按 selection.type 切；
   `pronunciation` 过滤掉 —— sidepanel 自己已有 ContextCard / WordCard 喇叭。
4. **代用户发**：runtime.thread.append(label) + `pendingActionTagRef` 的 read-and-clear
   pattern —— 下次普通输入就回到无 tag 自由聊。
5. **发音按钮：Tier 0 only**（`SpeechSynthesisUtterance`），就地播音，不开 sidepanel
   —— 音频播放不打断阅读。Tier 1 真人音频留给 sidepanel WordCard。
6. **encounter 落库**：popup / SuggestionBar 按钮 hit `/api/chat` 时 eventType 用
   `'quick'`（schema 已有）；纯输入聊天仍是 `'deepchat'`。

---

## Phase A — 后端 `/api/chat` 扩展 actionTag ✅

- [x] **A.1** ✓ `ChatRequestBody` 加 `actionTag?: ActionTag`（默认无 tag 走自由聊）
      — `server/src/app/api/chat/route.ts`
- [x] **A.2** ✓ `buildSystemPrompt(ctx, actionTag)` 按 tag 拼 task prompt；7 个非
      pronunciation tag 各有 system prompt 后缀 — `server/src/lib/action-tags.ts`
- [x] **A.3** ✓ `recordEncounter({ eventType: actionTag ? 'quick' : 'deepchat' })`
- [x] **A.4** ✓ 共享 `ActionTag` 复制定义在三处并互相 cross-reference：
      `lib/messaging.ts` / `lib/action-tags.ts` / `server/src/lib/action-tags.ts`

> 已删：`format: 'text'` 模式 + `synthesizeUserMessage`（架构调整后 sidepanel
> auto-send 总有一条 user 消息，不需要 text-stream 也不需要兜底合成）

---

## Phase B — sidepanel SuggestionBar + auto-send ✅

> 替代了原计划的 "popup 内联流式" —— 用户决策（见 Context）。

- [x] **B.1** ✓ `lib/messaging.ts` 加 `AskWithSelectionPayload = { ctx, actionTag?, initialMessage? }`；
      ASK_WITH_SELECTION / SELECTION_READY 用同 shape；background 写 storage 也存
      payload 整体（startup 兜底走 storage 时也能 auto-send）
- [x] **B.2** ✓ `entrypoints/sidepanel/App.tsx`：
      - `pendingActionTagRef` + transport.body() read-and-clear pattern
      - `SelectionBridge.dispatch(payload)` 同步 selectionRef → switchToNewThread
        → `runtime.thread.append(label / initialMessage)`
      - `autoSentIdsRef` 防 storage-path 和 onMessage-path 双触发（同 ctx.id 只发一次）
- [x] **B.3** ✓ `components/assistant-ui/thread.tsx`：Thread 加 `composerPrefix?: ReactNode`
      slot，渲染在 sticky 底部 Composer 上方
- [x] **B.4** ✓ `SuggestionBar`：按 selection.type 出 4 按钮（过滤 pronunciation），
      点击 = `sendActionTag(tag)` → `pendingActionTagRef.current = tag` + `thread.append(label)`

---

## Phase C — popup 简化成触发器 ✅

- [x] **C.1** ✓ 拆掉之前 Phase B 加的 ResultArea + stream + abortRef + 重试 UI
- [x] **C.2** ✓ action 按钮 onClick = `sendAsk({ ctx, actionTag })` + closePopup
- [x] **C.3** ✓ input + Enter / 深聊按钮 = `sendAsk({ ctx, initialMessage: text || undefined })`
- [x] **C.4** ✓ 发音按钮保留 Tier 0 in-place（不开 sidepanel —— 音频不打断阅读）

---

## 验证 ✅

- [x] `/tmp/eag-simplified-flow.mjs`：
      - TEST A：popup 仅 3 段（header / buttons / footer），无 ResultArea
      - TEST B+C：先开 sidepanel → 点 popup 「词义」→ 抓到一条 POST /api/chat，
        body.actionTag='meaning'、user msg='词义'、selectionContext.text='serendipity'
      - TEST D：sidepanel SuggestionBar 点「用法搭配」→ POST /api/chat actionTag='usage'
      - TEST E：textarea 里键入自由文本 + Enter → POST /api/chat **无** actionTag
      - SuggestionBar 不含 '发音'（被过滤）

---

## 历史 Playwright 脚本（不再 reflect 当前架构，留作回归参考）

- `/tmp/eag-popup-action.mjs`：曾验内联 streaming —— 当前架构下 ResultArea 已删
- `/tmp/eag-popup-error.mjs`：曾验 popup 内 fetch 失败显示重试 —— 当前架构下不存在
- `/tmp/eag-fab-regression.mjs`：FAB 拖拽回归，仍有效（useDraggable hook 没动）
