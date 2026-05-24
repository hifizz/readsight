/**
 * 全文翻译主管道（PRD §7.1）。
 *
 * 默认走 DeepSeek (`deepseek-chat`/V3)——非推理、境内 API、中文质量好。
 * Zhipu GLM-4-Flash + OpenRouter 作为兜底链。同一段文本第二次出现走 cache 0 token。
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
import { generateObject, type LanguageModel } from 'ai';
import { z } from 'zod';
import { inArray } from 'drizzle-orm';
import { db } from '@/db/client';
import { translations } from '@/db/schema';
import { zhipuFlash, isZhipuConfigured } from './zhipu';
import { openrouterModel, isOpenrouterConfigured, OPENROUTER_MODEL_ID } from './openrouter';
import { deepseekChat, isDeepseekConfigured, DEEPSEEK_MODEL_ID } from './deepseek';

const TARGET_LANG = 'zh-CN' as const;
const MODEL_LABEL_ZHIPU = 'glm-4-flash';

/**
 * 缓存哈希命名空间 —— 历史原因这里固定用 'glm-4-flash'，跟当前实际
 * 调用的模型无关。好处是切换 default provider（zhipu → deepseek）时
 * 老缓存还能命中（同一段英文不重复翻译）；坏处是缓存里看不出来这条
 * 翻译来自哪个模型，需要看 `model` 列。
 */
const CACHE_HASH_NAMESPACE = MODEL_LABEL_ZHIPU;

/**
 * 主翻 provider 顺序。
 * 默认：DeepSeek 主 → Zhipu 兜底 → OpenRouter 兜底（境内优先，跨境收尾）。
 * 通过 TRANSLATE_PRIMARY 切换主翻：'deepseek' (默认) | 'zhipu' | 'openrouter'。
 * 兜底链固定保留其余两家。
 */
interface ProviderSlot {
  name: 'deepseek' | 'zhipu' | 'openrouter';
  model: LanguageModel | null;
  configured: boolean;
  label: string;
}
function getProviderOrder(): ProviderSlot[] {
  const deepseek: ProviderSlot = {
    name: 'deepseek',
    model: deepseekChat,
    configured: isDeepseekConfigured(),
    label: DEEPSEEK_MODEL_ID,
  };
  const zhipu: ProviderSlot = {
    name: 'zhipu',
    model: zhipuFlash,
    configured: isZhipuConfigured(),
    label: MODEL_LABEL_ZHIPU,
  };
  const openrouter: ProviderSlot = {
    name: 'openrouter',
    model: openrouterModel,
    configured: isOpenrouterConfigured(),
    label: OPENROUTER_MODEL_ID,
  };
  const all = [deepseek, zhipu, openrouter];
  const primary = process.env.TRANSLATE_PRIMARY?.toLowerCase();
  if (primary === 'zhipu' || primary === 'openrouter' || primary === 'deepseek') {
    return [
      all.find((p) => p.name === primary)!,
      ...all.filter((p) => p.name !== primary),
    ];
  }
  return all; // 默认 deepseek → zhipu → openrouter
}

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
 *
 * 用 generateObject + Zod schema 走 provider 的 JSON-mode 强约束
 * （OpenAI-compatible `response_format: { type: "json_object" }`）。
 * 这把以前手写 `JSON.parse(text.slice('[',']'))` 的脆弱解析换掉 ——
 * 之前的失败模式：模型在 string 内部用没转义的 `"` 或中英混排标点
 * 会把第一道 `[` / 最后一道 `]` 之间的子串切坏。
 *
 * Schema 用包一层 `{ translations: [...] }`，因为 OpenAI json_object 模式
 * 要求顶层是 object，不接 array。
 */
const TranslationsSchema = z.object({
  translations: z.array(z.string()),
});

async function callLLMBatch(
  texts: string[],
  model: LanguageModel,
  modelLabel: string,
): Promise<string[] | null> {
  const t0 = Date.now();
  let object: z.infer<typeof TranslationsSchema>;
  let finishReason: string | undefined;
  try {
    const result = await generateObject({
      model,
      schema: TranslationsSchema,
      // 提示词留"JSON"字样 —— DeepSeek json_object 模式硬要求 prompt 含 "json"。
      prompt: [
        'Translate the English paragraphs below into natural, fluent Simplified Chinese.',
        'Preserve tone, paragraph structure, and technical terms (keep brand names / acronyms as-is).',
        'Do NOT translate code snippets, URLs, or numbers.',
        '',
        'Rules:',
        '- Read like native Chinese writing, not literal word-for-word.',
        '- Keep paragraph length proportionate to the original.',
        '- No commentary, no prefixes, no numbering.',
        '- CRITICAL: Preserve any token matching ⟪C<digits>⟫ (e.g. ⟪C1⟫, ⟪C2⟫) EXACTLY as-is — these are code placeholders.',
        '',
        `Input (${texts.length} English paragraphs, parallel-indexed):`,
        JSON.stringify(texts),
        '',
        `Return a JSON object: { "translations": [<${texts.length} Chinese strings>] }`,
      ].join('\n'),
      // DeepSeek-V3 / GLM-4-Flash / 大多数 OpenRouter free 模型默认上限 8192。
      // 我们留 8000 给译文 + JSON 框架。12 段中文 ~3000 + 框架 ~200 远低于此，
      // 但段落本身偏长（一段 200+ 词）或带占位符回填后会膨胀，留余量避免
      // finish=length 截断（截断后 generateObject 会抛 NoObjectGeneratedError）。
      maxOutputTokens: 8000,
    });
    object = result.object;
    finishReason = result.finishReason;
  } catch (err) {
    console.warn(`[translate] ${modelLabel} generateObject threw:`, err);
    throw err; // 让 translateWithFallback 兜底
  }
  const elapsed = Date.now() - t0;
  console.log(
    `[translate] ${modelLabel} batch(${texts.length}) → ${elapsed}ms, finish=${finishReason}`,
  );
  const arr = object.translations;
  if (arr.length !== texts.length) {
    console.warn(
      `[translate] ${modelLabel}: shape mismatch, got=${arr.length}, expected=${texts.length}`,
    );
    return null;
  }
  return arr;
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
  modelLabel: string,
): Promise<SingleResult[]> {
  if (texts.length === 0) return [];

  // 整批先试一把
  let lastErrorMsg: string | undefined;
  try {
    const arr = await callLLMBatch(texts, model, modelLabel);
    if (arr) return arr;
  } catch (err) {
    lastErrorMsg = err instanceof Error ? err.message : String(err);
    console.warn(`[translate] ${modelLabel} batch(${texts.length}) threw:`, lastErrorMsg);
  }

  // 单段还失败 → 透传分类后的 error
  if (texts.length === 1) {
    return [{ error: classifyError(lastErrorMsg) }];
  }

  // 拆半递归 + 合并
  const mid = Math.floor(texts.length / 2);
  const [left, right] = await Promise.all([
    translateWithFallback(texts.slice(0, mid), model, modelLabel),
    translateWithFallback(texts.slice(mid), model, modelLabel),
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
    const hash = hashKey(CACHE_HASH_NAMESPACE, TARGET_LANG, t);
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

  // 2) LLM 批量翻译 miss 段 —— 两层 provider 链路
  //    顺序由 TRANSLATE_PRIMARY env 决定：默认 zhipu 主 / openrouter 兜底，
  //    或反过来用于对比测速。
  const providers = getProviderOrder();
  const usable = providers.filter((p) => p.configured && p.model);
  if (usable.length === 0) {
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

  // 主翻：整批走第一个 provider；divide-and-conquer 自动拆半
  const [primary, ...fallbacks] = usable;
  const tPrimary0 = Date.now();
  const translated = await translateWithFallback(miss.map((m) => m.text), primary.model!, primary.label);
  console.log(`[translate] primary=${primary.label} done in ${Date.now() - tPrimary0}ms`);

  const modelByIndex: string[] = translated.map((r) =>
    typeof r === 'string' ? primary.label : '',
  );

  // 兜底链：每一层把仍失败的位置丢下一层。同样覆盖 content_filtered +
  // translation_failed + 任何错误（实测 GLM RPM 撞墙也归 translation_failed
  // 且 OpenRouter 独立 quota 能救）。
  for (const fb of fallbacks) {
    const failedIndices: number[] = [];
    translated.forEach((r, i) => {
      if (typeof r !== 'string') failedIndices.push(i);
    });
    if (failedIndices.length === 0) break;
    console.log(
      `[translate] ${failedIndices.length} segments failed, retrying via fallback=${fb.label}`,
    );
    const failedTexts = failedIndices.map((i) => miss[i].text);
    const tFb0 = Date.now();
    const fbResults = await translateWithFallback(failedTexts, fb.model!, fb.label);
    console.log(`[translate] fallback=${fb.label} done in ${Date.now() - tFb0}ms`);
    for (let k = 0; k < failedIndices.length; k++) {
      const idx = failedIndices[k];
      translated[idx] = fbResults[k];
      if (typeof fbResults[k] === 'string') {
        modelByIndex[idx] = fb.label;
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
      model: modelByIndex[i] || CACHE_HASH_NAMESPACE,
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
