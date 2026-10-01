/**
 * The Draft feature in the kernel (P3-08, FR-FT-12): tilts faces by an
 * angle about the line where each meets the neutral plane (an origin or
 * construction plane, or a flat face's plane); the plane's normal is the
 * pull direction, reversed by `flip`. A positive angle narrows the body
 * along the pull. Faces are resolved by name (ADR-0005), so a lost one is a
 * `LostReferenceError` (Fix References); faces of several bodies are tilted
 * body by body.
 *
 * Built by the facade's `draft` (BRepOffsetAPI_DraftAngle on a copy, the
 * result checked for faces that crossed: OCCT calls those valid). **Every
 * face keeps its name**: a tilted face is the same face, turned, so a fillet
 * after a draft finds its edges whatever the angle.
 *
 * A failure is turned into a message a person can act on (FR-UX-06): the
 * largest angle that works ("too steep for this body (max ≈ 26°)"), or
 * plain words for faces OCCT can't tilt (curved faces other than cylinders
 * and cones, faces parallel to the neutral plane, faces whose rounded
 * neighbours can't follow).
 */
import { type BodyId, type DraftInputs, draftFeature, draftSettings } from '@extrudo/core';
import {
  DraftError,
  type DraftProblem,
  KernelError,
  type OperationResult,
  type ShapeHandle,
} from '../kernel';
import type { TopoNames } from '../naming/names';
import { withHistory } from '../naming/ops';
import type { EvalContext, FeatureOutput, KernelFeatureDefinition } from '../recompute/types';
import { planeOf } from './references';
import { scale } from './vec';

const RADIANS = Math.PI / 180;

export const kernelDraft: KernelFeatureDefinition<DraftInputs> = {
  ...draftFeature,
  bodyAccess: () => 'write',
  evaluate: evaluateDraft,
};

function evaluateDraft(ctx: EvalContext<DraftInputs>): FeatureOutput {
  const { kernel } = ctx;
  const settings = draftSettings(ctx.inputs);
  if (settings.faces.length === 0) throw new KernelError('Pick the faces to draft.');
  if (!settings.plane) {
    throw new KernelError('Pick the neutral plane: the faces turn about where they meet it.');
  }
  const angle = ctx.value('angle');
  if (!Number.isFinite(angle) || Math.abs(angle) < 1e-9) {
    throw new KernelError(
      `The draft angle is ${formatAngle(angle)}, so nothing tilts. Enter an angle other than 0.`,
    );
  }
  if (Math.abs(angle) >= 89.99) {
    throw new KernelError(
      `The draft angle is ${formatAngle(angle)}. It must be less than 90°: faces tilt by a few degrees.`,
    );
  }
  const { frame } = planeOf(ctx, settings.plane, 'the neutral plane');
  const pull = settings.flip ? scale(frame.normal, -1) : frame.normal;

  // The faces to tilt, by body.
  const picked = new Map<BodyId, number[]>();
  for (const ref of settings.faces) {
    const hit = ctx.resolve(ref, { label: 'a face to draft' });
    const faces = picked.get(hit.body) ?? [];
    if (!faces.includes(hit.index)) faces.push(hit.index);
    picked.set(hit.body, faces);
  }

  using scope = kernel.scope();
  const tilted = new Map<BodyId, { shape: ShapeHandle; table: TopoNames }>();
  for (const [body, faces] of picked) {
    const shape = ctx.bodies.get(body) as ShapeHandle;
    let result: OperationResult;
    try {
      result = kernel.draft(shape, faces, { origin: frame.origin, normal: pull }, angle * RADIANS);
    } catch (error) {
      if (error instanceof DraftError) throw new KernelError(draftMessage(error, angle, faces));
      throw error;
    }
    scope.track(result.shape);
    const named = withHistory(kernel, result, [ctx.names(body)], {
      op: 'draft',
      feature: ctx.feature.id,
    });
    tilted.set(body, { shape: named.shape, table: named.names });
  }
  // Kept only when every body worked: a failure releases them all with the scope.
  const bodies = new Map(ctx.bodies);
  const names = new Map<BodyId, TopoNames>();
  for (const [body, { shape, table }] of tilted) {
    bodies.set(body, scope.keep(shape));
    names.set(body, table);
  }
  return { bodies, names };
}

// ----------------------------------------------------------------- messages

/**
 * A draft failure as a message (FR-UX-06): plain words, faces counted from
 * 1 as the app's selection lists them ("Face 3"), angles in degrees.
 */
export function draftMessage(error: DraftError, angle: number, faces: readonly number[]): string {
  const sentences = error.problems.map((problem) => problemMessage(problem, angle, faces));
  return [...new Set(sentences)].join(' ');
}

function problemMessage(problem: DraftProblem, angle: number, faces: readonly number[]): string {
  const what = faces.length === 1 ? `Face ${(faces[0] ?? 0) + 1}` : 'The faces';
  const face = (index: number) => `Face ${index + 1}`;
  switch (problem.kind) {
    case 'too-steep':
      return `${what} can't tilt by ${formatAngle(Math.abs(angle))}: that is too steep for this body (max ≈ ${formatAngle(floorTo2(problem.max))}). Try a smaller angle.`;
    case 'refused':
      return `${face(problem.face)} can't tilt about this plane: the faces around it can't follow. Rounded or chamfered edges next to it often stop this: draft before rounding the edges.`;
    case 'surface':
      return `${face(problem.face)} can't be drafted: only flat, cylindrical and conical faces tilt. Draft before rounding the edges, or pick another face.`;
    case 'parallel':
      return `${face(problem.face)} is parallel to the neutral plane, so there is no line to tilt it about. Pick the side faces, or another plane.`;
    case 'undraftable':
      return `${what} can't be drafted about this plane at any angle. Fillets and chamfers next to them often stop this: draft before rounding the edges.`;
    case 'not-solid':
      return 'Draft needs a solid body.';
    case 'other':
      return "The faces couldn't be drafted. Try a smaller angle or other faces.";
  }
}

/** Rounds down to two significant digits, so the number given still works. */
function floorTo2(value: number): number {
  if (!(value > 0)) return 0;
  const step = 10 ** (Math.floor(Math.log10(value)) - 1);
  return Math.floor(value / step + 1e-9) * step;
}

/** "3°", "2.5°", "0.25°": at most three decimals, no trailing zeros. */
function formatAngle(value: number): string {
  return `${Number.parseFloat(value.toFixed(3))}°`;
}
