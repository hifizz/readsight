/**
 * SelectionContext upsert（PRD §5.1 + §7.3）。
 *
 * 后端是唯一真相源；前端发来的 SelectionContext schema 是 camelCase 嵌套，
 * 数据库列是 snake_case 拍平 + 部分 jsonb（anchor）。这里做映射 + 幂等插入。
 */
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { selectionContexts } from '@/db/schema';

/** 与扩展端 lib/messaging.ts 的 SelectionContext 保持同步。 */
export interface SelectionContextDTO {
  id: string;
  capturedAt: string;
  source: {
    url: string;
    title: string;
    siteId: string;
    heading?: string;
  };
  selection: {
    text: string;
    type: 'word' | 'phrase' | 'sentence' | 'multi';
    range: [number, number];
  };
  context: {
    sentence: string;
    paragraph: string;
  };
  anchor: {
    quote: { exact: string; prefix: string; suffix: string };
    blockIndex?: number;
  };
}

/**
 * 幂等：如果 id 已存在直接返回；不存在则 insert。
 * @returns 行存在与否，调用方一般不关心
 */
export async function upsertSelectionContext(userId: string, ctx: SelectionContextDTO): Promise<{ created: boolean }> {
  const existing = await db
    .select({ id: selectionContexts.id, userId: selectionContexts.userId })
    .from(selectionContexts)
    .where(eq(selectionContexts.id, ctx.id))
    .limit(1);
  if (existing.length > 0) {
    if (existing[0].userId !== userId) throw new Error('selection_context_conflict');
    return { created: false };
  }

  await db.insert(selectionContexts).values({
    id: ctx.id,
    userId,
    capturedAt: new Date(ctx.capturedAt),
    url: ctx.source.url,
    title: ctx.source.title,
    siteId: ctx.source.siteId,
    heading: ctx.source.heading,
    selectionText: ctx.selection.text,
    selectionType: ctx.selection.type,
    rangeStart: ctx.selection.range[0],
    rangeEnd: ctx.selection.range[1],
    sentence: ctx.context.sentence,
    paragraph: ctx.context.paragraph,
    anchor: ctx.anchor,
  });
  return { created: true };
}
