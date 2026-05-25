/**
 * 划词轻路径 popup（PRD §7.2 / §8.1）—— launcher 版。
 *
 * UI/UX 设计基于 docs/lookup.jsx：
 *   - 内联"零成本本地词典事实"（词命中 = 音标 / 释义 / 发音按钮）
 *   - 发音 = Tier 0 浏览器 TTS，原地播，不开 sidepanel
 *   - 其余动作（语境义 / 用法 / 翻句 / 深聊）= 路由进 sidepanel
 *
 * 数据：词类型 popup 一打开就 fetch /api/lookup（命中 cache 通常 < 50ms）。
 *      loading / miss / ok 三态分别渲染：骨架 / 占位 / 完整 dict 卡。
 *
 * 不在本文件做：完整 chat、Markdown 渲染、Tier 1 音频（都在 sidepanel）。
 *
 * 跨 context 状态：模块级 popupState + listeners 模式，让 pill 通过
 * `useIsPopupOpen()` 订阅，popup 自身也用 `useSyncExternalStore` 重渲。
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { X, MessageSquare, Volume2, Sparkles } from 'lucide-react';
import type {
  ActionTag,
  AskWithSelectionPayload,
  BackgroundMessage,
  LookupResult,
  SelectionContext,
} from '@/lib/messaging';
import { actionsForSelectionType } from '@/lib/action-tags';
import { useDraggable } from '@/lib/use-draggable';

const BACKEND = import.meta.env.WXT_BACKEND_URL ?? 'http://localhost:4010';

/** popup 锚定位置 —— pill 点击时计算，传进来定位 popup。
 *  使用 viewport 坐标系（即 getBoundingClientRect 原始值），不加 scrollX/Y，
 *  因为 popup 用 `position: fixed` 渲染。 */
interface PopupAnchor {
  rect: { top: number; left: number; right: number; bottom: number };
}

/** 给外部（pill 等组件）订阅 popup 状态用 */
export function useIsPopupOpen(): boolean {
  return useSyncExternalStore(
    subscribePopupState,
    () => popupState.open,
    () => popupState.open,
  );
}

interface PopupState {
  open: boolean;
  ctx: SelectionContext | null;
  anchor: PopupAnchor | null;
}

let popupState: PopupState = { open: false, ctx: null, anchor: null };
const popupListeners = new Set<() => void>();

function setPopupState(next: PopupState): void {
  popupState = next;
  for (const cb of popupListeners) cb();
}

function subscribePopupState(cb: () => void): () => void {
  popupListeners.add(cb);
  return () => {
    popupListeners.delete(cb);
  };
}

function getPopupState(): PopupState {
  return popupState;
}

/** pill 点击调用 */
export function openPopup(ctx: SelectionContext, anchor: PopupAnchor): void {
  setPopupState({ open: true, ctx, anchor });
}

export function closePopup(): void {
  setPopupState({ open: false, ctx: null, anchor: null });
}

/** 推 ASK_WITH_SELECTION 给 background，附带 actionTag/initialMessage */
function sendAsk(payload: AskWithSelectionPayload): void {
  const msg: BackgroundMessage = { type: 'ASK_WITH_SELECTION', payload };
  chrome.runtime
    .sendMessage(msg)
    .catch((err) => console.warn('[english-agent] ASK_WITH_SELECTION failed', err));
}

// --- 视觉常量 ------------------------------------------------------------

const POPUP_WIDTH = 340;
const POPUP_GAP = 10;
const POPUP_MARGIN = 12;

/**
 * Shadow DOM 内的 scoped CSS。所有类前缀 `eag-`，避免万一外溢污染宿主页。
 * 不引外部字体（页面 CSP 会拦），用系统衬线 / 无衬线栈替代 Newsreader / Schibsted Grotesk。
 */
const DIALOG_CSS = `
.eag-dialog *, .eag-dialog *::before, .eag-dialog *::after { box-sizing: border-box; }
.eag-dialog {
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
  --eag-ui: 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', system-ui, -apple-system, sans-serif;
  --eag-read: 'Songti SC', Georgia, 'Times New Roman', serif;

  width: ${POPUP_WIDTH}px;
  max-width: calc(100vw - 24px);
  background: var(--eag-panel);
  color: var(--eag-ink);
  font-family: var(--eag-ui);
  font-size: 13px;
  line-height: 1.45;
  border: 1px solid var(--eag-line);
  border-radius: 14px;
  overflow: hidden;
  box-shadow: 0 18px 50px rgba(20,18,12,.16), 0 2px 8px rgba(20,18,12,.08);
  animation: eag-dlg-in .17s cubic-bezier(.2,.8,.3,1.05) both;
}
@keyframes eag-dlg-in {
  from { opacity: 0; transform: translateY(-6px) scale(.97); }
  to   { opacity: 1; transform: translateY(0) scale(1); }
}

.eag-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 12px 10px;
  cursor: move;
  user-select: none;
}
.eag-badge {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: .1em;
  color: var(--eag-muted);
  background: #f1efe9;
  border: 1px solid var(--eag-line);
  padding: 3px 7px;
  border-radius: 6px;
  text-transform: uppercase;
  flex: none;
}
.eag-title {
  flex: 1;
  min-width: 0;
  font-family: var(--eag-read);
  font-size: 17px;
  font-weight: 600;
  letter-spacing: -.01em;
  color: var(--eag-ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.eag-icon-btn {
  flex: none;
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border: none;
  background: transparent;
  color: var(--eag-faint);
  border-radius: 7px;
  cursor: pointer;
  padding: 0;
  transition: color .12s, background .12s;
}
.eag-icon-btn:hover { color: var(--eag-ink); background: #f3f1eb; }

.eag-dict { padding: 0 12px 12px; }
.eag-ipa-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
  flex-wrap: wrap;
}
.eag-ipa { display: inline-flex; align-items: baseline; gap: 5px; font-size: 13px; color: var(--eag-ink-soft); }
.eag-ipa em {
  font-style: normal;
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: .06em;
  color: var(--eag-faint);
  text-transform: uppercase;
}
.eag-speak {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border-radius: 9px;
  border: 1px solid var(--eag-line);
  background: #faf8f3;
  color: var(--eag-ink);
  cursor: pointer;
  position: relative;
  flex: none;
  padding: 0;
  transition: border-color .12s, background .12s;
}
.eag-speak:hover { border-color: var(--eag-line-2); background: #f4f1ea; }
.eag-speak.eag-on::after {
  content: "";
  position: absolute;
  inset: -4px;
  border-radius: 12px;
  border: 2px solid var(--eag-sel-strong);
  animation: eag-ring 1s ease-out infinite;
  pointer-events: none;
}
@keyframes eag-ring {
  0%   { opacity: .9; transform: scale(.85); }
  100% { opacity: 0;  transform: scale(1.25); }
}

.eag-defs { font-size: 13px; line-height: 1.6; color: var(--eag-ink-soft); }
.eag-defs .eag-def-row { margin-bottom: 3px; }
.eag-defs .eag-pos { color: var(--eag-muted); font-style: italic; margin-right: 6px; }
.eag-defs .eag-en { color: var(--eag-ink); font-family: var(--eag-read); }
.eag-defs .eag-cn { color: var(--eag-ink-soft); }

.eag-tags { display: flex; gap: 6px; margin-top: 8px; flex-wrap: wrap; }
.eag-tag {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: .02em;
  color: var(--eag-sand);
  background: var(--eag-sand-bg);
  border-radius: 6px;
  padding: 3px 7px;
}

.eag-miss {
  padding: 2px 12px 12px;
  font-size: 12.5px;
  color: var(--eag-muted);
  display: flex;
  align-items: center;
  gap: 8px;
}
.eag-est {
  font-size: 10px;
  font-weight: 700;
  color: #a06b1f;
  background: #f7eede;
  border-radius: 6px;
  padding: 2px 7px;
  letter-spacing: .04em;
}

.eag-skeleton {
  padding: 4px 12px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.eag-skel-line {
  height: 12px;
  border-radius: 4px;
  background: linear-gradient(90deg, #f1efe9 0%, #f7f5ee 50%, #f1efe9 100%);
  background-size: 200% 100%;
  animation: eag-shimmer 1.2s linear infinite;
}
.eag-skel-line.eag-w-60 { width: 60%; }
.eag-skel-line.eag-w-80 { width: 80%; }
.eag-skel-line.eag-w-45 { width: 45%; }
@keyframes eag-shimmer {
  from { background-position: 200% 0; }
  to   { background-position: -200% 0; }
}

.eag-divider { height: 1px; background: var(--eag-line); margin: 0 12px; }

.eag-sec-label {
  font-size: 11px;
  color: var(--eag-muted);
  padding: 10px 12px 0;
}

.eag-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
  padding: 8px 12px 12px;
}
.eag-act {
  border: 1px solid var(--eag-line);
  background: #fff;
  border-radius: 10px;
  padding: 7px 11px;
  font-size: 12.5px;
  font-weight: 500;
  color: var(--eag-ink);
  cursor: pointer;
  font-family: var(--eag-ui);
  transition: background .12s, border-color .12s, transform .12s;
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.eag-act:hover { background: #faf8f3; border-color: var(--eag-line-2); transform: translateY(-1px); }
.eag-act:active { transform: translateY(0); }
.eag-act.eag-on { background: var(--eag-ink); color: #fff; border-color: var(--eag-ink); }

.eag-input-row {
  display: flex;
  gap: 7px;
  align-items: center;
  padding: 10px;
  border-top: 1px solid var(--eag-line);
  background: #fcfbf7;
}
.eag-input {
  flex: 1;
  min-width: 0;
  border: 1px solid var(--eag-line);
  border-radius: 9px;
  padding: 7px 10px;
  font-size: 12.5px;
  font-family: var(--eag-ui);
  outline: none;
  background: #fff;
  color: var(--eag-ink);
  transition: border-color .12s;
}
.eag-input::placeholder { color: var(--eag-faint); }
.eag-input:focus { border-color: var(--eag-ink); }
.eag-send {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  background: var(--eag-ink);
  color: #fff;
  border: none;
  border-radius: 9px;
  padding: 7px 11px;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
  font-family: var(--eag-ui);
  transition: background .12s;
  flex: none;
}
.eag-send:hover { background: #26262a; }
`;

const TYPE_BADGE: Record<SelectionContext['selection']['type'], string> = {
  word: 'WORD',
  phrase: 'PHRASE',
  sentence: 'SENTENCE',
  multi: 'PARAGRAPH',
};

// --- 内联 lookup state ---------------------------------------------------

type LookupState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ok'; data: LookupResult }
  | { kind: 'miss' };

/**
 * 词类型选区：popup 一打开就 fetch /api/lookup。命中缓存通常 < 50ms，
 * 即使首次走 LLM 也 < 5s。失败 / 空结果落到 miss 态，仍可继续走 actions。
 *
 * 用 ctx.id 作为依赖 key：同一选区不重复 fetch；新选区自动重置。
 */
function useInlineLookup(ctx: SelectionContext | null): LookupState {
  const [state, setState] = useState<LookupState>({ kind: 'idle' });
  useEffect(() => {
    if (!ctx || ctx.selection.type !== 'word') {
      setState({ kind: 'idle' });
      return;
    }
    let cancelled = false;
    setState({ kind: 'loading' });
    // 用 GET 避免 CORS 预检 —— content-script 的 fetch 走页面 origin，POST + json
    // 会触发 preflight OPTIONS。/api/lookup GET 形态正好是"纯查词、不落 encounter"，
    // 跟 popup 预览语义吻合：真正的 lookup 事件由 sidepanel 在用户决定深入时落库。
    const q = encodeURIComponent(ctx.selection.text);
    fetch(`${BACKEND}/api/lookup?word=${q}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`http ${res.status}`))))
      .then((data: LookupResult) => {
        if (cancelled) return;
        if (!data.partsOfSpeech?.length) {
          setState({ kind: 'miss' });
          return;
        }
        setState({ kind: 'ok', data });
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn('[english-agent] inline lookup failed', err);
        setState({ kind: 'miss' });
      });
    return () => {
      cancelled = true;
    };
  }, [ctx?.id, ctx?.selection.type, ctx?.selection.text]);
  return state;
}

// --- 主组件 --------------------------------------------------------------

export function SelectionPopup() {
  const state = useSyncExternalStore(subscribePopupState, getPopupState, getPopupState);
  const popupRef = useRef<HTMLDivElement>(null);

  /** 正在 SpeechSynthesis 播音的 tag（实质就只可能是 pronunciation） */
  const [speakingTag, setSpeakingTag] = useState<ActionTag | null>(null);

  // 词典 inline 数据
  const lookup = useInlineLookup(state.open ? state.ctx : null);

  // 拖拽：用 anchor 的预估位置初始化，挂载后 useLayoutEffect 用真实高度修正
  const initialLeft = state.anchor?.rect.left ?? 0;
  const initialTop = (state.anchor?.rect.bottom ?? 0) + POPUP_GAP;
  const drag = useDraggable({
    initial: { x: initialLeft, y: initialTop },
    anchor: 'top-left',
  });

  // 每次 popup 打开 / anchor 变化：用真实 popup 高度重算定位
  useLayoutEffect(() => {
    if (!state.open || !state.anchor || !popupRef.current) return;
    const realHeight = popupRef.current.getBoundingClientRect().height;
    const next = computePopupPosition(state.anchor, realHeight);
    drag.setPos({ x: next.left, y: next.top });
    // 故意只 dep anchor —— content 变了不重定位，popup 钉住不动
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.open, state.anchor?.rect.top, state.anchor?.rect.left, state.anchor?.rect.bottom]);

  // dict 区块从 loading 切到 ok 时高度会变 —— 重新对齐到锚点（避免遮选区）
  useLayoutEffect(() => {
    if (!state.open || !state.anchor || !popupRef.current) return;
    if (lookup.kind === 'loading') return;
    const realHeight = popupRef.current.getBoundingClientRect().height;
    const next = computePopupPosition(state.anchor, realHeight);
    drag.setPos({ x: next.left, y: next.top });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lookup.kind]);

  // 切换 ctx 时停掉发音
  useEffect(() => {
    if (speakingTag) {
      window.speechSynthesis?.cancel();
      setSpeakingTag(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.ctx?.id]);

  // 关闭时收尾
  useEffect(() => {
    if (state.open) return;
    if (speakingTag) {
      window.speechSynthesis?.cancel();
      setSpeakingTag(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.open]);

  // 点击外部 / Esc 关闭。popup 在 Shadow DOM 里，document 的 pointerdown
  // 看到的 e.target 是 shadowHost，用 composedPath 才能拿到内层真实目标。
  useEffect(() => {
    if (!state.open) return;
    function onPointerDown(e: PointerEvent) {
      const popup = popupRef.current;
      if (!popup) return;
      const path = e.composedPath();
      if (path.includes(popup)) return;
      closePopup();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') closePopup();
    }
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [state.open]);

  const handleAction = useCallback(
    (tag: ActionTag) => {
      const ctx = state.ctx;
      if (!ctx) return;
      if (tag === 'pronunciation') {
        toggleSpeak(ctx.selection.text, speakingTag, setSpeakingTag);
        return;
      }
      sendAsk({ ctx, actionTag: tag });
      closePopup();
    },
    [state.ctx, speakingTag],
  );

  const handleSpeakDirect = useCallback(() => {
    const ctx = state.ctx;
    if (!ctx) return;
    toggleSpeak(ctx.selection.text, speakingTag, setSpeakingTag);
  }, [state.ctx, speakingTag]);

  const handleDeepChat = useCallback(
    (initialMessage?: string) => {
      const ctx = state.ctx;
      if (!ctx) return;
      sendAsk({ ctx, initialMessage: initialMessage?.trim() || undefined });
      closePopup();
    },
    [state.ctx],
  );

  if (!state.open || !state.ctx || !state.anchor) return null;

  const ctx = state.ctx;
  const actions = actionsForSelectionType(ctx.selection.type);
  const speaking = speakingTag === 'pronunciation';
  const isWord = ctx.selection.type === 'word';

  return (
    <>
      <style>{DIALOG_CSS}</style>
      <div
        ref={popupRef}
        className="eag-dialog"
        onMouseDown={(e) => {
          e.stopPropagation();
        }}
        style={{
          position: 'fixed',
          ...drag.positionStyle(),
        }}
      >
        <div
          className="eag-head"
          onMouseDown={drag.onMouseDown}
        >
          <span className="eag-badge">{TYPE_BADGE[ctx.selection.type]}</span>
          <span className="eag-title" title={ctx.selection.text}>{ctx.selection.text}</span>
          <button
            type="button"
            className="eag-icon-btn"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              if (drag.consumeDragClick()) {
                e.preventDefault();
                return;
              }
              closePopup();
            }}
            aria-label="Close"
          >
            <X size={14} />
          </button>
        </div>

        {/* 词典区块：仅 word 类型有 */}
        {isWord && lookup.kind === 'loading' && (
          <div className="eag-skeleton">
            <div className="eag-skel-line eag-w-60" />
            <div className="eag-skel-line eag-w-80" />
            <div className="eag-skel-line eag-w-45" />
          </div>
        )}

        {isWord && lookup.kind === 'ok' && (
          <DictBlock
            data={lookup.data}
            speaking={speaking}
            onSpeak={handleSpeakDirect}
          />
        )}

        {isWord && lookup.kind === 'miss' && (
          <div className="eag-miss">
            <span className="eag-est">词典未命中</span>
            <span>音标 / 释义将走 LLM 兜底。</span>
            <button
              type="button"
              className={'eag-speak' + (speaking ? ' eag-on' : '')}
              onClick={handleSpeakDirect}
              aria-label="发音"
              style={{ marginLeft: 'auto' }}
            >
              <Volume2 size={14} />
            </button>
          </div>
        )}

        <div className="eag-divider" />
        <div className="eag-sec-label">
          {isWord ? '结合本句继续 →' : '这段选区可以 →'}
        </div>
        <div className="eag-actions">
          {actions.map((a) => {
            const active = a.tag === speakingTag;
            const isSpeak = a.tag === 'pronunciation';
            // word 类型若已经把发音放进 dict / miss 区块里了，actions 里就别重复
            if (isSpeak && isWord && (lookup.kind === 'ok' || lookup.kind === 'miss')) return null;
            return (
              <button
                key={a.tag}
                type="button"
                className={'eag-act' + (active ? ' eag-on' : '')}
                onClick={() => handleAction(a.tag)}
                aria-label={a.label}
                aria-pressed={active}
              >
                {isSpeak && <Volume2 size={11} />}
                {a.label}
              </button>
            );
          })}
        </div>

        <Footer onDeepChat={handleDeepChat} />
      </div>
    </>
  );
}

function DictBlock({
  data,
  speaking,
  onSpeak,
}: {
  data: LookupResult;
  speaking: boolean;
  onSpeak: () => void;
}) {
  const us = data.ipa?.us;
  const uk = data.ipa?.uk;
  // 取第一个 pos 的前 2 个定义 —— popup 是轻量入口，不展开全部释义
  const firstPos = data.partsOfSpeech[0];
  const defs = firstPos?.definitions.slice(0, 2) ?? [];
  return (
    <div className="eag-dict">
      {(us || uk) && (
        <div className="eag-ipa-row">
          {us && (
            <span className="eag-ipa">
              <em>US</em>
              {us}
            </span>
          )}
          {uk && (
            <span className="eag-ipa">
              <em>UK</em>
              {uk}
            </span>
          )}
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
        </div>
      )}
      <div className="eag-defs">
        {defs.map((d, i) => (
          <div key={i} className="eag-def-row">
            {i === 0 && firstPos && <span className="eag-pos">{firstPos.pos}</span>}
            {d.cn ? <span className="eag-cn">{d.cn}</span> : <span className="eag-en">{d.definition}</span>}
          </div>
        ))}
      </div>
      {data.estimated && (
        <div className="eag-tags">
          <span className="eag-tag">估计</span>
        </div>
      )}
    </div>
  );
}

function Footer({ onDeepChat }: { onDeepChat: (initialMessage?: string) => void }) {
  const [text, setText] = useState('');
  return (
    <div className="eag-input-row">
      <input
        type="text"
        className="eag-input"
        placeholder="自由提问…"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            onDeepChat(text);
          }
        }}
      />
      <button
        type="button"
        className="eag-send"
        onClick={() => onDeepChat(text)}
      >
        <MessageSquare size={12} />
        深聊
      </button>
    </div>
  );
}

/**
 * 发音 Tier 0 —— window.speechSynthesis 直接发声。
 * 已在播 → 再点 = 停止。Tier 1 真人音频留给 sidepanel WordCard 提供。
 */
function toggleSpeak(
  text: string,
  speakingTag: ActionTag | null,
  setSpeakingTag: (tag: ActionTag | null) => void,
): void {
  const synth = window.speechSynthesis;
  if (!synth) {
    console.warn('[english-agent] speechSynthesis unavailable');
    return;
  }
  if (speakingTag === 'pronunciation') {
    synth.cancel();
    setSpeakingTag(null);
    return;
  }
  synth.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  const voices = synth.getVoices();
  const enVoice =
    voices.find((v) => v.lang === 'en-US') ??
    voices.find((v) => v.lang === 'en-GB') ??
    voices.find((v) => v.lang.startsWith('en'));
  if (enVoice) utter.voice = enVoice;
  utter.lang = enVoice?.lang ?? 'en-US';
  utter.onend = () => setSpeakingTag(null);
  utter.onerror = () => setSpeakingTag(null);
  setSpeakingTag('pronunciation');
  synth.speak(utter);
}

/**
 * 计算 popup 在 viewport 坐标里的 left / top。
 * 用真实 popup 高度判断"下方装不装得下"，避免按预估值误判翻到上方。
 */
function computePopupPosition(
  anchor: PopupAnchor,
  popupHeight: number,
): { left: number; top: number } {
  const viewportW = window.innerWidth;
  const viewportH = window.innerHeight;

  let left = anchor.rect.left;
  let top = anchor.rect.bottom + POPUP_GAP;

  if (left + POPUP_WIDTH > viewportW - POPUP_MARGIN) {
    left = viewportW - POPUP_WIDTH - POPUP_MARGIN;
  }
  if (left < POPUP_MARGIN) left = POPUP_MARGIN;

  if (top + popupHeight > viewportH - POPUP_MARGIN) {
    top = anchor.rect.top - popupHeight - POPUP_GAP;
    if (top < POPUP_MARGIN) top = POPUP_MARGIN;
  }

  return { left, top };
}
