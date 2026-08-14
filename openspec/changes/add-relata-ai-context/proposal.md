# 变更：新增版本化 AI Context 与 Conversation

## 原因

Relata 不应只总结已保存的 links；它还应解释 Source 为什么与用户的 Projects 相关、保留既有
理解，并允许用户继续讨论。因此 AI output 不能只是 Source row 上可变的 columns。

## 变更内容

- 为 Sources 新增仅追加、版本化的 AI analysis。
- 保留 summaries、key points、topics、entities、推断的 Intent meaning、model identity、
  prompt/version metadata 和 generation state。
- 新增解释 Source 对 Project 意义的 project-specific insights。
- 新增 Source/Project-scoped Threads 和 Messages，使用户从过去 analysis 继续讨论。
- 为 analysis 临时获取页面内容，第一版不持久化完整 body。
- 记录 processing runs 与 failures，不覆盖先前成功的 analysis。
- 为未来将结论或 artifacts 保存到 Project documents 的 tools 预留 integration boundaries。

## 功能范围

### 新增 Capabilities

- `source-analysis-history`：Source 的版本化 AI understanding。
- `project-insight`：Project-specific 的“为什么重要”分析。
- `contextual-conversation`：基于 Source、Project、selected analysis versions 和 prior messages
  的连续讨论。
- `analysis-processing`：可观测、可重试的 analysis runs。

## 依赖

- 依赖 `bootstrap-relata-foundation` 和 `add-relata-capture-core`。

## 影响

- 新增 model-backed endpoints 与 quota metrics。
- 新增 AI history 与 chat tables，但没有 page-content table。
- 暂缓 vector search、normalized knowledge graphs、Project documents 和 tool execution。
