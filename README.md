# Relata

> Connect what you discover to what you're working on.

Relata 是一个 Chrome Side Panel 扩展：把当前网页保存为 Source，将其关联到多个
Project，并在后续版本中让 AI 将这些发现转化为可持续的项目语境。

## 本地开发

1. 在 [`server/`](./server) 配置 `DATABASE_URL`、`BETTER_AUTH_SECRET` 和
   `BETTER_AUTH_URL`；可参考现有 `.env.local` 文件，不要提交真实凭证。
2. 启动本地 PostgreSQL 后，执行：

   ```bash
   pnpm --dir server db:push
   pnpm --dir server dev
   ```

3. 在仓库根目录执行 `pnpm dev`，然后将 WXT 输出目录中的 unpacked extension 加载到
   Chrome。

## 验证

```bash
pnpm compile
pnpm build
pnpm --dir server lint
pnpm --dir server exec tsc --noEmit
pnpm --dir server build
```

`docs/archive/readsight-legacy/` 与 `openspec/**/archive/readsight-legacy/` 只保留历史资料，
不属于 Relata 的规范或实现依据。

曼谷 OpenShip 生产环境、数据迁移及日常查询入口见
[`docs/operations-bangkok.md`](./docs/operations-bangkok.md)。
