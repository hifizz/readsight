/**
 * 通用拖拽 hook —— FAB / 划词 popup 共用。
 *
 * 调用方负责：
 *   - 把 onMouseDown 挂在 drag handle 上（FAB 整个按钮 / popup header）
 *   - onClick 第一行用 consumeDragClick() 吞掉"刚拖完那一次"的 click
 *
 * 抽象动机：FAB 原本就有这套逻辑（threshold + wasDragged 跨 mouseup→click 边界），
 * 划词 popup 拖动需要完全一样的语义，与其复制不如抽出来。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type React from 'react';

export type DragAnchor = 'top-left' | 'bottom-right';

export interface DragPos {
  /** anchor='top-left' 时是 left；anchor='bottom-right' 时是 right */
  x: number;
  /** anchor='top-left' 时是 top；anchor='bottom-right' 时是 bottom */
  y: number;
}

interface UseDraggableOptions {
  /** 初始位置；caller 可以再用 setPos 改 */
  initial: DragPos;
  anchor: DragAnchor;
  /** 给 chrome.storage.local 用的 key；不传则不持久化 */
  persistKey?: string;
  /** 移动多少 px 才算拖拽（小于则当 click），默认 5 */
  thresholdPx?: number;
}

export interface UseDraggable {
  pos: DragPos;
  setPos: React.Dispatch<React.SetStateAction<DragPos>>;
  /** 挂在拖拽 handle 的 onMouseDown */
  onMouseDown: (e: React.MouseEvent) => void;
  /** 在 onClick 第一行调；true = 这次 click 是"刚拖完"的副作用，请吞掉 */
  consumeDragClick: () => boolean;
  /** 拼到 style 里：bottom-right → {right,bottom}，top-left → {left,top} */
  positionStyle: () => Record<string, number>;
}

const DEFAULT_THRESHOLD = 5;

export function useDraggable(opts: UseDraggableOptions): UseDraggable {
  const { initial, anchor, persistKey, thresholdPx = DEFAULT_THRESHOLD } = opts;
  const [pos, setPos] = useState<DragPos>(initial);
  // 拖拽中的临时状态（不进 state，避免每次 mousemove 重渲染父）
  const dragRef = useRef<{
    startMouseX: number;
    startMouseY: number;
    startPosX: number;
    startPosY: number;
    moved: boolean;
  } | null>(null);
  /**
   * mouseup 在 dragRef null 之前把"刚拖过"标记到这里 —— 紧随的 click
   * 才能跨过 mouseup 边界读到它。
   */
  const wasDraggedRef = useRef(false);

  // 启动时读持久化位置
  useEffect(() => {
    if (!persistKey) return;
    chrome.storage.local
      .get(persistKey)
      .then((res) => {
        const saved = res[persistKey] as DragPos | undefined;
        if (saved && typeof saved.x === 'number' && typeof saved.y === 'number') {
          setPos(saved);
        }
      })
      .catch(() => {});
  }, [persistKey]);

  useEffect(() => {
    function onMove(e: MouseEvent) {
      const drag = dragRef.current;
      if (!drag) return;
      const dx = e.clientX - drag.startMouseX;
      const dy = e.clientY - drag.startMouseY;
      if (!drag.moved && Math.hypot(dx, dy) < thresholdPx) return;
      drag.moved = true;
      // bottom-right 锚：鼠标右移 → right 应减小；top-left：鼠标右移 → left 增大
      const sign = anchor === 'bottom-right' ? -1 : 1;
      setPos({
        x: Math.max(0, drag.startPosX + sign * dx),
        y: Math.max(0, drag.startPosY + sign * dy),
      });
    }
    function onUp() {
      const drag = dragRef.current;
      if (!drag) return;
      dragRef.current = null;
      if (!drag.moved) return;
      wasDraggedRef.current = true;
      if (persistKey) {
        // 用 functional setPos 拿到最新值，避免 stale closure
        setPos((current) => {
          chrome.storage.local.set({ [persistKey]: current }).catch(() => {});
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
  }, [anchor, thresholdPx, persistKey]);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      // 新一次 mousedown：清掉上次可能没被消费的拖拽标记
      // （比如鼠标拖出 handle 外松手，click 没派发到我们身上）
      wasDraggedRef.current = false;
      dragRef.current = {
        startMouseX: e.clientX,
        startMouseY: e.clientY,
        startPosX: pos.x,
        startPosY: pos.y,
        moved: false,
      };
    },
    [pos.x, pos.y],
  );

  const consumeDragClick = useCallback((): boolean => {
    if (wasDraggedRef.current) {
      wasDraggedRef.current = false;
      return true;
    }
    return false;
  }, []);

  const positionStyle = useCallback((): Record<string, number> => {
    return anchor === 'bottom-right'
      ? { right: pos.x, bottom: pos.y }
      : { left: pos.x, top: pos.y };
  }, [anchor, pos.x, pos.y]);

  return { pos, setPos, onMouseDown, consumeDragClick, positionStyle };
}
