<p align="center"><img src="public/icon/128.png" width="96" alt="Readsight logo" /></p>

<h1 align="center">见微 Readsight</h1>

<p align="center"><a href="README.md">English</a> · <strong>简体中文</strong></p>

> 沉浸式英语精读的 Chrome 扩展 —— 全文双语对照翻译、划词精读配 AI 导师侧栏，并把你遇到的每个词都沉淀成结构化学习记录。

见微面向的是"能看懂大部分英文文章、却总被个别词 / 短语 / 句构卡住"的读者。原文永远在正中央：译文叠在每段下方，解释只在你开口时出现。它不是词典悬浮窗，也不是整页替换式翻译器 —— Side Panel 里的 LLM 是导师：它能读到你所选的句子和段落，讲的是"这个词在这里的用法"，而不是复述词典词条。每次查询和对话都会落成结构化的 encounter event，为将来的间隔重复复习模型（FSRS）备好数据。

## 功能

| 模块 | 内容 |
| --- | --- |
| 全文双语翻译 | 悬浮按钮 / 右键菜单 / `Alt+T`；Readability 正文识别 + 宽松 page 模式兜底；视口驱动渐进翻译；`<code>` 等内联标识符不翻译；一键撤销；暗色模式自适应 |
| 划词精读 | 划选词 / 短语 / 句子 → 出现 pill → Side Panel 打开并钉住该语境；单词卡含 IPA、发音、英中释义；每次选区开新 thread |
| 语境感知对话 | 导师 prompt 注入所在句子与段落，按选区类型分支 —— 讲"在这里的特殊用法"还是"通用用法" |
| 学习记录 | 每次查询 / 对话自动落库为 encounter event；浏览时被动重逢检测；Records 标签页可跳回原文并高亮 |
| 账号与隐私 | 邮箱密码登录；学习数据按账号隔离；每用户每日配额；翻译缓存全局共享、内容寻址 |
| 朗读 | 句子 / 短语用本地 `speechSynthesis`（en-US）—— 无云端 TTS |

## 使用

1. **翻译整页** —— 打开任意英文文章，点悬浮按钮（或 `Alt+T`、右键 → 翻译）。中文随滚动逐段出现在原文下方；滚动加载的新内容也会续翻。
2. **精读选区** —— 划选一个词或短语，点上方出现的 pill。Side Panel 随即打开：一张词典卡，加一个已经知道你在哪个句子里的对话线程。
3. **复习** —— Side Panel 的 Records 标签页列出你查过的一切：遭遇次数、最近时间，以及跳回原文的链接。

## 安装

尚未上架商店 —— 从源码构建。你需要一个后端地址（按下文自建，或已有实例）。

### 扩展

```bash
pnpm install
WXT_BACKEND_URL=https://your-api.example.com pnpm build
# 然后在 chrome://extensions 以"加载已解压的扩展程序"载入 .output/chrome-mv3
```

不带变量的 `pnpm dev` 会构建指向 `http://localhost:4010` 的开发包。

### 后端（自托管）

需要 Node 20+、`pnpm`（`server/` 钉死 10.x）、一个 PostgreSQL 库和 DeepSeek API key。

```bash
cd server
pnpm install

# server/.env.local
# DATABASE_URL=postgres://...
# DEEPSEEK_API_KEY=...        （必填）
# ZHIPU_API_KEY=...           （可选兜底）
# OPENROUTER_API_KEY=...      （可选兜底）

pnpm db:push     # 在 "readsight" schema 建表
pnpm dev         # http://localhost:4010
```

可选：把 ECDICT 词典（约 100 MB、77 万词）放到 `server/data/ecdict.sqlite`，词典查询秒回；没有它也能跑，lookup 管线会优雅降级到 Free Dictionary + LLM。生产部署（Coolify、TLS、备份、配额）见 [docs/deploy-vps.md](docs/deploy-vps.md)。

## 配置

| 变量 | 位置 | 含义 |
| --- | --- | --- |
| `WXT_BACKEND_URL` | 扩展构建 | 打进包里的 API 基地址 |
| `DATABASE_URL` | server | PostgreSQL 连接串（业务表在 `readsight` schema） |
| `DEEPSEEK_API_KEY` | server | 必填 —— 驱动对话、翻译与词典辅助 |
| `ZHIPU_API_KEY` / `OPENROUTER_API_KEY` | server | 翻译兜底（Zhipu GLM-4-Flash → OpenRouter） |
| `TRANSLATE_PRIMARY` | server | 调整兜底链顺序（`deepseek` \| `zhipu` \| `openrouter`） |
| `BETTER_AUTH_SECRET` / `BETTER_AUTH_URL` | server | 会话签名与对外 URL |
| `AUTH_TRUSTED_ORIGINS` | server | 允许登录的 `chrome-extension://<id>` 来源，逗号分隔 |
| `DAILY_CHAT_REQUESTS` / `DAILY_TRANSLATION_CHARACTERS` / `DAILY_LOOKUP_REQUESTS` | server | 每用户每日配额（默认 50 / 20 万 / 500） |
| `CORS_ALLOW_ORIGIN` | server | 把默认的 `*` 收紧到你的扩展来源 |

## 模型路由

| 任务 | 模型 |
| --- | --- |
| Side Panel / 语境对话 | DeepSeek `deepseek-v4-pro` |
| 全文翻译、词典辅助 | DeepSeek `deepseek-v4-flash` |
| 翻译兜底链 | DeepSeek → Zhipu GLM-4-Flash → OpenRouter |

所有绑定均禁用 thinking；重复段落由 Postgres 内容寻址缓存秒回（`sha256(namespace|lang|text)`）。

## 注意事项

- **必须登录** —— 认证上线之前的旧扩展构建访问新后端会收到 `401`。
- 账号仅支持邮箱 + 密码：本版无邮箱验证，也没有忘记密码 / 改密码。
- 翻译 / 词典缓存跨用户全局共享（相同英文文本只存一条）。它只存翻译内容；学习记录按账号隔离。
- 目前只支持英 → 中。朗读音色取决于浏览器 / 系统语音。
- 加载未打包的扩展会得到随机扩展 ID —— 需要加进后端的 `AUTH_TRUSTED_ORIGINS` 白名单。

## 文档

- [PRD.md](PRD.md) —— 产品需求
- [docs/PROJECT_STATUS.md](docs/PROJECT_STATUS.md) —— 架构决策与里程碑状态
- [docs/deploy-vps.md](docs/deploy-vps.md) —— 生产部署 runbook（Coolify）
- [docs/plan-deployment.md](docs/plan-deployment.md) —— 部署规划笔记
- [openspec/](openspec/) —— 变更规格（认证、数据隔离、配额）

## 开发

```bash
pnpm dev          # 扩展开发模式
pnpm compile      # 类型检查
pnpm build        # 生产构建 → .output/chrome-mv3

cd server && pnpm dev              # 后端 :4010
cd server && pnpm exec tsc --noEmit
```

用 Playwright 加载未打包扩展复现线上 bug —— 配方见 [CLAUDE.md](CLAUDE.md)。

## 状态

M1（划词精读）、M2（学习记录）、M3（全文双语翻译）已上线。M4 —— 基于 FSRS 的复习调度、复习卡片、推送提醒 —— 尚未开始；它需要的 encounter event 数据流已在持续记录。
