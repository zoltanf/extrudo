/**
 * What a sketch dimension measures, and where (P1-07, FR-SK-08). Pure
 * geometry on the stored sketch: the Dimension tool reads a new dimension's
 * starting value here, driven dimensions show it, and the labels are placed
 * from the anchor and the measured points.
 */
import type { SketchEntityId } from '../ids';
import type { UnitKind } from '../schema';
import type { Vec2 } from './planes';
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

/**
 * The two points a distance runs between: a line's ends, two points, a
 * point and its foot on a line, or (two lines) the middle of the second and
 * its foot on the first. Undefined if an entity is missing.
 */
export function distanceEnds(sketch: SketchData, d: Distance): [Vec2, Vec2] | undefined {
  const a = sketch.entities[d.a];
  const b = d.b === undefined ? undefined : sketch.entities[d.b];
  if (a?.type === 'line' && d.b === undefined) return lineEnds(sketch, d.a);
  if (a?.type === 'point' && b?.type === 'point')
    return [
      [a.x, a.y],
      [b.x, b.y],
    ];
  const [pointId, lineId] = a?.type === 'line' ? [d.b, d.a] : [d.a, d.b];
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

/**
 * The dimension's value as the geometry stands: mm, or degrees for an
 * angle. Undefined if an entity is missing or the angle's lines are
 * degenerate.
 */
export function measureDimension(sketch: SketchData, d: SketchDimension): number | undefined {
  switch (d.type) {
    case 'distance': {
      if (d.b !== undefined && d.orientation === 'aligned') {
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
 * lines cross (between their middles if they are parallel).
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
