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
import { z } from 'zod';
import { refsOf } from './feature-inputs';
import type { FeatureDefinition } from './features';
import type { GeomRef, RefInput } from './schema';

export const PLACE_ON_BED_TYPE = 'placeOnBed';

export const PlaceOnBedInputsSchema = z.strictObject({
  /** The flat face that goes down. Empty: the feature fails until one is picked. */
  face: refsOf(['face'], 1),
});
export type PlaceOnBedInputs = z.infer<typeof PlaceOnBedInputsSchema>;

export const placeOnBedFeature: FeatureDefinition<PlaceOnBedInputs> = {
  type: PLACE_ON_BED_TYPE,
  label: 'Place on Bed',
  category: 'modify',
  icon: 'place-on-bed',
  inputsSchema: PlaceOnBedInputsSchema,
};

/** A Place on Bed's inputs from the face (tests, scripts; the dialog builds the same shape). */
export function placeOnBedInputs(face: GeomRef): PlaceOnBedInputs {
  const input: RefInput = { kind: 'ref', refs: [face] };
  return { face: input };
}
