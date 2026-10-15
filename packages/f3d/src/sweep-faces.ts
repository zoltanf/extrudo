/**
 * Which profile curve made a face of a sweep along a flat path of lines and
 * arcs, by geometry. Along such a path the profile does not turn about the
 * path: a profile point keeps its offset across the path (`n`, along
 * B × T) and its height off the path's plane (`b`, along the plane's normal
 * B) all the way. So along a line a profile line sweeps a plane and a profile
 * arc a cylinder, as an extrude's; along an arc of the path, the profile at
 * the arc's start lies in a plane through the arc's axis and the faces are
 * those of a revolve about it: planes square to the axis, cylinders, cones
 * and tori. The face is matched against each piece of the path with the
 * profile carried to that piece's start. Model space, cm.
 */
import type { AsmSurface } from './asm';
import type { Vec3 } from './decode/sketch-geometry';

/**
 * A piece of the path. An arc turns right-handed about `axis` (unit) from `a`
 * to `b`; any other curve (a spline) gives its ends, the directions it leaves
 * `a` and reaches `b` in, and points it lies within (its poles).
 */
export type PathPiece =
  | { kind: 'line'; a: Vec3; b: Vec3 }
  | { kind: 'arc'; a: Vec3; b: Vec3; centre: Vec3; axis: Vec3 }
  | { kind: 'curve'; a: Vec3; b: Vec3; ta: Vec3; tb: Vec3; points: Vec3[] };

/** A curve of the profile, named as the sweep's faces will be. */
export type ProfileCurve =
  | { name: string; kind: 'line'; a: Vec3; b: Vec3 }
  | { name: string; kind: 'arc'; centre: Vec3; radius: number };

/** A profile curve across the path: `n` across it, `b` off its plane. */
type Flat =
  | { name: string; kind: 'line'; a: [number, number]; b: [number, number] }
  | { name: string; kind: 'arc'; c: [number, number]; radius: number };

/** A piece of the chained path, with the frame at its start and end. */
interface Piece {
  piece: PathPiece;
  start: Vec3;
  /** Unit tangent at its start and end. */
  t0: Vec3;
  t1: Vec3;
}

/** What naming a sweep's faces needs: the chained path, its plane and the profile across it. */
export interface SweptFaces {
  pieces: Piece[];
  closed: boolean;
  /** The profile is nearer the path's last end than its first: that end's cap is the start. */
  profileAtEnd: boolean;
  /** The path plane's unit normal. */
  B: Vec3;
  curves: Flat[];
  /** A point of the profile, and the profile plane's unit normal. */
  at: Vec3;
  normal: Vec3;
  /** That point across the path. */
  atFlat: [number, number];
}

const TOL = 1e-5;
/** The most path pieces chained (a file's path is untrusted). */
export const MAX_PATH_PIECES = 256;

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
const unit = (a: Vec3): Vec3 => scale(a, 1 / norm(a));
const parallel = (a: Vec3, b: Vec3) => norm(cross(unit(a), unit(b))) < 1e-6;

function tangent(p: PathPiece, end: boolean): Vec3 {
  if (p.kind === 'line') return unit(sub(p.b, p.a));
  if (p.kind === 'curve') return unit(end ? p.tb : p.ta);
  return unit(cross(p.axis, sub(end ? p.b : p.a, p.centre)));
}

const reversed = (p: PathPiece): PathPiece =>
  p.kind === 'line'
    ? { ...p, a: p.b, b: p.a }
    : p.kind === 'arc'
      ? { ...p, a: p.b, b: p.a, axis: scale(p.axis, -1) }
      : { ...p, a: p.b, b: p.a, ta: scale(p.tb, -1), tb: scale(p.ta, -1) };

/** The pieces end to end, or undefined when they don't make one chain. */
function chain(pieces: PathPiece[]): PathPiece[] | undefined {
  const [first, ...rest] = pieces;
  if (!first || pieces.length > MAX_PATH_PIECES) return undefined;
  const out = [first];
  const left = [...rest];
  const near = (x: Vec3, y: Vec3) => norm(sub(x, y)) < TOL;
  while (left.length > 0) {
    const head = out[0] as PathPiece;
    const tail = out[out.length - 1] as PathPiece;
    const i = left.findIndex((p) => near(p.a, tail.b) || near(p.b, tail.b));
    if (i >= 0) {
      const p = left.splice(i, 1)[0] as PathPiece;
      out.push(near(p.a, tail.b) ? p : reversed(p));
      continue;
    }
    const j = left.findIndex((p) => near(p.b, head.a) || near(p.a, head.a));
    if (j < 0) return undefined;
    const p = left.splice(j, 1)[0] as PathPiece;
    out.unshift(near(p.b, head.a) ? p : reversed(p));
  }
  return out;
}

/** The normal of the plane every piece lies in, or undefined when the path is not flat. */
function planeOf(pieces: PathPiece[]): Vec3 | undefined {
  const arc = pieces.find((p) => p.kind === 'arc');
  let B: Vec3 | undefined = arc?.kind === 'arc' ? unit(arc.axis) : undefined;
  const lines = pieces
    .flatMap((p) =>
      p.kind === 'curve' ? [p.ta, ...p.points.map((q) => sub(q, p.a))] : [sub(p.b, p.a)],
    )
    .filter((d) => norm(d) > TOL);
  if (!B) {
    for (const d of lines.slice(1)) {
      const c = cross(lines[0] as Vec3, d);
      if (norm(c) > 1e-6 * norm(d) * norm(lines[0] as Vec3)) {
        B = unit(c);
        break;
      }
    }
  }
  if (!B) {
    // A straight path: any plane through it.
    const d = unit(lines[0] ?? [0, 0, 1]);
    B = unit(Math.abs(d[2]) < 0.9 ? cross(d, [0, 0, 1]) : cross(d, [1, 0, 0]));
  }
  const O = (pieces[0] as PathPiece).a;
  for (const p of pieces) {
    if (Math.abs(dot(sub(p.a, O), B)) > TOL || Math.abs(dot(sub(p.b, O), B)) > TOL)
      return undefined;
    if (p.kind === 'arc' && (!parallel(p.axis, B) || Math.abs(dot(sub(p.centre, O), B)) > TOL))
      return undefined;
    if (p.kind === 'curve' && p.points.some((q) => Math.abs(dot(sub(q, O), B)) > TOL))
      return undefined;
  }
  return B;
}

/**
 * The sweep's path chained and the profile carried across it, or undefined
 * when its faces can't be told this way: the pieces don't chain, the path is
 * not flat, or the path doesn't cross the profile's plane square to it (at a
 * line, or where two pieces meet).
 */
export function sweptFaces(
  path: PathPiece[],
  profile: { origin: Vec3; normal: Vec3 },
  curves: ProfileCurve[],
): SweptFaces | undefined {
  const chained = chain(path);
  if (!chained || curves.length === 0) return undefined;
  const B = planeOf(chained);
  if (!B) return undefined;
  const pieces: Piece[] = chained.map((piece) => ({
    piece,
    start: piece.a,
    t0: tangent(piece, false),
    t1: tangent(piece, true),
  }));
  const last = chained[chained.length - 1] as PathPiece;
  const closed = norm(sub(last.b, (chained[0] as PathPiece).a)) < TOL;
  const N0 = unit(profile.normal);
  const off = (p: Vec3) => dot(sub(p, profile.origin), N0);
  // Where the path crosses the profile's plane square to it.
  let cross0: { at: Vec3; t: Vec3 } | undefined;
  for (const p of pieces) {
    if (cross0) break;
    if (p.piece.kind === 'line' && parallel(p.t0, N0)) {
      const { a, b } = p.piece;
      const s = -off(a) / (off(b) - off(a));
      if (s > -1e-6 && s < 1 + 1e-6) cross0 = { at: add(a, scale(sub(b, a), s)), t: p.t0 };
    }
    if (!cross0 && Math.abs(off(p.piece.a)) < TOL && parallel(p.t0, N0))
      cross0 = { at: p.piece.a, t: p.t0 };
    if (!cross0 && Math.abs(off(p.piece.b)) < TOL && parallel(p.t1, N0))
      cross0 = { at: p.piece.b, t: p.t1 };
  }
  if (!cross0) return undefined;
  const N = cross(B, cross0.t);
  const flat = (p: Vec3): [number, number] => {
    const w = sub(p, (cross0 as { at: Vec3 }).at);
    return [dot(w, N), dot(w, B)];
  };
  const out: Flat[] = curves.map((c) =>
    c.kind === 'line'
      ? { name: c.name, kind: 'line', a: flat(c.a), b: flat(c.b) }
      : { name: c.name, kind: 'arc', c: flat(c.centre), radius: c.radius },
  );
  const first = curves[0] as ProfileCurve;
  const at = first.kind === 'line' ? first.a : first.centre;
  const profileAtEnd =
    norm(sub(last.b, cross0.at)) < norm(sub((chained[0] as PathPiece).a, cross0.at));
  return { pieces, closed, profileAtEnd, B, curves: out, at, normal: N0, atFlat: flat(at) };
}

/** A point across the path at a piece's start (or end). */
function carried(sw: SweptFaces, p: Piece, [n, b]: [number, number], end = false): Vec3 {
  const t = end ? p.t1 : p.t0;
  const origin = end ? p.piece.b : p.start;
  return add(add(origin, scale(cross(sw.B, t), n)), scale(sw.B, b));
}

/**
 * A face's cap: across an open path's end, `start` at the end the profile is
 * nearer (it may sit a little way along the path from it) and `end` at the
 * other; otherwise `start` on the profile's own plane.
 */
export function sweptCap(s: AsmSurface, sw: SweptFaces): 'start' | 'end' | undefined {
  if (s.kind !== 'plane') return undefined;
  const n = unit(s.normal);
  const on = (p: Vec3) => Math.abs(dot(sub(p, s.point), n)) < TOL;
  if (!sw.closed) {
    const ends: [Piece, boolean][] = [
      [sw.pieces[0] as Piece, false],
      [sw.pieces[sw.pieces.length - 1] as Piece, true],
    ];
    for (const [p, end] of ends)
      if (parallel(s.normal, end ? p.t1 : p.t0) && on(carried(sw, p, sw.atFlat, end)))
        return end === sw.profileAtEnd ? 'start' : 'end';
  }
  return parallel(s.normal, sw.normal) && on(sw.at) ? 'start' : undefined;
}

/** The profile curves whose side, on some piece of the path, lies on this surface. */
export function sweptSides(s: AsmSurface, sw: SweptFaces): string[] {
  const out = new Set<string>();
  for (const p of sw.pieces)
    for (const c of sw.curves) if (!out.has(c.name) && onSide(s, sw, p, c)) out.add(c.name);
  return [...out];
}

function onSide(s: AsmSurface, sw: SweptFaces, p: Piece, c: Flat): boolean {
  const at = (q: [number, number]) => carried(sw, p, q);
  if (p.piece.kind === 'line') {
    const T = p.t0;
    if (s.kind === 'plane' && c.kind === 'line') {
      const n = unit(s.normal);
      if (Math.abs(dot(n, T)) > 1e-6) return false;
      const on = (q: Vec3) => Math.abs(dot(sub(q, s.point), n)) < TOL;
      return on(at(c.a)) && on(at(c.b));
    }
    if (s.kind === 'cone' && s.cylinder && c.kind === 'arc') {
      if (!parallel(s.axis, T)) return false;
      return norm(cross(sub(at(c.c), s.center), T)) < TOL && Math.abs(s.radius - c.radius) < TOL;
    }
    return false;
  }
  if (p.piece.kind === 'curve') {
    // Along a curve, only a profile line at one height off the path's plane
    // is known: it sweeps the plane at that height.
    if (s.kind !== 'plane' || c.kind !== 'line' || !parallel(s.normal, sw.B)) return false;
    if (Math.abs(c.a[1] - c.b[1]) > TOL) return false;
    return Math.abs(dot(sub(at(c.a), s.point), unit(s.normal))) < TOL;
  }
  // Along an arc: a revolve about its axis of the profile at the arc's start.
  const { centre: C } = p.piece;
  const u = unit(p.piece.axis);
  const axial = (q: Vec3) => {
    const w = sub(q, C);
    const t = dot(w, u);
    return { t, r: norm(sub(w, scale(u, t))) };
  };
  if (c.kind === 'line') {
    const A = at(c.a);
    const a = axial(A);
    const b = axial(at(c.b));
    if (s.kind === 'plane') {
      if (!parallel(s.normal, u) || Math.abs(a.t - b.t) > TOL) return false;
      return Math.abs(dot(sub(A, s.point), unit(s.normal))) < TOL;
    }
    if (s.kind !== 'cone' || !parallel(s.axis, u)) return false;
    if (norm(cross(sub(s.center, C), u)) > TOL || Math.abs(a.t - b.t) < TOL) return false;
    if (s.cylinder !== Math.abs(a.r - b.r) < TOL) return false;
    const h = dot(sub(s.center, C), u);
    const r = a.r + ((b.r - a.r) * (h - a.t)) / (b.t - a.t);
    return Math.abs(r - s.radius) < TOL;
  }
  if (s.kind !== 'torus' || !parallel(s.axis, u)) return false;
  const k = axial(at(c.c));
  return (
    norm(sub(s.center, add(C, scale(u, k.t)))) < TOL &&
    Math.abs(s.major - k.r) < TOL &&
    Math.abs(s.minor - c.radius) < TOL
  );
}

/** Whether a point (on a face along some piece) lies across the path within a profile line's stretch. */
export function sweptHolds(sw: SweptFaces, name: string, q: Vec3): boolean {
  const c = sw.curves.find((x) => x.name === name);
  if (c?.kind !== 'line') return false;
  for (const p of sw.pieces) {
    let n: number;
    let b: number;
    if (p.piece.kind === 'line') {
      const w = sub(q, p.start);
      const s = dot(w, p.t0) / norm(sub(p.piece.b, p.piece.a));
      if (s < -1e-6 || s > 1 + 1e-6) continue;
      n = dot(w, cross(sw.B, p.t0));
      b = dot(w, sw.B);
    } else if (p.piece.kind === 'curve') {
      continue;
    } else {
      // Across the arc at q: off the axis by the start's radius, along it by b.
      const { centre: C } = p.piece;
      const u = unit(p.piece.axis);
      const radial = (x: Vec3) => {
        const w = sub(x, C);
        return sub(w, scale(u, dot(w, u)));
      };
      const out = unit(radial(p.start));
      const sense = dot(cross(sw.B, p.t0), out);
      n = (norm(radial(q)) - norm(radial(p.start))) * Math.sign(sense);
      b = dot(sub(q, C), sw.B) - dot(sub(p.start, C), sw.B);
    }
    const d: [number, number] = [c.b[0] - c.a[0], c.b[1] - c.a[1]];
    const len2 = d[0] * d[0] + d[1] * d[1];
    if (!(len2 > 0)) continue;
    const s = ((n - c.a[0]) * d[0] + (b - c.a[1]) * d[1]) / len2;
    const gap = Math.abs((n - c.a[0]) * d[1] - (b - c.a[1]) * d[0]) / Math.sqrt(len2);
    if (gap < TOL && s > -1e-4 && s < 1 + 1e-4) return true;
  }
  return false;
}
