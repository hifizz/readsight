/**
 * POST /api/translate
 *
 * 入参：{ blocks: [{ id: string; text: string }] }
 *       (id 是前端给的 client-side block id，便于路由回去；后端不持久化)
 *
 * 出参：{ results: [{ id, zh, source, error? }] }
 *       results 按 id 对齐，长度 == blocks.length
 *
 * PRD §10：按块独立失败 —— 任一段 LLM 出错 → 该 result 带 error 字段，
 * 其他块照常返回。
 */
import { translateBatch } from '@/lib/translate';
import { requireUser } from '@/lib/require-user';
import { quotaExceededResponse, reserveUsage } from '@/lib/quota';

export const maxDuration = 30;
export const dynamic = 'force-dynamic';

interface Block {
  id: string;
  text: string;
}

interface PostBody {
  blocks: Block[];
}

export async function POST(req: Request) {
  const authResult = await requireUser(req);
  if (!authResult.ok) return authResult.response;
  let body: PostBody;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 });
  }
  if (!Array.isArray(body.blocks)) {
    return Response.json({ error: 'missing blocks[]' }, { status: 400 });
  }
  if (body.blocks.length === 0) {
    return Response.json({ results: [] });
  }
  if (body.blocks.length > 50) {
    return Response.json({ error: 'too_many_blocks (max 50)' }, { status: 400 });
  }
  const submittedCharacters = body.blocks.reduce((sum, block) => sum + (block.text?.length ?? 0), 0);
  const quota = await reserveUsage(authResult.user.id, 'translation_characters', submittedCharacters);
  if (!quota.allowed) return quotaExceededResponse(quota);

  try {
    const texts = body.blocks.map((b) => b.text);
    const batch = await translateBatch(texts);
    const results = body.blocks.map((b, i) => ({
      id: b.id,
      zh: batch[i].zh,
      source: batch[i].source,
      ...(batch[i].error ? { error: batch[i].error } : {}),
    }));
    return Response.json({ results });
  } catch (err) {
    console.error('[translate] route failed', err);
    return Response.json({ error: 'translate_failed', detail: String(err) }, { status: 500 });
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204 });
}
