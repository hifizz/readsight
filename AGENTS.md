# Relata 项目目标与 Roadmap

本文档用于帮助在本仓库中工作的 Agent 理解产品方向、已确认的领域约束和优先级。具体需求与验收标准以对应的 OpenSpec artifacts 为准；如果实现与本文档出现偏差，应先确认产品决策并同步更新文档，不要自行改变核心模型。

## 产品目标

Relata 是一个以 Project 为中心的个人研究与上下文工作空间。它不是普通的书签或稍后阅读工具，也不以“收藏更多链接”为目标，而是帮助用户把发现的内容连接到正在推进的工作中。

产品标语：**Connect what you discover to what you're working on.**

核心闭环：

```text
Capture → Understand → Relate → Resurface → Think → Act
```

- Capture：低摩擦保存当前标签页或多个标签页，并保留当时的 Intent。
- Understand：解析网页 metadata，并通过 AI 生成可追溯的理解和分析结果。
- Relate：将 Source 与一个或多个 Project 建立关系。
- Resurface：在合适的 Project、搜索结果或工作上下文中重新呈现相关内容。
- Think：围绕 Source、Project 和历史分析继续对话与推理。
- Act：把结论沉淀为 Project 文档、任务或后续工具操作。

Chrome Extension 是 Relata 的捕获入口和上下文伴侣，Side Panel 是当前主要交互界面。

## 已确认的领域约束

- 顶层品牌仅使用 **Relata**；旧项目的品牌、中文名称、数据和业务逻辑均不继承。
- 当前只有 Project，不引入 Workspace；数据模型和边界应为未来增加 Workspace 留出空间。
- Project 包含名称和 description。description 用于描述 Project 的目标与范围，也是 AI 判断 Source 是否相关的重要上下文。
- 一个 Source 可以不属于任何 Project，也可以属于多个 Project；不存在 Primary Project。
- Inbox 不是特殊 Project，而是“尚未关联任何 Project 的 Source”的派生视图。
- Inbox 默认显示今天保存的内容，并支持低干扰的时间范围筛选。
- 同一用户的相同 canonical URL 只保留一个 Source；每次保存都追加一条 Capture，以保留时间、入口和 Intent 历史。
- Intent 是用户保存时的原始上下文，允许为空，不要求用户预先分类，也不能被 AI 输出覆盖。
- AI 分析结果必须保留历史版本，并能支持后续基于既有上下文继续对话。
- 第一版不持久化完整网页正文；可以在处理期间临时提取内容，但持久化的是 metadata、分析结果和版本历史。
- Topic 与 Entity 第一阶段可以作为分析结果的一部分保存，暂不要求规范化为独立实体。
- 向量搜索和 embedding 后置，优先完成可验证的关键词与全文搜索。
- Chrome 最低版本以支持多选标签页右键菜单的版本为准，当前目标为 Chrome 150。
- 现有用户系统、Session、配额和用户隔离能力可以复用；旧翻译、查词、学习记录等逻辑不属于 Relata。
- 所有旧 Storage Key 使用 Relata 命名空间，不兼容或迁移旧项目数据。

## 产品与界面原则

- 使用紧凑的 SaaS 信息密度，参考 Chrome Reading List 的列表体验。
- 使用小字号、清晰层级和低干扰操作，避免用多层 Card 充当布局容器。
- Project 使用列表形态；默认不展示内部链接，点击 Project 后再展开其 Source 列表。
- Source 列表项整体可点击并在新标签页打开，保持与 Chrome Reading List 一致；菜单、选择和删除等交互必须阻止冒泡并保持独立。
- 保存当前链接、创建 Project、AI 建议等流程必须提供明确的取消、关闭、重试或撤回出口。
- 登录态位于右上角，以用户头像作为入口，更多账户操作在点击后展开。
- Extension header 不重复展示品牌名和 slogan；slogan 放在插件 description 中。
- 当前视觉方向使用绿色；正式图标后续单独设计。
- 优先复用 shadcn/ui，并保持组件小而专一。入口组件只负责组合，状态和业务逻辑应拆入 hooks、services 或领域组件，避免重复实现。

## 当前基线

以下能力已经构成后续开发的基础，不应在新增功能时回退：

- Relata 品牌、存储命名空间和数据库 schema。
- 登录、Session、配额以及按用户隔离的数据访问。
- 保存当前标签页和多选标签页。
- canonical URL 去重、Capture 历史和可选 Intent。
- Source 与多个 Project 的手动关联。
- Inbox 派生视图和时间范围筛选。
- 紧凑型 Side Panel、Project 列表和可展开的 Source 列表。
- 可版本化的 AI analysis、Project insight 和 conversation 数据结构。

## Roadmap

### Phase 1：自动处理与 Project 匹配建议

这是当前优先级最高的产品能力。

- 保存链接后解析网页的 `title`、`description`、favicon 等 metadata，并写入 Source metadata。
- 保存操作必须快速返回；解析和模型匹配放在可观察、可重试的后台流程中执行。
- 模型结合 Source 的 title、description、可用的 Intent，以及 Project 的名称和 description 计算匹配关系。
- 不自动建立 Project 关系。在刚保存的 Inbox item 正下方显示浅色、紧凑的建议面板。
- 建议面板支持一键确认推荐关系、手动选择一个或多个 Project、取消或暂时忽略。
- 确认后创建 Source–Project membership；Source 因已有 Project 关系而自然离开 Inbox。
- 明确处理 `queued`、`extracting`、`matching`、`suggested`、`no_match`、`failed` 等状态，并提供幂等、重试和失败恢复能力。
- 后台任务、模型输入和结果必须遵守用户隔离与配额边界。

### Phase 2：自动理解与可继续对话的分析历史

- 在 metadata 流程稳定后增加网页内容的临时提取与自动分析。
- 生成摘要、关键主题、实体和 “Why it matters”等结构化结果。
- 每次重新分析产生新版本，不覆盖历史结果。
- 对话能够引用已有 Source、Project 和 analysis 版本，继续推理而不是从零开始。
- 内容提取失败时保留 metadata 降级路径，并允许重试。

### Phase 3：Intent 与当前页面上下文

- 支持查看和编辑 Source 的 Capture/Intent 历史，同时保留原始记录与变更边界。
- 清晰区分用户 Intent 与 AI interpretation。
- Side Panel 能识别当前页面是否已经保存、属于哪些 Project，以及是否存在待确认建议。
- 围绕当前页面提供轻量的补充 Intent、重新分析和继续对话入口。

### Phase 4：检索、关联与重新浮现

- 先实现覆盖 Source、Intent、Summary、Insight、Project、Topic、Entity 和 Thread 的关键词/全文搜索。
- 基于已有结构化信息发现 Related Sources 和跨 Project 的关联。
- 在 Project 和当前工作上下文中重新呈现相关历史内容。
- 在真实检索需求和数据规模得到验证后，再引入 embedding 与向量搜索。

### Future：沉淀与执行

以下方向已被认可，但不属于近期默认实现范围：

- Project Documents，以及把对话结论保存到 Project 文档的工具。
- 外部工具执行，例如创建任务或 GitHub Issue。
- Action candidate、长期 Memory 和主动式 resurfacing。
- Topic/Entity 的规范化知识图谱。
- Source 和 Project 的自定义排序。
- Chrome Reading List 导入或同步。
- 选中文本、高亮和局部内容捕获。
- Workspace、多成员协作与权限模型。
- iOS Share Extension、macOS worker 和更复杂的本地 Agent 能力。
- 针对视频、PDF、播客等媒介的专用提取器。

## 工程架构

Relata 当前由两个独立运行、共享契约的应用组成：

```text
Chrome Extension（WXT + React）
  ├─ Side Panel：主要 UI、交互和客户端状态
  ├─ Background：Chrome 生命周期、右键菜单、多标签页捕获
  └─ Shared lib：认证、Source 保存契约和通用工具
                 │
                 │ HTTPS / JSON API + Better Auth Session
                 ▼
Web Server（Next.js App Router）
  ├─ API Routes：认证、输入校验、资源所有权和业务事务
  ├─ Domain lib：URL 规范化、配额、AI 和 HTTP helpers
  └─ Drizzle ORM
                 │
                 ▼
PostgreSQL `relata` schema
```

边界规则：

- Extension 是受信任程度较低的客户端，只负责获取浏览器上下文、展示状态和发起请求；业务授权与数据完整性不能只在 Extension 中保证。
- Server 是业务规则的最终执行者。身份校验、资源归属、配额、URL 去重和跨表写入必须在 Server 完成。
- PostgreSQL 是持久化事实来源；Zustand 只保存当前 Side Panel 会话的客户端快照，不作为离线数据库使用。
- Background 与 Side Panel 通过明确的 Chrome runtime message 通信，消息必须有稳定的 `type` 和可序列化 payload。
- Extension 与 Server 共享的是 API 契约，而不是直接 import Server 源码。契约变化时，两端必须同步修改并验证。

## 目录结构与职责

```text
.
├─ entrypoints/                 # WXT Extension 入口
│  ├─ background.ts             # Chrome API、右键菜单、多标签捕获和消息派发
│  ├─ content/                  # 仅用于确有必要的页面上下文读取
│  └─ sidepanel/
│     ├─ App.tsx                # 认证状态与顶层页面切换，只做组合
│     ├─ RelataHome.tsx         # 已登录主界面的编排层
│     ├─ components/            # Side Panel 领域组件
│     ├─ use-library-data.ts    # 数据加载、派生集合和远程状态协调
│     ├─ library-store.ts       # Zustand 客户端快照与同步更新
│     ├─ types.ts               # Side Panel API/view model 类型
│     └─ utils.ts               # Side Panel 纯函数
├─ components/ui/              # shadcn/ui 基础组件，不放产品业务逻辑
├─ lib/                        # Extension 跨入口共享的认证、保存契约和工具
├─ server/                     # 独立 Next.js 应用
│  ├─ src/app/api/             # Route Handlers；按资源组织 REST API
│  ├─ src/db/schema.ts         # Drizzle schema，数据库模型唯一代码来源
│  ├─ src/lib/                 # Server 领域服务与纯函数
│  └─ drizzle/                 # 生成的 SQL migration 与 metadata
├─ openspec/                   # 产品 change、spec、design 和 tasks
├─ docs/adr/                   # 跨 change、长期有效的架构决策
└─ docs/archive/               # 已失效或仅供追溯的旧文档
```

代码放置原则：

- Chrome 生命周期和特权 API 只能放在 WXT entrypoint 或由 entrypoint 调用的 Extension 模块中。
- 可复用的无业务 UI 放在 `components/ui`；与 Source、Project、Analysis 等概念相关的组件放在 `entrypoints/sidepanel/components`。
- API Route 保持为薄适配层：解析请求、认证、调用领域函数、映射响应。可复用业务逻辑放入 `server/src/lib`。
- 数据表、索引、约束和关系只在 `server/src/db/schema.ts` 定义；不要在 Route 中用字符串重复表达 schema 规则。
- 跨多个 change 仍长期有效的技术选择写入 ADR；单个 change 的范围和验收条件写入 OpenSpec。

## 核心数据模型

```text
User
 ├─ Project ──< ProjectSource >── Source ──< Capture
 │                                │
 │                                └──< AnalysisRun ── SourceAnalysis (versioned)
 │                                                     │
 ├──────────────────────── ProjectInsight (versioned) ┘
 │
 └─ Thread ──< Message
      ├─ optional Project context
      └─ optional Source context
```

- `projects`：用户定义的工作上下文和范围。
- `sources`：按 `(user_id, url_key)` 去重的 canonical 内容对象。
- `project_sources`：Project 与 Source 的多对多关系；包含未来排序所需的 `sort_order`，但当前不定义排序体验。
- `captures`：每次保存行为及当时 Intent 的历史。不要把多次保存折叠为只更新 Source。
- `analysis_runs`：一次可追踪的处理尝试，承载状态、模型、prompt 版本、输入 fingerprint 和错误信息。
- `source_analyses`：不可变、按版本追加的 Source 理解结果。
- `project_insights`：同一个 Source 在特定 Project 上下文中的版本化意义，不等同于通用摘要。
- `threads/messages`：围绕 Source 或 Project 的持久化对话；Message 可以引用产生它时使用的 analysis/insight 版本。

所有领域表都必须包含或能可靠推导 `user_id`。跨用户关联除应用层校验外，还应尽可能由复合外键或数据库约束阻止。

## 关键数据流

### 保存 Source

```text
tab/context menu
  → sourceItemFromTab
  → POST /api/sources（批量、逐项返回结果）
  → Server canonicalize URL
  → upsert Source + append Capture + update memberships
  → Side Panel applySaveResults
  → 后台 metadata / AI pipeline（后续阶段）
```

- 批量保存允许部分成功，响应必须保留 `clientRequestId` 以便客户端逐项对应。
- URL 规范化逻辑只维护一套服务端事实实现，并用单元测试覆盖；客户端只做可保存协议的快速筛选。
- 重复 URL 不创建第二个 Source，但必须保留新的 Capture。
- 保存成功后优先局部更新 Zustand；需要恢复一致性时再重新拉取 Server snapshot。

### 加载与更新 Side Panel

```text
App auth gate
  → RelataHome
  → useLibraryData 并行加载 Projects/Sources
  → library-store 保存快照
  → selectors 派生 Inbox / Project Sources / Pinned
  → 领域组件渲染与提交 mutation
```

- 远程请求和派生集合集中在 hook/store 层，展示组件不重复 fetch 或维护第二份 Server state。
- mutation 成功后通过明确的 store action 更新；失败时保留可恢复的 UI，并向用户显示可操作错误。
- Inbox 必须由 `projectIds.length === 0` 派生，禁止维护独立 Inbox membership。

## API 设计规范

- API 位于 `server/src/app/api`，使用 JSON 和语义明确的 HTTP status。
- 每个受保护 Route 入口统一调用认证 helper；查询和 mutation 都必须以当前 `user.id` 作为过滤条件。
- 使用 Zod 或等价的显式 schema 校验外部输入。不要把 `request.json()` 的结果直接交给数据库。
- 客户端可重试的批量接口应设计幂等键或稳定的 request identifier。
- 错误响应包含稳定的机器码和简短的用户可读 message；不要把数据库、模型或 stack trace 泄露给 Extension。
- 删除 Project 只删除关系并让无 Project 的 Source 回到 Inbox；除非接口明确请求，否则不能连带删除 Source。
- AI 请求必须执行用户级配额检查，并记录模型、prompt version、fingerprint 和状态，禁止只返回一次性文本。

## 编码与组件规范

- 使用 TypeScript strict 类型，避免 `any`；不得不用窄范围类型转换时，必须用注释说明平台类型缺口。
- 优先使用命名清楚的小函数和早返回。纯计算与 I/O 分离，使 URL、筛选和状态转换可以独立测试。
- 保持 DRY，但不要为了消除两行相似代码提前创建抽象；只有语义相同、会共同变化的逻辑才共享。
- React component 负责渲染与局部交互；跨组件业务状态放入 Zustand 或 custom hook，临时表单状态保留在最近的组件。
- 不在 `useEffect` 中复制可以通过 selector 或 `useMemo` 派生的状态。
- Dialog、Popover、Dropdown 内部提交必须覆盖 loading、disabled、cancel 和 error 状态。
- 列表必须使用稳定数据库 id 作为 key；不得使用数组下标表示可变的 Source 或 Project。
- 基础样式使用 Tailwind 与现有 design tokens，条件 class 使用 `cn()`；不要引入第二套 CSS-in-JS 或组件库。
- shadcn/ui 文件保持基础组件性质。产品定制优先通过组合和 `className` 完成，避免把 Relata 业务写入基础组件。
- 用户可见文案使用中文；代码标识符、API 字段和通用专业术语可保留英文。错误文案应描述用户能采取的下一步。
- 注释解释“为什么”和平台限制，不复述代码。Chrome Reading List 对齐、Chrome 版本能力等非显然决策需要保留原因。

## 数据库与迁移规范

- 所有表位于 PostgreSQL `relata` schema；不要使用默认 `public` schema 承载 Relata 领域数据。
- 时间字段使用带时区 timestamp，服务端存 UTC，展示层按用户或浏览器本地时区计算范围。
- 多租户唯一键应包含 `user_id`；高频用户范围查询必须有以 `user_id` 开头的适当索引。
- 状态使用 text + check constraint 时，新增状态必须同时更新数据库约束、Server 类型和客户端状态展示。
- 本地开发允许使用 `pnpm --dir server db:push` 快速验证；需要提交和可追溯部署时生成并检查 Drizzle migration。
- schema 改动后至少验证现有 API、约束、索引以及 cascade 行为，不能只确认 TypeScript 编译通过。

## 设计决策记录

- ADR 记录长期且跨功能的架构决定，包括现状、决策、原因、替代方案和后果。
- 已确认但暂缓的 Workspace 必须继续作为 ADR 中的扩展边界，不能提前引入空表或无实际用途的抽象。
- OpenSpec design 负责某个 change 内的实现设计；完成或归档 change 后，仍需长期约束工程的结论应提炼到 ADR 或本文档。
- 代码与 ADR 冲突时不能默默选择一方：先检查是实现漂移还是决策已经改变，再更新相应事实来源。

## 工程约束

- 新功能或领域模型变更应先检查 `openspec/changes`，并以相关 proposal、design、spec 和 tasks 为实施依据。
- API、Server Action 和后台任务必须在服务端验证身份、资源所有权和用户隔离，不能依赖客户端传入的 user id。
- 后台处理必须可观察、可重试、幂等；不要让模型调用阻塞核心保存路径。
- 用户输入、AI 输出和系统状态应使用不同字段或实体表达，避免来源混淆。
- 不迁移旧项目数据，不为旧功能保留兼容分支，除非新的 OpenSpec 明确要求。
- 修改前检查工作区状态，保留用户已有改动，不覆盖无关文件。
- 对 Side Panel 或 Web UI 的浏览器交互、localhost 测试和截图，必须遵循仓库规则使用 `ego-browser nodejs` 工作流。
- 完成改动后执行与范围相称的 typecheck、lint、build 和测试；数据库 schema 变更在本地 PostgreSQL 环境可使用 `db:push` 验证。

## Roadmap 使用方式

- Roadmap 表示产品优先级，不代表所有条目已经形成可直接实现的需求。
- 开始一个 Phase 前，应把该阶段拆成独立、可验收的 OpenSpec change；不要在一个 change 中一次性实现整条 Roadmap。
- 发现新的设计决策、范围变化或假设失效时，应更新对应 artifact，而不是只在代码注释或聊天中记录。
- 未列入当前 Phase 的 Future 项目默认视为暂缓，不应顺手实现。
