/**
 * Sketch profiles as OpenSCAD 2D nodes (P6-09, ADR-0088 §4, §7): what the
 * Extrude and Revolve hooks sweep. A picked profile or text becomes one
 * `polygon` per region (its outer loop and holes as paths, filled even-odd),
 * a loop that is one full circle a `circle`, and every other curve a
 * polyline. Points are numbers: the sketch's geometry is fixed (the solver
 * OpenSCAD doesn't have put it there).
 *
 * Shared by both hooks, and read from the sketch's own output — the same
 * `detectProfiles` the sketch evaluator keyed its regions by, so no copy of
 * the arrangement.
 */
import {
  type FeatureId,
  type GeomRef,
  parseProfileRefId,
  parseSketchEntityRefId,
  type SketchFrame,
  type Vec2,
} from '@extrudo/core';
import {
  detectProfiles,
  type Profile,
  type ProfileEdge,
  type ProfileLoop,
} from '@extrudo/sketch/profiles';
import type { SketchOutputData } from '../features/sketch';
import { add, dot, scale, sub } from '../features/vec';
import { KernelError } from '../kernel';
import { LostReferenceError } from '../naming/resolve';
import type { PlanarCurve } from '../planar';
import type { CsgContext } from './context';
import type { CsgNode } from './ir';

const TAU = 2 * Math.PI;

/** A profile region with what the conversion reads of its sketch. */
export interface ProfileRef {
  profile: Profile;
  /** The sketch's own frame, what places the 2D node in the world. */
  frame: SketchFrame;
  /** The sketch's exact curves by entity ID (`SketchOutputData.exact`). */
  exact: Record<string, PlanarCurve>;
}

/** Maps a point of a sketch's plane into the 2D coordinates the node is built in. */
export type To2d = (frame: SketchFrame, p: Vec2) => Vec2;

type Arc = Extract<PlanarCurve, { kind: 'arc' }>;

/**
 * The regions a set of profile and text references names, in pick order, or
 * `null` when a face is picked (`ctx.unsupported`). A missing region throws a
 * `KernelError`, so the version walk falls back to a mesh.
 */
export function resolveProfiles(ctx: CsgContext, refs: readonly GeomRef[]): ProfileRef[] | null {
  const found: ProfileRef[] = [];
  for (const ref of refs) {
    if (ref.kind === 'face') return ctx.unsupported('faces as profiles');
    if (ref.kind === 'profile') {
      const parsed = parseProfileRefId(ref.id);
      if (!parsed)
        throw new KernelError("One of its profiles isn't a sketch profile. Pick it again.");
      const data = sketchOutput(ctx, parsed.feature);
      found.push({
        profile: regionOf(data, parsed.profile, ref),
        frame: data.frame,
        exact: data.exact ?? {},
      });
      continue;
    }
    if (ref.kind === 'sketchEntity') {
      const parsed = parseSketchEntityRefId(ref.id);
      if (!parsed)
        throw new KernelError("One of its profiles isn't a sketch profile. Pick it again.");
      const data = sketchOutput(ctx, parsed.feature);
      // A whole text (P4-03, ADR-0058 §5): every ink region of that text.
      if (!data.texts?.includes(parsed.entity))
        throw new KernelError('The text has no letters to sweep.');
      let any = false;
      for (const info of data.profiles) {
        if (info.text !== parsed.entity) continue;
        any = true;
        found.push({
          profile: regionOf(data, info.id, ref),
          frame: data.frame,
          exact: data.exact ?? {},
        });
      }
      if (!any) throw new KernelError('The text has no letters to sweep.');
      continue;
    }
    throw new KernelError('Pick sketch profiles or texts to sweep.');
  }
  return found;
}

/** Every region of `refs` as one 2D node (their union), placed in `to2d`'s coordinates. */
export function merged2d(ctx: CsgContext, refs: readonly ProfileRef[], to2d: To2d): CsgNode {
  const nodes = refs.map((ref) => regionNode(ctx, ref, to2d));
  return nodes.length === 1 ? (nodes[0] as CsgNode) : { kind: 'union', children: nodes };
}

/** Maps a point into `to`'s frame, through the world when the frames differ. */
export function framePoint(from: SketchFrame, to: SketchFrame, p: Vec2): Vec2 {
  if (sameFrame(from, to)) return p;
  const world = add(from.origin, add(scale(from.x, p[0]), scale(from.y, p[1])));
  const rel = sub(world, to.origin);
  return [dot(rel, to.x), dot(rel, to.y)];
}

function sameFrame(a: SketchFrame, b: SketchFrame): boolean {
  const same = (u: Vec3, v: Vec3) =>
    Math.abs(u[0] - v[0]) < 1e-9 && Math.abs(u[1] - v[1]) < 1e-9 && Math.abs(u[2] - v[2]) < 1e-9;
  return same(a.origin, b.origin) && same(a.x, b.x) && same(a.y, b.y) && same(a.normal, b.normal);
}

type Vec3 = readonly [number, number, number];

// ------------------------------------------------------------------ a region

function regionNode(ctx: CsgContext, ref: ProfileRef, to2d: To2d): CsgNode {
  const { profile, frame, exact } = ref;
  const outerCircle = circleOf(profile.outer, exact);
  const circleHoles = profile.holes.filter((h) => circleOf(h, exact));
  const polygonHoles = profile.holes.filter((h) => !circleOf(h, exact));
  const outer: CsgNode = outerCircle
    ? circleNode(outerCircle, frame, to2d)
    : polygonNode(ctx, profile.outer, polygonHoles, ref, to2d);
  const subs: CsgNode[] = circleHoles.map((h) =>
    circleNode(circleOf(h, exact) as Arc, frame, to2d),
  );
  // A polygon hole can only be a `paths` entry under a polygon outer loop;
  // under a circular one it is a `difference` too.
  if (outerCircle) for (const h of polygonHoles) subs.push(polygonNode(ctx, h, [], ref, to2d));
  return subs.length > 0 ? { kind: 'difference', children: [outer, ...subs] } : outer;
}

/** The arc when the loop is one whole circle. */
function circleOf(loop: ProfileLoop, exact: Record<string, PlanarCurve>): Arc | undefined {
  const edge = loop.edges.length === 1 ? loop.edges[0] : undefined;
  const curve = edge && exact[edge.curve];
  return curve?.kind === 'arc' && Math.abs(curve.sweep) >= TAU - 1e-9 ? curve : undefined;
}

function circleNode(arc: Arc, frame: SketchFrame, to2d: To2d): CsgNode {
  const [cx, cy] = to2d(frame, [arc.center[0], arc.center[1]]);
  return { kind: 'translate', v: [cx, cy, 0], children: [{ kind: 'circle', r: arc.radius }] };
}

function polygonNode(
  ctx: CsgContext,
  loop: ProfileLoop,
  holes: readonly ProfileLoop[],
  ref: ProfileRef,
  to2d: To2d,
): CsgNode {
  const outer = loopPoints(ctx, loop, ref, to2d);
  const points: Vec2[] = [...outer];
  const paths: number[][] = [outer.map((_, i) => i)];
  for (const hole of holes) {
    const hp = loopPoints(ctx, hole, ref, to2d);
    const base = points.length;
    points.push(...hp);
    paths.push(hp.map((_, i) => base + i));
  }
  return { kind: 'polygon', points, paths };
}

/** A loop's points in the loop's order, without the closing duplicate. */
function loopPoints(ctx: CsgContext, loop: ProfileLoop, ref: ProfileRef, to2d: To2d): Vec2[] {
  const points: Vec2[] = [];
  for (const edge of loop.edges) {
    for (const p of edgePoints(ctx, edge, ref.exact)) {
      const [x, y] = to2d(ref.frame, p);
      const last = points[points.length - 1];
      if (last && Math.abs(last[0] - x) < 1e-9 && Math.abs(last[1] - y) < 1e-9) continue;
      points.push([x, y]);
    }
  }
  const first = points[0];
  const last = points[points.length - 1];
  if (
    points.length > 1 &&
    first &&
    last &&
    Math.abs(first[0] - last[0]) < 1e-9 &&
    Math.abs(first[1] - last[1]) < 1e-9
  ) {
    points.pop();
  }
  return points;
}

/**
 * One edge's points, from its start to its end: a line its two end points, an
 * arc `ctx.fragments(radius)` samples a full turn (proportionally for its
 * sweep, at least one), anything else (spline, ellipse, conic, text glyph)
 * the polyline `detectProfiles` already sampled, finer than the deflection.
 */
function edgePoints(
  ctx: CsgContext,
  edge: ProfileEdge,
  exact: Record<string, PlanarCurve>,
): Vec2[] {
  const curve = exact[edge.curve];
  if (curve?.kind === 'line') return edge.reversed ? [curve.b, curve.a] : [curve.a, curve.b];
  if (curve?.kind === 'arc') {
    const n = Math.max(1, Math.ceil((ctx.fragments(curve.radius) * Math.abs(curve.sweep)) / TAU));
    const points: Vec2[] = [];
    for (let i = 0; i <= n; i++) {
      const angle = curve.from + (curve.sweep * i) / n;
      points.push([
        curve.center[0] + curve.radius * Math.cos(angle),
        curve.center[1] + curve.radius * Math.sin(angle),
      ]);
    }
    return edge.reversed ? points.reverse() : points;
  }
  return [...edge.points];
}

// ------------------------------------------------------------------ lookup

function sketchOutput(ctx: CsgContext, feature: FeatureId): SketchOutputData {
  const data = ctx.output(feature).data as Partial<SketchOutputData> | undefined;
  if (!data?.frame || !data.sketch) {
    throw new LostReferenceError("Can't find one of its profiles any more. Pick it again.", {
      kind: 'profile',
      id: feature,
    });
  }
  return data as SketchOutputData;
}

/** The region of a sketch's output by the ID a reference names (a `~`-suffixed ID too). */
function regionOf(data: SketchOutputData, id: string, ref: GeomRef): Profile {
  const regions = detectProfiles(data.sketch);
  const clean = id.replace(/~+$/, '');
  const found = regions.find((p) => p.id === id) ?? regions.find((p) => p.id === clean);
  if (!found) {
    throw new LostReferenceError(
      `Can't find one of its profiles any more: an earlier change to the sketch removed it. Pick it again.`,
      ref,
    );
  }
  return found;
}
