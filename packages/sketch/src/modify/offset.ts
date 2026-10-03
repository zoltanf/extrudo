/**
 * Sketch offset (P1-10, FR-SK-10): a copy of a chain of lines and arcs (or
 * a circle) at a distance to one side.
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
 */
import type {
  SketchConstraint,
  SketchData,
  SketchEntity,
  SketchEntityId,
  Vec2,
} from '@extrudo/core';
import { add, cross, dist, dot, scale, sub } from '../inference/geometry';
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

type Open = Extract<SketchEntity, { type: 'line' } | { type: 'arc' }>;

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
  if (start?.type !== 'line' && start?.type !== 'arc') return undefined;

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
    if (e.type !== 'line' && e.type !== 'arc') continue;
    for (const point of [e.start, e.end]) {
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
  const open = (cid: SketchEntityId) => data.entities[cid] as Open;

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
      closed = n.point === start.start;
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

/** A curve of the offset, as positions (a line's ends, an arc's center and ends, a circle). */
type Shape =
  | { kind: 'line'; start: Vec2; end: Vec2 }
  | { kind: 'arc'; center: Vec2; radius: number; start: Vec2; end: Vec2 }
  | { kind: 'circle'; center: Vec2; radius: number };

/**
 * The offset of a chain by `distance` to the left of its direction of
 * travel (negative: to the right), with the pieces trimmed or extended to
 * meet. Throws a `ModifyError` if an arc would shrink to nothing or two
 * neighbouring pieces no longer meet.
 */
export function offsetShapes(data: SketchData, chain: Chain, distance: number): Shape[] {
  const shapes: Shape[] = chain.links.map(({ id, reversed }) => {
    const e = data.entities[id];
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
    throw new ModifyError('Offset works on lines, circles and arcs.');
  });

  // Join each piece to the next where they cross, nearest the old joint.
  const count = chain.closed ? shapes.length : shapes.length - 1;
  if (shapes[0]?.kind === 'circle') return shapes;
  for (let i = 0; i < count; i++) {
    const j = (i + 1) % shapes.length;
    const here = shapes[i] as Exclude<Shape, { kind: 'circle' }>;
    const there = shapes[j] as Exclude<Shape, { kind: 'circle' }>;
    const out = (chain.links[i] as ChainLink).reversed ? 'start' : 'end';
    const into = (chain.links[j] as ChainLink).reversed ? 'end' : 'start';
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

/** Where two offset pieces cross, as unbounded curves (lines and whole circles). */
function crossings(
  a: Exclude<Shape, { kind: 'circle' }>,
  b: Exclude<Shape, { kind: 'circle' }>,
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
  const made = chain.links.map((link, i) => {
    const e = data.entities[link.id] as SketchEntity & { construction: boolean };
    const shape = shapes[i] as Shape;
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
  if (shapes[0]?.kind !== 'circle') {
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

/** The offset's curves as polylines, for the preview. */
export function offsetPreview(data: SketchData, chain: Chain, distance: number): Vec2[][] {
  const shapes = offsetShapes(data, chain, distance);
  return shapes.map((shape) => {
    if (shape.kind === 'line') return [shape.start, shape.end];
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
    return out;
  });
}
