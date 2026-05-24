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

const TARGET_LANG = 'zh-CN' as const;
const MODEL_LABEL_ZHIPU = 'glm-4-flash';

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
    '- CRITICAL: Preserve any token matching the pattern ⟪C followed by digits then ⟫ (e.g. ⟪C1⟫, ⟪C2⟫) EXACTLY as-is. These are placeholders for code identifiers — never translate or modify them. Keep them in the natural position they would occupy in the Chinese sentence.',
    '',
    `Input (JSON array of ${texts.length} English paragraphs):`,
    JSON.stringify(texts),
    '',
    `Output: ONLY a JSON array of exactly ${texts.length} Chinese strings, parallel-indexed. No prose, no code fences.`,
  ].join('\n');

  const result = await generateText({
    model,
    prompt,
    // GLM-4-Flash 非推理模型；5 段长 paragraph (~300 字符 / 段) 中文输出可达
    // ~2500 tokens。给到 4000 留余量避免截断 JSON。
    maxOutputTokens: 4000,
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
 * Divide-and-conquer 兜底：
 *   - 一把跑整批，成功就返结果
 *   - 失败时拆成左右两半递归；单段还失败 → 该段位置返空串（让外层标 error）
 * 这样个别段 token 截断 / 单段 GLM 配额抖动不再殃及全批。
 *
 * 返回值跟 texts 等长；对应位置为 '' 表示翻译失败。
 */
async function translateWithFallback(
  texts: string[],
  model: LanguageModel,
): Promise<string[] | null> {
  if (texts.length === 0) return [];

  // 整批先试一把
  try {
    const arr = await callLLMBatch(texts, model, MODEL_LABEL_ZHIPU);
    if (arr) return arr;
  } catch (err) {
    console.warn(`[translate] batch(${texts.length}) threw:`, err instanceof Error ? err.message : err);
  }

  // 整批失败：单段直接返 null 让外层标 error
  if (texts.length === 1) return null;

  // 拆半递归
  const mid = Math.floor(texts.length / 2);
  const [left, right] = await Promise.all([
    translateWithFallback(texts.slice(0, mid), model),
    translateWithFallback(texts.slice(mid), model),
  ]);
  // 合并：对应位置缺失（null）的用空串占位，由外层标 error
  const merged: string[] = [];
  for (let i = 0; i < texts.length; i++) {
    const arr = i < mid ? left : right;
    const idx = i < mid ? i : i - mid;
    merged.push(arr?.[idx] ?? '');
  }
  return merged;
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

  // 2) LLM 批量翻译 miss 段 —— 纯 Zhipu GLM-4-Flash 路径
  //    用户决策：去掉 MiniMax 兜底，GLM 失败就走前端 retry 按钮，更清爽
  if (!isZhipuConfigured() || !zhipuFlash) {
    for (const m of miss) {
      results[m.index] = {
        original: m.text,
        zh: '',
        source: 'llm',
        error: 'zhipu_not_configured',
      };
    }
    return results;
  }
  // 翻译入口：先按整批跑；失败则 divide-and-conquer 拆半递归，
  // 单段还失败才真返 error。这样 1/5 段 token 截断 / RPM 撞墙不再殃及整批。
  const translated = await translateWithFallback(miss.map((m) => m.text), zhipuFlash);
  if (!translated) {
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

  // 3) 回填 + 入缓存。divide-and-conquer 返空串表示该段单独失败；
  //    标 error 让前端挂"重试"，并且空译文绝不入缓存。
  const inserts: Array<typeof translations.$inferInsert> = [];
  for (let i = 0; i < miss.length; i++) {
    const m = miss[i];
    const zh = translated[i];
    if (!zh) {
      results[m.index] = {
        original: m.text,
        zh: '',
        source: 'llm',
        error: 'translation_failed',
      };
      continue;
    }
    results[m.index] = { original: m.text, zh, source: 'llm' };
    inserts.push({
      hash: m.hash,
      originalText: m.text,
      zh,
      targetLang: TARGET_LANG,
      model: MODEL_LABEL_ZHIPU,
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
