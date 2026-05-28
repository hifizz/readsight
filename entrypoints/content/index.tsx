/**
 * Content Script —— 唯一直接读写页面 DOM 的角色（PRD §3.1 隔离原则）。
 *
 * 职责：
 *   1. 监听用户在文章正文里的鼠标选区
 *   2. 选区一出现就同步抓全 `SelectionContext`（PRD §8.2 命门三：UI 元素只引用缓存，
 *      点击自身组件会清空 window.getSelection()，再去现取就拿不到了）
 *   3. 在 Shadow DOM 里渲染一个 "Look up with Readsight" pill 浮在选区右上
 *   4. 用户点 pill → `chrome.runtime.sendMessage` 把 SelectionContext 丢给 background
 *      后续打开 sidepanel + 注入语境的事都由 background 总线接管
 *
 * 不在本文件做：完整 popup（PRD §8.1）、被动重逢扫描（PRD §5.2）、双语翻译注入（M3）
 */
import ReactDOM from 'react-dom/client';
import { useEffect, useState } from 'react';
import type { SelectionContext, SelectionType, BackgroundMessage } from '@/lib/messaging';
import { resolveLemma } from '@/lib/lemmatize';
import { Sparkles } from 'lucide-react';
import { TranslateFab, togglePageTranslation, onTranslateStateChange } from './translate';
import { ImmersiveReader } from './immersive-reader';
import { SelectionPopup, openPopup, useIsPopupOpen } from './popup';
import { clearDomainRule } from '@/lib/domain-rules';

const BACKEND = import.meta.env.WXT_BACKEND_URL ?? 'http://localhost:4010';
const KNOWN_ITEMS_KEY = 'readsight:known-items';
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
      name: 'readsight-pill',
      // overlay 模式 + 巨大 z-index：保证 pill 浮在宿主页面的导航 / sticky / 弹窗之上。
      position: 'overlay',
      alignment: 'top-left',
      zIndex: 2147483647,
      anchor: 'body',
      onMount: (container) => {
        const host = document.createElement('div');
        container.append(host);
        const root = ReactDOM.createRoot(host);
        // pill 和 popup 同一个 Shadow DOM，z-index / 样式一致；
        // 由 popup 自己的 useSyncExternalStore 决定是否显示
        root.render(
          <>
            <SelectionPill />
            <SelectionPopup />
          </>,
        );
        return root;
      },
      onRemove: (root) => root?.unmount(),
    });
    ui.mount();

    // 全文翻译浮动按钮（M3 PRD §7.1）—— 独立 Shadow DOM，与 pill 状态解耦
    const fabUi = await createShadowRootUi(ctx, {
      name: 'readsight-fab',
      position: 'overlay',
      alignment: 'bottom-right',
      // 32-bit int 上限，跟很多站点同优先级时按 DOM 顺序决出胜负；
      // shadowHost append 较早，但因为是 body 子节点，多数情况能压住。
      zIndex: 2147483647,
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

    // 沉浸式对照阅读（FAB 菜单"对照阅读"打开）—— 独立 Shadow DOM，蒙层全屏
    // 时不影响 FAB 状态机。监听 window 'eag:open-immersive' 事件触发显示。
    const immersiveUi = await createShadowRootUi(ctx, {
      name: 'readsight-immersive',
      position: 'overlay',
      // alignment 对 fixed 定位的蒙层不重要 —— host 元素只是挂载点，内部用 position:fixed
      alignment: 'top-left',
      zIndex: 2147483647,
      anchor: 'body',
      onMount: (container) => {
        const host = document.createElement('div');
        container.append(host);
        const root = ReactDOM.createRoot(host);
        root.render(<ImmersiveReader />);
        return root;
      },
      onRemove: (root) => root?.unmount(),
    });
    immersiveUi.mount();

    // 把翻译状态变化通知 background，让右键菜单标题动态更新
    onTranslateStateChange((status) => {
      chrome.runtime
        .sendMessage({
          type: 'TRANSLATE_STATE_CHANGED',
          payload: { active: status === 'active' },
        } satisfies BackgroundMessage)
        .catch(() => {
          /* background 没起来就吞 */
        });
    });

    // 被动重逢扫描（PRD §5.2 / §8.2 弱正信号）—— 在 idle 时扫一次
    schedulePassiveScan();

    // 接 background 转过来的消息：回原文高亮（PRD §8.3）+ 右键 / 快捷键切翻译 + 划词右键
    chrome.runtime.onMessage.addListener((message: BackgroundMessage) => {
      if (message.type === 'HIGHLIGHT_ANCHOR') {
        highlightAnchor(message.payload);
      } else if (message.type === 'TOGGLE_TRANSLATE') {
        togglePageTranslation();
      } else if (message.type === 'TRANSLATE_SELECTION') {
        openPopupFromCurrentSelection();
      } else if (message.type === 'RESET_DOMAIN_RULE') {
        // 通用恢复：清掉本域名规则。subscribeDomainRule 会通知 FAB 重渲染，
        // 'never' 被清后 FAB 重新出现，'always' 被清后下次刷新不再自动翻。
        // 注：当前页面已经在跑的翻译不会因此停止 —— 用户可以手动撤销。
        void clearDomainRule(location.hostname);
        console.log('[readsight] domain rule reset for', location.hostname);
      }
      return false;
    });
  },
});

/**
 * 从 window.getSelection() 重新抓选区并打开 Dialog —— 右键菜单"翻译选中内容"入口。
 *
 * 浏览器在右键菜单展示时通常保留 selection，但 user agent 行为有差异：
 * 兜底 1 = 直接读 selection；如果选区已 collapse，console.warn 提示。
 *
 * 走和 Pill click 一样的 buildSelectionContext + openPopup 路径，
 * 锚点 rect 取 selection 的 BoundingClientRect，这样 Dialog 紧贴选区显示。
 */
function openPopupFromCurrentSelection(): void {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed) {
    console.warn('[readsight] TRANSLATE_SELECTION: no active selection');
    return;
  }
  const text = sel.toString().trim();
  if (!text) {
    console.warn('[readsight] TRANSLATE_SELECTION: empty selection text');
    return;
  }
  const range = sel.getRangeAt(0);
  // 右键菜单可能在导航 / sidebar 上触发，这里要求选区落在文章块里 ——
  // 跟 Pill 一致的约束，避免把"菜单标题"这类噪音也送进 Dialog。
  const block = findContentBlock(range.startContainer);
  if (!block) {
    console.warn('[readsight] TRANSLATE_SELECTION: selection not in a content block');
    return;
  }
  const ctx = buildSelectionContext(text, range, block);
  if (!ctx) return;
  try {
    if (ctx.selection.type === 'word') {
      activelyQueriedLemmas.add(resolveLemma(ctx.selection.text));
    }
  } catch (err) {
    console.warn('[readsight] resolveLemma in TRANSLATE_SELECTION threw', err);
  }
  const rect = range.getBoundingClientRect();
  openPopup(ctx, {
    rect: { top: rect.top, left: rect.left, right: rect.right, bottom: rect.bottom },
  });
}

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
    console.warn('[readsight] highlight: anchor not found', anchor.quote.exact);
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
    console.warn('[readsight] passive scan failed', err);
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
    console.warn('[readsight] fetchKnownLemmas failed', err);
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
    /** 选区所在容器的真实底色判定。null = 采样不到（透明栈到底），交给 CSS prefers-color-scheme 兜底。 */
    bgScheme: 'light' | 'dark' | null;
  } | null>(null);
  // popup 打开时 pill 隐藏 —— 用模块级 popup state 订阅，避免本地兄弟组件状态不同步
  const popupOpen = useIsPopupOpen();

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
        const bgScheme = detectBgScheme(block);
        setSnapshot({ ctx, rect: range.getBoundingClientRect(), bgScheme });
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

  // popup 已开 = 不显示 pill（避免两者并存的视觉混乱）
  if (popupOpen || !snapshot) return null;

  const { ctx, rect } = snapshot;
  // 视觉规则（来自 docs/lookup.jsx）：pill 居中浮在选区上方，44px gap，
  // 视口边缘留 60px 安全区防贴边。translateX(-50%) 把 left 当中点用。
  const vw = window.innerWidth;
  const left = Math.min(Math.max(rect.left + rect.width / 2, 60), vw - 60);
  const top = Math.max(rect.top - 44, 8);

  return (
    <>
      <style>{PILL_CSS}</style>
      <button
        type="button"
        className="eag-pill"
        data-bg={snapshot.bgScheme ?? undefined}
        // mousedown 默认会让浏览器清掉当前 selection；阻止它，click 仍能正常触发。
        onMouseDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        onClick={() => {
          try {
            if (ctx.selection.type === 'word') {
              activelyQueriedLemmas.add(resolveLemma(ctx.selection.text));
            }
          } catch (err) {
            console.warn('[readsight] resolveLemma in pill click threw', err);
          }
          openPopup(ctx, {
            rect: {
              top: rect.top,
              left: rect.left,
              right: rect.right,
              bottom: rect.bottom,
            },
          });
          setSnapshot(null);
        }}
        aria-label="Look up with Readsight"
        title="Look up"
        style={{ top, left }}
      >
        <Sparkles size={13} strokeWidth={2.25} className="eag-pill-icon" />
        Look up
      </button>
    </>
  );
}

/**
 * Pill 的 scoped CSS（lookup.jsx 视觉）。
 *
 * 配色自适应（两道）：
 *   1. CSS @media prefers-color-scheme: dark —— 用户 OS 暗色 → pill 翻成白底黑字
 *      （宿主页深色背景下保持可见）
 *   2. JS 采样 data-bg —— pill 渲染时读宿主真实底色覆盖 OS 偏好
 *      （e.g., OS 浅色但站点强制深色 / OS 深色但站点是白底新闻）
 *
 * 用 CSS 变量集中切色板，避免 hover / 投影到处复制。
 */
const PILL_CSS = `
.eag-pill {
  /* 默认色板：深色 pill 适配浅色宿主页 */
  --eag-pill-bg: #101012;
  --eag-pill-fg: #fff;
  --eag-pill-bg-hover: #26262a;
  --eag-pill-shadow:
    0 6px 20px rgba(16, 16, 18, .28),
    0 1px 3px rgba(16, 16, 18, .4),
    0 0 0 1px rgba(255, 255, 255, .06) inset;

  position: fixed;
  z-index: 2147483646;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  background: var(--eag-pill-bg);
  color: var(--eag-pill-fg);
  border: none;
  border-radius: 999px;
  padding: 10px 14px 10px 12px;
  font-family: system-ui, sans-serif;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.1;
  letter-spacing: .2px;
  white-space: nowrap;
  cursor: pointer;
  box-shadow: var(--eag-pill-shadow);
  transform: translateX(-50%);
  transform-origin: 50% 120%;
  animation: eag-pill-in .16s cubic-bezier(.2, .8, .3, 1.1) both;
  transition: background-color .15s ease, box-shadow .15s ease;
  -webkit-font-smoothing: antialiased;
}
.eag-pill:hover { background: var(--eag-pill-bg-hover); }
.eag-pill:active { transform: translateX(-50%) scale(.96); }
.eag-pill-icon { color: #6ddca0; flex: none; }

/* 浅色 pill 色板（白底深字）—— 给"深色宿主背景"用 */
@media (prefers-color-scheme: dark) {
  .eag-pill:not([data-bg="light"]) {
    --eag-pill-bg: #ffffff;
    --eag-pill-fg: #101012;
    --eag-pill-bg-hover: #f3f1eb;
    --eag-pill-shadow:
      0 6px 20px rgba(0, 0, 0, .45),
      0 1px 3px rgba(0, 0, 0, .35),
      0 0 0 1px rgba(0, 0, 0, .1) inset;
  }
}
/* JS 采样优先级最高：宿主真实底色定调，跨过 OS 偏好 */
.eag-pill[data-bg="dark"] {
  --eag-pill-bg: #ffffff;
  --eag-pill-fg: #101012;
  --eag-pill-bg-hover: #f3f1eb;
  --eag-pill-shadow:
    0 6px 20px rgba(0, 0, 0, .45),
    0 1px 3px rgba(0, 0, 0, .35),
    0 0 0 1px rgba(0, 0, 0, .1) inset;
}
.eag-pill[data-bg="light"] {
  --eag-pill-bg: #101012;
  --eag-pill-fg: #fff;
  --eag-pill-bg-hover: #26262a;
  --eag-pill-shadow:
    0 6px 20px rgba(16, 16, 18, .28),
    0 1px 3px rgba(16, 16, 18, .4),
    0 0 0 1px rgba(255, 255, 255, .06) inset;
}

@keyframes eag-pill-in {
  from { opacity: 0; transform: translateX(-50%) translateY(5px) scale(.92); }
  to   { opacity: 1; transform: translateX(-50%) translateY(0)   scale(1);   }
}
`;

/**
 * 沿祖先链找第一个不透明背景色，按相对亮度判定 light / dark。
 * 透明栈到顶都没拿到 → 返 null，交给 prefers-color-scheme 兜底。
 *
 * 不做 gamma 修正，简化的加权平均阈值 0.5 已经覆盖绝大多数场景。
 * 站点用 image / gradient 做 bg 拿到的 backgroundColor 通常是 "transparent"
 * 或一个跟主视觉无关的 fallback —— 这种情况下我们更宁愿让 CSS 兜底。
 */
function detectBgScheme(start: Element | null): 'light' | 'dark' | null {
  let cur: Element | null = start;
  while (cur) {
    const bg = getComputedStyle(cur).backgroundColor;
    const lum = parseRgbLuminance(bg);
    if (lum !== null) return lum < 0.5 ? 'dark' : 'light';
    cur = cur.parentElement;
  }
  return null;
}

function parseRgbLuminance(rgb: string): number | null {
  const m = rgb.match(
    /^rgba?\(\s*(\d+)\s*,?\s*(\d+)\s*,?\s*(\d+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/,
  );
  if (!m) return null;
  const a = m[4] !== undefined ? parseFloat(m[4]) : 1;
  if (a < 0.5) return null; // 透明 / 半透明都跳过，继续往上走
  const r = parseInt(m[1], 10) / 255;
  const g = parseInt(m[2], 10) / 255;
  const b = parseInt(m[3], 10) / 255;
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

// 文章正文里"句子级"块的标签。PRD §8.2 命门一的"块"= 这里 closest() 命中的最近祖先。
// 通用适配器，不挂任何站点白名单；如果某些站结构特别奇怪需要定制，再走 PRD §3.2 的站点适配器机制扩这个列表。
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
  // 文章标题 / 大标题：先抓 h1（通用），少数站把标题挂在 [data-testid="article-headline"]
  // 之类属性上做兼容（TC 是一个例子，不是特例）。
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

// 站点标识 —— 直接用 hostname 去掉 www. 前缀。
// 不再硬编码任何站点白名单；PRD §3.2 站点适配器接入时按 hostname 路由即可。
function detectSiteId(): string {
  return location.hostname.replace(/^www\./, '');
}
