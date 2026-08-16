# 实施任务（退出 explore mode 后执行）

## 1. 数据迁移

- [x] 1.1 为 Sources 增加 `url_key`、`memo`、`pinned_at`、`added_at`，并定义
  `(user_id, url_key)` 唯一约束下的 upsert behavior。
- [x] 1.2 在删除 Capture 前，按 captured URL 将旧 canonical Sources 拆为 distinct URL-key
  Sources；为每个 key 迁移 addedAt、最近非空 Intent 和可确定的 memberships。
- [x] 1.3 删除 `project_sources.linked_via_capture_id`、`analysis_runs.requested_by_capture_id`、
  Captures 和 Intents，并输出迁移前后统计。
- [x] 1.4 更新 schema ownership constraints 和 indexes，验证 two-user isolation、并发 upsert、
  query/fragment/tracking preservation 与 Chrome default-port serialization boundary。

## 2. Source saving APIs

- [x] 2.1 将 Capture endpoints 重构为 Source save/upsert endpoints，支持 memo/projectIds 三态更新。
- [x] 2.2 删除 Capture detail、Intent create/update routes 和 Capture-specific request/result types。
- [x] 2.3 更新 Source list/detail DTO，返回 Memo、pinnedAt、addedAt 和 Project metadata，不返回
  Capture history。
- [x] 2.4 验证相同 URL-key duplicate save 不创建第二个 Source、保持 addedAt、保留 omitted Memo，
  而不同 query/fragment/tracking URLs 创建不同 Sources，并独立处理 multi-tab partial failures。

## 3. Side Panel

- [x] 3.1 将保存表单中的 Intent 文案和状态统一为 Memo，并让 Add/Edit Memo 使用同一 Source field。
- [x] 3.2 新增 Source 级 Pin/Unpin action，并让 Inbox 与全部 Project occurrences 同步状态。
- [x] 3.3 抽取 SourceAvatar、SourceIdentity 和 SourceActionsMenu，供 SourceRow 与 Pinned preview 复用。
- [x] 3.4 在 Projects 下方新增空态隐藏的 Pinned avatar grid，并按 pinnedAt descending 排序。
- [x] 3.5 新增 hover/focus preview，展示 Source identity、Memo、Projects、addedAt 和共享 actions。

## 4. AI context

- [x] 4.1 从 analysis run 与 context assembly 删除 Capture references 和 Intent history。
- [x] 4.2 将当前 Source Memo 纳入 analysis input/fingerprint，且 Memo edit 不改写既有 analysis versions。
- [x] 4.3 更新 AI API tests、quota tests 和 privacy/log-redaction assertions。

## 5. 文档与验证

- [x] 5.1 新增 ADR supersede 产品基础 ADR 中的 Capture/Intent 决策，并保留历史文件。
- [x] 5.2 更新 Capture Core 与 AI Context 文档、API examples 和用户可见术语。
- [ ] 5.3 运行 migrations、server tests、extension typecheck/build，以及 duplicate-save、Memo、Pin、
  multi-Project 和 keyboard hover-preview browser QA。
