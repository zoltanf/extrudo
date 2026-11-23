/**
 * When the view says the design is being prepared (ADR-0078) and when a
 * kernel call the user is waiting on gets the notice (ADR-0105 §2). Pure: the
 * component feeds it the model store's status, whether any recompute has
 * finished since the page opened, how long the running one has lasted, and
 * the oldest wait.
 */
import { activeFeatures, type ExtrudoDocument } from '@extrudo/core';
import { LONG_FEATURE_MS } from '@extrudo/kernel';

/** A recompute that runs longer than this gets the notice (quick edits never flash it). */
export const UPDATING_AFTER_MS = 800;

/** A kernel call the user is waiting on gets the notice after this (ADR-0105 §2). */
export const WAITING_AFTER_MS = 300;

export type ProgressMode = 'preparing' | 'updating' | 'waiting';

/** The oldest non-quiet wait, as the notice needs it (ADR-0105 §2). */
export interface WaitInput {
  /** In plain words ("Reading the pick…"). */
  label: string;
  /** How many other non-quiet waits run besides the oldest. */
  others: number;
  /** How long the oldest wait has lasted (ms). */
  elapsed: number;
  quiet: boolean;
}

export interface ProgressInput {
  status: 'idle' | 'computing' | 'ready' | 'failed';
  /** A recompute has finished since the project page opened. */
  finished: boolean;
  /**
   * The running recompute belongs to opening the design though one has
   * finished: Try again or Stop started it (ADR-0155). It shows as while the
   * design opened, at once and with Stop.
   */
  opening?: boolean;
  /** How long the running recompute has lasted (ms). */
  elapsed: number;
  /** The oldest non-quiet wait, or undefined when none is running. */
  wait?: WaitInput;
}

/**
 * The notice's mode, or undefined when it is hidden. A recompute
 * (`preparing`/`updating`) wins over a wait (ADR-0105 §2); a wait shows even
 * once the kernel is ready, since that is when most picks happen.
 */
export function progressMode({
  status,
  finished,
  opening = false,
  elapsed,
  wait,
}: ProgressInput): ProgressMode | undefined {
  const recomputing = status === 'idle' || status === 'computing';
  if (recomputing && (!finished || opening)) return 'preparing';
  if (recomputing && elapsed > UPDATING_AFTER_MS) return 'updating';
  if (wait && wait.elapsed > WAITING_AFTER_MS) return 'waiting';
  return undefined;
}

/** Features that take part in the recompute: before the marker and not suppressed. */
export function activeFeatureCount(
  doc: Pick<ExtrudoDocument, 'features' | 'timelineMarker'>,
): number {
  return activeFeatures(doc).length;
}

/**
 * Whether the notice offers Cancel (ADR-0111): only for a long update, and only
 * when the document can go back to the shown model's step. Never while a design
 * first opens or for a kernel wait.
 */
export function showsCancel(mode: ProgressMode, canRevert: () => boolean): boolean {
  return mode === 'updating' && canRevert();
}

/**
 * Whether the notice offers Stop: while the design opens (or a Try again runs,
 * which shows the same way) as soon as the kernel is on a feature (ADR-0155);
 * in an update after an edit once that feature has taken long (ADR-0161), beside
 * Cancel.
 */
export function showsStop(
  mode: ProgressMode,
  { stoppable, long }: { stoppable: boolean; long: boolean },
): boolean {
  if (!stoppable) return false;
  return mode === 'preparing' || (mode === 'updating' && long);
}

/**
 * After this long in one feature the notice says `LONG_FEATURE_TEXT` and, in an
 * update after an edit, offers Stop beside Cancel (ADR-0161). The kernel's
 * constant, where its margin is written down; the notice's timer and the
 * recomputer's rule use the same value.
 */
export { LONG_FEATURE_MS };

/** What the notice adds once a feature has run `LONG_FEATURE_MS`; read once (polite region). */
export const LONG_FEATURE_TEXT = 'This feature is taking a long time.';

/** The bar's line while the kernel is past its last feature (`ModelProgress.building`). */
export const BUILDING_TEXT = 'Building the model…';

/**
 * The long-feature threshold, ms. A test may only lower it
 * (`window.__extrudoLongFeatureMs`, like `__extrudoRegionBudget`): anything that
 * isn't a positive finite number below `LONG_FEATURE_MS` is ignored.
 */
export function longFeatureMs(lower: unknown): number {
  return typeof lower === 'number' && Number.isFinite(lower) && lower > 0
    ? Math.min(lower, LONG_FEATURE_MS)
    : LONG_FEATURE_MS;
}

/** How long until a feature that started at `since` counts as long at `now` (0 once it does). */
export function longFeatureIn(since: number, now: number, limit: number): number {
  return Math.max(0, since + limit - now);
}

export function progressTitle(mode: ProgressMode, wait?: WaitInput): string {
  if (mode === 'preparing') return 'Preparing your design…';
  if (mode === 'updating') return 'Updating the model…';
  return wait?.label ?? '';
}

export function progressDetail(mode: ProgressMode, value: number | WaitInput): string {
  if (mode === 'waiting') {
    const others = (value as WaitInput).others;
    return others > 0 ? `and ${others} more` : '';
  }
  const count = value as number;
  return `Computing ${count} ${count === 1 ? 'feature' : 'features'}`;
}

/**
 * The determinate bar of a long recompute (ADR-0105 §3), while a design opens
 * too (its amendment of 2026-11-19): how far it is among the active features,
 * and the line under it ("Thread1 · 4 of 7"). `name` is the reported
 * feature's name from the document, which the caller passes; `name` and
 * `position` come apart so a long name can be cut short and the count kept.
 */
export function progressBar({ done, total, name }: { done: number; total: number; name: string }): {
  value: number;
  max: number;
  name: string;
  position: string;
  text: string;
} {
  const position = `${done + 1} of ${total}`;
  return { value: done, max: total, name, position, text: `${name} · ${position}` };
}

/**
 * Whether the notice draws the bar (ADR-0105's amendment of 2026-11-19): while
 * a design opens and while it updates, once the kernel has reported a feature.
 * Before that the opening notice keeps "Computing n features".
 */
export function showsBar(mode: ProgressMode, reported: boolean): boolean {
  return reported && (mode === 'preparing' || mode === 'updating');
}

/** The line under the bar counts the feature's seconds from this many on (ADR-0105's amendment of 2026-11-19). */
export const SECONDS_FROM = 3;

/**
 * Whole seconds the reported feature has run at `now`, or undefined while it is
 * under `SECONDS_FROM` (a quick feature never shows a count).
 */
export function featureSeconds(since: number, now: number): number | undefined {
  const seconds = Math.floor((now - since) / 1000);
  return seconds >= SECONDS_FROM ? seconds : undefined;
}

/**
 * How long, in ms, until the shown seconds change: the first count at
 * `SECONDS_FROM`, then each whole second since `since`. The notice's timer
 * waits this long, so it wakes once per change and not before the count shows.
 */
export function nextTickIn(since: number, now: number): number {
  const elapsed = Math.max(0, now - since);
  const first = SECONDS_FROM * 1000 - elapsed;
  return first > 0 ? first : 1000 - (elapsed % 1000);
}
