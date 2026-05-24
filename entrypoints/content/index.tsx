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

export default defineContentScript({
  // 本期只跑在 TechCrunch（PRD §2 在范围）。其他站点等"默认适配器"完工后再放开。
  matches: ['*://techcrunch.com/*', '*://*.techcrunch.com/*'],
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
  },
});

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
        // 转发给 background。这里点击是真实用户手势，background 后续调用
        // chrome.sidePanel.open() 才能被允许。
        const msg: BackgroundMessage = { type: 'ASK_WITH_SELECTION', payload: ctx };
        chrome.runtime.sendMessage(msg);
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
