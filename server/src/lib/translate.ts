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
import { openrouterModel, isOpenrouterConfigured, OPENROUTER_MODEL_ID } from './openrouter';

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
    // GLM-4-Flash 偶发会在 finish=stop 时漏掉 JSON 闭合 ] 或元素间逗号。
    // 给到 6000 缓解截断；与速度无关（GLM 非推理）。
    maxOutputTokens: 6000,
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

type ErrorKind = 'content_filtered' | 'translation_failed';

/** 单段翻译结果：成功是字符串；失败是带错误类型的对象 */
type SingleResult = string | { error: ErrorKind };

/** 把原始 LLM 错误 message 分类成"用户能看懂"的几种 */
function classifyError(message: string | undefined): ErrorKind {
  if (!message) return 'translation_failed';
  // 智谱（以及大多数中国 LLM）内容审查的典型文案
  if (/敏感|不安全|sensitive|content.*filter|safety/i.test(message)) {
    return 'content_filtered';
  }
  return 'translation_failed';
}

/**
 * Divide-and-conquer 兜底：
 *   - 整批跑一次，成功就返结果
 *   - 失败时拆成左右两半递归，把 per-段 error 信息一路透传
 *   - 单段还失败 → 返 { error } 让前端区分内容审查 vs 其他错误
 *     （前者重试也没用，UI 不挂重试按钮）
 *
 * 返回值跟 texts 等长。
 */
async function translateWithFallback(
  texts: string[],
  model: LanguageModel,
): Promise<SingleResult[]> {
  if (texts.length === 0) return [];

  // 整批先试一把
  let lastErrorMsg: string | undefined;
  try {
    const arr = await callLLMBatch(texts, model, MODEL_LABEL_ZHIPU);
    if (arr) return arr;
  } catch (err) {
    lastErrorMsg = err instanceof Error ? err.message : String(err);
    console.warn(`[translate] batch(${texts.length}) threw:`, lastErrorMsg);
  }

  // 单段还失败 → 透传分类后的 error
  if (texts.length === 1) {
    return [{ error: classifyError(lastErrorMsg) }];
  }

  // 拆半递归 + 合并
  const mid = Math.floor(texts.length / 2);
  const [left, right] = await Promise.all([
    translateWithFallback(texts.slice(0, mid), model),
    translateWithFallback(texts.slice(mid), model),
  ]);
  return [...left, ...right];
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
  // 翻译入口：两层 provider 链路
  //   1) 整批走 Zhipu GLM-4-Flash（divide-and-conquer 自动拆半）
  //   2) 命中 content_filtered 的段单独走 OpenRouter（西方模型无中国式审查）
  //      —— 配置了 OPENROUTER_API_KEY 才启用；没配则直接保留 content_filtered
  //   3) translation_failed（GLM JSON 截断等可重试错误）不走 OpenRouter，
  //      让前端 retry 按钮自己再试
  const translated = await translateWithFallback(miss.map((m) => m.text), zhipuFlash);
  // 跟 translated 等长的"实际跑的模型"数组，缓存写入用
  const modelByIndex: string[] = translated.map((r) =>
    typeof r === 'string' ? MODEL_LABEL_ZHIPU : '',
  );

  // 所有 Zhipu 失败位置（content_filtered / translation_failed / 网络 /
  // RPM rate-limit 级联）全丢给 OpenRouter 重翻。
  //
  // 之前只盖 content_filtered，但实测 GLM 免费 tier 在并发 batch 下经常
  // RPM 撞墙，错误信息里没"敏感"关键字 → classifyError 归 translation_failed
  // → 不走 OpenRouter → 用户看到 5 条连续失败但手动重试又能过（间隔够大）。
  // 扩大兜底范围彻底解决这类级联失败。
  if (isOpenrouterConfigured() && openrouterModel) {
    const failedIndices: number[] = [];
    translated.forEach((r, i) => {
      if (typeof r !== 'string') failedIndices.push(i);
    });
    if (failedIndices.length > 0) {
      console.log(
        `[translate] ${failedIndices.length} segments failed on Zhipu, retrying via OpenRouter (${OPENROUTER_MODEL_ID})`,
      );
      const failedTexts = failedIndices.map((i) => miss[i].text);
      const orResults = await translateWithFallback(failedTexts, openrouterModel);
      for (let k = 0; k < failedIndices.length; k++) {
        const idx = failedIndices[k];
        translated[idx] = orResults[k];
        if (typeof orResults[k] === 'string') {
          modelByIndex[idx] = OPENROUTER_MODEL_ID;
        }
      }
    }
  }

  // 3) 回填 + 入缓存。translateWithFallback 返 SingleResult：
  //    string = 翻译成功；{ error } = 该段失败。失败段绝不入缓存。
  //
  //    防御：哪怕 LLM/SDK 返奇怪结构（曾出现过 [object Object] 入库的脏数据），
  //    typeof === 'string' 检查能 100% 拦住非字符串污染缓存。
  const inserts: Array<typeof translations.$inferInsert> = [];
  for (let i = 0; i < miss.length; i++) {
    const m = miss[i];
    const r = translated[i];
    if (typeof r !== 'string') {
      results[m.index] = {
        original: m.text,
        zh: '',
        source: 'llm',
        error: r.error,
      };
      continue;
    }
    // 二次防御：万一 SingleResult 类型被绕过，跑时再 stringify 检查一次
    const zhStr: string = r;
    if (!zhStr || zhStr.length === 0 || zhStr === '[object Object]') {
      console.warn('[translate] suspect zh content blocked from cache:', JSON.stringify(r).slice(0, 100));
      results[m.index] = {
        original: m.text,
        zh: '',
        source: 'llm',
        error: 'translation_failed',
      };
      continue;
    }
    results[m.index] = { original: m.text, zh: zhStr, source: 'llm' };
    inserts.push({
      hash: m.hash,
      originalText: m.text,
      zh: zhStr,
      targetLang: TARGET_LANG,
      model: modelByIndex[i] || MODEL_LABEL_ZHIPU,
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
