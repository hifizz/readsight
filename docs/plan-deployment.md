# 部署方案：Singapore VPS + Coolify

## Context

后端（`server/` 下的 Next.js 16）需要从本地 `localhost:4010` 搬到一个常驻的对外地址，让 Chrome 扩展在任何设备/网络下都能用上同一个 backend（翻译、词典、对话）。短语和句子的朗读由扩展在浏览器中通过 `speechSynthesis` 本地处理，不经过后端。

用户给了三个候选：Singapore VPS、Vercel、Cloudflare。**结论是 VPS + Coolify**，两个硬性技术因素直接淘汰了 serverless 路线：

1. **`better-sqlite3` 是原生 Node 模块** —— Cloudflare Workers 的 workerd 运行时直接不支持；Vercel Lambda 能跑但需要正确的 prebuild target，运维成本高
2. **`server/data/ecdict.sqlite` ≈ 100MB** —— 超过 Vercel 单 function 250MB 解压上限的常态空间，且 serverless 无持久磁盘，每次冷启都得从 R2/S3 拉一份；CF 同理需要迁到 D1（大改）

用户的新加坡 VPS（2C2G + 20G SSD + Docker + **Coolify**）实际上正好抹平了选 VPS 的传统痛点 —— Coolify 自带 Traefik 反代、Let's Encrypt 自动 TLS、Postgres 服务、git push 自动部署。等价于"自己的 Vercel"+ 数据驻地在新加坡 = 对中文用户延迟最优。

## 架构

```
┌─────────────────────────────────────────────────┐
│  Coolify 项目: english-agent                     │
│                                                  │
│  ┌────────────────┐    ┌────────────────────┐   │
│  │ Next.js app    │───▶│ Postgres 16        │   │
│  │ (container)    │    │ (Coolify managed)  │   │
│  │                │    └────────────────────┘   │
│  │ /app/data/     │                              │
│  │   ecdict.sqlite│  ← 100MB，镜像内 baked      │
│  └────────────────┘                              │
│         ▲                                        │
│         │ Traefik (TLS 自动)                     │
└─────────│────────────────────────────────────────┘
          │
   https://eag.<your-domain>
          │
   ┌──────┴──────────┐
   │ Chrome 扩展     │   WXT_BACKEND_URL 指向上面
   └─────────────────┘
```

## 关键决策

- **Postgres 走 Coolify 内置 service**，不要外挂 Neon —— 同机 Docker 网络 < 1ms，跨区会多 200ms+
- **ECDICT bake 进镜像**（Dockerfile 里 `COPY data/ecdict.sqlite`），不挂 volume。理由：100MB 静态只读数据，bake 让镜像不可变 / 回滚干净；如果以后 ECDICT 源数据膨胀到几百 MB 再切 volume
- **Drizzle 迁移在容器启动时跑**：entrypoint 里先 `drizzle-kit push`，再 `next start`。`server/package.json` 现在没 db 脚本，需要补一条
- **扩展的 `WXT_BACKEND_URL`**（已经在 `entrypoints/background.ts:23`、`entrypoints/content/index.tsx:22` 等 5 处用作 fallback `http://localhost:4010` 的覆盖）—— prod 打包时设为部署域名

## 实施步骤

### 1. server/ 改造（让 Next.js 能打 Docker 镜像）

- 在 `server/next.config.ts` 加 `output: 'standalone'`，让 build 产物自带最小 runtime（standalone 是 Next.js 16 正式特性）
- 在 `server/package.json` 加：
  ```json
  "db:push": "drizzle-kit push",
  "start:migrate": "drizzle-kit push && next start -p 4010"
  ```

### 2. 写 `server/Dockerfile`（多阶段构建）

模板要点（不逐字照抄，按 Next.js 16 实际 standalone 产物路径调整）：

- **deps 阶段**：`pnpm install --frozen-lockfile`，让 `better-sqlite3` 在 Linux glibc 容器里编译一次
- **build 阶段**：`pnpm build` 产出 `.next/standalone`
- **runtime 阶段**：node:22-slim → 拷 `.next/standalone`、`.next/static`、`public/`、`data/ecdict.sqlite`、`drizzle/` 目录、`package.json`
- entrypoint：先 `pnpm db:push` 再 `node server.js`（standalone 的入口）
- EXPOSE 4010

### 3. Coolify 配置

- 在 Coolify 里 **New Resource → Application → Public Repository**，指向 git repo
- Build Pack: **Dockerfile**，Base Directory: `/server`，Dockerfile Location: `server/Dockerfile`
- 加 Postgres service，自动注入内网 `DATABASE_URL`（形如 `postgres://postgres:xxx@postgres-xxxx:5432/postgres`）
- Environment Variables：
  - `DATABASE_URL` ← Coolify Postgres 自动注入
  - `DEEPSEEK_API_KEY`（必填：`deepseek-v4-pro` 侧栏对话、`deepseek-v4-flash` 词典模型辅助与主翻译）
  - `ZHIPU_API_KEY` / `OPENROUTER_API_KEY` / `OPENROUTER_MODEL` / `TRANSLATE_PRIMARY`（全文翻译 fallback 或路由覆盖）
  - `ECDICT_PATH=/app/data/ecdict.sqlite`
  - `NODE_ENV=production`
- Domains: 绑你自己的子域（如 `eag-api.yourdomain.com`），Coolify 自动签 TLS
- Health Check: `GET /api/known-items` 200 就行（这个端点不用 LLM，瞬响）

### 4. 扩展侧

- `wxt.config.ts` 或 `.env.production` 里设 `WXT_BACKEND_URL=https://eag-api.yourdomain.com`
- `pnpm build` 生产打包后再分发给 Chrome 加载
- 现有代码已经支持环境变量覆盖（5 个文件里都是 `import.meta.env.WXT_BACKEND_URL ?? 'http://localhost:4010'`），零代码改动

## 复用现有代码

- `lib/messaging.ts:23`、`entrypoints/content/index.tsx:22`、`entrypoints/content/translate.tsx`（不用动）—— 所有 backend 调用都走 `WXT_BACKEND_URL` 环境变量
- `server/src/db/schema.ts` 的 6 张表 + enum 定义直接交给 `drizzle-kit push` 推到 Coolify Postgres

## 验证

1. **本地先把 Dockerfile 跑通**：`cd server && docker build -t eag-server . && docker run --rm -p 4010:4010 -e DATABASE_URL=... eag-server` —— 能起来 + ECDICT 能查（`curl localhost:4010/api/lookup?word=hello`）
2. **Coolify deploy 成功后**：
   - `curl https://eag-api.yourdomain.com/api/known-items` → 200
   - `curl -X POST https://eag-api.yourdomain.com/api/translate -H 'content-type: application/json' -d '{"blocks":[{"id":"t1","text":"Hello world."}]}'` → 翻译结果回来
3. **扩展端**：在 `wxt.config.ts` 设环境变量后 `pnpm build`，重装扩展，在任意英文页测翻译 / 划词 Dialog / FAB —— 走 Coolify 域名而非 localhost
4. **数据库迁移成功**：进 Coolify Postgres console `\dt readsight.*` 看到 6 张业务表；`readsight_migrations` 仅保存本项目迁移记录

## 显式不做

- **不上 CDN**：100MB ECDICT 在镜像里、静态资源由 Next.js 自身处理，扩展用户量级用不上
- **不做 auto-scale / 高可用**：MVP / 个人 dogfood，单容器够
- **不迁 ECDICT 到 Postgres**：bake 进镜像更省心；只有规模化分发时再考虑
- **不上 Vercel Pro / CF Workers**：两个硬性 blocker 决定了不值得

## 何时考虑迁移

- ECDICT 数据膨胀到 > 500MB（迁到 Coolify volume 或 Postgres）
- 单实例顶不住流量（同一 Coolify 项目里加 replica，前面挂 Traefik load balance）
- 用户跨多区（再考虑 CF + 把后端拆分：纯 LLM 代理走 Workers，词典 / DB 仍留 VPS）
