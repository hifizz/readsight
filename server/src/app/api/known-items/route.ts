/**
 * GET /api/known-items
 *
 * 返回用户主动查过的 lemma 集合（去重）。Content script 启动时拉一次，
 * 用于扫文章时识别"曾查过的词"做 passive_reencounter 打点。
 *
 * 只计 lookup / deepchat / quick 这三种主动事件 —— passive 本身不让用户"已知"。
 */
import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { encounterEvents } from '@/db/schema';
import { requireUser } from '@/lib/require-user';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const authResult = await requireUser(req);
  if (!authResult.ok) return authResult.response;
  try {
    const rows = await db
      .select({ itemKey: encounterEvents.itemKey })
      .from(encounterEvents)
      .where(and(
        eq(encounterEvents.userId, authResult.user.id),
        sql`${encounterEvents.eventType} IN ('lookup','deepchat','quick')`,
      ))
      .groupBy(encounterEvents.itemKey);
    const lemmas = new Set<string>();
    for (const r of rows) {
      // itemKey 形如 "lemma#pos"，扫描器只需要 lemma 集合
      const idx = r.itemKey.indexOf('#');
      lemmas.add(idx > 0 ? r.itemKey.slice(0, idx) : r.itemKey);
    }
    return Response.json({ lemmas: Array.from(lemmas) });
  } catch (err) {
    console.error('[known-items] failed', err);
    return Response.json({ error: 'load_failed' }, { status: 500 });
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204 });
}
