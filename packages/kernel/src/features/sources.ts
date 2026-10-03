/**
 * What a sweep sweeps (ADR-0028 §2, shared with revolve, ADR-0029):
 * sketch profiles and flat faces of bodies, united into one source, and
 * the plane they lie in. Moved from `extrude.ts` unchanged, but for the
 * feature's word in messages. A `sketchEntity` ref to a sketch's text
 * (P4-03, ADR-0058 §5) means every ink face of that text.
 */
import {
  type FeatureId,
  type GeomRef,
  parseProfileRefId,
  parseSketchEntityRefId,
} from '@extrudo/core';
import { KernelError, type ShapeHandle, type ShapeScope, type Vec3 } from '../kernel';
import { faceEdgeSources, type SweepSource } from '../naming/ops';
import { LostReferenceError } from '../naming/resolve';
import type { EvalContext } from '../recompute/types';
import type { SketchOutputData } from './sketch';
import { add, dot, length, scale, sub } from './vec';

/** Cosines within this of 1 are parallel directions. */
export const PARALLEL_EPS = 1e-9;

export type Plane = { point: Vec3; normal: Vec3 };

export interface Base {
  source: SweepSource;
  plane: Plane;
}

/** A feature's word in messages: "extrude", "revolve". */
export type FeatureNoun = string;

/** The profiles and faces to sweep, united into one source, and their plane. */
export function baseOf(
  ctx: EvalContext,
  scope: ShapeScope,
  refs: GeomRef[],
  noun: FeatureNoun,
): Base {
  return uniteParts(ctx, scope, partsOf(ctx, scope, refs, noun));
}

/** Each distinct profile or face as a source with its plane, in pick order. */
export function partsOf(
  ctx: EvalContext,
  scope: ShapeScope,
  refs: GeomRef[],
  noun: FeatureNoun,
): Base[] {
  const parts: Base[] = [];
  const seen = new Set<string>();
  for (const ref of refs) {
    const key = `${ref.kind}:${ref.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (ref.kind === 'sketchEntity') {
      parts.push(...textParts(ctx, ref, noun));
      continue;
    }
    parts.push(
      ref.kind === 'profile' ? profilePart(ctx, ref, noun) : facePart(ctx, scope, ref, noun),
    );
  }
  return parts;
}

/** Parts in one plane as one source (the first part's plane). */
export function uniteParts(ctx: EvalContext, scope: ShapeScope, parts: Base[]): Base {
  const [first, ...rest] = parts as [Base, ...Base[]];
  let source = first.source;
  for (const part of rest) {
    if (!coplanar(first.plane, part.plane)) {
      throw new KernelError('Pick profiles and faces that lie in one plane.');
    }
    source = unite(ctx, scope, source, part.source);
  }
  return { source, plane: first.plane };
}

function profilePart(ctx: EvalContext, ref: GeomRef, noun: FeatureNoun): Base {
  const parsed = parseProfileRefId(ref.id);
  if (!parsed) throw new KernelError("One of its profiles isn't a sketch profile. Pick it again.");
  const output = ctx.output(parsed.feature as FeatureId);
  const data = output.data as Partial<SketchOutputData> | undefined;
  const face = output.shapes?.[parsed.profile];
  const info = data?.profiles?.find((p) => p.id === parsed.profile);
  if (face === undefined || !info || !data?.frame) {
    throw new LostReferenceError(
      `Can't find one of its profiles any more: an earlier change to the sketch removed it. Edit the ${noun} and pick it again.`,
      ref,
    );
  }
  return {
    source: { shape: face, edgeSources: info.edges },
    plane: { point: data.frame.origin, normal: data.frame.normal },
  };
}

/**
 * A whole text (P4-03, ADR-0058 §5): a `sketchEntity` ref to a sketch's
 * text entity stands for every ink face of that text, each a part like a
 * profile's. It survives editing the string, the font or the size, where
 * per-letter profile IDs don't.
 */
function textParts(ctx: EvalContext, ref: GeomRef, noun: FeatureNoun): Base[] {
  const lost = new LostReferenceError(
    `Can't find the text any more: an earlier change removed it. Edit the ${noun} and pick it again.`,
    ref,
  );
  const parsed = parseSketchEntityRefId(ref.id);
  if (!parsed) throw lost;
  let data: Partial<SketchOutputData> | undefined;
  let shapes: Record<string, ShapeHandle> | undefined;
  try {
    const output = ctx.output(parsed.feature);
    data = output.data as Partial<SketchOutputData> | undefined;
    shapes = output.shapes;
  } catch {
    data = undefined;
  }
  // Not a text of that sketch any more (deleted, or never was one).
  if (!data?.texts?.includes(parsed.entity)) throw lost;
  const parts: Base[] = [];
  for (const info of data.profiles ?? []) {
    if (info.text !== parsed.entity) continue;
    const face = shapes?.[info.id];
    if (!face || !data.frame) continue;
    parts.push({
      source: { shape: face, edgeSources: info.edges },
      plane: { point: data.frame.origin, normal: data.frame.normal },
    });
  }
  if (parts.length === 0) {
    // A text of the sketch that draws nothing: no font, nothing to draw,
    // or construction geometry.
    throw new KernelError(`The text has no letters to ${noun}.`);
  }
  return parts;
}

/** A flat face of a body (press-pull): the face itself, its edges' names as sources. */
function facePart(ctx: EvalContext, scope: ShapeScope, ref: GeomRef, noun: FeatureNoun): Base {
  const hit = ctx.resolve(ref, { label: `the face to ${noun}` });
  const info = ctx.describe(hit.shape).faces[hit.index];
  if (info?.type !== 'plane' || !info.direction) {
    throw new KernelError(`Can only ${noun} flat faces. Pick a flat face or a sketch profile.`);
  }
  const source = faceEdgeSources(
    ctx.kernel,
    { shape: hit.shape, names: ctx.names(hit.body) },
    hit.index,
  );
  scope.track(source.shape);
  return { source, plane: { point: info.centroid, normal: info.direction } };
}

/**
 * Two coplanar sources as one (a region split by a sketch line, a face and
 * a profile next to it): fused and simplified, so shared edges disappear
 * and the extrude has one face per side, not one per piece. Edge sources
 * follow the fuse's history; a merged edge takes the first input's source.
 */
function unite(ctx: EvalContext, scope: ShapeScope, a: SweepSource, b: SweepSource): SweepSource {
  const { kernel } = ctx;
  const result = scope.track(kernel.boolean('fuse', a.shape, b.shape, { simplify: true }));
  const edgeSources: (string | null)[] = new Array(kernel.count(result.shape, 'edge')).fill(null);
  const rank: number[] = edgeSources.map(() => Number.POSITIVE_INFINITY);
  for (const record of result.history) {
    if (record.from.kind !== 'edge') continue;
    if (record.relation !== 'modified' && record.relation !== 'kept') continue;
    const source = (record.input === 0 ? a : b).edgeSources[record.from.index] ?? null;
    if (source === null) continue;
    for (const to of record.to) {
      if (to.kind !== 'edge' || (rank[to.index] as number) <= record.input) continue;
      edgeSources[to.index] = source;
      rank[to.index] = record.input;
    }
  }
  return { shape: result.shape, edgeSources };
}

export function coplanar(a: Plane, b: Plane): boolean {
  const scaleOf = Math.max(1, length(a.point), length(b.point));
  return (
    Math.abs(Math.abs(dot(a.normal, b.normal)) - 1) <= PARALLEL_EPS * 1e3 &&
    Math.abs(dot(sub(b.point, a.point), a.normal)) <= 1e-6 * scaleOf
  );
}

/** Area centroid of a face or a compound of faces. */
export function centroidOf(ctx: EvalContext, shape: ShapeHandle): Vec3 {
  let area = 0;
  let sum: Vec3 = [0, 0, 0];
  for (const face of ctx.kernel.describe(shape).faces) {
    area += face.area;
    sum = add(sum, scale(face.centroid, face.area));
  }
  return area > 0 ? scale(sum, 1 / area) : sum;
}
