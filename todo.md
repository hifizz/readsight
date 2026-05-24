# Todo —— M0/M1 落地（assistant-ui sidepanel + Next.js 16 后端）

> 配套方案：`/Users/zilin/.claude/plans/refactored-coalescing-galaxy.md`
> 完成一项就把 `- [ ]` 改成 `- [x]`，并在该项末尾备注实际验证证据（命令输出、文件路径、截图说明等）。
> 阻塞项标 `- [!]` 并写明等待你做什么。

---

## Round 3 — 单词专用查询路径（PRD §6.2/§6.3 落地）

- [x] **R3.1** ✓ 后端 `pnpm add wink-lemmatizer` + 自写 `server/src/types/wink-lemmatizer.d.ts`（registry 无 @types/...）
- [x] **R3.2** ✓ schema 加 `dictionary_entries`（PK=lemma，jsonb payload）；`drizzle-kit push --force` 已应用
- [x] **R3.3** ✓ `lib/messaging.ts` 加共享 `LookupResult` 类型；`server/src/lib/lookup.ts` 重复定义同形（避免跨包导入）
- [x] **R3.4** ✓ `server/src/lib/lookup.ts` 主管道：normalize → wink lemmatize → DB 缓存 → Free Dictionary API → MiniMax 兜底（estimated:true）。POS 上限 4，每 POS 定义上限 2，防 WordCard 撑爆
- [x] **R3.5** ✓ `server/src/app/api/lookup/route.ts` GET 路由 + OPTIONS 预检
- [x] **R3.6** ✓ `server/src/app/api/chat/route.ts` system prompt 按 `selection.type` 分支：word → 专注语境化用法（避开字典义）；其他 → 原 PRD §6.1 路径
- [x] **R3.7** ✓ `components/word-card.tsx`：IPA + 真人音频按钮（tier 1，失败回退 SpeechSynthesis tier 0）+ POS 分块定义 + estimated badge + 过期请求丢弃机制
- [x] **R3.8** ✓ sidepanel App.tsx：`selection.type === 'word'` 时挂 WordCard 在 ContextCard 和 Thread 之间
- [x] **R3.9** ✓ smoke test：`outed → out`、`studies → study`、`outing` 命中 cache —— 全部 200 OK，lemma 共享缓存生效

**新发现 / 已知问题**：
- Free Dictionary 对"out" / "set" 这种超高频词会返 7+ POS。后端已经合并同名 POS、上限 4，cache 写入也是已过滤后的形态。如果用户报某个词词性少了，可以放宽到 6。
- LLM 兜底用的是 `generateText` + 手动 JSON 解析，没用 `generateObject`，避免 vercel-minimax-ai-provider 对结构化输出 schema 支持不全踩坑。

---

## Round 2 — 划词捕获 → sidepanel 注入语境（用户选 option 3 后追加）

- [x] **R2.1** ✓ 新建 `lib/messaging.ts`：跨 context 共享的 `SelectionContext` 类型 + `BackgroundMessage` 联合类型（`ASK_WITH_SELECTION` / `SELECTION_READY`）
- [x] **R2.2** ✓ `entrypoints/content/index.tsx` 重写：
  - `mouseup` + `selectionchange` 监听（rAF 抖动稳定）
  - PRD §8.2 命门一：`offsetWithinBlock()` 克隆 range 取 `toString().length` 得选区在块内字符偏移
  - PRD §8.2 命门二：`Intl.Segmenter('en', { granularity: 'sentence' })` 切句取覆盖句（带粗分句退化方案）
  - PRD §8.2 命门三：选区一出现立即同步抓全成 `SelectionContext` 存进 React state；点击 pill 时不再读 `getSelection()`
  - 选区类型分类（word/phrase/sentence/multi）按 PRD §8.1
  - TextQuoteSelector anchor（exact/prefix/suffix）准备 M2 回原文高亮用
  - `crypto.randomUUID()` 给 id（PRD 说 ULID，后端 text 列接受任意字串，未来可换）
  - Shadow DOM 内渲染浮窗 pill：选区右上 6px 偏移，`onMouseDown` 阻止清选区
- [x] **R2.3** ✓ `entrypoints/background.ts`：
  - `chrome.runtime.onMessage` 收 `ASK_WITH_SELECTION`
  - `chrome.storage.session` 缓存 `SelectionContext`（PRD §10 MV3 SW 复活兜底）+ `latest-selection-id` 指针
  - `chrome.sidePanel.open({ tabId })`（user gesture 链路保留）
  - 转发 `SELECTION_READY` 给 sidepanel
- [x] **R2.4** ✓ Sidepanel 布局重做：
  - 删左右双栏；改单列 flex-col
  - 顶部 header：左 title「English Agent」+ 右 History 图标按钮
  - History 按钮用 shadcn `Popover` 包裹 `<ThreadList/>`（72×80 ScrollArea）—— 历史折进抽屉，主区域留给对话
  - `ContextCard` 钉在 Thread 上方：选区类型 badge + 文章标题 + 选中文本 + 所在句 + 关闭按钮
- [x] **R2.5** ✓ Sidepanel ↔ chat runtime 注入语境：
  - `chrome.runtime.onMessage` 监听 `SELECTION_READY` → set React state
  - 启动时从 `chrome.storage.session` 读 `latest-selection-id` 兜底恢复
  - `DefaultChatTransport` 的 `body` 用函数式（thunk），每次发请求从 `useRef` 读最新 `selectionContext`，不重建 runtime 不丢对话
  - 后端 `/api/chat` 早已在 system prompt 注入 selectionContext（route.ts 已就位）
- [x] **R2.6** ✓ 新增 shadcn 组件：`popover` + `scroll-area`
- [x] **R2.7** ✓ `pnpm compile` + `pnpm exec wxt build` 两边干净；manifest 含 `permissions: [sidePanel, storage, activeTab]`、`side_panel.default_path: sidepanel.html`

**已知风险**：
- `chrome.sidePanel.open()` 在 Chrome 某些版本对"content script 经 `runtime.sendMessage` 触发 → background 调用"是否还算 user gesture 有过历史问题。如果手测发现点 pill 不开 sidepanel，fallback 是把消息存好 + 让用户主动点扩展图标（`setPanelBehavior` 已设）。
- 选区 pill 当前只在 TechCrunch 域名生效（content script `matches` 限定）。其他英文站留到 M3+ 引入"默认适配器"再放开。

---

## Step 0 — Postgres 准备（用户执行）

- [ ] **0.1** 你在 Docker 中已有的 Postgres 容器里创建新 database `english_agent`，不影响已有库
  - 验证：`docker exec -it <你的容器> psql -U <admin> -c '\l'` 输出包含 `english_agent`
- [ ] **0.2** 把最终的 `DATABASE_URL` 告诉我（或在我建出 `server/.env.local` 后由你填入）
  - 验证：`server/.env.local` 中 `DATABASE_URL=postgres://...` 存在且非空

---

## Step 1 — Next.js 16 后端官方 init

- [x] **1.1** ~~在项目根执行 `npx create-next-app@latest server ...`~~ ✓ 完成。生成 `/Users/zilin/side/english-agent/server/`，含 `package.json`、`src/app/page.tsx`、`next.config.ts`、`tsconfig.json`、`postcss.config.mjs`、`eslint.config.mjs`，并自动 `git init`
- [x] **1.2** Next.js 版本 ✓ —— `"next": "16.2.6"`，`"react": "19.2.4"`
- [x] **1.3** `server/.gitignore` ✓ 含 `/node_modules`、`/.next/`；`.env*.local` 默认未列，**Step 11.1 一起处理**

---

## Step 2 — 后端依赖安装

- [x] **2.1** ✓ `ai@^6.0.191`、`@ai-sdk/react@^3.0.193`、`@assistant-ui/react@^0.14.7`、`@assistant-ui/react-ai-sdk@^1.3.26`、`vercel-minimax-ai-provider@^0.0.2`、`zod@^4.4.3` 全装好
- [x] **2.2** ✓ `drizzle-orm@^0.45.2`、`postgres@^3.4.9`
- [x] **2.3** ✓ `drizzle-kit@^0.31.10` 装到 devDeps

**Step 2 验证补丁**：
- `vercel-minimax-ai-provider@0.0.2` 导出的 `minimax` 实际是 Anthropic-format 的 `minimaxAnthropic`（另外还有 `minimaxOpenAI`）；env 变量名确认是 `MINIMAX_API_KEY`
- 该 provider 的 `MinimaxChatModelId` 类型显式列出 `MiniMax-M2 | MiniMax-M2.1 | MiniMax-M2.1-lightning`，没列 `MiniMax-M2.7`（fallback `string` 也接受）。**采用 `MiniMax-M2.1`**，避免用 type 未列的 ID。后续可换到任意 string。

---

## Step 3 — Drizzle 配置与 schema

- [x] **3.1** ✓ `server/drizzle.config.ts` 用官方 `defineConfig`；显式加载 `.env.local`（`dotenv` 已装 dev dep）
- [x] **3.2** ✓ `server/src/db/schema.ts`：`selection_contexts` + `encounter_events`（pgEnum eventType/outcome） + `chat_messages`，并导出 `$inferSelect/$inferInsert` 类型
- [x] **3.3** ✓ `server/src/db/client.ts`：`drizzle(postgres(url))` 单例，`globalThis.__pg` 避免 dev 热重启泄漏
- [x] **3.4** ✓ `server/.env.local`：`DATABASE_URL=`（待填）+ `MINIMAX_API_KEY=`（已填用户提供的开发 key）
- [x] **3.5** ✓ 已在 `fullstack-starter-postgres` 容器（端口 5432）`CREATE DATABASE english_agent`；`server/.env.local` 写好 `DATABASE_URL=postgres://postgres:dev_password_123@localhost:5432/english_agent`；`drizzle-kit push --force` 应用成功；`\dt` 验证三表 + 四个 pgEnum 全部到位

---

## Step 4 — `/api/chat` 路由

- [x] **4.1** ✓ `server/src/lib/minimax.ts` 导出 `minimax = createMinimax({ apiKey })`（Anthropic-format，符合 MiniMax 官方文档推荐）+ `DEFAULT_MODEL_ID = 'MiniMax-M2.1'`
- [x] **4.2** ✓ `server/src/app/api/chat/route.ts`：`streamText` + `await convertToModelMessages`（AI SDK v6 现在返回 Promise）+ `toUIMessageStreamResponse()`；含 `OPTIONS` 处理与 `dynamic = 'force-dynamic'`；PRD §6.1 system prompt 注入选区上下文
- [x] **4.3** ✓ `server/next.config.ts` 仅 dev 期对 `/api/:path*` 注入 `Access-Control-Allow-Origin: *` 等 CORS 头

---

## Step 5 — 后端起服并 smoke test

- [x] **5.1** ✓ `cd server && pnpm exec tsc --noEmit` 退出码 0（首跑发现 `convertToModelMessages` 在 AI SDK v6 改为 async，已 `await`）
- [!] **5.2** 由用户启动 `cd server && pnpm dev`（DATABASE_URL + MINIMAX_API_KEY 都已填好）
- [!] **5.3** 后端起来后 curl smoke test `/api/chat`

---

## Step 6 — Sidepanel entrypoint 文件骨架

- [x] **6.1** ✓ `entrypoints/sidepanel/index.html`
- [x] **6.2** ✓ `entrypoints/sidepanel/main.tsx`（StrictMode + createRoot + import style.css）
- [x] **6.3** ✓ `entrypoints/sidepanel/App.tsx` 占位
- [!] **6.4** 加载 `.output/chrome-mv3` 看到 sidepanel —— 等用户手测。**已经验证 `manifest.json` 含 `side_panel.default_path: sidepanel.html`**

---

## Step 7 — Tailwind + shadcn 接入扩展

- [x] **7.1** ✓ `tailwindcss`、`@tailwindcss/vite` 装到 devDeps
- [x] **7.2** ✓ `@assistant-ui/react`、`@assistant-ui/react-ai-sdk`、`ai`、`@ai-sdk/react` 装到 deps
- [x] **7.3** ✓ `wxt.config.ts` 加 `vite: () => ({ plugins: [tailwindcss()] })`
- [x] **7.4** ✓ `entrypoints/sidepanel/style.css` 由 shadcn 写入 Tailwind v4 完整模板（`@import "tailwindcss"` + 主题变量 + oklch 色板 + layer base）
- [x] **7.5** ✓ shadcn init（用 `--template vite --base radix --preset nova --yes --force`）；首跑因 WXT 不被识别失败 → 临时 stub `vite.config.ts` 让 shadcn 认出 Vite 框架 → init 后删 stub
- [x] **7.6** ✓ `components/assistant-ui/thread.tsx` + 7 个支撑组件（attachment / markdown-text / reasoning / tool-fallback / tool-group / tooltip-icon-button）
- [x] **7.7** ✓ `components/assistant-ui/thread-list.tsx`
- [x] **7.8** ✓ 修了 `tsconfig.json`：显式 `baseUrl: "."` + `paths: { "@/*": ["./*"] }`，shadcn 才会把组件正确写入项目内（首跑因为 WXT 的 `paths: ["../*"]` 来自 `.wxt/tsconfig.json`，shadcn 误解析到 `/Users/zilin/side/components/`；已清理误写文件并重 add）

---

## Step 8 — Sidepanel App 接 assistant-ui

- [x] **8.1** ✓ `entrypoints/sidepanel/App.tsx`：`AssistantRuntimeProvider` + `useChatRuntime({ transport: new DefaultChatTransport({ api: ... }) })`（AI SDK v6 用 transport 不再用 `api` shorthand）+ `<TooltipProvider>` 包裹 + 左边 `<ThreadList/>` + 右边 `<Thread/>`，用 Tailwind grid 布局
- [x] **8.2** ✓ `.env.local` 含 `WXT_BACKEND_URL=http://localhost:3000`
- [!] **8.3** 手测——sidepanel 真正渲染 assistant-ui Thread

---

## Step 9 — Content Script Shadow DOM 骨架

- [x] **9.1** ✓ `entrypoints/content/index.tsx`（迁到目录形式以支持 JSX）：`defineContentScript({ matches: ['*://techcrunch.com/*', '*://*.techcrunch.com/*'], cssInjectionMode: 'ui' })` + `createShadowRootUi({ position: 'overlay', alignment: 'bottom-right', zIndex: 2147483647 })`；React 18+ `createRoot` 在 Shadow DOM 容器里渲染；删了旧的 `entrypoints/content.ts`
- [!] **9.2** 手测——TechCrunch 文章页右下出现 "english-agent: shadow ok"
- [!] **9.3** 手测——DevTools 看 shadow root 样式隔离生效

---

## Step 10 — Background 占位

- [x] **10.1** ✓ `entrypoints/background.ts` 调用 `chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })`，错误用 `.catch` 兜底
- [x] **10.1.1** ✓ 删了 starter `entrypoints/popup/` 与 `assets/`（PRD 未指派职责；popup 存在会让 manifest 写出 `action.default_popup` 拦截图标点击，sidepanel 永远打不开）
- [x] **10.1.2** ✓ `wxt.config.ts` manifest 显式 `action: { default_title: 'English Agent' }`，让工具栏图标存在且可点击触发 sidepanel
- [!] **10.2** 手测——点扩展图标自动开 sidepanel

---

## Step 11 — 环境变量与忽略

- [x] **11.1** ✓ `.gitignore` 已含 `.env.local`、`.env.*.local`、`server/.env.local`、`server/.next`、`server/.turbo`、`server/out`、`server/drizzle/meta`、`.output`、`.wxt`
- [x] **11.2** ✓ Step 8.2 已建

---

## Step 12 — 端到端验证

- [!] **12.1** 等用户：`cd server && pnpm dev` 启动
- [x] **12.2** ✓ `pnpm exec wxt build` 干净；`.output/chrome-mv3/manifest.json` 已生成，含正确 `side_panel.default_path`、`content_scripts`、`background`、`action`、`permissions`
- [!] **12.3** 手测：加载 `.output/chrome-mv3` 到 Chrome
- [!] **12.4** 手测：点扩展图标 → sidepanel → Thread 渲染
- [!] **12.5** 手测：输入"用一句话解释 idempotent" → MiniMax 流式响应
- [!] **12.6** 手测：TechCrunch 文章页看到 shadow 占位泡
- [x] **12.7** ✓ `docker exec fullstack-starter-postgres psql -U postgres english_agent -c '\dt'` 输出 `chat_messages`、`encounter_events`、`selection_contexts` 三表
- [x] **12.8** ✓ 扩展 `pnpm compile` + 后端 `pnpm exec tsc --noEmit` 退出码都 0

---

## 阻塞清单（[!] 汇总）

**等用户操作（按建议顺序）**：

1. **建库**：在你的 Docker postgres 容器里 `CREATE DATABASE english_agent;`
2. **填 env**：把连接串写进 `server/.env.local` 的 `DATABASE_URL=postgres://...`（`MINIMAX_API_KEY` 我已填好你给的开发 key）
3. **建表**：`cd server && pnpm exec drizzle-kit push`
4. **起后端**：`cd server && pnpm dev`（监听 http://localhost:3000）
5. **起扩展**：另开终端 `pnpm dev`（项目根；WXT 会自动开一个干净 Chrome profile 加载扩展）
6. **手测清单**：12.3–12.7（图标点开 sidepanel、与 MiniMax 对话、TechCrunch 页面看到 shadow 泡）

完成 1–5 后，所有 `[!]` 项基本可自验证完成。

## 已知技术注记

- **AI SDK v6** 把 `convertToModelMessages` 改成 async；`useChat`/runtime 也不再用 `api` shorthand，必须显式构造 `DefaultChatTransport`。代码已按此调整。
- **vercel-minimax-ai-provider@0.0.2** 默认走 Anthropic-format 端点 `https://api.minimax.io/anthropic/v1`。如果用户的 `sk-cp-` 开发 key 不对那个端点授权，把 `server/src/lib/minimax.ts` 的 `createMinimax` 换成 `createMinimaxOpenAI`（OpenAI-format，端点 `https://api.minimax.io/v1`）。
- **shadcn 解析 `@/*`** 不走 tsconfig extends 链——它读 project tsconfig 的 `paths` 字段并按 tsconfig 所在目录做相对解析。WXT 默认 `paths` 在 `.wxt/tsconfig.json` 里写 `["../*"]`，被 shadcn 误解析到项目外。**修复**：项目根 `tsconfig.json` 显式覆盖 `paths: { "@/*": ["./*"] }`。
- **popup 删除**：starter popup 的 `manifest.type=browser_action` 让 WXT 写出 `action.default_popup`，会拦截图标点击导致 sidepanel 永远打不开。直接删 `entrypoints/popup/`。
