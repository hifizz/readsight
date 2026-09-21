# 变更：新增 Relata Capture Core

## 原因

Relata 的第一项产品价值，是采集网页 Sources 以及用户保存它们的上下文，并将 Sources
关联到正在推进的 Projects。仅有 URL bookmark table 不足以表达重复保存、可选 Intent、
Inbox 和多 Project 归属各自独立的历史。

## 变更内容

- 新增用户拥有的 Projects。
- 基于 canonical URL 新增去重的、用户拥有的 Sources。
- 将每次保存记录为 Capture，包括对同一 Source 的重复保存。
- 允许每个 Capture 附有可选原始用户 Intent，不要求用户自行分类。
- 将每个 Source 关联到零个或多个 Projects，不设 primary Project。
- 将 Inbox 定义为没有 Project membership 的 Sources。
- 支持保存 active tab，以及从 tab-strip context menu 保存多个 selected tabs。
- 新增紧凑的 Side Panel source list，视觉参考 Chrome Reading List。
- 预留 future ordering fields，但暂不实现手动排序。

## 功能范围

### 新增 Capabilities

- `source-capture`：Current-tab 与 selected-tab capture、URL normalization、Source
  deduplication 和 Capture history。
- `project-organization`：用户拥有的 Projects 与 Source 的多对多 membership。
- `relata-inbox`：没有关联到 Project 的 Sources 的派生视图。
- `capture-intent`：附在 Capture 上的可选 raw text。
- `source-list`：带 favicon、title、domain、time 和 contextual row actions 的紧凑
  Side Panel list。

## 依赖

- 依赖 `bootstrap-relata-foundation`。

## 影响

- 引入第一批 Relata domain tables 与 authenticated product APIs。
- 需要支持 selected tab-strip context menu capture 的 Chrome API 版本；实施时必须验证准确的
  minimum version。
- 不保存 page body content、不进行 AI analysis、不导入 Chrome Reading List，也不实现 search。
