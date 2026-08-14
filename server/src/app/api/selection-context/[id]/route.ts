/**
 * GET /api/selection-context/:id
 *
 * 把 DB 一行 selection_contexts 反向映射回前端的 SelectionContextDTO 形态
 * （camelCase 嵌套 + anchor jsonb 透传）。
 *
 * B.4 用法：用户在 Records 列表点条目 → fetch 这个端点拿完整语境 → setState
 * 进 sidepanel 顶部 ContextCard。
 */
import { and, eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { selectionContexts } from '@/db/schema';
import type { SelectionContextDTO } from '@/lib/selection-context';
import { requireUser } from '@/lib/require-user';

export const dynamic = 'force-dynamic';

export async function GET(req: Request, ctx: RouteContext<'/api/selection-context/[id]'>) {
  const authResult = await requireUser(req);
  if (!authResult.ok) return authResult.response;
  const { id } = await ctx.params;
  if (!id) {
    return Response.json({ error: 'missing id' }, { status: 400 });
  }
  try {
    const rows = await db
      .select()
      .from(selectionContexts)
      .where(and(eq(selectionContexts.id, id), eq(selectionContexts.userId, authResult.user.id)))
      .limit(1);
    if (rows.length === 0) {
      return Response.json({ error: 'not_found' }, { status: 404 });
    }
    const r = rows[0];
    const dto: SelectionContextDTO = {
      id: r.id,
      capturedAt: r.capturedAt.toISOString(),
      source: {
        url: r.url,
        title: r.title,
        siteId: r.siteId,
        heading: r.heading ?? undefined,
      },
      selection: {
        text: r.selectionText,
        type: r.selectionType,
        range: [r.rangeStart, r.rangeEnd],
      },
      context: {
        sentence: r.sentence,
        paragraph: r.paragraph,
      },
      anchor: r.anchor,
    };
    return Response.json(dto);
  } catch (err) {
    console.error('[selection-context] get failed', err);
    return Response.json({ error: 'load_failed' }, { status: 500 });
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204 });
}
