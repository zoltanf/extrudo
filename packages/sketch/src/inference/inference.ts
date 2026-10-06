/**
 * Snapping and inference while drawing (P1-02, FR-SK-05, ADR-0012).
 *
 * `infer` takes the cursor in sketch coordinates and returns the point a
 * tool should use, what it snapped to and the alignment guides to draw. It
 * is pure: the tool layer turns the result into constraints with
 * `snapConstraints` and `alignmentConstraints` (`constraints.ts`).
 *
 * Priorities, first match wins:
 * 1. A point within tolerance: an endpoint, a center, a sketch point or the
 *    sketch origin (nearest first).
 * 2. An intersection of two curves or a midpoint (nearest first).
 * 3. A horizontal or vertical alignment guide that crosses a curve close
 *    to the cursor: the crossing (on-curve plus alignment).
 * 4. A point on a curve.
 * 5. Horizontal and vertical alignment with the anchor (the tool's last
 *    point) or another sketch point: both at once snap to the guides'
 *    crossing; one alone projects onto its guide, and the free coordinate
 *    snaps to the grid if grid snapping is on.
 * 6. The grid, if grid snapping is on.
 * 7. The cursor itself.
 */
import type { SketchData, Vec2 } from '@extrudo/core';
import {
  arcPoints,
  type Curve,
  dist,
  intersectCurves,
  intersectRay,
  lerp,
  nearestOnCurve,
  sketchCurves,
} from './geometry';

export type SnapKind =
  | 'endpoint'
  | 'center'
  | 'point'
  | 'origin'
  | 'intersection'
  | 'midpoint'
  | 'onCurve'
  | 'grid';

/**
 * What the point snapped to. `ids` names the sketch entities: the point for
 * `endpoint`, `center` and `point`; the curve for `midpoint` and `onCurve`;
 * both curves for `intersection`; none for `origin` and `grid`.
 */
export interface Snap {
  kind: SnapKind;
  point: Vec2;
  ids: string[];
}

/** Where an alignment guide starts: the tool's own last point, or a sketch point. */
export type AlignmentSource = { kind: 'anchor' } | { kind: 'point'; id: string };

/**
 * The result shares `x` (vertical) or `y` (horizontal) with `from`; the
 * guide is drawn dashed from `from` to the result.
 */
export interface Alignment {
  axis: 'horizontal' | 'vertical';
  source: AlignmentSource;
  from: Vec2;
}

export interface Inference {
  /** The point to use. */
  point: Vec2;
  /** The cursor, unsnapped. */
  cursor: Vec2;
  snap: Snap | undefined;
  alignments: Alignment[];
}

export interface InferenceOptions {
  /** Snap distance in mm: a few pixels at the current zoom. */
  tolerance: number;
  /** The tool's last point: alignment guides start here first. */
  anchor?: Vec2;
  /** Entities to ignore (the geometry being drawn or dragged). */
  exclude?: ReadonlySet<string>;
  /** Grid step in mm when grid snapping is on. */
  grid?: number;
  /** False turns inference and grid snapping off (a held modifier): the cursor is used as is. */
  enabled?: boolean;
}

const ORIGIN: Vec2 = [0, 0];

interface Target {
  kind: SnapKind;
  point: Vec2;
  ids: string[];
}

interface Analysis {
  curves: Curve[];
  /** Endpoints, centers, loose points and the origin. */
  points: Target[];
  /** Midpoints and intersections. */
  derived: Target[];
}

// Per sketch object: documents are immutable, so the analysis stays valid.
const cache = new WeakMap<SketchData, Analysis>();

function analyse(sketch: SketchData): Analysis {
  const hit = cache.get(sketch);
  if (hit) return hit;
  const curves = sketchCurves(sketch);
  const role = new Map<string, 'endpoint' | 'center'>();
  for (const e of Object.values(sketch.entities)) {
    if (e.type === 'line') {
      role.set(e.start, 'endpoint');
      role.set(e.end, 'endpoint');
    } else if (e.type === 'circle') role.set(e.center, 'center');
    else if (e.type === 'arc') {
      role.set(e.center, 'center');
      role.set(e.start, 'endpoint');
      role.set(e.end, 'endpoint');
    } else if (e.type === 'ellipse') role.set(e.center, 'center');
    else if (e.type === 'spline' && !(e.closed && e.mode !== 'conic')) {
      // A closed spline (P4-12) has no ends: its first point is an ordinary one.
      role.set(e.points[0] as string, 'endpoint');
      role.set(e.points[e.points.length - 1] as string, 'endpoint');
    }
  }
  const points: Target[] = [{ kind: 'origin', point: ORIGIN, ids: [] }];
  for (const [id, e] of Object.entries(sketch.entities)) {
    if (e.type === 'point')
      points.push({ kind: role.get(id) ?? 'point', point: [e.x, e.y], ids: [id] });
  }
  const derived: Target[] = [];
  for (const c of curves) {
    if (c.kind === 'line')
      derived.push({ kind: 'midpoint', point: lerp(c.a, c.b, 0.5), ids: [c.id] });
    else if (c.kind === 'arc')
      derived.push({ kind: 'midpoint', point: arcPoints(c).mid, ids: [c.id] });
  }
  for (let i = 0; i < curves.length; i++) {
    for (let j = i + 1; j < curves.length; j++) {
      const a = curves[i] as Curve;
      const b = curves[j] as Curve;
      for (const p of intersectCurves(a, b)) {
        derived.push({ kind: 'intersection', point: p, ids: [a.id, b.id] });
      }
    }
  }
  const analysis = { curves, points, derived };
  cache.set(sketch, analysis);
  return analysis;
}

/** Snaps and aligns the cursor (see the module comment for the rules). */
export function infer(sketch: SketchData, cursor: Vec2, options: InferenceOptions): Inference {
  const { tolerance, anchor, grid, enabled = true } = options;
  const exclude = options.exclude ?? new Set<string>();
  const result = (point: Vec2, snap?: Snap, alignments: Alignment[] = []): Inference => ({
    point,
    cursor,
    snap,
    alignments,
  });
  const gridSnap = (): Inference =>
    grid && grid > 0
      ? result(snapToGrid(cursor, grid), { kind: 'grid', point: snapToGrid(cursor, grid), ids: [] })
      : result(cursor);
  if (!enabled) return result(cursor);

  const { curves: all, points, derived } = analyse(sketch);
  const allowed = (t: Target) => t.ids.every((id) => !exclude.has(id));
  const curves = all.filter((c) => !exclude.has(c.id));

  // 1 and 2: points, then intersections and midpoints.
  for (const targets of [points, derived]) {
    const best = nearest(targets.filter(allowed), cursor, tolerance);
    if (best) return result(best.point, { ...best });
  }

  // Alignment candidates: the anchor first, then sketch points (not the origin).
  const sources: { source: AlignmentSource; at: Vec2 }[] = [];
  if (anchor) sources.push({ source: { kind: 'anchor' }, at: anchor });
  for (const t of points) {
    if (t.kind !== 'origin' && allowed(t) && !(anchor && dist(anchor, t.point) < 1e-9)) {
      sources.push({ source: { kind: 'point', id: t.ids[0] as string }, at: t.point });
    }
  }
  const h = bestAlignment(sources, cursor, tolerance, 'horizontal');
  const v = bestAlignment(sources, cursor, tolerance, 'vertical');

  // 3: a guide crossing a curve near the cursor.
  let crossing: { point: Vec2; curve: string; alignment: Alignment; d: number } | undefined;
  for (const alignment of [h, v]) {
    if (!alignment) continue;
    const ray = {
      a: alignment.from,
      d: (alignment.axis === 'horizontal' ? [1, 0] : [0, 1]) as Vec2,
    };
    for (const curve of curves) {
      for (const p of intersectRay(ray, curve)) {
        const d = dist(p, cursor);
        if (d <= tolerance && (!crossing || d < crossing.d)) {
          crossing = { point: p, curve: curve.id, alignment, d };
        }
      }
    }
  }
  if (crossing) {
    return result(
      crossing.point,
      { kind: 'onCurve', point: crossing.point, ids: [crossing.curve] },
      [crossing.alignment],
    );
  }

  // 4: on a curve.
  let onCurve: { point: Vec2; id: string; d: number } | undefined;
  for (const curve of curves) {
    const p = nearestOnCurve(curve, cursor);
    const d = dist(p, cursor);
    if (d <= tolerance && (!onCurve || d < onCurve.d)) onCurve = { point: p, id: curve.id, d };
  }
  if (onCurve) {
    return result(onCurve.point, { kind: 'onCurve', point: onCurve.point, ids: [onCurve.id] });
  }

  // 5: alignment.
  if (h && v) return result([v.from[0], h.from[1]], undefined, [h, v]);
  if (h || v) {
    const alignment = (h ?? v) as Alignment;
    const free = alignment.axis === 'horizontal' ? 0 : 1;
    const point: [number, number] = [...cursor];
    point[1 - free] = alignment.from[1 - free] as number;
    if (grid && grid > 0) point[free] = Math.round((point[free] as number) / grid) * grid;
    return result(point, undefined, [alignment]);
  }

  // 6 and 7.
  return gridSnap();
}

export function snapToGrid(p: Vec2, step: number): Vec2 {
  // `+ 0` turns −0 into 0.
  return [Math.round(p[0] / step) * step + 0, Math.round(p[1] / step) * step + 0];
}

function nearest(targets: readonly Target[], p: Vec2, tolerance: number): Target | undefined {
  let best: Target | undefined;
  let bestD = tolerance;
  for (const t of targets) {
    const d = dist(t.point, p);
    if (d <= bestD) {
      best = t;
      bestD = d;
    }
  }
  return best;
}

function bestAlignment(
  sources: readonly { source: AlignmentSource; at: Vec2 }[],
  cursor: Vec2,
  tolerance: number,
  axis: Alignment['axis'],
): Alignment | undefined {
  const k = axis === 'horizontal' ? 1 : 0;
  let best: Alignment | undefined;
  let bestD = tolerance;
  for (const { source, at } of sources) {
    const d = Math.abs((at[k] as number) - (cursor[k] as number));
    // Strictly better, so the anchor (listed first) wins ties.
    if (d < bestD || (best === undefined && d <= bestD)) {
      best = { axis, source, from: at };
      bestD = d;
    }
  }
  return best;
}
