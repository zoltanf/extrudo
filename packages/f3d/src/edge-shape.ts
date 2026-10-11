/**
 * The geometry of a fillet's or chamfer's edge, worked out from the surfaces
 * of the faces it runs between and of the faces that end it (cm, model
 * space): what Extrudo's fingerprint of that edge would hold (ADR-0005), so
 * Extrudo can find the edge where its name no longer resolves.
 *
 * Two planes meet in a line; a plane along a cylinder's axis touches it in
 * a line (a fillet's edge) or cuts it in two, and so do two cylinders side
 * by side; a plane across a cylinder's or cone's axis cuts a circle, and so
 * does a cone meeting a cylinder or cone on its axis (a countersink). Where
 * the surfaces meet in two lines, or in a curve not followed here, the edges
 * the file's B-rep streams still hold between the two faces (`known`) say
 * which line it is, or give the line or circle themselves. The bounding
 * faces cut that curve; the edge runs between the cuts the most bounding
 * faces share: a stretch a known edge spans, else the shortest such stretch.
 */
import type { AsmSurface } from './asm';
import type { Vec3 } from './decode/sketch-geometry';
import type { F3dEdge, F3dFace, KnownEdge } from './model';

export interface EdgeShape {
  type: 'line' | 'circle' | 'ellipse';
  /** Midpoint, mm (Extrudo: the middle of the edge's parameter range; a full circle: its centre). */
  at: Vec3;
  /** A line's direction or a circle's or ellipse's axis, first non-zero component positive. */
  dir: Vec3;
  /** Length, mm. */
  size: number;
  /** The midpoint in the file's model space, cm. */
  mid: Vec3;
  /** Its two ends, cm (none for a whole circle). */
  ends?: [Vec3, Vec3];
  /** A circle's centre, unit axis and radius, cm. */
  circle?: { center: Vec3; axis: Vec3; radius: number };
  /** The curve is one of two the surfaces meet in, or not theirs at all: the file's B-rep edges chose it. */
  chosen?: true;
}

type Plane = Extract<AsmSurface, { kind: 'plane' }>;
type Cone = Extract<AsmSurface, { kind: 'cone' }>;

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const norm = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const unit = (a: Vec3) => scale(a, 1 / norm(a));
const round6 = (x: number) => Math.round(x * 1e6) / 1e6 || 0;
const mm = (p: Vec3): Vec3 => [round6(p[0] * 10), round6(p[1] * 10), round6(p[2] * 10)];
/** A direction with its first non-zero component positive, as Extrudo stores axes. */
export const canonical = (v: Vec3): Vec3 => {
  const first = v.find((x) => Math.abs(x) > 1e-9) ?? 1;
  const k = first < 0 ? -1 : 1;
  return [round6(v[0] * k), round6(v[1] * k), round6(v[2] * k)];
};

/** Lengths closer than this (cm) are equal: cuts at one point, a plane touching a cylinder. */
const TOL = 1e-6;
const TAU = 2 * Math.PI;

const cone = (s: AsmSurface | undefined): Cone | undefined => (s?.kind === 'cone' ? s : undefined);

/** A cone's (or cylinder's) radius at `h` cm along its unit axis from its centre. */
const radiusAt = (c: Cone, h: number) => c.radius + c.slope * h;

/** A point's distance from a cone's axis, less the cone's radius there (signed). */
function radial(c: Cone, x: Vec3): number {
  const a = unit(c.axis);
  const w = sub(x, c.center);
  const h = dot(w, a);
  return norm(sub(w, scale(a, h))) - radiusAt(c, h);
}

/** Where a line `p0 + t·u` (unit u) crosses or touches a surface: its t values. */
export function lineCuts(p0: Vec3, u: Vec3, s: AsmSurface): number[] {
  if (s.kind === 'plane') {
    const nd = dot(s.normal, u);
    return Math.abs(nd) < 1e-9 ? [] : [dot(s.normal, sub(s.point, p0)) / nd];
  }
  const c = cone(s);
  if (!c) return [];
  // |w⊥ + t u⊥| = r0 + k (h0 + t u·a): across the axis, the radius where the line is.
  const a = unit(c.axis);
  const w = sub(p0, c.center);
  const across = (v: Vec3) => sub(v, scale(a, dot(v, a)));
  const uu = across(u);
  const ww = across(w);
  const k = c.slope;
  const ua = dot(u, a);
  const r0 = radiusAt(c, dot(w, a));
  const A = dot(uu, uu) - k * k * ua * ua;
  const B = dot(uu, ww) - k * ua * r0;
  const C = dot(ww, ww) - r0 * r0;
  const real = (t: number) => r0 + k * ua * t >= -TOL;
  if (Math.abs(A) < 1e-12) return Math.abs(B) < 1e-12 ? [] : [-C / (2 * B)].filter(real);
  const disc = B * B - A * C;
  const tol = 2 * TOL * Math.max(c.radius, 1e-3) * Math.abs(A);
  if (disc < -tol) return [];
  if (disc <= tol) return [-B / A].filter(real);
  const root = Math.sqrt(disc);
  return [(-B - root) / A, (-B + root) / A].filter(real);
}

/** A circle: centre, unit axis, radius, and two unit directions across the axis. */
interface Circle {
  center: Vec3;
  axis: Vec3;
  radius: number;
  u: Vec3;
  v: Vec3;
  /** An ellipse: its radius along `v` (`radius` is along `u`). */
  minor?: number;
}

const circleAt = (c: Circle, θ: number): Vec3 =>
  add(
    c.center,
    add(scale(c.u, c.radius * Math.cos(θ)), scale(c.v, (c.minor ?? c.radius) * Math.sin(θ))),
  );

/** Where a circle crosses or touches a surface: its angles in [0, 2π). */
function circleCuts(c: Circle, s: AsmSurface): number[] {
  const wrap = (θ: number) => ((θ % TAU) + TAU) % TAU;
  if (s.kind === 'plane') {
    // n·(C − q) + r (cos θ n·u + sin θ n·v) = 0
    const A = c.radius * dot(s.normal, c.u);
    const B = (c.minor ?? c.radius) * dot(s.normal, c.v);
    const D = dot(s.normal, sub(c.center, s.point));
    const R = Math.hypot(A, B);
    if (R < 1e-9 || Math.abs(D) > R + TOL) return [];
    const φ = Math.atan2(B, A);
    const δ = Math.acos(Math.max(-1, Math.min(1, -D / R)));
    return δ < 1e-6 ? [wrap(φ)] : [wrap(φ - δ), wrap(φ + δ)];
  }
  const cyl = cone(s);
  if (!cyl) return [];
  // Numerically: sign changes of the radial distance, and where it touches 0.
  const f = (θ: number) => radial(cyl, circleAt(c, θ));
  const n = 720;
  const out: number[] = [];
  const g = Array.from({ length: n + 1 }, (_, i) => f((i * TAU) / n));
  for (let i = 0; i < n; i++) {
    const a = g[i] as number;
    const b = g[i + 1] as number;
    let lo = (i * TAU) / n;
    let hi = ((i + 1) * TAU) / n;
    if (a === 0) out.push(lo);
    else if (a * b < 0) {
      for (let k = 0; k < 60; k++) {
        const m = (lo + hi) / 2;
        if (f(lo) * f(m) <= 0) hi = m;
        else lo = m;
      }
      out.push((lo + hi) / 2);
    } else {
      const prev = g[(i + n - 1) % n] as number;
      if (Math.abs(a) <= Math.abs(prev) && Math.abs(a) <= Math.abs(b) && Math.abs(a) < 1e-3) {
        // A touch: the minimum of |f| near here, by golden section.
        let x0 = lo - TAU / n;
        let x1 = hi;
        for (let k = 0; k < 80; k++) {
          const m1 = x1 - (x1 - x0) / 1.618;
          const m2 = x0 + (x1 - x0) / 1.618;
          if (Math.abs(f(m1)) < Math.abs(f(m2))) x1 = m2;
          else x0 = m1;
        }
        const θ = (x0 + x1) / 2;
        if (Math.abs(f(θ)) < TOL) out.push(wrap(θ));
      }
    }
  }
  return out;
}

/**
 * The stretch `[a, b]` (b > a; on a circle, angles with b − a the arc) whose
 * two ends the most bounding faces cut: one a known edge spans (`spans`, its
 * ends in the same parameter), else the shortest.
 */
function extent(
  cuts: number[][],
  period?: number,
  spans: [number, number][] = [],
): [number, number] | undefined {
  const all = cuts.flat();
  const near = (x: number, y: number) => {
    const d = Math.abs(x - y);
    return (period ? Math.min(d, period - d) : d) < 1e-5;
  };
  let best: { covered: number; known: boolean; length: number; a: number; b: number } | undefined;
  for (const a of all) {
    for (const b0 of all) {
      const b = period && b0 <= a ? b0 + period : b0;
      const length = b - a;
      if (length < 1e-5) continue;
      const covered = cuts.filter((c) => c.some((x) => near(x, a) || near(x, b0))).length;
      const known = spans.some(
        ([x, y]) => (near(x, a) && near(y, b0)) || (near(x, b0) && near(y, a)),
      );
      if (
        !best ||
        covered > best.covered ||
        (covered === best.covered && known && !best.known) ||
        (covered === best.covered && known === best.known && length < best.length - 1e-9)
      ) {
        best = { covered, known, length, a, b };
      }
    }
  }
  return best && best.covered >= Math.min(2, cuts.filter((c) => c.length > 0).length)
    ? [best.a, best.b]
    : undefined;
}

/** A face's surface where it is: a copy's own, not the copied face's. */
export const surfaceOf = (f: F3dFace) => (f.instance ? f.own : f.surface);
const surfaces = (faces: F3dFace[]) => faces.flatMap((f) => surfaceOf(f) ?? []);

/** A curve two surfaces may meet in (cm). */
type Support =
  | { kind: 'line'; p0: Vec3; dir: Vec3 }
  | { kind: 'circle'; center: Vec3; axis: Vec3; radius: number }
  | { kind: 'ellipse'; center: Vec3; axis: Vec3; major: Vec3; radius: number; minor: number };

/** How far (cm) a point lies from a support curve (an ellipse: not measured). */
function gap(c: Support, p: Vec3): number {
  if (c.kind === 'ellipse') return Number.POSITIVE_INFINITY;
  if (c.kind === 'line') {
    const u = unit(c.dir);
    const w = sub(p, c.p0);
    return norm(sub(w, scale(u, dot(w, u))));
  }
  const w = sub(p, c.center);
  const h = dot(w, c.axis);
  return Math.hypot(h, norm(sub(w, scale(c.axis, h))) - c.radius);
}

/** Whether a known edge lies on a support curve: a curve of its kind through all its vertices. */
function holds(c: Support, k: KnownEdge): boolean {
  if (k.points.length === 0 || !k.points.every((p) => gap(c, p) < 1e-5)) return false;
  if (c.kind === 'line') return k.curve.kind === 'line';
  return (
    k.curve.kind === 'ellipse' &&
    Math.abs(k.curve.ratio - 1) < 1e-6 &&
    norm(cross(unit(k.curve.normal), c.axis)) < 1e-6 &&
    norm(sub(k.curve.center, c.center)) < 1e-5
  );
}

/** The support curve of a known edge: its line, or its circle. */
function supportOf(k: KnownEdge): Support | undefined {
  const c = k.curve;
  if (c.kind === 'line') return { kind: 'line', p0: c.point, dir: unit(c.direction) };
  if (c.kind === 'ellipse' && Math.abs(c.ratio - 1) < 1e-6)
    return { kind: 'circle', center: c.center, axis: unit(c.normal), radius: norm(c.major) };
  return undefined;
}

function lineShape(
  p0: Vec3,
  dir: Vec3,
  bounds: F3dFace[],
  known: KnownEdge[] = [],
): EdgeShape | undefined {
  const u = unit(dir);
  const cuts = surfaces(bounds).map((s) => lineCuts(p0, u, s));
  const line: Support = { kind: 'line', p0, dir: u };
  const spans = known
    .filter((k) => k.points.length === 2 && holds(line, k))
    .map((k) => k.points.map((p) => dot(sub(p, p0), u)) as [number, number]);
  // No bounding face cuts it where it ends: the one stretch a known edge spans.
  const range = extent(cuts, undefined, spans) ?? (spans.length === 1 ? spans[0] : undefined);
  if (!range) return undefined;
  const [t0, t1] = range[0] < range[1] ? range : [range[1], range[0]];
  const mid = add(p0, scale(u, (t0 + t1) / 2));
  const ends: [Vec3, Vec3] = [add(p0, scale(u, t0)), add(p0, scale(u, t1))];
  return {
    type: 'line',
    at: mm(mid),
    dir: canonical(u),
    size: round6((t1 - t0) * 10),
    mid,
    ends,
  };
}

function circleShape(
  center: Vec3,
  axis: Vec3,
  radius: number,
  bounds: F3dFace[],
  known: KnownEdge[] = [],
): EdgeShape {
  const a = unit(axis);
  const helper: Vec3 = Math.abs(a[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const u = unit(cross(a, helper));
  const c: Circle = { center, axis: a, radius, u, v: cross(a, u) };
  const circle = { center, axis: a, radius };
  const angle = (p: Vec3) => {
    const w = sub(p, center);
    return ((Math.atan2(dot(w, c.v), dot(w, c.u)) % TAU) + TAU) % TAU;
  };
  const spans = known
    .filter((k) => k.points.length === 2 && holds({ kind: 'circle', ...circle }, k))
    .map((k) => k.points.map(angle) as [number, number]);
  const range = extent(
    surfaces(bounds).map((s) => circleCuts(c, s)),
    TAU,
    spans,
  );
  if (!range) {
    // A whole circle: Extrudo's midpoint depends on where its seam is; the
    // centre is as near as any point on it.
    return {
      type: 'circle',
      at: mm(center),
      dir: canonical(a),
      size: round6(TAU * radius * 10),
      mid: center,
      circle,
    };
  }
  const mid = circleAt(c, (range[0] + range[1]) / 2);
  return {
    type: 'circle',
    at: mm(mid),
    dir: canonical(a),
    size: round6((range[1] - range[0]) * radius * 10),
    mid,
    ends: [circleAt(c, range[0]), circleAt(c, range[1])],
    circle,
  };
}

/** An ellipse's arc between the bounding faces' cuts; its length by Simpson's rule. */
function ellipseShape(c: Extract<Support, { kind: 'ellipse' }>, bounds: F3dFace[]): EdgeShape {
  const u = unit(c.major);
  const e: Circle = {
    center: c.center,
    axis: c.axis,
    radius: c.radius,
    u,
    v: cross(c.axis, u),
    minor: c.minor,
  };
  const range = extent(
    surfaces(bounds).map((s) => circleCuts(e, s)),
    TAU,
  );
  const [t0, t1] = range ?? [0, TAU];
  const n = 256;
  const speed = (t: number) => Math.hypot(c.radius * Math.sin(t), c.minor * Math.cos(t));
  let sum = speed(t0) + speed(t1);
  for (let i = 1; i < n; i++) sum += (i % 2 ? 4 : 2) * speed(t0 + ((t1 - t0) * i) / n);
  const length = (sum * (t1 - t0)) / (3 * n);
  // A whole ellipse: its centre, as for a whole circle.
  const mid = range ? circleAt(e, (t0 + t1) / 2) : c.center;
  return {
    type: 'ellipse',
    at: mm(mid),
    dir: canonical(c.axis),
    size: round6(length * 10),
    mid,
    ...(range ? { ends: [circleAt(e, t0), circleAt(e, t1)] as [Vec3, Vec3] } : {}),
  };
}

/** The curves two surfaces meet in, as far as this follows them. */
function supports(a: AsmSurface, b: AsmSurface): Support[] {
  const pa = a.kind === 'plane' ? a : undefined;
  const pb = b.kind === 'plane' ? b : undefined;
  if (pa && pb) {
    const u = cross(pa.normal, pb.normal);
    const uu = dot(u, u);
    if (uu < 1e-12) return [];
    const d1 = dot(pa.normal, pa.point);
    const d2 = dot(pb.normal, pb.point);
    const p0 = scale(add(scale(cross(pb.normal, u), d1), scale(cross(u, pa.normal), d2)), 1 / uu);
    return [{ kind: 'line', p0, dir: unit(u) }];
  }
  const plane: Plane | undefined = pa ?? pb;
  const ca = cone(a);
  const cb = cone(b);
  const round = ca ?? cb;
  if (plane && round) {
    const axis = unit(round.axis);
    const n = unit(plane.normal);
    const along = dot(n, axis);
    if (Math.abs(along) < 1e-9) {
      // Along a cylinder's axis: the plane touches it in a line, or cuts it in two.
      if (!round.cylinder) return [];
      const off = dot(sub(round.center, plane.point), n);
      const foot = sub(round.center, scale(n, off));
      if (Math.abs(Math.abs(off) - round.radius) <= TOL)
        return [{ kind: 'line', p0: foot, dir: axis }];
      if (Math.abs(off) > round.radius) return [];
      const across = scale(unit(cross(n, axis)), Math.sqrt(round.radius ** 2 - off ** 2));
      return [
        { kind: 'line', p0: add(foot, across), dir: axis },
        { kind: 'line', p0: sub(foot, across), dir: axis },
      ];
    }
    const h = dot(n, sub(plane.point, round.center)) / along;
    if (Math.abs(Math.abs(along) - 1) > 1e-9) {
      // Slanted across a cylinder: an ellipse, its minor axis square to both.
      if (!round.cylinder) return [];
      const minor = unit(cross(axis, n));
      return [
        {
          kind: 'ellipse',
          center: add(round.center, scale(axis, h)),
          axis: n,
          major: cross(minor, n),
          radius: round.radius / Math.abs(along),
          minor: round.radius,
        },
      ];
    }
    const r = radiusAt(round, h);
    if (r < TOL) return [];
    return [{ kind: 'circle', center: add(round.center, scale(axis, h)), axis, radius: r }];
  }
  if (ca && cb) {
    const axis = unit(ca.axis);
    const other = unit(cb.axis);
    if (norm(cross(axis, other)) > 1e-9) return [];
    const w0 = sub(cb.center, ca.center);
    const w = sub(w0, scale(axis, dot(w0, axis)));
    const d = norm(w);
    if (d < TOL) {
      // On one axis (a countersink and its hole): a circle where the radii agree.
      const sign = dot(axis, other);
      const off = dot(sub(ca.center, cb.center), other);
      const slopes = ca.slope - cb.slope * sign;
      if (Math.abs(slopes) < 1e-12) return [];
      const h = (cb.radius + cb.slope * off - ca.radius) / slopes;
      const r = radiusAt(ca, h);
      if (r < TOL) return [];
      return [{ kind: 'circle', center: add(ca.center, scale(axis, h)), axis, radius: r }];
    }
    // Cylinders side by side: parallel axes, touching along a line or crossing in two.
    if (!ca.cylinder || !cb.cylinder) return [];
    const ra = ca.radius;
    const rb = cb.radius;
    const x = (d * d + ra * ra - rb * rb) / (2 * d);
    const y2 = ra * ra - x * x;
    if (y2 < -2 * TOL * ra) return [];
    const toward = scale(w, 1 / d);
    const foot = add(ca.center, scale(toward, x));
    if (y2 <= 2 * TOL * ra) return [{ kind: 'line', p0: foot, dir: axis }];
    const across = scale(unit(cross(axis, toward)), Math.sqrt(y2));
    return [
      { kind: 'line', p0: add(foot, across), dir: axis },
      { kind: 'line', p0: sub(foot, across), dir: axis },
    ];
  }
  return [];
}

/** An edge's geometry (see the module comment), when its surfaces are ones this follows. */
export function edgeShape(e: F3dEdge): EdgeShape | undefined {
  const a = surfaceOf(e.faces[0]);
  const b = surfaceOf(e.faces[1]);
  const known = e.known ?? [];
  let found = a && b ? supports(a, b) : [];
  const chosen = found.length !== 1;
  if (found.length > 1) {
    // Two lines: the one the file's own edges between these faces lie on.
    found = found.filter((c) => known.some((k) => holds(c, k)));
  } else if (found.length === 0) {
    // Surfaces not followed here: the known edges' own line or circle, when they agree on one.
    const own = known.map(supportOf);
    const first = own[0];
    if (first && own.every((c) => c && known.every((k) => holds(first, k)))) found = [first];
  }
  const curve = found.length === 1 ? found[0] : undefined;
  if (!curve) return undefined;
  const shape =
    curve.kind === 'ellipse'
      ? ellipseShape(curve, e.bounds)
      : curve.kind === 'line'
        ? lineShape(curve.p0, curve.dir, e.bounds, known)
        : circleShape(curve.center, curve.axis, curve.radius, e.bounds, known);
  return shape && chosen ? { ...shape, chosen: true } : shape;
}

/** Whether two edges meet end to end, running on smoothly (one tangent chain). */
export function continues(a: EdgeShape, b: EdgeShape): boolean {
  if (!a.ends || !b.ends) return false;
  const tangent = (e: EdgeShape, p: Vec3): Vec3 | undefined => {
    if (e.type === 'line') return e.dir;
    if (e.type === 'circle' && e.circle) return cross(e.circle.axis, sub(p, e.circle.center));
    return undefined;
  };
  for (const p of a.ends)
    for (const q of b.ends) {
      if (norm(sub(p, q)) > 1e-4) continue;
      const u = tangent(a, p);
      const v = tangent(b, q);
      if (u && v && norm(cross(u, v)) < 1e-3 * norm(u) * norm(v)) return true;
    }
  return false;
}
