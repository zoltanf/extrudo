/**
 * What a sheet view is made of (P6-24 S2, ADR-0143's S2 amendment): 2D
 * curves in the view's own coordinates (mm at model scale, x right, y up,
 * the world origin at 0, 0; `toSheetView`), and the math that turns a span
 * of a model edge into exact 2D pieces. No kernel calls here.
 */
import type { BodyId, SheetViewFrame, Vec2, Vec3 } from '@extrudo/core';
import type { Conic, EdgeGeometry } from '../kernel';

/**
 * How a curve is drawn. `visible`: a sharp edge seen; `hidden`: any edge or
 * outline behind the model (an outline's has `face`); `outline`: a
 * silhouette of a curved face seen; `tangent`: a smooth edge seen (hidden
 * tangent edges are left out, and so are seams).
 */
export type ViewCurveKind = 'visible' | 'hidden' | 'outline' | 'tangent';

/** One piece of a view curve, in view mm. */
export type ViewPiece =
  | { type: 'line'; a: Vec2; b: Vec2 }
  /** Counter-clockwise from angle `start` to `end` (radians, `end > start`, at most a turn apart). */
  | { type: 'arc'; center: Vec2; radius: number; start: number; end: number }
  /**
   * `center + R(rotation)·(rx cos s, ry sin s)` for `s` counter-clockwise
   * from `start` to `end`, as the arc.
   */
  | {
      type: 'ellipse';
      center: Vec2;
      rx: number;
      ry: number;
      rotation: number;
      start: number;
      end: number;
    }
  /** Points on a curve that is no line, circle or ellipse, in order. */
  | { type: 'polyline'; points: Vec2[] };

export interface ViewCurve {
  kind: ViewCurveKind;
  body: BodyId;
  /**
   * The model edge's topological name (ADR-0005), when it comes from one and
   * the result is exact. What a dimension (S3) anchors to.
   */
  edge?: string;
  /** An outline's face, by its topological name (exact results only). */
  face?: string;
  pieces: ViewPiece[];
}

export interface ViewBounds {
  min: Vec2;
  max: Vec2;
}

/** Why a body a view asks for is not in it. */
export interface SkippedBody {
  body: BodyId;
  /** `mesh`: a mesh body (no B-rep edges); `missing`: not in the model at the marker. */
  reason: 'mesh' | 'missing';
}

/** The 2D lines of one view (plan §6.2). */
export interface ViewGeometry {
  curves: ViewCurve[];
  /** Around every curve; absent when there is none. */
  bounds?: ViewBounds;
  /** `partial`: a body was skipped (`skipped` says which and why); never an error. */
  status: 'ok' | 'partial';
  skipped: SkippedBody[];
  /**
   * `true`: OCCT's exact hidden-line removal. `false`: the quick polygonal
   * placeholder (chords of the display mesh, no names): drawn until the exact
   * result replaces it, and never anchored, measured or snapped to.
   */
  exact: boolean;
}

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const unit = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const TAU = 2 * Math.PI;
/** Shorter than this (mm), a piece is a point and is left out. */
export const TINY = 1e-6;

/** Rounds away floating noise (1e-9 mm, 1e-12 rad), so a model gives the same numbers each time. */
const r9 = (v: number) => Math.round(v * 1e9) / 1e9 + 0;
const r12 = (v: number) => Math.round(v * 1e12) / 1e12 + 0;
const tidy = ([x, y]: Vec2): Vec2 => [r9(x), r9(y)];

/** A point of a curve's span in view coordinates. */
export function toView(frame: SheetViewFrame, p: Vec3): Vec2 {
  return [dot(p, frame.right), dot(p, frame.up)];
}

/** A conic's point at parameter `t`, with its minor direction `y` (`axis × x`, or its reverse). */
function conicAt(c: Conic, y: Vec3, t: number): Vec3 {
  const x = unit(c.xDirection);
  const a = c.radius * Math.cos(t);
  const b = (c.minor ?? c.radius) * Math.sin(t);
  return [
    c.center[0] + a * x[0] + b * y[0],
    c.center[1] + a * x[1] + b * y[1],
    c.center[2] + a * x[2] + b * y[2],
  ];
}

/**
 * The conic's minor direction that makes its parameter the edge's: `axis ×
 * x`, or the reverse if a mirrored placement turned the curve the other way,
 * checked against the edge's own points. `undefined` if neither fits (the
 * caller draws the points instead).
 */
export function conicMinorDirection(g: EdgeGeometry): Vec3 | undefined {
  if (g.type === 'degenerate') return undefined;
  const c = g.conic;
  if (!c) return undefined;
  const y = unit(cross(c.axis, c.xDirection));
  const scale = Math.max(c.radius, 1);
  const n = g.points.length;
  for (const s of [1, -1]) {
    const ys: Vec3 = [y[0] * s, y[1] * s, y[2] * s];
    const fits = [0, Math.floor(n / 2), n - 1].every((i) => {
      const t = c.first + ((c.last - c.first) * i) / (n - 1);
      const p = conicAt(c, ys, t);
      const q = g.points[i] as Vec3;
      return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) <= 1e-6 * scale;
    });
    if (fits) return ys;
  }
  return undefined;
}

/** A point of a sampled curve at parameter `t` of `range`, between its samples. */
export function sampledAt(points: readonly Vec3[], range: [number, number], t: number): Vec3 {
  const f = (t - range[0]) / (range[1] - range[0] || 1);
  const x = Math.min(Math.max(f, 0), 1) * (points.length - 1);
  const i = Math.min(Math.floor(x), points.length - 2);
  const p = points[i] as Vec3;
  const q = points[i + 1] as Vec3;
  const u = x - i;
  return [p[0] + (q[0] - p[0]) * u, p[1] + (q[1] - p[1]) * u, p[2] + (q[2] - p[2]) * u];
}

/**
 * The span `[t0, t1]` of an edge (in its own curve parameter, `range` its
 * whole range) as 2D pieces: a line stays a line; a circle or ellipse
 * becomes an arc, an ellipse arc, or a line when seen edge-on; anything else
 * a polyline through its samples. Empty when the span projects to a point.
 */
export function projectSpan(
  g: EdgeGeometry,
  range: [number, number],
  t0: number,
  t1: number,
  frame: SheetViewFrame,
  minor?: Vec3,
): ViewPiece[] {
  if (g.type === 'degenerate' || g.points.length < 2) return [];
  if (g.type === 'line') {
    const a = tidy(toView(frame, sampledAt(g.points, range, t0)));
    const b = tidy(toView(frame, sampledAt(g.points, range, t1)));
    return Math.hypot(b[0] - a[0], b[1] - a[1]) <= TINY ? [] : [{ type: 'line', a, b }];
  }
  if (g.conic && minor && (g.type === 'circle' || g.type === 'ellipse')) {
    return projectConic(g.conic, minor, t0, t1, frame);
  }
  const inside = g.points.filter((_, i) => {
    const t = range[0] + ((range[1] - range[0]) * i) / (g.points.length - 1);
    return t > t0 && t < t1;
  });
  const points = [sampledAt(g.points, range, t0), ...inside, sampledAt(g.points, range, t1)].map(
    (p) => tidy(toView(frame, p)),
  );
  return polyline(points);
}

/** A polyline without repeated points, or nothing if it is a point. */
export function polyline(points: Vec2[]): ViewPiece[] {
  const out: Vec2[] = [];
  for (const p of points) {
    const q = out[out.length - 1];
    if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > TINY) out.push(p);
  }
  if (out.length < 2) return [];
  return out.length === 2
    ? [{ type: 'line', a: out[0] as Vec2, b: out[1] as Vec2 }]
    : [{ type: 'polyline', points: out }];
}

/**
 * A circle or ellipse span seen along the frame: `c + U cos t + V sin t` in
 * 2D, turned into its principal axes. Exact.
 */
function projectConic(
  c: Conic,
  minor: Vec3,
  t0: number,
  t1: number,
  frame: SheetViewFrame,
): ViewPiece[] {
  const x = unit(c.xDirection);
  const b = c.minor ?? c.radius;
  const center = toView(frame, c.center);
  const U: Vec2 = [c.radius * dot(x, frame.right), c.radius * dot(x, frame.up)];
  const V: Vec2 = [b * dot(minor, frame.right), b * dot(minor, frame.up)];
  const at = (t: number): Vec2 => [
    center[0] + U[0] * Math.cos(t) + V[0] * Math.sin(t),
    center[1] + U[1] * Math.cos(t) + V[1] * Math.sin(t),
  ];
  const turn = U[0] * V[1] - U[1] * V[0];
  const size = Math.max(Math.hypot(...U), Math.hypot(...V));
  if (Math.abs(turn) <= 1e-9 * size * size) {
    // Seen edge-on: a segment between the span's farthest points along its line.
    const w = Math.hypot(...U) >= Math.hypot(...V) ? U : V;
    const along = (p: Vec2) => (p[0] - center[0]) * w[0] + (p[1] - center[1]) * w[1];
    const ts = [t0, t1];
    const extreme = Math.atan2(V[0] * w[0] + V[1] * w[1], U[0] * w[0] + U[1] * w[1]);
    for (const e of [extreme, extreme + Math.PI]) {
      const k = Math.ceil((t0 - e) / TAU);
      const t = e + k * TAU;
      if (t <= t1) ts.push(t);
    }
    const points = ts.map(at);
    let lo = points[0] as Vec2;
    let hi = lo;
    for (const p of points) {
      if (along(p) < along(lo)) lo = p;
      if (along(p) > along(hi)) hi = p;
    }
    return polyline([tidy(lo), tidy(hi)]);
  }
  // Principal axes: P(t) = c + A cos(t − s0) + B sin(t − s0).
  const s0 =
    0.5 *
    Math.atan2(2 * (U[0] * V[0] + U[1] * V[1]), U[0] ** 2 + U[1] ** 2 - V[0] ** 2 - V[1] ** 2);
  const A: Vec2 = [
    U[0] * Math.cos(s0) + V[0] * Math.sin(s0),
    U[1] * Math.cos(s0) + V[1] * Math.sin(s0),
  ];
  const B: Vec2 = [
    -U[0] * Math.sin(s0) + V[0] * Math.cos(s0),
    -U[1] * Math.sin(s0) + V[1] * Math.cos(s0),
  ];
  const rx = Math.hypot(...A);
  const ry = Math.hypot(...B);
  const rotation = Math.atan2(A[1], A[0]);
  // Counter-clockwise on the sheet keeps the parameter's sense; clockwise reverses it.
  let [start, end] = turn > 0 ? [t0 - s0, t1 - s0] : [-(t1 - s0), -(t0 - s0)];
  const sweep = Math.min(end - start, TAU);
  if (Math.abs(rx - ry) <= 1e-9 * size) {
    start = normalAngle(rotation + start);
    return [
      {
        type: 'arc',
        center: tidy(center),
        radius: r9(rx),
        start: r12(start),
        end: r12(start + sweep),
      },
    ];
  }
  start = normalAngle(start);
  end = start + sweep;
  return [
    {
      type: 'ellipse',
      center: tidy(center),
      rx: r9(rx),
      ry: r9(ry),
      rotation: r12(rotation),
      start: r12(start),
      end: r12(end),
    },
  ];
}

/** An angle in [−π, π). */
function normalAngle(a: number): number {
  return a - TAU * Math.floor((a + Math.PI) / TAU);
}

/** The point of an arc or ellipse piece at its own parameter `s`. */
export function pieceAt(p: Extract<ViewPiece, { type: 'arc' | 'ellipse' }>, s: number): Vec2 {
  if (p.type === 'arc') {
    return [p.center[0] + p.radius * Math.cos(s), p.center[1] + p.radius * Math.sin(s)];
  }
  const [c, sn] = [Math.cos(p.rotation), Math.sin(p.rotation)];
  const [x, y] = [p.rx * Math.cos(s), p.ry * Math.sin(s)];
  return [p.center[0] + x * c - y * sn, p.center[1] + x * sn + y * c];
}

/** The two ends of a piece. */
export function pieceEnds(p: ViewPiece): [Vec2, Vec2] {
  switch (p.type) {
    case 'line':
      return [p.a, p.b];
    case 'polyline':
      return [p.points[0] as Vec2, p.points[p.points.length - 1] as Vec2];
    default:
      return [pieceAt(p, p.start), pieceAt(p, p.end)];
  }
}

/** The box around pieces, exact for arcs and ellipses; `undefined` for none. */
export function boundsOf(pieces: Iterable<ViewPiece>): ViewBounds | undefined {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  const add = ([x, y]: Vec2) => {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  };
  for (const p of pieces) {
    if (p.type === 'line') {
      add(p.a);
      add(p.b);
    } else if (p.type === 'polyline') {
      p.points.forEach(add);
    } else {
      add(pieceAt(p, p.start));
      add(pieceAt(p, p.end));
      const [rx, ry, rot] = p.type === 'arc' ? [p.radius, p.radius, 0] : [p.rx, p.ry, p.rotation];
      // Where x and y are extreme along the curve, inside the span.
      const ex = Math.atan2(-ry * Math.sin(rot), rx * Math.cos(rot));
      const ey = Math.atan2(ry * Math.cos(rot), rx * Math.sin(rot));
      for (const e of [ex, ex + Math.PI, ey, ey + Math.PI]) {
        const t = e + Math.ceil((p.start - e) / TAU) * TAU;
        if (t <= p.end) add(pieceAt(p, t));
      }
    }
  }
  if (!Number.isFinite(x0)) return undefined;
  return { min: tidy([x0, y0]), max: tidy([x1, y1]) };
}

/** Closer than this (mm), a hidden stretch lies on a visible one. */
const ON = 1e-6;
/** Hidden stretches shorter than this (mm, or rad × radius) after the cover is taken out are dropped. */
const SLIVER = 1e-5;

/** `[a, b]` minus the union of `cuts`, in order. */
function remaining(a: number, b: number, cuts: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  let at = a;
  for (const [c0, c1] of [...cuts].sort((x, y) => x[0] - y[0])) {
    if (c1 <= at) continue;
    if (c0 > at) out.push([at, Math.min(c0, b)]);
    at = Math.max(at, c1);
    if (at >= b) break;
  }
  if (at < b) out.push([at, b]);
  return out;
}

/**
 * A hidden piece without the stretches a drawn one covers (a box's back edge
 * behind its front edge, the far half of a circle seen square on): drawing
 * practice shows the visible line only. Lines against lines on the same
 * line, arcs against arcs of the same circle; other pieces are kept whole.
 */
export function uncovered(hidden: ViewPiece, drawn: readonly ViewPiece[]): ViewPiece[] {
  if (hidden.type === 'line') {
    const { a, b } = hidden;
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const u: Vec2 = [(b[0] - a[0]) / length, (b[1] - a[1]) / length];
    const along = (p: Vec2) => (p[0] - a[0]) * u[0] + (p[1] - a[1]) * u[1];
    const off = (p: Vec2) => Math.abs((p[0] - a[0]) * u[1] - (p[1] - a[1]) * u[0]);
    const cuts: [number, number][] = [];
    for (const d of drawn) {
      if (d.type !== 'line' || off(d.a) > ON || off(d.b) > ON) continue;
      const [s, t] = [along(d.a), along(d.b)];
      cuts.push([Math.min(s, t) - ON, Math.max(s, t) + ON]);
    }
    if (cuts.length === 0) return [hidden];
    return remaining(0, length, cuts)
      .filter(([s, t]) => t - s > SLIVER)
      .map(([s, t]) => ({
        type: 'line',
        a: tidy([a[0] + u[0] * s, a[1] + u[1] * s]),
        b: tidy([a[0] + u[0] * t, a[1] + u[1] * t]),
      }));
  }
  if (hidden.type === 'arc') {
    const sweep = hidden.end - hidden.start;
    const cuts: [number, number][] = [];
    for (const d of drawn) {
      if (d.type !== 'arc') continue;
      if (Math.abs(d.radius - hidden.radius) > ON) continue;
      if (Math.hypot(d.center[0] - hidden.center[0], d.center[1] - hidden.center[1]) > ON) continue;
      const slack = ON / Math.max(hidden.radius, ON);
      const x0 = d.start - hidden.start - TAU * Math.floor((d.start - hidden.start) / TAU);
      const w = d.end - d.start;
      cuts.push([x0 - slack, x0 + w + slack]);
      if (x0 + w > TAU) cuts.push([-slack, x0 + w - TAU + slack]);
      if (x0 + slack > TAU) cuts.push([-slack, x0 + slack - TAU]);
    }
    if (cuts.length === 0) return [hidden];
    return remaining(0, sweep, cuts)
      .filter(([s, t]) => (t - s) * hidden.radius > SLIVER)
      .map(([s, t]) => ({ ...hidden, start: r12(hidden.start + s), end: r12(hidden.start + t) }));
  }
  return [hidden];
}

/**
 * The curves a view draws for its switches: a view comes back with every
 * kind, so its style (`visible` leaves hidden lines out) and its tangent
 * edges switch are filters, and changing them computes nothing.
 */
export function shownCurves(
  geometry: ViewGeometry,
  show: { hidden: boolean; tangent: boolean },
): ViewCurve[] {
  return geometry.curves.filter(
    (c) => (show.hidden || c.kind !== 'hidden') && (show.tangent || c.kind !== 'tangent'),
  );
}

const near = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= ON;

/** `b` continuing `a`, as one piece, or `undefined`. */
function chained(a: ViewPiece, b: ViewPiece): ViewPiece | undefined {
  if (a.type === 'line' && b.type === 'line') {
    // Collinear lines sharing an end, either way round.
    for (const [p, q] of [
      [a.a, a.b],
      [a.b, a.a],
    ] as const) {
      for (const [s, t] of [
        [b.a, b.b],
        [b.b, b.a],
      ] as const) {
        if (!near(q, s)) continue;
        const cross = (q[0] - p[0]) * (t[1] - p[1]) - (q[1] - p[1]) * (t[0] - p[0]);
        const length = Math.hypot(t[0] - p[0], t[1] - p[1]);
        if (Math.abs(cross) <= ON * Math.max(length, 1)) return { type: 'line', a: p, b: t };
      }
    }
    return undefined;
  }
  if ((a.type === 'arc' && b.type === 'arc') || (a.type === 'ellipse' && b.type === 'ellipse')) {
    if (!near(a.center, b.center)) return undefined;
    if (a.type === 'arc' && b.type === 'arc' && Math.abs(a.radius - b.radius) > ON)
      return undefined;
    if (a.type === 'ellipse' && b.type === 'ellipse') {
      if (Math.abs(a.rx - b.rx) > ON || Math.abs(a.ry - b.ry) > ON) return undefined;
      // Rotated half a turn is the same ellipse with another start: not joined.
      if (Math.abs(normalAngle(a.rotation - b.rotation)) > 1e-9) return undefined;
    }
    const gap = normalAngle(b.start - a.end);
    if (Math.abs(gap) > 1e-9) return undefined;
    const sweep = Math.min(a.end - a.start + (b.end - b.start), TAU);
    return { ...a, end: r12(a.start + sweep) };
  }
  if (a.type === 'polyline' || b.type === 'polyline') {
    if (a.type === 'arc' || a.type === 'ellipse' || b.type === 'arc' || b.type === 'ellipse') {
      return undefined;
    }
    const pa = a.type === 'line' ? [a.a, a.b] : a.points;
    const pb = b.type === 'line' ? [b.a, b.b] : b.points;
    const [a0, a1] = [pa[0] as Vec2, pa[pa.length - 1] as Vec2];
    const [b0, b1] = [pb[0] as Vec2, pb[pb.length - 1] as Vec2];
    if (near(a1, b0)) return { type: 'polyline', points: [...pa, ...pb.slice(1)] };
    if (near(a1, b1)) return { type: 'polyline', points: [...pa, ...[...pb].reverse().slice(1)] };
    if (near(a0, b1)) return { type: 'polyline', points: [...pb, ...pa.slice(1)] };
    if (near(a0, b0)) return { type: 'polyline', points: [...[...pb].reverse(), ...pa.slice(1)] };
  }
  return undefined;
}

/**
 * A curve's pieces with the ones that continue each other joined: an edge
 * HLR split at outline points, a circle in three arcs, comes back whole.
 */
export function joinPieces(pieces: readonly ViewPiece[]): ViewPiece[] {
  const out = [...pieces];
  for (let merged = true; merged; ) {
    merged = false;
    for (let i = 0; i < out.length && !merged; i++) {
      for (let j = 0; j < out.length && !merged; j++) {
        if (i === j) continue;
        const joined = chained(out[i] as ViewPiece, out[j] as ViewPiece);
        if (!joined) continue;
        out[i] = joined;
        out.splice(j, 1);
        merged = true;
      }
    }
  }
  return out;
}
