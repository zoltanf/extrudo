/**
 * Keeping the open sheet's views drawn from the model (P6-24 S2, plan §4.2, §6.2): one run
 * of `Recomputer.sheetViews` at a time, the quick polygonal lines first for a view that
 * has nothing current to show, then the exact ones, one view after another. An external
 * store: the canvas reads `get()` and redraws on a change.
 *
 * - **What is shown**: a view's exact lines when they are the model's now; otherwise the
 *   newest lines it has (the quick ones, the exact ones of an older model, the last lines
 *   of its old direction), marked stale (dimmed) while it is recomputed; nothing at all
 *   for a view drawn for the first time (layout draws its frame and name, the canvas
 *   "Drawing the view…").
 * - **When it runs**: on `want` (the sheet, the model or a view changed), unless what is
 *   wanted is what the last run was given (results that never turn current, an error,
 *   don't loop) or what a cancel stopped. A `want` during a run waits for it to end; the
 *   run keeps going, since a later view already draws the new bodies (their `versions`
 *   say so), and stops early only when none of its later views is wanted any more.
 * - **Cancel** stops the run before its next view (one view is one call that can't be
 *   stopped); the views keep what they show, dimmed (plan §4.2), until the model or the
 *   views change.
 * - **Nothing is stored**: the cache lives in memory, per kernel, up to 64 views (the
 *   kernel keeps its own). Quick lines are a placeholder only: nothing measures or snaps
 *   to them (S3 reads `exact`).
 */
import type { BodyId, SheetViewId } from '@extrudo/core';
import {
  isSheetViewsCancelled,
  type SheetViewProgress,
  type SheetViewRequest,
  type SheetViewResult,
  type ViewGeometry,
} from '@extrudo/kernel';
import type { SheetViewLines } from '@extrudo/sheets';
import { linesAreCurrent, type SheetViewWant, sheetViewLines } from './viewLines';

/** What the runner needs of the kernel: `Recomputer`'s methods. */
export interface SheetViewsKernel {
  sheetViews(
    requests: readonly SheetViewRequest[],
    onView?: SheetViewProgress,
    options?: { label?: string; quiet?: boolean },
  ): Promise<SheetViewResult[]>;
  cancelSheetViews(): void;
  bodyVersions(): Record<BodyId, string>;
}

interface Drawn {
  geometry: ViewGeometry;
  versions: Record<BodyId, string>;
}

export interface SheetViewsProgress {
  /** Exact views finished in this run, and how many it has. */
  done: number;
  total: number;
  /** When the run started (`Date.now()`): the notice shows after a moment. */
  since: number;
}

export interface SheetViewsState {
  /** The lines each view draws now, by view ID; a view not here draws its frame. */
  lines: ReadonlyMap<SheetViewId, SheetViewLines>;
  /** The geometry those lines come from (exact or quick), for the views' notices. */
  geometry: ReadonlyMap<SheetViewId, ViewGeometry>;
  /** Views whose lines are not the model's now (shown dimmed, or not yet drawn). */
  pending: ReadonlySet<SheetViewId>;
  /** Why a view couldn't be drawn, by view ID. */
  errors: ReadonlyMap<SheetViewId, string>;
  /** A run going on, or undefined. */
  progress: SheetViewsProgress | undefined;
  /** The last run was cancelled and nothing changed since. */
  cancelled: boolean;
}

const EMPTY: SheetViewsState = {
  lines: new Map(),
  geometry: new Map(),
  pending: new Set(),
  errors: new Map(),
  progress: undefined,
  cancelled: false,
};

/** How many views' lines the app keeps in memory. */
export const SHEET_VIEW_CACHE = 64;

export class SheetViewRunner {
  readonly #kernel: SheetViewsKernel;
  /** By request key: the newest exact and quick lines. */
  readonly #cache = new Map<string, { exact?: Drawn; quick?: Drawn }>();
  /** What each view showed last, for when its key changes (a new direction). */
  readonly #last = new Map<SheetViewId, Drawn>();
  readonly #errors = new Map<SheetViewId, string>();
  /** The same lines object for the same result, so layout's cache holds. */
  readonly #lines = new WeakMap<Drawn, { current?: SheetViewLines; stale?: SheetViewLines }>();
  readonly #listeners = new Set<() => void>();
  #wants: readonly SheetViewWant[] = [];
  #state: SheetViewsState = EMPTY;
  #running = false;
  #again = false;
  #cancelling = false;
  #progress: SheetViewsProgress | undefined;
  /** The wanted work of the last run, and of the last cancelled one. */
  #ran: string | undefined;
  #cancelled: string | undefined;

  constructor(kernel: SheetViewsKernel) {
    this.#kernel = kernel;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  get = (): SheetViewsState => this.#state;

  /**
   * The views to keep drawn (the open sheet's), from `sheetViewWants`. With `hold` (the
   * model is being computed) what they show is updated but nothing runs until the next
   * `want` without it: the kernel has no model to draw yet, or is about to replace it.
   */
  want(wants: readonly SheetViewWant[], hold = false): void {
    this.#wants = wants;
    this.#publish();
    if (!hold) this.#schedule();
  }

  /** Stops the run before its next view; the views keep what they show. */
  cancel(): void {
    if (!this.#running) return;
    this.#cancelling = true;
    this.#kernel.cancelSheetViews();
  }

  /** After a cancel: draws the views again. */
  retry(): void {
    this.#cancelled = undefined;
    this.#ran = undefined;
    this.#publish();
    this.#schedule();
  }

  /**
   * Every view of `wants` drawn exactly from the model now (the export: never a
   * placeholder), computing those that are not; `onProgress` hears each. Rejects with
   * `isSheetViewsCancelled` when cancelled. A view that can't be drawn is left out.
   */
  async exact(
    wants: readonly SheetViewWant[],
    onProgress?: (done: number, total: number) => void,
  ): Promise<Map<SheetViewId, SheetViewLines>> {
    const current = this.#kernel.bodyVersions();
    const needs = wants.filter((w) => !this.#currentExact(w, current));
    let done = 0;
    onProgress?.(0, needs.length);
    if (needs.length > 0) {
      await this.#kernel.sheetViews(
        needs.map((w) => w.request),
        (result) => {
          const want = needs.find((w) => w.request.id === result.id);
          if (want) this.#store(want, result);
          onProgress?.(++done, needs.length);
          return undefined;
        },
        { label: 'Drawing the views for the export…', quiet: true },
      );
      this.#publish();
    }
    const out = new Map<SheetViewId, SheetViewLines>();
    for (const want of wants) {
      const drawn = this.#cache.get(want.key)?.exact;
      if (drawn) out.set(want.request.id as SheetViewId, this.#linesOf(drawn, false));
    }
    return out;
  }

  /**
   * A view's lines before it is placed (a placing frame, New drawing's layout): its current
   * exact lines when there are any, else the quick ones (`exact`: the exact ones), computed
   * now. `undefined` if it can't be drawn. The quick lines can hold stray pieces of the
   * polygonal run, so their bounds are only a first guess: what is laid out or kept uses
   * the exact ones.
   */
  async peek(want: SheetViewWant, exact = false): Promise<SheetViewLines | undefined> {
    const current = this.#kernel.bodyVersions();
    const entry = this.#cache.get(want.key);
    const have =
      this.#currentExact(want, current) ??
      (!exact &&
      entry?.quick &&
      linesAreCurrent(entry.quick.geometry, entry.quick.versions, current)
        ? entry.quick
        : undefined);
    if (have) return this.#linesOf(have, false);
    try {
      const [result] = await this.#kernel.sheetViews(
        [{ ...want.request, ...(!exact && { quick: true }) }],
        undefined,
        { quiet: true },
      );
      if (!result || 'error' in result) return undefined;
      this.#store(want, result);
      const entry = this.#cache.get(want.key);
      const drawn = entry?.exact ?? entry?.quick;
      return drawn && this.#linesOf(drawn, false);
    } catch {
      return undefined;
    }
  }

  #currentExact(want: SheetViewWant, current: Record<BodyId, string>): Drawn | undefined {
    const exact = this.#cache.get(want.key)?.exact;
    return exact && linesAreCurrent(exact.geometry, exact.versions, current) ? exact : undefined;
  }

  #linesOf(drawn: Drawn, stale: boolean): SheetViewLines {
    let memo = this.#lines.get(drawn);
    if (!memo) {
      memo = {};
      this.#lines.set(drawn, memo);
    }
    if (stale) {
      memo.stale ??= sheetViewLines(drawn.geometry, true);
      return memo.stale;
    }
    memo.current ??= sheetViewLines(drawn.geometry);
    return memo.current;
  }

  #store(want: SheetViewWant, result: SheetViewResult): void {
    const id = want.request.id as SheetViewId;
    if ('error' in result) {
      this.#errors.set(id, result.error);
      return;
    }
    this.#errors.delete(id);
    const drawn: Drawn = { geometry: result.geometry, versions: result.versions };
    const entry = this.#cache.get(want.key) ?? {};
    // A quick request may come back exact (the kernel had it).
    if (result.geometry.exact) entry.exact = drawn;
    else entry.quick = drawn;
    this.#cache.delete(want.key);
    this.#cache.set(want.key, entry);
    while (this.#cache.size > SHEET_VIEW_CACHE) {
      const oldest = this.#cache.keys().next().value;
      if (oldest === undefined) break;
      this.#cache.delete(oldest);
    }
    this.#last.set(id, drawn);
  }

  #publish(): void {
    const current = this.#kernel.bodyVersions();
    const lines = new Map<SheetViewId, SheetViewLines>();
    const geometry = new Map<SheetViewId, ViewGeometry>();
    const pending = new Set<SheetViewId>();
    const errors = new Map<SheetViewId, string>();
    for (const want of this.#wants) {
      const id = want.request.id as SheetViewId;
      const error = this.#errors.get(id);
      if (error) errors.set(id, error);
      const exact = this.#currentExact(want, current);
      if (exact) {
        lines.set(id, this.#linesOf(exact, false));
        geometry.set(id, exact.geometry);
        continue;
      }
      pending.add(id);
      const entry = this.#cache.get(want.key);
      const quick =
        entry?.quick && linesAreCurrent(entry.quick.geometry, entry.quick.versions, current)
          ? entry.quick
          : undefined;
      const shown = quick ?? entry?.exact ?? entry?.quick ?? this.#last.get(id);
      if (shown) {
        lines.set(id, this.#linesOf(shown, true));
        geometry.set(id, shown.geometry);
      }
    }
    this.#state = {
      lines,
      geometry,
      pending,
      errors,
      progress: this.#progress,
      cancelled: this.#cancelled !== undefined && this.#cancelled === this.#work(current),
    };
    for (const listener of this.#listeners) listener();
  }

  /** What is still to compute, as a string: its keys and the bodies' versions now. */
  #work(current: Record<BodyId, string>): string {
    return this.#wants
      .filter((w) => !this.#currentExact(w, current))
      .map((w) => `${w.key}@${w.request.bodies.map((b) => current[b] ?? '-').join(',')}`)
      .join(';');
  }

  #schedule(): void {
    if (this.#running) {
      this.#again = true;
      return;
    }
    const current = this.#kernel.bodyVersions();
    const work = this.#work(current);
    if (work === '' || work === this.#ran || work === this.#cancelled) return;
    this.#cancelled = undefined;
    this.#ran = work;
    void this.#run(current);
  }

  async #run(current: Record<BodyId, string>): Promise<void> {
    const needs = this.#wants.filter((w) => !this.#currentExact(w, current));
    // The quick lines first where a view has nothing current to show.
    const quick = needs.filter((w) => {
      const entry = this.#cache.get(w.key);
      return !(
        entry?.quick && linesAreCurrent(entry.quick.geometry, entry.quick.versions, current)
      );
    });
    const order: { want: SheetViewWant; quick: boolean }[] = [
      ...quick.map((want) => ({ want, quick: true })),
      ...needs.map((want) => ({ want, quick: false })),
    ];
    this.#running = true;
    this.#progress = { done: 0, total: needs.length, since: Date.now() };
    this.#publish();
    let stopped = false;
    try {
      await this.#kernel.sheetViews(
        order.map(({ want, quick: q }) => ({ ...want.request, ...(q && { quick: true }) })),
        (result, done) => {
          const step = order[done - 1];
          if (step) this.#store(step.want, result);
          if (step && !step.quick && this.#progress) {
            this.#progress = { ...this.#progress, done: this.#progress.done + 1 };
          }
          this.#publish();
          // Stop early when none of the views still to come is wanted (another sheet).
          const keys = new Set(this.#wants.map((w) => w.key));
          return order.slice(done).some((s) => keys.has(s.want.key)) ? undefined : false;
        },
        { quiet: true },
      );
    } catch (error) {
      if (isSheetViewsCancelled(error)) {
        stopped = this.#cancelling;
        // Stopped by someone else (an export's cancel): the views still want drawing.
        if (!stopped) {
          this.#again = true;
          this.#ran = undefined;
        }
      } else {
        const message = error instanceof Error ? error.message : String(error);
        for (const { want } of order) {
          if (!this.#currentExact(want, this.#kernel.bodyVersions())) {
            this.#errors.set(want.request.id as SheetViewId, message);
          }
        }
      }
    } finally {
      this.#running = false;
      this.#cancelling = false;
      this.#progress = undefined;
      // What is left now: not run again until something changes (a result that is not
      // current yet, an error), unless a change came during the run.
      const left = this.#work(this.#kernel.bodyVersions());
      if (stopped) this.#cancelled = left;
      if (!this.#again) this.#ran = left;
      this.#publish();
      if (this.#again) {
        this.#again = false;
        this.#schedule();
      }
    }
  }
}

const runners = new WeakMap<SheetViewsKernel, SheetViewRunner>();

/** The runner of a kernel (one per project: its cache outlives a visit to the drawing). */
export function sheetViewRunner(kernel: SheetViewsKernel): SheetViewRunner {
  let runner = runners.get(kernel);
  if (!runner) {
    runner = new SheetViewRunner(kernel);
    runners.set(kernel, runner);
  }
  return runner;
}

export { EMPTY as NO_SHEET_VIEWS };
