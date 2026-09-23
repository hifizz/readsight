# Relata 曼谷生产环境交接记录

最后核对：2026-09-23。这里记录当前部署的事实和常用的只读操作；项目方向与代码约束仍以 [AGENTS.md](../AGENTS.md)、[README.md](../README.md) 和 OpenSpec 为准。服务 ID、部署 ID 和数据量是当时的快照，操作前应重新查询。

## 先看这些

| 项目 | 当前情况 |
| --- | --- |
| 仓库 | `git@github.com:hifizz/english-chrome-plugin.git`；仓库名沿用旧名，产品是 Relata |
| 代码基线 | `origin/main` 与本地 `codex/relata-foundation-planning` 当时均为 `5534399`；本地工作区当时干净 |
| 组成 | 根目录是 WXT + React Chrome Extension；`server/` 是 Next.js API + Better Auth + Drizzle |
| 正式入口 | `https://relata.zilin.im`，DNS 指向曼谷 VPS；OpenShip 管理路由和 TLS |
| Relata OpenShip 项目 | `proj_soySczYAlKwDYjaY`；当时活动部署 `dep_Mqzu7BBYlcqxSd_7`，项目 `ready`、容器 `running` |
| PostgreSQL OpenShip 项目 | `proj_vdKU0TmwVL-zLsup`，服务 `svc_xxoj38CskEJRYhV3`；与 ThreadChat 共用实例 |
| 数据隔离 | Relata 使用独立 database `relata`、数据库角色 `relata_app`、schema `relata`；ThreadChat 使用另一个 database `thread_chatbot`、角色 `thread_chatbot_app` |
| 运维入口 | 本机 `openship` CLI；SSH 别名 `bangkok-vps`；PostgreSQL 容器 `openship-infra-postgresql-postgres` |

OpenShip 中该 Relata 项目当时 `autoDeploy=false`，提交或合并 Git 代码不会自动更新线上容器。服务配置在 [`server/openship.json`](../server/openship.json)，启动命令是 `pnpm db:migrate && pnpm start`；迁移脚本在 [`server/scripts/migrate.mjs`](../server/scripts/migrate.mjs)，使用 `relata_migrations` 记录迁移。代码中的领域表均在 PostgreSQL `relata` schema。

当前 OpenShip 项目未绑定 Git 仓库，活动部署也没有 commit SHA；后续 Server 发布需在确认工作区内容与测试结果后，从 `server/` 手动触发：

```bash
cd server
openship deploy --project proj_soySczYAlKwDYjaY --watch
```

Extension 是单独打包的客户端，不随 Server 发布命令更新。

## 本次部署与数据迁移

1. 将 Relata Server 部署到 OpenShip 曼谷 VPS，绑定 `relata.zilin.im`。复用既有 PostgreSQL **实例**，另建 Relata database 和角色，没有把数据写进 ThreadChat database。
2. Extension 的后端地址由构建时的 `WXT_BACKEND_URL` 注入；[`wxt.config.ts`](../wxt.config.ts) 据此生成 `host_permissions`，[`lib/source-saving.ts`](../lib/source-saving.ts) 据此请求 API。未传变量时默认 `http://localhost:4010`。正式插件打包需使用：

   ```bash
   WXT_BACKEND_URL=https://relata.zilin.im pnpm zip
   ```

3. 首次部署连接的是空的独立 Relata database，所以本地旧账户最初不能在线上登录。随后将本机 PostgreSQL `thread-chat` database 内的 `relata` schema 业务数据导入线上 `relata` database。
4. 导入了 12 张业务表：`user`、`account`、`projects`、`sources`、`daily_usage`、`analysis_runs`、`project_sources`、`source_analyses`、`project_insights`、`threads`、`messages`、`verification`。`account` 中的密码哈希原样保留；没有传输明文密码。`session` 与 `rate_limit` 是运行态表，没有搬迁旧会话或覆盖线上限流记录。
5. 导入前对本地与线上分别做了 `pg_dump -Fc` 备份；先在事务内试导入并回滚，确认无约束错误后再正式提交。12 张业务表的行数和内容指纹均一致。迁移完成时有 8 个用户、8 个凭证账户、26 个 Project、182 个 Source；线上迁移记录 3 条。用户随后确认已用原账号密码在线上登录。

本机导入前备份暂存于 `/private/tmp/relata-import.Bq5w0p/`，目录权限 `700`、dump 权限 `600`。这是临时目录，可能被系统清理，不应视为长期备份。不要提交或分享 dump、`.env*`、数据库连接串、密码哈希、session token 或原始日志。

## 下次接手的检查顺序

在仓库根目录运行：

```bash
git status --short --branch
git log -1 --oneline --decorate
git fetch origin
git log -1 --oneline origin/main

openship status
openship --json project get proj_soySczYAlKwDYjaY \
  | jq '{id, name, enabled, autoDeploy, activeDeploymentId, activeDeploymentStatus}'
openship --json project get proj_vdKU0TmwVL-zLsup \
  | jq '{id, name, enabled, activeDeploymentId, activeDeploymentStatus}'
```

用第一条 OpenShip 查询得到的最新 `activeDeploymentId` 检查容器；不要长期沿用上表的部署 ID：

```bash
deployment_id="$(openship --json project get proj_soySczYAlKwDYjaY | jq -r .activeDeploymentId)"
openship --json deployment info "$deployment_id" | jq '{status, uptimeSeconds, hostPort}'
openship deployment list --project proj_soySczYAlKwDYjaY --limit 10
```

## 日志

```bash
# Next.js 容器运行日志
openship project logs --tail 200 proj_soySczYAlKwDYjaY

# OpenShip 边缘代理的 HTTP 请求日志
openship project server-logs --limit 100 --domain relata.zilin.im proj_soySczYAlKwDYjaY

# 当前或指定部署的构建/部署日志
openship logs --tail 200 "$deployment_id"

# 共享 PostgreSQL 服务日志
openship service logs --tail 100 -p proj_vdKU0TmwVL-zLsup svc_xxoj38CskEJRYhV3
```

排查登录失败时，先看请求日志中的状态码，再看同一时段的 Server 日志与数据库账户数量。日志可能含个人数据或 token，分析时只摘取必要的错误码、时间和脱敏后的上下文。

## 数据查询与拉取

从本机经 SSH 在生产库执行只读 SQL，无需把数据库密码放进命令或聊天：

```bash
ssh -o BatchMode=yes bangkok-vps \
  'docker exec -i openship-infra-postgresql-postgres psql -X -v ON_ERROR_STOP=1 -U postgres -d relata' <<'SQL'
SELECT
  (SELECT count(*) FROM relata."user") AS users,
  (SELECT count(*) FROM relata.account) AS accounts,
  (SELECT count(*) FROM relata.projects) AS projects,
  (SELECT count(*) FROM relata.sources) AS sources,
  (SELECT count(*) FROM relata.session) AS sessions;
SQL
```

确认共享实例中的两个 database 仍然分离：

```bash
ssh -o BatchMode=yes bangkok-vps \
  'docker exec -i openship-infra-postgresql-postgres psql -X -v ON_ERROR_STOP=1 -U postgres -d relata' <<'SQL'
SELECT datname, pg_get_userbyid(datdba) AS owner
FROM pg_database
WHERE datname IN ('relata', 'thread_chatbot')
ORDER BY datname;
SQL
```

把生产库拉到本机供离线分析；此命令只生成快照，不会改动线上数据库。备份中含账户与业务数据，应限制访问并在使用后妥善处理：

```bash
(
  umask 077
  snapshot_dir="$(mktemp -d /private/tmp/relata-prod.XXXXXX)"
  snapshot="$snapshot_dir/relata.dump"
  ssh -o BatchMode=yes bangkok-vps \
    'docker exec openship-infra-postgresql-postgres pg_dump -U postgres -Fc -d relata' \
    > "$snapshot" &&
    pg_restore -l "$snapshot" > /dev/null &&
    printf 'Snapshot: %s\n' "$snapshot"
)
```

本地开发数据库连接配置在 `server/.env.local`。如只需聚合查询，可让 Node 读取环境文件，避免把连接串写进命令参数或输出：

```bash
cd server
node --env-file=.env.local --input-type=module -e '
import postgres from "postgres";
const db = postgres(process.env.DATABASE_URL);
try {
  console.log(await db`SELECT count(*)::int AS count FROM relata.sources`);
} finally {
  await db.end();
}
'
```

`server/.env.production` 是旧部署留下的本机文件，不代表 OpenShip 当前生产配置；生产环境变量以 OpenShip 项目中的设置为准。重新导入或恢复快照前，先核对目标 database、schema、已有数据和备份，避免覆盖 Relata 或碰到 ThreadChat。

## 代码入口与验证

- 产品与工程约束：[`AGENTS.md`](../AGENTS.md)；领域变更看 [`openspec/changes`](../openspec/changes)。
- Extension：`entrypoints/`、`lib/`、[`wxt.config.ts`](../wxt.config.ts)。Server：`server/src/app/api/`、`server/src/lib/`、[`server/src/db/schema.ts`](../server/src/db/schema.ts)。
- 本地验证：`pnpm compile && pnpm build`；`pnpm --dir server lint && pnpm --dir server exec tsc --noEmit && pnpm --dir server build`。涉及真实浏览器、Side Panel 或 Web UI 测试时，按仓库规则使用 `ego-browser nodejs`。
