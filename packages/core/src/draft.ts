/**
 * The Draft feature (P3-08, FR-FT-12): tilts faces of a body by an angle,
 * so a part comes out of a mould (or off a print bed) cleanly. The faces
 * turn about the line where each meets the **neutral plane** (an origin
 * plane, a construction plane, or a flat face's plane), which stays fixed;
 * the plane's normal is the **pull direction** (`flip` reverses it). A
 * positive angle narrows the body along the pull (matter goes on the pull
 * side of the plane and comes on the other), a negative one widens it. Only
 * flat, cylindrical and conical faces can be tilted: flat faces stay flat,
 * cylinders become cones. Faces that run smoothly into a picked face tilt
 * with it.
 *
 * The kernel adds its evaluator and the web app its dialog, each in its own
 * registry keyed by `DRAFT_TYPE` (ADR-0003). Inputs are plain `ref`, `expr`
 * and `bool` inputs, so the document schema doesn't change.
 */
import { exprOf, refsOf } from './feature-inputs';
import type { FeatureDefinition } from './features';
import { PLACEMENT_KINDS } from './primitives';
import { BoolInputSchema, type ExprInput, type GeomRef, type RefInput } from './schema';
import { z } from './zod';

export const DRAFT_TYPE = 'draft';

/** What a draft tilts: faces of bodies. */
export const DRAFT_FACE_KINDS = ['face'] as const;

/** The neutral plane: an origin or construction plane, or a flat face. */
export const DRAFT_PLANE_KINDS = PLACEMENT_KINDS;

export const DraftInputsSchema = z.strictObject({
  /** The faces to tilt. Empty: an error until one is picked. */
  faces: refsOf(DRAFT_FACE_KINDS),
  /** The neutral plane, whose normal is the pull direction. Empty: an error until one is picked. */
  plane: refsOf(DRAFT_PLANE_KINDS, 1),
  /** The draft angle (positive narrows the body along the pull; 0 is refused by the kernel). */
  angle: exprOf('angle'),
  /** Pull the other way (against the plane's normal). Default false. */
  flip: BoolInputSchema.optional(),
});
export type DraftInputs = z.infer<typeof DraftInputsSchema>;

export const draftFeature: FeatureDefinition<DraftInputs> = {
  type: DRAFT_TYPE,
  label: 'Draft',
  category: 'modify',
  icon: 'draft',
  inputsSchema: DraftInputsSchema,
};

/** A draft's references with the plain reading of its inputs. */
export interface DraftSettings {
  /** Face references, each once. */
  faces: GeomRef[];
  plane: GeomRef | undefined;
  flip: boolean;
}

/** Reads a draft's (valid) inputs with their defaults. */
export function draftSettings(inputs: DraftInputs): DraftSettings {
  const seen = new Set<string>();
  return {
    faces: inputs.faces.refs.filter((ref) => !seen.has(ref.id) && seen.add(ref.id)),
    plane: inputs.plane.refs[0],
    flip: inputs.flip?.value ?? false,
  };
}

/**
 * A draft's inputs from plain values (tests, scripts; the dialog builds the
 * same shape). `angle` is an expression: `'3 deg'`, `'draft'`.
 */
export function draftInputs(
  faces: readonly GeomRef[],
  plane: GeomRef | undefined,
  angle: string,
  flip?: boolean,
): DraftInputs {
  const refs: RefInput = { kind: 'ref', refs: [...faces] };
  const expr: ExprInput = { kind: 'expr', expr: angle, unit: 'angle' };
  const inputs: DraftInputs = {
    faces: refs,
    plane: { kind: 'ref', refs: plane ? [plane] : [] },
    angle: expr,
  };
  if (flip !== undefined) inputs.flip = { kind: 'bool', value: flip };
  return inputs;
}
