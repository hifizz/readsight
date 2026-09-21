# ADR-0001：Relata 产品基础

> 关于重复 Capture、Capture Intent 与 canonical URL 的决策已由 [ADR 0002](./0002-reading-list-source-items.md) supersede；本文件保留为历史记录。

- 状态：已接受
- 日期：2026-08-14
- 决策负责人：产品与工程

## 背景

本仓库复制自 Readsight；后者是一个提供翻译、查词和学习历史的 Chrome 扩展。
Relata 是全新产品，只复用组件库、Chrome 扩展外壳、认证、Session、配额和用户隔离模式
等通用基础设施。Readsight 的数据、品牌、产品行为和领域模型都不作为迁移输入。

Relata 已确认的品牌为：

> **Relata — Connect what you discover to what you're working on.**

Relata 是浏览器采集与上下文助手。其核心循环为：

> Capture -> Relate -> Think -> Resurface

## 决策

### 1. 将 Relata 作为绿地产品处理

- 删除翻译、查词和学习历史功能。
- 不迁移 Readsight 用户或领域数据。
- 复用可工作的 auth/session/quota 基础，但将其适配为 Relata 的 schema 和 API。
- 将扩展持久化 key 从 `readsight:*` 改为 `relata:*`；不要求保留旧本地状态。
- 使用 PostgreSQL 应用 schema `relata` 和 Relata 专属的迁移历史 namespace。

### 2. 使用 Project 作为顶层组织对象

第一版不引入 Workspace 对象，用户直接拥有 Projects。若未来出现团队、组织或多空间需求，
可在 Project 上方增加 Workspace，以保持未来兼容。

这意味着第一版 schema 不得写入会阻碍未来增加下列层级的假设：

```text
Workspace
  -> Project
      -> Source
```

尤其是 Project ID 必须保持稳定，所有权必须显式表达。

### 3. 分离 Source 身份与 Capture 事件

一个 Source 表示用户拥有且去重后的网页资源。重复保存同一 canonical URL 时复用 Source，
但创建另一条 Capture。每条 Capture 保存用户何时、如何保存，并可拥有自己的可选 Intent。

```text
Source（每位用户 + canonical URL 唯一）
  -> Capture A -> 可选 Intent A
  -> Capture B -> 可选 Intent B
```

第一版保存 Source 元数据，但不持久化提取后的页面正文。可为分析临时获取内容。

### 4. 允许多对多的 Project 归属

一个 Source 可以属于多个 Projects，不设 Primary Project。未来可为项目归属增加排序字段，
但排序行为不属于第一版。

Inbox 不是一个特殊的 Project 行，而是没有任何 Project 归属的 Sources 的派生视图。

### 5. 将用户文本视为可选的原始 Intent

没有 Intent 时保存也必须成功，UI 不得施压要求用户填写。存在时，Intent 保存用户的原始
文本，不要求用户分类。AI 可以推断其表示 note、question、task、memory 或 action，但必须
以版本化 AI 输出保存，而不是替换原始文本。

### 6. 为 AI 分析版本化，并保留连续对话

AI 分析采用仅追加、可版本化的方式。重新分析不得覆盖既有 summary、key points、topics、
entities 或项目专属结论。

Threads 和 messages 是一等记录，关联到 Sources 和可选的 Projects，使用户可继续讨论先前
分析。未来工具可以将结论或生成产物保存到 Project documents；Project documents 和工具
执行暂缓，但模型不得阻碍未来扩展。

第一版中，topics 与 entities 保持为 analysis version 中的结构化 JSON。规范化的
topic/entity 表和 vector search 暂缓。

### 7. 将 Chrome 多 Tab 采集交互作为产品要求

Relata 必须支持从 tab-strip context menu 保存已选中的 tabs。因此最低支持的 Chrome 版本应
为官方 extension API 首次支持此交互的稳定版本。实施时必须根据官方 Chrome 文档验证准确的
manifest 最低版本。

### 8. 将 Chrome Reading List 作为视觉参考，而不是数据模型

Side Panel 应借鉴已保存参考图中紧凑的原生 Reading List 特征：

- 窄侧栏布局；
- 可折叠分组；
- favicon、标题、域名和相对时间的层级；
- 长标题截断；
- 不喧宾夺主的行内操作；
- 克制装饰下的高信息密度。

Chrome Reading List 未来可成为导入来源，但不是 Relata 的主存储。参考图片为
[`assets/chrome-reading-list-reference.png`](assets/chrome-reading-list-reference.png)。

### 9. 采用临时绿色视觉方向

Relata 使用仅英文的品牌名，并移除中文 Readsight 品牌。绿色是初始品牌色方向。最终 icon
暂缓；第一版可使用明确标注为临时的绿色标记，不得将它称作最终 logo。

## 后果

- Readsight migrations 和领域表不再扩展到 Relata。
- 现有 Readsight 文档和 specs 作为历史参考归档，不具规范性。
- 认证 change 以被取代状态归档。已完成的可复用基础设施会被带入 Relata；未完成的
  Readsight 专属约束、测试和部署工作不会被虚假标记为完成。
- 实施拆分为 foundation、capture core 和 AI context 三个 changes，以便独立审查。
