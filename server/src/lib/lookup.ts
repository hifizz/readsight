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
    // cn: 中文释义；D 方案下 Free Dictionary 命中后由 MiniMax 批量翻译填入并一起入缓存。
    definitions: Array<{ definition: string; cn?: string; example?: string }>;
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

// --- 中文释义批量翻译（D 方案核心）-----------------------------------------

/**
 * 把 Free Dictionary 返回的英文定义翻成中文短释义。
 *
 * 关键设计：
 *   - 按词性并行调用，每次只翻一个 POS 的 1-3 条定义。理由：MiniMax-M2.1 是
 *     thinking 模型，单次响应大头是推理 token（翻 2 条 ≈ 700 token，翻 8 条
 *     可超 4000）。分小批降低推理量，单次都能在合理预算下返完整 JSON。
 *   - 并行 Promise.all：3-4 个 POS 同时翻，墙钟时间 ≈ 单批耗时
 *   - 翻译跟英文释义一起入 dictionary_entries 缓存 —— 一次翻译永久可用
 *   - 单个 POS 失败 = 该词性 cn 缺失，其他词性正常显示
 */
async function translateOnePos(
  word: string,
  pos: string,
  defs: string[],
): Promise<string[] | null> {
  if (defs.length === 0) return [];
  const prompt = [
    `You translate English dictionary definitions into short, idiomatic Chinese glosses suitable for a dictionary lookup card. The headword being defined is "${word}" (used as ${pos}).`,
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
    const result = await generateText({
      model: minimax(DEFAULT_MODEL_ID),
      prompt,
      maxOutputTokens: 2500,
    });
    const text = result.text;
    const start = text.indexOf('[');
    const end = text.lastIndexOf(']');
    if (start < 0 || end <= start) {
      console.warn(`[lookup] zh ${pos}: no JSON array, finish=${result.finishReason}, raw=${text.slice(0, 200)}`);
      return null;
    }
    const arr = JSON.parse(text.slice(start, end + 1)) as unknown;
    if (!Array.isArray(arr) || arr.length !== defs.length || !arr.every((s) => typeof s === 'string')) {
      console.warn(`[lookup] zh ${pos}: shape mismatch, got=${Array.isArray(arr) ? arr.length : 'non-array'}, expected=${defs.length}`);
      return null;
    }
    return arr as string[];
  } catch (err) {
    console.warn(`[lookup] zh ${pos}: threw`, err);
    return null;
  }
}

async function translateDefinitionsToZh(
  word: string,
  partsOfSpeech: LookupResult['partsOfSpeech'],
): Promise<LookupResult['partsOfSpeech']> {
  // 并行翻译每个 POS。
  const perPosResults = await Promise.all(
    partsOfSpeech.map((p) => translateOnePos(word, p.pos, p.definitions.map((d) => d.definition))),
  );

  return partsOfSpeech.map((p, pi) => {
    const cn = perPosResults[pi];
    return {
      ...p,
      definitions: p.definitions.map((d, di) => ({
        ...d,
        cn: cn?.[di] ?? undefined,
      })),
    };
  });
}

// --- LLM fallback ----------------------------------------------------------

/**
 * 词典完全没命中（多见于品牌名、新造词、领域缩写）时让 MiniMax 估一份。
 * 标 estimated:true 让 UI 在 WordCard 上加 "guess" 角标，对应 PRD §6.2 原则。
 *
 * 既然已经在调 LLM，顺手让它把 cn 字段一起填进去，省一次翻译往返。
 */
async function llmLookup(lemmaWord: string): Promise<LookupResult> {
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

  const { text } = await generateText({
    model: minimax(DEFAULT_MODEL_ID),
    prompt,
    maxOutputTokens: 600,
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

  // 2) Free Dictionary（D 方案：命中后让 MiniMax 把英文 definition 批量翻译成中文短义，
  //    一并写进缓存。翻译失败不影响主流程，cn 字段缺失即可。）
  const dict = await fetchFreeDictionary(lemmaWord);
  if (dict && dict.partsOfSpeech.length > 0) {
    const bilingualPos = await translateDefinitionsToZh(lemmaWord, dict.partsOfSpeech);
    const result: LookupResult = {
      ...dict,
      partsOfSpeech: bilingualPos,
      surfaceForm,
      lemma: lemmaWord,
    };
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
