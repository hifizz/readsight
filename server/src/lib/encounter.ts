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
  /** SelectionContext.id；passive_reencounter 传 null */
  contextRef: string | null;
  eventType: EncounterEventType;
  outcome?: EncounterOutcome;
}

export async function recordEncounter(input: RecordEncounterInput): Promise<void> {
  try {
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
 * passive_reencounter 专用：同 itemKey 每天最多记一次。
 *
 * 简化点：不按 article URL 区分（schema 也没存 URL 字段）。一天读 3 篇文章
 * 都含同一个词只算一次 passive 信号 —— 对 FSRS 来说这种弱正信号每天 1 次
 * 已经够用，可以避免打点风暴。
 */
export async function recordPassiveReencounterDeduped(input: {
  surfaceForm: string;
  itemKey: string;
}): Promise<{ written: boolean }> {
  try {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const existing = await db
      .select({ id: encounterEvents.id })
      .from(encounterEvents)
      .where(
        and(
          eq(encounterEvents.itemKey, input.itemKey),
          eq(encounterEvents.eventType, 'passive_reencounter'),
          gte(encounterEvents.ts, oneDayAgo),
        ),
      )
      .limit(1);
    if (existing.length > 0) return { written: false };

    await db.insert(encounterEvents).values({
      id: crypto.randomUUID(),
      itemKey: input.itemKey,
      surfaceForm: input.surfaceForm,
      contextRef: null,
      eventType: 'passive_reencounter',
    });
    return { written: true };
  } catch (err) {
    console.warn('[encounter] passive insert failed', err);
    return { written: false };
  }
}

/**
 * 给定 lemma，找用户历史里这个 lemma 最常用的 itemKey（首选主动事件的，
 * 一致性更好），用于 passive_reencounter 时复用同一个 itemKey。
 *
 * 找不到时 fallback 到 "${lemma}#unknown"。
 */
export async function findCanonicalItemKey(lemma: string): Promise<string> {
  try {
    const prefix = `${lemma}#`;
    // 取这个 lemma 的最近主动事件的 itemKey
    const rows = await db
      .select({ itemKey: encounterEvents.itemKey })
      .from(encounterEvents)
      .where(
        and(
          sql`${encounterEvents.itemKey} LIKE ${prefix + '%'}`,
          sql`${encounterEvents.eventType} IN ('lookup','deepchat','quick')`,
        ),
      )
      .orderBy(sql`${encounterEvents.ts} DESC`)
      .limit(1);
    if (rows.length > 0) return rows[0].itemKey;
  } catch (err) {
    console.warn('[encounter] findCanonicalItemKey failed', err);
  }
  return `${lemma}#unknown`;
}
