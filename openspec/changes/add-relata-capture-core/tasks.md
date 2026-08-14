## 1. 数据模型

- [ ] 1.1 新增 Projects、Sources、Captures、Intents 和 Project-Sources tables，以及
  same-user constraints、timestamps 和 access-pattern indexes。
- [ ] 1.2 实现并测试 versioned canonical-URL normalization。
- [ ] 1.3 针对干净 Relata database 新增 migrations。
- [ ] 1.4 新增 two-user isolation、repeated-save 与 concurrent-deduplication tests。

## 2. Authenticated APIs

- [ ] 2.1 新增 Project create/list/update/archive APIs。
- [ ] 2.2 新增 single 和 batch capture APIs，具 transaction per-item behavior 与
  client-request idempotency。
- [ ] 2.3 新增 Source listing/detail APIs 和派生 Inbox filtering。
- [ ] 2.4 新增 membership APIs，支持零到多个 Projects 且没有 primary。
- [ ] 2.5 新增 optional Intent create/update 行为，不产生空 placeholder rows。

## 3. Chrome capture

- [ ] 3.1 验证官方 selected-tab context menu API，并定义准确的 minimum supported Chrome
  version。
- [ ] 3.2 为 tab-strip 注册 `Save to Relata`，采集一个或多个 selected tabs。
- [ ] 3.3 处理 restricted URLs、partial batch failures、authentication expiry 和 duplicate
  client retries。
- [ ] 3.4 从 Side Panel 或 toolbar entry point 新增 current-tab capture。

## 4. Side Panel

- [ ] 4.1 新增以已确认 Reading List information hierarchy 为模型的紧凑 Inbox 和 Project
  groups。
- [ ] 4.2 渲染 favicon、title、domain、relative time、truncation、loading、empty、error 与
  partial-batch states。
- [ ] 4.3 新增 optional Intent input 与 Project multi-selection，不要求用户分类。
- [ ] 4.4 新增 accessible hover/focus row actions 与 narrow-panel QA。

## 5. 验证

- [ ] 5.1 运行 schema、API、ownership、concurrency 与 idempotency tests。
- [ ] 5.2 运行 extension compile/build 和 server lint/typecheck/build。
- [ ] 5.3 使用要求的 browser workflow 测试 current-tab capture、multi-selected-tab capture、
  repeated URL saves、Inbox、multi-Project linking 与 sign-out/session expiry。
