# Side Panel Overlay Scrollbar 与 Pinned Popover 设计

## 范围

本次仅修复两个 Side Panel 界面问题：

1. 页面出现纵向滚动时，滚动条不占用内容宽度，Project 展开前后不得发生横向布局跳动。
2. Pinned item 的 hover/focus preview 使用项目已有的 shadcn/ui `Popover`，删除手写的绝对定位浮层。

嵌套 Project 不在本次改动中，后续另行设计和实现。

## 滚动区域

- 在 Side Panel 主内容区域使用项目已有的 shadcn/ui `ScrollArea`。
- Side Panel 外壳固定为视口高度并使用纵向 flex 布局，header 保持固定，内容区域独立滚动。
- Radix ScrollArea 的 scrollbar 覆盖在 viewport 上方，不为 scrollbar 预留内容宽度。
- scrollbar 默认低干扰，仅在 hover、滚动或可见状态下呈现；不得改变 Project row、Source row 或展开内容的可用宽度。
- 保留键盘滚动、触控滚动和 overscroll 行为。

## Pinned preview

- `PinnedItem` 使用 shadcn/ui `Popover`、`PopoverTrigger` 和 `PopoverContent`。
- Popover 使用 Portal 和 collision detection，在窄 Side Panel 内自动避让边缘。
- 受控 open state 同时支持 pointer hover、trigger focus 与点击。
- 指针从 trigger 移到 content 时 preview 保持打开；离开 trigger 和 content 后短暂延迟关闭，避免跨越间距时闪退。
- content 内的取消置顶操作继续可点击，并保留 Source identity、Memo、Projects 与加入时间。
- Escape、外部点击和失焦可以关闭 Popover。

## 错误与兼容

- 本次不新增 API、数据库字段或持久化状态。
- Pin mutation 失败时沿用现有行为，不在此次样式修复中扩张错误处理范围。
- 保留用户当前对 `RelataHome.tsx`、`source-lists.tsx` 和 `style.css` 的未提交修改，只在相关代码附近做最小编辑。

## 验证

- TypeScript compile 与 extension build 通过。
- 在 Side Panel 中验证：Project 展开导致页面开始滚动时，row 宽度和文本位置不变化。
- 验证 pinned preview 的 hover、键盘 focus、点击、Escape、外部点击、边缘避让和 content 内操作。
- 浏览器交互验证遵循仓库要求，使用 `ego-browser nodejs` 工作流。
