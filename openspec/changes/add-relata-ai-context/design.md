# 设计：版本化 AI Context 与 Conversation

## 原则

1. 用户撰写的 Intent 是不可变证据；AI interpretation 是有历史的可替换 output。
2. 成功的 analysis 仅追加；重新分析创建新 version。
3. Conversations 显式引用所使用的 Source/Project context。
4. 新 run 的失败绝不销毁最近成功结果。
5. 第一版的 page body 仅临时存在。

## Schema

### `analysis_runs`

- `id`、`user_id`、`source_id`
- `requested_by_capture_id` nullable
- `status`：queued、running、completed、failed、cancelled
- `model`、`prompt_version`、`input_fingerprint`
- `error_code` nullable；errors 中不得包含 private page text
- `started_at`、`completed_at`、`created_at`

### `source_analyses`

- `id`、`user_id`、`source_id`、`analysis_run_id`
- 单调递增的 `version`
- `summary`
- `key_points` JSONB
- `topics` JSONB
- `entities` JSONB
- `content_type` nullable
- `intent_interpretations` JSONB
- `model`、`prompt_version`、`created_at`

唯一约束：`(source_id, version)`。run/input fingerprint 使系统能解释哪些临时内容和配置生成
结果，而无需保存 body。

### `project_insights`

- `id`、`user_id`、`project_id`、`source_id`
- `source_analysis_id`
- 在 `(project_id, source_id)` 内单调递增的 `version`
- `why_it_matters`
- `implications` JSONB
- `model`、`prompt_version`、`created_at`

### `threads`

- `id`、`user_id`
- `source_id` nullable
- `project_id` nullable
- `title` nullable
- `created_at`、`updated_at`、`archived_at` nullable

本 change 的 contextual Threads 至少存在一个 Source 或 Project。未来 general Project assistant
可通过明确 change 放宽该规则。

### `messages`

- `id`、`user_id`、`thread_id`
- `role`
- `content` JSONB
- `source_analysis_id` nullable
- `project_insight_id` nullable
- `model` nullable
- `created_at`

Messages 保存该 turn 使用的 context-version references。继续 Thread 可以使用新的 analysis，
但先前 turn 仍可复现。

## 临时提取

service 从 extension 或 fetch/extraction worker 获取 page text，将其用于当前 analysis request，
但不持久化完整 body。只保留不可逆 fingerprint 与 extraction metadata。private 或 authenticated
content 不得进入 logs 或 error payloads。

这会限制未来 follow-up：Thread 可以使用保存的 analysis 和 messages；若问题需要精确、已遗忘的
page text，可能触发一次新的 extraction。

## Intent 解释

UI 从不展示必填 classification control。当存在 raw Intent 时，analysis 可返回一个或多个推断
意义，例如 note、question、task、memory 或 action candidate，并附 confidence 与 structured
arguments。这些是 AI outputs，不是 user-authored Intent record 上的固定 enum。

## 对话上下文组装

每次 model request 组装：

```text
Source metadata
+ selected/current Source Analysis
+ optional Project context and Project Insight
+ raw Intent history
+ Thread messages
+ transient page text when freshly available
```

request 记录所使用的 version IDs。token 与 request quotas 扩展既有 user-scoped accounting model。

## 未来工具边界

tool calls 与 results 可先存在于 Message content parts 中。将结论持久化为 Project document 暂缓，
直至 Project-document model 设计完成。本 change 不得以非结构化 `documents` JSON column 作为捷径。

## 暂缓

- Vector embeddings 与 semantic search。
- Cross-Source relationship discovery 与 resurfacing。
- Normalized Topic 和 Entity tables。
- Project documents 与 external tool execution。
- Persisted page body/snapshots。
