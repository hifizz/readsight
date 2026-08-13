/**
 * DictCard —— popup 和 sidepanel 共用的"词典卡"内容组件。
 *
 * 职责：拿到 LookupResult，渲染 IPA + 发音 + 关系卡 + 多 POS 释义 + 难度/Collins/
 * Oxford chip + 形态变化表。**不**负责外壳（dialog 边框 / 折叠 header / loading
 * 占位）—— 这些归调用方（popup dialog / sidepanel WordCard）。
 *
 * 两种密度：
 *   compact —— 每个 POS 一行，取首个释义，不显示例句。给 popup 用。
 *   rich    —— 全部释义、编号列表、含例句。给 sidepanel 用。
 *
 * 视觉来自 docs/lookup.jsx，CSS 用 `.eag-` 前缀。Scope 由根 `.eag-dict-card`
 * 提供（CSS variables 都挂这上面），所以在任何容器里嵌套都不依赖外层。
 *
 * 调用方负责 inject DICT_CARD_CSS 一次（用 `<style>{DICT_CARD_CSS}</style>`）。
 * popup 已经有自己的 `<style>`，把这块拼进去即可；sidepanel WordCard 在自己
 * 顶部 mount 一次。
 */
import { Volume2 } from 'lucide-react';
import type { EcdictExtras, LookupResult } from '@/lib/messaging';

export type DictCardMode = 'compact' | 'rich';

export interface DictCardProps {
  data: LookupResult;
  mode?: DictCardMode;
  /** 调用方负责 toggle SpeechSynthesis；这里只看状态决定按钮 ring 动画 */
  speaking?: boolean;
  onSpeak?: () => void;
}

export function DictCard({ data, mode = 'compact', speaking = false, onSpeak }: DictCardProps) {
  const extras: EcdictExtras | undefined = data.extras;
  const us = data.ipa?.us;
  const uk = data.ipa?.uk;
  const tags = (extras?.tag ?? '').split(/\s+/).filter(Boolean);
  const collinsStars = Math.max(0, Math.min(5, extras?.collins ?? 0));
  const rel = extras?.relationship;

  // compact: 每 POS 1 条释义；rich: 全部释义
  const posSlice = mode === 'compact' ? data.partsOfSpeech.slice(0, 4) : data.partsOfSpeech;

  return (
    <div className="eag-dict-card">
      {(us || uk) && (
        <div className="eag-ipa-row">
          {us && (
            <span className="eag-ipa">
              <em>US</em>
              {us}
            </span>
          )}
          {uk && uk !== us && (
            <span className="eag-ipa">
              <em>UK</em>
              {uk}
            </span>
          )}
          {onSpeak && (
            <button
              type="button"
              className={'eag-speak' + (speaking ? ' eag-on' : '')}
              onClick={onSpeak}
              aria-label="发音"
              aria-pressed={speaking}
              style={{ marginLeft: 'auto' }}
            >
              <Volume2 size={14} />
            </button>
          )}
        </div>
      )}

      {mode === 'compact' ? (
        <CompactDefs partsOfSpeech={posSlice} />
      ) : (
        <RichDefs partsOfSpeech={posSlice} />
      )}

      {(tags.length > 0 || collinsStars > 0 || extras?.oxford || data.estimated) && (
        <div className="eag-tags">
          {tags.map((t) => (
            <span key={t} className="eag-tag">{t.toUpperCase()}</span>
          ))}
          {collinsStars > 0 && (
            <span className="eag-tag" title={`Collins ${collinsStars} 星`}>
              {'★'.repeat(collinsStars)}
            </span>
          )}
          {extras?.oxford === 1 && (
            <span className="eag-tag" title="Oxford 3000">OXFORD</span>
          )}
          {data.estimated && <span className="eag-tag">估计</span>}
        </div>
      )}
      {extras?.exchange && (
        <ExchangeRow
          exchange={extras.exchange}
          lemma={rel?.lemma}
          highlight={rel?.surfaceForm}
        />
      )}
    </div>
  );
}

/**
 * Exchange 行 —— 既显示 lemma 的完整变形表，又承担"你查的 surfaceForm 是哪种屈折形"
 * 的指代职责（取代之前的独立 relationship banner）。
 *
 *   reached →  原形 reach · 过去 [reached] · 过去分词 [reached] · -ing reaching · 三单 reaches
 *   bring  →  过去 brought · 过去分词 brought · -ing bringing · 三单 brings
 *
 * 高亮用底色 + 加粗：用户扫一眼就能在变形表里定位到自己查的那个词。
 */
function ExchangeRow({
  exchange,
  lemma,
  highlight,
}: {
  exchange: string;
  lemma?: string;
  highlight?: string;
}) {
  const MAP: Record<string, string> = {
    p: '过去', d: '过去分词', i: '-ing', '3': '三单', r: '比较级', t: '最高级', s: '复数',
  };
  const segments = exchange
    .split('/')
    .map((part) => {
      const [k, v] = part.split(':');
      const label = MAP[k];
      if (!label || !v) return null;
      return { label, word: v };
    })
    .filter((x): x is { label: string; word: string } => x !== null);

  if (segments.length === 0 && !lemma) return null;

  const hl = highlight?.toLowerCase();

  return (
    <div className="eag-exchange">
      {lemma && (
        <>
          <span className="eag-ex-pair eag-ex-lemma">
            <span className="eag-ex-label">原形</span>
            <span>{lemma}</span>
          </span>
          {segments.length > 0 && <span className="eag-ex-sep"> · </span>}
        </>
      )}
      {segments.map((s, i) => {
        const isHit = !!hl && s.word.toLowerCase() === hl;
        return (
          <span key={i}>
            {i > 0 && <span className="eag-ex-sep"> · </span>}
            {/* label + word 包成 nowrap pair，gap 由 CSS 控（避免 CJK→Latin 字面空格被拉宽） */}
            <span className="eag-ex-pair">
              <span className="eag-ex-label">{s.label}</span>
              <span className={isHit ? 'eag-ex-word eag-ex-hit' : 'eag-ex-word'}>
                {s.word}
              </span>
            </span>
          </span>
        );
      })}
    </div>
  );
}

function CompactDefs({ partsOfSpeech }: { partsOfSpeech: LookupResult['partsOfSpeech'] }) {
  // 过滤掉 "—" 占位 POS（ECDICT 偶尔没词性标记的条目）。EN 主、CN 辅：
  //   主行：[词性] 英文 gloss（衬线、加粗、ink 色）
  //   副行：中文（小、灰、缩进对齐）—— 没英文就把中文升回主行
  const rows = partsOfSpeech
    .map((p) => ({
      pos: p.pos && p.pos !== '—' ? p.pos : '',
      cn: p.definitions[0]?.cn,
      en: p.definitions[0]?.definition,
    }))
    .filter((r) => r.cn || r.en);
  if (rows.length === 0) return null;
  return (
    <div className="eag-defs">
      {rows.map((row, i) => (
        <div key={i} className="eag-def-row">
          <span className="eag-pos">{row.pos}</span>
          <div className="eag-def-body">
            <div className="eag-def-en">{row.en || row.cn}</div>
            {row.en && row.cn && <div className="eag-def-cn">{row.cn}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}

function RichDefs({ partsOfSpeech }: { partsOfSpeech: LookupResult['partsOfSpeech'] }) {
  return (
    <div className="eag-defs-rich">
      {partsOfSpeech.map((p, i) => (
        <div key={`${p.pos}-${i}`} className="eag-pos-block">
          {p.pos && p.pos !== '—' && <div className="eag-pos-title">{p.pos}</div>}
          <ol className="eag-def-list">
            {p.definitions.map((d, j) => (
              <li key={j} className="eag-def-item">
                <span className="eag-def-index">{j + 1}.</span>
                <div className="eag-def-body">
                  {d.definition && <div className="eag-def-en">{d.definition}</div>}
                  {d.cn && <div className="eag-def-cn">{d.cn}</div>}
                  {d.example && <div className="eag-def-example">— {d.example}</div>}
                </div>
              </li>
            ))}
          </ol>
        </div>
      ))}
    </div>
  );
}

/**
 * DictCard 的 scoped CSS。挂在 `.eag-dict-card` 下，调用方一次 inject。
 *
 * 设计选择：CSS variables 挂在 `.eag-dict-card` 而不是 `:root`，所以 DictCard
 * 可以独立于外层容器使用（popup 的 `.eag-dialog` 不一定存在；sidepanel 是
 * shadcn/Tailwind 主题，不能污染）。
 */
export const DICT_CARD_CSS = `
.eag-dict-card, .eag-dict-card * { box-sizing: border-box; }
.eag-dict-card {
  --eag-ink: #101012;
  --eag-ink-soft: #3b3b40;
  --eag-muted: #8a897f;
  --eag-faint: #b6b4a8;
  --eag-line: #e9e6df;
  --eag-line-2: #ddd9d0;
  --eag-paper: #fbfaf6;
  --eag-panel: #ffffff;
  --eag-sel-strong: #a9c6ff;
  --eag-sand: #9a7330;
  --eag-sand-bg: #f6efe1;
  --eag-control-bg: #faf8f3;
  --eag-control-hover: #f4f1ea;
  /* 字体：完全跟系统默认 —— system-ui 在 Mac=SF+PingFang、Win=Segoe+YaHei、
   * Linux=系统默认；serif 兜底 Georgia（桌面级常驻字体）。无任何下载。 */
  --eag-ui: system-ui, sans-serif;
  --eag-read: Georgia, serif;

  font-family: var(--eag-ui);
  color: var(--eag-ink);
  -webkit-font-smoothing: antialiased;
}

/* SidePanel 由 html.dark 驱动主题。DictCard 自带 scoped 色板，因此需要在这里
 * 同步覆盖，而不能只依赖外层 WordCard 的 text-foreground / bg-card。 */
.dark .eag-dict-card {
  --eag-ink: #f4f4f5;
  --eag-ink-soft: #d4d4d8;
  --eag-muted: #a1a1aa;
  --eag-faint: #71717a;
  --eag-line: #3f3f46;
  --eag-line-2: #52525b;
  --eag-paper: #18181b;
  --eag-panel: #27272a;
  --eag-sel-strong: #7aa2f7;
  --eag-sand: #e6bd72;
  --eag-sand-bg: #3b3020;
  --eag-control-bg: #27272a;
  --eag-control-hover: #3f3f46;
}

/* IPA + 发音按钮 */
.eag-dict-card .eag-ipa-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
  flex-wrap: wrap;
}
.eag-dict-card .eag-ipa {
  display: inline-flex;
  align-items: baseline;
  gap: 5px;
  font-size: 13px;
  color: var(--eag-ink-soft);
}
.eag-dict-card .eag-ipa em {
  font-style: normal;
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: .06em;
  color: var(--eag-faint);
  text-transform: uppercase;
}
.eag-dict-card .eag-speak {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border-radius: 9px;
  border: 1px solid var(--eag-line);
  background: var(--eag-control-bg);
  color: var(--eag-ink);
  cursor: pointer;
  position: relative;
  flex: none;
  padding: 0;
  transition: border-color .12s, background .12s;
}
.eag-dict-card .eag-speak:hover { border-color: var(--eag-line-2); background: var(--eag-control-hover); }
.eag-dict-card .eag-speak.eag-on::after {
  content: "";
  position: absolute;
  inset: -4px;
  border-radius: 12px;
  border: 2px solid var(--eag-sel-strong);
  animation: eag-card-ring 1s ease-out infinite;
  pointer-events: none;
}
@keyframes eag-card-ring {
  0%   { opacity: .9; transform: scale(.85); }
  100% { opacity: 0;  transform: scale(1.25); }
}

/* compact 释义 —— CSS Grid 两列：POS 列宽 = auto（取本卡所有 POS 中最长那个的
 * 实际宽度），所有行共享这一宽度；每行 POS → body gap 固定 6px。
 *
 * 为什么不用 flex + 固定 width：POS 长度从 "n." 到 "interj." 差几倍，写死宽
 * 度要么截长 POS、要么让短 POS 跟正文拉远。grid auto-track 是真正的"按内
 * 容自适应"，把这个问题一次解决。
 *
 * .eag-def-row 用 display:contents 把自己从盒模型里抽掉，让它的两个子
 * 元素直接成为父 grid 的 item，自动占据相邻两列。 */
.eag-dict-card .eag-defs {
  display: grid;
  grid-template-columns: auto 1fr;
  column-gap: 6px;
  row-gap: 8px;
  align-items: baseline;
  color: var(--eag-ink-soft);
}
.eag-dict-card .eag-def-row { display: contents; }
.eag-dict-card .eag-pos {
  color: var(--eag-muted);
  font-style: italic;
  font-family: var(--eag-ui);
  font-size: 12.5px;
  white-space: nowrap; /* POS 不允许换行劈裂，否则 auto track 测量会乱 */
}
.eag-dict-card .eag-def-body {
  flex: 1 1 auto;
  min-width: 0;
}
/* EN 主行：衬线、ink、稍重；wrap 后从 body 左缘 hanging 对齐 */
.eag-dict-card .eag-def-en {
  font-family: var(--eag-read);
  font-size: 14px;
  line-height: 1.45;
  color: var(--eag-ink);
  font-weight: 500;
}
/* CN 副行：跟 EN 同栏左对齐；小、灰 */
.eag-dict-card .eag-def-cn {
  font-family: var(--eag-ui);
  font-size: 11.5px;
  line-height: 1.4;
  color: var(--eag-muted);
  margin-top: 1px;
}

/* rich 释义（编号列表 + 例句） */
.eag-dict-card .eag-defs-rich { display: flex; flex-direction: column; gap: 12px; }
.eag-dict-card .eag-pos-block { display: flex; flex-direction: column; gap: 7px; }
.eag-dict-card .eag-pos-title {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: .12em;
  color: var(--eag-muted);
  text-transform: uppercase;
}
.eag-dict-card .eag-def-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 9px;
}
.eag-dict-card .eag-def-item {
  display: flex;
  gap: 8px;
  font-size: 13px;
  line-height: 1.55;
}
.eag-dict-card .eag-def-index {
  flex: none;
  color: var(--eag-faint);
  font-variant-numeric: tabular-nums;
  margin-top: 1px;
}
.eag-dict-card .eag-def-body { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 2px; }
.eag-dict-card .eag-def-en {
  font-family: var(--eag-read);
  color: var(--eag-ink);
}
.eag-dict-card .eag-def-cn { color: var(--eag-ink-soft); }
.eag-dict-card .eag-def-example {
  font-size: 12px;
  font-style: italic;
  color: var(--eag-muted);
  margin-top: 2px;
}

/* 难度 / Collins / Oxford / 估算 chips */
.eag-dict-card .eag-tags {
  display: flex;
  gap: 6px;
  margin-top: 10px;
  flex-wrap: wrap;
}
.eag-dict-card .eag-tag {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: .04em;
  color: var(--eag-sand);
  background: var(--eag-sand-bg);
  border-radius: 6px;
  padding: 3px 7px;
}

/* 形态变化表 —— 不用分隔线，靠 margin 撑开 */
.eag-dict-card .eag-exchange {
  font-size: 11.5px;
  color: var(--eag-muted);
  margin-top: 10px;
  letter-spacing: .02em;
  line-height: 1.55;
}
.eag-dict-card .eag-ex-lemma { color: var(--eag-ink); font-weight: 600; }
/* label + word 锁成不可换行对，gap 4px 由 CSS 精确控（不靠字面空格） */
.eag-dict-card .eag-ex-pair {
  display: inline-flex;
  align-items: baseline;
  gap: 4px;
  letter-spacing: 0;
  white-space: nowrap;
}
.eag-dict-card .eag-ex-label { color: var(--eag-faint); }
.eag-dict-card .eag-ex-word { color: var(--eag-ink-soft); }
.eag-dict-card .eag-ex-hit {
  /* 命中 surfaceForm 的条目 —— 沙色背景 + 深色文字，跟难度 chip 同色系 */
  background: var(--eag-sand-bg);
  color: var(--eag-sand);
  font-weight: 600;
  padding: 1px 5px;
  border-radius: 4px;
}
.eag-dict-card .eag-ex-sep { color: var(--eag-faint); }
`;
