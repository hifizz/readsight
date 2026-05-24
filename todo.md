# Todo —— M2 学习记录（model-ready EncounterEvent）

> 配套 PRD §5.2 / §7.3 / §8.3 / §9。M0 + M1 的 todo 保留在 `todo.m0-m1.md` 供回查。
> 分支：`m2-learning-records`。每完成一项把 `- [ ]` 改成 `- [x]` 并标证据。
> 阻塞项标 `- [!]` 写明等什么。

---

## 决策记录（2026-05-24 已确认）

1. `/api/lookup` 改 POST 带 selectionContext；旧 GET 保留为只读 curl 调试用
2. chat 类事件只在 `selection.type === 'word'` 时落 `deepchat`；非 word 选区仍然落 chat_messages 但不发 EncounterEvent
3. 学习记录点条目 = 切回 Chat tab + 重新加载语境卡。**M4 必须支持重放历史对话内容**：因此 `chat_messages` 务必每条都按 `threadId` (= selectionContext.id) + role + content + createdAt 完整存好，schema 已就位无需改
4. 被动重逢扫描的 lemmatize **放前端做**，浏览器装 wink-lemmatizer（~50KB gzip），节省后端资源 + 避免把全文 POST 上去的隐私顾虑

---

## Context

M0/M1 已上线（main 分支 commit 链 `da9dc45..e486300`）：选区捕获、pill、sidepanel + assistant-ui Thread、`/api/chat` 流式接 MiniMax、`/api/lookup` 接 GLM 翻译、`/api/tts` 接 MiniMax speech-2.8-hd、`dictionary_entries` / `tts_cache` 缓存。

本期 M2 目标：让"每次查询 / 深聊 / 被动重逢"都成为 `EncounterEvent` 数据流入库，sidepanel 出"学习记录"标签让用户回看；点条目能跳回原对话 / 高亮原文。这是 PRD §12 学习模型（FSRS / HLR）的命脉数据，**晚一天积累就少一天数据**。

`schema.ts` 已有 `selection_contexts` / `encounter_events` / `chat_messages`，本期不动结构，只接通数据通路 + UI 露出。

---

## Phase A — 后端 EncounterEvent 接通 ✅

- [x] **A.1** ✓ `lookupWord` 输出 `itemKey: "${lemma}#${pos}"`；新加 `deriveItemKey()` 工具；老缓存条目读取时按 partsOfSpeech 现 derive 兼容
- [x] **A.2** ✓ `server/src/lib/encounter.ts`：`recordEncounter` + `recordPassiveReencounterDeduped`（后者本期 Phase C 用）；try/catch 吞异常
- [x] **A.3** ✓ `server/src/lib/selection-context.ts`：`upsertSelectionContext` + 共享 `SelectionContextDTO` 类型；camelCase ↔ snake_case 列映射；ONCONFLICT 幂等
- [x] **A.4** ✓ `/api/lookup` 加 POST `{ word, selectionContext? }`：upsert → lookup → recordEncounter('lookup')；GET 保留为只读 curl 路径。WordCard 改 POST（有 selectionContext 时）
- [x] **A.5** ✓ `/api/chat` 入路由 upsertSelectionContext + streamText onFinish 起 `setImmediate` 落 chat_messages 两条（user+assistant，threadId=ctx.id）+ word 选区时 lookupWord + recordEncounter('deepchat')；fire-and-forget 不阻塞 stream
- [x] **A.6** ✓ `GET /api/history?limit&before`：按 itemKey GROUP BY 聚合 `{ itemKey, lastSurfaceForm, lastTs, lastContextRef, totalCount, eventTypes[] }`；时间游标 nextCursor
- [x] **A.7** ✓ 双端 `tsc --noEmit` 零错误；E2E smoke test：lookup 写 1 行事件、chat 写 2 chat_messages + 1 deepchat、history 聚合 totalCount=2 / eventTypes=[lookup,deepchat]

---

## Phase B — Sidepanel 学习记录 UI ✅

- [x] **B.1** ✓ `pnpm dlx shadcn@latest add tabs badge` → `components/ui/tabs.tsx` + `badge.tsx`
- [x] **B.2** ✓ Sidepanel 主区域改 Tabs `Chat | Records`，header + ContextCard + WordCard 仍钉在上方（两 tab 共享）；切到 Records tab 自动 +1 refreshToken 触发列表重拉
- [x] **B.3** ✓ `components/records-list.tsx`：fetch `/api/history?limit=50`；卡片含 surfaceForm 大字 + (lemma) + pos chip + 次数 badge + 事件类型 chips + 相对时间；loading/empty/error 三态
- [x] **B.4** ✓ 点条目：fetch `/api/selection-context/[id]` 拿完整 DTO → 切回 Chat tab + setSelection。新增后端路由 `server/src/app/api/selection-context/[id]/route.ts` 做 DB row → DTO 反向映射
  - **D 完工后**：再补 background 发 `HIGHLIGHT_ANCHOR` 到 content script 让原文滚到 + 闪黄

---

## Phase C — 被动重逢扫描

- [ ] **C.1** `GET /api/known-items` —— 返回当前用户已查 itemKey 数组（本期单用户，全量返）
  - 仅返字符串数组（去重），方便 content script 当 set 用
  - 验证：curl 看到 Phase A 积累的 itemKey 全在

- [ ] **C.2** Content script 拉 known-items + 缓存
  - 启动时拉一次，写 chrome.storage.session key `english-agent:known-items`（5 分钟 TTL）
  - 5 分钟内重复访问 TechCrunch 文章直接读 cache
  - 验证：DevTools Application → Storage 看到对应 key

- [ ] **C.3** 扫描 + 过滤
  - 走 `findContentBlock` 一样的 block selector，所有 block textContent 拼起来
  - `Intl.Segmenter('en', {granularity:'word'})` 切词，对每个 token wink-lemmatize（**前端要装 wink-lemmatizer 一份**，浏览器侧也用）
  - 命中 known-items 集合 → 进候选；过滤掉本会话用户主动选过的（用 React state 维护一个 Set）
  - 等待 idle（document.readyState === 'complete' + setTimeout 1s）才扫，不影响首屏

- [ ] **C.4** `POST /api/encounter` 写 `passive_reencounter`
  - 前端 batch 发送：扫到的命中一次性 POST 数组，后端循环 recordEncounter
  - 后端去重：同一 url + lemma + 今天 已经有事件则 skip
  - 不上 UI（PRD §5.2 明确"本期只埋点"）
  - 验证：访问含已查词的文章，DB 多 N 行 passive_reencounter，且当天重复访问不会重复打点

---

## Phase D — 回原文高亮

- [ ] **D.1** Content script `HIGHLIGHT_ANCHOR` message handler
  - 接收 `{ exact, prefix, suffix }` —— PRD §5.1 TextQuoteSelector 形态
  - 当前 DOM 内 exact substring 匹配（先简单 exact，未来再 fuzzy）
  - 找到后 `scrollIntoView({ behavior: 'smooth', block: 'center' })` + 临时包 `<span style="background:yellow">` 2s 后淡出移除
  - 验证：DevTools console 手动 `chrome.runtime.sendMessage({type:'HIGHLIGHT_ANCHOR', payload:{exact:'...',prefix:'',suffix:''}})` 能命中

- [ ] **D.2** Background 中继消息到正确 tabId
  - sidepanel 发 `HIGHLIGHT_REQUEST { selectionContextId }` 到 background
  - background 查 storage / DB 拿 anchor，找到 SelectionContext.source.url 对应的 tab，sendMessage 给那个 tab 的 content script
  - 验证：sidepanel 点 records 项 → 原文 tab 滚到 + 闪黄
  - 边角：原文 tab 已关 → 弹 toast 提示"原文已关闭"

- [ ] **D.3** （可选）fuzzy 回定位
  - exact 匹配失败时用 prefix + suffix 做窗口模糊搜
  - 等真碰到失败 case 再做

---

## 验收

`m2-learning-records` 合回 main 前必须满足：

1. 选个单词查一次 → DB `encounter_events` 有一行 `lookup`
2. 跟 MiniMax 深聊一轮 → DB 有一行 `deepchat`
3. Sidepanel `Records` tab 看到刚才那两次记录
4. 点 Records 列表条目 → 跳回原文 + 高亮（D 完工）
5. 访问含已查词的 TechCrunch 文章 → DB 多若干 `passive_reencounter`，UI 不变
6. `pnpm compile` 和 `cd server && pnpm exec tsc --noEmit` 都 0 错误
7. `pnpm exec wxt build` 干净

---

## 不在本期范围

- M3 全文双语翻译 / `/translate` 路由（下一期）
- M1 收尾：§8.1 完整 popup + 快捷按钮 / 站点适配器框架 / 默认适配器（推迟）
- FSRS 调度器实际计算 / 复习卡片 / 移动推送（M4+，PRD 明确排除）
- 测试套件（架构稳定后批量补）

---

## 风险记录

1. **A.5 onFinish vs stream 关闭**：MiniMax `/api/chat` 用 `streamText` + `toUIMessageStreamResponse()`，Next 16 边缘运行时下 `onFinish` 不一定能跑完才 close。落库放 setImmediate / Promise 不 await，绝对不阻塞响应。
2. **C.3 扫描性能**：长文章逐词 lemmatize 可能阻塞主线程。先 hard cap 处理前 5000 字（约一篇文章），不够再上 web worker。
3. **C.3 浏览器侧 wink-lemmatizer 体积**：~50KB gzipped，扩展 bundle 影响可接受；如果超预算改用 cheap suffix-strip 算法。
4. **D.1 exact 匹配命中错误位置**：选区文本可能在文章里重复出现。用 prefix + suffix 的前 6 字符做唯一性 disambiguation。
5. **/api/encounter POST 暴露给浏览器**：本期单用户开发期无鉴权也 OK；上线前必须加身份层（cookie / JWT）。
