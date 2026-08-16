# Relata AI Context 规范增量

## 修改需求

### 需求：AI analysis 使用当前 Source Memo

系统必须在 Source analysis request 开始时读取该 Source 当前 Memo，并将其作为可选用户上下文。
系统不得依赖 Capture、Capture Intent history 或 requested Capture reference。

#### 场景：带 Memo 分析 Source

- **当** 用户分析一个拥有 Memo 的 Source
- **那么** 当前 Memo 被纳入 analysis input 和 input fingerprint
- **而且** analysis run 不保存 Capture reference

#### 场景：分析后修改 Memo

- **当** 用户在已有成功 analysis 后编辑 Source Memo
- **那么** 既有 analysis version 保持不变
- **而且** 后续 analysis run 使用更新后的 Memo

#### 场景：没有 Memo

- **当** 用户分析没有 Memo 的 Source
- **那么** analysis 仍可正常执行，且系统不得创建空 Memo placeholder

## 移除需求

### 需求：AI interpretation 引用 Capture Intent history

**移除原因**：Capture 和 Intent 被 Source 当前 Memo 取代。

**迁移**：分析上下文组装从 raw Intent history 改为 current Source Memo，并移除
`analysis_runs.requested_by_capture_id`。
