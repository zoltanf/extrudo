/**
 * The worker call's shapes (P6-24 S2, `KernelApi.sheetViews`): what a view
 * is asked with and what comes back, and which bodies "every shown body" is.
 */
import {
  type BodyId,
  type ExtrudoDocument,
  effectiveBodyDisplay,
  type Sheet,
  type SheetView,
  scriptOfGenerated,
  type Vec3,
} from '@extrudo/core';
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

/**
 * The bodies a parts list of view `viewId` lists, in its order (P6-24 S5):
 * its base view's `bodies` as listed (a body the model doesn't have left
 * out), else every shown body in timeline order (the order of the features
 * that made them, then their number). `live` are the bodies at the marker.
 */
export function sheetListBodies(
  doc: ExtrudoDocument,
  sheet: Pick<Sheet, 'views'>,
  viewId: string,
  live: ReadonlySet<BodyId>,
): BodyId[] {
  const chosen = baseView(sheet, viewId)?.bodies;
  if (chosen) return [...new Set(chosen)].filter((id) => live.has(id));
  const ids = new Set<string>(doc.features.map((f) => f.id));
  const position = new Map<string, number>(doc.features.map((f, i) => [f.id, i]));
  const order = (id: BodyId): [number, number] => {
    const colon = id.lastIndexOf(':');
    const feature = colon < 0 ? id : id.slice(0, colon);
    const n = Number(id.slice(colon + 1));
    const at = position.get(scriptOfGenerated(feature, ids) ?? feature);
    return [at ?? Number.POSITIVE_INFINITY, Number.isFinite(n) ? n : 0];
  };
  return shownBodies(doc, live).sort((a, b) => {
    const [fa, na] = order(a);
    const [fb, nb] = order(b);
    return fa - fb || na - nb || (a < b ? -1 : a > b ? 1 : 0);
  });
}

/** The base view a view takes its bodies from, through its parents (itself for a base view). */
function baseView(sheet: Pick<Sheet, 'views'>, id: string): SheetView | undefined {
  const seen = new Set<string>();
  let view = sheet.views.find((v) => v.id === id);
  while (view && view.from.kind === 'projected') {
    if (seen.has(view.id)) return undefined;
    seen.add(view.id);
    const parent: string = view.from.parent;
    view = sheet.views.find((v) => v.id === parent);
  }
  return view;
}
