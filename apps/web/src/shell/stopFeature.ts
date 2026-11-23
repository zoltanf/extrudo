/**
 * Stop while a design opens (ADR-0155): what the notice's Stop does once the
 * kernel has stopped the feature, and what the toast and the chip menu's
 * Try again run. Plain functions over the kernel and the document store, so
 * the shell and the tests share them.
 */
import type { DocumentStore, FeatureId } from '@extrudo/core';
import type { KernelStops } from '@extrudo/kernel';
import type { ToastOptions } from '../design-system';

/** The kernel side of Stop: the project's `Recomputer`. */
export interface StopKernel {
  stops: KernelStops;
  stop(): Promise<FeatureId | undefined>;
  retry(id: FeatureId): boolean;
  isStopped(id: FeatureId): boolean;
}

/** The toast stays a while: its Try again is the way back (the chip menu has it too). */
export const STOP_TOAST_MS = 12_000;

/** What the toast says after a Stop, in the user's words: while opening, or in an update (ADR-0161). */
export function stoppedText(name: string, during: 'open' | 'update' = 'open'): string {
  return during === 'open'
    ? `${name} was stopped, so the design opened without it. Nothing in the design changed.`
    : `${name} was stopped, so the model was updated without it. Your change is kept.`;
}

/**
 * Stops the running feature and says so, with Try again while it is still
 * stopped. Says nothing when nothing was stopped (the feature finished first,
 * or the document no longer reaches it: the worker was still replaced) or the
 * stop is already gone when the restart ends.
 */
export async function stopAndTell(
  kernel: StopKernel,
  store: DocumentStore,
  notify: (tone: 'info', text: string, options?: ToastOptions) => void,
  during: 'open' | 'update' = 'open',
): Promise<FeatureId | undefined> {
  const id = await kernel.stop();
  // Nothing recorded, or the stop is gone already (Try Again from the chip's
  // menu during the restart, a roll-back meanwhile): no "was stopped" news.
  if (id === undefined || !kernel.isStopped(id)) return undefined;
  const name = store.getState().doc.features.find((f) => f.id === id)?.name ?? 'The feature';
  notify('info', stoppedText(name, during), {
    lifetime: STOP_TOAST_MS,
    action: {
      label: 'Try again',
      // Once the stop is gone (tried again, forgotten) there is nothing to try:
      // the live toast's button then does nothing, the history no longer offers it.
      run: () => void kernel.retry(id),
      available: () => kernel.isStopped(id),
    },
  });
  return id;
}
