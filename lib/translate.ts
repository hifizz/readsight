/**
 * 本地批量翻译。缓存键 = sha256(textModel|zh-CN|text)。
 * 保留静态前缀 prompt（方便厂商做前缀缓存）和失败后的对半重试。
 * 不再做 DeepSeek → 智谱 → OpenRouter 降级，用户只有一个 provider。
 */
import { generateText, Output, type LanguageModel } from 'ai';
import { z } from 'zod';
import { db, syncStamp } from '@/lib/db';
import { parseJsonFromText } from '@/lib/json-text';
import { getLLMConfig } from '@/lib/llm-config';
import { getModels, isNoKeyError, NoKeyError } from '@/lib/llm';

const TARGET_LANG = 'zh-CN';
const TranslationsSchema = z.object({
  translations: z.array(z.string()),
});

const TRANSLATE_SYSTEM_PROMPT =
  'Translate English paragraphs to natural Simplified Chinese. ' +
  'Keep brand names, acronyms, URLs, numbers, and code as-is. ' +
  'Preserve any ⟪C<digits>⟫ token EXACTLY (code placeholder). ' +
  'No commentary or numbering. ' +
  'Return JSON: { "translations": [<N Chinese strings, parallel-indexed to input>] }\n\n' +
  'Input:\n';

export interface TranslateResult {
  original: string;
  zh: string;
  source: 'cache' | 'llm';
  error?: 'content_filtered' | 'translation_failed' | 'no_key';
}

class Semaphore {
  private active = 0;
  private queue: Array<() => void> = [];
  constructor(private readonly max: number) {}
  async acquire(): Promise<void> {
    if (this.active >= this.max) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
    this.active += 1;
  }
  release(): void {
    this.active -= 1;
    const next = this.queue.shift();
    if (next) next();
  }
}

const llmSlots = new Semaphore(2);

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function shouldSkip(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 2) return true;
  if (!/[a-zA-Z]/.test(trimmed)) return true;
  return false;
}

function classifyError(message: string | undefined): 'content_filtered' | 'translation_failed' | 'no_key' {
  if (!message) return 'translation_failed';
  if (/no_key|尚未配置 API Key|NoKeyError/i.test(message)) return 'no_key';
  if (/敏感|不安全|sensitive|content.*filter|safety/i.test(message)) return 'content_filtered';
  return 'translation_failed';
}

async function callLLMBatch(
  texts: string[],
  model: LanguageModel,
  modelLabel: string,
  structured: boolean,
): Promise<string[] | null> {
  const prompt = TRANSLATE_SYSTEM_PROMPT + JSON.stringify(texts);
  await llmSlots.acquire();
  try {
    if (structured) {
      try {
        const result = await generateText({
          model,
          output: Output.object({ schema: TranslationsSchema }),
          prompt,
          maxOutputTokens: 16_000,
        });
        const arr = result.output.translations;
        if (arr.length === texts.length && arr.every((item) => typeof item === 'string' && item.length > 0)) {
          return arr;
        }
        console.warn(`[readsight] translate ${modelLabel}: structured shape mismatch`);
      } catch (err) {
        if (isNoKeyError(err)) throw err;
        console.warn(`[readsight] translate ${modelLabel}: structured output failed, parsing text`, err);
      }
    }
    const { text } = await generateText({ model, prompt, maxOutputTokens: 16_000 });
    const parsed = parseJsonFromText(text) as { translations?: unknown } | unknown;
    const arr = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === 'object' && Array.isArray((parsed as { translations?: unknown }).translations)
        ? (parsed as { translations: unknown[] }).translations
        : null;
    if (!arr || arr.length !== texts.length || !arr.every((item) => typeof item === 'string' && item.length > 0)) {
      return null;
    }
    return arr as string[];
  } finally {
    llmSlots.release();
  }
}

type SingleResult = string | { error: 'content_filtered' | 'translation_failed' | 'no_key' };

async function translateWithFallback(
  texts: string[],
  model: LanguageModel,
  modelLabel: string,
  structured: boolean,
): Promise<SingleResult[]> {
  if (texts.length === 0) return [];
  let lastError: string | undefined;
  try {
    const arr = await callLLMBatch(texts, model, modelLabel, structured);
    if (arr) return arr;
  } catch (err) {
    if (isNoKeyError(err)) return texts.map(() => ({ error: 'no_key' as const }));
    lastError = err instanceof Error ? err.message : String(err);
    console.warn(`[readsight] translate batch(${texts.length}) failed`, lastError);
  }
  if (texts.length === 1) return [{ error: classifyError(lastError) }];
  const mid = Math.floor(texts.length / 2);
  const [left, right] = await Promise.all([
    translateWithFallback(texts.slice(0, mid), model, modelLabel, structured),
    translateWithFallback(texts.slice(mid), model, modelLabel, structured),
  ]);
  return [...left, ...right];
}

export async function translateBatch(texts: string[]): Promise<TranslateResult[]> {
  const results: TranslateResult[] = texts.map((text) => ({ original: text, zh: '', source: 'cache' }));
  const config = await getLLMConfig();
  const modelLabel = config.textModel || 'byok';

  const need: Array<{ index: number; text: string; hash: string }> = [];
  for (let i = 0; i < texts.length; i++) {
    const text = texts[i] ?? '';
    if (shouldSkip(text)) {
      results[i] = { original: text, zh: text, source: 'cache' };
      continue;
    }
    const hash = await sha256(`${modelLabel}|${TARGET_LANG}|${text}`);
    need.push({ index: i, text, hash });
  }
  if (need.length === 0) return results;

  const cached = await db.translations.where('hash').anyOf(need.map((item) => item.hash)).toArray();
  const cacheMap = new Map(cached.filter((row) => !row.deletedAt).map((row) => [row.hash, row.zh]));
  const miss: Array<{ index: number; text: string; hash: string }> = [];
  for (const item of need) {
    const hit = cacheMap.get(item.hash);
    if (hit !== undefined) results[item.index] = { original: item.text, zh: hit, source: 'cache' };
    else miss.push(item);
  }
  if (miss.length === 0) return results;

  let models;
  try {
    models = await getModels();
  } catch (err) {
    const error = isNoKeyError(err) || err instanceof NoKeyError ? 'no_key' as const : 'translation_failed' as const;
    for (const item of miss) {
      results[item.index] = { original: item.text, zh: '', source: 'llm', error };
    }
    return results;
  }

  const translated = await translateWithFallback(
    miss.map((item) => item.text),
    models.text,
    models.config.textModel,
    models.config.supportsStructuredOutputs,
  );

  for (let i = 0; i < miss.length; i++) {
    const item = miss[i];
    const value = translated[i];
    if (typeof value !== 'string' || !value || value === '[object Object]') {
      results[item.index] = {
        original: item.text,
        zh: '',
        source: 'llm',
        error: typeof value === 'string' ? 'translation_failed' : value?.error ?? 'translation_failed',
      };
      continue;
    }
    results[item.index] = { original: item.text, zh: value, source: 'llm' };
    try {
      await db.translations.put({
        hash: item.hash,
        zh: value,
        model: models.config.textModel,
        originalText: item.text,
        ...syncStamp(),
      });
    } catch (err) {
      console.warn('[readsight] translation cache insert failed', err);
    }
  }
  return results;
}
