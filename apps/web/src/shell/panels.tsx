import { type KeyboardEvent, type PointerEvent, useCallback, useRef, useState } from 'react';
import type { Preferences } from '../platform';

export interface PanelState {
  size: number;
  collapsed: boolean;
}

export interface PanelOptions {
  /** Preferences key; size and collapsed state survive a reload. */
  key: string;
  size: number;
  min: number;
  max: number;
}

/** Size and collapsed state of a panel, clamped and kept in preferences. */
export function usePanel(preferences: Preferences, { key, size, min, max }: PanelOptions) {
  const clamp = useCallback((n: number) => Math.round(Math.min(max, Math.max(min, n))), [min, max]);
  const [state, setState] = useState<PanelState>(() => {
    const stored = preferences.get<Partial<PanelState>>(`panel.${key}`, {});
    return {
      size: clamp(typeof stored.size === 'number' ? stored.size : size),
      collapsed: stored.collapsed === true,
    };
  });
  // Collapsing and expanding animate; dragging and keyboard resizing follow at once.
  const [animate, setAnimate] = useState(false);
  const update = useCallback(
    (change: Partial<PanelState>) =>
      setState((current) => {
        const next = { ...current, ...change };
        next.size = clamp(next.size);
        preferences.set(`panel.${key}`, next);
        return next;
      }),
    [clamp, key, preferences],
  );
  return {
    ...state,
    min,
    max,
    animate,
    resize: (next: number) => {
      setAnimate(false);
      update({ size: next, collapsed: false });
    },
    toggle: () => {
      setAnimate(true);
      update({ collapsed: !state.collapsed });
    },
    setCollapsed: (collapsed: boolean) => {
      setAnimate(true);
      update({ collapsed });
    },
  };
}

export interface SplitterProps {
  /** Accessible name: "Resize browser". */
  label: string;
  /** ID of the panel it resizes. */
  controls: string;
  size: number;
  min: number;
  max: number;
  collapsed: boolean;
  onResize(size: number): void;
  onToggle(): void;
}

const STEP = 16;

/**
 * A vertical splitter for a panel on its left (WAI-ARIA window splitter):
 * drag, or focus it and use ← → (Shift for bigger steps), Home, End, and
 * Enter or double-click to collapse and expand.
 */
export function Splitter({
  label,
  controls,
  size,
  min,
  max,
  collapsed,
  onResize,
  onToggle,
}: SplitterProps) {
  const drag = useRef<{ x: number; size: number } | null>(null);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, size: collapsed ? min : size };
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    onResize(drag.current.size + event.clientX - drag.current.x);
  };
  const onPointerUp = () => {
    drag.current = null;
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? STEP * 4 : STEP;
    const actions: Record<string, () => void> = {
      ArrowLeft: () => onResize(size - step),
      ArrowRight: () => onResize(size + step),
      Home: () => onResize(min),
      End: () => onResize(max),
      Enter: onToggle,
    };
    const action = actions[event.key];
    if (action) {
      event.preventDefault();
      action();
    }
  };

  return (
    // biome-ignore lint/a11y/useSemanticElements: <hr> can't be focused or dragged; this is the ARIA window-splitter pattern.
    <div
      role="separator"
      aria-label={label}
      aria-controls={controls}
      aria-orientation="vertical"
      aria-valuenow={collapsed ? min : size}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      className="group relative z-10 -mx-1 w-2 shrink-0 cursor-col-resize touch-none outline-none"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onToggle}
      onKeyDown={onKeyDown}
    >
      <div className="mx-auto h-full w-px bg-line transition-colors group-hover:w-0.5 group-hover:bg-accent group-focus-visible:w-0.5 group-focus-visible:bg-accent" />
    </div>
  );
}
