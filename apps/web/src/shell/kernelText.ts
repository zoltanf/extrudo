import type { ModelProgress, ModelState } from '@extrudo/core';

/**
 * What the kernel is doing (P6-17, ADR-0105 §3): starting, computing (with
 * the running recompute's position when the model store has one), or how
 * long the last recompute took.
 */
export function kernelText(
  status: ModelState<unknown>['status'],
  stats: ModelState<unknown>['stats'],
  progress: ModelProgress | undefined,
): string {
  if (status === 'idle') return 'kernel starting';
  if (status === 'computing') {
    return progress ? `computing ${progress.done + 1}/${progress.total}` : 'computing…';
  }
  if (status === 'failed') return 'kernel stopped';
  if (!stats) return 'computed';
  return `computed in ${stats.ms < 10 ? stats.ms.toFixed(1) : Math.round(stats.ms)} ms`;
}
