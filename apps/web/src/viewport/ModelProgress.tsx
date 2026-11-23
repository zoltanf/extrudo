import type { DocumentStore, ModelStore } from '@extrudo/core';
import type { KernelStops, KernelWaits, StopState, Wait } from '@extrudo/kernel';
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useStore } from 'zustand';
import { Button } from '../design-system/Button';
import {
  activeFeatureCount,
  BUILDING_TEXT,
  CANCELLING_TEXT,
  CANCELLING_TITLE,
  featureSeconds,
  LONG_FEATURE_TEXT,
  longFeatureIn,
  longFeatureMs,
  nextTickIn,
  progressBar,
  progressDetail,
  progressMode,
  progressTitle,
  showsBar,
  showsCancel,
  showsStop,
  UPDATING_AFTER_MS,
  WAITING_AFTER_MS,
  type WaitInput,
} from './progressRules';

declare global {
  interface Window {
    /** A shorter long-feature threshold, ms, set by e2e tests before the app loads; it can only lower it. */
    __extrudoLongFeatureMs?: number;
  }
}

const NO_WAITS: readonly Wait[] = [];
const NO_STOPS: StopState = {
  stopped: [],
  opening: false,
  stoppable: false,
  stopping: false,
  cancelling: false,
  superseded: false,
};

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

/** Stop's state (ADR-0155), as an external store like the waits. */
export function useKernelStops(stops: KernelStops | undefined): StopState {
  return useSyncExternalStore(
    stops?.subscribe ?? noSubscribe,
    stops?.get ?? noStops,
    stops?.get ?? noStops,
  );
}

function noStops(): StopState {
  return NO_STOPS;
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
 * How long the reported feature has run, after the bar's line (ADR-0105's
 * amendment of 2026-11-19): " · 13 s" from `SECONDS_FROM` on. Its own timer
 * redraws only this span, once per change, and runs only while the span is
 * mounted, i.e. while the notice shows the bar. Hidden from screen readers: the
 * notice is a polite live region, and a count that changes every second would
 * be read out every second.
 */
export function FeatureSeconds({ since }: { since: number }) {
  // The time the count was last read; the timer moves it, so a render reads no clock.
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const arm = () => {
      timer = setTimeout(
        () => {
          setNow(Date.now());
          arm();
        },
        nextTickIn(since, Date.now()),
      );
    };
    arm();
    return () => clearTimeout(timer);
  }, [since]);
  const seconds = featureSeconds(since, now);
  if (seconds === undefined) return null;
  return (
    <span aria-hidden data-feature-seconds className="shrink-0 whitespace-pre">
      {` · ${seconds} s`}
    </span>
  );
}

/**
 * Where the keyboard goes when the Stop button leaves while it has the focus
 * (ADR-0155): the stopped feature's timeline chip, whose menu has Try again,
 * else the timeline marker. Without it the focus would fall to the page.
 */
function stopFocusTarget(feature: string | undefined): HTMLElement | null {
  const chip =
    feature === undefined
      ? null
      : document.querySelector<HTMLElement>(
          `[data-timeline-item="chip"][data-feature-id="${CSS.escape(feature)}"]`,
        );
  return (
    chip ?? document.querySelector<HTMLElement>('[role="slider"][aria-label="Timeline marker"]')
  );
}

/**
 * Whether the feature that started at `since` has run `LONG_FEATURE_MS` (ADR-0155's
 * amendment of 2026-11-19). One timer, set for the moment it turns long, and only
 * while `watch` (Stop is offered); a new feature (`since`) starts over.
 */
export function useLongFeature(since: number | undefined, watch: boolean): boolean {
  const limit = longFeatureMs(
    typeof window === 'undefined' ? undefined : window.__extrudoLongFeatureMs,
  );
  const [longSince, setLongSince] = useState<number>();
  useEffect(() => {
    if (!watch || since === undefined) return;
    const wait = longFeatureIn(since, Date.now(), limit);
    if (wait === 0) {
      setLongSince(since);
      return;
    }
    const timer = setTimeout(() => setLongSince(since), wait);
    return () => clearTimeout(timer);
  }, [since, watch, limit]);
  return watch && since !== undefined && longSince === since;
}

/** What Stop says it does, for screen readers and as its tooltip. */
export function stopLabel(during: StopDuring): string {
  if (during === 'open') return 'Stop: open the design without this feature for now';
  if (during === 'update') return 'Stop: update the model without this feature for now';
  return 'Stop: end the running feature now';
}

/** What the update notice offers, for Ctrl+Z's routing (ADR-0161, `shell/undoRouting.ts`). */
export type UpdateNotice = 'cancel' | 'cancelling' | undefined;

/**
 * When a Stop is pressed: while the design opens, during an update after an
 * edit, while a pressed Cancel waits for the running feature, or after a newer
 * edit while the worker still runs the old feature (ADR-0161). The last two
 * record nothing.
 */
export type StopDuring = 'open' | 'update' | 'cancel' | 'edit';

/**
 * The notice's Stop (ADR-0155, ADR-0161): a quiet text button in Cancel's style,
 * in every state (the owner's choice of 2026-11-23: never filled); before Cancel
 * when both show.
 */
function StopButton({
  feature,
  during,
  onStop,
  focus = false,
}: {
  feature: string | undefined;
  during: StopDuring;
  onStop(): void;
  /** Takes the focus when it appears: Cancel had it (ADR-0161). */
  focus?: boolean;
}) {
  const button = useRef<HTMLButtonElement>(null);
  const target = useRef(feature);
  target.current = feature;
  useLayoutEffect(() => {
    if (focus) button.current?.focus();
  }, [focus]);
  // Runs before the button leaves the page (Stop hides it at once).
  useLayoutEffect(
    () => () => {
      if (button.current && document.activeElement === button.current) {
        stopFocusTarget(target.current)?.focus();
      }
    },
    [],
  );
  return (
    <Button
      ref={button}
      variant="ghost"
      data-model-stop={during}
      title={stopLabel(during)}
      aria-label={stopLabel(during)}
      onClick={onStop}
      className="pointer-events-auto -my-1 h-6 px-2 text-sm"
    >
      Stop
    </Button>
  );
}

/**
 * The notice at the view's top left while the design is being prepared, a
 * long recompute runs, or a kernel call the user made is still out (ADR-0078,
 * ADR-0105 §2). It never takes pointer events, so it can't block a pick; a
 * failed kernel keeps its own message (the status bar's). A long update offers
 * Cancel (ADR-0111) and, once its feature has taken long, Stop (ADR-0161); the
 * buttons are the only parts that take the pointer. While a pressed Cancel waits
 * for the running feature, it says "Cancelling…" with Stop alone.
 */
export function ModelProgress({
  model,
  store,
  waits,
  collapsed,
  cancel,
  stop,
}: {
  model: ModelStore<unknown>;
  store: DocumentStore;
  /** The kernel's live waits (P6-17); the notice shows them once they last. */
  waits?: KernelWaits;
  /** The browser is folded away: its "Show browser" tab then sits at the view's corner. */
  collapsed: boolean;
  /**
   * Returns the document to the shown model's step (ADR-0111); read at render
   * time; `run` says whether it changed the document. `notice` hears what the notice offers, for Ctrl+Z's routing: Cancel,
   * or a pressed Cancel that waits (ADR-0161).
   */
  cancel?: { can(): boolean; run(): boolean | undefined; notice?(state: UpdateNotice): void };
  /** Stops the running feature while the design opens (ADR-0155) or in a long update (ADR-0161). */
  stop?: { stops: KernelStops; run(during: StopDuring): void };
}) {
  const status = useStore(model, (s) => s.status);
  const finished = useRecomputeFinished(model);
  const progress = useStore(model, (s) => s.progress);
  const doc = useStore(store, (s) => s.doc);
  // Opening a transaction hides Cancel (ADR-0111) without changing the document.
  useStore(store, (s) => s.transactionDepth);
  const live = useKernelWaits(waits);
  const stops = useKernelStops(stop?.stops);
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
  const mode = progressMode({
    status,
    finished,
    opening: stops.opening,
    elapsed,
    ...(wait && { wait }),
  });
  const building = progress?.building === true;
  // The long-feature timer runs while a feature can be stopped, opening or updating. It
  // counts the feature the worker runs, also one an edit has superseded (ADR-0161), whose
  // call no longer reports progress.
  const recomputing = mode === 'preparing' || mode === 'updating';
  const since = progress?.since ?? stops.since;
  const long = useLongFeature(
    since,
    stop !== undefined && recomputing && stops.stoppable && !building && since !== undefined,
  );
  // A pressed Cancel waits for the running feature (ADR-0161): "Cancelling…" with Stop alone.
  const cancelling = mode === 'updating' && stops.cancelling;
  const offersStop =
    mode !== undefined &&
    stop !== undefined &&
    !building &&
    showsStop(mode, { stoppable: stops.stoppable, long, cancelling });
  const offersCancel =
    mode !== undefined && cancel !== undefined && !cancelling && showsCancel(mode, cancel.can);
  // For Ctrl+Z's routing (ADR-0161, `undoRoute`).
  const notice: UpdateNotice = cancelling ? 'cancelling' : offersCancel ? 'cancel' : undefined;
  const tellNotice = cancel?.notice;
  useEffect(() => {
    tellNotice?.(notice);
  }, [tellNotice, notice]);
  useEffect(() => () => tellNotice?.(undefined), [tellNotice]);
  // Cancel pressed while it had the focus: the waiting state's Stop takes it (ADR-0161).
  // Only for the wait that click started: cleared when Cancel goes without a wait, and when
  // the wait ends (a later Cancel by Ctrl+Z must not move the focus).
  const [focusStop, setFocusStop] = useState(false);
  const wasCancelling = useRef(false);
  useEffect(() => {
    if (wasCancelling.current && !cancelling) setFocusStop(false);
    wasCancelling.current = cancelling;
    if (!cancelling && !offersCancel) setFocusStop(false);
  }, [cancelling, offersCancel]);
  if (!mode) return null;
  const during: StopDuring = cancelling
    ? 'cancel'
    : mode === 'preparing'
      ? 'open'
      : stops.superseded
        ? 'edit'
        : 'update';

  const bar =
    !cancelling && progress && showsBar(mode, true)
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
      data-model-cancelling={cancelling || undefined}
      className="pointer-events-none absolute top-3 z-10 flex items-center gap-2.5 rounded-control border border-line bg-panel px-3 py-2 shadow-raised"
      style={{ left: `calc(var(--x-browser-inset, 0px) + ${collapsed ? 52 : 12}px)` }}
    >
      <ProgressCube />
      <div className="flex flex-col leading-tight">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-ink">
            {cancelling ? CANCELLING_TITLE : progressTitle(mode, wait)}
          </span>
          {(offersStop || offersCancel) && (
            <span className="ml-auto flex items-center gap-1">
              {stop && offersStop && (
                <StopButton
                  feature={progress?.feature}
                  during={during}
                  onStop={() => stop.run(during)}
                  focus={focusStop && cancelling}
                />
              )}
              {cancel && offersCancel && (
                <Button
                  variant="ghost"
                  data-model-cancel
                  title="Cancel: undo the changes since the last model"
                  aria-label="Cancel: undo the changes since the last model"
                  onClick={(event) => {
                    const focused = document.activeElement === event.currentTarget;
                    // A refused Cancel (nothing changed) starts no wait.
                    if (cancel.run() !== false && focused) setFocusStop(true);
                  }}
                  className="pointer-events-auto -my-1 h-6 px-2 text-sm"
                >
                  Cancel
                </Button>
              )}
            </span>
          )}
        </div>
        {bar ? (
          <>
            <progress
              value={building ? bar.max : bar.value}
              max={bar.max}
              aria-label="Features computed"
              className="mt-1 h-1 w-full min-w-40 accent-accent"
            />
            {building ? (
              <span data-progress-building className="mt-0.5 text-xs text-muted">
                {BUILDING_TEXT}
              </span>
            ) : (
              <span data-progress-line className="mt-0.5 flex max-w-64 text-xs text-muted">
                <span data-progress-feature className="min-w-0 truncate">
                  {bar.name}
                </span>
                <span className="shrink-0 whitespace-pre">{` · ${bar.position}`}</span>
                {progress && <FeatureSeconds since={progress.since} />}
              </span>
            )}
            {long && (
              <span data-feature-long className="mt-1 text-xs text-ink">
                {LONG_FEATURE_TEXT}
              </span>
            )}
          </>
        ) : (
          <>
            <span className="text-xs text-muted">
              {progressDetail(
                mode,
                mode === 'waiting' ? (wait as WaitInput) : activeFeatureCount(doc),
              )}
            </span>
            {cancelling ? (
              <span data-cancelling-text className="mt-1 text-xs text-ink">
                {CANCELLING_TEXT}
              </span>
            ) : (
              // After an edit the old feature runs on with no bar (ADR-0161).
              long && (
                <span data-feature-long className="mt-1 text-xs text-ink">
                  {LONG_FEATURE_TEXT}
                </span>
              )
            )}
          </>
        )}
      </div>
    </div>
  );
}
