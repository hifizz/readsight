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

const BLOCK_SELECTOR = 'p, li, blockquote, h1, h2, h3, h4, h5, h6, dd';
/** 文章正文容器选择器 —— h1 / 内嵌 header 在这种容器内才豁免外部过滤 */
const ARTICLE_ROOT_SELECTOR = 'article, main, [role="main"]';
/** 内联标签：内容当作"代码 / 标识符"占位符发给 LLM，翻译完原样恢复 */
const INLINE_PRESERVE_SELECTOR = 'code, kbd, samp, var, tt';
/** 视口预测：上下 300px 提前进入翻译队列，用户滚动时已经翻译好可见 */
const VIEWPORT_ROOT_MARGIN = '300px 0px 300px 0px';
/** 一个 HTTP 请求最多带几段，让 server 一次 GLM 调用翻多段，降低 RPM */
const MAX_BATCH_SIZE = 5;
/** debounce：收到第一个块后等多久攒够同批，避免每次进来都立刻发 */
const BATCH_DEBOUNCE_MS = 200;
/** 同时在路上的 batch 上限，防止用户狂滚瞬间炸出 100 个 HTTP */
const MAX_CONCURRENT_BATCHES = 3;
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
// 单 batch 翻 5 段时 GLM 端 ~5-15s，加网络往返；给到 25s 保留余量。
const BATCH_TIMEOUT_MS = 25_000;
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

interface ArticleBlock {
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
function restorePreserves(translated: string, restoreMap: Map<string, string>): string {
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

function extractArticleBlocks(mode: TranslateMode = 'article'): ArticleBlock[] {
  if (mode === 'page') return extractPageBlocks();

  // article 模式（保持原逻辑）：只在 <article>/<main> 内 + Readability 过滤
  const root = findArticleRoot();
  const allow = buildReadabilityAllowlist();
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
function extractPageBlocks(): ArticleBlock[] {
  const units = new Set<HTMLElement>();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const text = node.nodeValue ?? '';
    if (text.trim().length < 2) continue;
    let cur: HTMLElement | null = (node as Text).parentElement;
    let unit: HTMLElement | null = null;
    while (cur && cur !== document.body) {
      if (PAGE_BLOCK_TAGS.has(cur.tagName)) {
        unit = cur;
        break;
      }
      cur = cur.parentElement;
    }
    if (!unit) continue;
    if (unit.closest(PAGE_MODE_HARD_EXCLUDE)) continue;
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
    if (rawText.length < MIN_BLOCK_LENGTH_PAGE) continue;
    const { text, restoreMap } = extractTextWithPreserves(unit);
    if (text.length < MIN_BLOCK_LENGTH_PAGE) continue;
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
async function translateBatchViaBackground(
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
    for (const b of blocks) {
      this.blocks.set(b.id, {
        element: b.element,
        text: b.text,
        restoreMap: b.restoreMap,
        status: 'idle',
      });
    }
    this.observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const id = entry.target.getAttribute(BLOCK_ID_ATTR);
          if (id) this.enqueue(id);
        }
      },
      { rootMargin: VIEWPORT_ROOT_MARGIN, threshold: 0 },
    );
    for (const b of blocks) this.observer.observe(b.element);
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
   * 一个 block 进视口 → 攒进 pendingBatch，重置 debounce timer。
   *
   * 关键：不再"满 MAX_BATCH_SIZE 立刻 flush"。要等 debounce 到期 / 一组
   * 视口块都进队再 flushPending，flush 时按到视口距离排序，**视口内 / 离
   * 视口最近的块优先出队** —— 避免用户滚到中段时还在等顶部翻完。
   */
  private enqueue(id: string): void {
    const block = this.blocks.get(id);
    if (!block || block.status !== 'idle') return;
    block.status = 'pending';
    this.pendingBatch.push(id);

    if (this.batchTimer) clearTimeout(this.batchTimer);
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
    orchestrator.stop();
    undoAllTranslations();
    setModuleState({ status: 'idle', done: 0, total: 0 });
    notifyExternalListeners('idle');
    return;
  }
  const blocks = extractArticleBlocks(mode);
  if (blocks.length === 0) {
    console.warn('[english-agent] no translatable blocks found');
    return;
  }
  setModuleState({ status: 'active', done: 0, total: blocks.length });
  notifyExternalListeners('active');
  orchestrator.start(blocks, {
    onProgress: () => {
      setModuleState({ ...moduleState, done: moduleState.done + 1 });
    },
  });
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

const FAB_POSITION_KEY = 'english-agent:fab-pos';
const DRAG_THRESHOLD_PX = 5;

interface FabPosition {
  /** 距视口右下角的偏移；用 right/bottom 让窗口缩放后仍贴边 */
  right: number;
  bottom: number;
}
const DEFAULT_FAB_POSITION: FabPosition = { right: 20, bottom: 20 };

export function TranslateFab() {
  const s = useSyncExternalStore(subscribeModuleState, getModuleState, getModuleState);
  const [pos, setPos] = useState<FabPosition>(DEFAULT_FAB_POSITION);
  const [menuOpen, setMenuOpen] = useState(false);
  const dragRef = useRef<{
    startX: number;
    startY: number;
    startRight: number;
    startBottom: number;
    moved: boolean;
  } | null>(null);
  /**
   * mouseup 时若刚发生过拖拽，把这个置 true；onClick 读到后吞掉本次点击并清零。
   * dragRef 在 mouseup 里就 null（避免遗留状态），但 click 需要知道"刚拖过"，
   * 所以用独立 ref 跨越 mouseup → click 的事件边界。
   */
  const wasDraggedRef = useRef(false);

  // 启动时读持久化位置
  useEffect(() => {
    chrome.storage.local.get(FAB_POSITION_KEY).then((res) => {
      const saved = res[FAB_POSITION_KEY] as FabPosition | undefined;
      if (saved) setPos(saved);
    });
  }, []);

  // 全局 mousemove / mouseup：拖拽中
  useEffect(() => {
    function onMove(e: MouseEvent) {
      const drag = dragRef.current;
      if (!drag) return;
      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;
      if (!drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      drag.moved = true;
      // 用 right/bottom 反向：鼠标右移 → right 减小
      setPos({
        right: Math.max(0, drag.startRight - dx),
        bottom: Math.max(0, drag.startBottom - dy),
      });
    }
    function onUp() {
      const drag = dragRef.current;
      if (!drag) return;
      dragRef.current = null;
      if (drag.moved) {
        // 标记给紧随的 click 看 —— 拖过了，别把这次 click 当切换翻译
        wasDraggedRef.current = true;
        // 拖完保存位置
        setPos((current) => {
          chrome.storage.local.set({ [FAB_POSITION_KEY]: current }).catch(() => {});
          return current;
        });
      }
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, []);

  function onMouseDown(e: React.MouseEvent) {
    // 只响应主键
    if (e.button !== 0) return;
    // 新一次操作，清掉上次可能没消费掉的 wasDragged（例如拖出按钮外松手没派发 click）
    wasDraggedRef.current = false;
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startRight: pos.right,
      startBottom: pos.bottom,
      moved: false,
    };
  }

  function onClick(e: React.MouseEvent) {
    // mouseup 已在 dragRef null 之前把"刚拖过"信号写到 wasDraggedRef
    if (wasDraggedRef.current) {
      wasDraggedRef.current = false;
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    setMenuOpen(false);
    togglePageTranslation('article');
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

  return (
    <FabButton
      status={s.status}
      pos={pos}
      menuOpen={menuOpen}
      onMouseDown={onMouseDown}
      onClick={onClick}
      onChevronClick={(e) => {
        e.stopPropagation();
        setMenuOpen((o) => !o);
      }}
      onCloseMenu={() => setMenuOpen(false)}
      onPickMode={onClickMode}
    />
  );
}

function FabButton({
  status,
  pos,
  menuOpen,
  onMouseDown,
  onClick,
  onChevronClick,
  onCloseMenu,
  onPickMode,
}: {
  status: FabStatus;
  pos: FabPosition;
  menuOpen: boolean;
  onMouseDown: (e: React.MouseEvent) => void;
  onClick: (e: React.MouseEvent) => void;
  onChevronClick: (e: React.MouseEvent) => void;
  onCloseMenu: () => void;
  onPickMode: (mode: TranslateMode) => void;
}) {
  // 不显示进度数字 —— 用户反馈"没必要给用户看到"
  const label = status === 'active' ? '撤销翻译' : '翻译';
  const Icon = status === 'active' ? X : Languages;

  return (
    <div
      style={{
        position: 'fixed',
        bottom: pos.bottom,
        right: pos.right,
        zIndex: 2147483647,
        display: 'inline-flex',
        alignItems: 'center',
      }}
    >
      {/* 下拉菜单 */}
      {menuOpen && status !== 'active' && (
        <ModeMenu onCloseMenu={onCloseMenu} onPickMode={onPickMode} />
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
        {status !== 'active' && (
          <button
            type="button"
            // data-attr 让 ModeMenu 的 outside-click 监听把 chevron 当成"内部"，
            // 否则 capture-phase pointerdown 先 set false，紧随的 click 再 toggle，永远关不掉。
            data-ea-mode-trigger="true"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={onChevronClick}
            aria-label="切换翻译模式"
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
        )}
      </div>
    </div>
  );
}

function ModeMenu({
  onCloseMenu,
  onPickMode,
}: {
  onCloseMenu: () => void;
  onPickMode: (mode: TranslateMode) => void;
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

  const items: Array<{ mode: TranslateMode; label: string; desc: string }> = [
    { mode: 'article', label: '翻译正文', desc: '只翻文章内容，跳过 nav / 评论 / 边栏' },
    { mode: 'page', label: '翻译全页', desc: '整页所有段落，含 UI 文案 / 边栏' },
  ];

  return (
    <div
      ref={menuRef}
      style={{
        position: 'absolute',
        // 跟父容器底边对齐再上抬 6px，刚好贴在 FAB 上方
        bottom: 'calc(100% + 6px)',
        right: 0,
        minWidth: 200,
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
      {items.map((item) => (
        <button
          key={item.mode}
          type="button"
          onClick={() => onPickMode(item.mode)}
          style={{
            display: 'block',
            width: '100%',
            padding: '8px 12px',
            background: 'transparent',
            border: 0,
            cursor: 'pointer',
            textAlign: 'left',
            color: 'inherit',
            font: 'inherit',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(0,0,0,0.04)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
        >
          <div style={{ fontWeight: 500 }}>{item.label}</div>
          <div style={{ fontSize: 11, color: '#666', marginTop: 2 }}>{item.desc}</div>
        </button>
      ))}
    </div>
  );
}
