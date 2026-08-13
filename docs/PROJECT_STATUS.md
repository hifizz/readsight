# English Agent — 项目状态档案

> 归档日期：2026-05-24
> 当前分支：`m3-bilingual-translation`（M0/M1/M2/M3 全部完成）
> 配套：PRD.md（产品需求），todo.m0-m1.md / todo.m2.md / todo.md（M3）

一份"我们做完了什么 / 怎么做的 / 为什么这么决策"的快照，给未来的自己 / 接手者 / Claude 读。

> **当前架构补充（2026-08-12）**：以下 M0–M3 快照保留其当时的模型、TTS 和里程碑记录，不作为现行运维说明。当前侧栏/语境对话使用非 thinking 的 DeepSeek `deepseek-v4-pro`；全文翻译、词典中文释义补全和未知词估计使用非 thinking 的 `deepseek-v4-flash`。全文翻译仍保持 DeepSeek → Zhipu → OpenRouter fallback 与既有缓存命名空间。短语/句子朗读直接使用浏览器 `speechSynthesis`（`en-US`），`/api/tts` 已退休；既有 `tts_cache` 数据未删除。现行配置与部署说明见 `CLAUDE.md`、`docs/plan-deployment.md` 和 `docs/deploy-vps.md`。

---

## 一、产品定位

**英文沉浸式精读插件**。在用户阅读英文文章（TechCrunch 等任意英文站）时，让"能看懂大部分、但被个别词/句/语法卡住"的中文母语读者一站式解决：查词、查句、听音、翻译、深聊、记录、复习。

跟市面 Immersive Translate / 沙拉查词的不同点：**Chrome Sidepanel + assistant-ui 对话**作为核心，把 LLM 当导师而不是字典；并且**model-ready 的学习记录数据流**为后续 FSRS 复习模型铺好数据底子。

---

## 二、当前能力清单

### 2.1 划词精读

| 能力 | 状态 | 说明 |
|---|---|---|
| 选区捕获（PRD §8.2 三命门）| ✅ | mouseup 后立刻同步抓 SelectionContext；块内字符偏移用克隆 range；切句用 `Intl.Segmenter`；点 pill 时不再读 `window.getSelection()` 避免清空 |
| 划词浮窗 pill | ✅ | Shadow DOM 内的 "🔍 Ask English Agent" 按钮，浮在选区右上 |
| pill → sidepanel | ✅ | 点 pill 后 background 同步调 `chrome.sidePanel.open()`（user-gesture 链路保住），sidepanel 自动开 + 顶部钉语境卡 |
| Sidepanel chat | ✅ | assistant-ui Thread + ThreadList（Popover 折叠在右上角，不挤占对话区） |
| 每次新选区开新 thread | ✅ | `runtime.threads.switchToNewThread()` 自动归档旧对话 |
| 单词词典卡 WordCard | ✅ | IPA / 真人音频 ▶ / 词性 / 英文释义 / 中文释义 |
| 短语 / 句子 TTS 朗读 | ✅ | ContextCard 右上喇叭按钮 → MiniMax `speech-2.8-hd` |
| 中文释义 | ✅ | 英文 def 下方挂中文短译，淡色辅助阅读 |
| LLM 上下文化解读 | ✅ | `/api/chat` system prompt 注入 selection / sentence / paragraph，按 selection.type 分支引导 LLM 讲"在这一句里特殊用法 vs 普通用法" |
| 重试按钮 | ✅ | MessageError 内嵌 `ActionBarPrimitive.Reload` 官方原语 |

### 2.2 学习记录（PRD §5.2 / §7.3 / §8.3）

| 能力 | 状态 |
|---|---|
| EncounterEvent 自动落库（lookup / deepchat） | ✅ |
| 被动重逢扫描（passive_reencounter） | ✅ 用浏览器侧 wink-lemmatizer + IntersectionObserver |
| 学习记录 Records Tab | ✅ shadcn tabs + 卡片列表 + 相对时间 + 事件类型 chips |
| 点条目跳回原文 + 闪黄高亮 | ✅ 段落级（精确到单词的高亮待 M4+） |
| `/api/history` 聚合接口 | ✅ 按 itemKey GROUP BY，按 lastTs DESC 分页 |
| `chat_messages` 写库（M4 重放数据就绪） | ✅ threadId = selectionContextId |
| lemma + pos 作为 itemKey | ✅ 后端 wink-lemmatizer + Free Dictionary POS |

### 2.3 全文双语翻译（PRD §7.1）

| 能力 | 状态 |
|---|---|
| 浮动 "翻译全文" FAB 按钮 | ✅ Shadow DOM 右下角 |
| 右键菜单触发 | ✅ "翻译 / 撤销 (English Agent)" |
| 快捷键 `Alt+T` | ✅ chrome.commands |
| Mozilla Readability 正文识别 | ✅ 过滤导航 / 广告 / 评论 / 相关阅读 |
| 视口驱动渐进翻译 | ✅ IntersectionObserver 300px 预取 |
| 批处理（5 段 / HTTP） | ✅ 200ms debounce，3 并发上限 |
| Divide-and-conquer 兜底 | ✅ 单批失败拆半递归，单段失败不殃及其他 |
| 缓存命中 | ✅ sha256(model+lang+text) cache，重复文本秒回 |
| `<code>` 等内联标识符保护 | ✅ ⟪Cn⟫ 占位符往返，命令名 / API 名不被翻成中文 |
| 撤销翻译 | ✅ `querySelectorAll('.english-agent-translation').remove()` |
| 失败 UI | ✅ 灰色行内"翻译未能完成 · 重试" 文字链接，不再红框警告 |
| Dark mode 自适应 | ✅ 译文 color 继承 `window.getComputedStyle(anchor).color`，opacity 0.65 |

---

## 三、关键优化决策（这是文档的核心）

按时间顺序，每条都标"为什么这样做"。

### 3.1 LLM 分工：MiniMax 做对话 / Zhipu 做翻译

- **场景**：lookup 翻译、`/api/translate` 全文翻译
- **决策**：用 **Zhipu GLM-4-Flash**（中国区，免费、~200-400ms 响应）
- **MiniMax 保留**：`/api/chat`（语境化解读）+ TTS
- **为什么不用 MiniMax 翻译**：MiniMax-M2.x 是 thinking 模型，单次翻 2 段就吃 700+ token 推理；`-highspeed` 变体名义上非推理但实测当前 plan 不解锁（"0/0 used"）
- **为什么不用 MiniMax 兜底**：早期保留 fallback 路径，后来发现 GLM 失败时 MiniMax thinking 也常常超时，反而拖慢失败感知。**砍掉兜底，统一走 retry**

### 3.2 视口驱动 + 批处理 + 并发限制

- **背景**：长文章一篇 80 段，最初版"一次性 Promise.all 全发"把 GLM 频次墙撞穿，"频繁翻译失败"投诉滚滚而来
- **决策三件套**：
  1. **IntersectionObserver** 监听每个 block，进视口（含上下 300px 冗余）才入队
  2. **批处理**：5 段 / HTTP，200ms debounce，server 端一次 GLM 调用翻 5 段，**RPM 占用降为 1/5**
  3. **并发上限**：`MAX_CONCURRENT_BATCHES = 3`，防止用户狂滚瞬间炸出 50 个 HTTP
- **效果**：用户不滚到底 → 未访问段落永不翻译（省 token）；GLM 频次失败 90% 消失

### 3.3 Divide-and-conquer 翻译兜底

- **问题**：batch=5 后任何一段 token 截断 / JSON 解析失败 → **整批 5 段一起红**，视觉失败感 ×5
- **决策**：服务端 `translateWithFallback`，整批失败时**拆半递归**，单段失败才真返 error
- **效果**：5 段里坏 1 段 → 其他 4 段照常翻好；只那 1 段显示"重试"

### 3.4 Mozilla Readability 过滤正文

- **问题**：早期 fallback 到 `article` selector 抓正文，把导航 / 评论 / 相关阅读 / 广告 banner 也喂给 LLM，浪费 token + 给用户看不需要的中文
- **决策**：装 `@mozilla/readability`（~70KB，Firefox Reader View 同款），抽出真正的"正文 sentence 集合"做匹配 allowlist
- **复合过滤**：祖先黑名单（nav / aside / footer / .related / .sidebar / .comments / .ad / .promo）+ 链接占比 >50% 排除 + Readability sentence 命中
- **效果**：30% 的 token 浪费消除

### 3.5 占位符保护内联代码标识符

- **问题**：用户读技术文章，句子里 `<code>Write</code>` `<code>Edit</code>` `<code>Bash</code>` 是 CLI 工具名，LLM 当英文常用词翻成 "编写" / "编辑" / "Bash"，丢失语义
- **决策**：抽取 block 文本时递归 walk DOM，把 `code / kbd / samp / var / tt` 元素**替换成 `⟪C1⟫` `⟪C2⟫` 占位符**（Unicode 角括号确保 LLM 不去翻译）发给 LLM；翻完前端 `restorePreserves` 把占位符换回原代码文本
- **prompt 加 CRITICAL 规则**：告诉 LLM 必须保留 `⟪Cn⟫` exactly as-is
- **效果**：技术文档翻译质量大幅提升

### 3.6 Chrome MV3 sidePanel.open() 同步发射

- **真凶**：早期 pill 点击后 sidepanel 死活打不开。根因是 `chrome.sidePanel.open()` 必须在 user gesture 链路里**同步**发射 —— 任何 `await` 都会断 gesture
- **决策**：`onMessage` handler **同步**调用 `chrome.sidePanel.open().catch(...)`，**不 await**；其他异步工作（storage 写入、SELECTION_READY 转发）放后面
- **教训**：MV3 文档没明说 await 会断 gesture，得靠经验

### 3.7 译文颜色自适应页面 dark / light

- **问题**：硬编码 `rgba(0,0,0,0.55)` 黑色译文，dark mode 页面（白字黑底）上译文几乎不可见
- **决策**：`window.getComputedStyle(anchor).color` 读原段落**实际渲染颜色**（不依赖 `prefers-color-scheme`，连页面硬编码暗色都对），译文 `color: <inherited>` + `opacity: 0.65` 整体淡化
- **效果**：任何主题的页面都视觉一致

### 3.8 浏览器侧 lemmatize 还是服务端

- **决策点**：被动重逢扫描需要 lemma 化每个词。装在哪？
- **选项**：前端 wink-lemmatizer（+50KB gzipped 扩展包） vs 后端（content script 把文章 token 数组 POST 上去）
- **用户拍板**：**前端**，节省后端资源 + 避免文章内容上传
- **代价**：content script bundle 1.93 MB → 1.97 MB；可接受

### 3.9 单一真相源 = 后端

- **决策**：所有学习数据（selection_contexts / encounter_events / chat_messages / dictionary_entries / translations / tts_cache）只存 Postgres
- **前端缓存**：仅 chrome.storage.session 用于 MV3 SW 复活兜底；不做客户端 DB
- **未来 multi-device 同步**：天然有数据，加身份层即可

### 3.10 翻译失败 UI：从红框警告 → 灰色文字链接

- **早期**：红色高亮 + 边框按钮，"⚠ 翻译失败 (translation_failed) ↻ 重试"
- **用户反馈**：太红了，吓人，中文用户看不懂错误码；中文不适合 italic
- **当前**：`color: ${inheritedColor}; opacity: 0.45;` 灰色行内 "翻译未能完成 · [重试]"，"重试"是 underline 文字链接
- **设计原则**：错误状态 ≠ 警告，它是"日常会发生的事"，按 inline 的尊重感对待

### 3.11 三入口统一触发翻译（FAB / 右键 / 快捷键）

- **决策**：FAB 状态从 React 内提到模块级 `useSyncExternalStore`，导出 `togglePageTranslation()` 作为唯一入口
- **三种触发**：
  - FAB 点击：直接调 `togglePageTranslation()`
  - 右键菜单："翻译 / 撤销 (English Agent)" → background 发 `TOGGLE_TRANSLATE` 到 content script
  - 快捷键 `Alt+T`：`chrome.commands.onCommand` → 同上
- **三路汇合**，FAB UI 通过 `useSyncExternalStore` 订阅模块状态自动同步

### 3.12 缓存层架构（三套 hash-key 表，同构）

| 表 | 主键 | 用途 |
|---|---|---|
| `dictionary_entries` | `lemma` | 单词查询结果 |
| `translations` | `sha256(model + lang + text)` | 全文翻译段落 |
| `tts_cache` | `sha256(model + voice + text)` | MiniMax TTS 音频 |

**共同模式**：内容寻址 cache，写入用 `onConflictDoNothing` 幂等，命中即秒回。文本不变 → 永远复用。

### 3.13 外语检测交互改版：删询问 banner → 按语言偏好（靠近 Chrome）

- **问题**：老版本每打开一个外语站都弹一个注入页面的 `TranslatePrompt` banner 让用户选。抑制标志 `promptDismissed` 是 per-page-load 的，换站 / 刷新就重置 → 每站都被问，很烦。
- **对比 Chrome**：提示在浏览器边框（不侵入页面）、关几次降噪、**按语言**记忆（"永不/总是翻译英文"全局生效）、默认不自动翻只"提供"。我们的 FAB 本就等价于 Chrome 地址栏那个常驻翻译图标，banner 属于多余的第二重打扰。
- **决策（用户拍板）**：① 默认 **完全安静** —— 检测到外语不弹任何东西，FAB 安静待命；**整块 banner + `promptDismissed` 机制删除**。② 新增 **按语言偏好** `langBehavior`（`lib/settings.ts`）：「英文 / 其他语言 → 自动翻 | 手动」，做一次决定全局生效。
- **决策模型**（`TranslateFab` auto-start useEffect）：同语言跳过 → 域名规则 `never` 不翻（FAB 仍渲染）→ 域名规则 `always` 翻 → 无域名规则则看 `langBehavior[检测语言]`，`auto` 才翻。**域名规则优先级高于语言偏好**。`langBehavior` 在 effect 内 `await getSettings()` 取权威值，避开 `useSettings()` 初渲染 DEFAULT 竞态。
- **顺带修**：never 不再隐藏 FAB（见 `notes-translate-injection.md` UX坑1），muted 态保留恢复入口。
- **默认值**：所有语言含英文默认 `manual`（精读工具，默认全自动翻与精读相悖；零打扰、零意外）。

---

## 四、技术栈快照

### 4.1 扩展端（WXT + React 19）

```
WXT 0.20 + Vite + React 19 + TypeScript
├── Tailwind v4（@tailwindcss/vite 插件）
├── shadcn 注册表组件（Thread / ThreadList / Popover / Tabs / Badge 等）
├── assistant-ui v0.14（@assistant-ui/react + react-ai-sdk）
├── @ai-sdk/react v3（chat runtime）
├── ai v6（DefaultChatTransport）
├── @mozilla/readability（正文识别）
├── wink-lemmatizer（浏览器侧词形还原）
└── lucide-react（图标）
```

入口 3 个：
- `entrypoints/content/` —— 划词捕获 + 全文翻译 + 被动重逢扫描
- `entrypoints/background.ts` —— 消息总线 + 右键菜单 + 快捷键
- `entrypoints/sidepanel/` —— assistant-ui 对话 + Records + WordCard

### 4.2 后端（Next.js 16 + Drizzle + Postgres）

```
Next.js 16.2（App Router，无 Turbopack 在 lookup 路径绕开 fetch patch）
├── Drizzle ORM v0.45 + postgres-js
├── AI SDK v6（streamText / generateText / convertToModelMessages）
├── vercel-minimax-ai-provider（MiniMax 走 Anthropic-format）
├── @ai-sdk/openai-compatible（Zhipu 走 OpenAI 协议）
├── undici（绕开 Next Turbopack fetch patch，M3 lookup 学到的坑）
└── wink-lemmatizer（服务端 lemma 还原）
```

5 条路由：
- `POST /api/chat` —— assistant-ui streaming，MiniMax M2.1
- `POST /api/lookup` + `GET /api/lookup` —— 词典查询，Free Dictionary + Zhipu 中文翻译 + MiniMax LLM 兜底
- `POST /api/translate` —— 全文翻译，Zhipu GLM-4-Flash + divide-and-conquer 兜底
- `GET /api/tts` —— TTS，MiniMax speech-2.8-hd
- `GET /api/history` —— 学习记录聚合
- `GET /api/known-items` —— 用户已查 lemma 集合（被动重逢用）
- `POST /api/encounter` —— passive_reencounter 上报
- `GET /api/selection-context/[id]` —— 单个语境详情

### 4.3 外部服务

| 服务 | 用途 | 计费 |
|---|---|---|
| MiniMax China (`api.minimaxi.com`) | 对话主力 + TTS | Plus 包年付费 |
| Zhipu GLM-4-Flash (`open.bigmodel.cn`) | 翻译 / lookup 中文释义 | 免费 |
| Free Dictionary API | 英语词典 + IPA + 真人音频 | 免费无限 |
| Postgres (Docker) | 数据持久化 | 本地 |

---

## 五、Milestone 完成度

| Milestone | 完成度 | 备注 |
|---|---|---|
| **M0 — 地基** | ✅ 100% | WXT 三 entrypoint，shadcn + assistant-ui 接入，Postgres + Drizzle 接入 |
| **M1 — 灵魂（划词精读）** | ✅ 95% | 全部主功能完成；PRD §8.1 完整 popup 简化成了 pill 直跳 sidepanel（用户主动选择，更轻量）；站点适配器框架推迟到 M4+，目前是通用默认适配器 |
| **M2 — 学习记录** | ✅ 95% | EncounterEvent / Records UI / 跳回原文 / 被动重逢全部就绪；已知未做：词级精确高亮（当前段落级），等 CSS Custom Highlight API 应用 |
| **M3 — 全文双语翻译** | ✅ 100% | 视口驱动 + 渐进 + 缓存 + 失败兜底 + Readability 全到位 |
| **M4+ — 学习模型** | ❌ 未开始 | FSRS / 复习卡片 / 移动端推送；数据底子已就绪 |

---

## 六、明知存在但暂不改的"已知缺陷"

1. **高亮停在段落级**：M2 Phase D 当时用 block element 整段变色，未做 text node 范围精确 `<mark>`。等 Chrome CSS Custom Highlight API 成熟使用更优雅
2. **content script bundle 1.97 MB**：主要来自 wink-lemmatizer + Mozilla Readability。可接受
3. **`/api/encounter` POST 无鉴权**：单用户开发期 OK；上线前必须加 cookie / JWT
4. **MiniMax `-highspeed` 路径死代码**：plan 不解锁，但代码留着未来切换零成本
5. **Free Dictionary fetch 偶发超时**：8s timeout 偏紧，但延长会让用户等更久；目前的 LLM 兜底足够
6. **测试套件**：完全没写。架构稳定后批量补，PRD §11 已规划
7. **多语言**：当前只英 → 中。日 / 韩 / 西等待扩展

---

## 七、git 分支历史

```
main                                 (起点：原始 WXT starter + PRD)
└── m0-m1（已合）                    M0/M1 完成
    └── m2-learning-records          M2 完成（未合）
        └── m3-bilingual-translation 当前所在（M3 完成）
```

未合回 main 因为 M2 / M3 都没经历"上线 / 出问题修一轮 / 再发布"的稳定周期，留在 feature branch 方便回滚 + 增量验证。

---

## 八、给 M4+ 的接手者

1. **PRD §12** 已经明确 FSRS 调度器是技术方案，不重造轮子。数据底子（`encounter_events`）已就绪。直接装 `ts-fsrs` 库消费这张表
2. **复习卡片 UI**：assistant-ui 已经提供 Thread 框架，可以复用作为"复习对话"载体。但更可能要单建一个"复习" tab
3. **移动端推送**：需要后端长期跑 + 用户身份层；本期都没做。考虑 Cloudflare Worker + Push API
4. **多端同步**：后端已经是单一真相源；加身份层 + WebSocket 即可
5. **站点适配器框架**（PRD §3.2）：目前 detectSiteId 只有 TechCrunch 一条 if 分支。引入 adapter 接口 `match / extractArticle / quickActions / promptHints` 把 Readability 抽取逻辑泛化

---

完。
