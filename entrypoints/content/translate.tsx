/**
 * 全文双语翻译（M3 PRD §7.1 / §10）—— content script 部分。
 *
 * v2 改动（基于用户反馈）：
 *   - 用 @mozilla/readability 识别"真正的正文"，过滤导航 / 广告 / 评论
 *     等不该花 token 翻的边角
 *   - BATCH_SIZE 改 1 → 渐进式逐块出，翻好一块立刻插一块
 *   - 每批 12s 超时（AbortController），超时块标 error + retry，不阻塞其他
 *   - 样式去掉背景 + 左边线，改成"浅色文字"，降低视觉重量、不影响布局
 *
 * 设计：
 *   - 译文节点纯 DOM（非 Shadow）+ 内联 !important 样式 + class，便于选中
 *     复制中文做二次划词，也便于撤销时 querySelectorAll 全清
 *   - 块 → element 映射用 data-eag-id 属性绑定
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Languages, X, ChevronDown } from 'lucide-react';
import { Readability, isProbablyReaderable } from '@mozilla/readability';
import type { BackgroundMessage, TranslationResult } from '@/lib/messaging';
import { useDraggable } from '@/lib/use-draggable';
import {
  type DomainRule,
  clearDomainRule,
  getDomainRule,
  normalizeHostname,
  setDomainRule,
  subscribeDomainRule,
} from '@/lib/domain-rules';
import {
  type DetectionResult,
  detectPageLanguage,
  getUserPrimaryLang,
  isSamePrimary,
  languageLabelZh,
} from '@/lib/page-language';

const BLOCK_SELECTOR = 'p, li, blockquote, h1, h2, h3, h4, h5, h6, dd';
/** 文章正文容器选择器 —— h1 / 内嵌 header 在这种容器内才豁免外部过滤 */
const ARTICLE_ROOT_SELECTOR = 'article, main, [role="main"]';
/** 内联标签：内容当作"代码 / 标识符"占位符发给 LLM，翻译完原样恢复 */
const INLINE_PRESERVE_SELECTOR = 'code, kbd, samp, var, tt';
/** 视口预测：上下 300px 提前进入翻译队列，用户滚动时已经翻译好可见 */
const VIEWPORT_ROOT_MARGIN = '300px 0px 300px 0px';
/**
 * 一个 HTTP 请求最多带几段。
 * DeepSeek 主翻 1-2s 出整批 5 段，可以放大到 12 段（仍在 6000 maxOutputTokens
 * 预算内：12 × ~250 tokens 中文 ≈ 3000 + JSON 框架）。GLM 时代是 5。
 */
const MAX_BATCH_SIZE = 12;
/** debounce：收到第一个块后等多久攒够同批，避免每次进来都立刻发 */
const BATCH_DEBOUNCE_MS = 150;
/** 同时在路上的 batch 上限。DeepSeek 配额比 GLM free 大很多，放到 4 */
const MAX_CONCURRENT_BATCHES = 4;
const ROOT_SELECTOR_CANDIDATES = ['article', 'main', '[role="main"]'];
/** 在这些祖先内的块直接跳过 —— 导航 / 边栏 / 页脚 / 相关阅读等噪声 */
const EXCLUDE_ANCESTOR_SELECTOR = [
  'nav',
  'aside',
  'footer',
  'header',
  '[role="navigation"]',
  '[role="complementary"]',
  '[role="banner"]',
  '[role="contentinfo"]',
  '.related',
  '.related-posts',
  '.related-articles',
  '.sidebar',
  '.comments',
  '.advertisement',
  '.ad',
  '.promo',
  '.newsletter',
].join(',');
const MIN_BLOCK_LENGTH = 30;
// DeepSeek 翻 12 段 ~2-4s + 网络；30s 给足重试 / 兜底链余量。
const BATCH_TIMEOUT_MS = 30_000;
const TRANSLATION_CLASS = 'english-agent-translation';
const BLOCK_ID_ATTR = 'data-eag-id';

/** 找文章正文容器，找不到 fallback 到 body */
function findArticleRoot(): HTMLElement {
  for (const sel of ROOT_SELECTOR_CANDIDATES) {
    const el = document.querySelector<HTMLElement>(sel);
    if (el) return el;
  }
  return document.body;
}

/**
 * 用 Mozilla Readability 算一遍"什么是真正的正文文本"，
 * 返回这些文本的 sentence-level 子串集合。后面用 includes 匹配过滤。
 *
 * Readability mutates 它拿到的 Document，所以传 cloneNode(true)；clone 后
 * Readability 做的 DOM 改动不影响原页面。
 *
 * 失败 / 不适用时返 null，主流程不再做 Readability 过滤，靠 EXCLUDE_ANCESTOR_SELECTOR
 * 兜底。
 */
function buildReadabilityAllowlist(): Set<string> | null {
  try {
    if (!isProbablyReaderable(document)) return null;
    const docClone = document.cloneNode(true) as Document;
    const article = new Readability(docClone).parse();
    if (!article?.textContent) return null;
    // 切成 ≥30 字符的"句子"作为匹配指纹；太短的子串容易误匹配导航
    return new Set(
      article.textContent
        .split(/[.?!\n。？！]+/)
        .map((s) => s.trim())
        .filter((s) => s.length >= 30),
    );
  } catch (err) {
    console.warn('[english-agent] readability parse failed', err);
    return null;
  }
}

/** block 文本里是否包含 allowlist 中任一句子的前 40 字符 —— 命中即认为属于正文 */
function isInReadableArticle(block: HTMLElement, allow: Set<string>): boolean {
  const text = (block.textContent ?? '').trim();
  if (text.length < MIN_BLOCK_LENGTH) return false;
  for (const sentence of allow) {
    if (text.includes(sentence.slice(0, 40))) return true;
  }
  return false;
}

/** 链接文本占比 —— 用来排除导航 / 相关阅读这种 link-heavy 的 block */
function linkTextRatio(block: HTMLElement): number {
  const total = (block.textContent ?? '').length;
  if (total === 0) return 0;
  const inLinks = Array.from(block.querySelectorAll('a'))
    .map((a) => (a.textContent ?? '').length)
    .reduce((a, b) => a + b, 0);
  return inLinks / total;
}

export interface ArticleBlock {
  id: string;
  element: HTMLElement;
  /** 已注入占位符的待翻译文本（代码标识符被替换成 ⟪C1⟫ ⟪C2⟫ 等） */
  text: string;
  /** 占位符 → 原代码文本 的映射，翻译完原样替换回去 */
  restoreMap: Map<string, string>;
}

/**
 * 递归 walk block 的 DOM，把内联 code / kbd / samp / var 元素换成占位符。
 * 这样命令名 / 库名 / API 名（"Write" / "Edit" / "claude" / "caw"）不会被
 * LLM 当英文常用词翻成中文动词，翻译完前端再把占位符替换回原文本。
 *
 * 占位符用罕见的 Unicode 角括号 ⟪C1⟫ 确保 LLM 不去翻译它。
 */
function buildTextWithPreserves(
  node: Node,
  restoreMap: Map<string, string>,
  counter: { n: number },
): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent ?? '';
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return '';
  const el = node as Element;
  if (el.matches(INLINE_PRESERVE_SELECTOR)) {
    counter.n += 1;
    const placeholder = `⟪C${counter.n}⟫`;
    restoreMap.set(placeholder, el.textContent ?? '');
    return placeholder;
  }
  // 其它（含 a / strong / em / span 等）只递归子节点，不替换
  let out = '';
  for (const child of Array.from(el.childNodes)) {
    out += buildTextWithPreserves(child, restoreMap, counter);
  }
  return out;
}

function extractTextWithPreserves(block: HTMLElement): {
  text: string;
  restoreMap: Map<string, string>;
} {
  const restoreMap = new Map<string, string>();
  const counter = { n: 0 };
  const text = buildTextWithPreserves(block, restoreMap, counter).trim();
  return { text, restoreMap };
}

/** 翻译完成后把占位符 ⟪C1⟫ 替换回原代码文本 */
export function restorePreserves(translated: string, restoreMap: Map<string, string>): string {
  let out = translated;
  for (const [ph, orig] of restoreMap.entries()) {
    out = out.split(ph).join(orig);
  }
  return out;
}

export type TranslateMode = 'article' | 'page';

/** page 模式下，依然要排除的容器 —— 翻译输出 / FAB / shadow UI 自身。 */
const PAGE_MODE_HARD_EXCLUDE = '.english-agent-translation, script, style, noscript';
/** page 模式更宽松的最短文本：UI 标签 / 短按钮文案也要翻 */
const MIN_BLOCK_LENGTH_PAGE = 2;

/**
 * page 模式认定为"块级翻译单元"的标签集合。
 * 注意包含 DIV —— 现代 React 站（YC、Vercel、Linear 等）拿 <div>/<span> 当
 * 段落用，不挂 <p>。inline 标签 (a/span/em/code/strong) 不在这里：它们
 * 折叠进父级 block 一起翻，避免每个 <a>/<span> 都成独立翻译单元。
 */
const PAGE_BLOCK_TAGS = new Set([
  'P', 'LI', 'BLOCKQUOTE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'DD', 'DT', 'TD', 'TH', 'FIGCAPTION', 'SUMMARY', 'LABEL', 'BUTTON',
  'CAPTION', 'ADDRESS', 'DIV', 'SECTION', 'ARTICLE', 'ASIDE',
  'HEADER', 'FOOTER', 'NAV', 'MAIN',
]);

/**
 * 翻译激活期间缓存的 article root + Readability allowlist。
 *
 * 为什么要缓存：
 *   1. Readability 是启发式，每次 parse 同一文档可能给出不同 allowlist。
 *      lazy-load 新段落到来时如果 rescan 重跑，新段落经常进不了"主文章"
 *      的判定 —— 表现就是"继续加载的内容不被翻译"。
 *   2. findArticleRoot 也可能因 DOM 变化指向不同元素，root 漂移会让
 *      rescan 扫错范围。
 * 缓存让初始 scan 一锤定音，后续 rescan 永远围着同一个 root 工作。
 */
let cachedArticleRoot: HTMLElement | null = null;
let cachedReadabilityAllow: Set<string> | null = null;

/**
 * @param isRescan true = MutationObserver 触发的增量扫，宽松路径（不再
 *   用 Readability 过滤新块，只要在 cachedArticleRoot 内 + 不在 EXCLUDE_ANCESTOR
 *   就算 article body）；false = 用户点击触发的初始扫，严格路径。
 */
export function extractArticleBlocks(
  mode: TranslateMode = 'article',
  isRescan = false,
): ArticleBlock[] {
  if (mode === 'page') return extractPageBlocks();

  // 初始扫：算 root + Readability allowlist，缓存供 rescan 复用 / 续翻判定
  if (!isRescan) {
    cachedArticleRoot = findArticleRoot();
    cachedReadabilityAllow = buildReadabilityAllowlist();
  } else if (!cachedArticleRoot || !document.contains(cachedArticleRoot)) {
    // SPA 整树 re-render 时缓存的 article 节点可能被换掉（detached），
    // 此时 querySelectorAll 拉不到新内容。重新定位 root；但仍跳过 Readability 重判定。
    const refreshed = findArticleRoot();
    console.log(
      '[english-agent] rescan: cachedArticleRoot detached, refreshing',
      { old: cachedArticleRoot?.tagName, new: refreshed?.tagName },
    );
    cachedArticleRoot = refreshed;
  }
  const root = cachedArticleRoot ?? findArticleRoot();

  // Rescan 扫整个 document.body —— 不是 cachedArticleRoot。
  // 原因（TechCrunch 实测验证）：很多站的无限滚动把新文章 append 到
  // cachedArticleRoot **外面** 的 sibling 容器（甚至直接挂 body），
  // 限制在 cachedArticleRoot 里走 text-walker 永远扫不到新文章。
  // 走 body 后，EXCLUDE_ANCESTOR_SELECTOR (nav/aside/footer/comments/...) 仍排除
  // 噪音；orchestrator.addBlocks 按 id 去重，初始文章块不会被重复翻译；
  // 代价是"主文章 + 同源相关阅读"会一起被翻，但这正是用户在 infinite
  // scroll 上想要的行为。
  if (isRescan) {
    return extractPageBlocks(document.body, EXCLUDE_ANCESTOR_SELECTOR, MIN_BLOCK_LENGTH);
  }

  // 初始扫：BLOCK_SELECTOR + Readability allowlist 严格路径（保持精读体验）
  const allow = cachedReadabilityAllow;
  const elements = Array.from(root.querySelectorAll<HTMLElement>(BLOCK_SELECTOR));
  const blocks: ArticleBlock[] = [];
  for (const el of elements) {
    if (el.classList.contains(TRANSLATION_CLASS)) continue;
    const isArticleHeading =
      el.tagName === 'H1' && el.closest(ARTICLE_ROOT_SELECTOR) !== null;
    if (!isArticleHeading && el.closest(EXCLUDE_ANCESTOR_SELECTOR)) continue;
    const rawText = (el.textContent ?? '').trim();
    if (rawText.length < MIN_BLOCK_LENGTH) continue;
    if (linkTextRatio(el) > 0.5) continue;
    if (!isArticleHeading && allow && !isInReadableArticle(el, allow)) continue;
    const { text, restoreMap } = extractTextWithPreserves(el);
    if (text.length < MIN_BLOCK_LENGTH) continue;
    const id = el.getAttribute(BLOCK_ID_ATTR) ?? crypto.randomUUID();
    el.setAttribute(BLOCK_ID_ATTR, id);
    blocks.push({ id, element: el, text, restoreMap });
  }
  return blocks;
}

/**
 * page 模式抓块：走 text node，找最近 block-like 祖先做"翻译单元"。
 *
 * 为什么这么做：YC company 页 / 大部分 React SPA 用 <div>/<span> 当段落，
 * 不挂 <p>。靠 BLOCK_SELECTOR 抓不到。改成扫文本节点 → 折叠到最近
 * block-like 容器（PAGE_BLOCK_TAGS），就能覆盖任意标签结构。
 *
 * 嵌套去重策略：
 *   - 文档顺序 TreeWalker 保证内层文本先出现
 *   - 新单元若有祖先已在集合里：跳过（祖先已覆盖此文本）
 *   - 新单元若是已收集单元的祖先：替换（外层吞掉内层，避免重复翻译）
 *
 * 这两条规则在 sibling 顺序混合（"内层 div + 外层 li 直接文本"）的奇怪
 * 结构上仍可能丢字，但实际页面极少这样写。够用。
 */
function extractPageBlocks(
  root: HTMLElement = document.body,
  extraExcludeSelector?: string,
  minLen: number = MIN_BLOCK_LENGTH_PAGE,
): ArticleBlock[] {
  const units = new Set<HTMLElement>();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const text = node.nodeValue ?? '';
    if (text.trim().length < 2) continue;
    let cur: HTMLElement | null = (node as Text).parentElement;
    let unit: HTMLElement | null = null;
    while (cur && cur !== root && cur !== document.body) {
      if (PAGE_BLOCK_TAGS.has(cur.tagName)) {
        unit = cur;
        break;
      }
      cur = cur.parentElement;
    }
    if (!unit) continue;
    if (unit.closest(PAGE_MODE_HARD_EXCLUDE)) continue;
    if (extraExcludeSelector && unit.closest(extraExcludeSelector)) continue;
    if (unit.classList.contains(TRANSLATION_CLASS)) continue;

    // 祖先已在集合里 —— 已被外层覆盖，跳过
    let p: HTMLElement | null = unit.parentElement;
    let coveredByAncestor = false;
    while (p) {
      if (units.has(p)) {
        coveredByAncestor = true;
        break;
      }
      p = p.parentElement;
    }
    if (coveredByAncestor) continue;

    // 当前单元是已收集某单元的祖先 —— 替换（外层吞内层）
    for (const existing of [...units]) {
      if (unit !== existing && unit.contains(existing)) units.delete(existing);
    }
    units.add(unit);
  }

  const blocks: ArticleBlock[] = [];
  for (const unit of units) {
    const rawText = (unit.textContent ?? '').trim();
    if (rawText.length < minLen) continue;
    const { text, restoreMap } = extractTextWithPreserves(unit);
    if (text.length < minLen) continue;
    const id = unit.getAttribute(BLOCK_ID_ATTR) ?? crypto.randomUUID();
    unit.setAttribute(BLOCK_ID_ATTR, id);
    blocks.push({ id, element: unit, text, restoreMap });
  }
  return blocks;
}

/**
 * 注入译文节点（或失败 retry 按钮）到 anchor block 之后。
 * 重试时若已有旧节点先 remove。
 *
 * 样式（v2）：去除背景 + 左边线，纯浅色文字，跟原文保持竖向呼吸但不抢视觉。
 */
function injectTranslation(
  anchor: HTMLElement,
  result: TranslationResult,
  onRetry: () => void,
): void {
  // 清理旧节点（重试场景）
  const oldNode = anchor.nextElementSibling;
  if (oldNode?.classList.contains(TRANSLATION_CLASS)) oldNode.remove();

  const node = document.createElement('div');
  node.className = TRANSLATION_CLASS;
  node.setAttribute(BLOCK_ID_ATTR, result.id);

  // 读原段落的实际渲染颜色，让译文跟着页面文字色走（自适应浅色/暗色页面）。
  // 用 opacity 整体淡化，而不是硬编码颜色，dark mode 上白字也能正确变成"半透明白"。
  const inheritedColor = window.getComputedStyle(anchor).color || 'inherit';

  // 防御：如果 result.zh 不是字符串（旧脏缓存 / LLM 异常），强制走 error 分支
  const isBadZh =
    !result.error && (typeof result.zh !== 'string' || result.zh === '[object Object]' || !result.zh);
  if (result.error || isBadZh) {
    // 失败：低调灰色行内提示。中文不适合 italic，保持正体。
    node.setAttribute(
      'style',
      [
        'margin: 4px 0 12px 0 !important',
        `color: ${inheritedColor} !important`,
        'opacity: 0.45 !important',
        'font-family: inherit !important',
        'font-size: 0.85em !important',
        'line-height: 1.5 !important',
      ].join(';'),
    );

    // 提示文案按 error 类型选；所有情况都挂"重试"链接 —— 即便 content_filtered
    // 也可能在 OpenRouter 兜底接通后第二次成功，给用户主动权
    let prefixText = '翻译未能完成 · ';
    if (result.error === 'content_filtered') prefixText = '⛔ 内容审查拦截 · ';
    else if (isBadZh) prefixText = '⚠ 译文异常 · ';

    const msg = document.createElement('span');
    msg.textContent = prefixText;
    node.appendChild(msg);

    const link = document.createElement('button');
    link.type = 'button';
    link.textContent = '重试';
    link.setAttribute(
      'style',
      [
        'background: transparent',
        'border: 0',
        'padding: 0',
        'color: inherit',
        'cursor: pointer',
        'font: inherit',
        'text-decoration: underline',
        'text-underline-offset: 2px',
      ].join(';'),
    );
    link.addEventListener('mouseenter', () => (link.style.opacity = '1'));
    link.addEventListener('mouseleave', () => (link.style.opacity = ''));
    link.addEventListener('click', onRetry);
    node.appendChild(link);
  } else {
    // 正常译文：继承原段落的实际颜色 + opacity 整体淡化区分。
    // text-autospace: 中英文 / 中文数字之间自动加空格（CSS Text 4 新特性，
    // Chrome 138+ 原生支持；旧浏览器静默忽略）—— 修复"内置工具Write/Edit"
    // 这种贴在一起的视觉问题。-webkit- 前缀 + 标准属性双写覆盖更多版本。
    node.setAttribute(
      'style',
      [
        'margin: 4px 0 14px 0 !important',
        `color: ${inheritedColor} !important`,
        'opacity: 0.65 !important',
        'font-family: inherit !important',
        'font-size: 0.95em !important',
        'font-weight: 300 !important',
        'line-height: 1.6 !important',
        '-webkit-text-autospace: normal',
        'text-autospace: normal',
      ].join(';'),
    );
    node.textContent = result.zh;
  }

  anchor.insertAdjacentElement('afterend', node);
}

export function undoAllTranslations(): void {
  document.querySelectorAll<HTMLElement>(`.${TRANSLATION_CLASS}`).forEach((el) => el.remove());
}

/**
 * 给 background 发一批 blocks，带超时；超时按 Error 抛出由调用方挂 retry。
 */
export async function translateBatchViaBackground(
  blocks: Array<{ id: string; text: string }>,
  timeoutMs = BATCH_TIMEOUT_MS,
): Promise<TranslationResult[]> {
  const msg: BackgroundMessage = {
    type: 'TRANSLATE_BLOCKS',
    payload: { blocks },
  };
  // chrome.runtime.sendMessage 不支持 AbortSignal，用 Promise.race 加超时
  const response = await Promise.race<
    { ok: true; results: TranslationResult[] } | { ok: false; error: string }
  >([
    chrome.runtime.sendMessage(msg) as Promise<
      { ok: true; results: TranslationResult[] } | { ok: false; error: string }
    >,
    new Promise((_resolve, reject) =>
      setTimeout(() => reject(new Error(`timeout ${timeoutMs}ms`)), timeoutMs),
    ),
  ]);
  if (!response || !response.ok) {
    throw new Error(response?.ok === false ? response.error : 'no response');
  }
  return response.results;
}

// --- 视口驱动翻译编排 ---------------------------------------------------
//
// 设计：
//   - 不再"一次性把所有 block 都丢进翻译队列"，改成 IntersectionObserver
//     监听每个 block，进入视口（含 300px 上下冗余）才入队
//   - 模块级单例 + 并发上限 4 个 HTTP；用户滚动快时多块同时排队但实际并发受限
//   - 缓存命中走 server 返回，前端不区分 —— 命中 ~50ms 用户感觉是瞬间
//   - 撤销时 disconnect observer + 清队列 + 移除注入节点
//
// 状态机（模块级单例）：
//   idle  →  active: 用户点 FAB，注册 observer，blocks 进视口逐个翻译
//   active → idle:   用户再点 FAB，停止编排，移除已注入译文

interface RuntimeBlock {
  element: HTMLElement;
  text: string;
  restoreMap: Map<string, string>;
  status: 'idle' | 'pending' | 'translating' | 'done' | 'error';
}

interface OrchestratorCallbacks {
  /** 一个 block 翻译完成（成功或失败）时调用，用于更新 FAB 进度 */
  onProgress: () => void;
}

class TranslationOrchestrator {
  private observer: IntersectionObserver | null = null;
  private blocks = new Map<string, RuntimeBlock>();
  /** 当前正在攒的 batch（满 MAX_BATCH_SIZE 或 debounce 到期就 flush） */
  private pendingBatch: string[] = [];
  private batchTimer: ReturnType<typeof setTimeout> | null = null;
  /** 已经发出但还没回来的 batch 数；超过 MAX_CONCURRENT_BATCHES 时新 batch 排队 */
  private inFlightBatches = 0;
  private waitingForSlot: Array<string[]> = [];
  private callbacks: OrchestratorCallbacks | null = null;

  get isActive(): boolean {
    return this.observer !== null;
  }

  start(blocks: ArticleBlock[], cb: OrchestratorCallbacks): void {
    if (this.isActive) return;
    this.callbacks = cb;
    this.blocks.clear();
    this.observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = entry.target.getAttribute(BLOCK_ID_ATTR);
          if (!id) continue;
          if (entry.isIntersecting) {
            this.enqueue(id);
            continue;
          }
          // 块不在视口里，但 bottom < 0 表示**在视口上方**（用户已经滚过去了）。
          // 这种块如果不立即入队，IO 不会再 fire（IO 只在跨过边界时触发），
          // 永远不被翻译。常见路径：MutationObserver 续翻 debounce 500ms 期间
          // 用户滚动很快、新文章一加上就被滚过 → rescan addBlocks 时 observe，
          // 此时块已在视口上方 → 旧逻辑 continue 跳过 → 卡住。
          // entry.boundingClientRect 由 IO 免费提供，不触发 layout。
          if (entry.boundingClientRect.bottom < 0) this.enqueue(id);
        }
      },
      { rootMargin: VIEWPORT_ROOT_MARGIN, threshold: 0 },
    );
    this.addBlocks(blocks);
  }

  /** 总块数，供外部 (moduleState.total) 同步用 */
  get totalCount(): number {
    return this.blocks.size;
  }

  /**
   * 增量追加 blocks —— MutationObserver 检测到 SPA 续渲染时调用。
   * 已知 id 跳过；已被移出 DOM 的元素跳过；其余 observe + 立即入队。
   *
   * 为什么直接 enqueue 而不等 IO：IO 只在元素跨越 viewport 边界时 fire。
   * MutationObserver 续翻 debounce 500ms 内用户可能已经滚过新块的位置
   * （新块卡在视口上方）；或者新块在视口下方很远（永远等不到用户滚到那）。
   * 两种 case 旧逻辑都漏。直接 enqueue + flushPending 按视口距离排序，
   * 远的自然排到后面，等于"视口优先 + 绝不漏块"。
   */
  addBlocks(blocks: ArticleBlock[]): number {
    if (!this.observer) return 0;
    let added = 0;
    for (const b of blocks) {
      if (this.blocks.has(b.id)) continue;
      if (!document.body.contains(b.element)) continue;
      this.blocks.set(b.id, {
        element: b.element,
        text: b.text,
        restoreMap: b.restoreMap,
        status: 'idle',
      });
      this.observer.observe(b.element);
      this.enqueue(b.id);
      added++;
    }
    return added;
  }

  stop(): void {
    this.observer?.disconnect();
    this.observer = null;
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }
    this.blocks.clear();
    this.pendingBatch.length = 0;
    this.waitingForSlot.length = 0;
    this.inFlightBatches = 0;
    this.callbacks = null;
  }

  /**
   * 一个 block 进视口 → 攒进 pendingBatch，等首个 debounce 窗口结束统一 flush。
   *
   * 关键：debounce timer **只在 pendingBatch 空 → 非空那一刻设一次**，后续
   * enqueue 不 reset。否则用户长页连续滚动时 IntersectionObserver 不停 enqueue
   * → 每次都把 timer 推后 BATCH_DEBOUNCE_MS → flushPending 永远等不到一个静
   * 默窗口（必须停下来不滚才能触发），队列尾部累积几十块永远派不出去。
   * 改成不 reset 后，BATCH_DEBOUNCE_MS 变成"距首块入队的最大延迟"，期间所有
   * 入队的块自动 coalesce 进同一次 flush —— 既保证持续进度也保留 coalescing。
   */
  private enqueue(id: string): void {
    const block = this.blocks.get(id);
    if (!block || block.status !== 'idle') return;
    block.status = 'pending';
    this.pendingBatch.push(id);

    if (this.batchTimer) return; // 已有 timer 在跑，让它按时 fire
    this.batchTimer = setTimeout(() => this.flushPending(), BATCH_DEBOUNCE_MS);
  }

  /**
   * flushPending 时一次性算所有块到视口中心的距离，sort 阶段只查 Map 不再
   * 调 rect —— 浏览器在中途没 DOM 写入时只算一次 layout，**reflow 风险从
   * O(N) 降到 O(1)**。
   */
  private flushPending(): void {
    this.batchTimer = null;
    if (this.pendingBatch.length === 0) return;

    // Pass 1: 一次性读所有 rect，缓存距离。layout 此刻只算一次。
    const viewportCenterY = window.innerHeight / 2;
    const distance = new Map<string, number>();
    for (const id of this.pendingBatch) {
      const b = this.blocks.get(id);
      if (!b) {
        distance.set(id, Infinity);
        continue;
      }
      const rect = b.element.getBoundingClientRect();
      distance.set(id, Math.abs(rect.top + rect.height / 2 - viewportCenterY));
    }

    // Pass 2: 按缓存距离排序（不再调 rect）
    const sorted = [...this.pendingBatch].sort(
      (a, b) => (distance.get(a) ?? Infinity) - (distance.get(b) ?? Infinity),
    );
    this.pendingBatch.length = 0;

    for (let i = 0; i < sorted.length; i += MAX_BATCH_SIZE) {
      this.dispatchBatch(sorted.slice(i, i + MAX_BATCH_SIZE));
    }
  }

  /**
   * 派发 batch；inFlight 名额满了就 FIFO 排队。
   *
   * 这里**故意不**在 slot 释放时重排 waitingForSlot —— flushPending 阶段
   * 已经把当下 pendingBatch 按视口排好序了，dispatch 顺序对就够。"翻译中
   * 持续滚动重排 waiting"那种 corner case 收益太小，O(N²) + 多次 rect 调
   * 不划算。
   */
  private dispatchBatch(ids: string[]): void {
    if (this.inFlightBatches >= MAX_CONCURRENT_BATCHES) {
      this.waitingForSlot.push(ids);
      return;
    }
    this.inFlightBatches++;
    void this.translateBatch(ids).finally(() => {
      this.inFlightBatches--;
      const next = this.waitingForSlot.shift();
      if (next) this.dispatchBatch(next);
    });
  }

  private async translateBatch(ids: string[]): Promise<void> {
    for (const id of ids) {
      const b = this.blocks.get(id);
      if (b) b.status = 'translating';
    }
    const blocksForServer = ids.map((id) => {
      const b = this.blocks.get(id);
      return { id, text: b?.text ?? '' };
    });
    try {
      const results = await translateBatchViaBackground(blocksForServer);
      for (const r of results) {
        const block = this.blocks.get(r.id);
        if (!block) continue;
        const restored: TranslationResult = r.zh
          ? { ...r, zh: restorePreserves(r.zh, block.restoreMap) }
          : r;
        injectTranslation(block.element, restored, () => this.retry(r.id));
        block.status = r.error ? 'error' : 'done';
        this.callbacks?.onProgress();
      }
    } catch (err) {
      console.warn('[english-agent] batch translate failed', err);
      for (const id of ids) {
        const block = this.blocks.get(id);
        if (!block) continue;
        injectTranslation(
          block.element,
          { id, zh: '', source: 'llm', error: String(err) },
          () => this.retry(id),
        );
        block.status = 'error';
        this.callbacks?.onProgress();
      }
    }
  }

  /** 单 block 重试（错误状态点击"重试"链接触发） */
  private retry(id: string): void {
    const block = this.blocks.get(id);
    if (!block) return;
    block.status = 'idle';
    this.enqueue(id);
  }
}

const orchestrator = new TranslationOrchestrator();

// --- 模块级共享状态 -------------------------------------------------------
//
// 状态从 React 里提出来：FAB 用 useSyncExternalStore 订阅，外部调用方
// (右键菜单 / 快捷键 → background → content script onMessage) 直接调
// togglePageTranslation() 也能联动 UI。

export type FabStatus = 'idle' | 'active';
interface ModuleState {
  status: FabStatus;
  done: number;
  total: number;
}

let moduleState: ModuleState = { status: 'idle', done: 0, total: 0 };
const stateListeners = new Set<() => void>();

/**
 * 用户本会话最后一次"手动选的翻译模式"。
 *   - 用户点 FAB（主按钮）→ 'article'
 *   - ModeMenu 里选"翻译正文/翻译全页" → 对应 mode
 *   - 仅在 idle→active 切换时记录；undo 不清空（让"换完再翻"的体验顺）
 * 用途：用户接着点"总是自动翻译"时，规则的 mode 字段沿用这个，
 *      实现"你现在怎么看，以后就怎么看"。
 */
let lastUsedMode: TranslateMode | null = null;

function setModuleState(next: ModuleState): void {
  moduleState = next;
  for (const cb of stateListeners) cb();
}

function subscribeModuleState(cb: () => void): () => void {
  stateListeners.add(cb);
  return () => {
    stateListeners.delete(cb);
  };
}

function getModuleState(): ModuleState {
  return moduleState;
}

/**
 * 外部统一入口：FAB 点击、右键菜单、快捷键都调这个函数。
 * idle ↔ active 切换；active 时点击 = 撤销。
 *
 * @param mode 'article' (默认，正文 + Readability 过滤) 或 'page' (整页含 nav/sidebar)
 */
export function togglePageTranslation(mode: TranslateMode = 'article'): void {
  if (moduleState.status === 'active') {
    // 必须先停 MutationObserver：undoAllTranslations 会移除大量翻译节点，
    // 这些 childList 变化要是被 observer 捕获，rescan 会在 stop 后空跑。
    stopMutationWatch();
    orchestrator.stop();
    undoAllTranslations();
    setModuleState({ status: 'idle', done: 0, total: 0 });
    notifyExternalListeners('idle');
    // 清掉 article 模式的 root / allowlist 缓存
    cachedArticleRoot = null;
    cachedReadabilityAllow = null;
    return;
  }
  const blocks = extractArticleBlocks(mode);
  if (blocks.length === 0) {
    console.warn('[english-agent] no translatable blocks found');
    return;
  }
  lastUsedMode = mode;
  setModuleState({ status: 'active', done: 0, total: blocks.length });
  notifyExternalListeners('active');
  orchestrator.start(blocks, {
    onProgress: () => {
      setModuleState({ ...moduleState, done: moduleState.done + 1 });
    },
  });
  // SPA 续渲染 / 无限滚动 / lazy mount 都会触发 DOM 变化 → 续翻
  startMutationWatch(mode);
}

// --- MutationObserver 续翻 ---------------------------------------------
//
// 翻译激活期间监听 document.body 的 childList+subtree 变化；新节点经 debounce
// 后 rescan，把新出现的 block 喂给 orchestrator.addBlocks。覆盖 Twitter / Reddit
// 这类滚动续渲染场景。
//
// 为什么不会自激震荡：
//   - 我们自己注入的 .english-agent-translation 节点也会触发 mutation，
//     但 extractArticleBlocks 里 PAGE_MODE_HARD_EXCLUDE / TRANSLATION_CLASS
//     都把它过掉，orchestrator.addBlocks 又按 id 去重，
//     结果是"找到 0 个新块"，自然停下。
//   - 我们不监听 attributes，setAttribute(BLOCK_ID_ATTR) 不会触发 mutation。

let mutationObserver: MutationObserver | null = null;
let mutationDebounceTimer: ReturnType<typeof setTimeout> | null = null;
/** debounce 500ms：DOM mutation 以"突发"形式来（React commit 一次性塞一堆节点）*/
const MUTATION_DEBOUNCE_MS = 500;

function startMutationWatch(mode: TranslateMode): void {
  if (mutationObserver) return;
  mutationObserver = new MutationObserver(() => {
    if (mutationDebounceTimer) clearTimeout(mutationDebounceTimer);
    mutationDebounceTimer = setTimeout(() => rescanForNewBlocks(mode), MUTATION_DEBOUNCE_MS);
  });
  mutationObserver.observe(document.body, { childList: true, subtree: true });
}

function stopMutationWatch(): void {
  mutationObserver?.disconnect();
  mutationObserver = null;
  if (mutationDebounceTimer) {
    clearTimeout(mutationDebounceTimer);
    mutationDebounceTimer = null;
  }
}

function rescanForNewBlocks(mode: TranslateMode): void {
  mutationDebounceTimer = null;
  if (!orchestrator.isActive) return;
  // isRescan=true：article 模式走宽松路径（用缓存 root、跳过 Readability
  // 重判定），新内容只要落在 cachedArticleRoot 内就被收。否则 lazy-load
  // 的段落经常通不过 Readability 的飘忽启发式，无法续翻。
  const all = extractArticleBlocks(mode, true);
  const added = orchestrator.addBlocks(all);
  console.log(
    `[english-agent] rescan(${mode}): scanned=${all.length}, added=${added}, total=${orchestrator.totalCount}`,
  );
  if (added > 0) {
    setModuleState({ ...moduleState, total: orchestrator.totalCount });
  }
}

/** 状态变化时通知外部（用于 background 更新右键菜单标题） */
type ExternalListener = (status: FabStatus) => void;
const externalListeners = new Set<ExternalListener>();
export function onTranslateStateChange(cb: ExternalListener): () => void {
  externalListeners.add(cb);
  return () => externalListeners.delete(cb);
}
function notifyExternalListeners(status: FabStatus): void {
  for (const cb of externalListeners) cb(status);
}

// --- SPA URL 监听：always 模式下跨 SPA 路由续翻 ---------------------------
//
// 现有 MutationObserver 只解决"同一文章内 lazy-load"。SPA 站点（TC、Reddit、
// 大多数现代媒体）的"换一篇文章"是 history.pushState + DOM 整树替换，URL 变了
// 但 content script 不会重启。此时旧译文还挂在已被 unmount 的节点上看着诡异
// 也没用，新内容也不会被翻译。
//
// 这里 patch 一次 history API，URL 变化 → 撤销 + 延迟 600ms 重翻。延迟用来等
// React commit + 异步数据加载稳定，否则 extractArticleBlocks 抓到的是骨架屏。
//
// currentDomainRule 由 FAB 通过 useEffect 同步进来。
let currentDomainRule: DomainRule | null = null;
let lastUrl: string = typeof location !== 'undefined' ? location.href : '';
let historyHooksInstalled = false;
const URL_CHANGE_RETRANSLATE_DELAY_MS = 600;

function syncCurrentDomainRule(rule: DomainRule | null): void {
  currentDomainRule = rule;
}

// --- 页面语言检测（模块级缓存 + 订阅）------------------------------------
//
// 谁会跑检测：
//   - 初次 auto-start（FAB useEffect）
//   - SPA URL change 后（重翻前）
// 谁会读：
//   - 上述两处用 shouldSkipForSameLanguage 做决策
//   - ModeMenu hint（通过 useSyncExternalStore 订阅）
let currentPageLangDetection: DetectionResult | null = null;
const pageLangListeners = new Set<() => void>();

function setPageLangDetection(d: DetectionResult | null): void {
  currentPageLangDetection = d;
  for (const cb of pageLangListeners) cb();
}
function subscribePageLangDetection(cb: () => void): () => void {
  pageLangListeners.add(cb);
  return () => {
    pageLangListeners.delete(cb);
  };
}
function getCurrentPageLangDetection(): DetectionResult | null {
  return currentPageLangDetection;
}

async function refreshPageLangDetection(): Promise<DetectionResult> {
  const result = await detectPageLanguage();
  setPageLangDetection(result);
  return result;
}

// --- 首次外语页询问 banner 状态 ------------------------------------------
//
// "一次性"的语义：每个 content script 生命周期内最多弹一次。SPA 跳转不重置；
// 只有 full page reload 才会让 banner 有机会再出。
//
// 谁会写 promptDismissed：
//   - 用户在 banner 上点了任一动作（含 X）
//   - 用户从其它路径触发了翻译（FAB 手动点 / always 规则触发）
let promptDismissed = false;
const promptListeners = new Set<() => void>();

function setPromptDismissed(v: boolean): void {
  if (promptDismissed === v) return;
  promptDismissed = v;
  for (const cb of promptListeners) cb();
}
function subscribePromptDismissed(cb: () => void): () => void {
  promptListeners.add(cb);
  return () => {
    promptListeners.delete(cb);
  };
}
function getPromptDismissed(): boolean {
  return promptDismissed;
}

// --- "从不"动作的撤销窗口 ------------------------------------------------
//
// 用户在 banner 或 ModeMenu 上点"从不"后，FAB 会消失 —— 用户突然失去所有
// 入口，体验是"我点错了怎么办"。这里在 5s 内显示一条"已禁用 · 撤销 · 右键菜单可恢复"
// 提示，给一个一键回滚 + 一个长期恢复路径提示。
//
// 模块级状态：任何 UI 入口（banner / ModeMenu）写"从不"都走同一个 trigger，
// confirm banner 单例显示。
let neverConfirmState: { until: number } | null = null;
let neverConfirmTimer: ReturnType<typeof setTimeout> | null = null;
const neverConfirmListeners = new Set<() => void>();
const NEVER_CONFIRM_TTL_MS = 5000;

function setNeverConfirmState(v: { until: number } | null): void {
  neverConfirmState = v;
  for (const cb of neverConfirmListeners) cb();
}
function subscribeNeverConfirm(cb: () => void): () => void {
  neverConfirmListeners.add(cb);
  return () => {
    neverConfirmListeners.delete(cb);
  };
}
function getNeverConfirmState(): { until: number } | null {
  return neverConfirmState;
}

/** 写入 never 规则 + 启动 5s 撤销窗口（任何 UI 入口共用） */
function triggerNeverWithConfirmation(hostname: string, mode: TranslateMode): void {
  void setDomainRule(hostname, { auto: 'never', mode });
  setNeverConfirmState({ until: Date.now() + NEVER_CONFIRM_TTL_MS });
  if (neverConfirmTimer) clearTimeout(neverConfirmTimer);
  neverConfirmTimer = setTimeout(() => {
    neverConfirmTimer = null;
    setNeverConfirmState(null);
    // banner（如果当时还是 choosing 模式）也一并 dismiss，避免 confirm 消失后
    // 重新展示 choosing —— 用户的选择已经做出，不该再回到决策态
    setPromptDismissed(true);
  }, NEVER_CONFIRM_TTL_MS);
}

function undoNever(hostname: string): void {
  void clearDomainRule(hostname);
  if (neverConfirmTimer) {
    clearTimeout(neverConfirmTimer);
    neverConfirmTimer = null;
  }
  setNeverConfirmState(null);
  // 不重置 promptDismissed —— 让 banner 是否再显示完全由 shouldShowPrompt 重新判定
}

/**
 * "同语言、应该跳过自动翻译" —— 任一来源给出与浏览器主子标签一致的 lang 就跳过。
 *
 * CLD3 是首选信号（reliable 与否都信，CLD3 的低置信也比 html-lang 强）。
 * html-lang 仅在 CLD3 缺失时作为兜底；它的可信度对"匹配用户"方向其实够用：
 *   - html-lang=zh + 用户=zh → 几乎必是中文页（站点没必要假装是中文）
 *   - 反例 html-lang=en + 实际 zh 内容 → CLD3 会先抓到，html-lang 不会被读到
 */
function shouldSkipForSameLanguage(d: DetectionResult | null): boolean {
  if (!d || !d.lang) return false;
  return isSamePrimary(d.lang, getUserPrimaryLang());
}

function handleSpaUrlChange(): void {
  if (typeof location === 'undefined') return;
  if (lastUrl === location.href) return;
  const from = lastUrl;
  lastUrl = location.href;
  if (currentDomainRule?.auto !== 'always') return;
  console.log('[english-agent] SPA url change → re-translate', { from, to: location.href });
  if (moduleState.status === 'active') {
    togglePageTranslation(); // stop & undo
  }
  const mode = currentDomainRule.mode;
  setTimeout(async () => {
    // 期间用户可能改了规则；二次校验
    if (currentDomainRule?.auto !== 'always') return;
    if (moduleState.status !== 'idle') return;
    const detection = await refreshPageLangDetection();
    if (shouldSkipForSameLanguage(detection)) {
      console.log(
        `[english-agent] SPA re-translate skipped: page lang ${detection.lang} matches user`,
      );
      return;
    }
    togglePageTranslation(mode);
  }, URL_CHANGE_RETRANSLATE_DELAY_MS);
}

function installHistoryHooksOnce(): void {
  if (historyHooksInstalled) return;
  historyHooksInstalled = true;
  const origPush = history.pushState;
  const origReplace = history.replaceState;
  history.pushState = function patchedPushState(...args) {
    const ret = origPush.apply(this, args as Parameters<typeof origPush>);
    queueMicrotask(handleSpaUrlChange);
    return ret;
  };
  history.replaceState = function patchedReplaceState(...args) {
    const ret = origReplace.apply(this, args as Parameters<typeof origReplace>);
    queueMicrotask(handleSpaUrlChange);
    return ret;
  };
  window.addEventListener('popstate', handleSpaUrlChange);
}

const FAB_POSITION_KEY = 'english-agent:fab-pos';

/** "rule = undefined" 表示首次还没读完 storage，避免 flash 出 FAB 后又因 never 收掉 */
type RuleLoadState = DomainRule | null | 'loading';

export function TranslateFab() {
  const s = useSyncExternalStore(subscribeModuleState, getModuleState, getModuleState);
  const [menuOpen, setMenuOpen] = useState(false);
  const [rule, setRule] = useState<RuleLoadState>('loading');
  const autoStartedRef = useRef(false);
  const hostname = normalizeHostname(location.hostname);
  const drag = useDraggable({
    initial: { x: 20, y: 20 },
    anchor: 'bottom-right',
    persistKey: FAB_POSITION_KEY,
  });

  // 读规则 + 订阅跨 tab / 设备变更
  useEffect(() => {
    let cancelled = false;
    getDomainRule(hostname).then((r) => {
      if (!cancelled) setRule(r);
    });
    const unsub = subscribeDomainRule(hostname, (r) => setRule(r));
    return () => {
      cancelled = true;
      unsub();
    };
  }, [hostname]);

  // 把当前规则同步到模块级，供 SPA URL 监听用；同时安装 history hook
  useEffect(() => {
    if (rule === 'loading') return;
    syncCurrentDomainRule(rule);
    installHistoryHooksOnce();
  }, [rule]);

  // 订阅页面语言检测结果 + 首次询问 banner 的 dismissed 状态
  const pageLangDetection = useSyncExternalStore(
    subscribePageLangDetection,
    getCurrentPageLangDetection,
    getCurrentPageLangDetection,
  );
  const promptDismissedState = useSyncExternalStore(
    subscribePromptDismissed,
    getPromptDismissed,
    getPromptDismissed,
  );
  const neverConfirm = useSyncExternalStore(
    subscribeNeverConfirm,
    getNeverConfirmState,
    getNeverConfirmState,
  );

  // 一律在 mount 时跑一次检测 —— 不管有没有 rule，banner 也需要这份结果
  useEffect(() => {
    void refreshPageLangDetection();
  }, []);

  // auto='always' 且检测到位 → 同语言跳过，否则翻译
  // 用 ref 守门：用户后续手动撤销不会触发再翻译；只在初次"规则+检测都就绪"时跑一次
  useEffect(() => {
    if (rule === 'loading') return;
    if (rule?.auto !== 'always') return;
    if (pageLangDetection === null) return; // 等检测完
    if (autoStartedRef.current) return;
    autoStartedRef.current = true;
    if (shouldSkipForSameLanguage(pageLangDetection)) {
      console.log(
        `[english-agent] auto-translate skipped: page lang ${pageLangDetection.lang} matches user`,
      );
      return;
    }
    if (moduleState.status === 'idle') {
      togglePageTranslation(rule.mode);
    }
  }, [rule, pageLangDetection]);

  // 翻译被触发（任何路径）→ banner 自动消失
  useEffect(() => {
    if (s.status === 'active' && !promptDismissedState) {
      setPromptDismissed(true);
    }
  }, [s.status, promptDismissedState]);

  // loading 阶段：什么都不渲染（避免闪烁）
  if (rule === 'loading') return null;
  // never 模式：FAB 不渲染，但 NeverConfirm banner 仍可能出现（用户刚刚点完"从不"）
  // 用 isNever 而非 early return；下面的 fragment 会根据它条件渲染 FAB
  const isNever = rule?.auto === 'never';

  function onClick(e: React.MouseEvent) {
    if (drag.consumeDragClick()) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    setMenuOpen(false);
    // FAB 主按钮默认走"翻译全页"——对现代 React 站点 / 复杂版面更稳；
    // 想要严格的"正文"模式仍可从菜单显式选择。
    togglePageTranslation('page');
  }

  function onClickMode(mode: TranslateMode) {
    setMenuOpen(false);
    if (s.status === 'active') {
      // active 时点 menu = 撤销当前再开新模式
      togglePageTranslation();
      setTimeout(() => togglePageTranslation(mode), 0);
      return;
    }
    togglePageTranslation(mode);
  }

  /**
   * 三态切换：
   *   - always: 写入 { auto:'always', mode: 优先沿用本会话最后选的 mode }
   *   - session: 删规则；本次状态不动（用户当前可能正翻着，让它继续）
   *   - never: 写入 { auto:'never', mode 保留 }；如果当前正翻 → stop + undo
   *
   * mode 选取的 fallback 链（"你现在怎么看，以后就怎么看"）：
   *   1. 本会话用户最后一次手动选的 mode（lastUsedMode）
   *   2. 已存在规则里记录的 mode
   *   3. 'article'（默认）
   */
  function onChangeRule(next: 'always' | 'session' | 'never') {
    // 闭包捕获的 rule 类型不被 early return narrowing 影响，显式收窄一次
    const ruleObj = rule !== 'loading' ? rule : null;
    const mode: TranslateMode = lastUsedMode ?? ruleObj?.mode ?? 'article';
    if (next === 'always') {
      void setDomainRule(hostname, { auto: 'always', mode });
    } else if (next === 'never') {
      // 走撤销窗口路径 —— 给用户 5s 反悔机会 + 显式告知右键恢复入口
      triggerNeverWithConfirmation(hostname, mode);
      if (moduleState.status === 'active') togglePageTranslation();
    } else {
      void clearDomainRule(hostname);
    }
    setMenuOpen(false);
  }

  const ruleKind: 'always' | 'session' | 'never' =
    rule?.auto === 'always' ? 'always' : rule?.auto === 'never' ? 'never' : 'session';

  // "总是自动翻译"如果被点，会以哪种 mode 落地（用于 UI 提示用户）
  // 此时 rule 已经被前面的 early return 收窄为 DomainRule | null
  const effectiveMode: TranslateMode = lastUsedMode ?? rule?.mode ?? 'article';

  // 只在"规则=always 且检测出同语言"时给 hint —— 用户处于"我以为它会翻但没翻"
  // 的认知缺口，这时候需要解释；其它情况静默。
  const pageSameAsUser = shouldSkipForSameLanguage(pageLangDetection);
  const pageLangHint: string | null =
    ruleKind === 'always' && pageSameAsUser
      ? `本页${languageLabelZh(pageLangDetection?.lang ?? null)}，已跳过`
      : null;

  // === 首次外语页询问 banner 显示条件 ===
  // 全部条件:
  //   - status idle（翻译没在跑）
  //   - 该域名无规则（rule===null；'always'/'never' 都不弹）
  //   - 本会话还没弹过 / 没被 dismiss
  //   - menuOpen=false（不和 ModeMenu 抢同一锚点）
  //   - neverConfirm 没在显示（不和"已禁用"提示共存）
  //   - 用户主语言 === 'zh'：当前翻译器输出固定 zh，非中文用户弹了也没意义
  //   - 检测可信源（CLD3）：避免 <html lang> 噪音导致误弹
  //   - 检测出的 lang 跟用户语言不同
  const userIsZh = getUserPrimaryLang() === 'zh';
  const shouldShowPrompt =
    s.status === 'idle' &&
    rule === null &&
    !promptDismissedState &&
    !menuOpen &&
    neverConfirm === null &&
    userIsZh &&
    pageLangDetection?.source === 'cld3' &&
    !!pageLangDetection.lang &&
    !isSamePrimary(pageLangDetection.lang, getUserPrimaryLang());

  function onPromptAlways() {
    void setDomainRule(hostname, { auto: 'always', mode: effectiveMode });
    togglePageTranslation(effectiveMode);
    setPromptDismissed(true);
  }
  function onPromptJustOnce() {
    togglePageTranslation(effectiveMode);
    setPromptDismissed(true);
  }
  function onPromptNever() {
    // 同样走撤销窗口；setPromptDismissed 由 confirm 计时器到期时统一设置
    triggerNeverWithConfirmation(hostname, effectiveMode);
  }
  function onPromptClose() {
    setPromptDismissed(true);
  }

  return (
    <>
      {!isNever && (
        <FabButton
          status={s.status}
          positionStyle={drag.positionStyle()}
          menuOpen={menuOpen}
          onMouseDown={drag.onMouseDown}
          onClick={onClick}
          onChevronClick={(e) => {
            e.stopPropagation();
            setMenuOpen((o) => !o);
          }}
          onCloseMenu={() => setMenuOpen(false)}
          onPickMode={onClickMode}
          hostname={hostname}
          ruleKind={ruleKind}
          effectiveMode={effectiveMode}
          pageLangHint={pageLangHint}
          onChangeRule={onChangeRule}
          promptVisible={shouldShowPrompt}
          promptLangLabel={languageLabelZh(pageLangDetection?.lang ?? null)}
          onPromptAlways={onPromptAlways}
          onPromptJustOnce={onPromptJustOnce}
          onPromptNever={onPromptNever}
          onPromptClose={onPromptClose}
        />
      )}
      {neverConfirm && (
        <NeverConfirmBanner
          hostname={hostname}
          onUndo={() => undoNever(hostname)}
        />
      )}
    </>
  );
}

function FabButton({
  status,
  positionStyle,
  menuOpen,
  onMouseDown,
  onClick,
  onChevronClick,
  onCloseMenu,
  onPickMode,
  hostname,
  ruleKind,
  effectiveMode,
  pageLangHint,
  onChangeRule,
  promptVisible,
  promptLangLabel,
  onPromptAlways,
  onPromptJustOnce,
  onPromptNever,
  onPromptClose,
}: {
  status: FabStatus;
  positionStyle: Record<string, number>;
  menuOpen: boolean;
  onMouseDown: (e: React.MouseEvent) => void;
  onClick: (e: React.MouseEvent) => void;
  onChevronClick: (e: React.MouseEvent) => void;
  onCloseMenu: () => void;
  onPickMode: (mode: TranslateMode) => void;
  hostname: string;
  ruleKind: 'always' | 'session' | 'never';
  effectiveMode: TranslateMode;
  /** "always 规则下检测到同语言"时的 hint 文案；其它情况 null */
  pageLangHint: string | null;
  onChangeRule: (next: 'always' | 'session' | 'never') => void;
  /** 首次外语页询问 banner 可见性与回调 */
  promptVisible: boolean;
  promptLangLabel: string;
  onPromptAlways: () => void;
  onPromptJustOnce: () => void;
  onPromptNever: () => void;
  onPromptClose: () => void;
}) {
  // 不显示进度数字 —— 用户反馈"没必要给用户看到"
  const label = status === 'active' ? '撤销翻译' : '翻译';
  const Icon = status === 'active' ? X : Languages;

  return (
    <div
      style={{
        position: 'fixed',
        ...positionStyle,
        zIndex: 2147483647,
        display: 'inline-flex',
        alignItems: 'center',
      }}
    >
      {/* 下拉菜单 —— active 时也允许打开（用于改域名规则；模式切换仍只在 idle 显示） */}
      {menuOpen && (
        <ModeMenu
          onCloseMenu={onCloseMenu}
          onPickMode={onPickMode}
          showModes={status !== 'active'}
          hostname={hostname}
          ruleKind={ruleKind}
          effectiveMode={effectiveMode}
          pageLangHint={pageLangHint}
          onChangeRule={onChangeRule}
        />
      )}

      {/* 首次外语页询问 banner —— 同样浮在 FAB 上方，与 menu 互斥（shouldShowPrompt 已 gate） */}
      {promptVisible && (
        <TranslatePrompt
          hostname={hostname}
          langLabel={promptLangLabel}
          onAlways={onPromptAlways}
          onJustOnce={onPromptJustOnce}
          onNever={onPromptNever}
          onClose={onPromptClose}
        />
      )}

      {/* 主按钮 + chevron 分体显示，但同一外壳 */}
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'stretch',
          background: '#111',
          color: '#fff',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          fontSize: 13,
          fontWeight: 500,
          borderRadius: 24,
          boxShadow: '0 6px 20px rgba(0,0,0,0.35)',
          overflow: 'hidden',
          userSelect: 'none',
        }}
      >
        <button
          type="button"
          onMouseDown={onMouseDown}
          onClick={onClick}
          aria-label={label}
          style={{
            padding: '10px 14px',
            background: 'transparent',
            color: 'inherit',
            border: 'none',
            cursor: 'grab',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            font: 'inherit',
          }}
        >
          <Icon size={14} />
          {label}
        </button>
        <button
          type="button"
          // data-attr 让 ModeMenu 的 outside-click 监听把 chevron 当成"内部"，
          // 否则 capture-phase pointerdown 先 set false，紧随的 click 再 toggle，永远关不掉。
          data-ea-mode-trigger="true"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={onChevronClick}
          aria-label="切换翻译模式或域名规则"
          style={{
            padding: '10px 10px 10px 4px',
            background: 'transparent',
            color: 'inherit',
            border: 'none',
            borderLeft: '1px solid rgba(255,255,255,0.15)',
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
          }}
        >
          <ChevronDown size={14} />
        </button>
      </div>
    </div>
  );
}

function ModeMenu({
  onCloseMenu,
  onPickMode,
  showModes,
  hostname,
  ruleKind,
  effectiveMode,
  pageLangHint,
  onChangeRule,
}: {
  onCloseMenu: () => void;
  onPickMode: (mode: TranslateMode) => void;
  /** 翻译进行中时关掉"切换模式"分区 —— 改模式要先撤销 */
  showModes: boolean;
  hostname: string;
  ruleKind: 'always' | 'session' | 'never';
  /** "总是自动翻译"将以哪种 mode 落地（沿用 lastUsedMode → 已有 rule.mode → article） */
  effectiveMode: TranslateMode;
  /** "always 但跳过了"时的解释 hint；null 时不附加 */
  pageLangHint: string | null;
  onChangeRule: (next: 'always' | 'session' | 'never') => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      const path = e.composedPath();
      if (menuRef.current && path.includes(menuRef.current)) return;
      // chevron 自己负责 toggle，别让 outside-click 抢先关掉它
      for (const node of path) {
        if (node instanceof HTMLElement && node.dataset.eaModeTrigger === 'true') return;
      }
      onCloseMenu();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onCloseMenu();
    }
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [onCloseMenu]);

  const modeItems: Array<{ mode: TranslateMode; label: string; desc: string }> = [
    { mode: 'article', label: '翻译正文', desc: '只翻文章内容，跳过 nav / 评论 / 边栏' },
    { mode: 'page', label: '翻译全页', desc: '整页所有段落，含 UI 文案 / 边栏' },
  ];

  const modeLabel = effectiveMode === 'page' ? '全页' : '正文';
  const ruleItems: Array<{
    kind: 'always' | 'session' | 'never';
    label: string;
    desc: string;
  }> = [
    {
      kind: 'always',
      label: '总是自动翻译',
      // 显式告诉用户：以 lastUsedMode 落地。点之前用户大概率刚翻过一次正文或全页，
      // 这里复述他刚做的事让"记住"这件事不黑箱。
      // pageLangHint 在"规则=always 但跳过了"时附加，解释为啥没翻
      desc:
        `打开 / 跳转就自动翻（${modeLabel}）` +
        (pageLangHint ? ` · ${pageLangHint}` : ''),
    },
    { kind: 'session', label: '仅本次', desc: '不记忆，下次需要手动点' },
    { kind: 'never', label: '从不在此站翻译', desc: '隐藏 FAB，避开复杂 WebApp' },
  ];

  return (
    <div
      ref={menuRef}
      style={{
        position: 'absolute',
        // 跟父容器底边对齐再上抬 6px，刚好贴在 FAB 上方
        bottom: 'calc(100% + 6px)',
        right: 0,
        minWidth: 240,
        background: '#fff',
        color: '#111',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: 13,
        border: '1px solid rgba(0,0,0,0.08)',
        borderRadius: 8,
        boxShadow: '0 10px 30px rgba(0,0,0,0.18)',
        overflow: 'hidden',
      }}
    >
      {showModes && (
        <>
          {modeItems.map((item) => (
            <button
              key={item.mode}
              type="button"
              onClick={() => onPickMode(item.mode)}
              style={menuItemStyle}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(0,0,0,0.04)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              <div style={{ fontWeight: 500 }}>{item.label}</div>
              <div style={{ fontSize: 11, color: '#666', marginTop: 2 }}>{item.desc}</div>
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              // 沉浸式对照阅读走独立 overlay，不复用 inline 注入路径。
              // 用 window 事件跨 shadow root 通讯：FAB 和 ImmersiveReader 各自挂在
              // 独立 shadow root 里，模块级状态 / React Context 都跨不过去。
              window.dispatchEvent(
                new CustomEvent('eag:open-reader', { detail: { layout: 'split' } }),
              );
              onCloseMenu();
            }}
            style={menuItemStyle}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(0,0,0,0.04)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            <div style={{ fontWeight: 500 }}>对照阅读</div>
            <div style={{ fontSize: 11, color: '#666', marginTop: 2 }}>
              左右分屏，原文 / 译文逐段对齐
            </div>
          </button>
          <button
            type="button"
            onClick={() => {
              window.dispatchEvent(
                new CustomEvent('eag:open-reader', { detail: { layout: 'flow' } }),
              );
              onCloseMenu();
            }}
            style={menuItemStyle}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(0,0,0,0.04)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            <div style={{ fontWeight: 500 }}>沉浸阅读</div>
            <div style={{ fontSize: 11, color: '#666', marginTop: 2 }}>
              单列居中，剥掉网页噪音
            </div>
          </button>
          <div style={dividerStyle} />
        </>
      )}

      <div style={sectionLabelStyle}>
        在 <span style={{ color: '#111', fontWeight: 600 }}>{hostname}</span> 上
      </div>
      {ruleItems.map((item) => {
        const selected = item.kind === ruleKind;
        return (
          <button
            key={item.kind}
            type="button"
            onClick={() => onChangeRule(item.kind)}
            style={menuItemStyle}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(0,0,0,0.04)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span
                aria-hidden
                style={{
                  display: 'inline-block',
                  width: 12,
                  height: 12,
                  borderRadius: '50%',
                  border: '1.5px solid #999',
                  background: selected ? '#111' : 'transparent',
                  boxShadow: selected ? 'inset 0 0 0 2px #fff' : 'none',
                  flex: 'none',
                }}
              />
              <span style={{ fontWeight: selected ? 600 : 500 }}>{item.label}</span>
            </div>
            <div style={{ fontSize: 11, color: '#666', marginTop: 2, paddingLeft: 20 }}>
              {item.desc}
            </div>
          </button>
        );
      })}
    </div>
  );
}

const menuItemStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  padding: '8px 12px',
  background: 'transparent',
  border: 0,
  cursor: 'pointer',
  textAlign: 'left',
  color: 'inherit',
  font: 'inherit',
};

const dividerStyle: React.CSSProperties = {
  height: 1,
  background: 'rgba(0,0,0,0.08)',
  margin: '4px 0',
};

const sectionLabelStyle: React.CSSProperties = {
  padding: '8px 12px 4px',
  fontSize: 11,
  color: '#666',
  textTransform: 'none',
  letterSpacing: 0,
};

/**
 * 首次外语页询问 banner —— Chrome 原生翻译条同款的产品形态，浮在 FAB 上方。
 *
 * 三个动作 + 关闭：
 *   - "总是翻译" → 写 always 规则 + 立刻翻译
 *   - "仅本次"   → 立刻翻译，不写规则
 *   - "从不"     → 写 never 规则（下次刷新连 FAB 都不出）
 *   - X         → 仅 dismiss（本 lifetime 不再弹）
 *
 * 用 data-attr `eag-prompt-root` 标记容器，给未来 outside-click 监听 / 调试用。
 */
function TranslatePrompt({
  hostname,
  langLabel,
  onAlways,
  onJustOnce,
  onNever,
  onClose,
}: {
  hostname: string;
  langLabel: string;
  onAlways: () => void;
  onJustOnce: () => void;
  onNever: () => void;
  onClose: () => void;
}) {
  return (
    <div
      data-eag-prompt-root="true"
      style={{
        position: 'absolute',
        bottom: 'calc(100% + 8px)',
        right: 0,
        width: 300,
        background: '#fff',
        color: '#111',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: 13,
        border: '1px solid rgba(0,0,0,0.08)',
        borderRadius: 10,
        boxShadow: '0 12px 32px rgba(0,0,0,0.18)',
        animation: 'eag-prompt-in .18s cubic-bezier(.2,.8,.3,1.05) both',
      }}
    >
      <style>{`@keyframes eag-prompt-in {
        from { opacity: 0; transform: translateY(6px) scale(.97); }
        to   { opacity: 1; transform: translateY(0) scale(1); }
      }`}</style>
      <button
        type="button"
        onClick={onClose}
        aria-label="关闭"
        style={{
          position: 'absolute',
          top: 6,
          right: 6,
          width: 22,
          height: 22,
          border: 'none',
          background: 'transparent',
          color: '#888',
          cursor: 'pointer',
          fontSize: 16,
          lineHeight: 1,
          padding: 0,
        }}
      >
        ×
      </button>
      <div style={{ padding: '12px 14px 6px' }}>
        <div style={{ fontSize: 13.5, fontWeight: 500 }}>
          检测到这是<span style={{ color: '#0b8f5a' }}>{langLabel}</span>页面
        </div>
        <div style={{ fontSize: 11.5, color: '#666', marginTop: 4 }}>
          要翻译 <span style={{ fontWeight: 500, color: '#333' }}>{hostname}</span> 吗？
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6, padding: '4px 10px 12px', flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={onAlways}
          style={{
            flex: '1 1 auto',
            minWidth: 88,
            padding: '7px 10px',
            background: '#111',
            color: '#fff',
            border: 'none',
            borderRadius: 7,
            fontSize: 12.5,
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          总是翻译
        </button>
        <button
          type="button"
          onClick={onJustOnce}
          style={promptSecondaryBtnStyle}
        >
          仅本次
        </button>
        <button
          type="button"
          onClick={onNever}
          style={promptSecondaryBtnStyle}
        >
          从不
        </button>
      </div>
    </div>
  );
}

const promptSecondaryBtnStyle: React.CSSProperties = {
  flex: '1 1 auto',
  minWidth: 64,
  padding: '7px 10px',
  background: '#fff',
  color: '#333',
  border: '1px solid rgba(0,0,0,0.12)',
  borderRadius: 7,
  fontSize: 12.5,
  fontWeight: 500,
  cursor: 'pointer',
};

/**
 * 用户刚刚把本站设为"从不翻译"后显示的临时确认条 —— 给一个 5s 撤销窗口
 * 和一条永久恢复路径（右键菜单），避免"我点错了怎么办"的死胡同。
 *
 * 独立浮在视口右下角；不依赖 FAB（FAB 此时已隐藏）。
 */
function NeverConfirmBanner({
  hostname,
  onUndo,
}: {
  hostname: string;
  onUndo: () => void;
}) {
  return (
    <div
      data-eag-never-confirm="true"
      style={{
        position: 'fixed',
        right: 20,
        bottom: 20,
        zIndex: 2147483647,
        width: 300,
        background: '#101012',
        color: '#fff',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: 13,
        borderRadius: 10,
        boxShadow: '0 12px 32px rgba(0,0,0,0.32)',
        padding: '12px 14px',
        animation: 'eag-never-in .18s cubic-bezier(.2,.8,.3,1.05) both',
      }}
    >
      <style>{`@keyframes eag-never-in {
        from { opacity: 0; transform: translateY(8px); }
        to   { opacity: 1; transform: translateY(0); }
      }`}</style>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ color: '#6ddca0', fontWeight: 700 }}>✓</span>
        <span style={{ flex: 1, fontWeight: 500 }}>
          已在 <span style={{ color: '#9ec5ff' }}>{hostname}</span> 上禁用
        </span>
        <button
          type="button"
          onClick={onUndo}
          style={{
            background: 'transparent',
            color: '#9ec5ff',
            border: 'none',
            cursor: 'pointer',
            fontSize: 13,
            fontWeight: 600,
            padding: '2px 4px',
            textDecoration: 'underline',
            textUnderlineOffset: 2,
          }}
        >
          撤销
        </button>
      </div>
      <div style={{ fontSize: 11, color: '#9a9a9c', marginTop: 6, lineHeight: 1.5 }}>
        以后右键菜单 → <span style={{ color: '#cfcfd1' }}>"重置本站翻译规则"</span> 可随时恢复
      </div>
    </div>
  );
}
