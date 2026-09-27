/**
 * Sketch fillet and chamfer (P1-10, FR-SK-10) between two lines.
 *
 * The lines are cut back from their corner (where they meet, or would if
 * extended) and joined by a tangent arc or a straight chamfer. The corner
 * itself stays as a point, the "virtual sharp", held on both lines: whatever
 * was attached to the old corner (a dimension to it, a line length, another
 * curve's end) is attached to the sharp instead, so the design keeps its
 * sizes (ADR-0019).
 */
import {
  type ConstraintId,
  constraintRefs,
  type DimensionId,
  type SketchConstraint,
  type SketchData,
  type SketchDimension,
  type SketchEntityId,
  type Vec2,
} from '@extrudo/core';
import { add, cross, dist, dot, normalizeAngle, scale, sub } from '../inference/geometry';
import { tangentReversed } from '../solver/tangent';
import { ChangeBuilder, ModifyError, type ModifyResult, pointOf } from './change';

/** Two lines meeting at a corner, seen from the corner. */
export interface Corner {
  a: SketchEntityId;
  b: SketchEntityId;
  /** Where the lines meet (or would, extended). */
  sharp: Vec2;
  /** Unit directions from the sharp along each line, toward the part kept. */
  ua: Vec2;
  ub: Vec2;
  /** Each line's end at the corner, which moves, and its far end, which stays. */
  nearA: SketchEntityId;
  nearB: SketchEntityId;
  farA: SketchEntityId;
  farB: SketchEntityId;
  /** How far each far end is from the sharp: the most a fillet or chamfer can take. */
  reachA: number;
  reachB: number;
  /** The angle between `ua` and `ub`, radians in (0, π). */
  angle: number;
}

/**
 * The corner between lines `a` and `b`, keeping the side of each where it
 * was picked (`pickA`, `pickB`). Undefined if they aren't two distinct
 * lines, are parallel, or the corner is past a picked side's far end.
 */
export function cornerOf(
  data: SketchData,
  a: SketchEntityId,
  b: SketchEntityId,
  pickA: Vec2,
  pickB: Vec2,
): Corner | undefined {
  const la = data.entities[a];
  const lb = data.entities[b];
  if (a === b || la?.type !== 'line' || lb?.type !== 'line') return undefined;
  const a0 = pointOf(data, la.start);
  const a1 = pointOf(data, la.end);
  const b0 = pointOf(data, lb.start);
  const b1 = pointOf(data, lb.end);
  if (!a0 || !a1 || !b0 || !b1) return undefined;
  const da = sub(a1, a0);
  const db = sub(b1, b0);
  const denom = cross(da, db);
  if (Math.abs(denom) < 1e-9 * Math.hypot(...da) * Math.hypot(...db)) return undefined;
  const sharp = add(a0, scale(da, cross(sub(b0, a0), db) / denom));

  const side = (start: SketchEntityId, end: SketchEntityId, p0: Vec2, p1: Vec2, pick: Vec2) => {
    const len = dist(p0, p1);
    let u: Vec2 = [(p1[0] - p0[0]) / len, (p1[1] - p0[1]) / len];
    if (dot(sub(pick, sharp), u) < 0) u = [-u[0], -u[1]];
    const s0 = dot(sub(p0, sharp), u);
    const s1 = dot(sub(p1, sharp), u);
    const [near, far, reach] = s0 <= s1 ? [start, end, s1] : [end, start, s0];
    return { u, near, far, reach };
  };
  const A = side(la.start, la.end, a0, a1, pickA);
  const B = side(lb.start, lb.end, b0, b1, pickB);
  if (A.reach <= 1e-9 || B.reach <= 1e-9) return undefined;
  const angle = Math.acos(Math.max(-1, Math.min(1, dot(A.u, B.u))));
  if (angle < 1e-6 || angle > Math.PI - 1e-6) return undefined;
  return {
    a,
    b,
    sharp,
    ua: A.u,
    ub: B.u,
    nearA: A.near,
    nearB: B.near,
    farA: A.far,
    farB: B.far,
    reachA: A.reach,
    reachB: B.reach,
    angle,
  };
}

/**
 * The corner at a point where exactly two lines end (joined by a
 * coincident constraint, or at the same place), or undefined.
 */
export function cornerAtPoint(data: SketchData, point: SketchEntityId): Corner | undefined {
  const at = pointOf(data, point);
  if (!at) return undefined;
  const ends: { line: SketchEntityId; far: SketchEntityId }[] = [];
  for (const [key, e] of Object.entries(data.entities)) {
    if (e.type !== 'line') continue;
    for (const [end, far] of [
      [e.start, e.end],
      [e.end, e.start],
    ] as const) {
      const p = pointOf(data, end);
      if (p && dist(p, at) < 1e-6) ends.push({ line: key as SketchEntityId, far });
    }
  }
  if (ends.length !== 2) return undefined;
  const [first, second] = ends as [(typeof ends)[0], (typeof ends)[0]];
  const pa = pointOf(data, first.far);
  const pb = pointOf(data, second.far);
  return pa && pb ? cornerOf(data, first.line, second.line, pa, pb) : undefined;
}

/** A fillet's arc: tangent points, center, and the arc as stored (counter-clockwise). */
export interface FilletShape {
  ta: Vec2;
  tb: Vec2;
  center: Vec2;
  radius: number;
  /** The arc's start and end: the tangent points in counter-clockwise order. */
  start: Vec2;
  end: Vec2;
}

/** The largest radius that fits the corner (the arc may reach a far end, not pass it). */
export function maxFilletRadius(corner: Corner): number {
  return Math.min(corner.reachA, corner.reachB) * Math.tan(corner.angle / 2);
}

export function filletShape(corner: Corner, radius: number): FilletShape {
  const t = radius / Math.tan(corner.angle / 2);
  const ta = add(corner.sharp, scale(corner.ua, t));
  const tb = add(corner.sharp, scale(corner.ub, t));
  const bis = add(corner.ua, corner.ub);
  const len = Math.hypot(bis[0], bis[1]);
  const center = add(corner.sharp, scale(bis, radius / Math.sin(corner.angle / 2) / len));
  // The short way round between the tangent points is the fillet.
  const ccw = cross(corner.ua, corner.ub) > 0;
  const [start, end] = ccw ? [tb, ta] : [ta, tb];
  return { ta, tb, center, radius, start, end };
}

/** Points along a fillet's arc (the preview). */
export function filletPolyline(shape: FilletShape, segments = 24): Vec2[] {
  const { center, radius } = shape;
  const from = Math.atan2(shape.start[1] - center[1], shape.start[0] - center[0]);
  const sweep = normalizeAngle(
    Math.atan2(shape.end[1] - center[1], shape.end[0] - center[0]) - from,
  );
  const out: Vec2[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = from + (sweep * i) / segments;
    out.push([center[0] + radius * Math.cos(t), center[1] + radius * Math.sin(t)]);
  }
  return out;
}

/**
 * Rounds a corner with an arc of `radius` (`expr`, its dimension's
 * expression), tangent to both lines. Throws a `ModifyError` if it doesn't fit.
 */
export function fillet(
  data: SketchData,
  corner: Corner,
  radius: number,
  expr: string,
  newId: () => string,
): ModifyResult {
  if (!(radius > 0)) throw new ModifyError('The radius must be more than zero.');
  if (radius >= maxFilletRadius(corner) * (1 - 1e-9)) {
    throw new ModifyError("That radius doesn't fit this corner.");
  }
  const shape = filletShape(corner, radius);
  const b = new ChangeBuilder(data, newId);
  cutCorner(b, corner, shape.ta, shape.tb);
  const construction = lineConstruction(data, corner);
  const center = b.addPoint(shape.center);
  const start = b.addPoint(shape.start);
  const end = b.addPoint(shape.end);
  const arc = b.add({ type: 'arc', center, start, end, construction });
  const [atA, atB] =
    dist(shape.start, shape.ta) < dist(shape.end, shape.ta) ? [start, end] : [end, start];
  b.constrain({ type: 'coincident', a: corner.nearA, b: atA });
  b.constrain({ type: 'coincident', a: corner.nearB, b: atB });
  const view = b.view();
  for (const line of [corner.a, corner.b]) {
    const reversed = tangentReversed(view, line, arc);
    b.constrain(
      reversed === undefined
        ? { type: 'tangent', a: line, b: arc }
        : { type: 'tangent', a: line, b: arc, reversed },
    );
  }
  b.dimension({ type: 'radius', curve: arc, expr, driven: false });
  return b.result();
}

/** The largest equal-distance chamfer that fits the corner. */
export function maxChamfer(corner: Corner): number {
  return Math.min(corner.reachA, corner.reachB);
}

/** A chamfer's ends on each line, `distance` from the sharp. */
export function chamferEnds(corner: Corner, distance: number): [Vec2, Vec2] {
  return [
    add(corner.sharp, scale(corner.ua, distance)),
    add(corner.sharp, scale(corner.ub, distance)),
  ];
}

/**
 * Cuts a corner with a straight line `distance` (`expr`) from the sharp
 * along both lines. Two dimensions hold it: the first from the sharp along
 * line a, the second along line b, linked to the first's parameter.
 */
export function chamfer(
  data: SketchData,
  corner: Corner,
  distance: number,
  expr: string,
  newId: () => string,
): ModifyResult {
  if (!(distance > 0)) throw new ModifyError('The distance must be more than zero.');
  if (distance >= maxChamfer(corner) * (1 - 1e-9)) {
    throw new ModifyError("That distance doesn't fit this corner.");
  }
  const [ca, cb] = chamferEnds(corner, distance);
  const b = new ChangeBuilder(data, newId);
  const sharp = cutCorner(b, corner, ca, cb);
  const start = b.addPoint(ca);
  const end = b.addPoint(cb);
  b.add({ type: 'line', start, end, construction: lineConstruction(data, corner) });
  b.constrain({ type: 'coincident', a: corner.nearA, b: start });
  b.constrain({ type: 'coincident', a: corner.nearB, b: end });
  const aligned = { type: 'distance', orientation: 'aligned', driven: false } as const;
  const first = b.dimension({ ...aligned, a: sharp, b: corner.nearA, expr });
  const second = b.dimension({ ...aligned, a: sharp, b: corner.nearB, expr });
  b.links[second] = first;
  return b.result();
}

function lineConstruction(data: SketchData, corner: Corner): boolean {
  const la = data.entities[corner.a];
  const lb = data.entities[corner.b];
  return la?.type === 'line' && lb?.type === 'line' && la.construction && lb.construction;
}

/**
 * Moves both lines' corner ends to `ta` and `tb` and puts a virtual sharp
 * where the corner was, held on both lines. Constraints and dimensions on
 * the old corner ends move to the sharp; a line's length becomes the
 * distance from the sharp to its far end. What no longer means anything (a
 * midpoint, equal lengths, a tangency at the corner) goes.
 */
function cutCorner(b: ChangeBuilder, corner: Corner, ta: Vec2, tb: Vec2): SketchEntityId {
  const { data } = b;
  const sharp = b.addPoint(corner.sharp);
  const nears = new Set<SketchEntityId>([corner.nearA, corner.nearB]);
  const lines = new Set<SketchEntityId>([corner.a, corner.b]);
  const toSharp = (id: SketchEntityId) => (nears.has(id) ? sharp : id);

  const kept: SketchConstraint[] = [];
  const same = (x: SketchConstraint, y: SketchConstraint) =>
    JSON.stringify(x) === JSON.stringify(y);
  for (const [key, c] of Object.entries(data.constraints)) {
    const id = key as ConstraintId;
    const refs = constraintRefs(c);
    const onLine = refs.find((r) => lines.has(r));
    if (onLine !== undefined) {
      if (c.type === 'midpoint' || c.type === 'equal') {
        b.removeConstraint(id);
        continue;
      }
      if (c.type === 'symmetric' && c.axis !== onLine) {
        b.removeConstraint(id);
        continue;
      }
      if ((c.type === 'tangent' || c.type === 'smooth') && touchesCorner(data, c, corner)) {
        b.removeConstraint(id);
        continue;
      }
    }
    if (!refs.some((r) => nears.has(r))) continue;
    const moved = mapRefs(c, toSharp);
    const moveRefs = constraintRefs(moved);
    const degenerate = new Set(moveRefs).size < moveRefs.length;
    // Held on a corner line already: the sharp is on both lines anyway.
    const redundant =
      moved.type === 'pointOnCurve' && moved.point === sharp && lines.has(moved.curve);
    if (degenerate || redundant || kept.some((k) => same(k, moved))) {
      b.removeConstraint(id);
      continue;
    }
    kept.push(moved);
    b.replaceConstraint(id, moved);
  }
  b.constrain({ type: 'pointOnCurve', point: sharp, curve: corner.a });
  b.constrain({ type: 'pointOnCurve', point: sharp, curve: corner.b });

  for (const [key, d] of Object.entries(data.dimensions)) {
    const id = key as DimensionId;
    if (d.type === 'distance' && d.b === undefined && lines.has(d.a)) {
      const far = d.a === corner.a ? corner.farA : corner.farB;
      b.replaceDimension(id, { ...d, a: sharp, b: far });
      continue;
    }
    const moved = mapDimension(d, toSharp);
    if (moved === d) continue;
    // A distance between the two old corner ends would measure the sharp to itself.
    if (moved.type === 'distance' && moved.a === moved.b) b.removeDimension(id);
    else b.replaceDimension(id, moved);
  }

  b.move(corner.nearA, ta);
  b.move(corner.nearB, tb);
  return sharp;
}

/** Whether a tangency on a corner line is at the corner (joins the old corner end). */
function touchesCorner(data: SketchData, c: SketchConstraint, corner: Corner): boolean {
  const refs = constraintRefs(c);
  const nears = [corner.nearA, corner.nearB].map((id) => pointOf(data, id));
  const other = refs.find((r) => r !== corner.a && r !== corner.b);
  const e = other ? data.entities[other] : undefined;
  if (!e || (e.type !== 'line' && e.type !== 'arc')) return other === undefined;
  return [e.start, e.end].some((p) => {
    const q = pointOf(data, p);
    return q !== undefined && nears.some((n) => n !== undefined && dist(n, q) < 1e-6);
  });
}

function mapRefs(c: SketchConstraint, f: (id: SketchEntityId) => SketchEntityId): SketchConstraint {
  switch (c.type) {
    case 'pointOnCurve':
      return { ...c, point: f(c.point), curve: f(c.curve) };
    case 'midpoint':
      return { ...c, point: f(c.point), of: f(c.of) };
    case 'fix':
      return { ...c, entity: f(c.entity) };
    case 'symmetric':
      return { ...c, a: f(c.a), b: f(c.b), axis: f(c.axis) };
    case 'horizontal':
    case 'vertical':
      return c.b === undefined ? { ...c, a: f(c.a) } : { ...c, a: f(c.a), b: f(c.b) };
    default:
      return { ...c, a: f(c.a), b: f(c.b) };
  }
}

function mapDimension(
  d: SketchDimension,
  f: (id: SketchEntityId) => SketchEntityId,
): SketchDimension {
  switch (d.type) {
    case 'distance': {
      const a = f(d.a);
      const b = d.b === undefined ? undefined : f(d.b);
      if (a === d.a && b === d.b) return d;
      return b === undefined ? { ...d, a } : { ...d, a, b };
    }
    case 'angle': {
      const a = f(d.a);
      const b = f(d.b);
      return a === d.a && b === d.b ? d : { ...d, a, b };
    }
    default: {
      const curve = f(d.curve);
      return curve === d.curve ? d : { ...d, curve };
    }
  }
}
