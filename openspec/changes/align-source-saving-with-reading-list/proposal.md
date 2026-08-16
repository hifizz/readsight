# 变更：使 Source 保存模型与 Chrome Reading List 保持一致

## 原因

Relata 当前将同一 URL 的每次保存建模为独立 Capture，并把用户文字附在 Capture Intent 上。
这个模型与 Side Panel 所参考的 Chrome Reading List 心智模型不一致：Reading List 以 URL 标识
唯一 item，重复保存不会产生第二个 item 或一组面向用户的保存历史。

Pin、Memo 和 Project 都是用户对一个 SourceItem 的当前状态。继续保留 Capture/Intent 会迫使
用户理解“同一 Source 的多次保存”和“最近一次 Intent”，也会让 ListItem 的 `Add memo`
无法明确作用于哪个对象。

## 变更内容

- **BREAKING**：移除 Capture 和 Intent 领域对象、持久化表、API 与客户端状态。
- 每个 user 和 Chrome 提供的完整 URL key 只维护一个 SourceItem；重复保存执行幂等 upsert，
  不创建历史事件。
- 移除 Relata 的 canonical URL normalization：不得删除 fragment、tracking parameters，不得重排
  query，也不得猜测两个不同 URL 是否指向相同内容。
- 将用户填写的文字统一命名为 Memo，并作为 Source 的零或一个可编辑字段保存。
- 第一次加入时间属于 Source；重复保存不得重置该时间。
- Pin 作为 Source 的个人全局状态，不属于 Inbox 或某个 Project membership。
- 在 Projects 下方新增 Pinned section，以 avatar grid 展示 pinned Sources。
- hover 或 keyboard focus pinned avatar 时显示 Source preview，包括 Source identity、Memo、Projects
  和加入时间。
- 删除 Project membership 和 AI analysis 对 Capture 的引用；AI 使用当前 Source Memo，而不是
  Intent history。

## 用户交互影响

- 保存与已有 Source 相同的 Chrome-provided URL key 时，不增加重复 ListItem；更新并返回已有
  Source，且保持原加入时间。
- query、fragment、tracking parameters 或其他由 Chrome 保留的 URL 部分不同时，分别创建
  SourceItems。
- 保存表单中的 `Intent` 统一改名为 `Memo`；SourceItem 菜单提供 `Add memo` / `Edit memo`。
- SourceItem 菜单新增 `Pin` / `Unpin`。Pin 不会把 Source 从 Inbox 或 Projects 移走。
- Projects 下方新增空态隐藏的 Pinned avatar grid；同一 Source 即使属于多个 Projects，也只展示
  一个 avatar。
- hover 或 keyboard focus pinned avatar 时显示可交互 preview，包含 Source identity、Memo、
  Projects、加入时间和共享 actions。
- UI 不展示 Capture、保存次数或 Intent history。

## 功能范围

### 修改 Capabilities

- `source-capture`：改为以完整 URL 为 key 的 Reading List 风格 Source saving/upsert，不再包含
  Capture history。
- `capture-intent`：由 Source 级 `memo` 取代。
- `source-list`：新增 Pin action、Memo action、Pinned avatar grid 和 hover/focus preview。
- `project-organization`：membership 不再记录 originating Capture。
- `relata-ai-context`：分析上下文使用当前 Source Memo，analysis run 不再引用 Capture。

## 影响

- `captures`、`intents` tables 及其 routes 被移除。
- `sources.canonical_url` 被 `url_key` 取代；唯一约束改为 `(user_id, url_key)`。
- `sources.first_captured_at` 迁移为 `added_at`；`last_captured_at` 不再表达重复保存历史。
- `sources` 新增 nullable `memo` 和 `pinned_at`。
- `project_sources.linked_via_capture_id` 与 `analysis_runs.requested_by_capture_id` 被移除。
- 迁移时每个 Source 最近一条非空 Intent 可提升为当前 Memo；其余 Capture/Intent history 将被删除。
- 现有 Capture Core ADR 与 change 仍作为历史决策保留，本 change supersede 其中的重复保存与
  Capture Intent 决策。

## 非目标

- 不实现多个 Memo、Memo revision history 或 Capture history UI。
- 不实现 Pinned items 的手动排序；默认按最近 pin 时间排序。
- 不改变一个 Source 可属于多个 Projects 的模型。
- 不尝试恢复 Chrome 在把 URL 暴露给 extension 之前已经丢弃的 lexical information，例如 HTTPS
  的显式默认端口 `:443`。

## 成功标准

- 相同 URL key 的重复保存始终收敛到一个 SourceItem，且 `addedAt` 稳定。
- 不同 tracking query、fragment 和 search query 始终产生不同 SourceItems。
- Memo 在首次保存、重复保存、ListItem 编辑和明确删除之间保持单一、一致的状态。
- Pin/Unpin 从 Inbox、任意 Project occurrence 或 Pinned preview 执行时保持同步，且不改变
  memberships。
- Pinned preview 可通过 pointer 和 keyboard 访问，并在窄 Side Panel 内正确换行与避让。
- 所有面向用户的 Capture/Intent history 与保存次数均被移除。
