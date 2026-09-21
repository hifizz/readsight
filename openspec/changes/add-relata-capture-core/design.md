# 设计：Relata Capture Core

## 数据流

```text
Current tab / selected tabs
        -> normalize URL
        -> 按 (user, canonical URL) upsert Source
        -> append Capture
        -> 可选地 append Intent
        -> 可选地将 Source 关联到 Projects
        -> 返回 Source state
```

单个 Source 的全部操作须具事务性，并以 client-supplied capture request ID 保持 idempotent。
多 Tab 保存应将每个 item 独立执行，并返回 per-item results，使一个 invalid tab 不会丢弃其余项。

## Schema

### `projects`

- `id`
- `user_id`
- `name`
- `description` nullable
- `created_at`、`updated_at`、`archived_at` nullable

Project names 不必全局唯一。Workspace 有意缺席。

### `sources`

- `id`
- `user_id`
- `canonical_url`
- `original_url`
- `title`
- `favicon_url` nullable
- `source_type`
- `metadata` JSONB
- `first_captured_at`、`last_captured_at`
- `created_at`、`updated_at`

唯一约束：`(user_id, canonical_url)`。Sources 不在用户之间全局共享；private/authenticated
URLs 和 metadata 必须归属于用户。

### `captures`

- `id`
- `user_id`
- `source_id`
- `client_request_id`
- `capture_method`
- `captured_url`、`captured_title`、`captured_favicon_url` nullable
- `selection` JSONB nullable，用于未来 page-selection capture
- `captured_at`

唯一约束：`(user_id, client_request_id)`。即使 Source title 后续变化，Capture 仍保留当时观察
到的 metadata。

### `intents`

- `id`
- `user_id`
- `capture_id`
- `raw_text`
- `created_at`、`updated_at`

Intent rows 是可选的。用户未输入 text 时，不创建空行；不存在 user-supplied intent type enum。

### `project_sources`

- `user_id`
- `project_id`
- `source_id`
- `linked_via_capture_id` nullable
- `linked_at`
- `sort_order` nullable，为后续排序预留

主键：`(project_id, source_id)`。join 中重复保存 user ownership，以支持 same-owner constraints
和简单 authorization predicates；不存在 primary-project column。

## URL identity

Normalization 删除 fragments 与安全的 tracking parameters，规范化 host 和 default ports，
保留语义有意义的 query parameters。原始 captured URL 始终可用。精确 normalization rules 必须
versioned，因为改变规则会改变 deduplication 结果。

## Inbox

Inbox 查询为：用户拥有、未 archived、没有 active `project_sources` 行的 Sources。将 item
移出 Inbox 即至少创建一个 membership；允许关联到多个 Projects。

## Side Panel

第一版 list 以 Chrome Reading List 参考图为 interaction 与 information-density 指引：

```text
Inbox
  [favicon] Title truncated as needed
            domain · relative time      [row actions]
```

Groups 可表示 Inbox 和 Projects。hover/focus actions 必须保持 keyboard-accessible，且不能成为
发现 destructive actions 的唯一方式。绿色是 accent，不要求将整个 panel 填充为绿色。

## Chrome integration

tab-strip context menu 提供 `Save to Relata`。若选择多个 tabs，采集全部 eligible selected tabs。
restricted browser pages 与缺失 URL/title 的情况返回明确 per-item failures。实施必须验证官方
Chrome API 行为并设置准确的 minimum version。

## 暂缓

- Chrome Reading List import 或 synchronization。
- Page body storage 与 source snapshots。
- Selection/highlight capture UI。
- 手动 Project ordering 和 Source ordering。
- AI-generated Project association。
- Search 和 embeddings。
