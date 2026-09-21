# 变更：建立 Relata 基础

## 原因

仓库当前仍以 Readsight 的身份和行为运行，但 Relata 是一个仅复用通用基础设施的全新产品。
若只重命名旧学习概念，会留下误导性的产品与数据库，因此 Relata 必须先拥有干净的基础。

## 变更内容

- 将项目、Chrome 扩展、server、运行时标识符和 PostgreSQL namespace 改为 Relata。
- 使用已确认的 Relata 名称和 Slogan 替换 Readsight 品牌。
- 采用临时绿色视觉方向，最终 icon 暂不确定。
- 删除翻译、查词、学习历史、语音及其他 Readsight 专属产品流程和 API。
- 从新 Relata 基线中移除旧领域表和 migrations。
- 保留并改造现有组件库、extension shell、Better Auth、bearer sessions、quotas、
  authenticated request boundary 与用户隔离约定。
- 将全部 `readsight:*` key 改为 `relata:*`，不做兼容迁移。
- 将当前产品文档替换为 Relata 文档，同时保留明确标为非规范性的 Readsight 归档。

## 功能范围

### 新增 Capabilities

- `relata-product-identity`：Relata 命名、manifest 身份、Slogan、临时绿色视觉方向和一致的
  运行时 namespace。
- `relata-auth-foundation`：在 Relata namespace 中复用的自托管邮箱/密码认证、bearer
  sessions、用户边界与 quota 基础设施。

### 移除 Capabilities

- Readsight 翻译与双语页面注入。
- 查词、发音和词典缓存。
- 学习 encounters、已知词追踪、学习记录和文本锚点跳回流程。
- Readsight 专属 model routing 与 speech specifications。

## 影响

- 大多数现有 extension entrypoints 与 server 产品 routes 将被删除，或收敛为通用 shell/auth
  行为。
- 现有本地扩展状态会被有意废弃。
- PostgreSQL schema 从 `readsight` 切换至 `relata`，不迁移旧记录。
- 仅当认证代码对新 Relata tests 仍成立时，才保留这些通用部分。
- 本 change 暂不实现 Source、Project、Capture 或 AI analysis。
