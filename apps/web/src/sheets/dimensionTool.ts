/**
 * The Dimension tool's pure parts (P6-24 S3, plan §4.5, §6.2 item 5): what on a sheet a click
 * can take, what the pointer is over, and which dimension one or two picks make.
 *
 * - **Pickable**: a view's exact, current lines only (never the quick placeholder, never lines
 *   of an older model): each model edge by its topological name (its pieces of every kind
 *   together, since a circle half hidden comes back as two curves), and each cylinder's or
 *   cone's outline by its face's name. Hidden lines count only where the view draws them,
 *   tangent edges likewise. A line edge's or an open curve's ends are its vertices.
 * - **What a pick is**: an edge whole (`{ ref }`), one end of an edge (`{ ref, at: 'start' |
 *   'end' }`, a vertex as the edge's end: the name of a vertex is never needed), or an outline
 *   (`{ ref, silhouette }`). Which end and which side come from the kernel (the hook asks).
 * - **Which dimension**: one line → its length; one circle → its diameter, an arc → its
 *   radius; one outline → its length; two lines (edges or outlines) → their distance when
 *   parallel, else their angle; two outlines of one face → the diameter across them; anything
 *   else of two (points, a circle's centre) → the linear distance. Where it is placed decides
 *   horizontal, vertical or aligned (`measureSheetDimension`), unless the panel fixes it.
 *
 * Frames: picking works in sheet mm (y down); shapes are in the view's own mm (y up).
 */
import type {
  BodyId,
  Sheet,
  SheetAnchor,
  SheetDimensionDirection,
  SheetDimensionItem,
  SheetRefAnchor,
  SheetView,
  SheetViewId,
  Vec2,
} from '@extrudo/core';
import { pieceAt, type ViewGeometry, type ViewPiece } from '@extrudo/kernel';
import { baseViewOf } from './viewLines';

/** A pick's 2D shape in the view's own mm. */
export type PickShape =
  | { type: 'line'; a: Vec2; b: Vec2 }
  | { type: 'circle'; centre: Vec2; radius: number; full: boolean }
  | { type: 'curve' };

/** Something on a view a click can take. */
export interface SheetPickable {
  /** `view|body|kind|name`: one per edge or outline. */
  key: string;
  view: SheetViewId;
  body: BodyId;
  /**
   * A model edge (by its name), a cylinder's or cone's outline (its face's name), or a face
   * under the pointer (`faceHit`: a leader's dot; never in `sheetPickables`).
   */
  kind: 'edge' | 'outline' | 'face';
  name: string;
  shape: PickShape;
  /** Its pieces as polylines in sheet mm: hit-testing and the highlight. */
  paths: Vec2[][];
  /** Its ends in sheet mm (none for a closed curve, an outline's are not points of the model). */
  ends: Vec2[];
}

/** What the pointer is over: a pickable, at one of its ends or along it. */
export interface SheetHit {
  pickable: SheetPickable;
  /** Index into `pickable.ends` when the pointer is at an end (a vertex). */
  end?: number;
  /** Where on a face the pointer is, sheet mm (a face hit only). */
  at?: Vec2;
}

/** A pick the kernel has named: what an anchor is made of. */
export type SheetPick =
  | { kind: 'edge'; view: SheetViewId; key: string; ref: SheetRefAnchor['ref']; shape: PickShape }
  | {
      kind: 'point';
      view: SheetViewId;
      key: string;
      ref: SheetRefAnchor['ref'];
      at: 'start' | 'end';
      /** Where, view mm. */
      p: Vec2;
    }
  | {
      kind: 'outline';
      view: SheetViewId;
      key: string;
      ref: SheetRefAnchor['ref'];
      silhouette: 1 | -1;
      /** The outline's line in the view, view mm. */
      shape: Extract<PickShape, { type: 'line' }>;
      face: string;
    }
  | {
      /** A face whole: a leader's dot, a cylinder's centre or axis. */
      kind: 'face';
      view: SheetViewId;
      key: string;
      ref: SheetRefAnchor['ref'];
      /** Where it was picked, view mm (a leader's dot), when picked on the face itself. */
      p?: Vec2;
    };

/** The panel's choices for the next dimension (plan §4.3's card, before placing). */
export interface DimensionChoices {
  direction: SheetDimensionDirection | 'auto';
  decimals?: number;
  before?: string;
  after?: string;
  reference?: boolean;
}

export const DIMENSION_DEFAULTS: DimensionChoices = { direction: 'auto' };

const TAU = 2 * Math.PI;
/** Arcs and ellipses are sampled at this angle for hit-testing, radians. */
const STEP = Math.PI / 36;

/** From a view's own mm to sheet mm: `k` its scale, `at` its origin on the sheet. */
export function toSheet(view: Pick<SheetView, 'at'>, k: number, p: Vec2): Vec2 {
  return [view.at[0] + k * p[0], view.at[1] - k * p[1]];
}

/** From sheet mm to a view's own mm. */
export function toView(view: Pick<SheetView, 'at'>, k: number, p: Vec2): Vec2 {
  return [(p[0] - view.at[0]) / k, (view.at[1] - p[1]) / k];
}

function samples(piece: ViewPiece): Vec2[] {
  switch (piece.type) {
    case 'line':
      return [piece.a, piece.b];
    case 'polyline':
      return piece.points;
    default: {
      const n = Math.max(2, Math.ceil((piece.end - piece.start) / STEP) + 1);
      return Array.from({ length: n }, (_, i) =>
        pieceAt(piece, piece.start + ((piece.end - piece.start) * i) / (n - 1)),
      );
    }
  }
}

const near = (a: number, b: number, tol = 1e-6) => Math.abs(a - b) <= tol;
const dist = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** The 2D shape a set of pieces makes, and its ends (view mm). */
function shapeOf(pieces: readonly ViewPiece[]): { shape: PickShape; ends: Vec2[] } {
  const lines = pieces.filter((p): p is Extract<ViewPiece, { type: 'line' }> => p.type === 'line');
  if (lines.length === pieces.length && lines.length > 0) {
    // Collinear pieces (an edge split into visible and hidden runs): one line, end to end.
    const first = lines[0] as Extract<ViewPiece, { type: 'line' }>;
    const d: Vec2 = [first.b[0] - first.a[0], first.b[1] - first.a[1]];
    const l = Math.hypot(d[0], d[1]) || 1;
    const u: Vec2 = [d[0] / l, d[1] / l];
    const points = lines.flatMap((p) => [p.a, p.b]);
    const off = (p: Vec2) => (p[0] - first.a[0]) * -u[1] + (p[1] - first.a[1]) * u[0];
    if (points.every((p) => near(off(p), 0, 1e-4))) {
      const t = (p: Vec2) => (p[0] - first.a[0]) * u[0] + (p[1] - first.a[1]) * u[1];
      const sorted = [...points].sort((p, q) => t(p) - t(q));
      const a = sorted[0] as Vec2;
      const b = sorted[sorted.length - 1] as Vec2;
      return { shape: { type: 'line', a, b }, ends: [a, b] };
    }
  }
  const arcs = pieces.filter((p): p is Extract<ViewPiece, { type: 'arc' }> => p.type === 'arc');
  if (arcs.length === pieces.length && arcs.length > 0) {
    const first = arcs[0] as Extract<ViewPiece, { type: 'arc' }>;
    const same = arcs.every(
      (a) =>
        near(a.center[0], first.center[0], 1e-4) &&
        near(a.center[1], first.center[1], 1e-4) &&
        near(a.radius, first.radius, 1e-4),
    );
    if (same) {
      const sweep = arcs.reduce((s, a) => s + (a.end - a.start), 0);
      const full = sweep >= TAU - 1e-3;
      // An arc's ends: the runs joined, its two loose ends (one run: its own).
      const ends = full ? [] : looseEnds(arcs.map((a) => [pieceAt(a, a.start), pieceAt(a, a.end)]));
      return {
        shape: { type: 'circle', centre: first.center, radius: first.radius, full },
        ends,
      };
    }
  }
  return {
    shape: { type: 'curve' },
    ends: looseEnds(
      pieces.map((p) => {
        const s = samples(p);
        return [s[0] as Vec2, s[s.length - 1] as Vec2];
      }),
    ),
  };
}

/** The ends of runs that no other run shares (a chain's two ends; none for a loop). */
function looseEnds(runs: readonly [Vec2, Vec2][]): Vec2[] {
  const all = runs.flat();
  return all.filter((p, i) => all.filter((q, j) => j !== i && dist(p, q) < 1e-4).length === 0);
}

/**
 * What on `sheet` a click can take: the curves of each view whose exact lines are current
 * (`geometry` exact and the view not `pending`), as the view draws them. `scaleOf` is a
 * view's scale as a number (2 for 2:1).
 */
export function sheetPickables(
  sheet: Sheet,
  geometry: ReadonlyMap<SheetViewId, ViewGeometry>,
  pending: ReadonlySet<SheetViewId>,
  scaleOf: (view: SheetView) => number,
): SheetPickable[] {
  const out: SheetPickable[] = [];
  for (const view of sheet.views) {
    const g = geometry.get(view.id);
    if (!g?.exact || pending.has(view.id)) continue;
    const style = baseViewOf(sheet, view)?.style ?? 'hidden';
    const k = scaleOf(view);
    const groups = new Map<
      string,
      { body: BodyId; kind: 'edge' | 'outline'; name: string; pieces: ViewPiece[] }
    >();
    for (const curve of g.curves) {
      if (curve.kind === 'hidden' && style !== 'hidden') continue;
      if (curve.kind === 'tangent' && view.tangentEdges === false) continue;
      const kind = curve.edge
        ? 'edge'
        : curve.kind === 'outline' && curve.face
          ? 'outline'
          : undefined;
      const name = curve.edge ?? curve.face;
      if (!kind || !name) continue;
      const key = `${view.id}|${curve.body}|${kind}|${name}`;
      const group = groups.get(key);
      if (group) group.pieces.push(...curve.pieces);
      else groups.set(key, { body: curve.body, kind, name, pieces: [...curve.pieces] });
    }
    for (const [key, { body, kind, name, pieces }] of groups) {
      const { shape, ends } = shapeOf(pieces);
      out.push({
        key,
        view: view.id,
        body,
        kind,
        name,
        shape,
        paths: pieces.map((p) => samples(p).map((q) => toSheet(view, k, q))),
        ends: kind === 'edge' ? ends.map((q) => toSheet(view, k, q)) : [],
      });
    }
  }
  return out;
}

function toSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const d: Vec2 = [b[0] - a[0], b[1] - a[1]];
  const l2 = d[0] * d[0] + d[1] * d[1];
  const t =
    l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1]) / l2));
  return dist(p, [a[0] + t * d[0], a[1] + t * d[1]]);
}

/** How far `p` is from a pickable's drawn pieces, sheet mm. */
export function distanceTo(pickable: SheetPickable, p: Vec2): number {
  let best = Infinity;
  for (const path of pickable.paths) {
    for (let i = 1; i < path.length; i++) {
      best = Math.min(best, toSegment(p, path[i - 1] as Vec2, path[i] as Vec2));
    }
  }
  return best;
}

/**
 * What a click at `p` (sheet mm) takes: the nearest pickable within `tol`, or one of its
 * ends (a vertex) when that end is within `tol` and not much further than the line itself
 * (so the middle of a short edge is the edge, its corner the vertex). `only` keeps to one
 * view (the first pick's).
 */
export function hitPickable(
  pickables: readonly SheetPickable[],
  p: Vec2,
  tol: number,
  only?: SheetViewId,
): SheetHit | undefined {
  let best: SheetHit | undefined;
  let bestAt = tol;
  let end: { hit: SheetHit; at: number } | undefined;
  for (const pickable of pickables) {
    if (only && pickable.view !== only) continue;
    pickable.ends.forEach((q, i) => {
      const d = dist(p, q);
      if (d <= tol && (!end || d < end.at)) end = { hit: { pickable, end: i }, at: d };
    });
    const d = distanceTo(pickable, p);
    if (d <= bestAt) [best, bestAt] = [{ pickable }, d];
  }
  if (end && end.at <= bestAt + 0.35 * tol) return end.hit;
  return best;
}

/** A pick's anchor. */
export function pickAnchor(pick: SheetPick): SheetAnchor {
  switch (pick.kind) {
    case 'edge':
      return { ref: pick.ref };
    case 'point':
      return { ref: pick.ref, at: pick.at };
    case 'outline':
      return { ref: pick.ref, silhouette: pick.silhouette };
    case 'face':
      return { ref: pick.ref };
  }
}

/** A pick's line in the view, if it is one (a straight edge, an outline). */
export function lineOf(pick: SheetPick): Extract<PickShape, { type: 'line' }> | undefined {
  if (pick.kind === 'outline') return pick.shape;
  if (pick.kind === 'edge' && pick.shape.type === 'line') return pick.shape;
  return undefined;
}

export function parallel(
  a: Extract<PickShape, { type: 'line' }>,
  b: Extract<PickShape, { type: 'line' }>,
) {
  const u: Vec2 = [a.b[0] - a.a[0], a.b[1] - a.a[1]];
  const v: Vec2 = [b.b[0] - b.a[0], b.b[1] - b.a[1]];
  const lu = Math.hypot(u[0], u[1]);
  const lv = Math.hypot(v[0], v[1]);
  if (lu === 0 || lv === 0) return false;
  return Math.abs(u[0] * v[1] - u[1] * v[0]) / (lu * lv) < 1e-6;
}

/** Whether one pick is a dimension by itself (a line, a circle, an outline), or waits for a second. */
export function completeAlone(pick: SheetPick): boolean {
  return dimensionOf([pick]) !== undefined;
}

/**
 * Which dimension `picks` (one or two, in one view) make: its type and anchors, or
 * `undefined` when they make none yet (a point alone, a curve alone).
 */
export function dimensionOf(
  picks: readonly SheetPick[],
): Pick<SheetDimensionItem, 'type' | 'anchors'> | undefined {
  const [a, b] = picks;
  if (!a || picks.some((p) => p.kind === 'face')) return undefined;
  if (!b) {
    if (a.kind === 'outline') return { type: 'linear', anchors: [pickAnchor(a)] };
    if (a.kind !== 'edge') return undefined;
    if (a.shape.type === 'line') return { type: 'linear', anchors: [pickAnchor(a)] };
    if (a.shape.type === 'circle') {
      return { type: a.shape.full ? 'diameter' : 'radius', anchors: [pickAnchor(a)] };
    }
    return undefined;
  }
  const anchors = [pickAnchor(a), pickAnchor(b)];
  if (a.kind === 'outline' && b.kind === 'outline' && a.face === b.face) {
    return a.silhouette === b.silhouette ? undefined : { type: 'diameter', anchors };
  }
  const la = lineOf(a);
  const lb = lineOf(b);
  if (la && lb && !parallel(la, lb)) return { type: 'angle', anchors };
  return { type: 'linear', anchors };
}

/** The dimension item the picks make, placed with its text at `at` (view mm). */
export function dimensionItem(
  id: SheetDimensionItem['id'],
  picks: readonly SheetPick[],
  at: Vec2,
  choices: DimensionChoices,
): SheetDimensionItem | undefined {
  const made = dimensionOf(picks);
  const first = picks[0];
  if (!made || !first) return undefined;
  return {
    kind: 'dimension',
    id,
    view: first.view,
    ...made,
    ...(made.type === 'linear' && choices.direction !== 'auto' && { direction: choices.direction }),
    at: [round(at[0]), round(at[1])],
    ...(choices.decimals !== undefined && { decimals: choices.decimals }),
    ...(choices.before && { before: choices.before }),
    ...(choices.after && { after: choices.after }),
    ...(choices.reference && { reference: true as const }),
  };
}

/** Stored places are kept to a thousandth of a mm. */
const round = (n: number) => Math.round(n * 1000) / 1000;

/** What the panel asks for next (plan §4.5's "with what to pick next"). */
export function nextStep(picks: readonly SheetPick[]): string {
  if (picks.length === 0) return 'Pick an edge, a point or a circle.';
  if (picks.length === 1 && !completeAlone(picks[0] as SheetPick)) {
    return 'Pick the second edge or point.';
  }
  if (picks.length === 1) return 'Click where the number goes, or pick a second edge or point.';
  return 'Click where the number goes.';
}
