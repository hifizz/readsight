/**
 * POST /api/encounter
 *
 * 批量上报 passive_reencounter（PRD §5.2 弱正信号）。
 *
 * 入参：
 *   { items: [{ surfaceForm: "outed", lemma: "out" }, ...] }
 *
 * 后端：
 *   1. 每个 lemma 用 findCanonicalItemKey 找出用户历史里最常用的 itemKey
 *      （继承主动事件的 lemma#pos，保持 itemKey 一致性）
 *   2. recordPassiveReencounterDeduped 写库；同 itemKey 当天已有就 skip
 *
 * 返回 { written, skipped } 计数，方便前端调试。
 */
import { findCanonicalItemKey, recordPassiveReencounterDeduped } from '@/lib/encounter';

export const dynamic = 'force-dynamic';

interface Body {
  items: Array<{ surfaceForm: string; lemma: string }>;
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 });
  }
  if (!Array.isArray(body.items)) {
    return Response.json({ error: 'missing items[]' }, { status: 400 });
  }

  let written = 0;
  let skipped = 0;
  for (const item of body.items.slice(0, 200)) {  // 上限防恶意刷
    if (!item.lemma || !item.surfaceForm) continue;
    const itemKey = await findCanonicalItemKey(item.lemma);
    const r = await recordPassiveReencounterDeduped({
      surfaceForm: item.surfaceForm,
      itemKey,
    });
    if (r.written) written += 1;
    else skipped += 1;
  }
  return Response.json({ written, skipped });
}

export async function OPTIONS() {
  return new Response(null, { status: 204 });
}
