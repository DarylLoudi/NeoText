import { type KeyboardEvent, type PointerEvent, useRef } from 'react';
import { useT } from '../../lib/i18n';
import styles from './SidebarResizer.module.css';

export const MIN_SIDEBAR_WIDTH = 240;
export const MAX_SIDEBAR_WIDTH = 420;
const STEP = 16;

export function clampWidth(width: number): number {
  return Math.round(Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, width)));
}

export interface SidebarResizerProps {
  width: number;
  /** Which side of the window the sidebar is on; the handle sits on its inner edge. */
  side: 'left' | 'right';
  /** Live width while dragging or pressing keys. */
  onResize: (width: number) => void;
  /** The width to keep, on pointer or key release. */
  onCommit: (width: number) => void;
}

const KEYS = new Set(['ArrowLeft', 'ArrowRight', 'Home', 'End']);

export function SidebarResizer({ width, side, onResize, onCommit }: SidebarResizerProps) {
  const t = useT();
  const latest = useRef(width);
  latest.current = width;
  const drag = useRef<{ x: number; width: number } | null>(null);
  const grow = side === 'left' ? 1 : -1;

  const resize = (next: number) => {
    const w = clampWidth(next);
    latest.current = w;
    onResize(w);
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drag.current = { x: e.clientX, width: latest.current };
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    resize(drag.current.width + (e.clientX - drag.current.x) * grow);
  };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    drag.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    onCommit(latest.current);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!KEYS.has(e.key)) return;
    e.preventDefault();
    if (e.key === 'Home') resize(MIN_SIDEBAR_WIDTH);
    else if (e.key === 'End') resize(MAX_SIDEBAR_WIDTH);
    else resize(latest.current + (e.key === 'ArrowRight' ? STEP : -STEP) * grow);
  };
  const onKeyUp = (e: KeyboardEvent<HTMLDivElement>) => {
    if (KEYS.has(e.key)) onCommit(latest.current);
  };

  return (
    // biome-ignore lint/a11y/useSemanticElements: a focusable window splitter has no HTML element; the ARIA separator pattern is the standard
    <div
      role="separator"
      tabIndex={0}
      aria-label={t('sidebar.resize')}
      aria-orientation="vertical"
      aria-valuenow={width}
      aria-valuemin={MIN_SIDEBAR_WIDTH}
      aria-valuemax={MAX_SIDEBAR_WIDTH}
      className={styles.handle}
      data-side={side}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
      onKeyUp={onKeyUp}
    />
  );
}
