/**
 * Content Script —— 唯一直接读写页面 DOM 的角色（PRD §3.1 隔离原则）。
 *
 * 职责：
 *   1. 监听用户在文章正文里的鼠标选区
 *   2. 选区一出现就同步抓全 `SelectionContext`（PRD §8.2 命门三：UI 元素只引用缓存，
 *      点击自身组件会清空 window.getSelection()，再去现取就拿不到了）
 *   3. 在 Shadow DOM 里渲染一个"Ask English Agent" pill 浮在选区右上
 *   4. 用户点 pill → `chrome.runtime.sendMessage` 把 SelectionContext 丢给 background
 *      后续打开 sidepanel + 注入语境的事都由 background 总线接管
 *
 * 不在本文件做：完整 popup（PRD §8.1）、被动重逢扫描（PRD §5.2）、双语翻译注入（M3）
 */
import ReactDOM from 'react-dom/client';
import { useEffect, useState } from 'react';
import type { SelectionContext, SelectionType, BackgroundMessage } from '@/lib/messaging';
import { resolveLemma } from '@/lib/lemmatize';
import { TranslateFab } from './translate';

const BACKEND = import.meta.env.WXT_BACKEND_URL ?? 'http://localhost:4010';
const KNOWN_ITEMS_KEY = 'english-agent:known-items';
const KNOWN_ITEMS_TTL_MS = 5 * 60 * 1000;
const SCAN_MAX_CHARS = 5000;

/** 该 lemma 是否本会话已经被用户主动选过（避免被动重逢误标）。Content script
 * 是 per-page-load 实例，Set 自然是 page-scoped，不需要手动清理。 */
const activelyQueriedLemmas = new Set<string>();
/** 已经上报过 passive 的 lemma，本次 page-load 内不重复上报。 */
const reportedPassiveLemmas = new Set<string>();

export default defineContentScript({
  // 放开到所有 http(s) 站点：选区捕获 / 全文翻译 / 词典查询都是通用能力，
  // PRD §3.2 "默认适配器"已隐式覆盖（无站点适配器时走 BLOCK_SELECTOR + Readability）。
  // 隐私 trade-off：Chrome 安装时会提示"读取你访问的所有网站"。
  matches: ['<all_urls>'],
  // 关键：WXT 把 CSS 注入到 shadow root 而不是宿主页面，做到样式互不污染（PRD §10）。
  cssInjectionMode: 'ui',
  async main(ctx) {
    const ui = await createShadowRootUi(ctx, {
      name: 'english-agent-pill',
      // overlay 模式 + 巨大 z-index：保证 pill 浮在 TechCrunch 自己的导航/弹窗之上。
      position: 'overlay',
      alignment: 'top-left',
      zIndex: 2147483647,
      anchor: 'body',
      onMount: (container) => {
        const host = document.createElement('div');
        container.append(host);
        const root = ReactDOM.createRoot(host);
        root.render(<SelectionPill />);
        return root;
      },
      onRemove: (root) => root?.unmount(),
    });
    ui.mount();

    // 全文翻译浮动按钮（M3 PRD §7.1）—— 独立 Shadow DOM，与 pill 状态解耦
    const fabUi = await createShadowRootUi(ctx, {
      name: 'english-agent-fab',
      position: 'overlay',
      alignment: 'bottom-right',
      zIndex: 2147483646,
      anchor: 'body',
      onMount: (container) => {
        const host = document.createElement('div');
        container.append(host);
        const root = ReactDOM.createRoot(host);
        root.render(<TranslateFab />);
        return root;
      },
      onRemove: (root) => root?.unmount(),
    });
    fabUi.mount();

    // 被动重逢扫描（PRD §5.2 / §8.2 弱正信号）—— 在 idle 时扫一次
    schedulePassiveScan();

    // 接 sidepanel 经 background 转过来的"回原文高亮"请求（PRD §8.3）
    chrome.runtime.onMessage.addListener((message: BackgroundMessage) => {
      if (message.type === 'HIGHLIGHT_ANCHOR') {
        highlightAnchor(message.payload);
      }
      return false;
    });
  },
});

/**
 * 找到 anchor 指向的位置 + 滚到 + 闪黄高亮 1.5s（PRD §8.3）。
 *
 * 策略（精度从高到低尝试）：
 *   1. 找一个 block element 同时包含 prefix+exact+suffix 子串（前 30 字符）
 *      —— 高置信度，定位精确
 *   2. 退化：找包含 exact 子串的 block —— 同名 token 多次出现时可能不准
 *
 * 不做基于 Range 的精确文本包裹（多 text node 跨边界很麻烦），
 * 直接给整个 block 临时换 background-color，足够引导眼睛。
 */
function highlightAnchor(anchor: SelectionContext['anchor']) {
  const blocks = Array.from(document.querySelectorAll(BLOCK_SELECTOR));
  const needle = (anchor.quote.prefix + anchor.quote.exact + anchor.quote.suffix).slice(0, 60);
  const target =
    blocks.find((el) => ((el as HTMLElement).innerText ?? '').includes(needle)) ??
    blocks.find((el) => ((el as HTMLElement).innerText ?? '').includes(anchor.quote.exact));
  if (!target) {
    console.warn('[english-agent] highlight: anchor not found', anchor.quote.exact);
    return;
  }
  target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  flashHighlight(target as HTMLElement);
}

function flashHighlight(el: HTMLElement) {
  const prevTransition = el.style.transition;
  const prevBg = el.style.backgroundColor;
  el.style.transition = 'background-color 0.3s';
  el.style.backgroundColor = 'rgba(255, 235, 59, 0.45)';
  setTimeout(() => {
    el.style.backgroundColor = prevBg;
    setTimeout(() => {
      el.style.transition = prevTransition;
    }, 350);
  }, 1500);
}

/**
 * 被动重逢扫描：等到 DOM 就绪 + 1 秒空闲，扫文章正文匹配用户已查 lemma 集合，
 * batch 上报命中（去本会话主动选过的）。
 */
function schedulePassiveScan() {
  const run = () => setTimeout(runPassiveScan, 1000);
  if (document.readyState === 'complete') {
    run();
  } else {
    window.addEventListener('load', run, { once: true });
  }
}

async function runPassiveScan() {
  try {
    const knownLemmas = await fetchKnownLemmas();
    if (knownLemmas.size === 0) return;

    // 收集文章正文（用跟选区识别一样的 block selector）
    const blocks = document.querySelectorAll(BLOCK_SELECTOR);
    let text = '';
    for (const el of Array.from(blocks)) {
      text += ' ' + ((el as HTMLElement).textContent ?? '');
      if (text.length > SCAN_MAX_CHARS) break;
    }
    text = text.slice(0, SCAN_MAX_CHARS);

    const hits: Array<{ surfaceForm: string; lemma: string }> = [];
    const seenInThisScan = new Set<string>();

    if (typeof Intl?.Segmenter === 'function') {
      const seg = new Intl.Segmenter('en', { granularity: 'word' });
      for (const part of seg.segment(text)) {
        if (!part.isWordLike) continue;
        const w = part.segment;
        // 过滤太短 / 含数字
        if (w.length < 3 || /\d/.test(w)) continue;
        const lemma = resolveLemma(w);
        if (!knownLemmas.has(lemma)) continue;
        if (activelyQueriedLemmas.has(lemma)) continue;
        if (reportedPassiveLemmas.has(lemma)) continue;
        if (seenInThisScan.has(lemma)) continue;
        seenInThisScan.add(lemma);
        hits.push({ surfaceForm: w, lemma });
      }
    }

    if (hits.length === 0) return;
    for (const h of hits) reportedPassiveLemmas.add(h.lemma);

    const msg: BackgroundMessage = { type: 'PASSIVE_HITS', payload: hits };
    chrome.runtime.sendMessage(msg).catch(() => {
      /* background 没起来也无所谓，丢就丢 */
    });
  } catch (err) {
    console.warn('[english-agent] passive scan failed', err);
  }
}

/** 拉用户已查 lemma 集合，session storage 缓存 5 分钟。 */
async function fetchKnownLemmas(): Promise<Set<string>> {
  try {
    const cached = await chrome.storage.session.get(KNOWN_ITEMS_KEY);
    const entry = cached[KNOWN_ITEMS_KEY] as
      | { lemmas: string[]; expiresAt: number }
      | undefined;
    if (entry && entry.expiresAt > Date.now()) {
      return new Set(entry.lemmas);
    }
    const res = await fetch(`${BACKEND}/api/known-items`);
    if (!res.ok) return new Set();
    const data = (await res.json()) as { lemmas: string[] };
    const lemmas = data.lemmas ?? [];
    await chrome.storage.session.set({
      [KNOWN_ITEMS_KEY]: { lemmas, expiresAt: Date.now() + KNOWN_ITEMS_TTL_MS },
    });
    return new Set(lemmas);
  } catch (err) {
    console.warn('[english-agent] fetchKnownLemmas failed', err);
    return new Set();
  }
}

/**
 * Pill 组件：监听 mouseup / selectionchange，抓选区，渲染浮窗按钮。
 *
 * 注意：所有"抓选区"逻辑放在 effect 里同步跑（PRD §8.2 命门三），把结果 setState 进
 * `snapshot`；后续 pill 自己的 onClick 不会再去读 window.getSelection()。
 */
function SelectionPill() {
  const [snapshot, setSnapshot] = useState<{
    ctx: SelectionContext;
    rect: DOMRect;  // 选区的视口坐标，用于定位 pill
  } | null>(null);

  useEffect(() => {
    function onMouseUp() {
      // rAF 让浏览器先把 selection 算稳定 —— 直接在 mouseup 同步读 selection
      // 在某些站点会拿到上一次的残留状态。
      requestAnimationFrame(() => {
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed) {
          setSnapshot(null);
          return;
        }
        const text = sel.toString().trim();
        if (!text) {
          setSnapshot(null);
          return;
        }
        const range = sel.getRangeAt(0);
        // 用户在导航/侧边栏里乱选我们不响应，必须落在文章正文块里。
        const block = findContentBlock(range.startContainer);
        if (!block) {
          setSnapshot(null);
          return;
        }
        const ctx = buildSelectionContext(text, range, block);
        if (!ctx) {
          setSnapshot(null);
          return;
        }
        setSnapshot({ ctx, rect: range.getBoundingClientRect() });
      });
    }
    function onSelectionChange() {
      // 用户清掉选区时同步隐藏 pill。注意只清不重抓 —— 重抓走 mouseup。
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) setSnapshot(null);
    }
    document.addEventListener('mouseup', onMouseUp);
    document.addEventListener('selectionchange', onSelectionChange);
    return () => {
      document.removeEventListener('mouseup', onMouseUp);
      document.removeEventListener('selectionchange', onSelectionChange);
    };
  }, []);

  if (!snapshot) return null;

  const { ctx, rect } = snapshot;
  // pill 放在选区右上：rect.right + 6 / rect.top - 36
  // 用 scrollX/Y 把视口坐标转成 document 坐标，跟我们 position:absolute 的根元素配合。
  const top = window.scrollY + rect.top - 36;
  const left = window.scrollX + rect.right + 6;

  return (
    <button
      type="button"
      // 关键：mousedown 默认会让浏览器清掉当前 selection（"在按钮上按下"会移动焦点），
      // 所以 preventDefault + stopPropagation 阻止；click 仍然能正常触发。
      onMouseDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onClick={() => {
        // 单词选区：记下 lemma，避免本会话再扫到时误报 passive_reencounter。
        // 防御：lemmatize 在 bundled 浏览器环境若异常，绝不能阻塞 sendMessage。
        try {
          if (ctx.selection.type === 'word') {
            activelyQueriedLemmas.add(resolveLemma(ctx.selection.text));
          }
        } catch (err) {
          console.warn('[english-agent] resolveLemma in pill click threw', err);
        }
        // 转发给 background。这里点击是真实用户手势，background 后续调用
        // chrome.sidePanel.open() 才能被允许。
        const msg: BackgroundMessage = { type: 'ASK_WITH_SELECTION', payload: ctx };
        chrome.runtime.sendMessage(msg).catch((err) => {
          console.warn('[english-agent] ASK_WITH_SELECTION send failed', err);
        });
        setSnapshot(null);
      }}
      style={{
        position: 'absolute',
        top,
        left,
        padding: '6px 10px',
        background: '#111',
        color: '#fff',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: 12,
        lineHeight: 1,
        borderRadius: 6,
        border: 'none',
        cursor: 'pointer',
        boxShadow: '0 4px 14px rgba(0,0,0,0.35)',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
      }}
    >
      <span style={{ fontSize: 13 }}>🔍</span>
      Ask English Agent
    </button>
  );
}

// 文章正文里"句子级"块的标签。PRD §8.2 命门一的"块"= 这里 closest() 命中的最近祖先。
// 这是默认适配器；TechCrunch 适配器以后可以扩这个列表（PRD §3.2）。
const BLOCK_SELECTOR = 'p, li, blockquote, h1, h2, h3, h4, h5, h6, dd';

function findContentBlock(node: Node | null): HTMLElement | null {
  let cur: Node | null = node;
  while (cur && cur !== document.body) {
    if (cur.nodeType === Node.ELEMENT_NODE) {
      const el = cur as HTMLElement;
      if (el.matches?.(BLOCK_SELECTOR)) return el;
    }
    cur = cur.parentNode;
  }
  return null;
}

/**
 * PRD §8.2 命门一 —— 计算"选区起点"在所在块内的纯文本字符偏移。
 *
 * 原理：克隆一个 range，从块的第一个节点起，到 (container, offset) 止，
 * 然后取 toString().length。这一步会把所有内联标签（<a>/<em>/<strong>）
 * 拍平成连续文本，得到选区在用户视觉文本里的真实位置 —— 后续切句、
 * 生成 anchor、序列化坐标都基于这套统一坐标系。
 */
function offsetWithinBlock(block: HTMLElement, container: Node, offset: number): number {
  const r = document.createRange();
  r.setStart(block, 0);
  r.setEnd(container, offset);
  return r.toString().length;
}

/**
 * PRD §8.2 命门二 —— 用 `Intl.Segmenter` 切句，找出覆盖选区的那一句。
 *
 * 为什么不用正则：`text.split(/[.!?]/)` 会把 "U.S.A." / "3.14" / "Dr. Smith" 切碎。
 * `Intl.Segmenter` 是 ECMAScript 国际化标准，知道缩写、小数、引号等语言规则。
 * 退化方案保留以防 jsdom / 老浏览器没实现这个 API。
 */
function findCoveringSentence(paragraph: string, selStart: number, selEnd: number): string {
  if (typeof Intl?.Segmenter !== 'function') {
    const fallback = paragraph.match(/[^.!?]+[.!?]+/g) ?? [paragraph];
    let cursor = 0;
    for (const s of fallback) {
      const end = cursor + s.length;
      if (selStart >= cursor && selEnd <= end) return s.trim();
      cursor = end;
    }
    return paragraph;
  }
  const seg = new Intl.Segmenter(document.documentElement.lang || 'en', {
    granularity: 'sentence',
  });
  for (const part of seg.segment(paragraph)) {
    const start = part.index;
    const end = start + part.segment.length;
    if (selStart >= start && selEnd <= end) return part.segment.trim();
  }
  return paragraph;
}

/**
 * PRD §8.1 选区类型 —— 决定弹窗（未来）显示哪一组快捷按钮，
 * 也决定 sidepanel 的语境卡 badge。
 */
function classifySelection(text: string): SelectionType {
  const trimmed = text.trim();
  const words = trimmed.split(/\s+/).filter(Boolean);
  const hasSentenceEnd = /[.!?。？！]/.test(trimmed);
  if (words.length === 1) return 'word';
  if (words.length <= 5 && !hasSentenceEnd) return 'phrase';
  // 两个或以上句尾标点 = 多句选择
  const sentenceMarks = (trimmed.match(/[.!?。？！]/g) ?? []).length;
  if (sentenceMarks >= 2) return 'multi';
  return 'sentence';
}

/**
 * 生成 TextQuoteSelector 锚点（W3C Web Annotation Model 子集，PRD §5.1）。
 * exact + 上下文各 40 字符。M2 复习时用这个回原文高亮。
 */
function buildAnchor(paragraph: string, selStart: number, selEnd: number) {
  const CONTEXT = 40;
  return {
    quote: {
      exact: paragraph.slice(selStart, selEnd),
      prefix: paragraph.slice(Math.max(0, selStart - CONTEXT), selStart),
      suffix: paragraph.slice(selEnd, Math.min(paragraph.length, selEnd + CONTEXT)),
    },
  };
}

/**
 * 把上面所有结果组装成 SelectionContext（PRD §5.1）。
 *
 * id 暂用 `crypto.randomUUID()`；PRD 写的是 ULID，但后端 schema 用 text 列，
 * 任何字符串都能存，等需要按时间排序再换 ULID 生成器。
 */
function buildSelectionContext(
  text: string,
  range: Range,
  block: HTMLElement,
): SelectionContext | null {
  const paragraph = block.textContent ?? '';
  if (!paragraph) return null;

  const start = offsetWithinBlock(block, range.startContainer, range.startOffset);
  const end = offsetWithinBlock(block, range.endContainer, range.endOffset);
  if (start === end) return null;

  const sentence = findCoveringSentence(paragraph, start, end);
  // 文章标题 / 大标题：TechCrunch 用 [data-testid="article-headline"]，默认走 h1。
  const heading = (
    document.querySelector('h1, [data-testid="article-headline"]') as HTMLElement | null
  )?.innerText?.trim();

  return {
    id: crypto.randomUUID(),
    capturedAt: new Date().toISOString(),
    source: {
      url: location.href,
      title: document.title,
      siteId: detectSiteId(),
      heading: heading || undefined,
    },
    selection: {
      text,
      type: classifySelection(text),
      range: [start, end],
    },
    context: {
      sentence,
      paragraph,
    },
    anchor: buildAnchor(paragraph, start, end),
  };
}

// 简易站点识别 —— 后续 PRD §3.2 站点适配器接入这里。
function detectSiteId(): string {
  const host = location.hostname;
  if (/(^|\.)techcrunch\.com$/.test(host)) return 'techcrunch';
  return 'default';
}
