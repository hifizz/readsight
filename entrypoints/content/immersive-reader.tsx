/**
 * 沉浸式对照阅读（M3 v2）—— FAB 菜单第三个入口"对照阅读"打开本组件。
 *
 * 跟"翻译正文"inline 注入模式正交：本组件打开一个全屏蒙层，左右分栏 Grid
 * 布局，左原文 / 右译文逐段对齐，单一滚动条同步驱动。复用 translate.tsx
 * 的 extractArticleBlocks + translateBatchViaBackground + 占位符还原管线，
 * 命中翻译缓存时秒回。
 *
 * 跨 shadow root 通讯：FAB 与本组件挂在独立 shadow root，模块级 React state
 * 跨不过去；用 window 自定义事件 'eag:open-immersive' 做信号桥。
 */
import { Fragment, useEffect, useState } from 'react';
import {
  type ArticleBlock,
  extractArticleBlocks,
  restorePreserves,
  translateBatchViaBackground,
} from './translate';

type CellStatus =
  | { kind: 'loading' }
  | { kind: 'ok'; zh: string }
  | { kind: 'error' };

const BATCH_SIZE = 12;
const CONCURRENCY = 4;

/** 把段落里残留的 ⟪C1⟫ 占位符替换回原 code 文本，纯文本渲染时调一次 */
function restoreOriginalText(text: string, restoreMap: Map<string, string>): string {
  return restorePreserves(text, restoreMap);
}

export function ImmersiveReader() {
  const [open, setOpen] = useState(false);
  const [blocks, setBlocks] = useState<ArticleBlock[]>([]);
  const [statuses, setStatuses] = useState<Map<string, CellStatus>>(new Map());
  const [title, setTitle] = useState('');
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    function onOpen() {
      const extracted = extractArticleBlocks('article');
      if (extracted.length === 0) {
        // 没识别到正文 —— 显示 2s 浮提示，不打开蒙层。
        // 用户大概率应该用"翻译全页"模式，这里不强行兜底。
        setToast('未识别到正文');
        setTimeout(() => setToast(null), 2200);
        return;
      }
      setBlocks(extracted);
      setTitle(document.title);
      const initial = new Map<string, CellStatus>();
      for (const b of extracted) initial.set(b.id, { kind: 'loading' });
      setStatuses(initial);
      setOpen(true);
      void translateAll(extracted);
    }
    window.addEventListener('eag:open-immersive', onOpen);
    return () => window.removeEventListener('eag:open-immersive', onOpen);
  }, []);

  // 打开时锁 body 滚动 + 监听 ESC
  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') handleClose();
    }
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener('keydown', onKey);
    };
    // handleClose 是稳定的（不闭包捕获 state），无须放依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function translateAll(bs: ArticleBlock[]) {
    const chunks: ArticleBlock[][] = [];
    for (let i = 0; i < bs.length; i += BATCH_SIZE) {
      chunks.push(bs.slice(i, i + BATCH_SIZE));
    }
    // 并发 worker 模式：CONCURRENCY 个 worker 共享 idx 游标，先到先取
    let idx = 0;
    async function worker() {
      while (idx < chunks.length) {
        const my = chunks[idx++];
        await translateChunk(my);
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  }

  async function translateChunk(chunk: ArticleBlock[]) {
    const payload = chunk.map((b) => ({ id: b.id, text: b.text }));
    try {
      const results = await translateBatchViaBackground(payload);
      setStatuses((prev) => {
        const next = new Map(prev);
        for (const r of results) {
          const block = chunk.find((b) => b.id === r.id);
          if (r.error || typeof r.zh !== 'string' || !r.zh) {
            next.set(r.id, { kind: 'error' });
          } else {
            next.set(r.id, {
              kind: 'ok',
              zh: block ? restorePreserves(r.zh, block.restoreMap) : r.zh,
            });
          }
        }
        return next;
      });
    } catch (err) {
      console.warn('[english-agent] immersive batch failed', err);
      setStatuses((prev) => {
        const next = new Map(prev);
        for (const b of chunk) next.set(b.id, { kind: 'error' });
        return next;
      });
    }
  }

  function handleClose() {
    setOpen(false);
    setBlocks([]);
    setStatuses(new Map());
  }

  // 即使没打开，也要保留 toast 渲染入口
  if (!open) {
    if (toast) {
      return (
        <>
          <style>{IMMERSIVE_CSS}</style>
          <div className="eag-imm-toast">{toast}</div>
        </>
      );
    }
    return null;
  }

  return (
    <>
      <style>{IMMERSIVE_CSS}</style>
      <div
        className="eag-imm-backdrop"
        // 蒙层背景**不**响应点击关闭（避免误触丢失阅读位置 —— 设计决策）
      >
        <div className="eag-imm-panel">
          <header className="eag-imm-header">
            <div className="eag-imm-title" title={title}>
              {title || '对照阅读'}
            </div>
            <button
              type="button"
              className="eag-imm-close"
              onClick={handleClose}
              aria-label="关闭"
            >
              ×
            </button>
          </header>
          <div className="eag-imm-scroll">
            <div className="eag-imm-grid">
              <div className="eag-imm-colhead eag-imm-colhead-en">原文</div>
              <div className="eag-imm-colhead eag-imm-colhead-zh">译文</div>
              {blocks.map((b) => {
                const st = statuses.get(b.id);
                return (
                  <Fragment key={b.id}>
                    <div className="eag-imm-cell eag-imm-en">
                      {restoreOriginalText(b.text, b.restoreMap)}
                    </div>
                    <div className="eag-imm-cell eag-imm-zh">
                      {!st || st.kind === 'loading' ? (
                        <div className="eag-imm-skel">
                          <span className="eag-imm-skel-bar" />
                          <span className="eag-imm-skel-bar eag-imm-skel-bar-2" />
                        </div>
                      ) : st.kind === 'error' ? (
                        <span className="eag-imm-error">翻译失败</span>
                      ) : (
                        st.zh
                      )}
                    </div>
                  </Fragment>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

/**
 * Scoped CSS（运行在独立 shadow root，不会污染宿主页面）。
 *
 * 关键设计：
 *   - 单 scroll 容器 + Grid：行高自动取左右最大值，对齐与同步都是 CSS 天然结果，零 JS
 *   - 字号 / 行高 / 颜色统一一套，不继承宿主页面（用户明确选了"仅文本 + 通用排版"）
 *   - 译文风格沿用 inline 译文（opacity 0.78、font-weight 300、text-autospace），
 *     和"翻译正文"模式视觉一致
 */
const IMMERSIVE_CSS = `
.eag-imm-backdrop {
  position: fixed;
  inset: 0;
  z-index: 2147483647;
  background: #fff;
  font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
  -webkit-font-smoothing: antialiased;
  animation: eag-imm-fade .18s ease-out both;
}
@keyframes eag-imm-fade {
  from { opacity: 0; }
  to   { opacity: 1; }
}

.eag-imm-panel {
  display: flex;
  flex-direction: column;
  width: 100vw;
  height: 100vh;
  background: #fff;
  color: #1a1a1a;
  overflow: hidden;
}

.eag-imm-header {
  flex: none;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 18px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.08);
  background: #fff;
}
.eag-imm-title {
  flex: 1;
  font-size: 14px;
  font-weight: 600;
  color: #1a1a1a;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.eag-imm-close {
  width: 28px;
  height: 28px;
  border: none;
  background: transparent;
  color: #666;
  font-size: 22px;
  line-height: 1;
  cursor: pointer;
  border-radius: 6px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  transition: background .12s, color .12s;
}
.eag-imm-close:hover {
  background: rgba(0, 0, 0, 0.06);
  color: #111;
}

.eag-imm-scroll {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 4px 28px 48px;
  /* 浅一点的 scrollbar，与白底协调 */
  scrollbar-color: rgba(0,0,0,0.25) transparent;
}
.eag-imm-scroll::-webkit-scrollbar { width: 10px; }
.eag-imm-scroll::-webkit-scrollbar-thumb {
  background: rgba(0,0,0,0.18);
  border-radius: 5px;
  border: 2px solid #fff;
}

.eag-imm-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  column-gap: 40px;
  row-gap: 14px;
  align-items: start;
  max-width: 1200px;
  margin: 0 auto;
  padding-top: 16px;
}

.eag-imm-colhead {
  position: sticky;
  top: 0;
  background: linear-gradient(to bottom, #fff 70%, rgba(255,255,255,0));
  padding: 8px 0 12px;
  font-size: 11px;
  font-weight: 600;
  color: #999;
  letter-spacing: .5px;
  text-transform: uppercase;
  z-index: 1;
}

.eag-imm-cell {
  line-height: 1.75;
  word-break: break-word;
  /* 中英文 / 中文数字之间自动加空格 */
  -webkit-text-autospace: normal;
  text-autospace: normal;
}
.eag-imm-en {
  color: #1a1a1a;
  font-family: Georgia, 'Iowan Old Style', 'Source Serif Pro', serif;
  font-size: 19px;
}
.eag-imm-zh {
  color: #1a1a1a;
  font-family: system-ui, -apple-system, 'PingFang SC', 'Hiragino Sans GB', sans-serif;
  font-weight: 300;
  font-size: 17px;
  opacity: 0.85;
}

.eag-imm-error {
  color: #b94a4a;
  opacity: 0.7;
  font-size: 14px;
}

/* 译文未到达时的 skeleton */
.eag-imm-skel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 4px 0;
}
.eag-imm-skel-bar {
  display: block;
  height: 12px;
  border-radius: 4px;
  background: linear-gradient(90deg, rgba(0,0,0,0.06) 25%, rgba(0,0,0,0.12) 37%, rgba(0,0,0,0.06) 63%);
  background-size: 400% 100%;
  animation: eag-imm-shimmer 1.4s ease-in-out infinite;
}
.eag-imm-skel-bar-2 { width: 65%; }
@keyframes eag-imm-shimmer {
  0%   { background-position: 100% 0; }
  100% { background-position: -100% 0; }
}

/* "未识别到正文" toast */
.eag-imm-toast {
  position: fixed;
  bottom: 80px;
  right: 24px;
  z-index: 2147483647;
  background: #101012;
  color: #fff;
  font-family: system-ui, -apple-system, sans-serif;
  font-size: 13px;
  padding: 10px 14px;
  border-radius: 8px;
  box-shadow: 0 10px 28px rgba(0,0,0,0.32);
  animation: eag-imm-toast-in .18s ease-out both;
}
@keyframes eag-imm-toast-in {
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: translateY(0); }
}
`;
