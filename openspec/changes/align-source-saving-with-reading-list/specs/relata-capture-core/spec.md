# Relata Capture Core 规范增量

## 修改需求

### 需求：用户可以保存一个或多个 tabs

extension 必须让 authenticated user 通过 `Save to Relata` 保存 active tab，以及 tab strip 中
全部 eligible selected tabs。每个 tab 的保存是对其完整 Chrome-provided URL key 对应 SourceItem
的独立 upsert。

#### 场景：保存多个 selected tabs

- **当** 用户对多个 eligible tabs 调用 `Save to Relata`
- **那么** 系统独立处理每个 tab，并返回每个 tab 对应的 Source result
- **而且** batch 中相同 URL key 的 tabs 收敛到同一个 SourceItem

#### 场景：batch 中含有 restricted tab

- **当** 一个 selected tab 不能被读取或保存
- **那么** 此 item 返回明确失败，其他 eligible items 仍然成功

### 需求：每个完整 Chrome-provided URL key 只有一个 SourceItem

系统必须为每个 user 和 Chrome 提供给 extension 的完整 serialized URL key 维护恰好一个
SourceItem。保存操作不得创建 Capture 或其他重复保存历史。Relata 不得删除 fragment、tracking
parameters，不得重排 query，也不得猜测不同 URLs 的内容是否等价。

#### 场景：首次保存 URL

- **当** 用户保存尚不存在的 URL key
- **那么** 系统创建一个 SourceItem，并记录稳定的加入时间

#### 场景：再次保存相同 URL

- **当** 用户再次保存与已有 Source 完全相同的 Chrome-provided URL key
- **那么** 系统返回并更新已有 SourceItem，而不创建第二个 ListItem 或保存事件
- **而且** Source 的加入时间保持不变

#### 场景：不同 users 保存相同 URL

- **当** 两名 users 保存相同 URL key
- **那么** 每名用户获得独立拥有的 SourceItem

#### 场景：tracking query 产生不同 SourceItems

- **当** 用户分别保存 `https://example.com/article` 和
  `https://example.com/article?utm_source=twitter&utm_campaign=launch`
- **那么** 系统创建两个 SourceItems

#### 场景：fragments 产生不同 SourceItems

- **当** 用户分别保存 `https://example.com/article`、`https://example.com/article#comments` 和
  `https://example.com/article#section-3`
- **那么** 系统创建三个 SourceItems

#### 场景：不同 search queries 产生不同 SourceItems

- **当** 用户分别保存 `https://example.com/search?q=react` 和
  `https://example.com/search?q=vue`
- **那么** 系统创建两个 SourceItems

#### 场景：遵守 Chrome serialized URL 边界

- **当** Chrome 将 hostname 大小写或显式默认 HTTPS port 归一化后，把相同 serialized URL
  提供给 extension
- **那么** Relata 使用该 Chrome-provided URL 作为同一个 key
- **而且** Relata 不得声称可以恢复 Chrome 已丢弃的 `:443` lexical distinction

### 需求：SourceItem 拥有零或一个 Memo

系统必须允许用户为 SourceItem 保存零或一个当前个人 Memo。保存 dialog 和 SourceItem action
必须读写同一 Memo，不得创建独立 Intent 概念。

#### 场景：首次保存时填写 Memo

- **当** 用户保存新 Source 时填写非空 Memo
- **那么** Memo 保存在该 Source 上，并可从其 ListItem 和 Pinned preview 查看与编辑

#### 场景：重复保存时没有填写 Memo

- **当** 已有 Source 拥有 Memo，且重复保存请求没有提供 Memo
- **那么** 系统保留已有 Memo

#### 场景：编辑或删除 Memo

- **当** 用户从任何 SourceItem 选择 Add/Edit Memo
- **那么** 更新该 Source 唯一的当前 Memo
- **而且** 只有明确删除操作可以将 Memo 设为空

### 需求：SourceItem 提供共享的复制 actions

Inbox 和任意 Project 中的 SourceItem 必须提供相同的“复制链接”和“复制链接与标题
（Markdown 格式）” actions。

#### 场景：复制 SourceItem 的 Markdown 链接

- **当** 用户从 Inbox 或 Project 中的 SourceItem 选择“复制链接与标题（Markdown 格式）”
- **那么** 剪贴板获得 `- [title](link)` 格式的单条 Markdown 列表项
- **而且** title 和 link 中会破坏 Markdown 语法的字符被正确转义

### 需求：Sources 可以属于多个 Projects

系统必须允许一个 Source 关联到零个或多个 user-owned Projects，且不指定 primary Project。
membership 不得引用 originating Capture。

#### 场景：Source 关联两个 Projects

- **当** 用户为一个 Source 选择两个 Projects
- **那么** 两个 memberships 都被保存，二者均不被视为 primary

#### 场景：从 Project row 快速保存当前 tab

- **当** 用户点击某个 Project 右侧的“保存当前链接”按钮
- **那么** 系统直接将 active tab 的 Source 加入该 Project，不打开保存 dialog
- **而且** 按钮显示请求中与成功状态，Project 保持当前展开状态
- **而且** 成功结果直接更新本地列表，不进行整体刷新或显示成功 banner

#### 场景：快速保存已属于其他 Projects 的 Source

- **当** active tab 的 Source 已属于一个或多个其他 Projects
- **那么** 系统追加目标 Project membership，并保留已有 memberships
- **而且** 如果 Source 已属于目标 Project，则不创建重复 item

### 需求：Pin 是 SourceItem 的全局个人状态

系统必须允许用户从 Inbox 或任意 Project 中的 SourceItem Pin 或 Unpin Source。Pin 不得改变
Source 的 Inbox/Project 归属。

#### 场景：从 Project 中 Pin Source

- **当** 用户从一个 Project 内 Pin 同时属于多个 Projects 的 Source
- **那么** 该 Source 只产生一个全局 pinned state，并继续保留全部 memberships

#### 场景：取消 Pin

- **当** 用户从普通 SourceItem 或 Pinned preview 执行 Unpin
- **那么** Source 从 Pinned section 消失，但仍保留在原 Inbox/Projects 视图

### 需求：Pinned section 使用紧凑 avatar grid

Side Panel 必须在 Projects 下方以 Pinned section 展示 pinned Sources。每个 Source 只显示一个
复用 SourceAvatar 的 avatar，并在 hover 或 keyboard focus 时提供 Source preview。

#### 场景：没有 pinned Sources

- **当** 用户没有 pinned Source
- **那么** Side Panel 不渲染空 Pinned section

#### 场景：预览 pinned Source

- **当** 用户 hover 或 keyboard focus pinned avatar
- **那么** preview 展示 Source identity、当前 Memo、Project names 和加入时间
- **而且** preview 提供与普通 SourceItem 一致的 contextual actions
- **而且** preview 不展示 Capture、保存次数或 Intent history

#### 场景：窄 Side Panel 中存在多个 pinned Sources

- **当** pinned avatars 超出单行宽度
- **那么** grid 自动换行，并保持紧凑、一致的 avatar 尺寸和 accessible targets

## 移除需求

### 需求：Sources 去重但不丢失保存历史

**移除原因**：Reading List 风格的 SourceItem 以 Chrome-provided 完整 URL 为 key，不将相同 key
的重复保存建模为历史事件，也不对不同 keys 做语义合并。

**迁移**：先使用 Capture captured URLs 将旧 canonical Source 拆回 distinct URL-key Sources，
再迁移加入时间并删除 Capture history。

### 需求：Capture Intent 对用户可选且无需分类

**移除原因**：用户文字统一为 Source 级 Memo，不再属于 Capture。

**迁移**：每个 Source 最近一条非空 Intent 提升为当前 Memo，其余 Intent rows 删除。
