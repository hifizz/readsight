## 1. 项目身份

- [x] 1.1 将根 package 与 server package metadata 改为 Relata。
- [x] 1.2 替换 Chrome manifest 名称、描述、tooltip 与 commands 为 Relata 身份，并移除
  Readsight 专属 permissions/commands。
- [x] 1.3 将 runtime prefixes、storage keys、menu IDs、logs、CSS namespaces 与 request
  metadata 从 Readsight 改为 Relata。
- [x] 1.4 增加临时绿色 brand tokens 与明确为临时的 icon asset。

## 2. 移除旧产品

- [x] 2.1 删除 translation、word lookup、pronunciation 与 immersive-reading entrypoints、
  components、messages、settings 和 menus。
- [x] 2.2 删除 learning-history、encounter、known-item、dictionary、translation 与 speech
  API routes 和 libraries。
- [x] 2.3 将 Side Panel 收敛为 authenticated 与 signed-out Relata shells。
- [x] 2.4 审核 dependencies，移除只服务 Readsight features 的 packages。

## 3. Database 与 authentication 基础

- [x] 3.1 创建仅含 Better Auth、rate limiting 与 daily usage tables 的干净 `relata`
  Drizzle schema。
- [x] 3.2 重置 Relata 的 migration output 与 migration-history namespaces，不修改 Readsight
  database。
- [x] 3.3 将 server auth、quota 和 authenticated request helpers 适配到新 namespace，并移除
  learning-domain 假设。
- [x] 3.4 验证 registration、sign-in、session restoration、revocation、sign-out、quota
  rejection 与 two-user boundary 行为。

## 4. 文档与验证

- [x] 4.1 重写根/server README 与 Relata 项目说明。
- [x] 4.2 确认归档 Readsight 文档被清晰标为非规范性。
- [x] 4.3 执行 static audits，证明活动代码中不再有 `Readsight`、`见微`、`English Agent`、
  `readsight:*`、translation 或 learning UI。
- [x] 4.4 运行 extension compile/build 和 server lint/typecheck/build。
- [x] 4.5 使用要求的 browser workflow，在真实 extension 环境测试 registration 与
  signed-in shell。
