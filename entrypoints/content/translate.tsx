/**
 * 全文双语翻译（M3 PRD §7.1 / §10）—— content script 部分。
 *
 * 职责：
 *   1. 用户点 FAB 浮动按钮 → 抽取文章正文 blocks（`<p>` 等）
 *   2. 拆 5 blocks/批，并发发 `TRANSLATE_BLOCKS` 到 background → /api/translate
 *   3. 每批返回后，遍历 result.id 找回对应 element，在它后面插入译文 `<div>`
 *   4. 单块失败：注入红色 "重试" 按钮，点击单块重发
 *   5. 再点 FAB 撤销 → querySelectorAll('.english-agent-translation') 全 remove
 *
 * 设计选择：
 *   - 译文节点用纯 DOM（非 Shadow DOM）+ 内联样式 + class —— 用户可选中
 *     复制中文做二次划词查询，符合 PRD §6 选词流程
 *   - 块 → element 映射用 data-eag-id 属性双向绑定，避免 React state 跟
 *     真实 DOM 异步不一致
 */
import { useState } from 'react';
import { Languages, Loader2, X, RotateCcw } from 'lucide-react';
import type { BackgroundMessage, TranslationResult } from '@/lib/messaging';

const BLOCK_SELECTOR = 'p, li, blockquote, h2, h3, h4, h5, h6, dd';
const ROOT_SELECTOR_CANDIDATES = ['article', 'main', '[role="main"]'];
const MIN_BLOCK_LENGTH = 20;
const BATCH_SIZE = 5;
const TRANSLATION_CLASS = 'english-agent-translation';
const BLOCK_ID_ATTR = 'data-eag-id';

/** 找文章正文容器，找不到 fallback 到 body —— PRD §3.2 默认适配器的简易版 */
function findArticleRoot(): HTMLElement {
  for (const sel of ROOT_SELECTOR_CANDIDATES) {
    const el = document.querySelector<HTMLElement>(sel);
    if (el) return el;
  }
  return document.body;
}

interface ArticleBlock {
  id: string;
  element: HTMLElement;
  text: string;
}

/** 抽取所有"可翻译"的正文块。每个 block 打上 data-eag-id 便于回填译文 */
function extractArticleBlocks(): ArticleBlock[] {
  const root = findArticleRoot();
  const elements = Array.from(root.querySelectorAll<HTMLElement>(BLOCK_SELECTOR));
  const blocks: ArticleBlock[] = [];
  for (const el of elements) {
    // 已经被注入过译文的 / 译文节点自身 都跳过
    if (el.classList.contains(TRANSLATION_CLASS)) continue;
    // 子元素里包含 BLOCK_SELECTOR 的（如 article > div > p），上层元素不算 block
    // —— 但 querySelectorAll 已经摊平了；只要不是嵌套 p 就行，常见 DOM 不会嵌套块
    const text = (el.textContent ?? '').trim();
    if (text.length < MIN_BLOCK_LENGTH) continue;
    const id = el.getAttribute(BLOCK_ID_ATTR) ?? crypto.randomUUID();
    el.setAttribute(BLOCK_ID_ATTR, id);
    blocks.push({ id, element: el, text });
  }
  return blocks;
}

/**
 * 在 anchor block 后插入译文节点（或失败 retry 按钮）。
 * 如果已有同 block 的译文节点，先 remove 再插（用于重试场景）。
 */
function injectTranslation(
  anchor: HTMLElement,
  result: TranslationResult,
  onRetry: () => void,
): void {
  // 清理同 anchor 的旧译文（重试时）
  const oldNode = anchor.nextElementSibling;
  if (oldNode?.classList.contains(TRANSLATION_CLASS)) oldNode.remove();

  const node = document.createElement('div');
  node.className = TRANSLATION_CLASS;
  node.setAttribute(BLOCK_ID_ATTR, result.id);
  // 内联样式 + !important 双保险防被 TechCrunch CSS 干掉
  node.setAttribute(
    'style',
    [
      'margin: 8px 0 16px 0 !important',
      'padding: 8px 12px !important',
      'background: rgba(0,0,0,0.04) !important',
      'border-left: 3px solid #6b7280 !important',
      'color: inherit !important',
      'font-family: inherit !important',
      'font-size: 0.95em !important',
      'line-height: 1.6 !important',
      'border-radius: 4px !important',
    ].join(';'),
  );

  if (result.error) {
    // 失败状态：红色提示 + 重试按钮
    node.setAttribute(
      'style',
      node.getAttribute('style') +
        ';background: rgba(239,68,68,0.08) !important; border-left-color: #ef4444 !important',
    );
    const msg = document.createElement('span');
    msg.textContent = `翻译失败：${result.error}　`;
    msg.style.color = '#991b1b';
    node.appendChild(msg);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = '↻ 重试';
    btn.setAttribute(
      'style',
      'background: #fff; border: 1px solid #ef4444; color: #991b1b; padding: 2px 8px; border-radius: 4px; cursor: pointer; font-size: 0.85em;',
    );
    btn.addEventListener('click', onRetry);
    node.appendChild(btn);
  } else {
    node.textContent = result.zh;
  }

  anchor.insertAdjacentElement('afterend', node);
}

/**
 * 撤销所有翻译。直接 querySelectorAll 全表清，data-eag-id 属性可留可清。
 */
export function undoAllTranslations(): void {
  document.querySelectorAll<HTMLElement>(`.${TRANSLATION_CLASS}`).forEach((el) => el.remove());
}

/**
 * 给 background 发一批 blocks，await 结果。
 */
async function translateBatchViaBackground(
  blocks: Array<{ id: string; text: string }>,
): Promise<TranslationResult[]> {
  const msg: BackgroundMessage = {
    type: 'TRANSLATE_BLOCKS',
    payload: { blocks },
  };
  const response = (await chrome.runtime.sendMessage(msg)) as
    | { ok: true; results: TranslationResult[] }
    | { ok: false; error: string };
  if (!response || !response.ok) {
    throw new Error(response?.ok === false ? response.error : 'no response');
  }
  return response.results;
}

/** 拆数组成等长片段 */
function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export type FabStatus = 'idle' | 'translating' | 'translated' | 'error';

interface FabProps {
  /** 状态变化通知外部，方便记录 / 上报（可选） */
  onStatusChange?: (s: FabStatus) => void;
}

export function TranslateFab({ onStatusChange }: FabProps) {
  const [status, setStatus] = useState<FabStatus>('idle');
  const [progress, setProgress] = useState<{ done: number; total: number }>({ done: 0, total: 0 });

  function update(next: FabStatus) {
    setStatus(next);
    onStatusChange?.(next);
  }

  /** 重试单 block（在 retry 按钮里 closure 调用） */
  async function retryBlock(blockId: string, element: HTMLElement, text: string) {
    try {
      const results = await translateBatchViaBackground([{ id: blockId, text }]);
      const r = results[0];
      if (!r) return;
      injectTranslation(element, r, () => retryBlock(blockId, element, text));
    } catch (err) {
      console.warn('[english-agent] retry block failed', err);
    }
  }

  async function handleClick() {
    if (status === 'translating') return;
    if (status === 'translated') {
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

    // 块 id → element 映射（背景返结果只带 id+zh，前端要找回 element）
    const elementById = new Map(blocks.map((b) => [b.id, b.element]));
    const textById = new Map(blocks.map((b) => [b.id, b.text]));

    // 拆批 + 并发；每批返回独立 inject
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
          // 整批失败：给每块挂上 retry
          for (const b of batch) {
            const el = elementById.get(b.id);
            if (el) {
              injectTranslation(el, { id: b.id, zh: '', source: 'llm', error: String(err) }, () =>
                retryBlock(b.id, el, b.text),
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
          injectTranslation(el, r, () => retryBlock(r.id, el, textById.get(r.id) ?? ''));
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
      {/* 内联 keyframes：Shadow DOM 内不影响外页面 */}
      <style>{`@keyframes eag-spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}`}</style>
    </button>
  );
}
// 让 RotateCcw 类型不被 dead-code 误判（保留给未来 retry icon 复用）
void RotateCcw;
