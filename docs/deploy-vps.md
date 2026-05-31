# 部署备忘录 —— server/ → Coolify 新加坡 VPS

> 后端 `server/`（Next.js 16）部署到自托管 Coolify。**敏感信息（DB 密码、连接串）在 gitignored 的 `docs/deploy-vps.secrets.md`**，本文件不含密钥。
> 首次部署完成于 2026-06-01。日常更新只看 [§3 日常更新](#3-日常更新最常用)。

## 1. 基本信息

| 项 | 值 |
|---|---|
| 对外 API | **https://readsight-api.zilin.im** |
| Coolify 面板 | https://coolify.zilin.im （CLI context 名 `singapore-vps`，默认） |
| VPS IP | `43.156.59.202`（腾讯云新加坡） |
| 部署对象 | 仅 `server/`（Next.js 16）。扩展不上服务器 |
| 构建方式 | Nixpacks，base-directory=`/server`，端口 `4010` |
| 仓库/分支 | `hifizz/english-chrome-plugin` / `main`（私有） |

## 2. Coolify 资源 UUID（CLI 操作用）

> 这些 UUID 不是密钥（没有 Coolify token 用不了），可提交。

| 资源 | name | UUID |
|---|---|---|
| Project | readsight | `a7bpvq6psd8aflhrmfo2rtp4` |
| App | readsight-server | `lu2vcbh5j26vj9mn11wdh7n8` |
| Postgres | readsight-db（库名 readsight） | `qljigj8kzi9reb4nrb3fma63` |
| Server | localhost | `uog0o0wg8gwk8wwgo80ogsw8` |
| GitHub App | coolify-zilin-im | `d400o044swkswgc8w8c08soc`（列仓库用数字 id：`coolify github repos 1`） |

环境变量：CLI 用官方 `coolify`（HTTP API + Bearer Token，跟 SSH 无关）。`coolify context list` 确认默认是 `singapore-vps`。

## 3. 日常更新（最常用）

**改了后端代码 → 只需 push，自动部署：**
```bash
git push origin main
```
- App 开了 **Auto Deploy**：push 到 main，GitHub webhook 自动触发 Coolify 部署。
- ⚠️ **不要再手动 `coolify deploy`** —— 会和 webhook 各跑一次，一次 push 出两个部署。
- 看状态/日志：
```bash
coolify app deployments list lu2vcbh5j26vj9mn11wdh7n8     # 最近部署 + commit + 状态
coolify app logs lu2vcbh5j26vj9mn11wdh7n8 --lines 50      # 运行时日志（容器在跑时才有）
```
- 验证上线：
```bash
curl -s -m 30 https://readsight-api.zilin.im/api/translate -X POST \
  -H 'content-type: application/json' \
  -d '{"blocks":[{"id":"t1","text":"Hello, world."}]}'
# 期望: {"results":[{"id":"t1","zh":"...","source":"llm|cache"}]}
```

## 4. 改数据库 schema（drizzle）

迁移是**文件式 + 部署时容器内自动跑**（start-command = `pnpm db:migrate && pnpm start`，脚本 `server/scripts/migrate.mjs`）。流程：
```bash
cd server
pnpm db:generate          # 改完 src/db/schema.ts 后生成新的 drizzle/000N_*.sql
git add server/drizzle/   # 含 meta/，必须提交（见 §6 坑1）
git commit -m "db: ..." && git push origin main   # 部署时自动 migrate，幂等
```
**不需要**手动连库 migrate。本地开发仍可 `pnpm db:push` 图快。

## 5. 改环境变量 / 轮换密钥

```bash
# 1) 改本地 server/.env.production（gitignored，见 secrets 文件）
# 2) 同步到线上：
coolify app env sync lu2vcbh5j26vj9mn11wdh7n8 --file server/.env.production
# 3) 重新部署生效（运行时变量重启即可；这步可手动触发，因为没 push 不会有 webhook）
coolify deploy uuid lu2vcbh5j26vj9mn11wdh7n8
```
> 当前 MINIMAX/DEEPSEEK/ZHIPU/OPENROUTER 用的是 **dev key**，正式对外前按此流程轮换。

## 6. 已踩的坑（重要，别再犯）

1. **`server/drizzle/meta/` 必须提交**（含 `_journal.json`）。曾被 `.gitignore` 忽略 → 容器内 `migrate()` 报 `Can't find meta/_journal.json`。
2. **pnpm 钉死 `10.32.1`**（`server/package.json` 的 `packageManager`）。Nixpacks 默认装 pnpm 11，pnpm 11 见到 `server/pnpm-workspace.yaml`（只有 `ignoredBuiltDependencies`、无 `packages`）会报 `packages field missing or empty`，构建失败。
3. **app↔DB 自动连通，不用开关**。Nixpacks app + standalone Postgres 自动接入 Coolify 默认网络；网上说的 "Connect To Predefined Network" 开关是给 service stack 的，本项目不需要，那个开关在 4.1.1 的 Advanced 页也根本没有。
4. **别走 DB 公网端口做迁移**。开 is-public 后那个 TCP 端口被 Traefik TLS-SNI 接管，普通 pg 客户端从本地连会 `CONNECT_TIMEOUT`。迁移一律靠容器内自动跑。
5. **Cloudflare 那条 DNS 用灰云（仅 DNS）**。橙云代理会卡 Let's Encrypt HTTP-01 签证书，也可能缓冲流式响应。
6. **Next 16 需要 Node 20+**。已通过 env `NIXPACKS_NODE_VERSION=22` 解决（在 server/.env.production 里）。

## 7. 扩展指向生产后端

扩展后端地址来自 build 期变量 `WXT_BACKEND_URL`（缺省 `localhost:4010`）。**不要改 `.env.local`**（那是本地 dev）。出生产包：
```bash
WXT_BACKEND_URL=https://readsight-api.zilin.im pnpm build
# 产物 .output/chrome-mv3 指向线上；chrome://extensions 重新加载即可
# 校验：grep -ro readsight-api.zilin.im .output/chrome-mv3 | wc -l  应为 4，且无 localhost:4010 残留
```

## 8. 首次部署做了什么（存档，正常不用重做）

`coolify project create` → `coolify database create postgresql`（专用库）→ `coolify app create github`（私有库 + base-directory `/server` + nixpacks + ports 4010 + 域名）→ `coolify app env sync`（含 `NIXPACKS_NODE_VERSION=22`）→ 设 start-command `pnpm db:migrate && pnpm start` → push 触发部署。详见 git 历史 commit `89913fb`…`00892a5` 一段。
