/**
 * A sheet's anchors at the marker (P6-24 S3, ADR-0143's S3 amendment): each
 * dimension anchor's reference resolves through the naming service the way
 * an annotation's does (exact name `ok`; related name or fingerprint
 * `moved`; else `detached`), and gives back the 3D geometry it stands for: a
 * point, a line's ends, a circle's centre, axis and radius, or a cylinder's
 * or cone's outline for the view's direction. A lost anchor is never an
 * error. Only plain data comes out of the kernel here; no shape is made.
 */
import {
  type SheetAnchorGeometry,
  type SheetAnchorReport,
  type SheetRefAnchor,
  type SheetSegment3,
  type SheetSilhouetteAnchor,
  type SheetViewFrame,
  sheetSilhouetteSide,
} from '@extrudo/core';
import { add, dot, length, perpendicular, scale, sub, unit } from '../features/vec';
import { KernelError, type Vec3 } from '../kernel';
import { fingerprintOf } from '../naming/fingerprint';
import type { EvalContext } from '../recompute/types';

/** What resolving an anchor needs of an evaluator's context. */
export type SheetAnchorContext = Pick<EvalContext, 'kernel' | 'resolve' | 'describe' | 'names'>;

/** A reason the geometry can't give what the anchor asks; the anchor is not lost. */
class NoGeometry extends Error {}

/**
 * One anchor on geometry. `frame` is the dimension's view (an outline needs
 * its direction); `undefined` when the view is gone or broken.
 */
export function resolveSheetAnchor(
  ctx: SheetAnchorContext,
  anchor: SheetRefAnchor | SheetSilhouetteAnchor,
  frame: SheetViewFrame | undefined,
): SheetAnchorReport {
  let hit: ReturnType<SheetAnchorContext['resolve']>;
  try {
    hit = ctx.resolve(anchor.ref, { label: 'the dimensioned geometry' });
  } catch (error) {
    if (error instanceof KernelError) return { status: 'detached' };
    throw error;
  }
  const description = ctx.describe(hit.shape);
  const report: SheetAnchorReport = {
    status: hit.via === 'name' && hit.warning === undefined ? 'ok' : 'moved',
    resolved: {
      kind: hit.kind,
      id: hit.id,
      fingerprint: fingerprintOf(description, ctx.names(hit.body), hit.kind, hit.index),
    },
  };
  try {
    report.geometry = geometryOf(ctx, anchor, hit, frame);
  } catch (error) {
    if (!(error instanceof NoGeometry || error instanceof KernelError)) throw error;
    report.message = error.message;
  }
  return report;
}

type Hit = ReturnType<SheetAnchorContext['resolve']>;

function geometryOf(
  ctx: SheetAnchorContext,
  anchor: SheetRefAnchor | SheetSilhouetteAnchor,
  hit: Hit,
  frame: SheetViewFrame | undefined,
): SheetAnchorGeometry {
  const description = ctx.describe(hit.shape);
  switch (hit.kind) {
    case 'vertex': {
      const vertex = description.vertices[hit.index];
      if (!vertex) throw new NoGeometry('The vertex is gone.');
      return { type: 'point', point: [...vertex.point] };
    }
    case 'edge':
      return edgeGeometry(ctx, hit, 'at' in anchor ? anchor.at : undefined);
    case 'face':
      return 'silhouette' in anchor
        ? outline(ctx, hit, anchor.silhouette, frame)
        : faceCircle(ctx, hit);
  }
}

function edgeGeometry(
  ctx: SheetAnchorContext,
  hit: Hit,
  at: SheetRefAnchor['at'],
): SheetAnchorGeometry {
  const g = ctx.kernel.edgeGeometry(hit.shape, hit.index);
  if (g.type === 'degenerate') throw new NoGeometry('The edge has no length.');
  const start = g.points[0] as Vec3;
  const end = g.points.at(-1) as Vec3;
  switch (at) {
    case 'start':
      return { type: 'point', point: start };
    case 'end':
      return { type: 'point', point: end };
    case 'middle': {
      const edge = ctx.describe(hit.shape).edges[hit.index];
      if (!edge) throw new NoGeometry('The edge is gone.');
      return { type: 'point', point: [...edge.midpoint] };
    }
    case 'centre':
      if (!g.conic)
        throw new NoGeometry('The edge has no centre: it is not a circle or an ellipse.');
      return { type: 'point', point: g.conic.center };
    default:
      break;
  }
  if (g.type === 'line') return { type: 'line', start, end };
  if (g.type === 'circle' && g.conic) {
    const { center, axis, xDirection, radius } = g.conic;
    return { type: 'circle', centre: center, axis, xDirection, radius };
  }
  return { type: 'curve', start, end };
}

/** A cylinder's face as a circle: on its axis, level with the face's middle. */
function faceCircle(ctx: SheetAnchorContext, hit: Hit): SheetAnchorGeometry {
  const surface = ctx.kernel.surfaceGeometry(hit.shape, hit.index);
  const { origin, direction, radius } = surface;
  if (surface.type !== 'cylinder' || !origin || !direction || radius === undefined) {
    throw new NoGeometry('The face is not a cylinder: it has no one radius.');
  }
  const axis = unit(direction);
  const middle = ctx.describe(hit.shape).faces[hit.index]?.centroid ?? origin;
  const centre = add(origin, scale(axis, dot(sub(middle, origin), axis)));
  return { type: 'circle', centre, axis, xDirection: perpendicular(axis), radius };
}

/** The outline of a cylinder or cone on `side` (`sheetSilhouetteSide`) seen in `frame`. */
function outline(
  ctx: SheetAnchorContext,
  hit: Hit,
  side: 1 | -1,
  frame: SheetViewFrame | undefined,
): SheetAnchorGeometry {
  if (!frame) throw new NoGeometry("The dimension's view is gone.");
  const surface = ctx.kernel.surfaceGeometry(hit.shape, hit.index);
  const { origin, direction } = surface;
  if ((surface.type !== 'cylinder' && surface.type !== 'cone') || !origin || !direction) {
    throw new NoGeometry('The face is not a cylinder or a cone: its outline has no name.');
  }
  const lines: SheetSegment3[] = [];
  for (const piece of ctx.kernel.faceSilhouettes(hit.shape, hit.index, frame.direction)) {
    if (piece.type === 'line') lines.push({ start: piece.points[0], end: piece.points[1] });
  }
  const sideOf = (l: SheetSegment3) =>
    sheetSilhouetteSide(frame.direction, origin, direction, scale(add(l.start, l.end), 0.5));
  // A face cut by a hole may give an outline in pieces: the longest stands for its side.
  const longest = (s: 1 | -1) =>
    lines
      .filter((l) => sideOf(l) === s)
      .sort((a, b) => length(sub(b.end, b.start)) - length(sub(a.end, a.start)))[0];
  const mine = longest(side);
  if (!mine) throw new NoGeometry('The face has no outline on that side in this view.');
  const opposite = longest(side === 1 ? -1 : 1);
  return { type: 'silhouette', ...mine, ...(opposite && { opposite }) };
}
