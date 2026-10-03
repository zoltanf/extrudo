/**
 * Profile detection (P1-11, FR-SK-11, ADR-0020): the closed regions that a
 * sketch's curves bound, with the regions nested inside them as holes.
 *
 * A planar arrangement in TypeScript, fast enough to run on every change
 * (a drag step, a new line):
 *
 * 1. Every normal curve becomes one or more "segments": lines, arcs and
 *    circles exactly, ellipses and splines as their polylines. Construction
 *    geometry never bounds a profile.
 * 2. Segments are cut where they cross or touch each other, and where an
 *    end of one lies on another (a T-junction). Positions closer than
 *    `PROFILE_TOLERANCE` are one vertex: curves share no points in the
 *    sketch model, their ends meet where the solver put them.
 * 3. The pieces between cuts form a graph. Pieces that end nowhere
 *    (dangling lines) and bridges (a line joining two loops) go; the rest
 *    are traced into faces, each with the face on its left, the edges at a
 *    vertex ordered by direction and then curvature (so tangent curves
 *    order correctly).
 * 4. Counter-clockwise cycles are regions; each clockwise cycle is the outer
 *    boundary of a connected group of curves, and becomes a hole of the
 *    smallest region of another group that contains it.
 *
 * A region's ID is a hash of the curves around its outer boundary and the
 * direction each runs in, so it survives moving, resizing and adding
 * unrelated geometry (architecture §5.3). The kernel builds the
 * authoritative faces from the same curves and keys them the same way
 * (`profileKey`, `profileIds`; P2-02).
 */
import type { SketchData, SketchEntity, SketchEntityId, Vec2 } from '@extrudo/core';
import { curvePolyline, placeText, textPolylines } from '@extrudo/core';
import {
  type Curve,
  dist,
  dot,
  intersectCurves,
  nearestOnCurve,
  normalizeAngle,
  polar,
  sub,
  TAU,
} from '../inference/geometry';
import { interiorPoint, windingNumber } from './ink';

/** Positions closer than this (mm) are the same vertex. */
export const PROFILE_TOLERANCE = 1e-4;

/**
 * Arcs are sampled so a chord is never more than this far (mm) from the
 * arc: containment tests on the polygons are then exact to about a micron.
 */
const SAGITTA = 1e-3;
/** Upper bound of samples for a full circle, whatever its size. */
const MAX_CIRCLE_SAMPLES = 2048;
/** Lower bound of samples for a full circle (what the viewport draws). */
const MIN_CIRCLE_SAMPLES = 96;

/** One sketch curve's share of a loop, in loop order. */
export interface ProfileEdge {
  curve: SketchEntityId;
  /** Runs against the curve's own direction (a line's end → start, an arc clockwise). */
  reversed: boolean;
  /** The edge's points in loop order, from its start to its end; arcs and curves sampled. */
  points: Vec2[];
}

export interface ProfileLoop {
  edges: ProfileEdge[];
  /** The loop as one polygon (not repeating its first point). */
  polygon: Vec2[];
  /** Signed area, mm²: positive counter-clockwise (outer loops), negative for holes. */
  area: number;
}

export interface Profile {
  /** Stable within the sketch: derived from the boundary's curve IDs and directions. */
  id: string;
  /** Counter-clockwise. */
  outer: ProfileLoop;
  /** Clockwise: the outer boundaries of the curve groups directly inside. */
  holes: ProfileLoop[];
  /** Area inside the outer loop and outside the holes, mm². */
  area: number;
  /**
   * Set when the region is ink of one text entity (ADR-0058 §5): every edge
   * of the outer boundary and of all holes belongs to a sub-curve of that
   * text, and the winding number at the region's interior point is non-zero.
   */
  text?: SketchEntityId;
}

// Segments ---------------------------------------------------------------------

interface Segment {
  curve: SketchEntityId;
  shape: Curve;
  /** The parameter runs over [0, max]: t for a line, the angle from the start for an arc. */
  max: number;
  closed: boolean;
  /** mm per unit of parameter. */
  scale: number;
  /** Signed curvature in the direction of increasing parameter. */
  curvature: number;
  at(u: number): Vec2;
  /** Unit tangent in the direction of increasing parameter. */
  tangent(u: number): Vec2;
  param(p: Vec2): number;
  /** Samples from u0 to u1 (u0 < u1), both ends included. */
  sample(u0: number, u1: number): Vec2[];
  /** ∮ (x dy − y dx) / 2 from u0 to u1: the piece's exact share of a loop's area. */
  sweptArea(u0: number, u1: number): number;
  box: [number, number, number, number];
  cuts: number[];
}

function lineSegment(curve: SketchEntityId, a: Vec2, b: Vec2): Segment | undefined {
  const d = sub(b, a);
  const len2 = dot(d, d);
  if (len2 < PROFILE_TOLERANCE ** 2) return undefined;
  const len = Math.sqrt(len2);
  const t: Vec2 = [d[0] / len, d[1] / len];
  const at = (u: number): Vec2 => [a[0] + d[0] * u, a[1] + d[1] * u];
  return {
    curve,
    shape: { kind: 'line', id: curve, a, b },
    max: 1,
    closed: false,
    scale: len,
    curvature: 0,
    at,
    tangent: () => t,
    param: (p) => Math.min(1, Math.max(0, dot(sub(p, a), d) / len2)),
    sample: (u0, u1) => [at(u0), at(u1)],
    sweptArea: (u0, u1) => {
      const p = at(u0);
      const q = at(u1);
      return (p[0] * q[1] - p[1] * q[0]) / 2;
    },
    box: [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])],
    cuts: [0, 1],
  };
}

/** Samples per radian for an arc of this radius. */
function arcDensity(radius: number): number {
  const step = Math.sqrt((8 * SAGITTA) / radius);
  const n = Math.min(MAX_CIRCLE_SAMPLES, Math.max(MIN_CIRCLE_SAMPLES, Math.ceil(TAU / step)));
  return n / TAU;
}

function arcSegment(
  curve: SketchEntityId,
  center: Vec2,
  radius: number,
  from: number,
  sweep: number,
  closed: boolean,
): Segment | undefined {
  if (radius < PROFILE_TOLERANCE) return undefined;
  const at = (u: number) => polar(center, radius, from + u);
  const density = arcDensity(radius);
  const shape: Curve = closed
    ? { kind: 'circle', id: curve, center, radius }
    : { kind: 'arc', id: curve, center, radius, from, sweep };
  return {
    curve,
    shape,
    max: sweep,
    closed,
    scale: radius,
    curvature: 1 / radius,
    at,
    tangent: (u) => [-Math.sin(from + u), Math.cos(from + u)],
    param: (p) => {
      const u = normalizeAngle(Math.atan2(p[1] - center[1], p[0] - center[0]) - from);
      // Just short of a full turn is the start, for an arc.
      return !closed && u > sweep ? (u - sweep < TAU - u ? sweep : 0) : u;
    },
    sample: (u0, u1) => {
      const n = Math.max(1, Math.ceil((u1 - u0) * density));
      const out: Vec2[] = [];
      for (let i = 0; i <= n; i++) out.push(at(u0 + ((u1 - u0) * i) / n));
      return out;
    },
    sweptArea: (u0, u1) => {
      const t0 = from + u0;
      const t1 = from + u1;
      return (
        (radius * radius * (t1 - t0) +
          radius * center[0] * (Math.sin(t1) - Math.sin(t0)) -
          radius * center[1] * (Math.cos(t1) - Math.cos(t0))) /
        2
      );
    },
    box: [center[0] - radius, center[1] - radius, center[0] + radius, center[1] + radius],
    cuts: closed ? [] : [0, sweep],
  };
}

function segmentsOf(data: SketchData, id: SketchEntityId, e: SketchEntity): Segment[] {
  const point = (ref: SketchEntityId): Vec2 | undefined => {
    const p = data.entities[ref];
    return p?.type === 'point' ? [p.x, p.y] : undefined;
  };
  const one = (s: Segment | undefined) => (s ? [s] : []);
  switch (e.type) {
    case 'point':
      return [];
    case 'line': {
      const a = point(e.start);
      const b = point(e.end);
      return a && b ? one(lineSegment(id, a, b)) : [];
    }
    case 'circle': {
      const c = point(e.center);
      return c ? one(arcSegment(id, c, e.radius, 0, TAU, true)) : [];
    }
    case 'arc': {
      const c = point(e.center);
      const s = point(e.start);
      const t = point(e.end);
      if (!c || !s || !t) return [];
      const from = Math.atan2(s[1] - c[1], s[0] - c[0]);
      let sweep = normalizeAngle(Math.atan2(t[1] - c[1], t[0] - c[0]) - from);
      if (sweep <= 1e-12) sweep = TAU;
      return one(arcSegment(id, c, dist(c, s), from, sweep, false));
    }
    case 'ellipse':
    case 'spline': {
      const line = curvePolyline(data, e);
      if (!line) return [];
      const out: Segment[] = [];
      for (let i = 1; i < line.length; i++) {
        const s = lineSegment(id, line[i - 1] as Vec2, line[i] as Vec2);
        if (s) out.push(s);
      }
      return out;
    }
    case 'text': {
      // One chain of line segments per placed sub-curve; the sub-curve ID
      // (`<text>.<k>`) is the segment's curve, so region IDs hash sub-IDs.
      const out: Segment[] = [];
      for (const [cid, poly] of textPolylines(data, id)) {
        for (let i = 1; i < poly.length; i++) {
          const s = lineSegment(cid as SketchEntityId, poly[i - 1] as Vec2, poly[i] as Vec2);
          if (s) out.push(s);
        }
      }
      return out;
    }
  }
}

const overlap = (a: Segment['box'], b: Segment['box']) =>
  a[0] <= b[2] + PROFILE_TOLERANCE &&
  b[0] <= a[2] + PROFILE_TOLERANCE &&
  a[1] <= b[3] + PROFILE_TOLERANCE &&
  b[1] <= a[3] + PROFILE_TOLERANCE;

/** Cuts every segment where another crosses or touches it, or ends on it. */
function cutSegments(segments: readonly Segment[]): void {
  const ends = (s: Segment): Vec2[] => (s.closed ? [] : [s.at(0), s.at(s.max)]);
  for (let i = 0; i < segments.length; i++) {
    const si = segments[i] as Segment;
    for (let j = i + 1; j < segments.length; j++) {
      const sj = segments[j] as Segment;
      if (!overlap(si.box, sj.box)) continue;
      for (const p of intersectCurves(si.shape, sj.shape)) {
        si.cuts.push(si.param(p));
        sj.cuts.push(sj.param(p));
      }
      for (const p of ends(si)) {
        if (dist(p, nearestOnCurve(sj.shape, p)) < PROFILE_TOLERANCE) sj.cuts.push(sj.param(p));
      }
      for (const p of ends(sj)) {
        if (dist(p, nearestOnCurve(si.shape, p)) < PROFILE_TOLERANCE) si.cuts.push(si.param(p));
      }
    }
  }
}

// Vertices ---------------------------------------------------------------------

/** Merges positions within `PROFILE_TOLERANCE` into numbered vertices (a hash grid). */
class Vertices {
  readonly points: Vec2[] = [];
  readonly #cells = new Map<string, number[]>();

  id(p: Vec2): number {
    const cx = Math.floor(p[0] / PROFILE_TOLERANCE);
    const cy = Math.floor(p[1] / PROFILE_TOLERANCE);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const v of this.#cells.get(`${cx + dx},${cy + dy}`) ?? []) {
          if (dist(this.points[v] as Vec2, p) < PROFILE_TOLERANCE) return v;
        }
      }
    }
    const v = this.points.length;
    this.points.push(p);
    const key = `${cx},${cy}`;
    const cell = this.#cells.get(key);
    if (cell) cell.push(v);
    else this.#cells.set(key, [v]);
    return v;
  }
}

// Pieces and half-edges ----------------------------------------------------------

/** A segment between two neighbouring cuts: an edge of the graph. */
interface Piece {
  segment: Segment;
  u0: number;
  u1: number;
  v0: number;
  v1: number;
  alive: boolean;
}

/** Half-edge `2k` runs along piece k, `2k + 1` against it. */
const pieceOf = (h: number) => h >> 1;
const twin = (h: number) => h ^ 1;

function piecesOf(segments: readonly Segment[], vertices: Vertices): Piece[] {
  const pieces: Piece[] = [];
  for (const segment of segments) {
    const cuts = [...segment.cuts].sort((a, b) => a - b);
    if (segment.closed && cuts.length === 0) cuts.push(0);
    const unique: { u: number; v: number }[] = [];
    for (const u of cuts) {
      const v = vertices.id(segment.at(u));
      const last = unique[unique.length - 1];
      // The same vertex again ends a piece only if the piece goes somewhere
      // (an arc whose ends meet), not if it is a sliver between close cuts.
      if (last && (u - last.u < 1e-12 || (last.v === v && (u - last.u) * segment.scale < 1e-2)))
        continue;
      unique.push({ u, v });
    }
    if (segment.closed) {
      // Around the circle: the last cut joins the first a full turn later.
      const first = unique[0];
      const last = unique[unique.length - 1];
      if (unique.length > 1 && first && last && last.v === first.v) unique.pop();
      if (first) unique.push({ u: first.u + TAU, v: first.v });
    }
    for (let k = 1; k < unique.length; k++) {
      const a = unique[k - 1] as { u: number; v: number };
      const b = unique[k] as { u: number; v: number };
      pieces.push({ segment, u0: a.u, u1: b.u, v0: a.v, v1: b.v, alive: true });
    }
  }
  return dedupe(pieces);
}

/** Overlapping curves (two collinear lines, one arc over another) keep one piece, the lowest curve ID's. */
function dedupe(pieces: Piece[]): Piece[] {
  const byEnds = new Map<string, Piece[]>();
  const sorted = [...pieces].sort((a, b) =>
    a.segment.curve < b.segment.curve ? -1 : a.segment.curve > b.segment.curve ? 1 : 0,
  );
  const mid = (p: Piece) => p.segment.at((p.u0 + p.u1) / 2);
  for (const p of sorted) {
    const key = p.v0 < p.v1 ? `${p.v0},${p.v1}` : `${p.v1},${p.v0}`;
    const same = byEnds.get(key) ?? [];
    if (same.some((q) => dist(mid(q), mid(p)) < PROFILE_TOLERANCE * 10)) {
      p.alive = false;
      continue;
    }
    same.push(p);
    byEnds.set(key, same);
  }
  return pieces.filter((p) => p.alive);
}

interface HalfEdge {
  origin: number;
  dest: number;
  angle: number;
  curvature: number;
}

function halfEdge(pieces: readonly Piece[], h: number): HalfEdge {
  const p = pieces[pieceOf(h)] as Piece;
  const forward = (h & 1) === 0;
  const t = forward ? p.segment.tangent(p.u0) : p.segment.tangent(p.u1);
  const d: Vec2 = forward ? t : [-t[0], -t[1]];
  let angle = normalizeAngle(Math.atan2(d[1], d[0]));
  if (angle > TAU - 1e-9) angle = 0;
  return {
    origin: forward ? p.v0 : p.v1,
    dest: forward ? p.v1 : p.v0,
    angle,
    curvature: forward ? p.segment.curvature : -p.segment.curvature,
  };
}

/** Samples of a half-edge from its origin to its end. */
function halfEdgePoints(pieces: readonly Piece[], h: number): Vec2[] {
  const p = pieces[pieceOf(h)] as Piece;
  const points = p.segment.sample(p.u0, p.u1);
  return (h & 1) === 0 ? points : points.reverse();
}

/** Removes pieces with a free end, repeatedly, until every vertex has two or more. */
function pruneDangling(pieces: readonly Piece[], vertexCount: number): void {
  const degree = new Array<number>(vertexCount).fill(0);
  const incident: number[][] = Array.from({ length: vertexCount }, () => []);
  pieces.forEach((p, k) => {
    if (!p.alive) return;
    degree[p.v0] = (degree[p.v0] as number) + 1;
    degree[p.v1] = (degree[p.v1] as number) + 1;
    incident[p.v0]?.push(k);
    incident[p.v1]?.push(k);
  });
  const queue = degree.flatMap((d, v) => (d === 1 ? [v] : []));
  while (queue.length > 0) {
    const v = queue.pop() as number;
    for (const k of incident[v] ?? []) {
      const p = pieces[k] as Piece;
      if (!p.alive) continue;
      p.alive = false;
      for (const w of [p.v0, p.v1]) {
        degree[w] = (degree[w] as number) - 1;
        if (degree[w] === 1) queue.push(w);
      }
    }
  }
}

/** Traces every face of the alive pieces; each cycle is a list of half-edges. */
function traceCycles(pieces: readonly Piece[], vertexCount: number): number[][] {
  const edges = new Map<number, HalfEdge>();
  const around: number[][] = Array.from({ length: vertexCount }, () => []);
  pieces.forEach((p, k) => {
    if (!p.alive) return;
    for (const h of [2 * k, 2 * k + 1]) {
      const e = halfEdge(pieces, h);
      edges.set(h, e);
      around[e.origin]?.push(h);
    }
  });
  // Counter-clockwise around each vertex; of two leaving in the same
  // direction, the one curving left is further counter-clockwise.
  const position = new Map<number, number>();
  for (const list of around) {
    list.sort((a, b) => {
      const ea = edges.get(a) as HalfEdge;
      const eb = edges.get(b) as HalfEdge;
      if (Math.abs(ea.angle - eb.angle) > 1e-9) return ea.angle - eb.angle;
      if (Math.abs(ea.curvature - eb.curvature) > 1e-12) return ea.curvature - eb.curvature;
      return a - b;
    });
    list.forEach((h, i) => {
      position.set(h, i);
    });
  }
  // Arriving at a vertex, turn to the edge just clockwise of the way back:
  // the face stays on the left.
  const next = (h: number) => {
    const e = edges.get(h) as HalfEdge;
    const list = around[e.dest] as number[];
    const i = position.get(twin(h)) as number;
    return list[(i - 1 + list.length) % list.length] as number;
  };
  const seen = new Set<number>();
  const cycles: number[][] = [];
  for (const h of edges.keys()) {
    if (seen.has(h)) continue;
    const cycle: number[] = [];
    let cur = h;
    while (!seen.has(cur)) {
      seen.add(cur);
      cycle.push(cur);
      cur = next(cur);
    }
    cycles.push(cycle);
  }
  return cycles;
}

// Loops ------------------------------------------------------------------------

function loopOf(pieces: readonly Piece[], cycle: readonly number[]): ProfileLoop {
  const edges: ProfileEdge[] = [];
  for (const h of cycle) {
    const p = pieces[pieceOf(h)] as Piece;
    const reversed = (h & 1) === 1;
    const points = halfEdgePoints(pieces, h);
    const last = edges[edges.length - 1];
    if (last && last.curve === p.segment.curve && last.reversed === reversed) {
      last.points.push(...points.slice(1));
    } else edges.push({ curve: p.segment.curve, reversed, points });
  }
  // A curve that runs across the loop's start is one edge.
  const first = edges[0];
  const last = edges[edges.length - 1];
  if (edges.length > 1 && first && last && first.curve === last.curve) {
    if (first.reversed === last.reversed) {
      first.points = [...last.points, ...first.points.slice(1)];
      edges.pop();
    }
  }
  const polygon = edges.flatMap((e) => e.points.slice(0, -1));
  let area = 0;
  for (const h of cycle) {
    const p = pieces[pieceOf(h)] as Piece;
    const a = p.segment.sweptArea(p.u0, p.u1);
    area += (h & 1) === 0 ? a : -a;
  }
  return { edges, polygon, area };
}

/** Whether `p` is inside a polygon (even-odd). */
export function insidePolygon(polygon: readonly Vec2[], p: Vec2): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i] as Vec2;
    const b = polygon[j] as Vec2;
    if (a[1] > p[1] !== b[1] > p[1]) {
      const x = a[0] + ((p[1] - a[1]) * (b[0] - a[0])) / (b[1] - a[1]);
      if (p[0] < x) inside = !inside;
    }
  }
  return inside;
}

// IDs ------------------------------------------------------------------------------

/**
 * A region's key: the curves around its outer loop and the direction each
 * runs in, sorted. The kernel keys its faces the same way (P2-02).
 */
export function profileKey(edges: readonly Pick<ProfileEdge, 'curve' | 'reversed'>[]): string {
  return [...new Set(edges.map((e) => `${e.curve}${e.reversed ? '-' : '+'}`))].sort().join(' ');
}

/**
 * Region IDs from their keys: the key's hash. Rare regions that share a key
 * (a spline weaving across a line) are numbered by the position of their
 * area centroid, x first.
 */
export function profileIds(regions: readonly { key: string; centroid: Vec2 }[]): string[] {
  const byKey = new Map<string, number[]>();
  regions.forEach((r, i) => {
    byKey.set(r.key, [...(byKey.get(r.key) ?? []), i]);
  });
  const out = new Array<string>(regions.length);
  for (const [key, same] of byKey) {
    const c = (i: number) => (regions[i] as { centroid: Vec2 }).centroid;
    same.sort((a, b) => c(a)[0] - c(b)[0] || c(a)[1] - c(b)[1]);
    same.forEach((i, n) => {
      out[i] = hash(n === 0 ? key : `${key}#${n}`);
    });
  }
  return out;
}

/** cyrb53: a small, well-spread 53-bit string hash. */
function hash(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** The area centroid of a region: its outer loop less its holes (signed areas). */
export function profileCentroid(profile: Pick<Profile, 'outer' | 'holes'>): Vec2 {
  let area = 0;
  let x = 0;
  let y = 0;
  for (const loop of [profile.outer, ...profile.holes]) {
    const polygon = loop.polygon;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const a = polygon[j] as Vec2;
      const b = polygon[i] as Vec2;
      const cross = a[0] * b[1] - b[0] * a[1];
      area += cross;
      x += (a[0] + b[0]) * cross;
      y += (a[1] + b[1]) * cross;
    }
  }
  return area === 0 ? (profile.outer.polygon[0] ?? [0, 0]) : [x / (3 * area), y / (3 * area)];
}

// Text ink ---------------------------------------------------------------------

/**
 * The contours of a text entity as closed polylines (one point list per
 * contour, closing edge implied), for the ink test; `undefined` when the
 * text has no curves (no font loaded, degenerate placement or empty string).
 */
export function textInkOf(
  data: SketchData,
  id: SketchEntityId,
): readonly (readonly Vec2[])[] | undefined {
  const placed = placeText(data, id);
  if (placed.curves.length === 0) return undefined;
  const polys = textPolylines(data, id);
  const out: Vec2[][] = [];
  for (const contour of placed.contours) {
    const pts: Vec2[] = [];
    for (const cid of contour) {
      for (const p of polys.get(cid) ?? []) {
        const last = pts[pts.length - 1];
        if (last && dist(last, p) < 1e-9) continue;
        pts.push(p);
      }
    }
    if (pts.length > 2) out.push(pts);
  }
  return out.length > 0 ? out : undefined;
}

/** The single text entity owning every curve ID, if there is one (all IDs are `<text>.<k>` of it). */
function soleTextOf(curveIds: Iterable<string>, data: SketchData): SketchEntityId | undefined {
  let owner: SketchEntityId | undefined;
  for (const curve of curveIds) {
    const dot = curve.lastIndexOf('.');
    if (dot <= 0 || !/^\d+$/.test(curve.slice(dot + 1))) return undefined;
    const id = curve.slice(0, dot) as SketchEntityId;
    if (data.entities[id]?.type !== 'text') return undefined;
    if (owner && owner !== id) return undefined;
    owner = id;
  }
  return owner;
}

// Detection ------------------------------------------------------------------------

/**
 * The closed regions of a sketch (FR-SK-11), largest first. Regions don't
 * overlap: where curves cross, each piece of the plane between them is its
 * own region, and a region inside another is a hole of it as well as a
 * region of its own.
 */
export function detectProfiles(data: SketchData): Profile[] {
  const segments: Segment[] = [];
  for (const id of Object.keys(data.entities).sort() as SketchEntityId[]) {
    const e = data.entities[id] as SketchEntity;
    if (e.type === 'point' || e.construction) continue;
    segments.push(...segmentsOf(data, id, e));
  }
  if (segments.length === 0) return [];
  cutSegments(segments);
  const vertices = new Vertices();
  const pieces = piecesOf(segments, vertices);
  const vertexCount = vertices.points.length;

  // Bridges (a piece with the same face on both sides) join loops without
  // bounding anything; take them out and trace again.
  let cycles: number[][] = [];
  for (let round = 0; round < 1000; round++) {
    pruneDangling(pieces, vertexCount);
    cycles = traceCycles(pieces, vertexCount);
    let bridges = false;
    for (const cycle of cycles) {
      const inCycle = new Set(cycle);
      for (const h of cycle) {
        if (inCycle.has(twin(h))) {
          (pieces[pieceOf(h)] as Piece).alive = false;
          bridges = true;
        }
      }
    }
    if (!bridges) break;
  }

  // Groups of connected pieces.
  const parent = Array.from({ length: vertexCount }, (_, i) => i);
  const find = (v: number): number => {
    while (parent[v] !== v) {
      parent[v] = parent[parent[v] as number] as number;
      v = parent[v] as number;
    }
    return v;
  };
  for (const p of pieces) if (p.alive) parent[find(p.v0)] = find(p.v1);

  const minArea = PROFILE_TOLERANCE ** 2;
  const regions: { loop: ProfileLoop; group: number; holes: ProfileLoop[] }[] = [];
  const outlines: { loop: ProfileLoop; group: number }[] = [];
  for (const cycle of cycles) {
    const loop = loopOf(pieces, cycle);
    const group = find((pieces[pieceOf(cycle[0] as number)] as Piece).v0);
    if (loop.area > minArea) regions.push({ loop, group, holes: [] });
    else if (loop.area < -minArea) outlines.push({ loop, group });
  }

  // Each group's outline is a hole in the smallest region of another group around it.
  for (const outline of outlines) {
    const probe = outline.loop.polygon[0] as Vec2;
    let best: (typeof regions)[number] | undefined;
    for (const r of regions) {
      if (r.group === outline.group || (best && r.loop.area >= best.loop.area)) continue;
      if (insidePolygon(r.loop.polygon, probe)) best = r;
    }
    best?.holes.push(outline.loop);
  }

  const profiles = regions.map((r) => ({
    key: profileKey(r.loop.edges),
    outer: r.loop,
    holes: r.holes,
    area: r.loop.area + r.holes.reduce((s, h) => s + h.area, 0),
  }));
  const ids = profileIds(profiles.map((p) => ({ key: p.key, centroid: profileCentroid(p) })));
  const out: Profile[] = profiles.map((p, i) => ({
    id: ids[i] as string,
    outer: p.outer,
    holes: p.holes,
    area: p.area,
  }));

  // Mark a region as ink of one text (ADR-0058 §5): its whole boundary
  // (outer loop and holes) belongs to sub-curves of that text and the
  // winding number at the region's interior point is non-zero (counters
  // wind to 0 and stay ordinary islands; overlapping contours are all ink).
  for (const profile of out) {
    const curveIds = [
      ...profile.outer.edges.map((e) => e.curve),
      ...profile.holes.flatMap((h) => h.edges.map((e) => e.curve)),
    ];
    const text = soleTextOf(curveIds, data);
    if (!text) continue;
    const ink = textInkOf(data, text);
    const inner = interiorPoint(
      profile.outer.polygon,
      profile.holes.map((h) => h.polygon),
    );
    if (ink && inner && windingNumber(inner, ink) !== 0) profile.text = text;
  }

  return out.sort((a, b) => b.area - a.area || (a.id < b.id ? -1 : 1));
}

/** The profile at `p` (sketch mm), if any: inside its outer loop and none of its holes. */
export function profileAt(profiles: readonly Profile[], p: Vec2): Profile | undefined {
  // Smallest first would be the same: regions don't overlap.
  return profiles.find(
    (profile) =>
      insidePolygon(profile.outer.polygon, p) &&
      !profile.holes.some((h) => insidePolygon(h.polygon, p)),
  );
}
