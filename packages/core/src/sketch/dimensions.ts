/**
 * What a sketch dimension measures, and where (P1-07, FR-SK-08). Pure
 * geometry on the stored sketch: the Dimension tool reads a new dimension's
 * starting value here, driven dimensions show it, and the labels are placed
 * from the anchor and the measured points.
 */
import type { SketchEntityId } from '../ids';
import type { UnitKind } from '../schema';
import type { Vec2 } from './planes';
import { isDatumRef, projectionOf } from './projection';
import type { SketchData, SketchDimension, SketchDimensionType } from './schema';

/** The name the UI gives each dimension type. */
export const DIMENSION_LABELS: Readonly<Record<SketchDimensionType, string>> = {
  distance: 'Distance',
  radius: 'Radius',
  diameter: 'Diameter',
  angle: 'Angle',
};

/** The unit a dimension's expression evaluates to. */
export function dimensionUnit(d: SketchDimension): Extract<UnitKind, 'length' | 'angle'> {
  return d.type === 'angle' ? 'angle' : 'length';
}

/** The entities a dimension refers to, in field order. */
export function dimensionRefs(d: SketchDimension): SketchEntityId[] {
  switch (d.type) {
    case 'distance':
      return d.b === undefined ? [d.a] : [d.a, d.b];
    case 'radius':
    case 'diameter':
      return [d.curve];
    case 'angle':
      return [d.a, d.b];
  }
}

type Distance = Extract<SketchDimension, { type: 'distance' }>;

/** Whether `id` is a line that is a datum axis's stored projection (ADR-0093). */
export function isDatumLine(sketch: SketchData, id: SketchEntityId | undefined): boolean {
  if (id === undefined || sketch.entities[id]?.type !== 'line') return false;
  const ref = projectionOf(sketch, id)?.projection.ref;
  return ref !== undefined && isDatumRef(ref);
}

/**
 * The two points a distance runs between: a line's ends, two points, a
 * point and its foot on a line, or (two lines) the middle of the second and
 * its foot on the first. If only the second line is a datum axis projection
 * (ADR-0093), the two swap: its middle is arbitrary, so the distance hangs on
 * the sketch line. Undefined if an entity is missing.
 */
export function distanceEnds(sketch: SketchData, d: Distance): [Vec2, Vec2] | undefined {
  const a = sketch.entities[d.a];
  const b = d.b === undefined ? undefined : sketch.entities[d.b];
  if (isRound(a) || isRound(b)) return roundEnds(sketch, d);
  if (a?.type === 'line' && d.b === undefined) return lineEnds(sketch, d.a);
  if (a?.type === 'point' && b?.type === 'point')
    return [
      [a.x, a.y],
      [b.x, b.y],
    ];
  let [pointId, lineId] = a?.type === 'line' ? [d.b, d.a] : [d.a, d.b];
  if (
    a?.type === 'line' &&
    b?.type === 'line' &&
    isDatumLine(sketch, d.b) &&
    !isDatumLine(sketch, d.a)
  )
    [pointId, lineId] = [d.a, d.b];
  const on = lineId === undefined ? undefined : lineEnds(sketch, lineId);
  if (!on || pointId === undefined) return undefined;
  const other = sketch.entities[pointId];
  let p: Vec2 | undefined;
  if (other?.type === 'point') p = [other.x, other.y];
  else if (other?.type === 'line') {
    const ends = lineEnds(sketch, pointId);
    p = ends && mid(ends[0], ends[1]);
  }
  return p && [p, foot(p, on[0], on[1])];
}

export type RoundSide = 'near' | 'far';

const isRound = (e: SketchData['entities'][SketchEntityId] | undefined) =>
  e?.type === 'circle' || e?.type === 'arc';

const sketchEntity = (sketch: SketchData, id: SketchEntityId | undefined) =>
  id === undefined ? undefined : sketch.entities[id];

/**
 * A point on the circle of circle or arc `roundId` (ADR-0112): aligned, on
 * the ray from its center through `towards` (`near`) or the opposite one
 * (`far`); horizontal or vertical, the quadrant point left or right (below or
 * above) of the center on the side `towards` is (`near`) or the other one. An
 * arc counts as its whole circle. Undefined if the entity is not round.
 */
export function roundEdgePoint(
  sketch: SketchData,
  roundId: SketchEntityId,
  side: RoundSide,
  towards: Vec2,
  orientation: Distance['orientation'] = 'aligned',
): Vec2 | undefined {
  const e = sketch.entities[roundId];
  if (e?.type !== 'circle' && e?.type !== 'arc') return undefined;
  const c = at(sketch, e.center);
  const r = radiusOf(sketch, roundId);
  if (!c || r === undefined) return undefined;
  let u: Vec2;
  if (orientation === 'horizontal') u = [towards[0] < c[0] ? -1 : 1, 0];
  else if (orientation === 'vertical') u = [0, towards[1] < c[1] ? -1 : 1];
  else {
    const v = sub(towards, c);
    const len = Math.hypot(...v);
    u = len > 1e-12 ? [v[0] / len, v[1] / len] : [1, 0];
  }
  const k = side === 'far' ? -r : r;
  return [c[0] + u[0] * k, c[1] + u[1] * k];
}

/**
 * Where a line is met from `p` (ADR-0112): square to it (aligned), along the
 * horizontal through `p` (horizontal), or the vertical (vertical). The foot of
 * the perpendicular when the line runs along that direction.
 */
export function lineMeet(
  p: Vec2,
  [a, b]: readonly [Vec2, Vec2],
  orientation: Distance['orientation'],
): Vec2 {
  if (orientation !== 'aligned') {
    const i = orientation === 'horizontal' ? 1 : 0;
    const d = b[i] - a[i];
    if (Math.abs(d) > 1e-12 * (Math.hypot(...sub(b, a)) || 1)) {
      const t = (p[i] - a[i]) / d;
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    }
  }
  return foot(p, a, b);
}

/**
 * A distance with a circle or an arc (ADR-0112), its ends in `a`, `b` order:
 * each round's edge point toward the other entity (a point, the center's
 * meeting point on a line, the other round's center), and a line's meeting
 * point from the other end.
 */
function roundEnds(sketch: SketchData, d: Distance): [Vec2, Vec2] | undefined {
  if (d.b === undefined) return undefined;
  const o = d.orientation;
  const centre = (id: SketchEntityId): Vec2 | undefined => {
    const e = sketch.entities[id];
    if (e?.type === 'point') return [e.x, e.y];
    if (e?.type === 'circle' || e?.type === 'arc') return at(sketch, e.center);
    return undefined;
  };
  const ka = sketch.entities[d.a]?.type;
  const kb = sketch.entities[d.b]?.type;
  if (ka === 'line' || kb === 'line') {
    const [lineId, roundId, side] = ka === 'line' ? [d.a, d.b, d.sideB] : [d.b, d.a, d.sideA];
    const on = lineEnds(sketch, lineId);
    const c = centre(roundId);
    if (!on || !c) return undefined;
    const edge = roundEdgePoint(sketch, roundId, side ?? 'near', lineMeet(c, on, o), o);
    if (!edge) return undefined;
    const meet = lineMeet(edge, on, o);
    return ka === 'line' ? [meet, edge] : [edge, meet];
  }
  const ca = centre(d.a);
  const cb = centre(d.b);
  if (!ca || !cb) return undefined;
  const end = (id: SketchEntityId, side: RoundSide | undefined, own: Vec2, other: Vec2) =>
    isRound(sketch.entities[id]) ? roundEdgePoint(sketch, id, side ?? 'near', other, o) : own;
  const p = end(d.a, d.sideA, ca, cb);
  const q = end(d.b, d.sideB, cb, ca);
  return p && q && [p, q];
}

/**
 * The dimension's value as the geometry stands: mm, or degrees for an
 * angle. Undefined if an entity is missing or the angle's lines are
 * degenerate.
 */
export function measureDimension(sketch: SketchData, d: SketchDimension): number | undefined {
  switch (d.type) {
    case 'distance': {
      const round = isRound(sketch.entities[d.a]) || isRound(sketchEntity(sketch, d.b));
      if (!round && d.b !== undefined && d.orientation === 'aligned') {
        // A point (or the second line's start, as the solver has it) to a line.
        const a = sketch.entities[d.a];
        const [pointId, lineId] = a?.type === 'line' ? [d.b, d.a] : [d.a, d.b];
        const on = lineEnds(sketch, lineId);
        const other = sketch.entities[pointId];
        const p =
          other?.type === 'point'
            ? at(sketch, pointId)
            : other?.type === 'line'
              ? lineEnds(sketch, pointId)?.[0]
              : undefined;
        if (on && p) return Math.hypot(...sub(foot(p, on[0], on[1]), p));
      }
      const ends = distanceEnds(sketch, d);
      if (!ends) return undefined;
      const [p, q] = ends;
      if (d.orientation === 'horizontal') return Math.abs(q[0] - p[0]);
      if (d.orientation === 'vertical') return Math.abs(q[1] - p[1]);
      return Math.hypot(q[0] - p[0], q[1] - p[1]);
    }
    case 'radius':
    case 'diameter': {
      const r = radiusOf(sketch, d.curve);
      return r === undefined ? undefined : d.type === 'diameter' ? 2 * r : r;
    }
    case 'angle': {
      const u = direction(sketch, d.a);
      const v = direction(sketch, d.b);
      if (!u || !v) return undefined;
      const cos = (u[0] * v[0] + u[1] * v[1]) / (Math.hypot(...u) * Math.hypot(...v));
      const between = (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
      return d.supplement ? 180 - between : between;
    }
  }
}

/**
 * The point a dimension's label offset (`label`) is measured from: the
 * middle of a distance, the center of a circle or arc, where an angle's
 * lines cross (between their middles if they are parallel). A distance
 * follows `distanceEnds`, so a line's distance to an axis hangs on the line.
 */
export function dimensionAnchor(sketch: SketchData, d: SketchDimension): Vec2 | undefined {
  switch (d.type) {
    case 'distance': {
      const ends = distanceEnds(sketch, d);
      return ends && mid(ends[0], ends[1]);
    }
    case 'radius':
    case 'diameter': {
      const e = sketch.entities[d.curve];
      return e?.type === 'circle' || e?.type === 'arc' ? at(sketch, e.center) : undefined;
    }
    case 'angle': {
      const a = lineEnds(sketch, d.a);
      const b = lineEnds(sketch, d.b);
      if (!a || !b) return undefined;
      return lineCrossing(a, b) ?? mid(mid(a[0], a[1]), mid(b[0], b[1]));
    }
  }
}

/** Where two infinite lines cross; undefined if they are (nearly) parallel. */
export function lineCrossing(
  [p, p2]: readonly [Vec2, Vec2],
  [q, q2]: readonly [Vec2, Vec2],
): Vec2 | undefined {
  const r = sub(p2, p);
  const s = sub(q2, q);
  const denom = r[0] * s[1] - r[1] * s[0];
  const scale = Math.hypot(...r) * Math.hypot(...s);
  if (scale === 0 || Math.abs(denom) < 1e-9 * scale) return undefined;
  const qp = sub(q, p);
  const t = (qp[0] * s[1] - qp[1] * s[0]) / denom;
  return [p[0] + r[0] * t, p[1] + r[1] * t];
}

/** A line's start and end points. */
export function lineEnds(sketch: SketchData, id: SketchEntityId): [Vec2, Vec2] | undefined {
  const line = sketch.entities[id];
  if (line?.type !== 'line') return undefined;
  const p = at(sketch, line.start);
  const q = at(sketch, line.end);
  return p && q && [p, q];
}

/** A circle's or an arc's radius. */
export function radiusOf(sketch: SketchData, id: SketchEntityId): number | undefined {
  const e = sketch.entities[id];
  if (e?.type === 'circle') return e.radius;
  if (e?.type !== 'arc') return undefined;
  const c = at(sketch, e.center);
  const s = at(sketch, e.start);
  return c && s && Math.hypot(s[0] - c[0], s[1] - c[1]);
}

function direction(sketch: SketchData, id: SketchEntityId): Vec2 | undefined {
  const ends = lineEnds(sketch, id);
  if (!ends) return undefined;
  const d = sub(ends[1], ends[0]);
  return Math.hypot(...d) > 0 ? d : undefined;
}

function at(sketch: SketchData, id: SketchEntityId): Vec2 | undefined {
  const p = sketch.entities[id];
  return p?.type === 'point' ? [p.x, p.y] : undefined;
}

const sub = (a: Vec2, b: Vec2): [number, number] => [a[0] - b[0], a[1] - b[1]];
const mid = (a: Vec2, b: Vec2): Vec2 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

/** The foot of the perpendicular from `p` to the infinite line through `a` and `b`. */
function foot(p: Vec2, a: Vec2, b: Vec2): Vec2 {
  const d = sub(b, a);
  const len2 = d[0] * d[0] + d[1] * d[1];
  if (len2 === 0) return a;
  const t = ((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1]) / len2;
  return [a[0] + d[0] * t, a[1] + d[1] * t];
}
