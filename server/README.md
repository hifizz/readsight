# Relata Server

Relata 的 Next.js API 服务，负责 Better Auth、Relata domain data、配额和 AI 调用。

## 环境变量

```dotenv
DATABASE_URL=postgres://...
BETTER_AUTH_SECRET=at-least-32-characters
BETTER_AUTH_URL=http://localhost:4010
AUTH_TRUSTED_ORIGINS=chrome-extension://<extension-id>
```

本地开发可额外设置 `AUTH_TRUSTED_ORIGINS`。不要记录、提交或输出密码、bearer token、完整
Authorization header 与页面正文。

## 命令

```bash
pnpm db:push    # 把 Drizzle schema 直接同步到本地 PostgreSQL
pnpm dev        # 运行在 http://localhost:4010
pnpm lint
pnpm exec tsc --noEmit
pnpm build
```

数据库对象位于 PostgreSQL 的 `relata` schema；`drizzle-kit push` 的内部 migration metadata
使用 `relata_migrations`。Relata 是全新产品，不迁移或依赖旧 Readsight 数据。

## Source 保存 API

`POST /api/sources` 接受独立处理的批量 items。URL 使用 Chrome 提供的完整序列化值作为 key；省略 `memo` 或 `projectIds` 会保留已有状态，`memo: null` 明确删除 Memo，`projectIds: []` 明确移回 Inbox。

```json
{"items":[{"clientRequestId":"request-id","url":"https://example.com/article#notes","memo":"稍后用于项目背景","projectIds":[]}]}
```

`PATCH /api/sources/:id` 更新 Memo 或 Pin。Source list/detail 返回 `memo`、`pinnedAt`、`addedAt` 和 Project metadata，不返回保存历史。
