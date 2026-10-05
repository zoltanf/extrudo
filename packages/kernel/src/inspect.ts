/**
 * Measure and inspect (P2-13, ADR-0035): what the Measure tool and the
 * status bar show of the selected bodies, faces, edges and vertices.
 *
 * `inspectShapes` asks the kernel for each item's properties (exact
 * geometry, not the display mesh) and, for two items, the closest points;
 * `pairMeasure` derives the rest of a pair (angle, centre distance) in
 * plain math, so it is tested without OCCT.
 */
import type { BodyId } from '@extrudo/core';
import type { SubShapeKind } from './history';
import type { Kernel, ShapeHandle, SurfaceGeometry, Vec3 } from './kernel';

export type InspectKind = 'body' | SubShapeKind;

/** A body, or a face, edge or vertex of one by its index in the body's mesh. */
export interface InspectTarget {
  kind: InspectKind;
  body: BodyId;
  /** Sub-shape index (the mesh's order); 0 for a body. */
  index: number;
}

export interface Box {
  min: Vec3;
  max: Vec3;
}

/** A line in space: a point on it and its unit direction. */
export interface Line3 {
  origin: Vec3;
  direction: Vec3;
}

export type ItemMeasure =
  | { kind: 'body'; volume: number; area: number; centroid: Vec3; bbox: Box }
  | {
      kind: 'face';
      area: number;
      centroid: Vec3;
      bbox: Box;
      surface: SurfaceGeometry['type'];
      /** A plane's normal, out of the face. */
      normal?: Vec3;
      /** A cylinder's, cone's, torus's or revolved surface's axis. */
      axis?: Line3;
      /** A sphere's or torus's centre. */
      center?: Vec3;
      radius?: number;
      minorRadius?: number;
      /** A cone's half angle, degrees. */
      halfAngle?: number;
    }
  | {
      kind: 'edge';
      length: number;
      centroid: Vec3;
      bbox: Box;
      curve: 'line' | 'circle' | 'ellipse' | 'other' | 'degenerate';
      closed: boolean;
      start?: Vec3;
      end?: Vec3;
      /** A line's unit direction, start to end. */
      direction?: Vec3;
      /** A circle's or ellipse's centre and axis. */
      center?: Vec3;
      axis?: Vec3;
      radius?: number;
      minorRadius?: number;
      /** An arc's sweep, degrees (360 for a whole circle). */
      sweep?: number;
    }
  | { kind: 'vertex'; point: Vec3; bbox: Box }
  /**
   * Unbounded geometry the UI measures itself (P3-17): an origin or construction plane, an
   * axis. The kernel never returns these; `pairMeasure` takes them for angles and centres.
   */
  | { kind: 'plane'; origin: Vec3; normal: Vec3 }
  | { kind: 'axis'; origin: Vec3; direction: Vec3 };

/** The box of an item, if it is bounded (planes and axes aren't). */
export function itemBox(item: ItemMeasure): Box | undefined {
  return 'bbox' in item ? item.bbox : undefined;
}

/** Between two items. */
export interface PairMeasure {
  /** The smallest distance, mm, between the closest points `from` (on the first) and `to`. */
  distance: number;
  from: Vec3;
  to: Vec3;
  /**
   * Degrees, where both have a direction: between lines and planes 0–90°
   * (line edges, axes of circles and round faces, planar faces); two line
   * edges that share an end give the angle at that corner, 0–180°.
   */
  angle?: number;
  /**
   * Between centres (vertices, circle and sphere centres) and axes (round
   * faces), where it isn't the same as `distance`: points to points, a
   * point to an axis, or two parallel axes.
   */
  centers?: { distance: number; from: Vec3; to: Vec3 };
}

export interface Inspection {
  items: ItemMeasure[];
  /** Around every item; undefined for none. */
  bbox?: Box;
  /** Exactly two items. */
  pair?: PairMeasure;
}

/** What the shape behind a target is, for `inspectShapes`. */
export interface InspectSource {
  /** The body's shape (the caller keeps it; not released here). */
  body: ShapeHandle;
  target: InspectTarget;
}

/**
 * Measures `sources` with the kernel (each item, the box around them all,
 * and a pair's distance). Sub-shape handles made here are released here.
 */
export function inspectShapes(kernel: Kernel, sources: readonly InspectSource[]): Inspection {
  using scope = kernel.scope();
  const shapes: ShapeHandle[] = [];
  const items: ItemMeasure[] = [];
  for (const { body, target } of sources) {
    // A mesh body has no sub-shapes to take out (ADR-0066 §3): its one face is
    // the body itself, and measuring an edge or a vertex of one is refused by
    // the kernel with the message a user sees.
    const shape =
      target.kind === 'body' || (target.kind === 'face' && kernel.isMesh(body))
        ? body
        : scope.track(kernel.subShape(body, target.kind, target.index));
    shapes.push(shape);
    items.push(measureItem(kernel, body, target, shape));
  }
  const out: Inspection = { items };
  const box = unionBox(
    items.flatMap((i) => (i.kind === 'plane' || i.kind === 'axis' ? [] : [i.bbox])),
  );
  if (box) out.bbox = box;
  const [a, b] = items;
  const [sa, sb] = shapes;
  if (items.length === 2 && a && b && sa !== undefined && sb !== undefined) {
    out.pair = pairMeasure(a, b, kernel.closestPoints(sa, sb));
  }
  return out;
}

function measureItem(
  kernel: Kernel,
  body: ShapeHandle,
  target: InspectTarget,
  shape: ShapeHandle,
): ItemMeasure {
  const p = kernel.properties(shape);
  if (target.kind === 'body') {
    return { kind: 'body', volume: p.volume, area: p.area, centroid: p.centroid, bbox: p.bbox };
  }
  if (target.kind === 'vertex') return { kind: 'vertex', point: p.centroid, bbox: p.bbox };
  if (target.kind === 'face') {
    if (kernel.isMesh(body)) {
      // One face of all a mesh body's triangles: its area, its centre and its
      // box, and no surface under it (ADR-0066 §3).
      return {
        kind: 'face',
        area: p.area,
        centroid: p.centroid,
        bbox: p.bbox,
        surface: 'other',
      };
    }
    const s = kernel.surfaceGeometry(body, target.index);
    const face: ItemMeasure = {
      kind: 'face',
      area: p.area,
      centroid: p.centroid,
      bbox: p.bbox,
      surface: s.type,
    };
    if (s.type === 'plane' && s.direction) face.normal = s.direction;
    const round = s.type === 'cylinder' || s.type === 'cone' || s.type === 'revolution';
    if ((round || s.type === 'torus') && s.origin && s.direction) {
      face.axis = { origin: s.origin, direction: s.direction };
    }
    if ((s.type === 'sphere' || s.type === 'torus') && s.origin) face.center = s.origin;
    if (s.radius !== undefined) face.radius = s.radius;
    if (s.minorRadius !== undefined) face.minorRadius = s.minorRadius;
    if (s.halfAngle !== undefined) face.halfAngle = (s.halfAngle * 180) / Math.PI;
    return face;
  }
  const g = kernel.edgeGeometry(body, target.index, 2);
  if (g.type === 'degenerate') {
    return {
      kind: 'edge',
      length: 0,
      centroid: p.centroid,
      bbox: p.bbox,
      curve: 'degenerate',
      closed: false,
    };
  }
  const start = g.points[0];
  const end = g.points[g.points.length - 1];
  const edge: ItemMeasure = {
    kind: 'edge',
    length: p.length,
    centroid: p.centroid,
    bbox: p.bbox,
    curve: g.type,
    closed: g.closed,
    ...(start && { start }),
    ...(end && { end }),
  };
  if (g.type === 'line' && start && end) {
    const d = normalize(sub(end, start));
    if (d) edge.direction = d;
  }
  if (g.conic) {
    edge.center = g.conic.center;
    edge.axis = g.conic.axis;
    edge.radius = g.conic.radius;
    if (g.conic.minor !== undefined) edge.minorRadius = g.conic.minor;
    edge.sweep = g.closed ? 360 : ((g.conic.last - g.conic.first) * 180) / Math.PI;
  }
  return edge;
}

/** The box around boxes, or undefined for none. */
export function unionBox(boxes: readonly Box[]): Box | undefined {
  let out: { min: [number, number, number]; max: [number, number, number] } | undefined;
  for (const { min, max } of boxes) {
    if (!out) {
      out = { min: [...min], max: [...max] };
      continue;
    }
    for (let k = 0; k < 3; k++) {
      out.min[k] = Math.min(out.min[k] as number, min[k] as number);
      out.max[k] = Math.max(out.max[k] as number, max[k] as number);
    }
  }
  return out;
}

/** An item's direction for angles: a line (undirected) or a plane (its normal). */
type Direction = { kind: 'line' | 'plane'; v: Vec3 };

function directionOf(item: ItemMeasure): Direction | undefined {
  if (item.kind === 'edge') {
    if (item.direction) return { kind: 'line', v: item.direction };
    if (item.axis) return { kind: 'line', v: item.axis };
  }
  if (item.kind === 'face') {
    if (item.normal) return { kind: 'plane', v: item.normal };
    if (item.axis) return { kind: 'line', v: item.axis.direction };
  }
  if (item.kind === 'plane') return { kind: 'plane', v: item.normal };
  if (item.kind === 'axis') return { kind: 'line', v: item.direction };
  return undefined;
}

/** A point centre (vertex, circle, sphere) or an axis (round faces). */
type Centre = { point: Vec3 } | { axis: Line3 };

function centreOf(item: ItemMeasure): Centre | undefined {
  if (item.kind === 'vertex') return { point: item.point };
  if (item.kind === 'axis') return { axis: { origin: item.origin, direction: item.direction } };
  if (item.kind === 'edge' && item.center && (item.curve === 'circle' || item.curve === 'ellipse'))
    return { point: item.center };
  if (item.kind === 'face') {
    if (item.center) return { point: item.center };
    if (item.axis && item.surface !== 'torus') return { axis: item.axis };
  }
  return undefined;
}

const DEG = 180 / Math.PI;
/** Directions closer than this (as a sine) count as parallel. */
const PARALLEL = 1e-9;

/** The rest of a pair, from the two items and their closest points. */
export function pairMeasure(
  a: ItemMeasure,
  b: ItemMeasure,
  closest: { distance: number; from: Vec3; to: Vec3 },
): PairMeasure {
  const out: PairMeasure = { ...closest };
  const angle = angleBetween(a, b);
  if (angle !== undefined) out.angle = angle;
  const centers = centreDistance(a, b);
  if (centers && Math.abs(centers.distance - closest.distance) > 1e-9) out.centers = centers;
  return out;
}

function angleBetween(a: ItemMeasure, b: ItemMeasure): number | undefined {
  // Two straight edges meeting at a corner: the angle at that corner.
  if (a.kind === 'edge' && b.kind === 'edge' && a.direction && b.direction) {
    const corner = sharedEnd(a, b);
    if (corner) {
      const u = normalize(sub(corner.a, corner.at));
      const v = normalize(sub(corner.b, corner.at));
      if (u && v) return Math.acos(clamp(dot(u, v))) * DEG;
    }
  }
  const da = directionOf(a);
  const db = directionOf(b);
  if (!da || !db) return undefined;
  const c = Math.abs(dot(da.v, db.v));
  // Line to plane: the complement of the angle to the normal.
  if (da.kind !== db.kind) return Math.asin(clamp(c)) * DEG;
  return Math.acos(clamp(c)) * DEG;
}

/** Where two line edges share an end: that point and each edge's other end. */
function sharedEnd(
  a: Extract<ItemMeasure, { kind: 'edge' }>,
  b: Extract<ItemMeasure, { kind: 'edge' }>,
): { at: Vec3; a: Vec3; b: Vec3 } | undefined {
  if (!a.start || !a.end || !b.start || !b.end) return undefined;
  const tol = 1e-6;
  for (const [pa, qa] of [
    [a.start, a.end],
    [a.end, a.start],
  ] as const) {
    for (const [pb, qb] of [
      [b.start, b.end],
      [b.end, b.start],
    ] as const) {
      if (length(sub(pa, pb)) <= tol) return { at: pa, a: qa, b: qb };
    }
  }
  return undefined;
}

function centreDistance(
  a: ItemMeasure,
  b: ItemMeasure,
): { distance: number; from: Vec3; to: Vec3 } | undefined {
  const ca = centreOf(a);
  const cb = centreOf(b);
  if (!ca || !cb) return undefined;
  if ('point' in ca && 'point' in cb) {
    return { distance: length(sub(cb.point, ca.point)), from: ca.point, to: cb.point };
  }
  if ('point' in ca && 'axis' in cb) {
    const to = footOn(cb.axis, ca.point);
    return { distance: length(sub(to, ca.point)), from: ca.point, to };
  }
  if ('axis' in ca && 'point' in cb) {
    const from = footOn(ca.axis, cb.point);
    return { distance: length(sub(cb.point, from)), from, to: cb.point };
  }
  if ('axis' in ca && 'axis' in cb) {
    // Only parallel axes have one distance between them.
    if (length(cross(ca.axis.direction, cb.axis.direction)) > PARALLEL * 1e3) return undefined;
    const from = ca.axis.origin;
    const to = footOn(cb.axis, from);
    return { distance: length(sub(to, from)), from, to };
  }
  return undefined;
}

/** The point of `line` closest to `p`. */
function footOn(line: Line3, p: Vec3): Vec3 {
  const t = dot(sub(p, line.origin), line.direction);
  return add(line.origin, scale(line.direction, t));
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const length = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const clamp = (x: number) => Math.min(1, Math.max(-1, x));

function normalize(a: Vec3): Vec3 | undefined {
  const l = length(a);
  return l > 1e-12 ? scale(a, 1 / l) : undefined;
}
