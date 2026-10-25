import type { DocumentStore, ModelStore } from '@extrudo/core';
import type { KernelWaits, Wait } from '@extrudo/kernel';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { useStore } from 'zustand';
import { Button } from '../design-system/Button';
import {
  activeFeatureCount,
  progressBar,
  progressDetail,
  progressMode,
  progressTitle,
  showsCancel,
  UPDATING_AFTER_MS,
  WAITING_AFTER_MS,
  type WaitInput,
} from './progressRules';

const NO_WAITS: readonly Wait[] = [];

/**
 * A recompute has finished since the model store was last reset (ADR-0078).
 * `computed` always carries the document it computed, which `reset` clears.
 */
export function useRecomputeFinished(model: ModelStore<unknown>): boolean {
  return useStore(model, (s) => s.doc !== undefined || s.stats !== undefined);
}

/**
 * The kernel calls the user is waiting on (P6-17, ADR-0105 §1), as an
 * external store so a change redraws whoever shows it.
 */
export function useKernelWaits(waits: KernelWaits | undefined): readonly Wait[] {
  return useSyncExternalStore(
    waits?.subscribe ?? noSubscribe,
    waits?.get ?? noWaits,
    waits?.get ?? noWaits,
  );
}

function noSubscribe(): () => void {
  return () => {};
}

function noWaits(): readonly Wait[] {
  return NO_WAITS;
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
 * The notice at the view's top left while the design is being prepared, a
 * long recompute runs, or a kernel call the user made is still out (ADR-0078,
 * ADR-0105 §2). It never takes pointer events, so it can't block a pick; a
 * failed kernel keeps its own message (the status bar's). A long update offers
 * Cancel (ADR-0111), the one part that takes the pointer.
 */
export function ModelProgress({
  model,
  store,
  waits,
  collapsed,
  cancel,
}: {
  model: ModelStore<unknown>;
  store: DocumentStore;
  /** The kernel's live waits (P6-17); the notice shows them once they last. */
  waits?: KernelWaits;
  /** The browser is folded away: its "Show browser" tab then sits at the view's corner. */
  collapsed: boolean;
  /** Returns the document to the shown model's step (ADR-0111); read at render time. */
  cancel?: { can(): boolean; run(): void };
}) {
  const status = useStore(model, (s) => s.status);
  const finished = useRecomputeFinished(model);
  const progress = useStore(model, (s) => s.progress);
  const doc = useStore(store, (s) => s.doc);
  // Opening a transaction hides Cancel (ADR-0111) without changing the document.
  useStore(store, (s) => s.transactionDepth);
  const live = useKernelWaits(waits);
  const active = live.filter((wait) => !wait.quiet);
  const oldest = active[0];
  const oldestId = oldest?.id;
  const oldestSince = oldest?.since;

  // How long the running recompute has lasted: the 800 ms threshold.
  const running = status === 'idle' || status === 'computing';
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    setElapsed(0);
    if (!running) return;
    const timer = setTimeout(() => setElapsed(UPDATING_AFTER_MS + 1), UPDATING_AFTER_MS);
    return () => clearTimeout(timer);
  }, [running]);

  // How long the oldest wait has lasted: the 300 ms threshold.
  const [waitElapsed, setWaitElapsed] = useState(0);
  useEffect(() => {
    if (oldestId === undefined || oldestSince === undefined) {
      setWaitElapsed(0);
      return;
    }
    const lasted = Date.now() - oldestSince;
    setWaitElapsed(lasted);
    if (lasted > WAITING_AFTER_MS) return;
    const timer = setTimeout(
      () => setWaitElapsed(WAITING_AFTER_MS + 1),
      WAITING_AFTER_MS - lasted + 1,
    );
    return () => clearTimeout(timer);
  }, [oldestId, oldestSince]);

  const wait: WaitInput | undefined = oldest
    ? {
        label: oldest.label,
        others: Math.max(0, active.length - 1),
        elapsed: waitElapsed,
        quiet: oldest.quiet,
      }
    : undefined;
  const mode = progressMode({ status, finished, elapsed, ...(wait && { wait }) });
  if (!mode) return null;

  const bar =
    mode === 'updating' && progress
      ? progressBar({
          done: progress.done,
          total: progress.total,
          name: doc.features.find((f) => f.id === progress.feature)?.name ?? progress.feature,
        })
      : undefined;
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
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-ink">{progressTitle(mode, wait)}</span>
          {cancel && showsCancel(mode, cancel.can) && (
            <Button
              variant="ghost"
              data-model-cancel
              title="Cancel: undo the changes since the last model"
              aria-label="Cancel: undo the changes since the last model"
              onClick={cancel.run}
              className="pointer-events-auto -my-1 ml-auto h-6 px-2 text-sm"
            >
              Cancel
            </Button>
          )}
        </div>
        {bar ? (
          <>
            <progress
              value={bar.value}
              max={bar.max}
              aria-label="Features computed"
              className="mt-1 h-1 w-40 accent-accent"
            />
            <span className="mt-0.5 text-xs text-muted">{bar.text}</span>
          </>
        ) : (
          <span className="text-xs text-muted">
            {progressDetail(
              mode,
              mode === 'waiting' ? (wait as WaitInput) : activeFeatureCount(doc),
            )}
          </span>
        )}
      </div>
    </div>
  );
}
