## 1. 版本化 Analysis Model

- [x] 1.1 新增 analysis-runs 与 source-analysis tables，包含 version allocation、same-user
  constraints 和 current/successful lookup indexes。
- [x] 1.2 新增 project-insight versions，关联 Projects、Sources 和 Source Analysis versions。
- [x] 1.3 新增 Threads 和 Messages，具有显式 context-version references。
- [x] 1.4 为所有新 relation 新增 migration 与 two-user isolation tests。

## 2. Extraction 与 Processing

- [x] 2.1 定义 transient extraction request contract 与 input fingerprint。
- [x] 2.2 实现 queued/running/completed/failed run transitions 与安全的 retry 行为。
- [x] 2.3 确保 page bodies、Intent text、bearer tokens 和 message content 不出现在 operational
  logs 或 error payloads。
- [x] 2.4 为 analysis 与 conversation work 扩展 per-user quotas。

## 3. AI Outputs

- [x] 3.1 生成 versioned summary、key points、topics、entities、content type 和可选 Intent
  interpretations。
- [x] 3.2 生成 Project-specific why-it-matters insights，不覆盖 earlier versions。
- [x] 3.3 提供 current 与 historical analysis APIs，并带 stable pagination。

## 4. Conversation

- [x] 4.1 为 Sources 和 Projects 创建/list/archive contextual Threads。
- [x] 4.2 持久化 Messages，以及每个 model turn 使用的精确 analysis/insight version references。
- [x] 4.3 从 saved analysis 继续 Thread，只有需要精确 current page content 时才重新提取页面。
- [x] 4.4 保留 structured tool-call/result message parts，实际 Project-document tools 暂缓。

## 5. Side Panel 与验证

- [x] 5.1 新增 Summary、Why It Matters 和 Ask Relata 界面，支持 analysis version/history states。
- [x] 5.2 测试 failed re-analysis、retry、conversation continuation、changed page content、quota
  rejection 和 cross-user denial。
- [x] 5.3 运行 extension 与 server build/typecheck suites。
- [x] 5.4 使用要求的 browser workflow，在真实 extension 中验证 analysis history 和持续的
  Source/Project conversation。
