/**
 * GET /api/lookup?word=outed
 *
 * 走 lookupWord() 主管道（lemma 还原 → DB 缓存 → Free Dictionary → LLM 兜底）。
 * 单词级查询不需要流式，直接 JSON 返回。
 *
 * 这条路由配合 sidepanel 的 WordCard：选区类型 = 'word' 时前端 fetch 一下。
 */
import { lookupWord } from '@/lib/lookup';

export const maxDuration = 15;
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const word = url.searchParams.get('word');
  if (!word) {
    return Response.json({ error: 'missing ?word=' }, { status: 400 });
  }
  try {
    const result = await lookupWord(word);
    return Response.json(result);
  } catch (err) {
    console.error('[lookup] failed', err);
    return Response.json({ error: 'lookup_failed' }, { status: 500 });
  }
}

// CORS 预检见 next.config.ts 全局头。
export async function OPTIONS() {
  return new Response(null, { status: 204 });
}
