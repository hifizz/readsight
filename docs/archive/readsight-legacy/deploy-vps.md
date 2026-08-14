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

### 用户认证变量

正式部署用户系统前必须在 Coolify 配置：

- `BETTER_AUTH_SECRET`：至少 32 字节的随机密钥，生产环境不得使用仓库或本地开发示例值。
- `BETTER_AUTH_URL=https://readsight-api.zilin.im`
- `AUTH_TRUSTED_ORIGINS=chrome-extension://<商店正式扩展ID>`（开发版 ID 需要单独加入时用逗号分隔）
- 可选额度：`DAILY_CHAT_REQUESTS`、`DAILY_TRANSLATION_CHARACTERS`、`DAILY_LOOKUP_REQUESTS`。

本期账户只支持邮箱密码，不验证邮箱、不发送邮件，也不支持忘记密码找回。首次迁移必须先备份数据库，然后按 `db:backfill-owner` → `db:finalize-ownership` 的顺序把原有单用户数据归属到明确的 owner 账号；不要在未确认 owner 邮箱或仍有 `user_id IS NULL` 的情况下执行 finalization。

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
  -H "authorization: Bearer $READSIGHT_TEST_TOKEN" \
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
**不需要**手动连库 migrate。本地开发仍可 `pnpm db:push` 图快。业务表固定在 `readsight` schema，迁移记录在 `readsight_migrations`；同一个 database 中其他项目的 `public` 表不会参与 diff 或迁移。

## 5. 改环境变量 / 轮换密钥

```bash
# 1) 改本地 server/.env.production（gitignored，见 secrets 文件）
# 2) 同步到线上：
coolify app env sync lu2vcbh5j26vj9mn11wdh7n8 --file server/.env.production
# 3) 重新部署生效（运行时变量重启即可；这步可手动触发，因为没 push 不会有 webhook）
coolify deploy uuid lu2vcbh5j26vj9mn11wdh7n8
```
> 当前 DEEPSEEK/ZHIPU/OPENROUTER 用的是 **dev key**，正式对外前按此流程轮换。`DEEPSEEK_API_KEY` 是必填项：它支持 V4-Pro 侧栏对话、V4-Flash 词典模型辅助和主翻译；Zhipu、OpenRouter 保留为全文翻译 fallback。
>
> 后端和扩展联合上线并过了回滚窗口后，从 Coolify 的环境变量和本地 gitignored 配置中删除遗留的 `MINIMAX_API_KEY`、`MINIMAX_CHAT_MODEL`。浏览器朗读走本地 `speechSynthesis`，不需要云端 TTS 密钥。

## 6. 已踩的坑（重要，别再犯）

1. **`server/drizzle/meta/` 必须提交**（含 `_journal.json`）。曾被 `.gitignore` 忽略 → 容器内 `migrate()` 报 `Can't find meta/_journal.json`。
2. **pnpm 钉死 `10.32.1`**（`server/package.json` 的 `packageManager`）。Nixpacks 默认装 pnpm 11，pnpm 11 见到 `server/pnpm-workspace.yaml`（只有 `ignoredBuiltDependencies`、无 `packages`）会报 `packages field missing or empty`，构建失败。
3. **app↔DB 自动连通，不用开关**。Nixpacks app + standalone Postgres 自动接入 Coolify 默认网络；网上说的 "Connect To Predefined Network" 开关是给 service stack 的，本项目不需要，那个开关在 4.1.1 的 Advanced 页也根本没有。
4. **别走 DB 公网端口做迁移**。开 is-public 后那个 TCP 端口被 Traefik TLS-SNI 接管，普通 pg 客户端从本地连会 `CONNECT_TIMEOUT`。迁移一律靠容器内自动跑。
5. **Cloudflare 那条 DNS 用灰云（仅 DNS）**。橙云代理会卡 Let's Encrypt HTTP-01 签证书，也可能缓冲流式响应。
6. **Next 16 需要 Node 20+**。已通过 env `NIXPACKS_NODE_VERSION=22` 解决（在 server/.env.production 里）。
7. **native 模块要进 `onlyBuiltDependencies`**。pnpm 10/11 默认不跑依赖的 install/postinstall，`better-sqlite3` 的 `.node` 二进制就不会装，容器里报 `Could not locate the bindings file`、ECDICT 降级。已在 `server/pnpm-workspace.yaml` 把 `better-sqlite3` 加进 `onlyBuiltDependencies`。以后再加 native 依赖同理。
8. **生产必须发 CORS 头**。`next.config.ts` 早期 `!isDev` 时 `headers()` 返回 `[]`，导致 `chrome-extension://` 的 sidepanel fetch `/api/*` 报 `No Access-Control-Allow-Origin`。现在 dev/prod 都允许 `Authorization` 并暴露 Better Auth 的 `set-auth-token` 响应头；生产必须用 `CORS_ALLOW_ORIGIN` 和 `AUTH_TRUSTED_ORIGINS` 收紧到正式扩展 ID。CORS 不是鉴权边界，产品 API 仍逐请求校验 Bearer Session。

## 7. 扩展指向生产后端

扩展后端地址来自 build 期变量 `WXT_BACKEND_URL`（缺省 `localhost:4010`）。**不要改 `.env.local`**（那是本地 dev）。出生产包：
```bash
WXT_BACKEND_URL=https://readsight-api.zilin.im pnpm build
# 产物 .output/chrome-mv3 指向线上；chrome://extensions 重新加载即可
# 校验：grep -ro readsight-api.zilin.im .output/chrome-mv3 | wc -l  应为 4，且无 localhost:4010 残留
```

## 8. 首次部署做了什么（存档，正常不用重做）

`coolify project create` → `coolify database create postgresql`（专用库）→ `coolify app create github`（私有库 + base-directory `/server` + nixpacks + ports 4010 + 域名）→ `coolify app env sync`（含 `NIXPACKS_NODE_VERSION=22`）→ 设 start-command `pnpm db:migrate && pnpm start` → push 触发部署。详见 git 历史 commit `89913fb`…`00892a5` 一段。

## 9. ECDICT 离线词典（bind-mount，构建不带 100MB）

`/api/lookup` 用 `server/data/ecdict.sqlite`（100MB，77万词，表 `dict`，sha256 `265a13c7…`）走 cache→ecdict→free-dict→llm。文件 gitignore、不进镜像；用宿主机目录 bind-mount 到容器、跨部署保留。

**首次灌入（已做）**：
```bash
# ① 本地 scp 到 VPS 宿主机（登录用户 ubuntu，有 sudo）
ssh ubuntu@43.156.59.202 'sudo mkdir -p /opt/readsight/data && sudo chown ubuntu:ubuntu /opt/readsight/data'
scp -C server/data/ecdict.sqlite ubuntu@43.156.59.202:/opt/readsight/data/ecdict.sqlite
# ② 给 app 加 bind-mount（宿主机 /opt/readsight/data ←→ 容器 /app/data）
coolify app storage create lu2vcbh5j26vj9mn11wdh7n8 \
  --type persistent --name ecdict-data \
  --host-path /opt/readsight/data --mount-path /app/data
# ③ 重新部署生效
coolify deploy uuid lu2vcbh5j26vj9mn11wdh7n8
```
`ecdict.ts` 路径优先级 `ECDICT_PATH` → `cwd/data` → `cwd/server/data`；容器 cwd=`/app`，所以挂到 `/app/data` 即被自动发现，**无需 env、无需改代码**。

**验证**：用没查过的生僻词（避开缓存），`source` 应为 `ecdict`：
```bash
curl -s 'https://readsight-api.zilin.im/api/lookup?word=perspicacious' | python3 -m json.tool
# source=ecdict，extras 带 tag/collins/bnc；日志 `[ecdict] opened /app/data/ecdict.sqlite`
```
注意：之前查过的词命中 `dictionary_entries` 缓存（cache 优先于 ecdict），会显示 `source=cache`，正常。

**更新词典**：scp 覆盖 `/opt/readsight/data/ecdict.sqlite` → 重启/重部署（ecdict 是只读单例，重启才重新打开）。**换新 VPS** 需重新 scp + 重建 storage。
