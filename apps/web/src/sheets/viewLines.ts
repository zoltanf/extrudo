/**
 * A sheet's views as the kernel draws them (P6-24 S2, plan §6): what each view asks
 * `Recomputer.sheetViews` for, and the result turned into the `SheetViewLines` that
 * `layoutSheet` draws. Pure: the view runner (`viewRunner.ts`) and the tests call these.
 *
 * - A view's request has its frame (`sheetViewFrame`, through its parents) and always an
 *   explicit list of bodies: its base view's `bodies`, or every body the model shows (not
 *   hidden, not a ghost: `shownBodies`), so a body hidden or shown later asks again.
 * - The request's `key` names what the lines depend on besides the bodies' versions:
 *   direction, up and bodies. Scale, position and style are not in it (they are applied
 *   on the sheet, so changing them computes nothing).
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
import {
  pieceAt,
  type SheetViewRequest,
  shownBodies,
  type ViewGeometry,
  type ViewPiece,
} from '@extrudo/kernel';
import type { SheetViewCurve, SheetViewLines } from '@extrudo/sheets';

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

/**
 * Whether lines drawn from `versions` (a result's) are the model's now (`current`: each
 * body's version at the marker). A body the result skipped as missing must still be
 * missing; one it skipped as a mesh body is not drawn, so its version does not matter.
 */
export function linesAreCurrent(
  geometry: ViewGeometry,
  versions: Readonly<Record<BodyId, string>>,
  current: Readonly<Record<BodyId, string>>,
): boolean {
  for (const [id, version] of Object.entries(versions)) {
    if (current[id as BodyId] !== version) return false;
  }
  return geometry.skipped.every((s) => s.reason !== 'missing' || current[s.body] === undefined);
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
export function sheetViewLines(geometry: ViewGeometry, stale = false): SheetViewLines {
  const curves: SheetViewCurve[] = geometry.curves.map((curve) => ({
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

/**
 * What a view says on screen about its bodies (plan §4.6), or `undefined`: a chosen body
 * that is gone ("Box is gone. Choose bodies or delete the view."), a mesh body ("Mesh
 * bodies can't be drawn yet."), nothing to draw ("No shown bodies to draw.").
 */
export function sheetViewNotice(
  doc: Pick<ExtrudoDocument, 'bodies'>,
  geometry: ViewGeometry,
): string | undefined {
  const missing = geometry.skipped.filter((s) => s.reason === 'missing');
  if (missing.length > 0) {
    const names = missing.map((s) => doc.bodies[s.body]?.name ?? 'A body');
    const which =
      names.length === 1
        ? `${names[0]} is gone`
        : `${names.slice(0, -1).join(', ')} and ${names.at(-1)} are gone`;
    return `${which}. Choose bodies or delete the view.`;
  }
  if (geometry.skipped.some((s) => s.reason === 'mesh')) return "Mesh bodies can't be drawn yet.";
  if (geometry.curves.length === 0) return 'No shown bodies to draw.';
  return undefined;
}
