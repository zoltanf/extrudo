/**
 * The Offset Face feature (P3-08, ADR-0051, FR-FT-12): moves faces of a
 * body along their normals by a distance. The faces next to them are
 * extended or trimmed to follow, so a planar face moves like a pad growing
 * or sinking, a cylinder's wall changes its radius, a hole's wall widens or
 * narrows the hole. Positive moves a face out of the body (along its outward
 * normal: the body grows there, a hole's wall closes in), negative moves it
 * in. Faces that run smoothly into a picked face (the fillets round a pad)
 * move with it.
 *
 * The kernel adds its evaluator and the web app its dialog, each in its own
 * registry keyed by `OFFSET_FACE_TYPE` (ADR-0003). Inputs are plain `ref`
 * and `expr` inputs, so the document schema doesn't change.
 */
import { exprOf, refsOf } from './feature-inputs';
import type { FeatureDefinition } from './features';
import type { ExprInput, GeomRef, RefInput } from './schema';
import { z } from './zod';

export const OFFSET_FACE_TYPE = 'offsetFace';

/** What an offset takes: faces of bodies. */
export const OFFSET_FACE_KINDS = ['face'] as const;

export const OffsetFaceInputsSchema = z.strictObject({
  /** The faces to move, of one or several bodies. Empty: an error until one is picked. */
  faces: refsOf(OFFSET_FACE_KINDS).describe(
    'The faces to move along their outward normal. Required.',
  ),
  /** How far, along the outward normal (a length; negative goes in; 0 is refused by the kernel). */
  distance: exprOf('length').describe(
    'How far; a length. Positive grows the body outwards, negative closes it in. Required.',
  ),
});
export type OffsetFaceInputs = z.infer<typeof OffsetFaceInputsSchema>;

export const offsetFaceFeature: FeatureDefinition<OffsetFaceInputs> = {
  type: OFFSET_FACE_TYPE,
  label: 'Offset Face',
  category: 'modify',
  icon: 'offset-face',
  inputsSchema: OffsetFaceInputsSchema,
};

/** An offset's faces with the plain reading of its inputs. */
export interface OffsetFaceSettings {
  faces: GeomRef[];
}

/** Reads an offset face's (valid) inputs. */
export function offsetFaceSettings(inputs: OffsetFaceInputs): OffsetFaceSettings {
  return { faces: inputs.faces.refs };
}

/**
 * An offset face's inputs from plain values (tests, scripts; the dialog
 * builds the same shape). `distance` is an expression: `'5 mm'`, `'wall / 2'`.
 */
export function offsetFaceInputs(faces: GeomRef[], distance: string): OffsetFaceInputs {
  const refs: RefInput = { kind: 'ref', refs: faces };
  const expr: ExprInput = { kind: 'expr', expr: distance, unit: 'length' };
  return { faces: refs, distance: expr };
}
