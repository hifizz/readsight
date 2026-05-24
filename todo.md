# Todo —— M3 全文双语翻译（PRD §7.1 / §9 / §10）

> 分支：`m3-bilingual-translation`，从 `m2-learning-records` 起手（继承 M2 schema + Zhipu GLM-4-Flash 译者）。
> 历史 todo：`todo.m0-m1.md` / `todo.m2.md`。
> 每完成一项把 `- [ ]` 改成 `- [x]` 并标证据。`[!]` = 等用户/外部确认。

---

## Context

M0-M2 已上线：划词链路 + assistant-ui chat + lookup + tts + 学习记录闭环。
M3 = PRD §13 称为"重心"的全文双语翻译 —— 在 TechCrunch 文章页一键插入
每段下方的中文译文（PRD §7.1），失败按块独立保留原文 + 重试（PRD §10）。

GLM-4-Flash 已经在 M2 接好做翻译，中文母语 + 免费 + 快，复用它做全文翻译
顺理成章。后端缓存模式跟 dictionary_entries / tts_cache 同构。

---

## 决策记录（2026-05-24 已确认）

1. **触发**：页面右下角浮动 "Translate" 按钮（与 pill 共存）；再点一下撤销
2. **批粒度**：5 blocks/批，多批并发
3. **失败**：按块独立失败 + 单块重试按钮（PRD §10 原样）
4. **撤销**：DOM remove 已注入的 `.english-agent-translation` 节点
5. **列表页**：本期不做，只支持文章页
6. **译文节点**：纯 DOM + 内联样式 + class，**保证用户能选中复制中文做二次划词查询**
7. **交互进阶（中英切换）**：不做，译文一直显示，撤销才消失

---

## Phase A — 后端 `/api/translate` ✅

- [x] **A.1** ✓ schema 加 `translations` 表（hash PK + original_text + zh + target_lang + model + created_at），drizzle push 已应用
- [x] **A.2** ✓ `server/src/lib/translate.ts`：translateBatch(texts) 主管道
  - 批量 SELECT 查 cache（IN 查询）+ 短/标点字串跳过 LLM 原样返
  - miss 段一次 Zhipu GLM-4-Flash 批量调用（JSON array in/out）
  - Zhipu 失败 fallback MiniMax DEFAULT_MODEL_ID
  - 翻译结果 onConflictDoNothing 写库
- [x] **A.3** ✓ POST `/api/translate`：入参 `{blocks:[{id,text}]}` → 出参 `{results:[{id,zh,source,error?}]}`；上限 50 blocks；按 id 对齐响应
- [x] **A.4** ✓ Smoke test：
  - 第一次 4 段（2 长英文 + "a" + "123"）冷查 ~3s，2 写入缓存，2 短字串原样回
  - 第二次同段 **48ms 命中 cache**
  - 译文质量好（"60 million" → "6000万美元" 而非直译）

---

## Phase B — Content Script 抽取 + 浮动按钮 + 双语注入 ✅

- [x] **B.1** ✓ TranslateFab 浮动按钮（独立 Shadow DOM `english-agent-fab`，bottom-right，与 pill 状态解耦）；四态：idle / translating / translated / error；translating 下显示 `done/total` 进度
- [x] **B.2** ✓ `extractArticleBlocks()`：从 `article` / `main` / `[role=main]` 任一 root 内查 BLOCK_SELECTOR；text < 20 字符过滤；每 block 打 `data-eag-id` 属性双向绑定
- [x] **B.3** ✓ FAB 点击 → 拆 5/批 + `Promise.all` 并发 → 通过 background 转 `/api/translate` → 结果按 `data-eag-id` 找回 element → `insertAdjacentElement('afterend', div.english-agent-translation)` 注入；progress state 每批 +N 更新 FAB 文案
- [x] **B.4** ✓ 失败块：红色背景 + 边线 + 重试按钮，按钮 closure 单 block 重发；整批失败时所有块都拿到 retry 入口
- [x] **B.5** ✓ `undoAllTranslations()` querySelectorAll(`.english-agent-translation`).remove()；FAB 在 translated/error 状态点击触发撤销

---

## Phase C — Background 总线（消息中转）✅

- [x] **C.1** ✓ Background 收 `TRANSLATE_BLOCKS` → `handleTranslateBlocks` 转发到 `/api/translate` → sendResponse `{ ok, results }` 回 content script（一次往返，sync request-response 比双向消息更稳）
- [x] **C.2** ✓ 重试单块复用同一条 message —— content script 把单块当批量 1 元素发；不需要新消息类型
- [x] **C.3** ✓ background 不做二级缓存，纯 message proxy（SW 会被回收，缓存放后端 DB 才是 source-of-truth）

---

## Phase D — 收尾打磨

- [ ] **D.1** 顶部进度条 UI（可选）
  - 翻译中显示一条细窄进度条 1px 高，从 0% 涨到 100%
  - 或者按钮 spinning 就够了，先 spinning 后续再加进度条
  - 验证：手测进度可见

- [ ] **D.2** messaging.ts 加新类型
  - `TRANSLATE_BLOCKS` / `TRANSLATION_RESULTS` / `RETRY_BLOCK` / `TRANSLATION_RESULT`
  - 共享类型在 `lib/messaging.ts` 同步

- [ ] **D.3** 兼容 M2 高亮路径
  - 注入译文节点不能干扰 anchor 回原文的 prefix+exact+suffix 匹配
  - 验证：先翻译全文 → 再切到 Records tab 点条目 → 高亮还要能命中原文 block

---

## 验收

合回前必须满足：

1. TechCrunch 文章页点 "翻译全文" → 5-15s 内全部段落出中文（具体看长度）
2. 同一文章再点一次 → 大部分块走 cache，<2s 完成（DB `translations` 表多缓存命中行）
3. 模拟单块失败（手动改空字符串发后端）→ 失败块红色提示 + 重试按钮，**其他块照常显示**（PRD §10）
4. 撤销翻译 → DOM 完全干净，没有残留 `.english-agent-translation` 节点
5. 翻译完后从 Records tab 点条目 → 原文高亮仍能命中
6. `pnpm compile` + `cd server && pnpm exec tsc --noEmit` 全 0 错误
7. `pnpm exec wxt build` 干净，content script bundle 增量 < 50KB（不引入新大依赖）

---

## 不在本期范围

- 列表页（TechCrunch 首页 / 分类页）—— M4+
- 流式 SSE 协议 / 单块逐 token 流回 —— 批处理已够（PRD §7.1 流式是 nice-to-have）
- 自动翻译（PRD §13 "一键" 否定）
- 多语言（只 en → zh-CN）
- M1 收尾的站点适配器框架（这里硬编码 article 抽取，下迭代再泛化）

---

## 已知风险

1. **GLM-4-Flash batch JSON 解析**：跟 M2 lookup 翻译同款风险（M2.7-highspeed 一次太多输出会切断，我们用 GLM 不是 thinking 模型应该好得多，但仍按 5/批保护）
2. **TechCrunch 文章 DOM 异步加载**：广告 / 评论区延迟挂载，可能在抽取后变化；先抽一次，撤销重做之前不重抽
3. **block 节点引用失效**：作者域 / 评论加载可能 remove 节点，注入时若 block parent 不存在则 skip
4. **POST /api/translate 体量**：5 block × 平均 100 字符 = 500 字符 / 请求，远低于任何上限
5. **Zhipu GLM 速率**：免费 tier 不知道并发上限；先 5 批并发，撞限再退到 2 批
