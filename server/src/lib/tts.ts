/**
 * MiniMax T2A v2 文本转音频（PRD §6.3 Tier 2 句子精听）。
 *
 * 选 `speech-2.8-hd` 是因为它是用户的 Plus Plan 实际有额度的模型
 *   （speech-02-turbo / 2.8-turbo 这把 key 都返 "0/0 used"）。
 * MiniMax 返 hex 编码 MP3；我们 hex 落库，调用时按需 Buffer.from(hex,'hex')。
 *
 * 缓存：sha256(text+voice+model) 做 PK，同一句话第二次播放秒回。
 */
import crypto from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { ttsCache } from '@/db/schema';

const TTS_MODEL = 'speech-2.8-hd';
const DEFAULT_VOICE = 'English_radiant_girl';
const BASE_URL = 'https://api.minimaxi.com/v1/t2a_v2';

export interface SynthesizeResult {
  audio: Buffer; // 解码完的 mp3 字节
  source: 'cache' | 'minimax';
}

export async function synthesizeSpeech(
  text: string,
  voice = DEFAULT_VOICE,
): Promise<SynthesizeResult> {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('empty text');

  const hash = crypto
    .createHash('sha256')
    .update(`${TTS_MODEL}|${voice}|${trimmed}`)
    .digest('hex');

  // 1) 缓存
  const cached = await db
    .select()
    .from(ttsCache)
    .where(eq(ttsCache.hash, hash))
    .limit(1);
  if (cached.length > 0) {
    return { audio: Buffer.from(cached[0].audioHex, 'hex'), source: 'cache' };
  }

  // 2) MiniMax T2A v2
  const apiKey = process.env.MINIMAX_API_KEY;
  if (!apiKey) throw new Error('MINIMAX_API_KEY missing');

  const res = await fetch(BASE_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: TTS_MODEL,
      text: trimmed,
      voice_setting: {
        voice_id: voice,
        speed: 1.0,
        vol: 1.0,
        pitch: 0,
      },
      audio_setting: {
        sample_rate: 32000,
        bitrate: 128000,
        format: 'mp3',
        channel: 1,
      },
    }),
    signal: AbortSignal.timeout(20_000),
  });

  if (!res.ok) {
    throw new Error(`MiniMax TTS HTTP ${res.status}: ${await res.text()}`);
  }
  const json = (await res.json()) as {
    base_resp?: { status_code?: number; status_msg?: string };
    data?: { audio?: string };
  };
  if (json.base_resp?.status_code !== 0) {
    throw new Error(`MiniMax TTS error ${json.base_resp?.status_code}: ${json.base_resp?.status_msg}`);
  }
  const hex = json.data?.audio;
  if (!hex) throw new Error('MiniMax TTS returned empty audio');

  // 3) 写缓存
  await db
    .insert(ttsCache)
    .values({ hash, text: trimmed, voice, model: TTS_MODEL, audioHex: hex })
    .onConflictDoNothing();

  return { audio: Buffer.from(hex, 'hex'), source: 'minimax' };
}
