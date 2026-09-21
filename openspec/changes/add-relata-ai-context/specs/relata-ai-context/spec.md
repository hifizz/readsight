## 新增需求

### 需求：AI analysis 具备版本
系统必须为每次成功 analysis append 一个新的 Source Analysis version，并保留先前 versions 的
model 与 prompt metadata。

#### 场景：重新分析一个 Source
- **当** 后续 analysis 成功
- **那么** 新结果可用，且不覆盖先前的 summary、key points、topics、entities 或 Intent
  interpretation

#### 场景：重新分析失败
- **当** 后续 analysis run 失败
- **那么** 最近成功 analysis 仍可用，failure 被记录但不包含 private page text

### 需求：第一版不持久化完整 page body
系统必须临时处理提取的页面内容，只保留 analysis output、extraction metadata 与不可逆的
input fingerprint。

#### 场景：analysis 完成
- **当** transient page content 已完成分析
- **那么** database 中不会写入完整 HTML、Markdown 或 page text body

### 需求：Project Insight 解释相关性
系统必须创建 versioned、Project-specific insight，解释一个 Source 为什么对选定 Project 重要。

#### 场景：一个 Source 属于两个 Projects
- **当** 为每个 Project 请求 insight
- **那么** 每个 Project 获得独立 versioned relevance result

### 需求：Conversation 保留 grounding history
系统必须保存 contextual Threads 和 Messages，并引用 model turns 所使用的 Source Analysis 与
Project Insight versions。

#### 场景：用户继续先前讨论
- **当** 用户重新打开一个 Source Thread 并发送另一条 message
- **那么** 先前 messages 与 saved analysis 仍可作为 grounding；仅当需要精确 current page content
  时才请求 fresh extraction

### 需求：Future tool results 可被表达
Message content 必须保留 structured tool-call 与 tool-result parts；Project-document persistence
和 external tool execution 暂缓。

#### 场景：future tool 返回 structured result
- **当** conversation runtime 收到一个 tool result
- **那么** result 可保留在 message history 中，而不需要非结构化的 Project document field
