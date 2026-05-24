/**
 * 全文翻译主管道（PRD §7.1）。
 *
 * 走 Zhipu GLM-4-Flash（M2 lookup 翻译同款）—— 非 thinking 模型、便宜、
 * 中文母语、200-400ms 响应。同一段文本第二次出现走 cache 0 token。
 *
 * 接口：translateBatch(['段1','段2',...]) → 每段独立 result，PRD §10
 * 按块独立失败：任一段 LLM 出问题不阻塞其他段。
 *
 * 实现策略：
 *   1. 先批量 SELECT 缓存（按 hash IN 查询去重命中）
 *   2. 未命中的段做一次 LLM 批量调用（同 lookup 的 JSON array in/out 模式）
 *   3. 把翻译写回缓存 + 拼成跟入参等长的 results 数组返回
 *   4. 单段 LLM 失败 → 该 result 带 `error: '...'`、`zh: ''`，调用方决定显示策略
 *
 * 用 undici fetch 绕开 Next.js Turbopack 的 fetch patch（M2 lookup 学到的坑）。
 */
import crypto from 'node:crypto';
import { generateText, type LanguageModel } from 'ai';
import { inArray } from 'drizzle-orm';
import { db } from '@/db/client';
import { translations } from '@/db/schema';
import { zhipuFlash, isZhipuConfigured } from './zhipu';
import { minimax, DEFAULT_MODEL_ID } from './minimax';

const TARGET_LANG = 'zh-CN' as const;
const MODEL_LABEL_ZHIPU = 'glm-4-flash';
const MODEL_LABEL_MINIMAX = DEFAULT_MODEL_ID;

export interface TranslateResult {
  original: string;
  zh: string;
  source: 'cache' | 'llm';
  error?: string;
}

/** sha256(model + lang + text) → 缓存主键。 */
function hashKey(model: string, lang: string, text: string): string {
  return crypto.createHash('sha256').update(`${model}|${lang}|${text}`).digest('hex');
}

/** 跳过明显不该翻的输入（空 / 太短 / 纯标点） */
function shouldSkip(text: string): boolean {
  const t = text.trim();
  if (t.length < 2) return true;
  if (!/[a-zA-Z]/.test(t)) return true; // 没字母 = 纯标点/数字
  return false;
}

/**
 * 调一次 LLM 批量翻译。失败抛错由上层捕获。
 */
async function callLLMBatch(
  texts: string[],
  model: LanguageModel,
  modelLabel: string,
): Promise<string[] | null> {
  const prompt = [
    'You translate English text into natural, fluent Simplified Chinese.',
    'Preserve tone, paragraph structure, and any technical terms (keep brand names / acronyms as-is).',
    'Do NOT translate code snippets, URLs, or numbers.',
    '',
    'Rules:',
    '- Each output gloss should read like native Chinese writing, not literal word-for-word.',
    '- Keep paragraph length proportionate to the original.',
    '- Do NOT add commentary, prefixes, or numbering.',
    '',
    `Input (JSON array of ${texts.length} English paragraphs):`,
    JSON.stringify(texts),
    '',
    `Output: ONLY a JSON array of exactly ${texts.length} Chinese strings, parallel-indexed. No prose, no code fences.`,
  ].join('\n');

  const result = await generateText({
    model,
    prompt,
    // GLM-4-Flash 非推理模型，输出快；按 5 段 × 300 字符算 max 1500 token 输出
    maxOutputTokens: 2500,
  });
  const text = result.text;
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start < 0 || end <= start) {
    console.warn(`[translate] ${modelLabel}: no JSON array, finish=${result.finishReason}, raw=${text.slice(0, 200)}`);
    return null;
  }
  try {
    const arr = JSON.parse(text.slice(start, end + 1)) as unknown;
    if (
      !Array.isArray(arr) ||
      arr.length !== texts.length ||
      !arr.every((s) => typeof s === 'string')
    ) {
      console.warn(
        `[translate] ${modelLabel}: shape mismatch, got=${Array.isArray(arr) ? arr.length : 'non-array'}, expected=${texts.length}`,
      );
      return null;
    }
    return arr as string[];
  } catch (err) {
    console.warn(`[translate] ${modelLabel}: JSON.parse threw`, err);
    return null;
  }
}

/**
 * 批量翻译。
 *
 * @param texts 待翻译段落（原顺序），元素长度任意；空 / 纯标点的会原样返回标 error
 * @returns 跟入参等长的 results，按 index 对齐
 */
export async function translateBatch(texts: string[]): Promise<TranslateResult[]> {
  // 占位结果数组
  const results: TranslateResult[] = texts.map((t) => ({
    original: t,
    zh: '',
    source: 'cache',
  }));

  // 标记哪些需要翻 / 哪些跳过
  const needTranslate: Array<{ index: number; text: string; hash: string }> = [];
  for (let i = 0; i < texts.length; i++) {
    const t = texts[i];
    if (shouldSkip(t)) {
      results[i] = { original: t, zh: t, source: 'cache' }; // 跳过的原样回
      continue;
    }
    const hash = hashKey(MODEL_LABEL_ZHIPU, TARGET_LANG, t);
    needTranslate.push({ index: i, text: t, hash });
  }
  if (needTranslate.length === 0) return results;

  // 1) 批量查 cache
  const hashes = needTranslate.map((n) => n.hash);
  const cached = await db
    .select()
    .from(translations)
    .where(inArray(translations.hash, hashes));
  const cacheMap = new Map(cached.map((r) => [r.hash, r.zh]));

  // 命中的填进 results，剩下的进 miss 队列等 LLM
  const miss: Array<{ index: number; text: string; hash: string }> = [];
  for (const item of needTranslate) {
    const hit = cacheMap.get(item.hash);
    if (hit !== undefined) {
      results[item.index] = { original: item.text, zh: hit, source: 'cache' };
    } else {
      miss.push(item);
    }
  }
  if (miss.length === 0) return results;

  // 2) LLM 批量翻译 miss 段
  //    首选 Zhipu GLM-4-Flash（M2 Phase D 接好），失败 fallback MiniMax thinking
  let translated: string[] | null = null;
  let usedModel = MODEL_LABEL_ZHIPU;

  if (isZhipuConfigured() && zhipuFlash) {
    try {
      translated = await callLLMBatch(miss.map((m) => m.text), zhipuFlash, MODEL_LABEL_ZHIPU);
    } catch (err) {
      console.warn(
        `[translate] zhipu threw, falling back to MiniMax:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
  if (!translated) {
    try {
      usedModel = MODEL_LABEL_MINIMAX;
      translated = await callLLMBatch(miss.map((m) => m.text), minimax(DEFAULT_MODEL_ID), MODEL_LABEL_MINIMAX);
    } catch (err) {
      console.warn(`[translate] MiniMax also threw:`, err);
    }
  }

  if (!translated) {
    // 整批失败：把 miss 全部标 error
    for (const m of miss) {
      results[m.index] = {
        original: m.text,
        zh: '',
        source: 'llm',
        error: 'translation_failed',
      };
    }
    return results;
  }

  // 3) 回填 + 入缓存（写库时按 zhipu 模型 hash，跟读时一致）
  const inserts: Array<typeof translations.$inferInsert> = [];
  for (let i = 0; i < miss.length; i++) {
    const m = miss[i];
    const zh = translated[i];
    results[m.index] = { original: m.text, zh, source: 'llm' };
    // 用同样的 hash（基于 ZHIPU 模型名计算）写库，下次读 zhipu cache 能命中
    // 即使本次实际跑的是 MiniMax fallback，缓存 key 仍按 zhipu —— 因为 cache 是
    // "这段文本的中文翻译"，跟翻它的模型本身关系不大，要的是稳定 key
    inserts.push({
      hash: m.hash,
      originalText: m.text,
      zh,
      targetLang: TARGET_LANG,
      model: usedModel, // 记录实际跑的模型，便于排查
    });
  }
  if (inserts.length > 0) {
    try {
      await db.insert(translations).values(inserts).onConflictDoNothing();
    } catch (err) {
      console.warn(`[translate] cache insert failed`, err);
    }
  }

  return results;
}
