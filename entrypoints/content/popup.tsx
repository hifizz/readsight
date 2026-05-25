/**
 * 划词轻路径 popup（PRD §7.2 / §8.1）—— launcher 版。
 *
 * 用户决策：popup 只做"触发器"，所有实际对话发生在 sidepanel。
 *   - 4 个 actionTag 按钮 → ASK_WITH_SELECTION { ctx, actionTag } →
 *     sidepanel 自动替用户发对应消息
 *   - 深聊按钮 / Enter → ASK_WITH_SELECTION { ctx, initialMessage? } →
 *     sidepanel 打开等用户输入（带 input 文字就自动发）
 *   - 发音按钮特殊：Tier 0 = window.speechSynthesis 直发，不开 sidepanel
 *     （音频播放不打断阅读，无需进侧边栏）
 *
 * 不在本文件做：
 *   - 内联流式渲染（之前 phase B 加过又删，转移到 sidepanel）
 *   - 历史搬迁（PRD §7.2 重路径）—— 现在所有对话都在 sidepanel，没有"popup 已有轮次"
 *
 * 拖拽 / 定位：复用 lib/use-draggable + useLayoutEffect 测真实高度
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { X, MessageSquare, Volume2 } from 'lucide-react';
import type {
  ActionTag,
  AskWithSelectionPayload,
  BackgroundMessage,
  SelectionContext,
} from '@/lib/messaging';
import { actionsForSelectionType } from '@/lib/action-tags';
import { useDraggable } from '@/lib/use-draggable';

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

// --- 组件 ----------------------------------------------------------------

const POPUP_WIDTH = 320;
const POPUP_GAP = 8;
const POPUP_MARGIN = 12;

export function SelectionPopup() {
  const state = useSyncExternalStore(subscribePopupState, getPopupState, getPopupState);
  const popupRef = useRef<HTMLDivElement>(null);

  /** 正在 SpeechSynthesis 播音的 tag（实质就只可能是 pronunciation） */
  const [speakingTag, setSpeakingTag] = useState<ActionTag | null>(null);

  // 拖拽：用 anchor 的预估位置初始化，挂载后 useLayoutEffect 用真实高度修正
  const initialLeft = state.anchor?.rect.left ?? 0;
  const initialTop = (state.anchor?.rect.bottom ?? 0) + POPUP_GAP;
  const drag = useDraggable({
    initial: { x: initialLeft, y: initialTop },
    anchor: 'top-left',
  });

  // 每次 popup 打开 / anchor 变化：用真实 popup 高度重算定位
  // 关键 fix：原来用 popupMaxHeight=360 判断翻不翻到上方，实际 popup 远不到那么高，
  // 翻上方时算出来的 top 比正确位置高一大截 → "上飘"
  useLayoutEffect(() => {
    if (!state.open || !state.anchor || !popupRef.current) return;
    const realHeight = popupRef.current.getBoundingClientRect().height;
    const next = computePopupPosition(state.anchor, realHeight);
    drag.setPos({ x: next.left, y: next.top });
    // 故意只 dep anchor —— content 变了不重定位，popup 钉住不动
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.open, state.anchor?.rect.top, state.anchor?.rect.left, state.anchor?.rect.bottom]);

  // 切换 ctx 时停掉发音（不同选区的快查不该混）
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
      // 发音 = Tier 0 走浏览器 TTS，不开 sidepanel
      if (tag === 'pronunciation') {
        toggleSpeak(ctx.selection.text, speakingTag, setSpeakingTag);
        return;
      }
      sendAsk({ ctx, actionTag: tag });
      closePopup();
    },
    [state.ctx, speakingTag],
  );

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

  const actions = actionsForSelectionType(state.ctx.selection.type);

  return (
    <div
      ref={popupRef}
      onMouseDown={(e) => {
        e.stopPropagation();
      }}
      style={{
        position: 'fixed',
        ...drag.positionStyle(),
        width: POPUP_WIDTH,
        maxWidth: 'calc(100vw - 40px)',
        background: '#fff',
        color: '#111',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: 13,
        lineHeight: 1.45,
        border: '1px solid rgba(0,0,0,0.08)',
        borderRadius: 10,
        boxShadow: '0 12px 40px rgba(0,0,0,0.18)',
        overflow: 'hidden',
      }}
    >
      <Header
        ctx={state.ctx}
        onClose={closePopup}
        dragMouseDown={drag.onMouseDown}
        consumeDragClick={drag.consumeDragClick}
      />
      <Buttons actions={actions} speakingTag={speakingTag} onPick={handleAction} />
      <Footer onDeepChat={handleDeepChat} />
    </div>
  );
}

function Header({
  ctx,
  onClose,
  dragMouseDown,
  consumeDragClick,
}: {
  ctx: SelectionContext;
  onClose: () => void;
  dragMouseDown: (e: React.MouseEvent) => void;
  consumeDragClick: () => boolean;
}) {
  return (
    <div
      onMouseDown={dragMouseDown}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 10px',
        borderBottom: '1px solid rgba(0,0,0,0.06)',
        background: 'rgba(0,0,0,0.02)',
        cursor: 'move',
        userSelect: 'none',
      }}
    >
      <span
        style={{
          padding: '2px 6px',
          background: 'rgba(0,0,0,0.06)',
          color: '#111',
          fontSize: 11,
          borderRadius: 4,
          textTransform: 'uppercase',
          letterSpacing: 0.5,
        }}
      >
        {ctx.selection.type}
      </span>
      <span
        style={{
          flex: 1,
          minWidth: 0,
          fontWeight: 600,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {ctx.selection.text}
      </span>
      <button
        type="button"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          if (consumeDragClick()) {
            e.preventDefault();
            return;
          }
          onClose();
        }}
        aria-label="Close"
        style={{
          width: 24,
          height: 24,
          padding: 0,
          background: 'transparent',
          border: 0,
          cursor: 'pointer',
          color: '#666',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <X size={14} />
      </button>
    </div>
  );
}

function Buttons({
  actions,
  speakingTag,
  onPick,
}: {
  actions: { tag: ActionTag; label: string }[];
  speakingTag: ActionTag | null;
  onPick: (tag: ActionTag) => void;
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 6,
        padding: 10,
      }}
    >
      {actions.map((a) => {
        const active = a.tag === speakingTag;
        const isSpeak = a.tag === 'pronunciation';
        return (
          <button
            key={a.tag}
            type="button"
            onClick={() => onPick(a.tag)}
            aria-label={a.label}
            aria-pressed={active}
            style={{
              padding: '5px 10px',
              background: active ? '#111' : 'rgba(0,0,0,0.04)',
              color: active ? '#fff' : '#111',
              border: '1px solid ' + (active ? '#111' : 'rgba(0,0,0,0.08)'),
              borderRadius: 14,
              cursor: 'pointer',
              fontSize: 12,
              fontFamily: 'inherit',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              transition: 'background 0.1s, color 0.1s',
            }}
          >
            {isSpeak && <Volume2 size={11} />}
            {a.label}
          </button>
        );
      })}
    </div>
  );
}

function Footer({ onDeepChat }: { onDeepChat: (initialMessage?: string) => void }) {
  const [text, setText] = useState('');
  return (
    <div
      style={{
        display: 'flex',
        gap: 6,
        padding: 8,
        borderTop: '1px solid rgba(0,0,0,0.06)',
        background: 'rgba(0,0,0,0.02)',
      }}
    >
      <input
        type="text"
        placeholder="自由提问…"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            onDeepChat(text);
          }
        }}
        style={{
          flex: 1,
          minWidth: 0,
          padding: '6px 10px',
          background: '#fff',
          color: '#111',
          border: '1px solid rgba(0,0,0,0.1)',
          borderRadius: 6,
          fontSize: 12,
          fontFamily: 'inherit',
        }}
      />
      <button
        type="button"
        onClick={() => onDeepChat(text)}
        style={{
          padding: '5px 10px',
          background: '#111',
          color: '#fff',
          border: 0,
          borderRadius: 6,
          cursor: 'pointer',
          fontSize: 12,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          fontFamily: 'inherit',
        }}
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
