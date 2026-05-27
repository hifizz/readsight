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
import { generateText, type LanguageModel } from 'ai';
import lemmatize from 'wink-lemmatizer';
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { dictionaryEntries } from '@/db/schema';
import { minimax, DEFAULT_MODEL_ID } from './minimax';
import { zhipuFlash, isZhipuConfigured } from './zhipu';
import { ecdictLookup, deriveRelationship, type EcdictExtras } from './ecdict';

/** 与扩展端 lib/messaging.ts 的 LookupResult 保持同步 —— 故意重复定义以避免跨包导入。 */
export interface LookupResult {
  surfaceForm: string;
  lemma: string;
  /**
   * PRD §5.2 itemKey = lemma + pos。EncounterEvent 按这个串起跨次查询。
   * 格式 "${lemma}#${pos}"，例如 "out#noun" / "run#verb"。
   * 词典没给词性时 fallback 到 "${lemma}#unknown"。
   */
  itemKey: string;
  ipa?: { us?: string; uk?: string };
  audioUrl?: string;
  partsOfSpeech: Array<{
    pos: string;
    // cn: 中文释义；D 方案下 Free Dictionary 命中后由 MiniMax 批量翻译填入并一起入缓存。
    definitions: Array<{ definition: string; cn?: string; example?: string }>;
  }>;
  source: 'cache' | 'ecdict' | 'free-dictionary' | 'llm';
  estimated?: boolean;
  /** ECDICT 来源时附带：CET/TOEFL/GRE tag、Collins 星、BNC 频率、形态变化等 */
  extras?: EcdictExtras;
}

/** 从已构造好的 LookupResult 推导 itemKey（cache hit / fresh fetch 都走这条）。 */
function deriveItemKey(lemma: string, partsOfSpeech: LookupResult['partsOfSpeech']): string {
  const primaryPos = partsOfSpeech[0]?.pos?.toLowerCase().replace(/\s+/g, '-') || 'unknown';
  return `${lemma}#${primaryPos}`;
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

// 返回 LookupResult 主体但暂不挂 itemKey —— 由主管道在合并 cn 后统一 derive。
type LookupBody = Omit<LookupResult, 'itemKey'>;

async function fetchFreeDictionary(lemmaWord: string): Promise<LookupBody | null> {
  const url = `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(lemmaWord)}`;
  let res: Response;
  try {
    // 给个超时，避免外部 API 拖累整条查询
    res = await fetch(url, { signal: AbortSignal.timeout(8000) });
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
/**
 * 用指定 model 跑一次"翻译这组定义"的 LLM 调用。
 * 不做异常包装、不做降级 —— 那些逻辑在 translateOnePos 里。
 *
 * @param model 任意符合 AI SDK LanguageModel 接口的模型实例。
 *              传 Zhipu GLM-4-Flash 时无需推理预算；传 MiniMax M2.x 时要留足。
 * @param modelLabel 仅日志用；标识失败时是哪一家的问题。
 * @param maxOutputTokens 推理模型留 2500（容纳 CoT）；小快模型 400 够了。
 */
async function translateOnce(
  word: string,
  pos: string,
  defs: string[],
  model: LanguageModel,
  modelLabel: string,
  maxOutputTokens: number,
): Promise<string[] | null> {
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

  const result = await generateText({
    model,
    prompt,
    maxOutputTokens,
  });
  const text = result.text;
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start < 0 || end <= start) {
    console.warn(
      `[lookup] zh ${pos} (${modelLabel}): no JSON array, finish=${result.finishReason}, raw=${text.slice(0, 200)}`,
    );
    return null;
  }
  const arr = JSON.parse(text.slice(start, end + 1)) as unknown;
  if (
    !Array.isArray(arr) ||
    arr.length !== defs.length ||
    !arr.every((s) => typeof s === 'string')
  ) {
    console.warn(
      `[lookup] zh ${pos} (${modelLabel}): shape mismatch, got=${Array.isArray(arr) ? arr.length : 'non-array'}, expected=${defs.length}`,
    );
    return null;
  }
  return arr as string[];
}

/**
 * 翻译一个 POS 下的所有定义，三层防御（按试错代价从低到高）：
 *   1. 首选 Zhipu GLM-4-Flash（如果配了 ZHIPU_API_KEY）—— ~1-2s
 *   2. Zhipu 同一调用再试一次 —— 又一个 ~1-2s
 *      理由：实测发现 Next.js dev (Turbopack) 下偶发响应截断
 *      ("Unterminated string in JSON at position 19")，重试基本能命中
 *   3. Fallback: MiniMax DEFAULT_MODEL_ID 大 thinking —— ~18s 但稳
 *
 * Zhipu 没配 = 跳过 1、2，直接走 MiniMax。
 */
async function translateOnePos(
  word: string,
  pos: string,
  defs: string[],
): Promise<string[] | null> {
  if (defs.length === 0) return [];

  // 1) + 2) Primary: Zhipu GLM-4-Flash with one retry
  if (isZhipuConfigured() && zhipuFlash) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const arr = await translateOnce(word, pos, defs, zhipuFlash, `glm-4-flash#${attempt}`, 400);
        if (arr) return arr;
        // 返 null = JSON 解析失败；进入下一轮重试（attempt 2）或 fallback
      } catch (err) {
        console.warn(
          `[lookup] zh ${pos} (glm-4-flash#${attempt}) threw:`,
          err instanceof Error ? err.message : err,
        );
        // 异常也走重试 / fallback
      }
    }
    console.warn(`[lookup] zh ${pos}: Zhipu both attempts failed, falling back to MiniMax`);
  }

  // 3) Fallback: MiniMax thinking model
  try {
    return await translateOnce(
      word,
      pos,
      defs,
      minimax(DEFAULT_MODEL_ID),
      DEFAULT_MODEL_ID,
      2500,
    );
  } catch (err) {
    console.warn(`[lookup] zh ${pos} (${DEFAULT_MODEL_ID}) threw`, err);
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
async function llmLookup(lemmaWord: string): Promise<LookupBody> {
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
      itemKey: `${input}#unknown`,
      partsOfSpeech: [],
      source: 'llm',
      estimated: true,
    };
  }
  const lemmaWord = resolveLemma(surfaceForm);

  // 1) 缓存（兼容旧条目：可能没 itemKey 字段，按 partsOfSpeech 现 derive）
  const cached = await db
    .select()
    .from(dictionaryEntries)
    .where(eq(dictionaryEntries.lemma, lemmaWord))
    .limit(1);
  if (cached.length > 0) {
    const payload = cached[0].payload as Partial<LookupResult>;
    const partsOfSpeech = payload.partsOfSpeech ?? [];
    // ECDICT 接入后老缓存可能没 cn / extras；如果缓存条目"质量较差"
    // （所有 def 都没 cn 字段），重查一次 ECDICT，命中就走 ecdict 路径覆盖
    const hasChineseDef = partsOfSpeech.some((p) =>
      p.definitions.some((d) => d.cn && d.cn.trim()),
    );
    if (hasChineseDef) {
      // 缓存里的 lemma 才是 canonical（屈折形不会单独成行）。当前查询的 surfaceForm
      // 跟 lemma 不同时，用 lemma.extras.exchange 反查派生 relationship 标记。
      const cachedLemma = cached[0].lemma;
      const extras = payload.extras
        ? {
            ...payload.extras,
            relationship: deriveRelationship(surfaceForm, cachedLemma, payload.extras.exchange),
          }
        : undefined;
      return {
        ipa: payload.ipa,
        audioUrl: payload.audioUrl,
        partsOfSpeech,
        estimated: payload.estimated,
        extras,
        surfaceForm,
        lemma: cachedLemma,
        itemKey: payload.itemKey ?? deriveItemKey(cachedLemma, partsOfSpeech),
        source: 'cache',
      };
    }
    // 老缓存（无 cn）—— 故意 fallthrough，让 ECDICT 给一份带中文的覆盖写
  }

  // 2) ECDICT —— 同步 sqlite，< 1ms，覆盖 770k 词，自带中文 + 难度标签 + 形态表。
  //    屈折形（brought / permissions / ...）会被自动重定向到原形（bring / permission），
  //    取原形的完整数据；relationship 由 deriveRelationship 算出。
  const ecd = ecdictLookup(surfaceForm, lemmaWord);
  if (ecd && ecd.partsOfSpeech.length > 0) {
    const canonicalLemma = ecd.canonicalLemma;
    // cache 写：去掉 relationship（它是查询态的，按 surfaceForm 不同而变）
    const cacheableExtras: EcdictExtras = { ...ecd.extras };
    delete cacheableExtras.relationship;
    const cacheable: LookupResult = {
      ipa: ecd.ipa,
      partsOfSpeech: ecd.partsOfSpeech,
      source: 'ecdict',
      extras: cacheableExtras,
      surfaceForm: canonicalLemma, // 占位；读取时被现场 surfaceForm 覆盖
      lemma: canonicalLemma,
      itemKey: deriveItemKey(canonicalLemma, ecd.partsOfSpeech),
    };
    await db
      .insert(dictionaryEntries)
      .values({ lemma: canonicalLemma, payload: cacheable, source: 'ecdict' })
      .onConflictDoUpdate({
        target: dictionaryEntries.lemma,
        set: { payload: cacheable, source: 'ecdict' },
      });
    // 当前响应：补 relationship，并把 surfaceForm 换回真实查询值
    return {
      ...cacheable,
      surfaceForm,
      extras: {
        ...cacheableExtras,
        relationship: deriveRelationship(surfaceForm, canonicalLemma, cacheableExtras.exchange),
      },
    };
  }

  // 3) Free Dictionary（D 方案：命中后让 MiniMax 把英文 definition 批量翻译成中文短义，
  //    一并写进缓存。翻译失败不影响主流程，cn 字段缺失即可。）
  const dict = await fetchFreeDictionary(lemmaWord);
  if (dict && dict.partsOfSpeech.length > 0) {
    const bilingualPos = await translateDefinitionsToZh(lemmaWord, dict.partsOfSpeech);
    const result: LookupResult = {
      ...dict,
      partsOfSpeech: bilingualPos,
      surfaceForm,
      lemma: lemmaWord,
      itemKey: deriveItemKey(lemmaWord, bilingualPos),
    };
    await db
      .insert(dictionaryEntries)
      .values({ lemma: lemmaWord, payload: result, source: 'free-dictionary' })
      .onConflictDoNothing();
    return result;
  }

  // 3) LLM 兜底
  const llm = await llmLookup(lemmaWord);
  const result: LookupResult = {
    ...llm,
    surfaceForm,
    lemma: lemmaWord,
    itemKey: deriveItemKey(lemmaWord, llm.partsOfSpeech),
  };
  await db
    .insert(dictionaryEntries)
    .values({ lemma: lemmaWord, payload: result, source: 'llm' })
    .onConflictDoNothing();
  return result;
}
