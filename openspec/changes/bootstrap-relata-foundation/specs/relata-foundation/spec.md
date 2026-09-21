## 新增需求

### 需求：活动产品身份为 Relata
extension 与 server 必须将产品标识为 `Relata`，并在展示产品描述的位置使用确认的 Slogan。

#### 场景：用户查看已安装的 extension
- **当** 用户查看 extension 名称、tooltip、signed-out screen 或主 Side Panel shell
- **那么** 可见身份为 Relata，不展示 Readsight 或中文旧品牌

### 需求：运行时 namespace 属于 Relata
活动的 storage keys、database schemas、migration history、menu identifiers、logs、CSS
namespaces 和 request metadata 必须使用 Relata 专属名称。

#### 场景：审核干净的 Relata build
- **当** 扫描活动 source 与生成的 manifest output
- **那么** 不存在活动的 `readsight` storage/database/runtime namespace，也不读取旧本地状态

### 需求：不存在 Readsight 产品行为
Relata application 不得暴露 translation、word lookup、pronunciation、learning history 或
encounter-tracking 行为。

#### 场景：authenticated user 打开 Relata
- **当** 渲染 authenticated Side Panel 和可用的 context menus
- **那么** 不存在 Readsight learning 或 translation controls

### 需求：保留自托管账户边界
Relata 必须支持自托管邮箱/密码 registration、bearer-backed sessions、sign-in、sign-out、
authenticated API boundaries 和 per-user usage controls，且不迁移 Readsight accounts。

#### 场景：两名新的 Relata users 使用服务
- **当** 两名用户分别 sign-in 并访问受保护的 Relata resources
- **那么** server 只从每个可撤销 session 解析所有权，quota usage 按用户隔离

### 需求：视觉身份有意保持临时
Relata 必须使用克制的绿色 accent 方向，并将任何初始 icon 视为临时，直至提供最终 brand
assets。

#### 场景：发布临时 assets
- **当** 最终 icon 尚未就绪时构建初版 Relata extension
- **那么** 不使用 Readsight 黄色书本身份，文档也不将临时标记称为最终 logo
