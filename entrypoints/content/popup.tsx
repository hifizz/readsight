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

/** popup 锚定位置 —— pill 点击时计算，传进来定位 popup */
interface PopupAnchor {
  /** 选区在 document 坐标系下的 bounding rect */
  rect: { top: number; left: number; right: number; bottom: number };
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

  // 点击外部 / Esc 关闭。注意：必须用 pointerdown 而不是 click —— click 在
  // 拖选时不触发，pointerdown 是用户开始新交互的最早信号。
  useEffect(() => {
    if (!state.open) return;
    function onPointerDown(e: PointerEvent) {
      const target = e.target as Node;
      if (popupRef.current && !popupRef.current.contains(target)) {
        closePopup();
      }
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
  const { left, bottom } = positionPopup(state.anchor);

  return (
    <div
      ref={popupRef}
      // 阻止 mousedown 把页面选区抹掉（点 popup 不应消除当前选区）
      onMouseDown={(e) => {
        e.stopPropagation();
      }}
      style={{
        position: 'absolute',
        top: bottom,
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
 * 简单定位：选区右下 8px 偏移；popup 自身宽 360；超视口右侧时贴右；
 * 超视口下方时翻到选区上方。后续可换更精细的算法（PRD §2 说用户有成熟实现）。
 */
function positionPopup(anchor: PopupAnchor): { left: number; bottom: number } {
  const popupWidth = 360;
  const popupMaxHeight = 360;
  const gap = 8;
  // anchor.rect 已经是 document 坐标系（scrollX/Y 加过）
  let left = anchor.rect.left;
  let bottom = anchor.rect.bottom + gap;

  // 横向越界 → 贴右
  const docWidth = document.documentElement.clientWidth;
  if (left + popupWidth > window.scrollX + docWidth - 20) {
    left = window.scrollX + docWidth - popupWidth - 20;
  }
  if (left < window.scrollX + 20) left = window.scrollX + 20;

  // 纵向越界（弹下方装不下） → 翻到选区上方
  const docHeight = document.documentElement.clientHeight;
  if (bottom + popupMaxHeight > window.scrollY + docHeight) {
    bottom = anchor.rect.top - popupMaxHeight - gap;
    if (bottom < window.scrollY + 20) bottom = window.scrollY + 20;
  }

  return { left, bottom };
}
