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
  /**
   * Bodies that take the same turn and drop as the face's own body, so a
   * component is placed as one (ADR-0081 §3). Only with a single face; a
   * carried body that also owns a face is an error.
   */
  carry: refsOf(['body'])
    .optional()
    .describe(
      "Bodies that take the same turn and drop as the face's body (a component placed as one). Only with one face.",
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
 * builds the same shape), an optional spin angle expression, and the bodies
 * that are carried along with the face's own (ADR-0081 §3).
 */
export function placeOnBedInputs(
  faces: GeomRef | readonly GeomRef[],
  spin?: string,
  carry?: readonly GeomRef[],
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
  if (carry !== undefined && carry.length > 0) {
    const refs: RefInput = { kind: 'ref', refs: [...carry] };
    inputs.carry = refs;
  }
  return inputs;
}
