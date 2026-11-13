/**
 * A sheet's views as requests and lines (P6-24 S2, plan §6), out of the app's
 * `viewLines.ts` (S6: a plain extraction, so the CLI and the app's agent
 * tools ask for views and turn results into lines the same way the Drawing
 * mode does):
 *
 * - A view's request has its frame (`sheetViewFrame`, through its parents) and always an
 *   explicit list of bodies: its base view's `bodies`, or every body the model shows (not
 *   hidden, not a ghost: `shownBodies`), so a body hidden or shown later asks again.
 * - The request's `key` names what the lines depend on besides the bodies' versions:
 *   direction, up and bodies. Scale, position and style are not in it (they are applied
 *   on the sheet, so changing them computes nothing).
 * - `sheetViewLines` turns a result's geometry into contours in the view's own frame,
 *   the shape `@extrudo/sheets`' `SheetViewLines` takes (`ViewLines` here, so the kernel
 *   needs nothing of that package).
 */
import {
  type BodyId,
  type ExtrudoDocument,
  type Sheet,
  type SheetView,
  type SheetViewFrame,
  type SheetViewId,
  sheetViewFrame,
  type Vec2,
} from '@extrudo/core';
import type { Contour, Point, Segment } from '@extrudo/io';
import { pieceAt, type ViewCurveKind, type ViewGeometry, type ViewPiece } from './geometry';
import { type SheetViewRequest, shownBodies } from './views';

/** One curve of a view as contours: what `@extrudo/sheets`' `SheetViewCurve` takes. */
export interface ViewLinesCurve {
  kind: ViewCurveKind;
  /** The model edge's topological name, for picking; layout ignores it. */
  edge?: string;
  contours: readonly Contour[];
}

/** A view's lines in its own frame (mm at 1:1, y up): what `@extrudo/sheets`' `SheetViewLines` takes. */
export interface ViewLines {
  curves: readonly ViewLinesCurve[];
  bounds?: { min: Point; max: Point };
  /** `stale`: drawn while the view is recomputed (dimmed on screen; the writers ignore it). */
  state?: string;
}

/** One view's request, with the key its lines are cached under. */
export interface SheetViewWant {
  request: SheetViewRequest & { bodies: BodyId[] };
  key: string;
}

/** The base view a view takes its bodies, scale and style from (itself for a base view). */
export function baseViewOf(sheet: Pick<Sheet, 'views'>, view: SheetView): SheetView | undefined {
  const seen = new Set<SheetViewId>();
  let at: SheetView | undefined = view;
  while (at && at.from.kind === 'projected') {
    if (seen.has(at.id)) return undefined;
    seen.add(at.id);
    const parent: SheetViewId = at.from.parent;
    at = sheet.views.find((v) => v.id === parent);
  }
  return at;
}

const fixed = (v: readonly number[]) => v.map((n) => Math.round(n * 1e9) / 1e9 + 0).join(',');

/**
 * What each view of `sheet` asks for, in the sheet's order. `bodies` are the IDs of the
 * bodies at the marker (the model store's); a view with a broken frame asks nothing.
 */
export function sheetViewWants(
  doc: ExtrudoDocument,
  sheet: Sheet,
  bodies: Iterable<BodyId>,
): SheetViewWant[] {
  const shown = shownBodies(doc, bodies);
  const out: SheetViewWant[] = [];
  for (const view of sheet.views) {
    const frame = sheetViewFrame(sheet, view.id);
    if (!frame) continue;
    out.push(sheetViewWant(view.id, frame, baseViewOf(sheet, view)?.bodies ?? shown));
  }
  return out;
}

/** One view's request from its frame and bodies (a view being placed asks the same way). */
export function sheetViewWant(
  id: string,
  frame: Pick<SheetViewFrame, 'direction' | 'up'>,
  bodies: readonly BodyId[],
): SheetViewWant {
  const ids = [...new Set(bodies)].sort();
  return {
    request: { id, direction: frame.direction, up: frame.up, bodies: ids },
    key: `${fixed(frame.direction)}|${fixed(frame.up)}|${ids.join(',')}`,
  };
}

const point = ([x, y]: Vec2): Point => [x, y];
/** A sweep this close to a full turn is one: the contour closes. */
const FULL = 2 * Math.PI - 1e-9;

/** One kernel piece as an io contour, in the view's own frame (mm at 1:1, y up). */
export function pieceContour(piece: ViewPiece): Contour {
  switch (piece.type) {
    case 'line':
      return {
        start: point(piece.a),
        segments: [{ type: 'line', to: point(piece.b) }],
        closed: false,
      };
    case 'polyline': {
      const [first = [0, 0], ...rest] = piece.points;
      return {
        start: point(first),
        segments: rest.map((p): Segment => ({ type: 'line', to: point(p) })),
        closed: false,
      };
    }
    case 'arc': {
      const sweep = piece.end - piece.start;
      return {
        start: point(pieceAt(piece, piece.start)),
        segments: [
          {
            type: 'arc',
            center: point(piece.center),
            sweep,
            to: point(pieceAt(piece, piece.end)),
          },
        ],
        closed: sweep >= FULL,
      };
    }
    case 'ellipse': {
      const sweep = piece.end - piece.start;
      return {
        start: point(pieceAt(piece, piece.start)),
        segments: [
          {
            type: 'ellipse',
            center: point(piece.center),
            rx: piece.rx,
            ry: piece.ry,
            rotation: piece.rotation,
            sweep,
            to: point(pieceAt(piece, piece.end)),
          },
        ],
        closed: sweep >= FULL,
      };
    }
  }
}

/**
 * A view's geometry as layout's lines: each curve with its kind and edge name, its pieces
 * as contours, and the geometry's bounds. `stale` marks lines drawn while the view is
 * recomputed (dimmed on screen; the writers ignore it).
 */
export function sheetViewLines(geometry: ViewGeometry, stale = false): ViewLines {
  const curves: ViewLinesCurve[] = geometry.curves.map((curve) => ({
    kind: curve.kind,
    ...(curve.edge && { edge: curve.edge }),
    contours: curve.pieces.map(pieceContour),
  }));
  return {
    curves,
    ...(geometry.bounds && {
      bounds: { min: point(geometry.bounds.min), max: point(geometry.bounds.max) },
    }),
    ...(stale && { state: 'stale' }),
  };
}
