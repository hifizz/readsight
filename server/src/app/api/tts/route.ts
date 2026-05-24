/**
 * GET /api/tts?text=...&voice=...
 *
 * 走 synthesizeSpeech 主管道（cache → MiniMax T2A v2 → 入缓存）。
 * 直接返 mp3 字节 + 正确 Content-Type，前端 `new Audio(URL.createObjectURL(blob))` 直接放。
 *
 * GET 用 query 是为了 `<audio src>` 能直接吃；text 限 600 字符以内（MiniMax 单次
 * 上限 10000 字符，但 URL 太长不健康，超长场景用 POST + body 才合理）。
 */
import { synthesizeSpeech } from '@/lib/tts';

export const maxDuration = 30;
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const text = url.searchParams.get('text');
  const voice = url.searchParams.get('voice') ?? undefined;
  if (!text || !text.trim()) {
    return Response.json({ error: 'missing ?text=' }, { status: 400 });
  }
  if (text.length > 600) {
    return Response.json({ error: 'text too long (>600 chars)' }, { status: 400 });
  }
  try {
    const { audio, source } = await synthesizeSpeech(text, voice);
    // 用 Uint8Array 给 Response，避免 Node Buffer 跟 Web Response 类型对不上
    return new Response(new Uint8Array(audio), {
      status: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        'Content-Length': String(audio.length),
        'X-Tts-Source': source, // 调试看是不是缓存命中
        'Cache-Control': 'public, max-age=86400',
      },
    });
  } catch (err) {
    console.error('[tts] failed', err);
    return Response.json({ error: 'tts_failed', detail: String(err) }, { status: 500 });
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204 });
}
