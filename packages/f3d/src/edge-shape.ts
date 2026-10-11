/**
 * The geometry of a fillet's or chamfer's edge, worked out from the surfaces
 * of the faces it runs between and of the faces that end it (cm, model
 * space): what Extrudo's fingerprint of that edge would hold (ADR-0005), so
 * Extrudo can find the edge where its name no longer resolves.
 *
 * Two planes meet in a line; a plane touches a cylinder along its axis (a
 * fillet's edge) in a line, and so do two cylinders side by side; a plane
 * across a cylinder's or cone's axis cuts a circle, and so does a cone
 * meeting a cylinder or cone on its axis (a countersink). The bounding faces cut that curve;
 * the edge runs between the cuts the most bounding faces share, the shortest
 * such stretch.
 */
import type { AsmSurface } from './asm';
import type { Vec3 } from './decode/sketch-geometry';
import type { F3dEdge, F3dFace } from './model';

export interface EdgeShape {
  type: 'line' | 'circle';
  /** Midpoint, mm (Extrudo: the middle of the edge's parameter range; a full circle: its centre). */
  at: Vec3;
  /** A line's direction or a circle's axis, first non-zero component positive. */
  dir: Vec3;
  /** Length, mm. */
  size: number;
  /** The midpoint in the file's model space, cm. */
  mid: Vec3;
  /** Its two ends, cm (none for a whole circle). */
  ends?: [Vec3, Vec3];
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
function lineCuts(p0: Vec3, u: Vec3, s: AsmSurface): number[] {
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
}

const circleAt = (c: Circle, θ: number): Vec3 =>
  add(c.center, add(scale(c.u, c.radius * Math.cos(θ)), scale(c.v, c.radius * Math.sin(θ))));

/** Where a circle crosses or touches a surface: its angles in [0, 2π). */
function circleCuts(c: Circle, s: AsmSurface): number[] {
  const wrap = (θ: number) => ((θ % TAU) + TAU) % TAU;
  if (s.kind === 'plane') {
    // n·(C − q) + r (cos θ n·u + sin θ n·v) = 0
    const A = c.radius * dot(s.normal, c.u);
    const B = c.radius * dot(s.normal, c.v);
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
 * two ends the most bounding faces cut, the shortest of those.
 */
function extent(cuts: number[][], period?: number): [number, number] | undefined {
  const all = cuts.flat();
  const near = (x: number, y: number) => {
    const d = Math.abs(x - y);
    return (period ? Math.min(d, period - d) : d) < 1e-5;
  };
  let best: { covered: number; length: number; a: number; b: number } | undefined;
  for (const a of all) {
    for (const b0 of all) {
      const b = period && b0 <= a ? b0 + period : b0;
      const length = b - a;
      if (length < 1e-5) continue;
      const covered = cuts.filter((c) => c.some((x) => near(x, a) || near(x, b0))).length;
      if (
        !best ||
        covered > best.covered ||
        (covered === best.covered && length < best.length - 1e-9)
      ) {
        best = { covered, length, a, b };
      }
    }
  }
  return best && best.covered >= Math.min(2, cuts.filter((c) => c.length > 0).length)
    ? [best.a, best.b]
    : undefined;
}

const surfaces = (faces: F3dFace[]) => faces.flatMap((f) => (f.surface ? [f.surface] : []));

function lineShape(p0: Vec3, dir: Vec3, bounds: F3dFace[]): EdgeShape | undefined {
  const u = unit(dir);
  const cuts = surfaces(bounds).map((s) => lineCuts(p0, u, s));
  const range = extent(cuts);
  if (!range) return undefined;
  const mid = add(p0, scale(u, (range[0] + range[1]) / 2));
  const ends: [Vec3, Vec3] = [add(p0, scale(u, range[0])), add(p0, scale(u, range[1]))];
  return {
    type: 'line',
    at: mm(mid),
    dir: canonical(u),
    size: round6((range[1] - range[0]) * 10),
    mid,
    ends,
  };
}

function circleShape(center: Vec3, axis: Vec3, radius: number, bounds: F3dFace[]): EdgeShape {
  const a = unit(axis);
  const helper: Vec3 = Math.abs(a[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const u = unit(cross(a, helper));
  const c: Circle = { center, axis: a, radius, u, v: cross(a, u) };
  const range = extent(
    surfaces(bounds).map((s) => circleCuts(c, s)),
    TAU,
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
  };
}

/** An edge's geometry (see the module comment), when its surfaces are ones this follows. */
export function edgeShape(e: F3dEdge): EdgeShape | undefined {
  const a = e.faces[0].surface;
  const b = e.faces[1].surface;
  if (!a || !b) return undefined;
  const pa = a.kind === 'plane' ? a : undefined;
  const pb = b.kind === 'plane' ? b : undefined;
  if (pa && pb) {
    const u = cross(pa.normal, pb.normal);
    const uu = dot(u, u);
    if (uu < 1e-12) return undefined;
    const d1 = dot(pa.normal, pa.point);
    const d2 = dot(pb.normal, pb.point);
    const p0 = scale(add(scale(cross(pb.normal, u), d1), scale(cross(u, pa.normal), d2)), 1 / uu);
    return lineShape(p0, u, e.bounds);
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
      // Along a cylinder's axis: the plane touches it in a line.
      const off = dot(sub(round.center, plane.point), n);
      if (!round.cylinder || Math.abs(Math.abs(off) - round.radius) > TOL) return undefined;
      return lineShape(sub(round.center, scale(n, off)), axis, e.bounds);
    }
    if (Math.abs(Math.abs(along) - 1) > 1e-9) return undefined;
    const h = dot(n, sub(plane.point, round.center)) / along;
    const r = radiusAt(round, h);
    if (r < TOL) return undefined;
    return circleShape(add(round.center, scale(axis, h)), axis, r, e.bounds);
  }
  if (ca && cb) {
    const axis = unit(ca.axis);
    const other = unit(cb.axis);
    if (norm(cross(axis, other)) > 1e-9) return undefined;
    const w0 = sub(cb.center, ca.center);
    const w = sub(w0, scale(axis, dot(w0, axis)));
    const d = norm(w);
    if (d < TOL) {
      // On one axis (a countersink and its hole): a circle where the radii agree.
      const sign = dot(axis, other);
      const off = dot(sub(ca.center, cb.center), other);
      const slopes = ca.slope - cb.slope * sign;
      if (Math.abs(slopes) < 1e-12) return undefined;
      const h = (cb.radius + cb.slope * off - ca.radius) / slopes;
      const r = radiusAt(ca, h);
      if (r < TOL) return undefined;
      return circleShape(add(ca.center, scale(axis, h)), axis, r, e.bounds);
    }
    // Cylinders side by side: parallel axes, touching along a line.
    if (!ca.cylinder || !cb.cylinder) return undefined;
    for (const sign of [1, -1]) {
      const p = add(ca.center, scale(w, (sign * ca.radius) / d));
      if (Math.abs(radial(cb, p)) < TOL) return lineShape(p, axis, e.bounds);
    }
  }
  return undefined;
}
