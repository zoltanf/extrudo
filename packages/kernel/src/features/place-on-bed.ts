/**
 * Place on Bed in the kernel (P3-10, ADR-0048, FR-3DP-04): the body a flat
 * face belongs to is turned so the face lies on the XY plane, facing down at
 * z = 0, by one `Kernel.transform` (the same call and the same naming as a
 * Move, ADR-0044: every face keeps its name). The turn is worked out from
 * where the face is on each recompute, so the feature follows the body when
 * an earlier feature changes it.
 */
import { type PlaceOnBedInputs, placeOnBedFeature, type Vec3 } from '@extrudo/core';
import { KernelError } from '../kernel';
import type { EvalContext, FeatureOutput, KernelFeatureDefinition } from '../recompute/types';
import { faceDown } from './matrix';
import { isIdentity, transformBodies, withImages } from './transform';

/** How far a body may reach below the bed before Place on Bed says so (mm). */
const BELOW = 1e-4;

export const kernelPlaceOnBed: KernelFeatureDefinition<PlaceOnBedInputs> = {
  ...placeOnBedFeature,
  bodyAccess: () => 'write',
  evaluate: evaluatePlaceOnBed,
};

function evaluatePlaceOnBed(ctx: EvalContext<PlaceOnBedInputs>): FeatureOutput {
  const ref = ctx.inputs.face.refs[0];
  if (!ref) throw new KernelError('Pick the flat face that goes down onto the bed.');
  const hit = ctx.resolve(ref, { label: 'the face to put on the bed' });
  const face = ctx.describe(hit.shape).faces[hit.index];
  if (face?.type !== 'plane' || !face.direction) {
    throw new KernelError("That face isn't flat, so it can't lie on the bed. Pick a flat face.");
  }
  const normal: Vec3 = face.direction;
  const matrix = faceDown(normal, face.centroid);
  if (isIdentity(matrix)) ctx.warn('The face is already on the bed: nothing moves.');
  using scope = ctx.kernel.scope();
  const images = transformBodies(ctx, scope, [hit.body], matrix, false, 'placeOnBed');
  const image = images[0];
  if (image) {
    const low = ctx.kernel.properties(image.named.shape).bbox.min[2];
    if (low < -BELOW) {
      ctx.warn(
        `Part of the body reaches ${Math.round(-low * 100) / 100} mm below the bed: the face isn't its lowest point.`,
      );
    }
  }
  return withImages(ctx, scope, images);
}
