/**
 * A sheet's anchors at the marker (P6-24 S3 and S4, ADR-0143's S3 and S4
 * amendments): each item anchor's reference (`sheetItemAnchors`: dimensions,
 * leader notes, centre marks and lines) resolves through the naming service the way
 * an annotation's does (exact name `ok`; related name or fingerprint
 * `moved`; else `detached`), and gives back the 3D geometry it stands for: a
 * point, a line's ends, a circle's centre, axis and radius, a cylinder's
 * or cone's outline for the view's direction, or its axis. A whole face
 * stands for what the item takes of it (`faceAs`). Unlike an annotation, an anchor
 * on geometry of a feature that is deleted, suppressed or failed is
 * `detached` before any search (`lostFeature`): a closest match there would be another edge,
 * and a missing number is safer on a drawing than a wrong one. A lost anchor
 * is never an error. Only plain data comes out of the kernel here; no shape
 * is made.
 */
import {
  type Feature,
  type GeomRef,
  type SheetAnchoredItem,
  type SheetAnchorGeometry,
  type SheetAnchorReport,
  type SheetRefAnchor,
  type SheetSegment3,
  type SheetSilhouetteAnchor,
  type SheetViewFrame,
  scriptOfGenerated,
  sheetSilhouetteSide,
} from '@extrudo/core';
import { add, dot, length, perpendicular, scale, sub, unit } from '../features/vec';
import { KernelError, type Vec3 } from '../kernel';
import { fingerprintOf } from '../naming/fingerprint';
import { featuresOfName } from '../naming/topo-id';
import type { EvalContext } from '../recompute/types';

/** What resolving an anchor needs of an evaluator's context. */
export type SheetAnchorContext = Pick<EvalContext, 'kernel' | 'resolve' | 'describe' | 'names'>;

/** What an item is called in a detached anchor's message, and what it does to the geometry. */
const LOST_WORDS: Record<SheetAnchoredItem['kind'], { thing: string; verb: string }> = {
  dimension: { thing: 'dimension', verb: 'measured' },
  leader: { thing: 'note', verb: 'drawn' },
  centreMark: { thing: 'centre mark', verb: 'drawn' },
  centreLine: { thing: 'centre line', verb: 'drawn' },
};

/**
 * An anchor's report when a feature its reference names (`featuresOfName`;
 * a script's generated feature counts as the script) is no longer in
 * `features`, is suppressed, or failed in the last recompute (`failed`, by
 * feature ID): `detached`, with why, in words for the item's `kind`. A
 * deleted one outranks a suppressed one, which outranks a failed one.
 * `undefined` when every one is there, active and made: then the anchor is
 * looked for as usual (exact name, related name, fingerprint).
 */
export function lostFeature(
  ref: GeomRef,
  features: readonly Pick<Feature, 'id' | 'name' | 'suppressed'>[],
  kind: SheetAnchoredItem['kind'] = 'dimension',
  failed: ReadonlySet<string> = NO_FAILED,
): SheetAnchorReport | undefined {
  const byId = new Map<string, Pick<Feature, 'id' | 'name' | 'suppressed'>>(
    features.map((f) => [f.id, f]),
  );
  const ids = new Set(byId.keys());
  const { thing, verb } = LOST_WORDS[kind];
  let suppressed: string | undefined;
  let broken: string | undefined;
  for (const token of featuresOfName(ref.id)) {
    const feature = byId.get(scriptOfGenerated(token, ids) ?? token);
    if (!feature) {
      return { status: 'detached', message: `The feature this was ${verb} on is deleted.` };
    }
    if (feature.suppressed) suppressed ??= feature.name;
    else if (failed.has(feature.id)) broken ??= feature.name;
  }
  if (suppressed !== undefined) {
    return {
      status: 'detached',
      message: `${suppressed}, the feature this was ${verb} on, is suppressed. Unsuppress it to show the ${thing} again.`,
    };
  }
  if (broken !== undefined) {
    return {
      status: 'detached',
      message: `${broken}, the feature this was ${verb} on, has an error. Fix it to show the ${thing} again.`,
    };
  }
  return undefined;
}

const NO_FAILED: ReadonlySet<string> = new Set();

/**
 * What a whole face (no `at`, no outline) stands for in an item: a circle
 * for a dimension and a centre mark (a cylinder's), the axis for a centre
 * line (a cylinder's or cone's), a point on it for a leader note (where its
 * dot goes).
 */
export type SheetFaceUse = 'circle' | 'axis' | 'point';

export function faceAs(kind: SheetAnchoredItem['kind']): SheetFaceUse {
  return kind === 'centreLine' ? 'axis' : kind === 'leader' ? 'point' : 'circle';
}

/** A reason the geometry can't give what the anchor asks; the anchor is not lost. */
class NoGeometry extends Error {}

/**
 * One anchor on geometry. `frame` is the item's view (an outline needs its
 * direction); `undefined` when the view is gone or broken. `face` is what a
 * whole face stands for (`faceAs`).
 */
export function resolveSheetAnchor(
  ctx: SheetAnchorContext,
  anchor: SheetRefAnchor | SheetSilhouetteAnchor,
  frame: SheetViewFrame | undefined,
  face: SheetFaceUse = 'circle',
): SheetAnchorReport {
  let hit: ReturnType<SheetAnchorContext['resolve']>;
  try {
    hit = ctx.resolve(anchor.ref, { label: 'the geometry on the sheet' });
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
    report.geometry = geometryOf(ctx, anchor, hit, frame, face);
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
  face: SheetFaceUse,
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
    case 'face': {
      if ('silhouette' in anchor) return outline(ctx, hit, anchor.silhouette, frame);
      if (face === 'axis') return faceAxis(ctx, hit);
      if (face === 'circle') return faceCircle(ctx, hit);
      const centroid = description.faces[hit.index]?.centroid;
      if (!centroid) throw new NoGeometry('The face is gone.');
      return { type: 'point', point: [...centroid] };
    }
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

/**
 * A cylinder's or cone's axis as far as the face covers it: its bounding
 * edges' points (a circle's sampled ones too) taken along the axis, lowest
 * to highest.
 */
function faceAxis(ctx: SheetAnchorContext, hit: Hit): SheetAnchorGeometry {
  const surface = ctx.kernel.surfaceGeometry(hit.shape, hit.index);
  const { origin, direction } = surface;
  if ((surface.type !== 'cylinder' && surface.type !== 'cone') || !origin || !direction) {
    throw new NoGeometry('The face is not a cylinder or a cone: it has no axis.');
  }
  const axis = unit(direction);
  let lo = Infinity;
  let hi = -Infinity;
  ctx.describe(hit.shape).edges.forEach((edge, e) => {
    if (!edge.faces.includes(hit.index)) return;
    const g = ctx.kernel.edgeGeometry(hit.shape, e);
    if (g.type === 'degenerate') return;
    for (const p of g.points) {
      const t = dot(sub(p as Vec3, origin), axis);
      lo = Math.min(lo, t);
      hi = Math.max(hi, t);
    }
  });
  if (!(hi > lo)) throw new NoGeometry('The face has no length along its axis.');
  return { type: 'axis', start: add(origin, scale(axis, lo)), end: add(origin, scale(axis, hi)) };
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
