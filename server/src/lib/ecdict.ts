/**
 * ECDICT 同步词典查询（skywind3000/ECDICT，770k 词，CC BY 4.0）。
 *
 * 数据：`server/data/ecdict.sqlite`（100MB，不进 git；bootstrap 见 README）。
 * 模式：cache → **ecdict** → free-dict → llm。ECDICT 同步 < 1ms，比 Postgres 缓存还快。
 *
 * 设计：
 * - 单例 Database lazy 打开；服务进程生命周期内常驻
 * - 两步查：先按 surfaceForm 命中（"permissions" / "outed" 有独立条目），再按 lemma
 * - translation 字段 line-by-line 解析成 partsOfSpeech；POS 前缀如 `n.` / `vi.` / `vt.`
 * - extras 字段（tag / collins / oxford / bnc / frq / exchange）跟着 LookupResult 一起回前端
 */
import path from 'node:path';
import fs from 'node:fs';
import Database, { type Database as DB } from 'better-sqlite3';

/** 屈折形 → 原形的关系标记 */
export interface EcdictRelationship {
  /** 用户实际查的词（屈折形）*/
  surfaceForm: string;
  /** 真正的原形 */
  lemma: string;
  /** "p" / "d" / "dp" / "i" / "3" / "s" / "r" / "t" —— 单字母或组合 */
  kindCode: string;
}

/** ECDICT 给的额外信号 —— 跟 LookupResult 主体并列下发 */
export interface EcdictExtras {
  /** 难度标签 "cet6 toefl gre"，空格分隔；前端切成 chip */
  tag?: string;
  /** Collins 星级 1-5 */
  collins?: number;
  /** 1 = Oxford 3000 高频词 */
  oxford?: number;
  /** BNC 频率排名（越小越高频） */
  bnc?: number;
  /** 当代英语语料库频率排名 */
  frq?: number;
  /** 原形的完整形态变化 "p:brought/d:brought/i:bringing/3:brings" */
  exchange?: string;
  /** 用户查的是屈折形时填这里："brought" → bring 的过去式和过去分词 */
  relationship?: EcdictRelationship;
}

interface DbRow {
  word: string;
  phonetic: string | null;
  definition: string | null;
  translation: string | null;
  pos: string | null;
  collins: number | null;
  oxford: number | null;
  tag: string | null;
  bnc: number | null;
  frq: number | null;
  exchange: string | null;
}

/** 跟 lookup.ts 的 LookupBody 同形（外面不导这个内部类型，避免循环依赖） */
export interface EcdictLookupBody {
  ipa?: { us?: string; uk?: string };
  partsOfSpeech: Array<{
    pos: string;
    definitions: Array<{ definition: string; cn?: string }>;
  }>;
  source: 'ecdict';
  extras: EcdictExtras;
  /** ECDICT 实际命中的那个原形 —— 用作 cache key */
  canonicalLemma: string;
}

// --- 单例 DB 句柄 ----------------------------------------------------------

let db: DB | null = null;
let dbReady: boolean | null = null;

function getDb(): DB | null {
  if (dbReady === false) return null;
  if (db) return db;
  const candidates = [
    process.env.ECDICT_PATH,
    path.join(process.cwd(), 'data', 'ecdict.sqlite'),
    path.join(process.cwd(), 'server', 'data', 'ecdict.sqlite'),
  ].filter((p): p is string => !!p);
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      try {
        db = new Database(p, { readonly: true, fileMustExist: true });
        db.pragma('journal_mode = OFF');
        db.pragma('query_only = ON');
        dbReady = true;
        console.log(`[ecdict] opened ${p}`);
        return db;
      } catch (err) {
        console.warn('[ecdict] open failed', p, err);
      }
    }
  }
  console.warn('[ecdict] sqlite not found at any candidate path; ECDICT lookup disabled');
  dbReady = false;
  return null;
}

let stmt: Database.Statement | null = null;
function getStmt(): Database.Statement | null {
  const d = getDb();
  if (!d) return null;
  if (!stmt) {
    stmt = d.prepare(
      'SELECT word, phonetic, definition, translation, pos, collins, oxford, tag, bnc, frq, exchange ' +
        'FROM dict WHERE LOWER(word) = LOWER(?) LIMIT 1',
    );
  }
  return stmt;
}

// --- 解析 translation 字段 -------------------------------------------------

const POS_PREFIX = /^([a-z]+\.)\s*/i;

/**
 * ECDICT 的 translation 例子（注意：字段里是**字面量** `\n`，两个字符，不是真换行）：
 *   "n. 跑, 赛跑, 趋向\\nvi. 跑, 奔跑\\nvt. 使跑, 追究\\n[计] 运行"
 * 解析：按字面量 \n 切，每行尝试匹配 POS 前缀；前缀缺失的行（如 "[计] xxx"）挂到上一组。
 */
function parseTranslation(translation: string): Array<{ pos: string; cn: string }> {
  const out: Array<{ pos: string; cn: string }> = [];
  // 同时容忍真换行（万一上游清洗过）和字面量 \n
  const lines = translation
    .split(/\\n|\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  for (const line of lines) {
    const m = line.match(POS_PREFIX);
    if (m) {
      const pos = m[1].toLowerCase();
      const cn = line.slice(m[0].length).trim();
      out.push({ pos, cn });
    } else if (out.length > 0) {
      // 无 POS 行：合并到上一组（如 "[计] 运行"）
      out[out.length - 1].cn += '；' + line;
    } else {
      // 整段都没 POS：当成无词性条目
      out.push({ pos: '—', cn: line });
    }
  }
  return out.length > 0 ? out : [{ pos: '—', cn: translation }];
}

/** ECDICT phonetic 是裸 IPA（"ik'spænsiv"），前端期望带斜杠。 */
function wrapIpa(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  const s = raw.trim();
  if (!s) return undefined;
  if (s.startsWith('/') && s.endsWith('/')) return s;
  return `/${s}/`;
}

/**
 * ECDICT 的 definition 字段是 WordNet 英文释义，**按词性字母分组**（不一定跟 translation
 * 的中文 POS 顺序对齐）。每行格式：`<letter>. <gloss>`，例如：
 *   "n. the act of physically reaching\\nv. reach a destination\\nv. reach a state"
 *
 * 把它聚合成 { letter → [glosses] } 的 map，后面按 cn POS → wordnet letter 匹配。
 *
 * WordNet POS 字母对照：
 *   n = noun       v = verb (含及物/不及物)
 *   a = adjective  s = adjective satellite（也算形容词）
 *   r = adverb
 */
function parseEnglishDefs(definition: string): Record<string, string[]> {
  const map: Record<string, string[]> = {};
  const lines = definition.split(/\\n|\n/).map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    const m = line.match(/^([a-z])\.?\s+(.+)$/i);
    if (!m) continue;
    const letter = m[1].toLowerCase();
    const gloss = m[2].trim();
    if (!gloss) continue;
    if (!map[letter]) map[letter] = [];
    map[letter].push(gloss);
  }
  return map;
}

/**
 * 中文 POS 标记 ("n." / "vt." / "vi." / "adj." / "adv.") → WordNet POS 字母。
 * vt./vi. 都映射到 v；adj./a. 映射到 a（+ 同时尝试 s）；adv. 映射到 r。
 * prep./conj./art. 等 WordNet 不区分的词性 → 没有英文对应，返回 null。
 */
function cnPosToWordnet(cnPos: string): string[] | null {
  const p = cnPos.toLowerCase().replace(/\.$/, '').trim();
  if (p === 'n') return ['n'];
  if (p === 'v' || p === 'vt' || p === 'vi') return ['v'];
  if (p === 'a' || p === 'adj') return ['a', 's'];
  if (p === 'adv' || p === 'r') return ['r'];
  return null;
}

function rowToBody(row: DbRow): Omit<EcdictLookupBody, 'canonicalLemma'> {
  const ipa = wrapIpa(row.phonetic);
  const partsOfSpeech: EcdictLookupBody['partsOfSpeech'] = [];
  const enMap = row.definition ? parseEnglishDefs(row.definition) : {};

  if (row.translation) {
    const groups = parseTranslation(row.translation);
    // 同 POS 合并（罕见，但 run 这种有 n./vi./vt. 分散，自然不会合到一起）
    const seen = new Map<string, number>();
    // 英文 gloss 按 WordNet 字母分组（n/v/a/r），多个中文 POS 共享同一字母池
    // （vt./vi. 都 → v）。用游标分配：每个 POS 行取游标当前位置的 gloss，分配完
    // 游标 +1，避免 vt. 和 vi. 拿到同一句英文。
    const cursor: Record<string, number> = {};
    // 每个字母最后一次被分配到的 partsOfSpeech 行号 —— 余数 gloss 都挂这里，
    // 这样 rich 模式仍能看到多义编号，没有信息丢失。
    const lastRowForLetter: Record<string, number> = {};

    for (const g of groups) {
      const idx = seen.get(g.pos);
      if (idx !== undefined) {
        partsOfSpeech[idx].definitions.push({ definition: '', cn: g.cn });
        continue;
      }
      const wnKeys = cnPosToWordnet(g.pos) ?? [];
      let primaryEn = '';
      let primaryKey: string | null = null;
      for (const k of wnKeys) {
        const pool = enMap[k] ?? [];
        const start = cursor[k] ?? 0;
        if (start < pool.length) {
          primaryEn = pool[start];
          cursor[k] = start + 1;
          primaryKey = k;
          break;
        }
      }
      const rowIndex = partsOfSpeech.length;
      seen.set(g.pos, rowIndex);
      partsOfSpeech.push({
        pos: g.pos,
        definitions: [{ definition: primaryEn, cn: g.cn }],
      });
      if (primaryKey) lastRowForLetter[primaryKey] = rowIndex;
    }

    // 余数 gloss → 挂到对应字母最后一行（rich 模式编号展开）
    for (const [letter, rowIdx] of Object.entries(lastRowForLetter)) {
      const pool = enMap[letter] ?? [];
      const start = cursor[letter] ?? 0;
      for (let i = start; i < pool.length; i++) {
        partsOfSpeech[rowIdx].definitions.push({ definition: pool[i] });
      }
    }
  } else if (row.definition) {
    partsOfSpeech.push({ pos: row.pos ?? '—', definitions: [{ definition: row.definition }] });
  }

  return {
    ipa: ipa ? { us: ipa } : undefined,
    partsOfSpeech,
    source: 'ecdict',
    extras: {
      tag: row.tag || undefined,
      collins: row.collins ?? undefined,
      oxford: row.oxford ?? undefined,
      bnc: row.bnc ?? undefined,
      frq: row.frq ?? undefined,
      exchange: row.exchange || undefined,
    },
  };
}

// --- 对外 API --------------------------------------------------------------

/**
 * exchange 里的 `0:lemma` —— 屈折形指向原形的标记。
 * "brought" 的 exchange = "0:bring/1:dp" → lemma=bring。
 * 原形自己通常没 `0:`；有就忽略 self-loop。
 */
function parseInflectionLemma(exchange: string | null, surfaceForm: string): string | null {
  if (!exchange) return null;
  for (const seg of exchange.split('/')) {
    const [k, v] = seg.split(':');
    if (k === '0' && v && v.toLowerCase() !== surfaceForm.toLowerCase()) return v;
  }
  return null;
}

/**
 * 在 lemma 的 exchange 里反查 surfaceForm，确定它是哪种屈折形态。
 *
 * 例：surfaceForm="brought", lemmaExchange="p:brought/d:brought/i:bringing/3:brings"
 *   → 命中 p 和 d → kindCode="pd"（过去式 + 过去分词）
 *
 * 不在 lemma 的 exchange 里：返回空 kindCode（仍标记为"原形 X 的屈折形"，前端可
 * 兜底显示 "X 的派生形式"）。
 */
export function deriveRelationship(
  surfaceForm: string,
  lemma: string,
  lemmaExchange?: string,
): EcdictRelationship | undefined {
  if (!surfaceForm || !lemma) return undefined;
  if (surfaceForm.toLowerCase() === lemma.toLowerCase()) return undefined;
  const kinds: string[] = [];
  if (lemmaExchange) {
    for (const seg of lemmaExchange.split('/')) {
      const [k, v] = seg.split(':');
      // 跳过 0/1 这两个"元数据"位
      if (k && k !== '0' && k !== '1' && v && v.toLowerCase() === surfaceForm.toLowerCase()) {
        kinds.push(k);
      }
    }
  }
  return { surfaceForm, lemma, kindCode: kinds.join('') };
}

/**
 * 查一个词。
 *
 * 策略：
 *   1. surfaceForm 查 ECDICT
 *   2. 若命中条目的 exchange `0:X` 指向不同的原形，跟到 X 取完整条目（关键：用 X 的
 *      partsOfSpeech / IPA / exchange 替代 surfaceForm 的浅条目）
 *   3. surfaceForm 没条目时，用 wink-lemmatizer 给的 lemma 兜一次
 *
 * relationship 字段**不**在这里生成 —— 由调用方（lookup.ts 主管道）在响应时
 * 用 deriveRelationship 动态算出来，这样 cache 里存的是 lemma 的中性数据，
 * 不会被某次 surfaceForm 的查询污染。
 */
export function ecdictLookup(surfaceForm: string, winkLemma: string): EcdictLookupBody | null {
  const s = getStmt();
  if (!s) return null;
  try {
    let row = s.get(surfaceForm) as DbRow | undefined;
    let canonicalLemma = surfaceForm;

    if (row) {
      const inflLemma = parseInflectionLemma(row.exchange, surfaceForm);
      if (inflLemma) {
        const lemmaRow = s.get(inflLemma) as DbRow | undefined;
        if (lemmaRow && (lemmaRow.translation || lemmaRow.definition)) {
          row = lemmaRow;
          canonicalLemma = inflLemma;
        }
      }
    } else if (surfaceForm.toLowerCase() !== winkLemma.toLowerCase()) {
      // surfaceForm 没条目 —— 用 wink lemma 兜一次
      row = s.get(winkLemma) as DbRow | undefined;
      if (row) canonicalLemma = winkLemma;
    }

    if (!row || (!row.translation && !row.definition)) return null;

    return { ...rowToBody(row), canonicalLemma };
  } catch (err) {
    console.warn('[ecdict] lookup failed', surfaceForm, err);
    return null;
  }
}
