/**
 * Projecting body geometry into a sketch plane (P2-09, FR-SK-12, ADR-0031):
 * straight along the plane's normal, from the exact edge geometry the
 * facade gives (`Kernel.edgeGeometry`). Lines stay lines; circles in a
 * parallel plane stay circles and arcs, tilted ones become ellipses (whole
 * circles) or fit-point splines (arcs); circles seen edge-on become lines;
 * everything else becomes a fit-point spline through its projected samples.
 */
import {
  fitControlPoles,
  type ProjectedCurve,
  type SketchFrame,
  type Vec2,
  type Vec3,
  worldToSketch,
} from '@extrudo/core';
import type { Conic, CurvePiece, EdgeGeometry } from '../kernel';

/** Shorter than this (mm), a projected curve is a point and is left out. */
const TINY = 1e-6;
/** |cos| of the angle between an axis and the plane's normal above this: parallel planes. */
const PARALLEL = 1 - 1e-9;

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const add = (a: Vec3, b: Vec3, s = 1): Vec3 => [a[0] + s * b[0], a[1] + s * b[1], a[2] + s * b[2]];
const unit = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};

/** Rounds away floating noise (1e-9 mm), so the same model reports the same numbers. */
function tidy([x, y]: Vec2): Vec2 {
  const r = (v: number) => Math.round(v * 1e9) / 1e9 + 0;
  return [r(x), r(y)];
}

/** An edge projected into a sketch plane, or `undefined` if it projects to a point. */
export function projectEdge(g: EdgeGeometry, frame: SketchFrame): ProjectedCurve | undefined {
  if (g.type === 'degenerate' || g.points.length < 2) return undefined;
  const to2d = (p: Vec3) => tidy(worldToSketch(frame, p));
  const points = g.points.map(to2d);
  const first = points[0] as Vec2;
  const last = points[points.length - 1] as Vec2;
  if (g.type === 'line') return line(first, last);

  const conic = g.conic;
  if (conic && (g.type === 'circle' || g.type === 'ellipse')) {
    const cos = dot(unit(conic.axis), frame.normal);
    const whole = g.closed && conic.last - conic.first >= 2 * Math.PI - 1e-9;
    const center = to2d(conic.center);
    if (Math.abs(cos) >= PARALLEL) {
      if (g.type === 'circle') {
        if (whole) return { type: 'circle', center, radius: conic.radius };
        // The edge runs counter-clockwise about its axis: the same way in the sketch
        // when the axis points along the normal, the other way when against it.
        return cos > 0
          ? { type: 'arc', center, start: first, end: last }
          : { type: 'arc', center, start: last, end: first };
      }
      if (whole) {
        const minorDirection = cross(unit(conic.axis), unit(conic.xDirection));
        return {
          type: 'ellipse',
          center,
          major: to2d(add(conic.center, unit(conic.xDirection), conic.radius)),
          minor: to2d(add(conic.center, minorDirection, conic.minor ?? conic.radius)),
        };
      }
      return spline(points);
    }
    if (g.type === 'circle' && whole && Math.abs(cos) > 1e-9) {
      // A tilted circle: an ellipse whose major axis lies along the line where the
      // circle's plane meets the sketch plane, at full radius.
      const along = unit(cross(conic.axis, frame.normal));
      const across = unit(cross(conic.axis, along));
      return {
        type: 'ellipse',
        center,
        major: to2d(add(conic.center, along, conic.radius)),
        minor: to2d(add(conic.center, across, conic.radius)),
      };
    }
    if (Math.abs(cos) <= 1e-9) {
      // Seen edge-on, the curve is a segment: add its extreme points, which the
      // samples may miss, and let `spline` find the line.
      points.push(...conicExtremes(conic, frame.normal).map(to2d));
    }
  }
  return spline(points);
}

/**
 * The points of a circle or ellipse edge farthest either way along the line
 * its plane makes with the sketch plane (it is seen edge-on), within the
 * edge's angles.
 */
function conicExtremes(
  conic: NonNullable<Extract<EdgeGeometry, { points: Vec3[] }>['conic']>,
  normal: Vec3,
): Vec3[] {
  const x = unit(conic.xDirection);
  const y = cross(unit(conic.axis), x);
  const along = unit(cross(conic.axis, normal));
  const a = conic.radius;
  const b = conic.minor ?? conic.radius;
  const t = Math.atan2(b * dot(y, along), a * dot(x, along));
  const out: Vec3[] = [];
  for (const theta of [t, t + Math.PI]) {
    let u = conic.first + ((((theta - conic.first) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI));
    if (u > conic.last + 1e-12) continue;
    u = Math.min(u, conic.last);
    out.push(add(add(conic.center, x, a * Math.cos(u)), y, b * Math.sin(u)));
  }
  return out;
}

/** A line, or `undefined` if its ends coincide. */
function line(a: Vec2, b: Vec2): ProjectedCurve | undefined {
  return Math.hypot(b[0] - a[0], b[1] - a[1]) <= TINY ? undefined : { type: 'line', a, b };
}

/**
 * A fit-point spline through the points, or a line where they all lie on
 * one (a curve seen edge-on: from the extreme points), or nothing.
 */
function spline(points: Vec2[]): ProjectedCurve | undefined {
  const a = points[0] as Vec2;
  // The farthest pair along the points' main direction spans a straight projection.
  let far = a;
  for (const p of points) {
    if (Math.hypot(p[0] - a[0], p[1] - a[1]) > Math.hypot(far[0] - a[0], far[1] - a[1])) far = p;
  }
  const length = Math.hypot(far[0] - a[0], far[1] - a[1]);
  let farBack = far;
  for (const p of points) {
    if (
      Math.hypot(p[0] - far[0], p[1] - far[1]) >
      Math.hypot(farBack[0] - far[0], farBack[1] - far[1])
    ) {
      farBack = p;
    }
  }
  const span = Math.hypot(farBack[0] - far[0], farBack[1] - far[1]);
  if (Math.max(length, span) <= TINY) return undefined;
  const [u, v] = [far, farBack];
  const d: Vec2 = [v[0] - u[0], v[1] - u[1]];
  const off = (p: Vec2) => Math.abs((p[0] - u[0]) * d[1] - (p[1] - u[1]) * d[0]) / span;
  if (points.every((p) => off(p) <= TINY)) return line(u, v);
  // Drop repeats (a closed curve's seam point is kept at both ends).
  const kept: Vec2[] = [];
  for (const p of points) {
    const q = kept[kept.length - 1];
    if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > TINY) kept.push(p);
  }
  return kept.length >= 2 ? { type: 'spline', points: kept } : undefined;
}

/** A straight segment in space (a silhouette line) projected into the plane. */
export function projectSegment(
  [a, b]: readonly [Vec3, Vec3],
  frame: SketchFrame,
): ProjectedCurve | undefined {
  return line(tidy(worldToSketch(frame, a)), tidy(worldToSketch(frame, b)));
}

// Silhouettes, sections and vertices (P4-12, ADR-0031's amendment) ------------

/** Within this (mm) a polyline's points lie on one circle or line. */
const ON_CURVE = 1e-6;
/** A turn sharper than this (radians) between neighbouring chords ends a smooth run. */
const CORNER = (30 * Math.PI) / 180;
/** How closely (mm) a control-point spline follows the samples it is fitted to. */
export const FIT_TOLERANCE = 1e-3;
/** At most this many of a run's samples are fitted (evenly picked, ends kept): the fit's cost. */
const FIT_SAMPLES = 120;

/** At most `max` of the points, evenly picked by index, the ends kept. */
function thinned(points: Vec2[], max: number): Vec2[] {
  if (points.length <= max) return points;
  const out: Vec2[] = [];
  for (let i = 0; i < max; i++)
    out.push(points[Math.round((i * (points.length - 1)) / (max - 1))] as Vec2);
  return out;
}

/** A vertex projected into the plane. */
export function projectPoint(p: Vec3, frame: SketchFrame): ProjectedCurve {
  return { type: 'point', at: tidy(worldToSketch(frame, p)) };
}

/**
 * The curve pieces of `Kernel.faceSilhouettes` or `sectionWithPlane`
 * projected into the plane, in order: arcs of one circle joined first (a
 * sphere's outline comes in pieces split at its seam, some twice), lines as
 * lines, circles and ellipses as `projectEdge` makes them, and a polyline as
 * one control-point spline per smooth run, or the line, circle or arc its
 * points lie on.
 */
export function projectPieces(pieces: readonly CurvePiece[], frame: SketchFrame): ProjectedCurve[] {
  const out: ProjectedCurve[] = [];
  for (const piece of joinArcs(pieces)) {
    if (piece.type === 'line') {
      const curve = projectSegment(piece.points, frame);
      if (curve) out.push(curve);
    } else if (piece.type === 'polyline') {
      out.push(...projectPolyline(piece.points, frame));
    } else {
      const curve = projectEdge(conicEdge(piece.type, piece.conic), frame);
      if (curve) out.push(curve);
    }
  }
  return out;
}

/** A conic piece as `Kernel.edgeGeometry` would describe it, with 24 samples. */
function conicEdge(type: 'circle' | 'ellipse', conic: Conic): EdgeGeometry {
  const x = unit(conic.xDirection);
  const y = cross(unit(conic.axis), x);
  const b = conic.minor ?? conic.radius;
  const points: Vec3[] = [];
  for (let i = 0; i <= 24; i++) {
    const t = conic.first + ((conic.last - conic.first) * i) / 24;
    points.push(add(add(conic.center, x, conic.radius * Math.cos(t)), y, b * Math.sin(t)));
  }
  return { type, closed: conic.last - conic.first >= 2 * Math.PI - 1e-9, points, conic };
}

/**
 * Joins the arcs of one circle or ellipse (same centre, axis line and radii)
 * into the union of their angles: a run that closes is the whole curve.
 * Other pieces pass unchanged, in order; a joined curve takes the place of
 * its first piece.
 */
export function joinArcs(pieces: readonly CurvePiece[]): CurvePiece[] {
  type Group = { conic: Conic; type: 'circle' | 'ellipse'; spans: [number, number][] };
  const groups: Group[] = [];
  const slots: (CurvePiece | Group)[] = [];
  const same = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a));
  for (const piece of pieces) {
    if (piece.type !== 'circle' && piece.type !== 'ellipse') {
      slots.push(piece);
      continue;
    }
    const c = piece.conic;
    const axis = unit(c.axis);
    const group = groups.find(
      (g) =>
        g.type === piece.type &&
        Math.hypot(...(add(g.conic.center, c.center, -1) as Vec3)) <= 1e-9 &&
        Math.abs(Math.abs(dot(unit(g.conic.axis), axis)) - 1) <= 1e-12 &&
        same(g.conic.radius, c.radius) &&
        same(g.conic.minor ?? g.conic.radius, c.minor ?? c.radius) &&
        // An ellipse's major axes must lie along one line.
        (piece.type === 'circle' ||
          Math.abs(Math.abs(dot(unit(g.conic.xDirection), unit(c.xDirection))) - 1) <= 1e-9),
    );
    const span = spanIn(group?.conic ?? c, c);
    if (group) {
      group.spans.push(span);
    } else {
      const g: Group = { conic: { ...c, axis }, type: piece.type, spans: [span] };
      groups.push(g);
      slots.push(g);
    }
  }
  const out: CurvePiece[] = [];
  for (const slot of slots) {
    if (!('spans' in slot)) {
      out.push(slot);
      continue;
    }
    for (const [first, last] of unionOfSpans(slot.spans)) {
      out.push({ type: slot.type, conic: { ...slot.conic, first, last } });
    }
  }
  return out;
}

/** The angles of arc `c` in `ref`'s frame (axis and x direction), counter-clockwise. */
function spanIn(ref: Conic, c: Conic): [number, number] {
  const axis = unit(ref.axis);
  const x = unit(ref.xDirection);
  const y = cross(axis, x);
  const cx = unit(c.xDirection);
  const offset = Math.atan2(dot(cx, y), dot(cx, x));
  const flip = dot(unit(c.axis), axis) < 0;
  // About the reversed axis, angle t is angle −t about this one.
  const from = flip ? offset - c.last : offset + c.first;
  return [from, from + (c.last - c.first)];
}

/** The union of angle spans as runs starting in [0, 2π); a whole turn is [a, a + 2π]. */
function unionOfSpans(spans: [number, number][]): [number, number][] {
  const TAU = 2 * Math.PI;
  const norm = spans.map(([a, b]): [number, number] => {
    const width = Math.min(b - a, TAU);
    const start = ((a % TAU) + TAU) % TAU;
    return [start, start + width];
  });
  norm.sort((p, q) => p[0] - q[0]);
  const runs: [number, number][] = [];
  for (const [a, b] of norm) {
    const last = runs[runs.length - 1];
    if (last && a <= last[1] + 1e-9) last[1] = Math.max(last[1], b);
    else runs.push([a, b]);
  }
  // A run that passes 2π may join the first one.
  if (runs.length > 1) {
    const first = runs[0] as [number, number];
    const last = runs[runs.length - 1] as [number, number];
    if (last[1] >= first[0] + TAU - 1e-9) {
      last[1] = Math.max(last[1], first[1] + TAU);
      runs.shift();
    }
  }
  return runs.map(([a, b]) => (b - a >= TAU - 1e-9 ? [a, a + TAU] : [a, b]));
}

/**
 * A polyline (points on a silhouette or section curve) in the plane: split
 * where it turns sharply (an outline seen along the view has cusps) and, when
 * it closes on itself, in two (a closed control spline is not a sketch curve
 * yet, ADR-0063); each run is the line or circle arc its points lie on, or a
 * control-point spline fitted to them within `FIT_TOLERANCE`.
 */
export function projectPolyline(points3: readonly Vec3[], frame: SketchFrame): ProjectedCurve[] {
  const points: Vec2[] = [];
  for (const p of points3) {
    const q = tidy(worldToSketch(frame, p));
    const last = points[points.length - 1];
    if (!last || Math.hypot(q[0] - last[0], q[1] - last[1]) > TINY) points.push(q);
  }
  if (points.length < 2) return [];
  const a = points[0] as Vec2;
  const z = points[points.length - 1] as Vec2;
  const closed = points.length > 3 && Math.hypot(z[0] - a[0], z[1] - a[1]) <= 1e-6;
  if (closed) {
    const circle = circleThrough(points);
    if (circle) return [{ type: 'circle', center: circle.center, radius: circle.radius }];
  }
  const runs: Vec2[][] = [];
  let run: Vec2[] = [a];
  for (let i = 1; i < points.length; i++) {
    const p = points[i] as Vec2;
    run.push(p);
    const next = points[i + 1];
    if (next && turn(points[i - 1] as Vec2, p, next) > CORNER) {
      runs.push(run);
      run = [p];
    }
  }
  runs.push(run);
  if (closed && runs.length === 1) {
    // Split a closed smooth loop at its point farthest from the start.
    let far = 0;
    points.forEach((p, i) => {
      const f = points[far] as Vec2;
      if (Math.hypot(p[0] - a[0], p[1] - a[1]) > Math.hypot(f[0] - a[0], f[1] - a[1])) far = i;
    });
    runs.splice(0, 1, points.slice(0, far + 1), points.slice(far));
  }
  const out: ProjectedCurve[] = [];
  for (const r of runs) {
    const curve = runCurve(r);
    if (curve) out.push(curve);
  }
  return out;
}

/** The angle between chords p→q and q→r. */
function turn(p: Vec2, q: Vec2, r: Vec2): number {
  const u: Vec2 = [q[0] - p[0], q[1] - p[1]];
  const v: Vec2 = [r[0] - q[0], r[1] - q[1]];
  return Math.abs(Math.atan2(u[0] * v[1] - u[1] * v[0], u[0] * v[0] + u[1] * v[1]));
}

/** One smooth open run: a line, an arc, or a control-point spline. */
function runCurve(points: Vec2[]): ProjectedCurve | undefined {
  if (points.length < 2) return undefined;
  const a = points[0] as Vec2;
  const z = points[points.length - 1] as Vec2;
  const straight = spline(points);
  if (!straight || straight.type === 'line') return straight;
  const circle = points.length >= 3 ? circleThrough(points) : undefined;
  if (circle) {
    // Counter-clockwise from start to end, as sketch arcs run.
    const m = points[Math.floor(points.length / 2)] as Vec2;
    const c = circle.center;
    const ccw = (a[0] - c[0]) * (m[1] - c[1]) - (a[1] - c[1]) * (m[0] - c[0]) > 0;
    return ccw
      ? { type: 'arc', center: c, start: a, end: z }
      : { type: 'arc', center: c, start: z, end: a };
  }
  const poles = fitControlPoles(thinned(points, FIT_SAMPLES), FIT_TOLERANCE).map(tidy);
  return { type: 'spline', mode: 'control', points: poles };
}

/** The circle every point lies on within `ON_CURVE`, if there is one (algebraic fit, then checked). */
function circleThrough(points: readonly Vec2[]): { center: Vec2; radius: number } | undefined {
  // Centred on the mean for conditioning; solve x² + y² + D x + E y + F = 0 by least squares.
  const n = points.length;
  let mx = 0;
  let my = 0;
  for (const [x, y] of points) {
    mx += x / n;
    my += y / n;
  }
  let suu = 0;
  let svv = 0;
  let suv = 0;
  let suuu = 0;
  let svvv = 0;
  let suvv = 0;
  let svuu = 0;
  for (const [x, y] of points) {
    const u = x - mx;
    const v = y - my;
    suu += u * u;
    svv += v * v;
    suv += u * v;
    suuu += u * u * u;
    svvv += v * v * v;
    suvv += u * v * v;
    svuu += v * u * u;
  }
  const det = suu * svv - suv * suv;
  if (Math.abs(det) <= 1e-18) return undefined;
  const r1 = (suuu + suvv) / 2;
  const r2 = (svvv + svuu) / 2;
  const uc = (r1 * svv - r2 * suv) / det;
  const vc = (r2 * suu - r1 * suv) / det;
  const center: Vec2 = [mx + uc, my + vc];
  const radius = Math.sqrt(uc * uc + vc * vc + (suu + svv) / n);
  if (!Number.isFinite(radius) || radius > 1e6) return undefined;
  for (const [x, y] of points) {
    if (Math.abs(Math.hypot(x - center[0], y - center[1]) - radius) > ON_CURVE) return undefined;
  }
  const r = (v: number) => Math.round(v * 1e9) / 1e9 + 0;
  return { center: tidy(center), radius: r(radius) };
}

/**
 * Leaves out curves that repeat an earlier one (the same type and points
 * within 1e-6 mm): a silhouette along a boundary edge, an outline seen twice.
 * Keys keep their first curve.
 */
export function withoutRepeats(
  curves: Record<string, ProjectedCurve>,
): Record<string, ProjectedCurve> {
  const seen = new Set<string>();
  const out: Record<string, ProjectedCurve> = {};
  for (const [key, curve] of Object.entries(curves)) {
    const signature = curveSignature(curve);
    if (seen.has(signature)) continue;
    seen.add(signature);
    out[key] = curve;
  }
  return out;
}

function curveSignature(c: ProjectedCurve): string {
  const p = ([x, y]: Vec2) => `${Math.round(x * 1e6)},${Math.round(y * 1e6)}`;
  switch (c.type) {
    case 'line':
      return `line:${[p(c.a), p(c.b)].sort().join(';')}`;
    case 'circle':
      return `circle:${p(c.center)}:${Math.round(c.radius * 1e6)}`;
    case 'arc':
      return `arc:${p(c.center)}:${p(c.start)}:${p(c.end)}`;
    case 'ellipse':
      return `ellipse:${p(c.center)}:${p(c.major)}:${p(c.minor)}`;
    case 'spline': {
      const pts = c.points.map(p);
      const forward = pts.join(';');
      const back = [...pts].reverse().join(';');
      return `spline:${c.mode ?? 'fit'}:${forward < back ? forward : back}`;
    }
    case 'point':
      return `point:${p(c.at)}`;
  }
}
