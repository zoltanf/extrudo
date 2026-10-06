/**
 * Sketch offset (P1-10, FR-SK-10): a copy of a chain of lines, arcs and
 * splines (or a circle, or a closed spline) at a distance to one side.
 *
 * The chain is the picked curve and every line or arc joined to it end to
 * end (a coincident constraint, and no third curve at the joint). Each
 * offset line is parallel to its original, each arc concentric; the pieces
 * meet where the offset curves cross (corners stay sharp; tangent joints
 * stay tangent). Every offset line gets a distance dimension to its
 * original, all linked to the first, so one value drives the offset. The
 * later lines' parallels and distances are `auto`: tangent joints to arcs
 * may already set those lines. A chain
 * of arcs only gets the first arc's radius (or the circle's diameter).
 *
 * A spline has no exact offset (ADR-0063's P4-12 amendment, A4): its offset is
 * a fit spline through offsets of its samples, checked against the true offset
 * to `OFFSET_TOLERANCE`. A chain with a spline in it carries no dimension (the
 * fit spline can't be held to its original), and its offset spline is fixed.
 */
import {
  type BSpline,
  CONIC_SEGMENTS_PER_SPAN,
  closedFitSpline,
  fitSpline,
  type SketchConstraint,
  type SketchData,
  type SketchEntity,
  type SketchEntityId,
  type SketchSpline,
  SPLINE_SEGMENTS_PER_SPAN,
  splineCurve,
  splineDerivative,
  splinePoint,
  type Vec2,
} from '@extrudo/core';
import {
  add,
  type Curve,
  cross,
  dist,
  dot,
  intersectCurves,
  scale,
  sub,
} from '../inference/geometry';
import { tangentReversed } from '../solver/tangent';
import { ChangeBuilder, ModifyError, type ModifyResult, pointOf } from './change';

/** A curve of a chain, and whether the chain runs through it end → start. */
export interface ChainLink {
  id: SketchEntityId;
  reversed: boolean;
}

export interface Chain {
  links: ChainLink[];
  /** The last link's end meets the first's start. */
  closed: boolean;
}

/** How close (mm) the ends of two projected curves must be to count as one joint. */
const PROJECTED_JOINT = 1e-5;

/** The IDs of the curves that are projections of model geometry (P2-09). */
function projectedCurves(data: SketchData): Set<string> {
  const out = new Set<string>();
  for (const projection of Object.values(data.projections ?? {})) {
    for (const curve of Object.values(projection.curves)) if (curve) out.add(curve);
  }
  return out;
}

/** The unit direction of a line, or of an arc at the end `at`, there. */
function directionAt(data: SketchData, link: ChainLink, atEnd: boolean): Vec2 | undefined {
  const e = data.entities[link.id];
  if (e?.type === 'line') {
    const a = pointOf(data, e.start) as Vec2;
    const c = pointOf(data, e.end) as Vec2;
    const len = dist(a, c);
    return len > 0 ? [(c[0] - a[0]) / len, (c[1] - a[1]) / len] : undefined;
  }
  if (e?.type === 'arc') {
    const centre = pointOf(data, e.center) as Vec2;
    const p = pointOf(data, atEnd ? e.end : e.start) as Vec2;
    const r = dist(centre, p);
    return r > 0 ? [-(p[1] - centre[1]) / r, (p[0] - centre[0]) / r] : undefined;
  }
  return undefined;
}

/** Whether chain links `a` then `b` meet with the same tangent direction (up to a sign). */
function smoothJoint(data: SketchData, a: ChainLink, b: ChainLink): boolean {
  // The joint is where `a` leaves and `b` arrives, whichever way each is stored.
  const da = directionAt(data, a, !a.reversed);
  const db = directionAt(data, b, b.reversed);
  return da !== undefined && db !== undefined && Math.abs(cross(da, db)) < SMOOTH;
}

/** Tangent directions this close (sine of the angle) count as one smooth joint. */
const SMOOTH = 1e-6;

/** The two ends of a curve a chain runs through: a line's, an arc's, an open spline's. */
function endsOf(
  e: SketchEntity | undefined,
): { start: SketchEntityId; end: SketchEntityId } | undefined {
  if (e?.type === 'line' || e?.type === 'arc') return { start: e.start, end: e.end };
  if (e?.type === 'spline' && !isClosedSpline(e)) {
    return {
      start: e.points[0] as SketchEntityId,
      end: e.points[e.points.length - 1] as SketchEntityId,
    };
  }
  return undefined;
}

/** A closed fit or control spline (ADR-0063's P4-12 amendment, A2): a chain on its own. */
const isClosedSpline = (e: SketchSpline): boolean =>
  e.closed === true && e.mode !== 'conic' && e.points.length >= 3;

/**
 * The chain through curve `id`: lines and arcs joined end to end by
 * coincident constraints, stopping where more than two curves meet. A
 * circle is a chain on its own. Undefined for other entities; a text is
 * refused (`ModifyError`).
 */
export function chainOf(data: SketchData, id: SketchEntityId): Chain | undefined {
  const start = data.entities[id];
  if (start?.type === 'text') throw new ModifyError("Text can't be offset.");
  if (start?.type === 'circle') return { links: [{ id, reversed: false }], closed: true };
  if (start?.type === 'spline' && isClosedSpline(start)) {
    return { links: [{ id, reversed: false }], closed: true };
  }
  const startEnds = endsOf(start);
  if (!startEnds) return undefined;

  // Points joined by coincident constraints, transitively.
  const parent = new Map<string, string>();
  const find = (p: string): string => {
    const q = parent.get(p);
    if (q === undefined || q === p) return p;
    const root = find(q);
    parent.set(p, root);
    return root;
  };
  for (const c of Object.values(data.constraints)) {
    if (c.type === 'coincident') parent.set(find(c.a), find(c.b));
  }
  // Projected curves (P2-09) carry no constraints between them, but the edges of a projected
  // face outline meet where the model's edges do: their ends at the same place are joined too
  // (P3-17). Only projected curves: two sketched lines that merely end at one spot aren't.
  const projected = projectedCurves(data);
  if (projected.has(id)) {
    const loose: { point: string; at: Vec2 }[] = [];
    for (const [key, e] of Object.entries(data.entities)) {
      if (!projected.has(key) || (e.type !== 'line' && e.type !== 'arc')) continue;
      for (const point of [e.start, e.end]) {
        const at = pointOf(data, point);
        if (at) loose.push({ point, at });
      }
    }
    for (let i = 0; i < loose.length; i++) {
      for (let j = i + 1; j < loose.length; j++) {
        const [p, q] = [loose[i], loose[j]] as [(typeof loose)[0], (typeof loose)[0]];
        if (dist(p.at, q.at) <= PROJECTED_JOINT && find(p.point) !== find(q.point)) {
          parent.set(find(p.point), find(q.point));
        }
      }
    }
  }
  const ends = new Map<string, { curve: SketchEntityId; point: SketchEntityId }[]>();
  for (const [key, e] of Object.entries(data.entities)) {
    const curveEnds = endsOf(e);
    if (!curveEnds) continue;
    for (const point of [curveEnds.start, curveEnds.end]) {
      const root = find(point);
      const list = ends.get(root) ?? [];
      list.push({ curve: key as SketchEntityId, point });
      ends.set(root, list);
    }
  }
  /** The one other curve that ends at `point`, and the end it meets there. */
  const next = (curve: SketchEntityId, point: SketchEntityId) => {
    const list = ends.get(find(point)) ?? [];
    if (list.length !== 2) return undefined;
    return list.find((x) => x.curve !== curve);
  };
  const open = (cid: SketchEntityId) =>
    endsOf(data.entities[cid]) as { start: SketchEntityId; end: SketchEntityId };

  // Walk forward from the end, then backward from the start.
  const forward: ChainLink[] = [{ id, reversed: false }];
  const seen = new Set<SketchEntityId>([id]);
  let closed = false;
  let at: ChainLink = { id, reversed: false };
  for (;;) {
    const e = open(at.id);
    const out = at.reversed ? e.start : e.end;
    const n = next(at.id, out);
    if (!n) break;
    if (n.curve === id) {
      closed = n.point === startEnds.start;
      break;
    }
    if (seen.has(n.curve)) break;
    seen.add(n.curve);
    at = { id: n.curve, reversed: n.point !== open(n.curve).start };
    forward.push(at);
  }
  if (closed) return { links: forward, closed };
  const backward: ChainLink[] = [];
  at = { id, reversed: false };
  for (;;) {
    const e = open(at.id);
    const into = at.reversed ? e.end : e.start;
    const n = next(at.id, into);
    if (!n || seen.has(n.curve)) break;
    seen.add(n.curve);
    at = { id: n.curve, reversed: n.point !== open(n.curve).end };
    backward.unshift(at);
  }
  return { links: [...backward, ...forward], closed: false };
}

/** A curve of the offset, as positions (a line's ends, an arc's center and ends, a circle, a spline's samples). */
type Shape =
  | { kind: 'line'; start: Vec2; end: Vec2 }
  | { kind: 'arc'; center: Vec2; radius: number; start: Vec2; end: Vec2 }
  | { kind: 'circle'; center: Vec2; radius: number }
  | SplineShape;

/**
 * A spline's offset (ADR-0063's P4-12 amendment, A4): points of the true
 * offset at parameters of the original, through which the offset's fit spline
 * runs, in the original's own direction. A sharp joint may trim the samples or
 * carry an end on along its tangent (`extendStart`, `extendEnd`: a line of its
 * own from the end to there).
 */
interface SplineShape {
  kind: 'spline';
  closed: boolean;
  params: number[];
  points: Vec2[];
  start: Vec2;
  end: Vec2;
  /** The true offset at a parameter of the original. */
  at(u: number): Vec2;
  /** The unit direction of the curve at a parameter, along its parameter. */
  tangent(u: number): Vec2;
  extendStart?: Vec2;
  extendEnd?: Vec2;
  /** How far the fit spline through `points` strays from the true offset, mm (once checked). */
  error?: number;
}

/** How close (mm) a spline's offset stays to the true offset (ADR-0063's P4-12 amendment, A4). */
export const OFFSET_TOLERANCE = 1e-3;
/** The most a spline's sampling is multiplied by to reach the tolerance (128 per span). */
const MAX_DENSITY = 8;
/** Offset ends nearer than this (mm) meet: a smooth joint. */
const JOINT = 1e-6;
const TOO_TIGHT = 'The spline is too tight for that distance.';
const TIGHTEST_BEND = "The offset is larger than the spline's tightest bend.";

/**
 * The offset of a chain by `distance` to the left of its direction of
 * travel (negative: to the right), with the pieces trimmed or extended to
 * meet. Throws a `ModifyError` if an arc would shrink to nothing or two
 * neighbouring pieces no longer meet, or a spline bends tighter than the
 * distance or can't be followed within `OFFSET_TOLERANCE`.
 */
export function offsetShapes(data: SketchData, chain: Chain, distance: number): Shape[] {
  for (let density = 1; ; density *= 2) {
    const shapes = offsetShapesAt(data, chain, distance, density);
    let worst = 0;
    for (const shape of shapes) {
      if (shape.kind !== 'spline') continue;
      shape.error = fitError(shape);
      worst = Math.max(worst, shape.error);
    }
    if (worst <= OFFSET_TOLERANCE) return shapes;
    if (density >= MAX_DENSITY) throw new ModifyError(TOO_TIGHT);
  }
}

function offsetShapesAt(
  data: SketchData,
  chain: Chain,
  distance: number,
  density: number,
): Shape[] {
  const shapes: Shape[] = chain.links.map(({ id, reversed }) => {
    const e = data.entities[id];
    if (e?.type === 'spline') return splineShape(data, e, reversed ? -distance : distance, density);
    if (e?.type === 'circle') {
      const center = pointOf(data, e.center) as Vec2;
      const radius = e.radius - distance;
      if (radius <= 1e-9) throw new ModifyError('That is further than the circle is wide.');
      return { kind: 'circle', center, radius };
    }
    if (e?.type === 'line') {
      const a = pointOf(data, e.start) as Vec2;
      const b = pointOf(data, e.end) as Vec2;
      const len = dist(a, b);
      const u: Vec2 = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
      const s = reversed ? -1 : 1;
      const n: Vec2 = [-u[1] * s * distance, u[0] * s * distance];
      return { kind: 'line', start: add(a, n), end: add(b, n) };
    }
    if (e?.type === 'arc') {
      const center = pointOf(data, e.center) as Vec2;
      const s = pointOf(data, e.start) as Vec2;
      const t = pointOf(data, e.end) as Vec2;
      const r = dist(center, s);
      // Counter-clockwise travel has the center on the left.
      const radius = r - (reversed ? -distance : distance);
      if (radius <= 1e-9) throw new ModifyError('That is further than an arc is wide.');
      const k = radius / r;
      return {
        kind: 'arc',
        center,
        radius,
        start: add(center, scale(sub(s, center), k)),
        end: add(center, scale(sub(t, center), k)),
      };
    }
    throw new ModifyError('Offset works on lines, circles, arcs and splines.');
  });

  // Join each piece to the next where they cross, nearest the old joint.
  const count = chain.closed ? shapes.length : shapes.length - 1;
  const first = shapes[0];
  if (first?.kind === 'circle' || (first?.kind === 'spline' && first.closed)) return shapes;
  const size = chainSize(shapes, distance);
  for (let i = 0; i < count; i++) {
    const j = (i + 1) % shapes.length;
    const here = shapes[i] as Exclude<Shape, { kind: 'circle' }>;
    const there = shapes[j] as Exclude<Shape, { kind: 'circle' }>;
    const out = (chain.links[i] as ChainLink).reversed ? 'start' : 'end';
    const into = (chain.links[j] as ChainLink).reversed ? 'end' : 'start';
    if (here.kind === 'spline' || there.kind === 'spline') {
      joinWithSpline(here, out, there, into, size);
      continue;
    }
    const p = here[out];
    const q = there[into];
    if (dist(p, q) < 1e-9) continue;
    const mid = scale(add(p, q), 0.5);
    const meet = crossings(here, there).sort((x, y) => dist(x, mid) - dist(y, mid))[0];
    if (!meet) throw new ModifyError("At that distance two of the curves don't meet any more.");
    here[out] = meet;
    there[into] = meet;
  }
  // A piece turned inside out went further than it was long.
  chain.links.forEach(({ id }, i) => {
    const e = data.entities[id];
    const shape = shapes[i] as Shape;
    if (e?.type === 'line' && shape.kind === 'line') {
      const a = pointOf(data, e.start) as Vec2;
      const b = pointOf(data, e.end) as Vec2;
      if (dot(sub(shape.end, shape.start), sub(b, a)) <= 1e-12) {
        throw new ModifyError('That is further than a line of the chain is long.');
      }
    }
    if (e?.type === 'arc' && shape.kind === 'arc') {
      const c = pointOf(data, e.center) as Vec2;
      const turn = (x: Vec2, y: Vec2) =>
        Math.atan2(cross(sub(x, c), sub(y, c)), dot(sub(x, c), sub(y, c)));
      const before = turn(pointOf(data, e.start) as Vec2, pointOf(data, e.end) as Vec2);
      const after = turn(shape.start, shape.end);
      if (Math.sign(before) !== Math.sign(after) && Math.abs(before) < Math.PI / 2) {
        throw new ModifyError('That is further than an arc of the chain is long.');
      }
    }
  });
  return shapes;
}

/** A length well past the chain: how far a straight reach runs to find a crossing. */
function chainSize(shapes: readonly Shape[], distance: number): number {
  let lo: Vec2 = [Infinity, Infinity];
  let hi: Vec2 = [-Infinity, -Infinity];
  const see = (p: Vec2) => {
    lo = [Math.min(lo[0], p[0]), Math.min(lo[1], p[1])];
    hi = [Math.max(hi[0], p[0]), Math.max(hi[1], p[1])];
  };
  for (const shape of shapes) {
    if (shape.kind === 'spline') shape.points.forEach(see);
    else if (shape.kind === 'circle') see(shape.center);
    else {
      see(shape.start);
      see(shape.end);
    }
  }
  return 10 * (dist(lo, hi) + Math.abs(distance) + 1);
}

/** The offset of a spline (ADR-0063's P4-12 amendment, A4), `left` mm to the left of its own direction. */
function splineShape(
  data: SketchData,
  e: SketchSpline,
  left: number,
  density: number,
): SplineShape {
  const positions = e.points.map((p) => pointOf(data, p) as Vec2);
  const curve = splineCurve(e, positions);
  const d1 = splineDerivative(curve);
  const d2 = splineDerivative(d1);
  const closed = isClosedSpline(e);
  const tangent = (u: number): Vec2 => {
    let t = splinePoint(d1, u);
    let len = Math.hypot(t[0], t[1]);
    if (len < 1e-12) {
      // A stationary point (coincident poles): the direction from just beside it.
      const v = Math.min(1, Math.max(0, u < 0.5 ? u + 1e-6 : u - 1e-6));
      const a = splinePoint(curve, Math.min(u, v));
      const b = splinePoint(curve, Math.max(u, v));
      t = sub(b, a);
      len = Math.hypot(t[0], t[1]);
    }
    return len > 0 ? [t[0] / len, t[1] / len] : [1, 0];
  };
  const at = (u: number): Vec2 => {
    const t = tangent(u);
    const p = splinePoint(curve, u);
    return [p[0] - t[1] * left, p[1] + t[0] * left];
  };
  const perSpan =
    (e.mode === 'conic' ? CONIC_SEGMENTS_PER_SPAN : SPLINE_SEGMENTS_PER_SPAN) * density;
  const distinct = [...new Set(curve.knots)];
  const params = [0];
  for (let i = 1; i < distinct.length; i++) {
    const u0 = distinct[i - 1] as number;
    const u1 = distinct[i] as number;
    for (let k = 1; k <= perSpan; k++) params.push(u0 + ((u1 - u0) * k) / perSpan);
  }
  // A bend whose centre is on the offset's side collapses once the distance reaches its radius.
  for (let i = 0; i < params.length; i++) {
    const here = params[i] as number;
    const next = params[i + 1];
    for (const u of next === undefined ? [here] : [here, (here + next) / 2]) {
      const v = splinePoint(d1, u);
      const a = splinePoint(d2, u);
      const speed = Math.hypot(v[0], v[1]);
      if (speed < 1e-12) continue;
      const curvature = cross(v, a) / speed ** 3;
      if (left * curvature >= 1 - 1e-9) throw new ModifyError(TIGHTEST_BEND);
    }
  }
  if (closed) params.pop();
  const points = params.map(at);
  return {
    kind: 'spline',
    closed,
    params,
    points,
    start: points[0] as Vec2,
    end: points[points.length - 1] as Vec2,
    at,
    tangent,
  };
}

/** The fit spline through a spline offset's points. */
export function offsetFit(shape: SplineShape): BSpline {
  return shape.closed ? closedFitSpline(shape.points) : fitSpline(shape.points);
}

/** Chord-length parameters of points, as the fit spline gives them (round the loop if closed). */
function chordParams(points: readonly Vec2[], closed: boolean): number[] {
  const loop = closed ? [...points, points[0] as Vec2] : [...points];
  const n = loop.length - 1;
  const lengths = loop.slice(1).map((p, i) => dist(p, loop[i] as Vec2));
  const total = lengths.reduce((a, l) => a + l, 0);
  const floor = total > 0 ? (1e-6 * total) / n : 1;
  const steps = lengths.map((l) => Math.max(l, floor));
  const sum = steps.reduce((a, l) => a + l, 0);
  const out = [0];
  for (const step of steps) out.push((out[out.length - 1] as number) + step / sum);
  out[n] = 1;
  return out;
}

/**
 * How far the fit spline through a spline offset's points runs from the true
 * offset, mm: at the middle parameter between every two samples, the distance
 * from the true offset's point to the nearest point of the fit near there.
 */
function fitError(shape: SplineShape): number {
  const fit = offsetFit(shape);
  const t = chordParams(shape.points, shape.closed);
  const count = shape.closed ? shape.points.length : shape.points.length - 1;
  let worst = 0;
  for (let k = 0; k < count; k++) {
    const u0 = shape.params[k] as number;
    const u1 = k + 1 < shape.params.length ? (shape.params[k + 1] as number) : 1;
    const target = shape.at((u0 + u1) / 2);
    const t0 = t[k] as number;
    const t1 = t[k + 1] as number;
    const span = t1 - t0;
    let a = Math.max(0, t0 - span / 2);
    let b = Math.min(1, t1 + span / 2);
    const g = (Math.sqrt(5) - 1) / 2;
    const d = (v: number) => dist(splinePoint(fit, v), target);
    for (let i = 0; i < 50; i++) {
      const c = b - g * (b - a);
      const e = a + g * (b - a);
      if (d(c) < d(e)) b = e;
      else a = c;
    }
    worst = Math.max(worst, d((a + b) / 2));
  }
  return worst;
}

/** How far a point is from an unbounded line's or circle's own curve, signed. */
function signedTo(curve: Curve, p: Vec2): number {
  if (curve.kind === 'line') {
    const d = sub(curve.b, curve.a);
    return cross(d, sub(p, curve.a)) / Math.hypot(d[0], d[1]);
  }
  return dist(p, curve.center) - curve.radius;
}

/** Where a piece of the offset can be reached from one of its ends, as curves to cross. */
interface Reach {
  curves: Curve[];
  /** Per curve: the spline segment it is (its index), or -1 for the straight reach past the end. */
  segment: number[];
  /** A line's or an arc's own unbounded curve, for refining where a spline crosses it. */
  own?: Curve;
}

function reachOf(
  shape: Exclude<Shape, { kind: 'circle' }>,
  end: 'start' | 'end',
  size: number,
): Reach {
  if (shape.kind === 'line') {
    const d = sub(shape.end, shape.start);
    const len = Math.hypot(d[0], d[1]);
    const u: Vec2 = [d[0] / len, d[1] / len];
    const curve: Curve = {
      kind: 'line',
      id: '',
      a: add(shape.start, scale(u, -size)),
      b: add(shape.end, scale(u, size)),
    };
    return { curves: [curve], segment: [0], own: curve };
  }
  if (shape.kind === 'arc') {
    const curve: Curve = { kind: 'circle', id: '', center: shape.center, radius: shape.radius };
    return { curves: [curve], segment: [0], own: curve };
  }
  const curves: Curve[] = [];
  const segment: number[] = [];
  for (let k = 1; k < shape.points.length; k++) {
    curves.push({
      kind: 'line',
      id: '',
      a: shape.points[k - 1] as Vec2,
      b: shape.points[k] as Vec2,
    });
    segment.push(k - 1);
  }
  // The straight reach on past the end, along the curve's tangent there.
  const u = end === 'end' ? 1 : 0;
  const t = shape.tangent(shape.params[end === 'end' ? shape.params.length - 1 : 0] ?? u);
  const from = shape[end];
  const out = end === 'end' ? t : scale(t, -1);
  curves.push({ kind: 'line', id: '', a: from, b: add(from, scale(out, size)) });
  segment.push(-1);
  return { curves, segment };
}

/**
 * Joins two neighbouring offset pieces where one or both are splines: at their
 * common point where they still meet (a smooth joint); else where they cross
 * nearest the old joint — trimming a spline's samples there, or carrying the
 * spline on along its end tangent (`extendStart`/`extendEnd`) where the
 * crossing is past its end — and moving a line's or an arc's end there.
 */
function joinWithSpline(
  here: Exclude<Shape, { kind: 'circle' }>,
  out: 'start' | 'end',
  there: Exclude<Shape, { kind: 'circle' }>,
  into: 'start' | 'end',
  size: number,
): void {
  const p = here[out];
  const q = there[into];
  const mid = scale(add(p, q), 0.5);
  if (dist(p, q) < JOINT) {
    setEnd(here, out, mid);
    setEnd(there, into, mid);
    return;
  }
  const a = reachOf(here, out, size);
  const b = reachOf(there, into, size);
  let best: { at: Vec2; sa: number; sb: number; ca: Curve; cb: Curve } | undefined;
  a.curves.forEach((ca, i) => {
    b.curves.forEach((cb, k) => {
      for (const at of intersectCurves(ca, cb)) {
        if (!best || dist(at, mid) < dist(best.at, mid)) {
          best = { at, sa: a.segment[i] as number, sb: b.segment[k] as number, ca, cb };
        }
      }
    });
  });
  if (!best) throw new ModifyError("At that distance two of the curves don't meet any more.");
  const meet = best.at;
  land(here, out, best.sa, meet, b.own);
  land(there, into, best.sb, meet, a.own);
}

/** Moves a piece's end to a point (a spline's first or last sample with it). */
function setEnd(shape: Exclude<Shape, { kind: 'circle' }>, end: 'start' | 'end', p: Vec2): void {
  if (shape.kind !== 'spline') {
    shape[end] = p;
    return;
  }
  shape[end] = p;
  if (end === 'start') shape.points[0] = p;
  else shape.points[shape.points.length - 1] = p;
}

/**
 * Ends a piece where the joint was found: a line or an arc at `meet`; a spline
 * on its straight reach gets the reach as a line of its own, else its samples
 * are cut at the segment it was found on, the end refined onto the other
 * piece's own curve where that is a line or an arc.
 */
function land(
  shape: Exclude<Shape, { kind: 'circle' }>,
  end: 'start' | 'end',
  segment: number,
  meet: Vec2,
  other: Curve | undefined,
): void {
  if (shape.kind !== 'spline') {
    shape[end] = meet;
    return;
  }
  if (segment < 0) {
    if (end === 'end') shape.extendEnd = meet;
    else shape.extendStart = meet;
    return;
  }
  let u0 = shape.params[segment] as number;
  let u1 = shape.params[segment + 1] as number;
  let u =
    u0 +
    (u1 - u0) *
      (dist(shape.points[segment] as Vec2, meet) /
        Math.max(1e-300, dist(shape.points[segment] as Vec2, shape.points[segment + 1] as Vec2)));
  let at = meet;
  if (other) {
    let f0 = signedTo(other, shape.at(u0));
    if (f0 * signedTo(other, shape.at(u1)) <= 0) {
      for (let i = 0; i < 60; i++) {
        const m = (u0 + u1) / 2;
        const f = signedTo(other, shape.at(m));
        if (f0 * f <= 0) u1 = m;
        else {
          u0 = m;
          f0 = f;
        }
      }
      u = (u0 + u1) / 2;
      at = shape.at(u);
    }
  }
  // Keep the samples on the piece's side of the cut, the cut itself at the end.
  const keep = (p: Vec2) => dist(p, at) > 1e-6;
  if (end === 'end') {
    const points = shape.points.slice(0, segment + 1);
    const params = shape.params.slice(0, segment + 1);
    while (points.length > 0 && !keep(points[points.length - 1] as Vec2)) {
      points.pop();
      params.pop();
    }
    shape.points = [...points, at];
    shape.params = [...params, u];
  } else {
    const points = shape.points.slice(segment + 1);
    const params = shape.params.slice(segment + 1);
    while (points.length > 0 && !keep(points[0] as Vec2)) {
      points.shift();
      params.shift();
    }
    shape.points = [at, ...points];
    shape.params = [u, ...params];
  }
  if (shape.points.length < 2) {
    throw new ModifyError('That is further than a spline of the chain is long.');
  }
  shape.start = shape.points[0] as Vec2;
  shape.end = shape.points[shape.points.length - 1] as Vec2;
}

/** Where two offset pieces cross, as unbounded curves (lines and whole circles). */
function crossings(
  a: Extract<Shape, { kind: 'line' | 'arc' }>,
  b: Extract<Shape, { kind: 'line' | 'arc' }>,
): Vec2[] {
  if (a.kind === 'line' && b.kind === 'line') {
    const d1 = sub(a.end, a.start);
    const d2 = sub(b.end, b.start);
    const denom = cross(d1, d2);
    if (Math.abs(denom) < 1e-12 * Math.hypot(...d1) * Math.hypot(...d2)) return [];
    return [add(a.start, scale(d1, cross(sub(b.start, a.start), d2) / denom))];
  }
  if (a.kind === 'line' || b.kind === 'line') {
    const [line, arc] = (a.kind === 'line' ? [a, b] : [b, a]) as [
      Extract<Shape, { kind: 'line' }>,
      Extract<Shape, { kind: 'arc' }>,
    ];
    const d = sub(line.end, line.start);
    const len = Math.hypot(d[0], d[1]);
    const u: Vec2 = [d[0] / len, d[1] / len];
    const foot = add(line.start, scale(u, dot(sub(arc.center, line.start), u)));
    const h2 = arc.radius ** 2 - dist(foot, arc.center) ** 2;
    if (h2 < -1e-9) return [];
    const h = Math.sqrt(Math.max(0, h2));
    return [add(foot, scale(u, -h)), add(foot, scale(u, h))];
  }
  const d = dist(a.center, b.center);
  if (d === 0 || d > a.radius + b.radius + 1e-9 || d < Math.abs(a.radius - b.radius) - 1e-9)
    return [];
  const along = (a.radius ** 2 - b.radius ** 2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, a.radius ** 2 - along * along));
  const u = scale(sub(b.center, a.center), 1 / d);
  const foot = add(a.center, scale(u, along));
  const n: Vec2 = [-u[1], u[0]];
  return [add(foot, scale(n, h)), add(foot, scale(n, -h))];
}

/**
 * The signed offset distance that puts the chain's offset through
 * `cursor`: positive to the left of the chain's direction of travel. Uses
 * the chain's piece nearest the cursor.
 */
export function offsetTo(data: SketchData, chain: Chain, cursor: Vec2): number {
  let best: { d: number; signed: number } | undefined;
  for (const { id, reversed } of chain.links) {
    const e = data.entities[id];
    let signed: number | undefined;
    let d = Infinity;
    if (e?.type === 'line') {
      const a = pointOf(data, e.start) as Vec2;
      const b = pointOf(data, e.end) as Vec2;
      const ab = sub(b, a);
      const len = Math.hypot(ab[0], ab[1]);
      const t = Math.max(0, Math.min(1, dot(sub(cursor, a), ab) / (len * len)));
      d = dist(cursor, add(a, scale(ab, t)));
      signed = (cross(ab, sub(cursor, a)) / len) * (reversed ? -1 : 1);
    } else if (e?.type === 'arc' || e?.type === 'circle') {
      const c = pointOf(data, e.center) as Vec2;
      const r = e.type === 'circle' ? e.radius : dist(c, pointOf(data, e.start) as Vec2);
      const off = dist(cursor, c) - r;
      d = Math.abs(off);
      // Counter-clockwise travel: the inside is on the left.
      signed = -off * (reversed ? -1 : 1);
    } else if (e?.type === 'spline') {
      // The nearest point of its polyline, and which side of the curve's direction the cursor is.
      const curve = splineCurve(
        e,
        e.points.map((p) => pointOf(data, p) as Vec2),
      );
      const n = 64 * Math.max(1, new Set(curve.knots).size - 1);
      let best = 0;
      for (let k = 0; k <= n; k++) {
        const dk = dist(splinePoint(curve, k / n), cursor);
        if (dk < d) {
          d = dk;
          best = k / n;
        }
      }
      const a = splinePoint(curve, Math.max(0, best - 1 / n));
      const b = splinePoint(curve, Math.min(1, best + 1 / n));
      const t = sub(b, a);
      const len = Math.hypot(t[0], t[1]);
      if (len > 0) {
        const p = splinePoint(curve, best);
        signed = (cross(t, sub(cursor, p)) / len) * (reversed ? -1 : 1);
      }
    }
    if (signed !== undefined && (!best || d < best.d)) best = { d, signed };
  }
  return best?.signed ?? 0;
}

export interface OffsetOptions {
  /** The distance's expression, for the dimension. */
  expr: string;
  /** Writes a length in mm as a dimension expression (a chain of arcs only). */
  format(mm: number): string;
}

/**
 * Offsets a chain by `distance` (signed as `offsetTo` measures it) and
 * returns the new curves, held to the originals.
 */
export function offset(
  data: SketchData,
  chain: Chain,
  distance: number,
  options: OffsetOptions,
  newId: () => string,
): ModifyResult {
  if (Math.abs(distance) < 1e-9) throw new ModifyError('Move the pointer off the curve.');
  const shapes = offsetShapes(data, chain, distance);
  const b = new ChangeBuilder(data, newId);
  const withSpline = shapes.some((shape) => shape.kind === 'spline');
  const made = chain.links.map((link, i) => {
    const e = data.entities[link.id] as SketchEntity & { construction: boolean };
    const shape = shapes[i] as Shape;
    if (shape.kind === 'spline') return splineOffset(b, shape, e.construction);
    if (shape.kind === 'circle') {
      const center = b.addPoint(shape.center);
      const id = b.add({
        type: 'circle',
        center,
        radius: shape.radius,
        construction: e.construction,
      });
      return { id, start: center, end: center };
    }
    if (shape.kind === 'line') {
      const start = b.addPoint(shape.start);
      const end = b.addPoint(shape.end);
      return { id: b.add({ type: 'line', start, end, construction: e.construction }), start, end };
    }
    const center = b.addPoint(shape.center);
    const start = b.addPoint(shape.start);
    const end = b.addPoint(shape.end);
    const id = b.add({ type: 'arc', center, start, end, construction: e.construction });
    return { id, start, end };
  });

  // Joints, as the chain has them.
  const joints = chain.closed ? chain.links.length : chain.links.length - 1;
  const alone = shapes[0]?.kind === 'circle' || (shapes[0]?.kind === 'spline' && shapes[0].closed);
  if (!alone) {
    for (let i = 0; i < joints; i++) {
      const j = (i + 1) % chain.links.length;
      const [li, lj] = [chain.links[i] as ChainLink, chain.links[j] as ChainLink];
      const [mi, mj] = [made[i] as (typeof made)[0], made[j] as (typeof made)[0]];
      b.constrain({
        type: 'coincident',
        a: li.reversed ? mi.start : mi.end,
        b: lj.reversed ? mj.end : mj.start,
      });
    }
    const index = new Map(chain.links.map((l, i) => [l.id as string, i]));
    for (const c of Object.values(data.constraints)) {
      if (c.type !== 'tangent' && c.type !== 'smooth') continue;
      const [ia, ib] = [index.get(c.a), index.get(c.b)];
      if (ia === undefined || ib === undefined) continue;
      const [a, bb] = [(made[ia] as (typeof made)[0]).id, (made[ib] as (typeof made)[0]).id];
      const reversed = tangentReversed(b.view(), a, bb);
      const joint: SketchConstraint =
        reversed === undefined ? { type: c.type, a, b: bb } : { type: c.type, a, b: bb, reversed };
      b.constrain(joint);
    }
    // A projected outline has no tangent constraints, but where its curves run smoothly into
    // each other (a rounded corner) the offset's must too, or the pieces could slide (P3-17).
    const projected = projectedCurves(data);
    for (let i = 0; i < joints; i++) {
      const j = (i + 1) % chain.links.length;
      const [li, lj] = [chain.links[i] as ChainLink, chain.links[j] as ChainLink];
      if (!projected.has(li.id) || !projected.has(lj.id)) continue;
      const [ei, ej] = [data.entities[li.id], data.entities[lj.id]];
      if (!ei || !ej || (ei.type === 'line' && ej.type === 'line')) continue;
      if (!smoothJoint(data, li, lj)) continue;
      const [a, bb] = [(made[i] as (typeof made)[0]).id, (made[j] as (typeof made)[0]).id];
      const reversed = tangentReversed(b.view(), a, bb);
      b.constrain(
        reversed === undefined
          ? { type: 'tangent', a, b: bb }
          : { type: 'tangent', a, b: bb, reversed },
      );
    }
  }

  // A spline's offset can't be held to its original, so a chain with one keeps
  // its lines parallel and its arcs concentric but has no distance to drive.
  if (withSpline) {
    chain.links.forEach((link, i) => {
      const e = data.entities[link.id];
      const m = made[i] as (typeof made)[0];
      if (e?.type === 'line') b.constrain({ type: 'parallel', a: link.id, b: m.id });
      else if (e?.type === 'arc') b.constrain({ type: 'concentric', a: link.id, b: m.id });
    });
    return b.result();
  }
  let first: ReturnType<ChangeBuilder['dimension']> | undefined;
  chain.links.forEach((link, i) => {
    const e = data.entities[link.id];
    const m = made[i] as (typeof made)[0];
    if (e?.type === 'line') {
      const parallel = b.constrain({ type: 'parallel', a: link.id, b: m.id });
      const d = b.dimension({
        type: 'distance',
        orientation: 'aligned',
        a: link.id,
        b: m.id,
        expr: options.expr,
        driven: false,
      });
      if (first === undefined) first = d;
      else {
        // Tangent joints to arcs may already set this line.
        b.links[d] = first;
        b.auto.push(parallel, d);
      }
    } else {
      b.constrain({ type: 'concentric', a: link.id, b: m.id });
    }
  });
  if (first === undefined) {
    const m = made[0] as (typeof made)[0];
    const shape = shapes[0] as Shape;
    if (shape.kind === 'circle') {
      b.dimension({
        type: 'diameter',
        curve: m.id,
        expr: options.format(2 * shape.radius),
        driven: false,
      });
    } else if (shape.kind === 'arc') {
      b.dimension({
        type: 'radius',
        curve: m.id,
        expr: options.format(shape.radius),
        driven: false,
      });
    }
  }
  return b.result();
}

/**
 * A spline offset's entities (ADR-0063's P4-12 amendment, A4): the fit spline
 * through its points, fixed, and a line of its own for each end carried on
 * along its tangent. Returns its ID and the ends the chain's joints meet at.
 */
function splineOffset(
  b: ChangeBuilder,
  shape: SplineShape,
  construction: boolean,
): { id: SketchEntityId; start: SketchEntityId; end: SketchEntityId } {
  const points = shape.points.map((p) => b.addPoint(p));
  const id = b.add({
    type: 'spline',
    points,
    ...(shape.closed ? { closed: true } : {}),
    construction,
  });
  b.constrain({ type: 'fix', entity: id });
  let start = points[0] as SketchEntityId;
  let end = points[points.length - 1] as SketchEntityId;
  if (shape.extendStart) {
    const far = b.addPoint(shape.extendStart);
    const near = b.addPoint(shape.start);
    b.add({ type: 'line', start: far, end: near, construction });
    b.constrain({ type: 'coincident', a: near, b: start });
    start = far;
  }
  if (shape.extendEnd) {
    const near = b.addPoint(shape.end);
    const far = b.addPoint(shape.extendEnd);
    b.add({ type: 'line', start: near, end: far, construction });
    b.constrain({ type: 'coincident', a: end, b: near });
    end = far;
  }
  return { id, start, end };
}

/** The offset's curves as polylines, for the preview. */
export function offsetPreview(data: SketchData, chain: Chain, distance: number): Vec2[][] {
  const shapes = offsetShapes(data, chain, distance);
  return shapes.flatMap((shape): Vec2[][] => {
    if (shape.kind === 'spline') {
      const line = shape.closed ? [...shape.points, shape.points[0] as Vec2] : [...shape.points];
      const out: Vec2[][] = [line];
      if (shape.extendStart) out.push([shape.extendStart, shape.start]);
      if (shape.extendEnd) out.push([shape.end, shape.extendEnd]);
      return out;
    }
    if (shape.kind === 'line') return [[shape.start, shape.end]];
    const from =
      shape.kind === 'circle'
        ? 0
        : Math.atan2(shape.start[1] - shape.center[1], shape.start[0] - shape.center[0]);
    let sweep = 2 * Math.PI;
    if (shape.kind === 'arc') {
      const to = Math.atan2(shape.end[1] - shape.center[1], shape.end[0] - shape.center[0]);
      sweep = (((to - from) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) || 2 * Math.PI;
    }
    const n = Math.max(2, Math.ceil((sweep / (2 * Math.PI)) * 96));
    const out: Vec2[] = [];
    for (let i = 0; i <= n; i++) {
      const t = from + (sweep * i) / n;
      out.push([
        shape.center[0] + shape.radius * Math.cos(t),
        shape.center[1] + shape.radius * Math.sin(t),
      ]);
    }
    return [out];
  });
}
