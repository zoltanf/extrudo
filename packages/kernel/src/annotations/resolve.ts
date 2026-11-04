/**
 * Annotations at the marker (P6-23, ADR-0126 §4): where each `model`
 * annotation is drawn after a recompute. The engine runs `resolveAnnotation`
 * for each one in a context at the marker, as it does a joint's frames, so the
 * reference resolves through the same naming service: exact name (`ok`),
 * related name or fingerprint (`moved`), else `detached`.
 *
 * The drawn point follows the geometry: `anchor.at` shifted by how far the
 * reference's own point moved since the annotation was made (its stored
 * fingerprint's `at` → the point now), the vertex or point itself for a vertex
 * or point. Nothing here is cached: a resolve and a description per annotation.
 */
import {
  type Annotation,
  type AnnotationReport,
  annotationEntityPoint,
  type BodyId,
  type FeatureId,
  type GeomFingerprint,
  type GeomRef,
  parseSketchEntityRefId,
  sketchToWorld,
} from '@extrudo/core';
import { lineOf, planeOf, pointOf } from '../features/references';
import type { SketchOutputData } from '../features/sketch';
import { add, scale, sub } from '../features/vec';
import { KernelError, type Vec3 } from '../kernel';
import { fingerprintOf } from '../naming/fingerprint';
import type { EvalContext } from '../recompute/types';

/** What resolving an annotation needs of an evaluator's context. */
export type AnnotationContext = Pick<
  EvalContext,
  'kernel' | 'resolve' | 'describe' | 'output' | 'bodies' | 'names'
>;

const round = (x: number) => Math.round(x * 1e6) / 1e6 || 0;
const roundVec = (v: Vec3): [number, number, number] => [round(v[0]), round(v[1]), round(v[2])];

/** What a reference is now: its name, fingerprint and body, and whether the name matched exactly. */
interface Found {
  ref: GeomRef;
  fingerprint: GeomFingerprint;
  body?: BodyId;
  exact: boolean;
  normal?: Vec3;
  /** A vertex or point: drawn where it is, whatever `anchor.at` says. */
  pinned?: boolean;
}

/** A body's point: its faces' centroids weighted by their area. */
function bodyCentre(ctx: AnnotationContext, body: BodyId): Vec3 | undefined {
  const shape = ctx.bodies.get(body);
  if (shape === undefined) return undefined;
  let area = 0;
  let sum: Vec3 = [0, 0, 0];
  for (const face of ctx.describe(shape).faces) {
    area += face.area;
    sum = add(sum, scale(face.centroid, face.area));
  }
  return area > 0 ? scale(sum, 1 / area) : undefined;
}

function find(ctx: AnnotationContext, ref: GeomRef): Found | undefined {
  const label = 'the annotated geometry';
  switch (ref.kind) {
    case 'face':
    case 'edge':
    case 'vertex': {
      const hit = ctx.resolve(ref, { label });
      const fingerprint = fingerprintOf(
        ctx.describe(hit.shape),
        ctx.names(hit.body),
        hit.kind,
        hit.index,
      );
      const face = hit.kind === 'face' ? ctx.describe(hit.shape).faces[hit.index] : undefined;
      return {
        ref: { kind: hit.kind, id: hit.id },
        fingerprint,
        body: hit.body,
        exact: hit.via === 'name' && hit.warning === undefined,
        ...(face?.type === 'plane' && face.direction && { normal: face.direction }),
        ...(hit.kind === 'vertex' && { pinned: true }),
      };
    }
    case 'body': {
      const body = ref.id as BodyId;
      const centre = bodyCentre(ctx, body);
      if (!centre) return undefined;
      return { ref, fingerprint: { type: 'body', at: roundVec(centre) }, body, exact: true };
    }
    case 'plane': {
      const { frame, anchor } = planeOf(ctx, ref, label);
      return {
        ref,
        fingerprint: { type: 'plane', at: roundVec(anchor), dir: roundVec(frame.normal) },
        exact: true,
        normal: frame.normal,
      };
    }
    case 'axis': {
      const line = lineOf(ctx, ref, label);
      return {
        ref,
        fingerprint: { type: 'axis', at: roundVec(line.origin), dir: roundVec(line.direction) },
        exact: true,
      };
    }
    case 'point':
      return {
        ref,
        fingerprint: { type: 'point', at: roundVec(pointOf(ctx, ref, label)) },
        exact: true,
        pinned: true,
      };
    case 'sketchEntity': {
      const parsed = parseSketchEntityRefId(ref.id);
      if (!parsed) return undefined;
      let data: Partial<SketchOutputData> | undefined;
      try {
        data = ctx.output(parsed.feature as FeatureId).data as Partial<SketchOutputData>;
      } catch {
        return undefined;
      }
      const point = data?.sketch && annotationEntityPoint(data.sketch, parsed.entity);
      if (!data?.frame || !point) return undefined;
      const type = data.sketch?.entities[parsed.entity]?.type ?? 'point';
      return {
        ref,
        fingerprint: { type, at: roundVec(sketchToWorld(data.frame, point)) },
        exact: true,
        ...(type === 'point' && { pinned: true }),
      };
    }
    default:
      return undefined;
  }
}

/**
 * Where a `model` annotation is at the marker. `detached` when its reference
 * resolves to nothing there; any other anchor kind is the app's to place.
 */
export function resolveAnnotation(
  ctx: AnnotationContext,
  annotation: Annotation,
): AnnotationReport {
  const { id, anchor } = annotation;
  if (anchor.kind !== 'model') return { id, status: 'ok' };
  let found: Found | undefined;
  try {
    found = find(ctx, anchor.ref);
  } catch (error) {
    if (!(error instanceof KernelError)) throw error;
    found = undefined;
  }
  if (!found) return { id, status: 'detached' };
  const stored = anchor.ref.fingerprint?.at;
  const now = found.fingerprint.at;
  const at: Vec3 = found.pinned
    ? [...now]
    : stored
      ? add(anchor.at as Vec3, sub(now, stored))
      : [...anchor.at];
  return {
    id,
    status: found.exact ? 'ok' : 'moved',
    at: roundVec(at),
    ...(found.normal && { normal: roundVec(found.normal) }),
    resolved: {
      ref: { ...found.ref, fingerprint: found.fingerprint },
      ...(found.body !== undefined && { body: found.body }),
    },
  };
}
