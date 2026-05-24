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
import { useState } from 'react';
import { Languages, Loader2, X } from 'lucide-react';
import { Readability, isProbablyReaderable } from '@mozilla/readability';
import type { BackgroundMessage, TranslationResult } from '@/lib/messaging';

const BLOCK_SELECTOR = 'p, li, blockquote, h2, h3, h4, h5, h6, dd';
/** 内联标签：内容当作"代码 / 标识符"占位符发给 LLM，翻译完原样恢复 */
const INLINE_PRESERVE_SELECTOR = 'code, kbd, samp, var, tt';
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
const BATCH_SIZE = 1; // 渐进式：一块一批，翻好就插
const BATCH_TIMEOUT_MS = 12_000;
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
    if (el.closest(EXCLUDE_ANCESTOR_SELECTOR)) continue;

    const rawText = (el.textContent ?? '').trim();
    if (rawText.length < MIN_BLOCK_LENGTH) continue;
    if (linkTextRatio(el) > 0.5) continue; // link-heavy = 导航类，跳过

    // Readability 进一步过滤（如果跑成功）—— 用未占位的原文匹配
    if (allow && !isInReadableArticle(el, allow)) continue;

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

  if (result.error) {
    // 失败：红色高对比，浅色/暗色背景红字都可见
    node.setAttribute(
      'style',
      [
        'margin: 4px 0 12px 0 !important',
        'color: #ef4444 !important',
        'font-family: inherit !important',
        'font-size: 0.9em !important',
        'line-height: 1.5 !important',
      ].join(';'),
    );
    const msg = document.createElement('span');
    msg.textContent = `⚠ 翻译失败 (${result.error}) `;
    node.appendChild(msg);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = '↻ 重试';
    btn.setAttribute(
      'style',
      [
        'background: transparent',
        'border: 1px solid currentColor',
        'color: inherit',
        'padding: 1px 8px',
        'border-radius: 3px',
        'cursor: pointer',
        'font-size: 0.95em',
        'margin-left: 4px',
      ].join(';'),
    );
    btn.addEventListener('click', onRetry);
    node.appendChild(btn);
  } else {
    // 正常译文：继承原段落的实际颜色 + opacity 整体淡化区分
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

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export type FabStatus = 'idle' | 'translating' | 'translated' | 'error';

interface FabProps {
  onStatusChange?: (s: FabStatus) => void;
}

export function TranslateFab({ onStatusChange }: FabProps) {
  const [status, setStatus] = useState<FabStatus>('idle');
  const [progress, setProgress] = useState<{ done: number; total: number }>({ done: 0, total: 0 });

  function update(next: FabStatus) {
    setStatus(next);
    onStatusChange?.(next);
  }

  async function retryBlock(
    blockId: string,
    element: HTMLElement,
    text: string,
    restoreMap: Map<string, string>,
  ) {
    try {
      const results = await translateBatchViaBackground([{ id: blockId, text }]);
      const r = results[0];
      if (!r) return;
      // 把 ⟪Cn⟫ 占位符换回原代码文本
      const restored: TranslationResult = r.zh ? { ...r, zh: restorePreserves(r.zh, restoreMap) } : r;
      injectTranslation(element, restored, () => retryBlock(blockId, element, text, restoreMap));
    } catch (err) {
      console.warn('[english-agent] retry block failed', err);
      injectTranslation(
        element,
        { id: blockId, zh: '', source: 'llm', error: String(err) },
        () => retryBlock(blockId, element, text, restoreMap),
      );
    }
  }

  async function handleClick() {
    if (status === 'translating') return;
    if (status === 'translated' || status === 'error') {
      undoAllTranslations();
      update('idle');
      return;
    }

    update('translating');
    const blocks = extractArticleBlocks();
    if (blocks.length === 0) {
      console.warn('[english-agent] no translatable blocks found');
      update('idle');
      return;
    }
    setProgress({ done: 0, total: blocks.length });

    const elementById = new Map(blocks.map((b) => [b.id, b.element]));
    const textById = new Map(blocks.map((b) => [b.id, b.text]));
    const restoreMapById = new Map(blocks.map((b) => [b.id, b.restoreMap]));

    const batches = chunk(
      blocks.map((b) => ({ id: b.id, text: b.text })),
      BATCH_SIZE,
    );

    let anyError = false;
    await Promise.all(
      batches.map(async (batch) => {
        let results: TranslationResult[];
        try {
          results = await translateBatchViaBackground(batch);
        } catch (err) {
          console.warn('[english-agent] batch translate failed', err);
          for (const b of batch) {
            const el = elementById.get(b.id);
            if (el) {
              const rm = restoreMapById.get(b.id) ?? new Map();
              injectTranslation(
                el,
                { id: b.id, zh: '', source: 'llm', error: String(err) },
                () => retryBlock(b.id, el, b.text, rm),
              );
            }
            setProgress((p) => ({ ...p, done: p.done + 1 }));
          }
          anyError = true;
          return;
        }
        for (const r of results) {
          const el = elementById.get(r.id);
          if (!el) continue;
          if (r.error) anyError = true;
          const rm = restoreMapById.get(r.id) ?? new Map();
          const restored: TranslationResult = r.zh ? { ...r, zh: restorePreserves(r.zh, rm) } : r;
          injectTranslation(el, restored, () =>
            retryBlock(r.id, el, textById.get(r.id) ?? '', rm),
          );
          setProgress((p) => ({ ...p, done: p.done + 1 }));
        }
      }),
    );

    update(anyError ? 'error' : 'translated');
  }

  return <FabButton status={status} progress={progress} onClick={handleClick} />;
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
    if (status === 'translating') {
      return progress.total > 0 ? `翻译中 ${progress.done}/${progress.total}` : '翻译中…';
    }
    if (status === 'translated') return '撤销翻译';
    if (status === 'error') return '部分失败，撤销';
    return '翻译全文';
  })();

  const Icon =
    status === 'translating' ? Loader2 : status === 'translated' || status === 'error' ? X : Languages;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={status === 'translating'}
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
        cursor: status === 'translating' ? 'default' : 'pointer',
        boxShadow: '0 6px 20px rgba(0,0,0,0.35)',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        opacity: status === 'translating' ? 0.85 : 1,
      }}
    >
      <Icon
        size={14}
        style={status === 'translating' ? { animation: 'eag-spin 1s linear infinite' } : undefined}
      />
      {label}
      <style>{`@keyframes eag-spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}`}</style>
    </button>
  );
}
