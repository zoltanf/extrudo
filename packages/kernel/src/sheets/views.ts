/**
 * The worker call's shapes (P6-24 S2, `KernelApi.sheetViews`): what a view
 * is asked with and what comes back, and which bodies "every shown body" is.
 */
import { type BodyId, type ExtrudoDocument, effectiveBodyDisplay, type Vec3 } from '@extrudo/core';
import type { ViewGeometry } from './geometry';

/** One view to compute against the bodies at the marker. */
export interface SheetViewRequest {
  /** The caller's name for it (the sheet view's ID), given back with the result. */
  id: string;
  /**
   * The way the view looks and the world direction up the sheet, as
   * `sheetViewFrame` gives them for a base or projected view.
   */
  direction: Vec3;
  up: Vec3;
  /** The bodies to draw; absent: every body the model shows at the marker. */
  bodies?: readonly BodyId[];
  /**
   * The polygonal placeholder (`hlrPolySpans`, milliseconds) instead of the
   * exact lines; the exact ones, when cached, are given instead.
   */
  quick?: boolean;
}

export type SheetViewResult =
  | {
      id: string;
      geometry: ViewGeometry;
      /** The version of each body drawn (`BodyResult.version`), to tell a stale result. */
      versions: Record<BodyId, string>;
      /** Time spent in the kernel, ms (0 from the cache). */
      ms: number;
    }
  /** The view couldn't be computed (a broken frame, an OCCT failure); the others still are. */
  | { id: string; error: string };

/**
 * How far a run of views is: called after each view with its result. A
 * `false` from it stops the run before the next view (it may be async,
 * across the worker).
 */
export type SheetViewProgress = (
  result: SheetViewResult,
  done: number,
  total: number,
) => boolean | undefined | Promise<boolean | undefined>;

/** A run of views stopped between two views (its `onView`, `cancelSheetViews`). */
export class SheetViewsCancelledError extends Error {
  override name = 'SheetViewsCancelledError';
  constructor() {
    super('The views were cancelled.');
  }
}

export function isSheetViewsCancelled(error: unknown): boolean {
  return error instanceof Error && error.name === 'SheetViewsCancelledError';
}

/** The bodies a view without `bodies` draws: those shown (not hidden, not ghosts), by ID. */
export function shownBodies(doc: ExtrudoDocument, bodies: Iterable<BodyId>): BodyId[] {
  return [...bodies]
    .filter((id) => {
      const meta = doc.bodies[id];
      const component = meta?.component
        ? doc.components?.find((c) => c.id === meta.component)
        : undefined;
      return effectiveBodyDisplay(meta, component) === 'shown';
    })
    .sort();
}
