/**
 * When the view says the design is being prepared (ADR-0078) and when a
 * kernel call the user is waiting on gets the notice (ADR-0105 §2). Pure: the
 * component feeds it the model store's status, whether any recompute has
 * finished since the page opened, how long the running one has lasted, and
 * the oldest wait.
 */
import { activeFeatures, type ExtrudoDocument } from '@extrudo/core';

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
  elapsed,
  wait,
}: ProgressInput): ProgressMode | undefined {
  const recomputing = status === 'idle' || status === 'computing';
  if (recomputing && !finished) return 'preparing';
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
 * The determinate bar of a long recompute (ADR-0105 §3): how far it is among
 * the active features, and the line under it ("Thread1 · 4 of 7"). `name` is
 * the reported feature's name from the document, which the caller passes.
 */
export function progressBar({ done, total, name }: { done: number; total: number; name: string }): {
  value: number;
  max: number;
  text: string;
} {
  return { value: done, max: total, text: `${name} · ${done + 1} of ${total}` };
}
