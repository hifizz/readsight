/**
 * 单词查询主管道（PRD §6.2 / §6.3 落地）。
 *
 * 顺序：
 *   1. 标准化 surfaceForm（去标点、转小写）
 *   2. wink-lemmatizer 还原 lemma（"outed" → "out", "studies" → "study"）
 *   3. 查 Postgres `dictionary_entries` 缓存（key = lemma）
 *   4. miss → 打 Free Dictionary API（free, no key）
 *   5. 又 miss → MiniMax 生成估计版（estimated: true）
 *   6. 命中后写缓存，下次同一 lemma 直接走步骤 3
 *
 * 注意：缓存按 lemma 做 key，所以 "outed" 和 "outing" 共用同一条缓存。
 */
import { generateText } from 'ai';
import lemmatize from 'wink-lemmatizer';
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { dictionaryEntries } from '@/db/schema';
import { minimax, DEFAULT_MODEL_ID } from './minimax';

/** 与扩展端 lib/messaging.ts 的 LookupResult 保持同步 —— 故意重复定义以避免跨包导入。 */
export interface LookupResult {
  surfaceForm: string;
  lemma: string;
  ipa?: { us?: string; uk?: string };
  audioUrl?: string;
  partsOfSpeech: Array<{
    pos: string;
    definitions: Array<{ definition: string; example?: string }>;
  }>;
  source: 'cache' | 'free-dictionary' | 'llm';
  estimated?: boolean;
}

/** 包不带类型的兼容 import：wink-lemmatizer 用 CommonJS module.exports。 */
const lemma = lemmatize as unknown as {
  verb: (w: string) => string;
  noun: (w: string) => string;
  adjective: (w: string) => string;
};

function normalize(input: string): string {
  return input.toLowerCase().replace(/^[\p{P}\s]+|[\p{P}\s]+$/gu, '');
}

/**
 * 试动词 → 名词 → 形容词三个路径，取第一个"产生了变化"的结果。
 * wink-lemmatizer 没匹配到时会原样返回。
 */
function resolveLemma(word: string): string {
  const v = lemma.verb(word);
  if (v !== word) return v;
  const n = lemma.noun(word);
  if (n !== word) return n;
  const a = lemma.adjective(word);
  if (a !== word) return a;
  return word;
}

// --- Free Dictionary API ---------------------------------------------------

/**
 * https://dictionaryapi.dev/ —— CC BY-SA 3.0。免费、无 key、英语单词覆盖
 * 不错；遇到陌生词 / 屈折变体没还原干净时会返 404。
 */
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

async function fetchFreeDictionary(lemmaWord: string): Promise<LookupResult | null> {
  const url = `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(lemmaWord)}`;
  let res: Response;
  try {
    // 给个超时，避免外部 API 拖累整条查询
    res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  } catch (err) {
    console.warn('[lookup] free-dictionary fetch failed', err);
    return null;
  }
  if (!res.ok) return null;
  const entries = (await res.json()) as FreeDictEntry[];
  if (!Array.isArray(entries) || entries.length === 0) return null;

  // 多个同形异义词条 → 合并 phonetics & meanings
  const phonetics = entries.flatMap((e) => e.phonetics ?? []);
  let usIpa: string | undefined;
  let ukIpa: string | undefined;
  let audioUrl: string | undefined;
  for (const p of phonetics) {
    if (!p.text && !p.audio) continue;
    const isUS = p.audio?.includes('-us.') ?? false;
    const isUK = p.audio?.includes('-uk.') ?? false;
    if (isUS && p.text && !usIpa) usIpa = p.text;
    if (isUK && p.text && !ukIpa) ukIpa = p.text;
    if (!audioUrl && p.audio) audioUrl = p.audio;
  }
  // 兜底：没区分美英时拿任何一个 phonetic.text
  const anyIpa = phonetics.find((p) => p.text)?.text || entries[0].phonetic;
  if (!usIpa && !ukIpa && anyIpa) usIpa = anyIpa;

  // 控制 WordCard 体量：最多 4 个词性、每个词性最多 2 条定义。
  // Free Dictionary 对 "out" / "set" 这类高频词会回 7+ 个词性，全显示会挤爆侧栏。
  // 用 Map 按 pos 合并同名词性（不同 entries 可能各有一份 "verb"）。
  const posMap = new Map<string, FreeDictMeaning['definitions']>();
  for (const m of entries.flatMap((e) => e.meanings ?? [])) {
    const existing = posMap.get(m.partOfSpeech) ?? [];
    posMap.set(m.partOfSpeech, [...existing, ...m.definitions]);
  }
  const partsOfSpeech = Array.from(posMap.entries())
    .slice(0, 4)
    .map(([pos, defs]) => ({
      pos,
      definitions: defs.slice(0, 2).map((d) => ({
        definition: d.definition,
        example: d.example,
      })),
    }));

  return {
    surfaceForm: lemmaWord, // 在主管道里会被外层覆盖成真实 surfaceForm
    lemma: lemmaWord,
    ipa: usIpa || ukIpa ? { us: usIpa, uk: ukIpa } : undefined,
    audioUrl,
    partsOfSpeech,
    source: 'free-dictionary',
  };
}

// --- LLM fallback ----------------------------------------------------------

/**
 * 词典完全没命中（多见于品牌名、新造词、领域缩写）时让 MiniMax 估一份。
 * 标 estimated:true 让 UI 在 WordCard 上加 "guess" 角标，对应 PRD §6.2 原则。
 */
async function llmLookup(lemmaWord: string): Promise<LookupResult> {
  const prompt = [
    `You are a lexicographer. Generate a brief dictionary entry for the English token "${lemmaWord}".`,
    'Respond with ONLY a JSON object — no prose, no markdown, no code fences.',
    'Schema:',
    '{ "ipa": "/.../", "partsOfSpeech": [{ "pos": "noun|verb|...", "definitions": [{ "definition": "...", "example": "..." }] }] }',
    'Rules:',
    '- Max 2 parts of speech, max 2 definitions each.',
    '- If the token looks like a brand / proper noun / acronym, still produce a plausible entry; "pos" can be "proper noun" or "abbreviation".',
    '- If you genuinely cannot tell, return: { "ipa": "", "partsOfSpeech": [] }',
  ].join('\n');

  const { text } = await generateText({
    model: minimax(DEFAULT_MODEL_ID),
    prompt,
    maxOutputTokens: 500,
  });

  let parsed: { ipa?: string; partsOfSpeech?: LookupResult['partsOfSpeech'] };
  try {
    // 防御性：LLM 偶尔会在 JSON 外面套 ``` 或解释文字。抓第一个 { 到最后一个 }。
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    const slice = start >= 0 && end > start ? text.slice(start, end + 1) : '{}';
    parsed = JSON.parse(slice);
  } catch {
    parsed = {};
  }

  return {
    surfaceForm: lemmaWord,
    lemma: lemmaWord,
    ipa: parsed.ipa ? { us: parsed.ipa } : undefined,
    partsOfSpeech: parsed.partsOfSpeech ?? [],
    source: 'llm',
    estimated: true,
  };
}

// --- 主管道 ----------------------------------------------------------------

export async function lookupWord(input: string): Promise<LookupResult> {
  const surfaceForm = normalize(input);
  if (!surfaceForm) {
    return {
      surfaceForm: input,
      lemma: input,
      partsOfSpeech: [],
      source: 'llm',
      estimated: true,
    };
  }
  const lemmaWord = resolveLemma(surfaceForm);

  // 1) 缓存
  const cached = await db
    .select()
    .from(dictionaryEntries)
    .where(eq(dictionaryEntries.lemma, lemmaWord))
    .limit(1);
  if (cached.length > 0) {
    const payload = cached[0].payload as Omit<LookupResult, 'surfaceForm' | 'source'>;
    return {
      ...payload,
      surfaceForm,
      lemma: lemmaWord,
      source: 'cache',
    };
  }

  // 2) Free Dictionary
  const dict = await fetchFreeDictionary(lemmaWord);
  if (dict && dict.partsOfSpeech.length > 0) {
    const result: LookupResult = { ...dict, surfaceForm, lemma: lemmaWord };
    await db
      .insert(dictionaryEntries)
      .values({ lemma: lemmaWord, payload: result, source: 'free-dictionary' })
      .onConflictDoNothing();
    return result;
  }

  // 3) LLM 兜底
  const llm = await llmLookup(lemmaWord);
  const result: LookupResult = { ...llm, surfaceForm, lemma: lemmaWord };
  await db
    .insert(dictionaryEntries)
    .values({ lemma: lemmaWord, payload: result, source: 'llm' })
    .onConflictDoNothing();
  return result;
}
