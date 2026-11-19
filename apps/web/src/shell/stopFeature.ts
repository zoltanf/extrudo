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

/** What the toast says after a Stop, in the user's words. */
export function stoppedText(name: string): string {
  return `${name} was stopped, so the design opened without it. Nothing in the design changed.`;
}

/**
 * Stops the running feature and says so, with Try again while it is still
 * stopped. Does nothing visible when there was nothing to stop (the feature
 * finished first).
 */
export async function stopAndTell(
  kernel: StopKernel,
  store: DocumentStore,
  notify: (tone: 'info', text: string, options?: ToastOptions) => void,
): Promise<FeatureId | undefined> {
  const id = await kernel.stop();
  if (id === undefined) return undefined;
  const name = store.getState().doc.features.find((f) => f.id === id)?.name ?? 'The feature';
  notify('info', stoppedText(name), {
    lifetime: STOP_TOAST_MS,
    action: {
      label: 'Try again',
      run: () => void kernel.retry(id),
      available: () => kernel.isStopped(id),
    },
  });
  return id;
}
