# ADR 0002: Reading List 风格的 SourceItem

- 状态：Accepted
- 日期：2026-08-16
- Supersedes：ADR 0001 中关于重复 Capture 与 Capture Intent 的决策

## 决策

Relata 以 `(user_id, Chrome-provided URL key)` 唯一标识 SourceItem。重复保存更新同一 Source，且不重置 `added_at`。query、fragment、tracking parameter 和参数顺序都参与 identity；Relata 不再执行 canonical URL normalization。

用户文字是 Source 当前唯一的可选 `memo`；Pin 是 Source 全局个人状态；Project membership 与 AI analysis 均不再引用 Capture。旧 ADR 与历史 change 保留作为决策记录。

## 后果

`captures`、`intents` 及相关 API 被删除。迁移在删表前按 captured URL 拆分旧 Source，提升最近非空 Intent 为 Memo，并审计无法精确归属的 membership。AI 在新 analysis 开始时读取当前 Memo，既有 analysis version 不会因 Memo 编辑而变化。
