/**
 * Sweeps that stop where they first meet an object (P4-12, ADR-0028's and
 * ADR-0029's amendments): extrude "to object" on a curved face or a body,
 * and revolve "to object". The sweep is built long (past the object
 * everywhere), then cut back: by the face's surface extended past the face
 * (`Kernel.extendFace`, then `Kernel.split`), or by the body itself (a
 * cut), and only the pieces that touch the profile stay. Whatever lies
 * past the first surface along the sweep is a piece of its own, so the
 * first hit is where it stops.
 */
import { type BodyId, type GeomRef, originPlane } from '@extrudo/core';
import {
  KernelError,
  MeshBodyError,
  meshBodyMessage,
  type ShapeHandle,
  type ShapeScope,
  type Vec3,
} from '../kernel';
import { deriveNames, namesOf, propagatedFaceNames, type TopoNames } from '../naming/names';
import type { NamedShape } from '../naming/ops';
import { LostReferenceError } from '../naming/resolve';
import { createdName } from '../naming/topo-id';
import type { EvalContext } from '../recompute/types';
import { translation } from './matrix';
import { planeOf } from './references';
import { perpendicular } from './vec';

/** How far (mm) a piece may be from the profile and still touch it. */
const TOUCH = 1e-6;

/** What a sweep is cut back by. */
export interface TrimTarget {
  /** The face's extended surface or the body (the scope owns it). */
  tool: ShapeHandle;
  /** Split by a face (`split`), or cut by a body (`cut`). */
  how: 'split' | 'cut';
  /** The object in a message: "that face", "that body", "that plane". */
  label: string;
}

/**
 * The trim target a reference names: a face's surface extended by `size`
 * mm, a body, or (`plane` refs) an origin or construction plane as a face
 * `size` mm across. `operation` words the mesh refusal ("Extrude to
 * object needs a solid body…"). Flat faces are the caller's to handle
 * first when it has an exact way.
 */
export function trimTarget(
  ctx: EvalContext,
  scope: ShapeScope,
  ref: GeomRef,
  size: number,
  operation: string,
  noun: string,
): TrimTarget {
  const { kernel } = ctx;
  switch (ref.kind) {
    case 'body': {
      const body = ctx.bodies.get(ref.id as BodyId);
      if (body === undefined) {
        throw new LostReferenceError(
          `The body to ${noun} to no longer exists: an earlier change took it away. Pick another object.`,
          ref,
        );
      }
      if (kernel.isMesh(body)) throw new MeshBodyError(meshBodyMessage(operation));
      return { tool: body, how: 'cut', label: 'that body' };
    }
    case 'face': {
      const hit = ctx.resolve(ref, { label: `the face to ${noun} to` });
      if (hit.kind !== 'face') throw new KernelError(`Pick a face to ${noun} to.`);
      if (kernel.isMesh(hit.shape)) throw new MeshBodyError(meshBodyMessage(operation));
      const tool = scope.track(kernel.extendFace(hit.shape, hit.index, size));
      return { tool, how: 'split', label: 'that face' };
    }
    case 'plane': {
      const frame =
        originPlane(ref.id)?.frame ?? planeOf(ctx, ref, `the plane to ${noun} to`).frame;
      const s = size;
      const { faces } = kernel.planarFaces(
        [
          { kind: 'line', a: [-s, -s], b: [s, -s] },
          { kind: 'line', a: [s, -s], b: [s, s] },
          { kind: 'line', a: [s, s], b: [-s, s] },
          { kind: 'line', a: [-s, s], b: [-s, -s] },
        ],
        { origin: frame.origin, x: perpendicular(frame.normal), normal: frame.normal },
        1e-7,
      );
      for (const face of faces) scope.track(face.shape);
      const face = faces[0];
      if (!face) throw new KernelError(`Couldn't ${noun} to that plane.`);
      return { tool: face.shape, how: 'split', label: 'that plane' };
    }
    default:
      throw new KernelError(`Can't ${noun} to that. Pick a face, a body or a plane.`);
  }
}

/** The target moved by `by` (mm): an offset along the sweep. */
export function movedTarget(
  ctx: EvalContext,
  scope: ShapeScope,
  target: TrimTarget,
  by: Vec3,
): TrimTarget {
  if (by[0] === 0 && by[1] === 0 && by[2] === 0) return target;
  const moved = scope.track(ctx.kernel.transform(target.tool, translation(by)));
  return { ...target, tool: moved.shape };
}

/** How the cut-back sweep is named and spoken of. */
export interface TrimNaming {
  /** The op of the names (`extrude`, `revolve`). */
  op: string;
  /** The role the faces the target makes take: `cap:end` (side 2 of an extrude: `cap:start`). */
  role: string;
  /**
   * The role the long sweep's far cap was given: if a kept piece still has
   * it, part of the profile passed the target.
   */
  far: string;
}

/**
 * The long, named sweep cut back by `target`: the pieces that touch
 * `profile` (the swept faces in their place), named through the boolean's
 * history, the target's faces as `<op>:<feature>:<role>` (`#n` for
 * several). Errors for the user when the sweep starts inside the target,
 * never meets it, or only partly does.
 */
export function trimSweep(
  ctx: EvalContext,
  scope: ShapeScope,
  sweep: NamedShape,
  target: TrimTarget,
  profile: ShapeHandle,
  naming: TrimNaming,
): NamedShape {
  const { kernel, feature } = ctx;
  const role = createdName(naming.op, feature.id, naming.role);
  const far = createdName(naming.op, feature.id, naming.far);
  // Every face of the target is the role, unnumbered: the kept piece numbers its own.
  const described = kernel.describe(target.tool);
  const toolNames: TopoNames = {
    ...deriveNames(
      described.faces.map(() => role),
      described,
    ),
    faces: described.faces.map(() => role),
  };
  const result =
    target.how === 'split'
      ? kernel.split(sweep.shape, target.tool)
      : kernel.cut(sweep.shape, target.tool);
  scope.track(result.shape);
  // Names before numbering: pieces that are dropped mustn't number the kept ones.
  const raw = propagatedFaceNames({
    op: naming.op,
    feature: feature.id,
    inputs: [sweep.names, toolNames],
    history: result.history,
    result: kernel.describe(result.shape),
  });

  const solids = kernel.solids(result.shape).map((solid) => scope.track(solid));
  const kept = solids.filter((solid) => kernel.distance(solid, profile) <= TOUCH);
  const name = feature.name;
  if (kept.length === 0) {
    throw new KernelError(
      `${name} starts inside ${target.label}: nothing is left between the profile and it. Pick an object in front of the profile.`,
    );
  }
  const piece = kept.length === 1 ? (kept[0] as ShapeHandle) : scope.track(kernel.compound(kept));
  const faces = kernel.locate(piece, result.shape, 'face').map((at) => raw[at] ?? '');
  const names = deriveNames(faces, kernel.describe(piece));
  const base = (n: string) => n.split('#')[0];
  const passes = namesOf(names, 'face').some((n) => base(n) === far);
  if (passes) {
    const met = namesOf(names, 'face').some((n) => base(n) === role);
    throw new KernelError(
      met
        ? `Part of the profile passes beside ${target.label}, so ${name} wouldn't end on it. Pick an object that covers the whole profile, or use a distance.`
        : `${name} doesn't reach ${target.label} along its direction. Pick another object, or flip the direction.`,
    );
  }
  return { shape: piece, names };
}
