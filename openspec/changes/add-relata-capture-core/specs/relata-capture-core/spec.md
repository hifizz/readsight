## 新增需求

### 需求：用户可以采集一个或多个 tabs
extension 必须让 authenticated user 通过 `Save to Relata` 保存 active tab，以及 tab strip 中
全部 eligible selected tabs。

#### 场景：保存多个 selected tabs
- **当** 用户在多个 eligible tabs 被选择时调用 `Save to Relata`
- **那么** 每个 tab 都作为独立 capture 提交，用户获得每个 selected tab 的结果

#### 场景：batch 中含有 restricted tab
- **当** 一个 selected tab 不能被读取或保存
- **那么** 此 item 返回明确失败，其他 eligible items 仍然成功

### 需求：Sources 去重但不丢失保存历史
系统必须为每个 user 和 canonical URL 维护一个 Source，同时为每次成功保存 append 一条 Capture。

#### 场景：同一 URL 被保存两次
- **当** 用户保存两个 normalize 后相同 canonical URL 的 URLs
- **那么** 系统返回同一 Source，并存储两条不同的 Captures

#### 场景：不同 users 保存同一 URL
- **当** 两名 users 保存相同 canonical URL
- **那么** 每名用户获得独立拥有的 Source

### 需求：Capture Intent 对用户可选且无需分类
系统必须接受没有 Intent 的 capture；若用户提供 Intent，必须保留 raw text，且不要求选择类型。

#### 场景：用户不输入 text 即保存
- **当** 用户保存 tab 时未输入 Intent
- **那么** Capture 成功，且不创建空的 Intent row

### 需求：Sources 可以属于多个 Projects
系统必须允许一个 Source 关联到零个或多个 user-owned Projects，且不指定 primary Project。

#### 场景：Source 关联两个 Projects
- **当** 用户为一个 Source 选择两个 Projects
- **那么** 两个 memberships 都被保存，二者均不被视为 primary

### 需求：Inbox 从 Project membership 派生
系统必须将 Inbox 展示为没有 active Project membership 的未 archived Sources，且不得创建特殊 Inbox
Project record。

#### 场景：添加第一个 Project membership
- **当** Inbox Source 被关联到一个 Project
- **那么** 它不再显示在 Inbox，但仍可通过该 Project 获取

### 需求：Side Panel list 使用紧凑 Source 层级
Side Panel 必须在窄 panel 中展示 Source 的 favicon、title、domain、relative time、truncation 和
accessible contextual actions。

#### 场景：在 Side Panel 查看长列表
- **当** Source titles 超出可用宽度或存在很多 Sources
- **那么** rows 仍易于扫读，titles 安全截断，actions 保持 keyboard-accessible
