/**
 * When the view says the design is being prepared (ADR-0078). Pure: the
 * component feeds it the model store's status, whether any recompute has
 * finished since the page opened and how long the running one has lasted.
 */
import type { ExtrudoDocument } from '@extrudo/core';

/** A recompute that runs longer than this gets the notice (quick edits never flash it). */
export const UPDATING_AFTER_MS = 800;

export type ProgressMode = 'preparing' | 'updating';

export interface ProgressInput {
  status: 'idle' | 'computing' | 'ready' | 'failed';
  /** A recompute has finished since the project page opened. */
  finished: boolean;
  /** How long the running recompute has lasted (ms). */
  elapsed: number;
}

/** The notice's mode, or undefined when it is hidden. */
export function progressMode({
  status,
  finished,
  elapsed,
}: ProgressInput): ProgressMode | undefined {
  if (status !== 'idle' && status !== 'computing') return undefined;
  if (!finished) return 'preparing';
  return elapsed > UPDATING_AFTER_MS ? 'updating' : undefined;
}

/** Features that take part in the recompute: before the marker and not suppressed. */
export function activeFeatureCount(
  doc: Pick<ExtrudoDocument, 'features' | 'timelineMarker'>,
): number {
  return doc.features.slice(0, doc.timelineMarker).filter((f) => !f.suppressed).length;
}

export function progressTitle(mode: ProgressMode): string {
  return mode === 'preparing' ? 'Preparing your design…' : 'Updating the model…';
}

export function progressDetail(count: number): string {
  return `Computing ${count} ${count === 1 ? 'feature' : 'features'}`;
}
