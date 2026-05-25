# 沉浸式英语精读插件 — 设计规格

> 一个 Chrome 扩展：以**全文双语翻译**为地基，以**划词精读 + 个人英语学习**为灵魂。**面向全网** —— 新闻、博客、推文、产品页、长文社区都覆盖；不针对单一站点，靠 Readability + text-walker 通用抓块，不写站点白名单。

---

## 1. 目标

帮助"能看懂大部分、但被个别词/句/语法卡住"的读者在英文站点上沉浸式阅读与学习：

1. **全文双语对照翻译**——保留原文，译文插在每段下方，随时可核对。
2. **划词精读**——遇到模糊的词/句，划选即可在选区旁快速查（词义、音标发音、地道译法、语法），也可一键展开侧栏深聊用法与 native 示意。
3. **忠实且 model-ready 的学习记录**——每次划词查询连同其语境被结构化记录成"遭遇事件流"，为后期"掌握度模型 + 复习调度 + 复习提醒"直接备好数据。

---

## 2. 范围

### 在范围（本期 M0–M3）
- 任意英文站的双语对照翻译（content script matches `<all_urls>`，DOM 抓块走 Readability + text-walker 通用路径，不依赖站点白名单）。覆盖：新闻 / 博客 / Twitter / Reddit / HN / 产品发布页 / 公司主页等。
- 划词精读：选区上下文捕获、气泡 + 弹窗、快捷动作、一键深聊。
- 词义/音标/发音的来源与降级管线（见 §6）。
- 侧栏：双标签（当前对话 / 学习记录），深聊 + 历史回看 + 回原文高亮。
- 所有划词查询（含仅点快捷按钮）记录成 **model-ready 的 encounter event**（含 lemma/pos），并预留"被动重逢"检测钩子。
- "通用内核 + 站点适配器"架构，默认适配器保证其他英文站基本可用。

### 不在范围（留待 M4+）
- 掌握度模型与复习调度器（FSRS）的实际落地、复习卡片 UI、移动端推送提醒（本期只把数据备成 model-ready，不做模型与复习/推送）。
- 通用 "Claude-for-Chrome" 闲聊（已退出核心；底层正文提取保留，但不为闲聊单独做 UI）。
- local-first 多端同步引擎（本期后端为唯一真相源 + 轻量本地缓存）。
- 后端实现细节（Cloudflare AI Gateway 等）——仅约定前端契约。
- 弹窗的屏幕定位算法（用户已有成熟实现）。

---

## 3. 架构

### 3.1 运行时（四块，Background 为总线）
- **Content Script**：唯一直接读写页面 DOM 的角色。注入双语译文层、监听划词、挂载气泡与弹窗（均在 Shadow DOM 内，与站点样式互不污染）、抽取正文与选区上下文、跑"被动重逢"扫描。
- **Side Panel**（Chrome 侧栏）：深聊场 + 学习记录中心。**不直接读页面**，只消费 Content Script 经总线递来的上下文。
- **Background Service Worker**：消息总线兼调度器。翻译分段批处理、查/写缓存、把后端流式响应中继回对应上下文。所有跨上下文通信经此。
- **后端（Agent/LLM）**：翻译、对话/深聊、词典查询、TTS、查询落库。前端只对接契约。

> 隔离原则：Content Script 碰页面，Side Panel 不碰页面，一切通信走 Background。

### 3.2 工程（WXT 单工程：三 entrypoint + 一层共享代码）
- **三 entrypoint**：`content`、`background`、`sidepanel`，直接对应运行时三块。
- **共享 TS 模块**（被各 entrypoint import）：
  - **通用内核**：正文提取（Readability 类）、文本分块、选区 + 段落上下文摘录、被动重逢扫描、后端客户端。
  - **站点适配器**：每站一个模块。导出 `match(url)`、`extractArticle(doc)`、`quickActions`、`promptHints`。`TechCrunch adapter` 精修；`默认适配器` 兜底。

---

## 4. 组件职责

| 组件 | 做什么 | 依赖 |
|---|---|---|
| Content Script | 译文注入、划词监听、气泡/弹窗（Shadow DOM）、上下文捕获、被动重逢扫描 | 通用内核、站点适配器、Background |
| Background SW | 消息路由、翻译批处理、缓存、流式中继、转发上下文给侧栏 | 后端客户端 |
| Side Panel | 双标签 UI（当前对话 / 学习记录）、深聊、历史回看、回原文 | Background、`SelectionContext` |
| 通用内核 | 正文提取、分块、选区上下文摘录、被动重逢扫描、后端客户端 | — |
| 站点适配器 | `match` / `extractArticle` / `quickActions` / `promptHints` | 通用内核接口 |
| 后端 | `/translate`、`/chat`（自动落库）、`/history`、`/lookup`、`/tts` | — |

---

## 5. 核心数据结构

### 5.1 `SelectionContext`（捕获管线产物）
记录/复习/深聊共享的唯一真相源。**在选区产生时一次抓全并缓存**（见 §8.2 命门三）。

```ts
interface SelectionContext {
  id: string;                    // ULID
  capturedAt: string;            // ISO 时间
  source: { url: string; title: string; siteId: string; heading?: string };
  selection: {
    text: string;                // 精确选中文本（surface form）
    type: 'word' | 'phrase' | 'sentence' | 'multi';
    range: [start: number, end: number];   // 在 paragraph 内的字符偏移
  };
  context: {
    sentence: string;            // 覆盖选区的句子（决定地道译法/native 示意质量）
    paragraph: string;           // 所在段落全文（"摘录"）
  };
  anchor: {                      // 复习时回原文高亮
    quote: { exact: string; prefix: string; suffix: string };  // TextQuoteSelector
    blockIndex?: number;
  };
}
```

### 5.2 `EncounterEvent`（model-ready 的遭遇事件流）
学习模型（§12）的输入。**每次查询 / 深聊 / 被动重逢都产生一条**，按 (用户, item) 汇聚成时间序列。

```ts
interface EncounterEvent {
  itemKey: string;            // lemma + pos，跨次链接同一个词/概念
  surfaceForm: string;        // 本次实际见到的形态
  contextRef: string;         // 指向 SelectionContext.id
  eventType: 'lookup' | 'quick' | 'deepchat' | 'passive_reencounter';
  outcome?: 'understood' | 'still_unsure';   // 可由深聊软评估或显式反馈填
  ts: string;                 // ISO，用于算复习间隔 Δ
}
```

- **item 派生**：前端只上报 `surfaceForm` + 语境；`lemma + pos`（即 `itemKey`）由后端轻量词形还原得出，避免前端塞词法库。
- **被动重逢**：Content Script 拿"用户已查词集合"扫当前文章正文，命中且本次未主动查 → 记一条 `passive_reencounter`（弱正信号）。本期只埋点，不上 UI。

---

## 6. 查询结果来源与降级（翻译 / 音标 / 发音）

### 6.1 翻译（词义 / 译法）
走 `/chat`，**带 `SelectionContext.context.sentence`**，要求"结合本句"的地道译法与言下之意，而非脱离语境的词典义。这是抓句子上下文的核心回报。

### 6.2 音标：词典优先，G2P/AI 兜底
**不让 AI 当主力**——常用词 IPA 以词典为金标准，AI 仅补词典盲区，并标注"估计"。
- 主路：词典源（CMUdict / Wiktionary·Free Dictionary API / `open-dict-data/ipa-dict`）拿 IPA，命中即缓存，给美式/英式两版。
- 兜底：TechCrunch 多新词/产品名/缩写，词典 miss 时用规则 G2P（espeak-ng 类）或 LLM 生成，结果标 `estimated: true`。

### 6.3 发音：分层，控成本
- **Tier 0（默认）**：浏览器 `speechSynthesis`，零延迟、离线、免费，应付"扫一眼听个音"。
- **Tier 1（单词）**：优先词典真人录音（Free Dictionary API / Wiktionary / Forvo），权威、可给美/英两版。
- **Tier 2（句子精听 / 发音操练）**：ElevenLabs（韵律天花板，支持 IPA/CMU 发音词典强制读音）或 Google Neural2 / OpenAI TTS；**仅深度学习场景触发**以控成本。

> `/lookup` 提供 §6.2 的 IPA + §6.3 Tier 1 真人音频；`/tts` 提供 §6.3 Tier 2 合成音频；Tier 0 在客户端，无需后端。

---

## 7. 数据流

### 7.1 全文翻译（M3）
Content Script 抽取可翻译文本块 → Background 分段批处理、查缓存 → 未命中发 `/translate` → 译文流式返回 → Content Script 在每块下方插入译文节点（双语对照）。列表页与文章页同此。

### 7.2 划词精读（M1）
选区事件 → Content Script 跑捕获管线生成并缓存 `SelectionContext`（§8.2） → 气泡 → 点击 → 弹窗：
- **轻路径**：点快捷按钮 → `/chat`（带 `actionTag`）或 `/lookup`（音标/词典）流式回结果，就地显示；"发音"按 §6.3 分层。
- **重路径**：输入框打字 + 回车/点"深聊" → 携 `selectionId` + 问题 + 弹窗已有轮次，打开侧栏「当前对话」继续。

### 7.3 学习记录（M2，model-ready）
所有 `/chat`、`/lookup` 调用由后端**顺手写入 `EncounterEvent` + 落库**——前端不单独调记录接口；被动重逢由 Content Script 上报。侧栏「学习记录」经 `/history` 拉列表；点条目 → 切到「当前对话」载入线程，或经 `anchor` 回原文高亮。

---

## 8. 交互流程与 UI

### 8.1 弹窗（轻）
用户感知元素：选中文本回显 + 类型徽章、随选区类型变化的快捷按钮、即时结果区、底部输入框 + "深聊"按钮、"会记入学习记录"提示。
- 选词/短语按钮集：词义 · 音标发音 · 本句译法 · 用法搭配。
- 选句/多句按钮集：翻句 · 析语法 · 改写地道说法 · 难点定位。
- 按钮集由站点适配器声明，默认适配器给通用一套。弹窗屏幕定位用用户既有实现。

### 8.2 上下文捕获管线（命门，Content Script 内）
1. **选区事件**：`mouseup`，选区非空且落在正文区。
2. **定位内容块**：适配器 `isContentBlock` / 默认 `p, li, blockquote`。
3. **块内字符偏移（命门一）**：克隆 range 设为"块首→选区首"，取 `.toString().length`——拍平内联标签，得到选区在纯文本中的真实偏移，作为切句与锚点的统一坐标系。
4. **切句（命门二）**：`Intl.Segmenter(lang, {granularity:'sentence'})` 切句（不用正则，避免缩写/小数点被切碎），取覆盖选区的句子。
5. **组装** `SelectionContext`。
- **命门三（时机）**：选区一出现立刻跑完并缓存（以 `id` 索引）；气泡、弹窗、侧栏只引用缓存，不再碰原生选区（点击自身 UI 会清空 `window.getSelection()`）。

### 8.3 侧栏（重）
- 双标签：**当前对话** / **学习记录**。
- 当前对话：Assistant UI 线程，顶部钉**语境卡**（选中词/句 + 所在句 + 来源），从 `/chat` 流式。
- 学习记录：`/history` 列表，**每个选区一条线程**；点开 → 切到当前对话载入；同一词多次查询先各存各的（带各自语境），归并到 `itemKey` 由后端处理。
- 侧栏不重新抓页面，全靠 `selectionId` + 缓存的 `SelectionContext` 还原语境。

---

## 9. 前后端契约

| 端点 | 入 | 出 | 备注 |
|---|---|---|---|
| `POST /translate` | 批量文本块 | 译文（流式） | 全文双语用，前端分段批处理 + 缓存 |
| `POST /chat` | `{ selectionContext, history, message, actionTag? }` | 回复（流式） | 快捷动作与深聊共用；**自动写 EncounterEvent + 落库** |
| `GET /lookup` | `{ word, lang }` | `{ ipa:{us,uk}, audioUrl?, source, estimated? }` | 音标（§6.2）+ 词典真人音频（§6.3 Tier1）；**记 lookup 事件** |
| `POST /tts` | `{ text, voice }` | 合成音频 | §6.3 Tier2 句级精听 |
| `GET /history` | 分页参数 | 查询历史列表 | 侧栏「学习记录」用 |

后端为唯一真相源；前端轻量本地缓存仅用于提速与离线展示。

---

## 10. 错误处理

- **翻译**：按块独立失败——失败块保留原文并给"重试"，不阻塞其他块;速率限制走退避;缓存避免重复翻译;流中断可对未完成块续翻。
- **选区捕获**：选区为空/落非正文/跨非文本节点 → 不弹气泡;找不到内容块 → 退化到 range 最近块或粗粒度上下文;`Intl.Segmenter` 不可用 → 退化到保守分句器。
- **音标/发音**：词典 miss → G2P/AI 兜底并标 `estimated`;真人音频缺失 → 回退 Tier 0 `speechSynthesis`;TTS 失败 → 提示并回退 Tier 0。
- **`/chat`/`/lookup` 流错误**：在弹窗/侧栏内提示并允许重试，保留 `SelectionContext` 不丢。
- **落库失败**：不影响前端拿到回复;记录持久性由后端保障。
- **MV3 SW 可能被回收**：`SelectionContext` 缓存与瞬时状态写入 `chrome.storage.session`（以 `selectionId` 为键），SW 重启后可重新水合。
- **样式/脚本隔离**：气泡、弹窗、译文层挂 Shadow DOM，避免与站点 CSS/JS 互相污染。

---

## 11. 测试策略

- **单元（重点在捕获内核）**：偏移映射、切句、锚点生成、选区类型判定——纯函数，用 jsdom/happy-dom 构造刁钻 DOM（缩写、跨标签选区、小数点、内联 `<a>/<em>`）。
- **音标/发音降级**：词典命中/miss、estimated 标注、音频回退路径。
- **适配器**：TechCrunch `extractArticle` 对保存的 HTML 夹具（文章页 + 列表页）断言;默认适配器兜底。
- **锚点回定位**：序列化 `anchor` → 轻微改动 DOM → 重新定位命中。
- **被动重逢**：构造含已查词的文章 → 断言只在"未主动查"时记 `passive_reencounter`。
- **集成**：WXT dev build，配 mock 后端（`/translate`、`/chat`、`/lookup`、`/tts`、`/history`）跑消息往返。
- **E2E（轻）**：Playwright 在夹具页跑"选区 → 气泡 → 弹窗 → 快捷动作结果"与"深聊 → 侧栏种子化"。

---

## 12. 学习模型蓝图（M4+，但决定当下数据形态）

核心是两个纠缠的子问题：**记忆建模**（现在还记得 item 吗？）与**调度**（何时推送复习？）。本期不实现，但数据已按其需求备好（§5.2）。

**调度器：直接采用 FSRS**（Free Spaced Repetition Scheduler，已内置 Anki、取代 SM-2）。基于 DSR 模型（Difficulty / Stability / Retrievability，源自 Woźniak 三成分记忆模型，Jarrett Ye 形式化；脱胎于墨墨背单词 DHP）。比 Anki 默认算法少做约 20–30% 复习即维持同等留存，有默认参数兜冷启动、攒够复习再按个人优化。**不重造轮子。**

**记忆建模参考：HLR**（Duolingo，Settles & Meeder ACL 2016）。召回概率 p = 2^(−Δ/h)，item 用 lexeme tag（surface + lemma + pos + 形态）——这正是 §5.2 存 `lemma/pos` 的原因。HLR 需百万级轨迹，单用户不适合直训，作概念参考。

**隐式信号（我们 vs Anki/Duolingo 的差别，无显式打分）**：
- `lookup` = "这词不确定"（弱负）;同词再查 = 仍未掌握;
- `passive_reencounter` = 曾查过的词再出现却没查 ≈ 可能掌握（弱正，独特信号，Anki 做不到）;
- LLM 从深聊**软评估**"解释后是否真懂" → 填 `outcome`。

**LLM 差异化**：用真实读到的句子生成**情境化复习题**（新 TechCrunch 句子里的完形），而非干巴卡片。

**更后期**：若要从"词级"升到"概念级"（如"虚拟语气一直没掌握"），引入知识追踪（BKT / DKT，Piech et al. 2015 及注意力变体）。

---

## 13. Milestone 路线图

> 先地基 → 先做灵魂（划词）尽早验证 → 紧跟记录（与划词成对，且 model-ready）→ 再补重心（翻译）→ 留白。

- **M0 · 地基**：WXT 工程 + 三 entrypoint;通用内核正文提取 + 适配器骨架（TechCrunch + 默认）;Content Script 注入 Shadow DOM 容器。后端先 mock。**验收**：判定文章页、抽出正文块。
- **M1 · 划词精读核心（灵魂）**：捕获管线（`SelectionContext` + 三命门）+ 气泡 + 弹窗（快捷动作就地结果 + 音标/发音分层 + 输入框）+ 一键深聊开侧栏;接通 `/chat`、`/lookup`、`/tts`。**验收**：选词/句能即时查（含音标发音）、能深聊。
- **M2 · 学习记录（忠实 + model-ready）**：侧栏双标签 + 后端自动写 `EncounterEvent`（含 lemma/pos）+ `/history` + 语境卡 + anchor 回原文高亮 + 被动重逢埋点。**验收**：所有查询被记成 model-ready 事件流、可回看、可跳回原文。
- **M3 · 全文双语翻译（重心）**：双语对照内联，分段批处理 + 缓存 + 流式，列表页 + 文章页;接通 `/translate`。**验收**：一键把文章/列表翻成中文对照。
- **M4+ · 留白**：FSRS 调度器 + 掌握度模型 + 复习卡片 + 移动端推送;扩展更多站点;local-first 同步;通用 chat（可选）。

---

## 14. 关键决策清单

1. 重心是翻译（重要性），但**先做划词精读**（先验证灵魂功能）。
2. 双语呈现：**双语对照**，原文保留、译文插段下。
3. 翻译范围：列表页 + 文章页都翻译;深聊仅文章/选区上下文。
4. 翻译引擎：走自有 Agent/LLM（分段批处理 + 缓存 + 流式）;译法**结合本句语境**。
5. 工程：**WXT 单工程**，通用内核 + 站点适配器，不拆成两个插件。
6. 划词形态：**弹窗轻、侧栏重**，深聊一键展开到侧栏。
7. 上下文档位：**句 + 段级**（选区 + 所在句 + 所在段 + 文章 meta + quote 锚点）。
8. 记录口径：**全部记录**（含仅点快捷按钮的查询）。
9. 侧栏组织：**双标签**（当前对话 / 学习记录）。
10. **音标**：词典优先、G2P/AI 兜底并标"估计"——不让 AI 当主力。
11. **发音**：分层（speechSynthesis 默认 / 词典真人音频单词 / ElevenLabs·Google·OpenAI TTS 句级精听）。
12. **学习记录现在就 model-ready**：M2 加 `lemma/pos` + `EncounterEvent` + 预留被动重逢钩子。
13. **调度器采用 FSRS**（DSR 模型），不重造;HLR 作记忆建模参考;掌握度/复习/推送留 M4+。
14. 后端契约：`/translate`、`/chat`（自动落库）、`/lookup`、`/tts`、`/history`;后端为唯一真相源。