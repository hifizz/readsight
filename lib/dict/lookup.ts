/**
 * 本地查词。顺序：规范化 → lemma → IndexedDB 缓存 → Free Dictionary
 * （有 Key 时把英文释义翻成中文）→ 文本模型估计。
 * ECDICT 不打包进扩展；没命中词典时直接走模型。
 */
import { generateText } from 'ai';
import type { LookupResult } from '@/lib/messaging';
import { resolveLemma } from '@/lib/lemmatize';
import { parseJsonFromText } from '@/lib/json-text';
import { db, syncStamp } from '@/lib/db';
import { getModels, hasApiKey, isNoKeyError } from '@/lib/llm';

type LookupBody = Omit<LookupResult, 'itemKey'>;

function normalize(input: string): string {
  return input.toLowerCase().replace(/^[\p{P}\s]+|[\p{P}\s]+$/gu, '');
}

function deriveItemKey(lemma: string, partsOfSpeech: LookupResult['partsOfSpeech']): string {
  const primaryPos = partsOfSpeech[0]?.pos?.toLowerCase().replace(/\s+/g, '-') || 'unknown';
  return `${lemma}#${primaryPos}`;
}

function needsKeyResult(surfaceForm: string, lemma: string): LookupResult {
  return {
    surfaceForm,
    lemma,
    itemKey: `${lemma}#unknown`,
    partsOfSpeech: [],
    source: 'llm',
    estimated: true,
    needsKey: true,
  };
}

interface FreeDictPhonetic {
  text?: string;
  audio?: string;
}
interface FreeDictMeaning {
  partOfSpeech: string;
  definitions: Array<{ definition: string; example?: string }>;
}
interface FreeDictEntry {
  word: string;
  phonetic?: string;
  phonetics?: FreeDictPhonetic[];
  meanings?: FreeDictMeaning[];
}

async function fetchFreeDictionary(lemmaWord: string): Promise<LookupBody | null> {
  const url = `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(lemmaWord)}`;
  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(5000) });
  } catch (err) {
    console.warn('[readsight] free-dictionary fetch failed', err);
    return null;
  }
  if (!response.ok) return null;
  const entries = (await response.json()) as FreeDictEntry[];
  if (!Array.isArray(entries) || entries.length === 0) return null;

  const phonetics = entries.flatMap((entry) => entry.phonetics ?? []);
  let usIpa: string | undefined;
  let ukIpa: string | undefined;
  let audioUrl: string | undefined;
  for (const phonetic of phonetics) {
    if (!phonetic.text && !phonetic.audio) continue;
    const isUS = phonetic.audio?.includes('-us.') ?? false;
    const isUK = phonetic.audio?.includes('-uk.') ?? false;
    if (isUS && phonetic.text && !usIpa) usIpa = phonetic.text;
    if (isUK && phonetic.text && !ukIpa) ukIpa = phonetic.text;
    if (!audioUrl && phonetic.audio) audioUrl = phonetic.audio;
  }
  const anyIpa = phonetics.find((phonetic) => phonetic.text)?.text || entries[0].phonetic;
  if (!usIpa && !ukIpa && anyIpa) usIpa = anyIpa;

  const posMap = new Map<string, FreeDictMeaning['definitions']>();
  for (const meaning of entries.flatMap((entry) => entry.meanings ?? [])) {
    const existing = posMap.get(meaning.partOfSpeech) ?? [];
    posMap.set(meaning.partOfSpeech, [...existing, ...meaning.definitions]);
  }
  const partsOfSpeech = [...posMap.entries()].slice(0, 4).map(([pos, defs]) => ({
    pos,
    definitions: defs.slice(0, 2).map((def) => ({
      definition: def.definition,
      example: def.example,
    })),
  }));

  return {
    surfaceForm: lemmaWord,
    lemma: lemmaWord,
    ipa: usIpa || ukIpa ? { us: usIpa, uk: ukIpa } : undefined,
    audioUrl,
    partsOfSpeech,
    source: 'free-dictionary',
  };
}

async function translateDefinitionsToZh(
  word: string,
  partsOfSpeech: LookupResult['partsOfSpeech'],
): Promise<LookupResult['partsOfSpeech']> {
  if (!(await hasApiKey())) return partsOfSpeech;
  const { text: model } = await getModels();
  const translated = await Promise.all(partsOfSpeech.map(async (part) => {
    const defs = part.definitions.map((def) => def.definition);
    if (defs.length === 0) return part;
    const prompt = [
      `You translate English dictionary definitions into short, idiomatic Chinese glosses suitable for a dictionary lookup card. The headword being defined is "${word}" (used as ${part.pos}).`,
      '',
      'Rules:',
      '- Each gloss ≤ 20 Chinese characters when possible, ≤ 30 max.',
      '- Be concise like a real dictionary (e.g. "驱逐；赶出"), not literal.',
      '- Do NOT include the English word itself in the Chinese gloss.',
      '- Do NOT add prefixes like "释义：" or numbering.',
      '- Multiple closely-related meanings in one definition: separate with 「；」.',
      '',
      `Input (JSON array of ${defs.length} English definitions):`,
      JSON.stringify(defs),
      '',
      `Output: ONLY a JSON array of exactly ${defs.length} Chinese strings. No prose, no code fences.`,
    ].join('\n');
    try {
      const result = await generateText({ model, prompt, maxOutputTokens: 400 });
      const parsed = parseJsonFromText(result.text);
      if (!Array.isArray(parsed) || parsed.length !== defs.length || !parsed.every((item) => typeof item === 'string')) {
        return part;
      }
      return {
        ...part,
        definitions: part.definitions.map((def, index) => ({
          ...def,
          cn: parsed[index] as string,
        })),
      };
    } catch (err) {
      console.warn('[readsight] gloss translation failed', err);
      return part;
    }
  }));
  return translated;
}

async function llmLookup(lemmaWord: string): Promise<LookupBody> {
  const { text: model } = await getModels();
  const prompt = [
    `You are a lexicographer. Generate a brief bilingual dictionary entry for the English token "${lemmaWord}".`,
    'Respond with ONLY a JSON object — no prose, no markdown, no code fences.',
    'Schema:',
    '{ "ipa": "/.../", "partsOfSpeech": [{ "pos": "noun|verb|...", "definitions": [{ "definition": "english def", "cn": "中文释义 ≤20字", "example": "..." }] }] }',
    'Rules:',
    '- Max 2 parts of speech, max 2 definitions each.',
    '- cn must be a short Chinese gloss like a real dictionary (e.g. "驱逐；赶出"), ≤20 chars when possible.',
    '- If the token looks like a brand / proper noun / acronym, still produce a plausible entry; "pos" can be "proper noun" or "abbreviation".',
    '- If you genuinely cannot tell, return: { "ipa": "", "partsOfSpeech": [] }',
  ].join('\n');
  const { text } = await generateText({ model, prompt, maxOutputTokens: 600 });
  let parsed: { ipa?: string; partsOfSpeech?: LookupResult['partsOfSpeech'] } = {};
  try {
    parsed = parseJsonFromText(text) as typeof parsed;
  } catch {
    parsed = {};
  }
  return {
    surfaceForm: lemmaWord,
    lemma: lemmaWord,
    ipa: parsed.ipa ? { us: parsed.ipa } : undefined,
    partsOfSpeech: Array.isArray(parsed.partsOfSpeech) ? parsed.partsOfSpeech : [],
    source: 'llm',
    estimated: true,
  };
}

async function writeDictCache(lemma: string, result: LookupResult, source: string): Promise<void> {
  await db.dictCache.put({
    lemma,
    payload: result,
    source,
    ...syncStamp(),
  });
}

export async function lookupWord(input: string): Promise<LookupResult> {
  const surfaceForm = normalize(input);
  if (!surfaceForm) return needsKeyResult(input, input);
  const lemmaWord = resolveLemma(surfaceForm);

  const cached = await db.dictCache.get(lemmaWord);
  if (cached && !cached.deletedAt) {
    const payload = cached.payload;
    const partsOfSpeech = payload.partsOfSpeech ?? [];
    const hasChinese = partsOfSpeech.some((part) => part.definitions.some((def) => def.cn?.trim()));
    const usable = partsOfSpeech.length > 0 && (hasChinese || payload.source === 'free-dictionary' || payload.source === 'llm');
    if (usable) {
      return {
        ...payload,
        partsOfSpeech,
        surfaceForm,
        lemma: cached.lemma,
        itemKey: payload.itemKey ?? deriveItemKey(cached.lemma, partsOfSpeech),
        source: 'cache',
      };
    }
  }

  const dict = await fetchFreeDictionary(lemmaWord);
  if (dict && dict.partsOfSpeech.length > 0) {
    const partsOfSpeech = await translateDefinitionsToZh(lemmaWord, dict.partsOfSpeech);
    const result: LookupResult = {
      ...dict,
      partsOfSpeech,
      surfaceForm,
      lemma: lemmaWord,
      itemKey: deriveItemKey(lemmaWord, partsOfSpeech),
    };
    await writeDictCache(lemmaWord, result, 'free-dictionary');
    return result;
  }

  if (!(await hasApiKey())) return needsKeyResult(surfaceForm, lemmaWord);

  try {
    const estimated = await llmLookup(lemmaWord);
    const result: LookupResult = {
      ...estimated,
      surfaceForm,
      lemma: lemmaWord,
      itemKey: deriveItemKey(lemmaWord, estimated.partsOfSpeech),
    };
    if (result.partsOfSpeech.length > 0) {
      await writeDictCache(lemmaWord, result, 'llm');
    }
    return result;
  } catch (err) {
    if (isNoKeyError(err)) return needsKeyResult(surfaceForm, lemmaWord);
    throw err;
  }
}
