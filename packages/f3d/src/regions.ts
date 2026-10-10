/**
 * Fusion's profile regions, rebuilt from the pieces of curves around them.
 *
 * Fusion names a region by its boundary: per loop, the pieces of curves it
 * runs along, each "piece k of n" of a curve that the region's other curves
 * cut at their crossings, counted along the curve. Cutting the decoded
 * sketch's curves the same way gives each piece back as a polyline, and the
 * region is then what those pieces enclose — by the even-odd rule, so a
 * boundary that runs along a curve on both sides (a slit) encloses nothing
 * there.
 *
 * Everything here is in Fusion's sketch frame (cm). Lines and arcs are cut
 * exactly; splines as polylines.
 */
import type { RegionPiece } from './decode/extrude';
import type { SketchCircular, SketchSpline, Vec3 } from './decode/sketch-geometry';
import type { F3dSketch } from './model';

export type Vec2 = [number, number];

/** Two points closer than this (cm) are the same point. */
const TOL = 1e-6;

type Curve =
  | { kind: 'line'; a: Vec2; b: Vec2 }
  | {
      kind: 'arc';
      c: Vec2;
      r: number;
      /** The zero-angle direction and the quarter turn after it (both unit, sketch plane). */
      x: Vec2;
      y: Vec2;
      from: number;
      to: number;
      closed: boolean;
    }
  | { kind: 'polyline'; points: Vec2[]; params: number[]; closed: boolean };

interface Traced {
  key: string;
  curve: Curve;
  /** Parameters of its start and end. */
  t0: number;
  t1: number;
  closed: boolean;
  box: [number, number, number, number];
}

const sub2 = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];
const dot2 = (a: Vec2, b: Vec2) => a[0] * b[0] + a[1] * b[1];
const cross2 = (a: Vec2, b: Vec2) => a[0] * b[1] - a[1] * b[0];
const dist2 = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** The point at parameter `t` of a curve. */
function at(curve: Curve, t: number): Vec2 {
  if (curve.kind === 'line')
    return [curve.a[0] + t * (curve.b[0] - curve.a[0]), curve.a[1] + t * (curve.b[1] - curve.a[1])];
  if (curve.kind === 'arc') {
    const cos = Math.cos(t);
    const sin = Math.sin(t);
    return [
      curve.c[0] + curve.r * (cos * curve.x[0] + sin * curve.y[0]),
      curve.c[1] + curve.r * (cos * curve.x[1] + sin * curve.y[1]),
    ];
  }
  const { points, params } = curve;
  let i = 0;
  while (i < params.length - 2 && t > (params[i + 1] as number)) i++;
  const p0 = params[i] as number;
  const p1 = params[i + 1] as number;
  const s = p1 > p0 ? (t - p0) / (p1 - p0) : 0;
  const a = points[i] as Vec2;
  const b = points[i + 1] as Vec2;
  return [a[0] + s * (b[0] - a[0]), a[1] + s * (b[1] - a[1])];
}

/** An arc's parameter (angle) for a point on its circle, in [from, from + 2π). */
function angleOf(curve: Extract<Curve, { kind: 'arc' }>, p: Vec2): number {
  const d = sub2(p, curve.c);
  let a = Math.atan2(dot2(d, curve.y), dot2(d, curve.x));
  while (a < curve.from - 1e-12) a += 2 * Math.PI;
  while (a >= curve.from + 2 * Math.PI - 1e-12) a -= 2 * Math.PI;
  return a;
}

/** A point at parameter `t` (within tolerance) of a traced curve, or undefined. */
function paramOn(curve: Traced, p: Vec2): number | undefined {
  const c = curve.curve;
  if (c.kind === 'line') {
    const d = sub2(c.b, c.a);
    const len2 = dot2(d, d);
    if (len2 < TOL * TOL) return undefined;
    const t = dot2(sub2(p, c.a), d) / len2;
    if (t < -TOL / Math.sqrt(len2) || t > 1 + TOL / Math.sqrt(len2)) return undefined;
    return dist2(at(c, t), p) < 10 * TOL ? Math.min(1, Math.max(0, t)) : undefined;
  }
  if (c.kind === 'arc') {
    if (Math.abs(dist2(p, c.c) - c.r) > 10 * TOL) return undefined;
    let a = angleOf(c, p);
    const eps = TOL / c.r;
    if (c.closed) return a;
    if (a > c.to + eps) {
      // Just before the start, the long way round.
      if (a - 2 * Math.PI > c.from - eps) a -= 2 * Math.PI;
      else return undefined;
    }
    return Math.min(c.to, Math.max(c.from, a));
  }
  // A polyline: the nearest segment.
  let best: { t: number; d: number } | undefined;
  for (let i = 0; i + 1 < c.points.length; i++) {
    const a = c.points[i] as Vec2;
    const b = c.points[i + 1] as Vec2;
    const d = sub2(b, a);
    const len2 = dot2(d, d);
    const s = len2 > 0 ? Math.min(1, Math.max(0, dot2(sub2(p, a), d) / len2)) : 0;
    const q: Vec2 = [a[0] + s * d[0], a[1] + s * d[1]];
    const e = dist2(p, q);
    if (!best || e < best.d) {
      const p0 = c.params[i] as number;
      best = { t: p0 + s * ((c.params[i + 1] as number) - p0), d: e };
    }
  }
  return best && best.d < 1e-4 ? best.t : undefined;
}

/** Where two curves meet: points (sketch frame), found segment by segment for polylines. */
function crossings(a: Traced, b: Traced): Vec2[] {
  const A = a.curve;
  const B = b.curve;
  if (A.kind === 'polyline' || B.kind === 'polyline') {
    const segs = (c: Traced): [Vec2, Vec2][] => {
      const k = c.curve;
      if (k.kind === 'line') return [[k.a, k.b]];
      const n =
        k.kind === 'arc' ? Math.max(4, Math.ceil(((k.to - k.from) / (2 * Math.PI)) * 96)) : 0;
      const pts =
        k.kind === 'polyline'
          ? k.points
          : Array.from({ length: n + 1 }, (_, i) => at(k, k.from + ((k.to - k.from) * i) / n));
      const out: [Vec2, Vec2][] = [];
      for (let i = 0; i + 1 < pts.length; i++) out.push([pts[i] as Vec2, pts[i + 1] as Vec2]);
      return out;
    };
    const out: Vec2[] = [];
    for (const [p, q] of segs(a))
      for (const [r, s] of segs(b)) {
        const hit = segmentCrossing(p, q, r, s, 1e-5);
        if (hit) out.push(hit);
      }
    return out;
  }
  if (A.kind === 'line' && B.kind === 'line') {
    const hit = segmentCrossing(A.a, A.b, B.a, B.b, TOL);
    return hit ? [hit] : collinearTouches(A, B);
  }
  if (A.kind === 'line' || B.kind === 'line') {
    const line = (A.kind === 'line' ? A : B) as Extract<Curve, { kind: 'line' }>;
    const arc = (A.kind === 'arc' ? A : B) as Extract<Curve, { kind: 'arc' }>;
    return lineCircle(line.a, line.b, arc.c, arc.r);
  }
  const P = A as Extract<Curve, { kind: 'arc' }>;
  const Q = B as Extract<Curve, { kind: 'arc' }>;
  return circleCircle(P.c, P.r, Q.c, Q.r);
}

/** Segments pq and rs crossing or touching (within `tol`): the point. */
function segmentCrossing(p: Vec2, q: Vec2, r: Vec2, s: Vec2, tol: number): Vec2 | undefined {
  const d = sub2(q, p);
  const e = sub2(s, r);
  const den = cross2(d, e);
  const ld = Math.hypot(d[0], d[1]);
  const le = Math.hypot(e[0], e[1]);
  if (ld < tol || le < tol || Math.abs(den) < 1e-12 * ld * le) return undefined;
  const w = sub2(r, p);
  const t = cross2(w, e) / den;
  const u = cross2(w, d) / den;
  if (t < -tol / ld || t > 1 + tol / ld || u < -tol / le || u > 1 + tol / le) return undefined;
  return [p[0] + t * d[0], p[1] + t * d[1]];
}

/** Two collinear, overlapping segments touch where one's end lies on the other. */
function collinearTouches(
  A: Extract<Curve, { kind: 'line' }>,
  B: Extract<Curve, { kind: 'line' }>,
): Vec2[] {
  const out: Vec2[] = [];
  const on = (p: Vec2, a: Vec2, b: Vec2) => {
    const d = sub2(b, a);
    const len = Math.hypot(d[0], d[1]);
    if (len < TOL) return false;
    if (Math.abs(cross2(sub2(p, a), d)) / len > TOL) return false;
    const t = dot2(sub2(p, a), d) / (len * len);
    return t >= -TOL / len && t <= 1 + TOL / len;
  };
  for (const p of [B.a, B.b]) if (on(p, A.a, A.b)) out.push(p);
  for (const p of [A.a, A.b]) if (on(p, B.a, B.b)) out.push(p);
  return out;
}

function lineCircle(a: Vec2, b: Vec2, c: Vec2, r: number): Vec2[] {
  const d = sub2(b, a);
  const f = sub2(a, c);
  const A = dot2(d, d);
  if (A < TOL * TOL) return [];
  const B = 2 * dot2(f, d);
  const C = dot2(f, f) - r * r;
  let disc = B * B - 4 * A * C;
  // Tangent within tolerance: one touching point.
  const slack = 4 * A * 2 * r * 10 * TOL;
  if (disc < -slack) return [];
  disc = Math.max(0, disc);
  const root = Math.sqrt(disc);
  const ts = disc === 0 ? [-B / (2 * A)] : [(-B - root) / (2 * A), (-B + root) / (2 * A)];
  return ts.map((t) => [a[0] + t * d[0], a[1] + t * d[1]] as Vec2);
}

function circleCircle(c1: Vec2, r1: number, c2: Vec2, r2: number): Vec2[] {
  const d = dist2(c1, c2);
  if (d < TOL) return [];
  if (d > r1 + r2 + 10 * TOL || d < Math.abs(r1 - r2) - 10 * TOL) return [];
  const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
  const h2 = r1 * r1 - a * a;
  const h = h2 > 0 ? Math.sqrt(h2) : 0;
  const u: Vec2 = [(c2[0] - c1[0]) / d, (c2[1] - c1[1]) / d];
  const m: Vec2 = [c1[0] + a * u[0], c1[1] + a * u[1]];
  if (h < TOL) return [m];
  return [
    [m[0] - h * u[1], m[1] + h * u[0]],
    [m[0] + h * u[1], m[1] - h * u[0]],
  ];
}

/** A point on a (rational) B-spline, by de Boor's algorithm. */
export function nurbsAt(c: SketchSpline, poles: Vec2[], t: number): Vec2 {
  const p = c.degree;
  const k = c.knots;
  const last = poles.length - 1;
  let span = p;
  while (span < last && t >= (k[span + 1] as number)) span++;
  const d: [number, number, number][] = [];
  for (let j = 0; j <= p; j++) {
    const i = j + span - p;
    const w = c.weights[i] ?? 1;
    const q = poles[i] as Vec2;
    d.push([q[0] * w, q[1] * w, w]);
  }
  for (let r = 1; r <= p; r++)
    for (let j = p; j >= r; j--) {
      const i = j + span - p;
      const den = (k[i + p - r + 1] as number) - (k[i] as number);
      const a = den === 0 ? 0 : (t - (k[i] as number)) / den;
      const x = d[j - 1] as [number, number, number];
      const y = d[j] as [number, number, number];
      d[j] = [x[0] + a * (y[0] - x[0]), x[1] + a * (y[1] - x[1]), x[2] + a * (y[2] - x[2])];
    }
  const h = d[p] as [number, number, number];
  return [h[0] / h[2], h[1] / h[2]];
}

const keyOf = (tag: bigint | undefined, secondary: bigint | undefined) =>
  `${tag ?? '?'}:${secondary ?? 0n}`;

function boxOf(points: Vec2[]): [number, number, number, number] {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  return [
    Math.min(...xs) - TOL,
    Math.min(...ys) - TOL,
    Math.max(...xs) + TOL,
    Math.max(...ys) + TOL,
  ];
}

function arcCurve(c: SketchCircular): Extract<Curve, { kind: 'arc' }> {
  const n = c.normal;
  const x: Vec2 = [c.xAxis[0], c.xAxis[1]];
  // y = n × x, in the sketch plane.
  const y: Vec2 = [n[1] * c.xAxis[2] - n[2] * c.xAxis[1], n[2] * c.xAxis[0] - n[0] * c.xAxis[2]];
  const closed = Math.abs(c.endAngle - c.startAngle) >= 2 * Math.PI - 1e-9;
  return {
    kind: 'arc',
    c: [c.center[0], c.center[1]],
    r: c.radius,
    x,
    y,
    from: closed ? 0 : c.startAngle,
    to: closed ? 2 * Math.PI : c.endAngle,
    closed,
  };
}

/** The sketch's profile curves (not construction), traced. */
function trace(s: F3dSketch, profileCurves: Set<string>): Traced[] {
  const points = new Map(s.points.map((p) => [p.id, p.at]));
  const pt = (id: number | undefined, fallback: Vec3): Vec2 => {
    const p = (id !== undefined ? points.get(id) : undefined) ?? fallback;
    return [p[0], p[1]];
  };
  const used = (c: { construction: boolean; tag?: bigint }) =>
    !c.construction || profileCurves.has(String(c.tag));
  const out: Traced[] = [];
  for (const l of s.lines) {
    if (!used(l)) continue;
    const a = pt(l.startPoint, l.start);
    const b = pt(l.endPoint, l.end);
    if (dist2(a, b) < TOL) continue;
    out.push({
      key: keyOf(l.tag, l.secondary),
      curve: { kind: 'line', a, b },
      t0: 0,
      t1: 1,
      closed: false,
      box: boxOf([a, b]),
    });
  }
  for (const c of s.circulars) {
    if (!used(c)) continue;
    const curve = arcCurve(c);
    const box: [number, number, number, number] = [
      curve.c[0] - c.radius - TOL,
      curve.c[1] - c.radius - TOL,
      curve.c[0] + c.radius + TOL,
      curve.c[1] + c.radius + TOL,
    ];
    out.push({
      key: keyOf(c.tag, c.secondary),
      curve,
      t0: curve.from,
      t1: curve.to,
      closed: curve.closed,
      box,
    });
  }
  for (const c of s.splines) {
    if (!used(c)) continue;
    const poles = c.poles.map((p) => [p[0], p[1]] as Vec2);
    const k = c.knots;
    const t0 = k[c.degree] as number;
    const t1 = k[poles.length] as number;
    const n = Math.max(16, 8 * (poles.length - c.degree));
    const params = Array.from({ length: n + 1 }, (_, i) => t0 + ((t1 - t0) * i) / n);
    const pts = params.map((t) => nurbsAt(c, poles, t));
    const closed = dist2(pts[0] as Vec2, pts.at(-1) as Vec2) < TOL;
    out.push({
      key: keyOf(c.tag, c.secondary),
      curve: { kind: 'polyline', points: pts, params, closed },
      t0,
      t1,
      closed,
      box: boxOf(pts),
    });
  }
  return out;
}

/** Each curve, and where the sketch's other curves meet it (its parameter there). */
export interface SketchPieces {
  byKey: Map<string, { traced: Traced; hits: { other: string; t: number }[] }>;
}

export function sketchPieces(s: F3dSketch, profileCurves: Set<string>): SketchPieces {
  const traced = trace(s, profileCurves);
  const byKey: SketchPieces['byKey'] = new Map();
  const overlap = (a: Traced, b: Traced) =>
    a.box[0] <= b.box[2] && b.box[0] <= a.box[2] && a.box[1] <= b.box[3] && b.box[1] <= a.box[3];
  const hits = new Map<Traced, { other: string; t: number }[]>(traced.map((t) => [t, []]));
  for (let i = 0; i < traced.length; i++)
    for (let j = i + 1; j < traced.length; j++) {
      const a = traced[i] as Traced;
      const b = traced[j] as Traced;
      if (!overlap(a, b)) continue;
      for (const p of crossings(a, b)) {
        const ta = paramOn(a, p);
        const tb = paramOn(b, p);
        if (ta === undefined || tb === undefined) continue;
        hits.get(a)?.push({ other: b.key, t: ta });
        hits.get(b)?.push({ other: a.key, t: tb });
      }
    }
  // Two curves under one key (a duplicate): neither can be told apart.
  const twice = new Set<string>();
  for (const t of traced) {
    if (byKey.has(t.key)) twice.add(t.key);
    byKey.set(t.key, { traced: t, hits: hits.get(t) ?? [] });
  }
  for (const key of twice) byKey.delete(key);
  return { byKey };
}

/**
 * Where a curve is cut by the given other curves: the distinct parameters
 * inside it, in order (on a closed curve, all of them).
 */
function cutsBy(entry: { traced: Traced; hits: { other: string; t: number }[] }, by: Set<string>) {
  const t = entry.traced;
  const span = Math.abs(t.t1 - t.t0);
  const eps = span * 1e-7 + 1e-9;
  const own = entry.hits
    .filter((h) => h.other !== t.key && by.has(h.other))
    // On a closed curve, a cut at its start is the one at its end: (t0, t1].
    .map((h) => (t.closed && h.t < t.t0 + eps ? h.t + span : h.t))
    .filter((x) => t.closed || (x > t.t0 + eps && x < t.t1 - eps))
    .sort((a, b) => a - b);
  const distinct: number[] = [];
  for (const x of own)
    if (distinct.length === 0 || x - (distinct.at(-1) as number) > eps) distinct.push(x);
  return distinct;
}

/** Piece `k` of `n` of a curve as a polyline, or undefined when the curve is not cut into `n`. */
function piece(t: Traced, cuts: number[], k: number, n: number): Vec2[] | undefined {
  let a: number;
  let b: number;
  if (t.closed) {
    if (cuts.length === 0) {
      if (n !== 1) return undefined;
      a = t.t0;
      b = t.t1;
    } else {
      if (cuts.length !== n) return undefined;
      // Counted by where they end: piece 1 ends at the first cut, and starts
      // at the last one, round past the curve's start.
      b = cuts[k - 1] as number;
      a = k === 1 ? (cuts[n - 1] as number) - (t.t1 - t.t0) : (cuts[k - 2] as number);
    }
  } else {
    if (cuts.length + 1 !== n) return undefined;
    a = k === 1 ? t.t0 : (cuts[k - 2] as number);
    b = k === n ? t.t1 : (cuts[k - 1] as number);
  }
  const c = t.curve;
  const steps =
    c.kind === 'line'
      ? 1
      : c.kind === 'arc'
        ? Math.max(2, Math.ceil((Math.abs(b - a) / (2 * Math.PI)) * 96))
        : Math.max(2, Math.ceil(((b - a) / (t.t1 - t.t0)) * c.points.length * 2));
  const wrap = (x: number) =>
    t.closed && x > t.t1 ? x - (t.t1 - t.t0) : t.closed && x < t.t0 ? x + (t.t1 - t.t0) : x;
  return Array.from({ length: steps + 1 }, (_, i) => at(c, wrap(a + ((b - a) * i) / steps)));
}

/**
 * The polylines of a region's loops, from its pieces; undefined when a piece
 * cannot be found as Fusion counted it, or the pieces do not close up.
 */
export function regionPieces(pieces: SketchPieces, loops: RegionPiece[][]): Vec2[][] | undefined {
  const out: Vec2[][] = [];
  const ends: Vec2[] = [];
  // A curve's pieces are counted between the region's own curves.
  const own = new Set(loops.flat().map((m) => keyOf(m.tag, m.secondary)));
  // A piece listed twice is a slit the boundary runs along on both sides: it
  // encloses nothing, so it goes.
  const listed = new Map<string, number>();
  const name = (m: RegionPiece) => `${keyOf(m.tag, m.secondary)}#${m.piece}/${m.of}`;
  for (const m of loops.flat()) listed.set(name(m), (listed.get(name(m)) ?? 0) + 1);
  const done = new Set<string>();
  for (const loop of loops)
    for (const m of loop) {
      if ((listed.get(name(m)) as number) % 2 === 0 || done.has(name(m))) continue;
      done.add(name(m));
      const entry = pieces.byKey.get(keyOf(m.tag, m.secondary));
      if (!entry) return undefined;
      const line = piece(entry.traced, cutsBy(entry, own), m.piece, m.of);
      if (!line) return undefined;
      const first = line[0] as Vec2;
      const last = line.at(-1) as Vec2;
      const mid = centre(line);
      // A piece lying on another curve's (collinear curves overlapping) counts once.
      const same = (other: Vec2[]) =>
        dist2(mid, centre(other)) < 1e-5 &&
        ((dist2(first, other[0] as Vec2) < 1e-5 && dist2(last, other.at(-1) as Vec2) < 1e-5) ||
          (dist2(first, other.at(-1) as Vec2) < 1e-5 && dist2(last, other[0] as Vec2) < 1e-5));
      if (out.some(same)) continue;
      out.push(line);
      if (dist2(first, last) > 1e-5) ends.push(first, last);
    }
  // Every end meets another one.
  const left = [...ends];
  while (left.length > 0) {
    const p = left.pop() as Vec2;
    const i = left.findIndex((q) => dist2(p, q) < 1e-5);
    if (i < 0) return undefined;
    left.splice(i, 1);
  }
  return out;
}

/** The mean of a polyline's points. */
function centre(line: Vec2[]): Vec2 {
  let x = 0;
  let y = 0;
  for (const p of line) {
    x += p[0];
    y += p[1];
  }
  return [x / line.length, y / line.length];
}

/** Whether a point is inside the polylines by the even-odd rule. */
export function insidePieces(lines: Vec2[][], p: readonly [number, number]): boolean {
  let inside = false;
  for (const line of lines)
    for (let i = 0; i + 1 < line.length; i++) {
      const a = line[i] as Vec2;
      const b = line[i + 1] as Vec2;
      if (a[1] > p[1] !== b[1] > p[1]) {
        const x = a[0] + ((p[1] - a[1]) * (b[0] - a[0])) / (b[1] - a[1]);
        if (x > p[0]) inside = !inside;
      }
    }
  return inside;
}
