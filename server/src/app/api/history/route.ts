/**
 * GET /api/history —— 按 itemKey 聚合的学习记录列表（PRD §7.3 / §8.3）。
 *
 * query:
 *   ?limit=20      默认 20 上限 100
 *   ?before=<iso>  时间游标，返回 lastTs < before 的下一页
 *
 * 返回结构：
 *   {
 *     items: [{
 *       itemKey: "out#noun",
 *       lastSurfaceForm: "outed",          // 该 itemKey 最近一次出现的形态
 *       lastTs: "2026-05-24T...",
 *       lastContextRef: "<selection_id>",  // 跳回原文 / 加载语境用
 *       totalCount: 5,                     // 该 itemKey 总事件数
 *       eventTypes: ["lookup","deepchat"]  // 出现过的事件类型
 *     }],
 *     nextCursor: "2026-05-23T..." | null
 *   }
 *
 * 当前单用户本期不带 user_id 过滤，等加身份层再补。
 */
import { sql, desc, lt } from 'drizzle-orm';
import { db } from '@/db/client';
import { encounterEvents } from '@/db/schema';

export const maxDuration = 10;
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const limit = Math.min(Number(url.searchParams.get('limit')) || 20, 100);
  const beforeParam = url.searchParams.get('before');
  const before = beforeParam ? new Date(beforeParam) : null;

  try {
    // 子查询：每个 itemKey 找出最近一行 + 聚合
    // 用 row_number() 拿最近一行的 surfaceForm 和 contextRef
    const rows = await db
      .select({
        itemKey: encounterEvents.itemKey,
        lastTs: sql<Date>`MAX(${encounterEvents.ts})`.as('last_ts'),
        totalCount: sql<number>`COUNT(*)::int`.as('total_count'),
        eventTypes: sql<string[]>`ARRAY_AGG(DISTINCT ${encounterEvents.eventType})`.as('event_types'),
        lastSurfaceForm: sql<string>`(ARRAY_AGG(${encounterEvents.surfaceForm} ORDER BY ${encounterEvents.ts} DESC))[1]`.as('last_surface_form'),
        lastContextRef: sql<string>`(ARRAY_AGG(${encounterEvents.contextRef} ORDER BY ${encounterEvents.ts} DESC))[1]`.as('last_context_ref'),
      })
      .from(encounterEvents)
      .where(before ? lt(encounterEvents.ts, before) : undefined)
      .groupBy(encounterEvents.itemKey)
      .orderBy(desc(sql`last_ts`))
      .limit(limit + 1);

    const items = rows.slice(0, limit);
    const nextCursor = rows.length > limit ? items[items.length - 1].lastTs : null;

    return Response.json({
      items: items.map((r) => ({
        itemKey: r.itemKey,
        lastSurfaceForm: r.lastSurfaceForm,
        lastTs: r.lastTs,
        lastContextRef: r.lastContextRef,
        totalCount: r.totalCount,
        eventTypes: r.eventTypes,
      })),
      nextCursor,
    });
  } catch (err) {
    console.error('[history] failed', err);
    return Response.json({ error: 'history_failed', detail: String(err) }, { status: 500 });
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204 });
}
