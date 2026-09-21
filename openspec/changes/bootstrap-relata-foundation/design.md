# 设计：建立 Relata 基础

## 背景

Readsight 与 Relata 共享技术形态：Chrome MV3 extension、Side Panel、Next.js API、
PostgreSQL 和 authenticated AI requests；但二者不共享产品领域。安全的复用边界是基础设施，
而不是旧 entities 或 UI flows。

## 目标

- 产出最小且一致的 Relata application shell。
- 保留可工作的 authentication 与 quota 基础，而不保留 Readsight 概念。
- 确保没有活动产品界面声称提供翻译或语言学习。
- 建立后续 Relata changes 可依赖的 namespaces。

## 非目标

- 保存 tabs 或 Sources。
- Projects、Inbox 或 Reading List import。
- AI analysis、conversation、search、relationships 或 tools。
- 最终 logo 设计或生产 domain 选型。
- 迁移任何 Readsight database 或 Chrome storage 数据。

## 决策

### 干净的数据库基线

Relata 使用 `pgSchema('relata')` 和 Relata 专属 migration history。Better Auth tables 与 quota
tables 在该 namespace 中从干净基线创建。Readsight tables 不做重命名，因为其语义不正确。

### 选择性复用代码

可复用候选包括通用 UI primitives、styling infrastructure、auth helpers、session refresh、
authenticated fetch、CORS handling、quota reservation 和 extension/background/sidepanel wiring。
change 完成后，任何保留模块都不得含有 Readsight 领域假设。

### 有意重置状态

全部 storage、context-menu、shadow-host、CSS、log 与 message identifiers 都使用 `relata`
前缀；不读取 `readsight` keys 作为 fallback。

### 最小 shell

authenticated users 进入可供下一 Capture change 使用的最小 Relata Side Panel shell。signed-out
users 保留 registration 与 sign-in。不存在空的 learning-record 或 translation controls。

### 品牌处理

可见身份为 `Relata`。已确认 Slogan 只在需要产品描述处展示，不在所有界面重复。可引入绿色
tokens 作为临时品牌 token。旧黄色书本 icon 不视为 Relata asset。

## 风险

- 仍引用旧 table 或 storage 名称的 auth code 会产生部分状态和 authorization bugs。
  缓解：对干净 database 做 static prefix audit 与 auth integration tests。
- 删除旧产品代码时可能误删有用的通用 extraction 或 messaging code。
  缓解：只保留有明确 Relata consumer 的代码。
- 多个 active OpenSpec changes 可能依赖不稳定的 shell。
  缓解：在 capture core 前先落地本 change。

## 发布

这是干净的开发基线，不是生产迁移。构建新的 extension package 和 database schema；不指向
Readsight database，也不承诺升级兼容性。
