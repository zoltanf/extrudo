/**
 * Planes, axes and points as references name them (P3-05, ADR-0040): what
 * the construction features, sketches, primitives, extrude's "to object"
 * and revolve's axis all read. A reference is an origin plane or axis
 * (fixed geometry in core), a construction feature (its output), a body's
 * face, edge or vertex (resolved through topological naming, ADR-0005) or a
 * sketch line.
 */
import {
  type ConstructionReport,
  type FeatureId,
  faceSketchFrame,
  type GeomRef,
  originAxis,
  originPlane,
  parseSketchEntityRefId,
  type SketchFrame,
  sketchToWorld,
} from '@extrudo/core';
import { KernelError, MeshBodyError, meshBodyMessage, type Vec3 } from '../kernel';
import { LostReferenceError } from '../naming/resolve';
import type { EvalContext } from '../recompute/types';
import type { SketchOutputData } from './sketch';
import { length, sub, unit } from './vec';

/** A plane with a place to draw it: its frame (`faceSketchFrame`) and a point of it near what it came from. */
export interface PlaneOf {
  frame: SketchFrame;
  anchor: Vec3;
}

/** A line in space: a point on it and its unit direction. */
export interface LineOf {
  origin: Vec3;
  direction: Vec3;
}

/** The construction report of a feature a reference names, or `undefined` if it names none. */
function constructionOf(
  ctx: Pick<EvalContext, 'output'>,
  ref: GeomRef,
  kind: ConstructionReport['kind'],
  label: string,
): ConstructionReport | undefined {
  let data: unknown;
  try {
    data = ctx.output(ref.id as FeatureId).data;
  } catch {
    // Not one of this feature's dependencies: no such feature (or not before it).
    return undefined;
  }
  const report = data as ConstructionReport | undefined;
  if (!report || report.kind !== kind) {
    throw new KernelError(`${label} isn't a ${kind} any more. Pick another.`);
  }
  return report;
}

/**
 * The plane a `plane` or flat `face` reference names: an origin plane's
 * frame, a construction plane's, or a face's (as a sketch on it gets it).
 * `label` says what it is for in messages ("the plane the box sits on").
 */
export function planeOf(
  ctx: EvalContext,
  ref: GeomRef,
  label: string,
  /** The message when the plane can't be found (default: "Can't find <label>. Pick it again."). */
  lost?: string,
): PlaneOf {
  if (ref.kind === 'face') {
    const hit = ctx.resolve(ref, { label });
    // A mesh body's one face is its whole surface of triangles, not a flat
    // face to sit something on (ADR-0066 §3).
    if (ctx.kernel.isMesh(hit.shape)) throw new MeshBodyError(meshBodyMessage(capitalize(label)));
    const face = ctx.describe(hit.shape).faces[hit.index];
    if (face?.type !== 'plane' || !face.direction) {
      throw new KernelError(`${capitalize(label)} isn't flat. Pick a flat face or a plane.`);
    }
    return { frame: faceSketchFrame(face.centroid, face.direction), anchor: face.centroid };
  }
  const origin = ref.kind === 'plane' ? originPlane(ref.id) : undefined;
  if (origin) return { frame: origin.frame, anchor: [0, 0, 0] };
  const report =
    ref.kind === 'plane' ? constructionOf(ctx, ref, 'plane', capitalize(label)) : undefined;
  if (report?.kind === 'plane') return { frame: report.frame, anchor: report.anchor };
  throw new LostReferenceError(lost ?? `Can't find ${label}. Pick it again.`, ref);
}

/**
 * The line a `axis` reference names (an origin axis or a construction axis),
 * a straight `edge` (its middle and direction) or a sketch line (`<sketch>/<line>`).
 */
export function lineOf(ctx: EvalContext, ref: GeomRef, label: string): LineOf {
  switch (ref.kind) {
    case 'axis': {
      const origin = originAxis(ref.id);
      if (origin) return { origin: origin.origin, direction: origin.direction };
      const report = constructionOf(ctx, ref, 'axis', capitalize(label));
      if (report?.kind === 'axis') return { origin: report.origin, direction: report.direction };
      throw new LostReferenceError(`Can't find ${label}. Pick it again.`, ref);
    }
    case 'sketchEntity':
      return sketchLine(ctx, ref, label);
    case 'edge': {
      const hit = ctx.resolve(ref, { label });
      const edge = ctx.describe(hit.shape).edges[hit.index];
      if (hit.kind !== 'edge' || edge?.type !== 'line' || !edge.direction) {
        throw new KernelError(
          `${capitalize(label)} isn't straight. Pick a straight edge, a sketch line or an axis.`,
        );
      }
      return { origin: edge.midpoint, direction: unit(edge.direction) };
    }
    default:
      throw new KernelError(`Pick a sketch line, a straight edge or an axis for ${label}.`);
  }
}

function sketchLine(ctx: EvalContext, ref: GeomRef, label: string): LineOf {
  const parsed = parseSketchEntityRefId(ref.id);
  if (!parsed) throw new KernelError(`${capitalize(label)} isn't a sketch line. Pick it again.`);
  let data: Partial<SketchOutputData> | undefined;
  try {
    data = ctx.output(parsed.feature as FeatureId).data as Partial<SketchOutputData> | undefined;
  } catch {
    data = undefined;
  }
  const line = data?.lines?.[parsed.entity];
  if (!data?.frame || !line) {
    throw new LostReferenceError(
      `Can't find ${label} any more: an earlier change to its sketch removed it. Pick another.`,
      ref,
    );
  }
  const a = sketchToWorld(data.frame, line[0]);
  const b = sketchToWorld(data.frame, line[1]);
  const along = sub(b, a);
  if (length(along) <= 1e-9) throw new KernelError(`${capitalize(label)} has no length.`);
  return { origin: a, direction: unit(along) };
}

/** A construction point's place, or a body vertex's. */
export function pointOf(ctx: EvalContext, ref: GeomRef, label: string): Vec3 {
  if (ref.kind === 'vertex') {
    const hit = ctx.resolve(ref, { label });
    const vertex = ctx.describe(hit.shape).vertices[hit.index];
    if (!vertex) throw new KernelError(`Can't find ${label}. Pick it again.`);
    return vertex.point;
  }
  if (ref.kind === 'point') {
    const report = constructionOf(ctx, ref, 'point', capitalize(label));
    if (report?.kind === 'point') return report.point;
  }
  throw new LostReferenceError(`Can't find ${label}. Pick it again.`, ref);
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
