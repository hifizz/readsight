/**
 * EncounterEvent 写库工具（PRD §5.2 / §7.3）。
 *
 * 用 fire-and-forget 心智：所有调用方期望"埋点失败不影响主流程"，所以
 * 内部 try/catch 兜住一切异常，只 warn 不 throw。
 */
import crypto from 'node:crypto';
import { and, eq, gte, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { encounterEvents } from '@/db/schema';

export type EncounterEventType =
  | 'lookup'
  | 'quick'
  | 'deepchat'
  | 'passive_reencounter';

export type EncounterOutcome = 'understood' | 'still_unsure';

export interface RecordEncounterInput {
  surfaceForm: string;
  itemKey: string;
  /** SelectionContext.id；不带选区时（理论上不应该）传 null 让 FK 不挂 */
  contextRef: string | null;
  eventType: EncounterEventType;
  outcome?: EncounterOutcome;
}

export async function recordEncounter(input: RecordEncounterInput): Promise<void> {
  try {
    if (!input.contextRef) {
      // 没有选区的事件目前不入库 —— encounter_events.context_ref 是 NOT NULL，
      // 而且没语境的查询对 FSRS 不可分析。直接静默丢弃。
      return;
    }
    await db.insert(encounterEvents).values({
      id: crypto.randomUUID(),
      itemKey: input.itemKey,
      surfaceForm: input.surfaceForm,
      contextRef: input.contextRef,
      eventType: input.eventType,
      outcome: input.outcome,
    });
  } catch (err) {
    console.warn('[encounter] insert failed', err);
  }
}

/**
 * passive_reencounter 专用：同一天同一篇文章同一 itemKey 只记一次。
 * 减少噪声 + 防止打点风暴。
 */
export async function recordPassiveReencounterDeduped(input: {
  surfaceForm: string;
  itemKey: string;
  contextRef: string;
}): Promise<{ written: boolean }> {
  try {
    // 当天此 itemKey 是否已有 passive 事件？
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const existing = await db
      .select({ id: encounterEvents.id })
      .from(encounterEvents)
      .where(
        and(
          eq(encounterEvents.itemKey, input.itemKey),
          eq(encounterEvents.eventType, 'passive_reencounter'),
          gte(encounterEvents.ts, oneDayAgo),
          // 同一篇文章：通过 selection_contexts.url 关联，简化为同 contextRef
          // 如果不同 contextRef 但同 url 也想去重，可以改 join；本期先用 contextRef 粗匹
          sql`${encounterEvents.contextRef} = ${input.contextRef}`,
        ),
      )
      .limit(1);
    if (existing.length > 0) return { written: false };

    await db.insert(encounterEvents).values({
      id: crypto.randomUUID(),
      itemKey: input.itemKey,
      surfaceForm: input.surfaceForm,
      contextRef: input.contextRef,
      eventType: 'passive_reencounter',
    });
    return { written: true };
  } catch (err) {
    console.warn('[encounter] passive insert failed', err);
    return { written: false };
  }
}
