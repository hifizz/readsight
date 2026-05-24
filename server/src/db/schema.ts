/**
 * Drizzle schema —— 对应 PRD §5.1 (SelectionContext) 与 §5.2 (EncounterEvent)，
 * 外加本期 /api/chat 写入的 chat_messages。
 *
 * 约定：
 *   - 主键全部 `text` 列，前端塞 ULID / UUID 字符串，不让 DB 操心 id 生成器
 *   - 嵌套对象（anchor、content）走 jsonb：保住灵活性，等需要查询再加列拆字段
 *   - 三个枚举 pgEnum 是 Postgres 原生 enum，跨表共享类型语义，
 *     drizzle-kit push 时自动建出 type
 *
 * 本期 schema 已经为 M2 (EncounterEvent 落库) / M4 (FSRS 调度) 留好坑位，
 * 但 `/api/chat` 暂时不写 encounter_events，PRD §5.2 落库逻辑留到下一迭代。
 */
import { pgTable, pgEnum, text, jsonb, timestamp, integer, index } from 'drizzle-orm/pg-core';

export const eventTypeEnum = pgEnum('encounter_event_type', [
  'lookup',
  'quick',
  'deepchat',
  'passive_reencounter',
]);

export const outcomeEnum = pgEnum('encounter_outcome', [
  'understood',
  'still_unsure',
]);

export const selectionTypeEnum = pgEnum('selection_type', [
  'word',
  'phrase',
  'sentence',
  'multi',
]);

export const chatRoleEnum = pgEnum('chat_role', [
  'system',
  'user',
  'assistant',
  'tool',
]);

/**
 * PRD §5.1 SelectionContext —— 划词时一次抓全，是后续查询、深聊、学习记录
 * 共同的"唯一真相源"。
 */
export const selectionContexts = pgTable('selection_contexts', {
  id: text('id').primaryKey(),
  capturedAt: timestamp('captured_at', { withTimezone: true }).notNull().defaultNow(),
  url: text('url').notNull(),
  title: text('title').notNull(),
  siteId: text('site_id').notNull(),
  heading: text('heading'),
  selectionText: text('selection_text').notNull(),
  selectionType: selectionTypeEnum('selection_type').notNull(),
  // 选区在所在段落内的字符偏移（PRD §8.2 命门一计算结果），未来"回原文高亮"用。
  rangeStart: integer('range_start').notNull(),
  rangeEnd: integer('range_end').notNull(),
  sentence: text('sentence').notNull(),
  paragraph: text('paragraph').notNull(),
  // TextQuoteSelector：{ exact, prefix, suffix }，可选 blockIndex。
  // 序列化时直接灌 jsonb；DOM 改动后还能模糊匹配回原文。
  anchor: jsonb('anchor')
    .$type<{ quote: { exact: string; prefix: string; suffix: string }; blockIndex?: number }>()
    .notNull(),
});

/**
 * PRD §5.2 EncounterEvent —— 学习模型 (FSRS / HLR) 的事件流输入。
 * 每次查询 / 深聊 / 被动重逢都产生一条，按 (用户, itemKey) 聚合成时间序列。
 *
 *   - itemKey: 后端做轻量词形还原后的 lemma + pos，跨多次遇见同一个词
 *   - surfaceForm: 本次实际见到的形态 (loves / loved / loving 都对应 lemma=love)
 *   - contextRef: 指回 selection_contexts，删父行时这里级联清掉
 *   - eventType: lookup（点查）/ quick（按快捷按钮）/ deepchat（开侧栏深聊）/
 *                passive_reencounter（已查词在新文章中再次出现且未主动查 = 弱正信号）
 *   - outcome: LLM 软评估 "解释完是否真懂" 或显式反馈
 */
export const encounterEvents = pgTable(
  'encounter_events',
  {
    id: text('id').primaryKey(),
    itemKey: text('item_key').notNull(),
    surfaceForm: text('surface_form').notNull(),
    contextRef: text('context_ref')
      .notNull()
      .references(() => selectionContexts.id, { onDelete: 'cascade' }),
    eventType: eventTypeEnum('event_type').notNull(),
    outcome: outcomeEnum('outcome'),
    ts: timestamp('ts', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // 按 lemma 聚合的高频读，单列 btree 已够。
    index('encounter_events_item_key_idx').on(t.itemKey),
    // 按时间线扫描所有事件（FSRS 算复习间隔 Δ 用）。
    index('encounter_events_ts_idx').on(t.ts),
  ],
);

/**
 * 当前 /api/chat 的简化历史。PRD §8.3 "每个选区一条线程"的本期实现：
 * threadId 直接复用 selectionContextId（前端 selectionId）。
 * content 留 jsonb：assistant-ui 一条消息可能有 text / reasoning / tool-call 多 part。
 */
export const chatMessages = pgTable(
  'chat_messages',
  {
    id: text('id').primaryKey(),
    threadId: text('thread_id').notNull(),
    selectionContextId: text('selection_context_id').references(() => selectionContexts.id, {
      onDelete: 'set null',
    }),
    role: chatRoleEnum('role').notNull(),
    content: jsonb('content').$type<unknown>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('chat_messages_thread_id_idx').on(t.threadId)],
);

export type SelectionContextRow = typeof selectionContexts.$inferSelect;
export type NewSelectionContextRow = typeof selectionContexts.$inferInsert;
export type EncounterEventRow = typeof encounterEvents.$inferSelect;
export type NewEncounterEventRow = typeof encounterEvents.$inferInsert;
export type ChatMessageRow = typeof chatMessages.$inferSelect;
export type NewChatMessageRow = typeof chatMessages.$inferInsert;
