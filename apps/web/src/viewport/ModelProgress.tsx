import type { DocumentStore, ModelStore } from '@extrudo/core';
import { useEffect, useState } from 'react';
import { useStore } from 'zustand';
import {
  activeFeatureCount,
  progressDetail,
  progressMode,
  progressTitle,
  UPDATING_AFTER_MS,
} from './progressRules';

/**
 * A recompute has finished since the model store was last reset (ADR-0078).
 * `computed` always carries the document it computed, which `reset` clears.
 */
export function useRecomputeFinished(model: ModelStore<unknown>): boolean {
  return useStore(model, (s) => s.doc !== undefined || s.stats !== undefined);
}

/** A small cube whose three faces fill in turn; still under reduced motion (theme.css). */
export function ProgressCube({ size = 20 }: { size?: number }) {
  return (
    <svg
      aria-hidden
      data-progress-icon
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className="shrink-0 text-accent"
    >
      <path className="x-cube-face x-cube-top" d="M12 2 21 7 12 12 3 7Z" fill="currentColor" />
      <path className="x-cube-face x-cube-left" d="M3 7 12 12V22L3 17Z" fill="currentColor" />
      <path className="x-cube-face x-cube-right" d="M12 12 21 7V17L12 22Z" fill="currentColor" />
    </svg>
  );
}

/**
 * The notice at the view's top left while the design is being prepared or a
 * long recompute runs (ADR-0078). It never takes pointer events, so it can't
 * block a pick; a failed kernel keeps its own message (the status bar's).
 */
export function ModelProgress({
  model,
  store,
  collapsed,
}: {
  model: ModelStore<unknown>;
  store: DocumentStore;
  /** The browser is folded away: its "Show browser" tab then sits at the view's corner. */
  collapsed: boolean;
}) {
  const status = useStore(model, (s) => s.status);
  const finished = useRecomputeFinished(model);
  const doc = useStore(store, (s) => s.doc);
  const running = status === 'idle' || status === 'computing';
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    setElapsed(0);
    if (!running) return;
    const timer = setTimeout(() => setElapsed(UPDATING_AFTER_MS + 1), UPDATING_AFTER_MS);
    return () => clearTimeout(timer);
  }, [running]);
  const mode = progressMode({ status, finished, elapsed });
  if (!mode) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      data-model-progress={mode}
      className="pointer-events-none absolute top-3 z-10 flex items-center gap-2.5 rounded-control border border-line bg-panel px-3 py-2 shadow-raised"
      style={{ left: `calc(var(--x-browser-inset, 0px) + ${collapsed ? 52 : 12}px)` }}
    >
      <ProgressCube />
      <div className="flex flex-col leading-tight">
        <span className="text-sm font-medium text-ink">{progressTitle(mode)}</span>
        <span className="text-xs text-muted">{progressDetail(activeFeatureCount(doc))}</span>
      </div>
    </div>
  );
}
