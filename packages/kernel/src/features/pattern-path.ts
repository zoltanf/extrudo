/**
 * The path a path pattern follows (P3-07, ADR-0047): sketch curves and body
 * edges chained end to end into one polyline that can be asked for the
 * point and direction at a distance along it.
 *
 * Lines are exact, arcs and circles are sampled every half degree (a chord
 * of an arc of radius r is short of it by r·θ²/8: 0.4 µm at 100 mm), the
 * rest come as the sketch's or the kernel's own polylines. So a distance
 * along a curved path is that of the polyline: short by less than 0.01 %.
 */
import {
  type FeatureId,
  type GeomRef,
  parseSketchEntityRefId,
  type SketchEntityId,
  type SketchFrame,
  sketchToWorld,
} from '@extrudo/core';
import { KernelError, type Vec3 } from '../kernel';
import { LostReferenceError } from '../naming/resolve';
import type { EvalContext } from '../recompute/types';
import type { SketchOutputData, SketchPathCurve } from './sketch';
import { add, dot, length, scale, sub, unit } from './vec';

/** Points closer than this (mm) are the same point when chaining pieces. */
const JOIN = 1e-3;
/** Samples per whole turn of a circle or arc. */
const TURN_SAMPLES = 720;
/** Cosine of the largest turn (2°) at a vertex that still counts as a smooth curve. */
const SMOOTH = Math.cos((2 * Math.PI) / 180);
/** Samples of a curved body edge. */
const EDGE_SAMPLES = 360;

export interface PathPoint {
  point: Vec3;
  /** Unit direction of travel. */
  tangent: Vec3;
}

export interface Path {
  points: readonly Vec3[];
  /** Distance along the path of each point; the last is the length. */
  along: readonly number[];
  length: number;
  /** It ends where it starts. */
  closed: boolean;
  /** Where distance `s` (clamped to the path) is, and which way the path runs there. */
  at(s: number): PathPoint;
}

/** A path from points in order. */
export function pathOf(points: readonly Vec3[]): Path {
  const along: number[] = [0];
  for (let i = 1; i < points.length; i++) {
    along.push((along[i - 1] as number) + length(sub(points[i] as Vec3, points[i - 1] as Vec3)));
  }
  const total = along[along.length - 1] as number;
  const first = points[0] as Vec3;
  const last = points[points.length - 1] as Vec3;
  // The direction at each end of every segment: a vertex where the path turns by only a little
  // (a curve's samples) takes the mean of its two segments, a real corner keeps each one's own.
  const direction = (i: number): Vec3 => unit(sub(points[i + 1] as Vec3, points[i] as Vec3));
  const starts: Vec3[] = [];
  const ends: Vec3[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const own = direction(i);
    const before = i > 0 ? direction(i - 1) : undefined;
    const after = i + 2 < points.length ? direction(i + 1) : undefined;
    // The two ends of the path itself lean on the neighbour the other way: the tangent of a curve's
    // last chord is half a step short of the curve's own.
    const smoothBefore = before && dot(before, own) > SMOOTH ? before : undefined;
    const smoothAfter = after && dot(after, own) > SMOOTH ? after : undefined;
    starts.push(
      smoothBefore
        ? unit(add(smoothBefore, own))
        : i === 0 && smoothAfter
          ? unit(sub(scale(own, 1.5), scale(smoothAfter, 0.5)))
          : own,
    );
    ends.push(
      smoothAfter
        ? unit(add(own, smoothAfter))
        : i === points.length - 2 && smoothBefore
          ? unit(sub(scale(own, 1.5), scale(smoothBefore, 0.5)))
          : own,
    );
  }
  return {
    points,
    along,
    length: total,
    closed: points.length > 2 && length(sub(first, last)) <= JOIN,
    at(s) {
      const target = Math.min(Math.max(s, 0), total);
      // The segment holding `target`: binary search over the cumulative lengths.
      let lo = 1;
      let hi = points.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if ((along[mid] as number) < target) lo = mid + 1;
        else hi = mid;
      }
      const a = points[lo - 1] as Vec3;
      const b = points[lo] as Vec3;
      const span = (along[lo] as number) - (along[lo - 1] as number);
      const t = span > 0 ? (target - (along[lo - 1] as number)) / span : 0;
      const tangent = unit(
        add(scale(starts[lo - 1] as Vec3, 1 - t), scale(ends[lo - 1] as Vec3, t)),
      );
      return { point: add(a, scale(sub(b, a), t)), tangent };
    },
  };
}

/** The points of a sketch curve in the world. */
function curvePoints(curve: SketchPathCurve, frame: SketchFrame): Vec3[] {
  if (curve.type === 'polyline') return curve.points.map((p) => sketchToWorld(frame, p));
  const n = Math.max(2, Math.ceil((Math.abs(curve.sweep) / (2 * Math.PI)) * TURN_SAMPLES));
  const out: Vec3[] = [];
  for (let i = 0; i <= n; i++) {
    const a = curve.from + (curve.sweep * i) / n;
    out.push(
      sketchToWorld(frame, [
        curve.center[0] + curve.radius * Math.cos(a),
        curve.center[1] + curve.radius * Math.sin(a),
      ]),
    );
  }
  return out;
}

/** The pieces of a path reference: one polyline per sketch curve or edge, each in its own direction. */
function pieceOf(ctx: EvalContext, ref: GeomRef): Vec3[] {
  if (ref.kind === 'sketchEntity') {
    const parsed = parseSketchEntityRefId(ref.id);
    let data: Partial<SketchOutputData> | undefined;
    try {
      data = parsed && (ctx.output(parsed.feature as FeatureId).data as Partial<SketchOutputData>);
    } catch {
      data = undefined;
    }
    const curve = data?.curves?.[parsed?.entity as SketchEntityId];
    if (!data?.frame || !curve) {
      throw new LostReferenceError(
        "Can't find a curve of the path any more: an earlier change to its sketch removed it. Pick the path again.",
        ref,
      );
    }
    return curvePoints(curve, data.frame);
  }
  if (ref.kind === 'edge') {
    const hit = ctx.resolve(ref, { label: 'an edge of the path' });
    const geometry = ctx.kernel.edgeGeometry(hit.shape, hit.index, EDGE_SAMPLES);
    if (geometry.type === 'degenerate' || geometry.points.length < 2) {
      throw new KernelError('An edge of the path has no length. Pick another.');
    }
    return geometry.points;
  }
  throw new KernelError('A path is made of sketch curves and edges. Pick those.');
}

const near = (a: Vec3, b: Vec3) => length(sub(a, b)) <= JOIN;

/**
 * The path the references make: the pieces chained end to end (each used
 * once, reversed where it has to be), starting with the first reference in
 * its own direction, or (`flip`) walked from the far end. A curve that
 * doesn't meet the rest is an error.
 */
export function pathFromRefs(ctx: EvalContext, refs: readonly GeomRef[], flip: boolean): Path {
  if (refs.length === 0) throw new KernelError('Pick the path: sketch curves or edges.');
  const pieces = refs.map((ref) => pieceOf(ctx, ref));
  let chain: Vec3[] = [...(pieces.shift() as Vec3[])];
  while (pieces.length > 0) {
    const head = chain[0] as Vec3;
    const tail = chain[chain.length - 1] as Vec3;
    const at = pieces.findIndex((p) => {
      const [a, b] = [p[0] as Vec3, p[p.length - 1] as Vec3];
      return near(a, tail) || near(b, tail) || near(a, head) || near(b, head);
    });
    if (at < 0) {
      throw new KernelError(
        "The pieces of the path don't join end to end. Pick curves or edges that meet.",
      );
    }
    const [piece] = pieces.splice(at, 1) as [Vec3[]];
    const [a, b] = [piece[0] as Vec3, piece[piece.length - 1] as Vec3];
    if (near(a, tail)) chain = [...chain, ...piece.slice(1)];
    else if (near(b, tail)) chain = [...chain, ...[...piece].reverse().slice(1)];
    else if (near(b, head)) chain = [...piece.slice(0, -1), ...chain];
    else chain = [...[...piece].reverse().slice(0, -1), ...chain];
  }
  if (chain.length < 2) throw new KernelError('The path has no length.');
  const path = pathOf(flip ? [...chain].reverse() : chain);
  if (path.length <= JOIN) throw new KernelError('The path has no length.');
  return path;
}
