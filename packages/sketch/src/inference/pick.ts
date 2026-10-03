/**
 * Picking sketch entities under the cursor (P1-06): the constraint tools
 * pick the points and curves they constrain; selection picks and box-selects
 * (P1-09). Pure, sketch mm.
 */
import {
  entityPolylines,
  type SketchData,
  type SketchEntity,
  type SketchEntityId,
  type Vec2,
} from '@extrudo/core';
import { dist, dot, lerp, sub } from './geometry';

/** Which entities a pick may return. */
export type PickFilter = (entity: SketchEntity, id: SketchEntityId) => boolean;

/**
 * The entity under `cursor`: the nearest accepted point within `tolerance`
 * (mm), or else the nearest accepted curve within it. Points come first, as
 * they sit on the curves they end. A text (P4-03) is as near as its nearest
 * glyph curve. Undefined if nothing is close enough.
 */
export function pickEntity(
  sketch: SketchData,
  cursor: Vec2,
  tolerance: number,
  accept: PickFilter = () => true,
): SketchEntityId | undefined {
  let point: { id: SketchEntityId; d: number } | undefined;
  let curve: { id: SketchEntityId; d: number } | undefined;
  for (const [key, entity] of Object.entries(sketch.entities)) {
    const id = key as SketchEntityId;
    if (!accept(entity, id)) continue;
    if (entity.type === 'point') {
      const d = dist(cursor, [entity.x, entity.y]);
      if (d <= tolerance && (!point || d < point.d)) point = { id, d };
      continue;
    }
    const lines = entityPolylines(sketch, entity, id);
    if (lines.length === 0) continue;
    const d = Math.min(...lines.map((line) => polylineDistance(line, cursor)));
    if (d <= tolerance && (!curve || d < curve.d)) curve = { id, d };
  }
  return (point ?? curve)?.id;
}

/** The distance from `p` to the nearest segment of a polyline. */
export function polylineDistance(line: readonly Vec2[], p: Vec2): number {
  let best = Infinity;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1] as Vec2;
    const b = line[i] as Vec2;
    const d = sub(b, a);
    const len2 = dot(d, d);
    const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, dot(sub(p, a), d) / len2));
    best = Math.min(best, dist(p, lerp(a, b, t)));
  }
  return best;
}

/**
 * Box selection (P1-09, UI spec §3.2): the entities of `sketch` in the box
 * `corners` (a convex quadrilateral on the sketch plane, the screen
 * rectangle seen on a possibly tilted plane). A `window` box takes what lies
 * wholly inside; a `crossing` box also takes curves it touches. Points count
 * as entities, so a window around a line takes its ends too.
 */
export function boxSelect(
  sketch: SketchData,
  corners: readonly Vec2[],
  mode: 'window' | 'crossing',
  accept: PickFilter = () => true,
): SketchEntityId[] {
  const out: SketchEntityId[] = [];
  for (const [key, entity] of Object.entries(sketch.entities)) {
    const id = key as SketchEntityId;
    if (!accept(entity, id)) continue;
    const lines: Vec2[][] =
      entity.type === 'point' ? [[[entity.x, entity.y]]] : entityPolylines(sketch, entity, id);
    const points = lines.flat();
    if (points.length === 0) continue;
    const inside = points.map((p) => insideConvex(corners, p));
    const hit =
      mode === 'window'
        ? inside.every(Boolean)
        : inside.some(Boolean) || lines.some((line) => crossesPolygon(line, corners));
    if (hit) out.push(id);
  }
  return out;
}

/** Whether `p` lies inside (or on) the convex polygon `poly`, of either winding. */
export function insideConvex(poly: readonly Vec2[], p: Vec2): boolean {
  let sign = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i] as Vec2;
    const b = poly[(i + 1) % poly.length] as Vec2;
    const c = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
    if (c === 0) continue;
    const s = Math.sign(c);
    if (sign !== 0 && s !== sign) return false;
    sign = s;
  }
  return true;
}

/** Whether a segment of `line` crosses an edge of `poly`. */
function crossesPolygon(line: readonly Vec2[], poly: readonly Vec2[]): boolean {
  for (let i = 1; i < line.length; i++) {
    for (let j = 0; j < poly.length; j++) {
      if (
        segmentsCross(
          line[i - 1] as Vec2,
          line[i] as Vec2,
          poly[j] as Vec2,
          poly[(j + 1) % poly.length] as Vec2,
        )
      ) {
        return true;
      }
    }
  }
  return false;
}

function segmentsCross(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const orient = (p: Vec2, q: Vec2, r: Vec2) =>
    Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  return orient(a, b, c) * orient(a, b, d) <= 0 && orient(c, d, a) * orient(c, d, b) <= 0;
}
