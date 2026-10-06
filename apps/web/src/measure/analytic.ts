/**
 * Measuring what isn't a body (P3-17, ADR-0035 amendment): sketch points and curves picked in
 * the model, origin axes and planes, and construction planes, axes and points. Their geometry is
 * exact in the document (sketch coordinates and a frame) or in the kernel's construction
 * reports, so they are measured here, on the UI thread, as the kernel's `ItemMeasure`s; the
 * distance between two of them (or one of them and a body's vertex or straight edge) too.
 */
import {
  type ConstructionReports,
  curvePolyline,
  type ExtrudoDocument,
  type FeatureId,
  originAxis,
  originPlane,
  parseSketchEntityRefId,
  readSketch,
  type SelectionItem,
  type SketchData,
  type SketchEntity,
  type SketchEntityId,
  type SketchFrame,
  sketchToWorld,
  type Vec2,
} from '@extrudo/core';
import type { Box, ItemMeasure, Vec3 } from '@extrudo/kernel';
import { type SketchReports, sketchFrame } from '../sketch/frame';

export interface AnalyticContext {
  doc: Pick<ExtrudoDocument, 'features'>;
  sketches?: SketchReports;
  construction?: ConstructionReports;
}

/** A selection item measured here, or undefined if it isn't one of those (or is gone). */
export function analyticItem(item: SelectionItem, ctx: AnalyticContext): ItemMeasure | undefined {
  if (item.kind === 'axis') {
    const origin = originAxis(item.id);
    if (origin) return { kind: 'axis', origin: origin.origin, direction: origin.direction };
    const report = ctx.construction?.[item.id as FeatureId];
    return report?.kind === 'axis'
      ? { kind: 'axis', origin: report.origin, direction: report.direction }
      : undefined;
  }
  if (item.kind === 'plane') {
    const frame =
      originPlane(item.id)?.frame ?? planeReport(ctx.construction?.[item.id as FeatureId]);
    return frame ? { kind: 'plane', origin: frame.origin, normal: frame.normal } : undefined;
  }
  if (item.kind === 'point') {
    const report = ctx.construction?.[item.id as FeatureId];
    return report?.kind === 'point' ? vertex(report.point) : undefined;
  }
  if (item.kind === 'sketchEntity') {
    const parsed = parseSketchEntityRefId(item.id);
    const feature = parsed && ctx.doc.features.find((f) => f.id === parsed.feature);
    const view = feature && readSketch(feature);
    const entity = view?.data.entities[parsed?.entity as SketchEntityId];
    if (!feature || !view || !entity) return undefined;
    const frame = sketchFrame(feature.id, view.plane, ctx.sketches, ctx.construction);
    return frame ? sketchEntityMeasure(view.data, entity, frame) : undefined;
  }
  return undefined;
}

function planeReport(report: ConstructionReports[FeatureId] | undefined): SketchFrame | undefined {
  return report?.kind === 'plane' ? report.frame : undefined;
}

const vertex = (point: Vec3): ItemMeasure => ({
  kind: 'vertex',
  point,
  bbox: { min: point, max: point },
});

/** A sketch point or curve in world mm, measured like a body's vertex or edge. */
export function sketchEntityMeasure(
  data: SketchData,
  entity: SketchEntity,
  frame: SketchFrame,
): ItemMeasure | undefined {
  const world = (p: Vec2) => sketchToWorld(frame, p);
  const at = (id: SketchEntityId): Vec2 | undefined => {
    const p = data.entities[id];
    return p?.type === 'point' ? [p.x, p.y] : undefined;
  };
  if (entity.type === 'point') return vertex(world([entity.x, entity.y]));
  const poly = curvePolyline(data, entity)?.map(world);
  if (!poly || poly.length < 2) return undefined;
  const base = {
    kind: 'edge' as const,
    length: polylineLength(poly),
    centroid: polylineCentroid(poly),
    bbox: boxOf(poly),
  };
  switch (entity.type) {
    case 'line': {
      const [start, end] = poly as [Vec3, Vec3];
      const direction = unit(sub(end, start));
      return {
        ...base,
        curve: 'line',
        closed: false,
        start,
        end,
        ...(direction && { direction }),
      };
    }
    case 'circle': {
      const center = at(entity.center);
      if (!center) return undefined;
      const r = entity.radius;
      return {
        ...base,
        length: 2 * Math.PI * r,
        curve: 'circle',
        closed: true,
        center: world(center),
        axis: frame.normal,
        radius: r,
        sweep: 360,
      };
    }
    case 'arc': {
      const c = at(entity.center);
      const s = at(entity.start);
      const e = at(entity.end);
      if (!c || !s || !e) return undefined;
      const r = Math.hypot(s[0] - c[0], s[1] - c[1]);
      let sweep =
        (Math.atan2(e[1] - c[1], e[0] - c[0]) - Math.atan2(s[1] - c[1], s[0] - c[0])) %
        (2 * Math.PI);
      if (sweep <= 1e-12) sweep += 2 * Math.PI;
      return {
        ...base,
        length: r * sweep,
        curve: 'circle',
        closed: false,
        start: world(s),
        end: world(e),
        center: world(c),
        axis: frame.normal,
        radius: r,
        sweep: (sweep * 180) / Math.PI,
      };
    }
    case 'ellipse': {
      const c = at(entity.center);
      const major = at(entity.major);
      const minor = at(entity.minor);
      if (!c || !major || !minor) return undefined;
      return {
        ...base,
        curve: 'ellipse',
        closed: true,
        center: world(c),
        axis: frame.normal,
        radius: Math.hypot(major[0] - c[0], major[1] - c[1]),
        minorRadius: Math.hypot(minor[0] - c[0], minor[1] - c[1]),
      };
    }
    case 'spline':
      return {
        ...base,
        curve: 'other',
        closed: entity.closed === true && entity.mode !== 'conic',
        start: poly[0] as Vec3,
        end: poly.at(-1) as Vec3,
      };
    case 'text':
      // P4-03 slice 2b/3: text is measured as its sub-curves there.
      return undefined;
  }
}

// ----------------------------------------------------------------- distance

/** What the distance below works on: a point, a segment, an unbounded line or a plane. */
type Primitive =
  | { kind: 'point'; p: Vec3 }
  /** From `p` along `d` for t in [lo, hi] (a segment is [0, 1] with `d` its whole length). */
  | { kind: 'line'; p: Vec3; d: Vec3; lo: number; hi: number }
  | { kind: 'plane'; p: Vec3; n: Vec3 };

function primitiveOf(item: ItemMeasure): Primitive | undefined {
  switch (item.kind) {
    case 'vertex':
      return { kind: 'point', p: item.point };
    case 'edge':
      return item.curve === 'line' && item.start && item.end
        ? { kind: 'line', p: item.start, d: sub(item.end, item.start), lo: 0, hi: 1 }
        : undefined;
    case 'axis':
      return {
        kind: 'line',
        p: item.origin,
        d: item.direction,
        lo: Number.NEGATIVE_INFINITY,
        hi: Number.POSITIVE_INFINITY,
      };
    case 'plane':
      return { kind: 'plane', p: item.origin, n: item.normal };
    default:
      // Faces, bodies and curved edges need the kernel's exact distance.
      return undefined;
  }
}

export interface Closest {
  distance: number;
  from: Vec3;
  to: Vec3;
}

/**
 * The closest points between two items, when both are points, straight segments, axes or
 * planes (any mix); undefined otherwise (a face, a body or a curve on either side).
 */
export function closestBetween(a: ItemMeasure, b: ItemMeasure): Closest | undefined {
  const pa = primitiveOf(a);
  const pb = primitiveOf(b);
  if (!pa || !pb) return undefined;
  const pair = closest(pa, pb);
  return pair && { distance: length(sub(pair[1], pair[0])), from: pair[0], to: pair[1] };
}

function closest(a: Primitive, b: Primitive): [Vec3, Vec3] | undefined {
  if (a.kind === 'point' && b.kind === 'point') return [a.p, b.p];
  if (a.kind === 'point' && b.kind === 'line') return [a.p, onLine(b, a.p)];
  if (a.kind === 'line' && b.kind === 'point') return [onLine(a, b.p), b.p];
  if (a.kind === 'point' && b.kind === 'plane') return [a.p, onPlane(b, a.p)];
  if (a.kind === 'plane' && b.kind === 'point') return [onPlane(a, b.p), b.p];
  if (a.kind === 'line' && b.kind === 'line') return lineLine(a, b);
  if (a.kind === 'line' && b.kind === 'plane') return linePlane(a, b);
  if (a.kind === 'plane' && b.kind === 'line') {
    const pair = linePlane(b, a);
    return pair && [pair[1], pair[0]];
  }
  if (a.kind === 'plane' && b.kind === 'plane') return planePlane(a, b);
  return undefined;
}

type LinePrim = Extract<Primitive, { kind: 'line' }>;
type PlanePrim = Extract<Primitive, { kind: 'plane' }>;

const clampT = (line: LinePrim, t: number) => Math.min(line.hi, Math.max(line.lo, t));
const at = (line: LinePrim, t: number): Vec3 => add(line.p, scale(line.d, t));

function onLine(line: LinePrim, q: Vec3): Vec3 {
  const dd = dot(line.d, line.d);
  return at(line, dd > 0 ? clampT(line, dot(sub(q, line.p), line.d) / dd) : 0);
}

function onPlane(plane: PlanePrim, q: Vec3): Vec3 {
  return sub(q, scale(plane.n, dot(sub(q, plane.p), plane.n)));
}

/** Closest points of two (possibly bounded) lines (Ericson, Real-Time Collision Detection 5.1.9). */
function lineLine(a: LinePrim, b: LinePrim): [Vec3, Vec3] {
  const r = sub(a.p, b.p);
  const aa = dot(a.d, a.d);
  const bb = dot(b.d, b.d);
  const ab = dot(a.d, b.d);
  const ar = dot(a.d, r);
  const br = dot(b.d, r);
  const denom = aa * bb - ab * ab;
  // Parallel: start from the point of a nearest b's origin (or a's lower end), as below.
  let s = denom > 1e-12 * aa * bb ? clampT(a, (ab * br - bb * ar) / denom) : clampT(a, 0);
  let t = (ab * s + br) / bb;
  if (t < b.lo || t > b.hi) {
    t = clampT(b, t);
    s = clampT(a, (t * ab - ar) / aa);
  }
  // Parallel and unbounded on a: any point works; the one above is fine.
  return [at(a, s), at(b, t)];
}

function linePlane(line: LinePrim, plane: PlanePrim): [Vec3, Vec3] {
  const side = (t: number) => dot(sub(at(line, t), plane.p), plane.n);
  const dn = dot(line.d, plane.n);
  if (Math.abs(dn) > 1e-12) {
    // Where the line meets the plane, if that is on it.
    const t = -dot(sub(line.p, plane.p), plane.n) / dn;
    if (t >= line.lo && t <= line.hi) {
      const p = at(line, t);
      return [p, p];
    }
  }
  // Parallel, or a segment wholly on one side: its nearer end (or its origin).
  const ends = [line.lo, line.hi].filter(Number.isFinite);
  const t =
    ends.length === 0 ? 0 : ends.reduce((m, e) => (Math.abs(side(e)) < Math.abs(side(m)) ? e : m));
  const p = at(line, t);
  return [p, onPlane(plane, p)];
}

function planePlane(a: PlanePrim, b: PlanePrim): [Vec3, Vec3] {
  const dir = cross(a.n, b.n);
  if (length(dir) < 1e-9) return [a.p, onPlane(b, a.p)];
  // They meet: a point on both (on the line where they cross, nearest a's origin).
  const da = dot(a.n, a.p);
  const db = dot(b.n, b.p);
  const dd = dot(dir, dir);
  const p = scale(add(scale(cross(b.n, dir), da), scale(cross(dir, a.n), db)), 1 / dd);
  const foot = onLine({ kind: 'line', p, d: dir, lo: -Infinity, hi: Infinity }, a.p);
  return [foot, foot];
}

// ------------------------------------------------------------------ helpers

function polylineLength(poly: readonly Vec3[]): number {
  let sum = 0;
  for (let i = 1; i < poly.length; i++) sum += length(sub(poly[i] as Vec3, poly[i - 1] as Vec3));
  return sum;
}

/** The centre of mass of a polyline (as a wire of uniform density). */
function polylineCentroid(poly: readonly Vec3[]): Vec3 {
  let total = 0;
  let c: Vec3 = [0, 0, 0];
  for (let i = 1; i < poly.length; i++) {
    const a = poly[i - 1] as Vec3;
    const b = poly[i] as Vec3;
    const l = length(sub(b, a));
    total += l;
    c = add(c, scale(add(a, b), l / 2));
  }
  return total > 0 ? scale(c, 1 / total) : (poly[0] as Vec3);
}

function boxOf(points: readonly Vec3[]): Box {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const p of points) {
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k] as number, p[k] as number);
      max[k] = Math.max(max[k] as number, p[k] as number);
    }
  }
  return { min, max };
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

function unit(a: Vec3): Vec3 | undefined {
  const l = length(a);
  return l > 1e-12 ? scale(a, 1 / l) : undefined;
}
