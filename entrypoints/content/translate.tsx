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
import { useSyncExternalStore } from 'react';
import { Languages, X } from 'lucide-react';
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

function extractArticleBlocks(): ArticleBlock[] {
  const root = findArticleRoot();
  const allow = buildReadabilityAllowlist();
  const elements = Array.from(root.querySelectorAll<HTMLElement>(BLOCK_SELECTOR));
  const blocks: ArticleBlock[] = [];
  for (const el of elements) {
    if (el.classList.contains(TRANSLATION_CLASS)) continue;

    // h1 标题特殊处理：Readability 把它单独抽到 article.title，不进 textContent；
    // 很多站点又把 h1 包在 <article><header><h1></header>，被祖先黑名单连坐。
    // 所以"在文章正文容器内的 h1"完全豁免所有过滤，标题永远入翻译队列。
    const isArticleHeading =
      el.tagName === 'H1' && el.closest(ARTICLE_ROOT_SELECTOR) !== null;

    if (!isArticleHeading && el.closest(EXCLUDE_ANCESTOR_SELECTOR)) continue;

    const rawText = (el.textContent ?? '').trim();
    if (rawText.length < MIN_BLOCK_LENGTH) continue;
    if (linkTextRatio(el) > 0.5) continue;

    // Readability sentence allowlist 过滤；h1 标题豁免（标题文本不在 textContent 里）
    if (!isArticleHeading && allow && !isInReadableArticle(el, allow)) continue;

    // 走 DOM 抽出"带占位符"的文本：内联 <code>/<kbd>/... 内容替换成 ⟪Cn⟫
    const { text, restoreMap } = extractTextWithPreserves(el);
    if (text.length < MIN_BLOCK_LENGTH) continue;

    const id = el.getAttribute(BLOCK_ID_ATTR) ?? crypto.randomUUID();
    el.setAttribute(BLOCK_ID_ATTR, id);
    blocks.push({ id, element: el, text, restoreMap });
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
 */
export function togglePageTranslation(): void {
  if (moduleState.status === 'active') {
    orchestrator.stop();
    undoAllTranslations();
    setModuleState({ status: 'idle', done: 0, total: 0 });
    return;
  }
  const blocks = extractArticleBlocks();
  if (blocks.length === 0) {
    console.warn('[english-agent] no translatable blocks found');
    return;
  }
  setModuleState({ status: 'active', done: 0, total: blocks.length });
  orchestrator.start(blocks, {
    onProgress: () => {
      setModuleState({ ...moduleState, done: moduleState.done + 1 });
    },
  });
}

export function TranslateFab() {
  // 订阅模块级状态：外部 toggle 也能联动 FAB UI
  const s = useSyncExternalStore(subscribeModuleState, getModuleState, getModuleState);
  return (
    <FabButton
      status={s.status}
      progress={{ done: s.done, total: s.total }}
      onClick={togglePageTranslation}
    />
  );
}

function FabButton({
  status,
  progress,
  onClick,
}: {
  status: FabStatus;
  progress: { done: number; total: number };
  onClick: () => void;
}) {
  const label = (() => {
    if (status === 'idle') return '翻译全文';
    // active：done 持续涨，total 是抽出的全部 block 数。done<total 说明还有
    // 没进过视口的块；done===total 说明所有块都翻完了
    if (progress.total === 0) return '撤销翻译';
    return progress.done >= progress.total
      ? '撤销翻译'
      : `撤销翻译 ${progress.done}/${progress.total}`;
  })();

  const Icon = status === 'active' ? X : Languages;

  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        position: 'fixed',
        bottom: 20,
        right: 20,
        padding: '10px 14px',
        background: '#111',
        color: '#fff',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: 13,
        fontWeight: 500,
        borderRadius: 24,
        border: 'none',
        cursor: 'pointer',
        boxShadow: '0 6px 20px rgba(0,0,0,0.35)',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
      }}
    >
      <Icon size={14} />
      {label}
    </button>
  );
}
