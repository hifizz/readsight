/**
 * 划词轻路径 popup（PRD §8.1）—— Phase 1 外壳。
 *
 * 当前实现的只是结构 + 状态机：
 *   - 选区类型分支按钮组渲染（4 个 / 类型）
 *   - 即时结果区占位
 *   - 输入框 + 深聊按钮占位
 *   - 模块级 popupState：openPopup(ctx, anchor) / closePopup() / 订阅
 *
 * 还没接的（Phase 2-4）：
 *   - 按钮点击 → `/api/chat` with actionTag → 流式渲染结果
 *   - 发音按钮 → 复用 WordCard 数据路径
 *   - 深聊按钮 → 把 popup 已聊轮次迁移到 sidepanel
 *
 * 触发方式：保留 pill（用户决策），点 pill 调 openPopup() 弹出。
 */
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { X, MessageSquare } from 'lucide-react';
import type { SelectionContext } from '@/lib/messaging';

/** popup 锚定位置 —— pill 点击时计算，传进来定位 popup。
 *  使用 viewport 坐标系（即 getBoundingClientRect 原始值），不加 scrollX/Y，
 *  因为 popup 用 `position: fixed` 渲染。 */
interface PopupAnchor {
  /** 选区在 viewport 坐标系下的 bounding rect */
  rect: { top: number; left: number; right: number; bottom: number };
}

/** 给外部（pill 等组件）订阅 popup 状态用，便于在 popup 打开时隐藏自己 */
export function useIsPopupOpen(): boolean {
  return useSyncExternalStore(
    subscribePopupState,
    () => popupState.open,
    () => popupState.open,
  );
}

interface PopupState {
  /** popup 是否打开 */
  open: boolean;
  /** 当前选区 */
  ctx: SelectionContext | null;
  /** 定位锚 */
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

/** pill 点击调用 —— 用户决策保留的"两步发现" trigger */
export function openPopup(ctx: SelectionContext, anchor: PopupAnchor): void {
  setPopupState({ open: true, ctx, anchor });
}

export function closePopup(): void {
  setPopupState({ open: false, ctx: null, anchor: null });
}

// --- 按选区类型决定按钮集（PRD §8.1） ---------------------------------------
//
// 后端将来按 actionTag 切换 system prompt（PRD §9 chat 接口已规划）

export type ActionTag =
  | 'meaning'       // 词义
  | 'pronunciation' // 音标 / 发音（走 WordCard 数据路径）
  | 'sentence-translate' // 本句译法
  | 'usage'         // 用法搭配
  | 'translate'     // 翻句
  | 'grammar'       // 析语法
  | 'rewrite'       // 改写地道说法
  | 'hard-parts';   // 难点定位

interface ActionDef {
  tag: ActionTag;
  label: string;
}

function actionsForSelectionType(t: SelectionContext['selection']['type']): ActionDef[] {
  if (t === 'word' || t === 'phrase') {
    return [
      { tag: 'meaning', label: '词义' },
      { tag: 'pronunciation', label: '发音' },
      { tag: 'sentence-translate', label: '本句译法' },
      { tag: 'usage', label: '用法搭配' },
    ];
  }
  // sentence / multi
  return [
    { tag: 'translate', label: '翻句' },
    { tag: 'grammar', label: '析语法' },
    { tag: 'rewrite', label: '改写地道说法' },
    { tag: 'hard-parts', label: '难点定位' },
  ];
}

// --- 组件 ----------------------------------------------------------------

export function SelectionPopup() {
  const state = useSyncExternalStore(subscribePopupState, getPopupState, getPopupState);
  const popupRef = useRef<HTMLDivElement>(null);

  // 点击外部 / Esc 关闭。关键：popup 在 Shadow DOM 里，document 收到 pointerdown
  // 时 e.target 被 retarget 成 shadowHost；用 composedPath() 才能拿到 shadow 内
  // 的真实目标节点。
  useEffect(() => {
    if (!state.open) return;
    function onPointerDown(e: PointerEvent) {
      const popup = popupRef.current;
      if (!popup) return;
      // composedPath 会列出 shadow root 内层 → 外层，包含真实点击目标
      const path = e.composedPath();
      if (path.includes(popup)) return; // 点在 popup 内部，忽略
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

  if (!state.open || !state.ctx || !state.anchor) return null;

  const actions = actionsForSelectionType(state.ctx.selection.type);
  const { left, top } = positionPopup(state.anchor);

  return (
    <div
      ref={popupRef}
      // 阻止 mousedown 把页面选区抹掉（点 popup 不应消除当前选区）
      onMouseDown={(e) => {
        e.stopPropagation();
      }}
      style={{
        // 用 fixed + viewport 坐标：跟 WXT shadowHost 在 body 流里的位置脱钩，
        // 也不需要 scrollX/Y 计算。代价是 popup 不跟着选区滚（acceptable）
        position: 'fixed',
        top,
        left,
        width: 360,
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
      <Header ctx={state.ctx} onClose={closePopup} />
      <Buttons actions={actions} />
      <ResultArea />
      <Footer />
    </div>
  );
}

function Header({ ctx, onClose }: { ctx: SelectionContext; onClose: () => void }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 10px',
        borderBottom: '1px solid rgba(0,0,0,0.06)',
        background: 'rgba(0,0,0,0.02)',
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
        onClick={onClose}
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

function Buttons({ actions }: { actions: ActionDef[] }) {
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 6,
        padding: 10,
        borderBottom: '1px solid rgba(0,0,0,0.06)',
      }}
    >
      {actions.map((a) => (
        <button
          key={a.tag}
          type="button"
          // Phase 2 接 LLM；现在只占位
          onClick={() => console.log('[english-agent] action TODO:', a.tag)}
          style={{
            padding: '5px 10px',
            background: 'rgba(0,0,0,0.04)',
            border: '1px solid rgba(0,0,0,0.08)',
            borderRadius: 14,
            cursor: 'pointer',
            fontSize: 12,
            color: '#111',
            fontFamily: 'inherit',
          }}
        >
          {a.label}
        </button>
      ))}
    </div>
  );
}

function ResultArea() {
  // Phase 2 渲染流式答案；现在占位
  return (
    <div
      style={{
        padding: '12px 12px',
        minHeight: 60,
        maxHeight: 240,
        overflowY: 'auto',
        color: '#666',
        fontSize: 12,
      }}
    >
      点上方按钮快速查询，或在下方输入框深聊
    </div>
  );
}

function Footer() {
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
        // Phase 4 接 LLM + 深聊迁移；现在占位
        disabled
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
          opacity: 0.6,
        }}
      />
      <button
        type="button"
        // Phase 4 接深聊
        onClick={() => console.log('[english-agent] deep chat TODO')}
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
 * 简单定位（viewport 坐标）：选区下方 8px 偏移；popup 宽 360；
 * 超 viewport 右侧 → 贴右；下方装不下 → 翻到选区上方。
 */
function positionPopup(anchor: PopupAnchor): { left: number; top: number } {
  const popupWidth = 360;
  const popupMaxHeight = 360;
  const gap = 8;
  const margin = 12;
  const viewportW = window.innerWidth;
  const viewportH = window.innerHeight;

  let left = anchor.rect.left;
  let top = anchor.rect.bottom + gap;

  // 横向：贴右防越界
  if (left + popupWidth > viewportW - margin) left = viewportW - popupWidth - margin;
  if (left < margin) left = margin;

  // 纵向：下方装不下 → 翻到选区上方
  if (top + popupMaxHeight > viewportH - margin) {
    top = anchor.rect.top - popupMaxHeight - gap;
    if (top < margin) top = margin;
  }

  return { left, top };
}
