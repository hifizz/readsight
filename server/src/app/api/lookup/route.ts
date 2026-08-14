/**
 * /api/lookup —— 单词查询 + EncounterEvent 落库。
 *
 * GET `?word=...`：纯查询，不带语境、不写事件。给 curl 调试用。
 * POST `{ word, selectionContext? }`：生产路径：
 *   1. upsertSelectionContext (如有)
 *   2. lookupWord
 *   3. recordEncounter(eventType:'lookup')
 *   前端 WordCard 走 POST。
 */
import { lookupWord } from '@/lib/lookup';
import { upsertSelectionContext, type SelectionContextDTO } from '@/lib/selection-context';
import { recordEncounter } from '@/lib/encounter';
import { requireUser } from '@/lib/require-user';
import { quotaExceededResponse, reserveUsage } from '@/lib/quota';

export const maxDuration = 15;
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const authResult = await requireUser(req);
  if (!authResult.ok) return authResult.response;
  const url = new URL(req.url);
  const word = url.searchParams.get('word');
  if (!word) {
    return Response.json({ error: 'missing ?word=' }, { status: 400 });
  }
  const quota = await reserveUsage(authResult.user.id, 'lookup_requests');
  if (!quota.allowed) return quotaExceededResponse(quota);
  try {
    const result = await lookupWord(word);
    return Response.json(result);
  } catch (err) {
    console.error('[lookup] GET failed', err);
    return Response.json({ error: 'lookup_failed' }, { status: 500 });
  }
}

interface PostBody {
  word: string;
  selectionContext?: SelectionContextDTO;
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
  if (!body.word) {
    return Response.json({ error: 'missing word' }, { status: 400 });
  }

  // upsertSelectionContext 故意 await：后续 encounter 的外键依赖它存在
  const quota = await reserveUsage(authResult.user.id, 'lookup_requests');
  if (!quota.allowed) return quotaExceededResponse(quota);

  if (body.selectionContext) {
    try {
      await upsertSelectionContext(authResult.user.id, body.selectionContext);
    } catch (err) {
      const conflict = err instanceof Error && err.message === 'selection_context_conflict';
      return Response.json(
        { error: conflict ? 'selection_context_conflict' : 'selection_context_failed' },
        { status: conflict ? 409 : 500 },
      );
    }
  }

  let result;
  try {
    result = await lookupWord(body.word);
  } catch (err) {
    console.error('[lookup] POST failed', err);
    return Response.json({ error: 'lookup_failed' }, { status: 500 });
  }

  // 事件落库 fire-and-forget，不阻塞响应
  void recordEncounter({
    userId: authResult.user.id,
    surfaceForm: body.word,
    itemKey: result.itemKey,
    contextRef: body.selectionContext?.id ?? null,
    eventType: 'lookup',
  });

  return Response.json(result);
}

export async function OPTIONS() {
  return new Response(null, { status: 204 });
}
