# 设计：Reading List 风格的 SourceItem

## 产品模型

```text
SourceItem（每位用户 + Chrome-provided URL key 唯一）
  ├─ Memo nullable
  ├─ pinnedAt nullable
  ├─ addedAt
  └─ zero or more Project memberships
```

Capture 不再是领域对象。“Save to Relata”是对 SourceItem 的 create-or-update command，而不是
创建持久化保存事件。

## 保存数据流

```text
Current tab / selected tabs
        -> validate Chrome-provided URL
        -> 按 (user, URL key) upsert Source
        -> 更新当前 Source metadata
        -> 可选地更新 Memo
        -> 可选地替换 Project memberships
        -> 返回一个 Source state
```

多 Tab 保存仍按 item 独立执行并返回 per-item results。唯一约束使相同 URL key 的重复请求天然收敛到同一
Source；不再需要 Capture client-request ID 来阻止重复事件。

## URL identity

Source identity 必须使用 Chrome 暴露给 extension 的完整 serialized URL。Relata 只验证 URL 是否
属于支持的 scheme，不执行会改变 identity 的额外 canonicalization。

必须保留并参与 key comparison：

- query string，包括 tracking parameters；
- query parameter 的顺序和重复参数；
- fragment；
- path、trailing slash 和 percent-encoding 的 Chrome serialized form；
- 非默认显式 port。

Relata 不得删除、排序、decode 或以内容等价为由合并这些部分：

```text
https://example.com/article
https://example.com/article?utm_source=twitter&utm_campaign=launch
https://example.com/article#comments
https://example.com/article#section-3
```

以上四个 Chrome-provided URLs 是四个不同 keys，必须创建四个 SourceItems。

### Chrome serialization boundary

extension 无法获得浏览器在导航时已经丢弃的 lexical information。Chromium 会将 hostname
小写，并从 serialized HTTPS URL 中移除显式默认端口 `:443`。因此以下三个输入通过 `tab.url`
暴露给 extension 时均为 `https://example.com/article`：

```text
https://EXAMPLE.com/article
https://example.com:443/article
https://example.com/article
```

对 active/selected tab saving，三者只能对应一个 SourceItem。若未来支持保存页面中尚未导航的
raw link text，必须另行定义 identity source；本 change 不伪造 Chrome 已经丢失的信息。

### 三态更新语义

保存 command 必须区分字段缺席与显式清空：

- `memo` 缺席：保留已有 Memo；新 Source 使用 `null`。
- `memo` 为非空 text：设置或替换当前 Memo。
- `memo` 为 `null`：仅由明确的删除 Memo 操作使用。
- `projectIds` 缺席：保留已有 memberships；新 Source 留在 Inbox。
- `projectIds` 为 array：以该 array 替换 memberships；空 array 明确移回 Inbox。

重复保存可以刷新 title、original URL 和 favicon 等当前 metadata，但必须保持 `addedAt` 不变。
它不会增加保存次数，也不会产生用户可见或持久化的 history。

## 用户交互状态

### 保存 Source

```text
Save to Relata
      │
      ├─ URL key 不存在 -> 创建 SourceItem
      │                    可选设置 Memo / Projects
      │
      └─ URL key 已存在 -> 更新已有 SourceItem
                           保持 addedAt
                           memo 缺席时保留原值
                           不产生重复 item 或历史事件
```

不同 URL keys 即使看起来属于同一网页，也必须显示为不同 SourceItems。Relata 不向用户提示或
执行“可能重复”合并。

### SourceItem actions

Inbox 和 Project 中的每个 SourceItem 使用同一组 contextual actions：

- `Pin` / `Unpin`
- `Add memo` / `Edit memo`
- `关联 Project`
- `分析与讨论`
- `打开链接`

Pin、Memo 或 Project mutation 成功后，同一 Source 在 Inbox、全部 Project occurrences 和 Pinned
section 中必须同步，不得出现局部旧状态。

## Schema

### `sources`

- `id`、`user_id`
- `url_key`、`original_url`
- `title`、`favicon_url` nullable、`source_type`、`metadata`
- `memo` nullable
- `pinned_at` nullable
- `added_at`、`updated_at`

唯一约束为 `(user_id, url_key)`。`url_key` 是 Chrome-provided serialized URL，不是语义
canonical URL。`pinned_at` 同时表达 pinned state 和默认排序；使用
timestamp 而不是 boolean 避免新增另一排序字段。

### `project_sources`

- `user_id`、`project_id`、`source_id`
- `linked_at`
- `sort_order` nullable

删除 `linked_via_capture_id`。membership 的来源不再需要持久化。

### 删除的对象

- `captures`
- `intents`
- `analysis_runs.requested_by_capture_id`

## Memo

Memo 是 SourceItem 唯一的当前个人备注。保存 dialog 中原先标为 Intent 的输入改名为 Memo，
并与 ListItem 的 `Add memo` / `Edit memo` 操作读写同一个 `sources.memo`。

空白字符串在边界处 trim；trim 后为空时，普通保存 command 视为字段缺席，不得意外删除已有
Memo。删除必须由明确操作发送 `memo: null`。

AI analysis 使用 request 开始时的当前 Memo。编辑 Memo 不自动触发重新分析；后续 analysis run
使用新值，旧 analysis version 仍保留其既有 input fingerprint 和输出。

## Pin 与 Pinned section

Pin 是 Source 级全局个人状态：

- Source 在 Inbox、一个 Project 或多个 Projects 中都使用同一 pinned state。
- Pin 不移动或复制 Source，也不改变 Project memberships。
- Pinned section 对每个 Source 只展示一个 avatar。
- section 位于 Projects 之后；为空时不渲染。
- 默认按 `pinnedAt DESC` 排序，不实现 drag ordering。

```text
Inbox
  Source rows

Projects
  Project rows

Pinned
  [avatar] [avatar] [avatar] ...
```

hover 或 keyboard focus avatar 时显示 preview。preview 应允许指针进入并保持打开，且不能成为
keyboard-only 用户无法访问的信息入口。

```text
┌──────────────────────────────────┐
│ [avatar] Source title        […] │
│          domain                   │
│                                  │
│ Memo                             │
│ 用户的当前个人备注。              │
│                                  │
│ Projects  [Relata] [Research]    │
│ Added     Aug 16, 2026           │
└──────────────────────────────────┘
```

preview 不展示 Capture、保存次数或 Intent history。

### Preview interaction

- pointer hover 和 keyboard focus 都可以打开 preview。
- 指针从 avatar 移入 preview 时，preview 保持打开。
- preview 内 actions 可独立 focus 和触发，不得误触打开 Source。
- avatar grid 超出单行宽度时自动换行；preview 必须在 Side Panel viewport 内避让。
- Source 被 Unpin 后，avatar 和 preview 从 Pinned section 消失，但普通 SourceItem 保持原位。

## DRY 组件边界

共享 identity 与 actions，而不是让 row 和 grid 共用一个万能布局组件：

```text
SourceAvatar
      -> SourceIdentity
             ├-> SourceRow
             └-> PinnedSourcePreview

SourceActionsMenu
             ├-> SourceRow
             └-> PinnedSourcePreview
```

- `SourceAvatar` 唯一负责 favicon、fallback、尺寸和共同视觉样式。
- `SourceIdentity` 组合 avatar、title 和 domain。
- `SourceActionsMenu` 统一 analyze、Project、Pin/Unpin、Add/Edit Memo 和 open actions。
- `SourceRow` 保留 list row 的点击与键盘语义。
- `PinnedSourcePreview` 组合 identity、actions 和 metadata，不复用 `<li>` row DOM。

## 核心验收矩阵

| 范围 | 操作 | 预期 |
| --- | --- | --- |
| 相同 URL | 连续保存两次相同 Chrome-provided URL key | 只有一个 Source，`addedAt` 不变 |
| Tracking query | 保存原 URL 和带 UTM URL | 创建两个 Sources |
| Fragment | 保存无 fragment、`#comments`、`#section-3` | 创建三个 Sources |
| Search query | 保存 `?q=react` 和 `?q=vue` | 创建两个 Sources |
| Chrome serialization | 保存 hostname 大小写或显式默认 `:443` 最终序列化为相同 URL 的 tabs | 合并为一个 Source |
| 用户隔离 | 两名用户保存相同 URL key | 每名用户各有一个 Source |
| Memo 保留 | 已有 Memo，重复保存时 memo 缺席 | 原 Memo 不变 |
| Memo 更新 | 保存或 ListItem action 提交新 Memo | 更新同一个 Source Memo |
| Memo 删除 | 执行明确删除 Memo 操作 | Memo 设为 null |
| Pin from Inbox | Pin Inbox Source | 出现在 Pinned，同时仍留在 Inbox |
| Pin from Project | Pin Project Source | 出现在 Pinned，同时保留 memberships |
| 多 Project | 同一 pinned Source 属于多个 Projects | Pinned 中只显示一个 avatar |
| Unpin | 从普通 row 或 preview 执行 Unpin | 仅从 Pinned 消失 |
| Pinned 空态 | 用户没有 pinned Sources | 不渲染 Pinned section |
| Preview | hover 或 focus pinned avatar | 展示 identity、Memo、Projects、addedAt 和 actions |
| Keyboard | 使用 Tab 和 Enter/Space 操作 avatar、preview 和 actions | 全流程可访问且不误触 Source navigation |
| Grid 换行 | pinned avatars 超出一行 | 自动换行且尺寸、间距和 focus target 一致 |
| 多 Tab | batch 含相同和不同 URL keys | 相同 key 收敛，不同 keys 分开 |
| Partial failure | batch 含 restricted URL | 合法 items 成功，失败 item 单独报告 |
| Capture removal | 加载 list/detail 和执行 analysis | 不返回或依赖 Capture、Intent、保存次数 |

## 迁移

1. 为 Sources 增加 `url_key`、`memo`、`pinned_at` 和 `added_at`。
2. 在删除 Captures 之前，按每条 Capture 保留的 captured URL 重建 distinct URL keys；同一旧
   Source 下不同 query、fragment 或 tracking URL 必须拆为不同 SourceItems。
3. 对每个新 URL key 选择对应 Captures 中 `intents.updated_at` 最新的非空 `raw_text` 作为 Memo。
4. 将旧 Source memberships 迁移到拆分后的 SourceItems；能由 `linked_via_capture_id` 定位时精确
   归属，不能定位时必须输出审计记录，不得静默猜测。
5. 将 `first_captured_at` 或该 URL key 最早 Capture time 迁移为 `added_at`。
6. 删除 Project/analysis 的 Capture foreign keys，然后删除 Intents 和 Captures。
7. 删除 `canonical_url`、`first_captured_at`、`last_captured_at`，并将唯一约束切换为
   `(user_id, url_key)`。

迁移只允许丢弃重复保存事件本身，不得再次把 Capture history 中仍可区分的不同 URLs 合并。
执行前必须验证是否存在需要保留的生产数据，并提供 URL split、Memo promotion、ambiguous
membership 和删除记录的可审计统计。
