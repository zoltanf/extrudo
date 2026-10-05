/**
 * The Place on Bed feature (P3-10, ADR-0048, FR-3DP-04): turns the body a
 * flat face belongs to so that the face lies on the build plate, the XY
 * plane, facing down, with the face at z = 0. It takes one input, the face,
 * and works the body out from it, so it keeps working when the body
 * changes: the rotation and the move are computed by the kernel on every
 * recompute from where the face is then (ADR-0048 explains why this is not a
 * stored matrix and not a mode of `move`).
 *
 * The kernel adds its evaluator and the web app its dialog, each in its own
 * registry keyed by `PLACE_ON_BED_TYPE` (ADR-0003).
 */

import { exprOf, refsOf } from './feature-inputs';
import type { FeatureDefinition } from './features';
import type { ExprInput, GeomRef, RefInput } from './schema';
import { z } from './zod';

export const PLACE_ON_BED_TYPE = 'placeOnBed';

export const PlaceOnBedInputsSchema = z.strictObject({
  /**
   * The flat faces that go down, one per body (P3-17: several bodies; each
   * lies on its own face, where it is). Empty: the feature fails until one is
   * picked. Two faces of one body is an error.
   */
  face: refsOf(['face']).describe('The flat faces that go down, one per body. Required.'),
  /**
   * Turn about the vertical through the face's centre after the face lies on
   * the bed (P3-17). Absent: no turn.
   */
  spin: exprOf('angle')
    .optional()
    .describe(
      "Turn about the vertical through the face's centre once it lies on the bed; an angle. Without one, no turn.",
    ),
});
export type PlaceOnBedInputs = z.infer<typeof PlaceOnBedInputsSchema>;

export const placeOnBedFeature: FeatureDefinition<PlaceOnBedInputs> = {
  type: PLACE_ON_BED_TYPE,
  label: 'Place on Bed',
  category: 'modify',
  icon: 'place-on-bed',
  inputsSchema: PlaceOnBedInputsSchema,
};

/**
 * A Place on Bed's inputs from the face, or faces (tests, scripts; the dialog
 * builds the same shape), and an optional spin angle expression.
 */
export function placeOnBedInputs(
  faces: GeomRef | readonly GeomRef[],
  spin?: string,
): PlaceOnBedInputs {
  const input: RefInput = {
    kind: 'ref',
    refs: Array.isArray(faces) ? [...faces] : [faces as GeomRef],
  };
  const inputs: PlaceOnBedInputs = { face: input };
  if (spin !== undefined) {
    const expr: ExprInput = { kind: 'expr', expr: spin, unit: 'angle' };
    inputs.spin = expr;
  }
  return inputs;
}
