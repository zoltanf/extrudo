/**
 * Place on Bed in the kernel (P3-10, ADR-0048, FR-3DP-04): the body a flat
 * face belongs to is turned so the face lies on the XY plane, facing down at
 * z = 0, by one `Kernel.transform` (the same call and the same naming as a
 * Move, ADR-0044: every face keeps its name). The turn is worked out from
 * where the face is on each recompute, so the feature follows the body when
 * an earlier feature changes it. With several faces (P3-17) every body lies
 * on its own face where it is, and an optional spin turns each about the
 * vertical through its face's centre. With `carry` (ADR-0081 §3) other
 * bodies take the same turn and drop as the face's own body, so a component
 * is placed as one: one face only, and the face's own body may not be
 * carried.
 */
import { type BodyId, type PlaceOnBedInputs, placeOnBedFeature } from '@extrudo/core';
import { KernelError, MeshBodyError, meshBodyMessage } from '../kernel';
import type { EvalContext, FeatureOutput, KernelFeatureDefinition } from '../recompute/types';
import { compose, faceDown, type Matrix12, rotation } from './matrix';
import { existing, isIdentity, transformBodies, withImages } from './transform';

/** How far a body may reach below the bed before Place on Bed says so (mm). */
const BELOW = 1e-4;

const RADIANS = Math.PI / 180;

export const kernelPlaceOnBed: KernelFeatureDefinition<PlaceOnBedInputs> = {
  ...placeOnBedFeature,
  bodyAccess: () => 'write',
  evaluate: evaluatePlaceOnBed,
};

function evaluatePlaceOnBed(ctx: EvalContext<PlaceOnBedInputs>): FeatureOutput {
  const refs = ctx.inputs.face.refs;
  if (refs.length === 0) throw new KernelError('Pick the flat face that goes down onto the bed.');
  const carryRefs = ctx.inputs.carry?.refs ?? [];
  if (carryRefs.length > 0 && refs.length !== 1) {
    throw new KernelError('Pick one face to carry other bodies with it.');
  }
  const several = refs.length > 1;
  const spin = ctx.inputs.spin ? ctx.value('spin') * RADIANS : 0;

  // One matrix per body: the face it lies on, then the spin about the vertical.
  const bodies: BodyId[] = [];
  const matrices: Matrix12[] = [];
  let already = 0;
  for (const [i, ref] of refs.entries()) {
    const label = several ? `face ${i + 1} to put on the bed` : 'the face to put on the bed';
    const hit = ctx.resolve(ref, { label });
    if (bodies.includes(hit.body)) {
      throw new KernelError(
        'Two of the faces belong to the same body, and a body lies on one face. Pick one face per body.',
      );
    }
    // A mesh body's one face is all its triangles, so there is no flat face
    // to lay down (ADR-0066 §3).
    if (ctx.kernel.isMesh(hit.shape)) throw new MeshBodyError(meshBodyMessage('Place on Bed'));
    const face = ctx.describe(hit.shape).faces[hit.index];
    if (face?.type !== 'plane' || !face.direction) {
      throw new KernelError(
        several
          ? `Face ${i + 1} isn't flat, so it can't lie on the bed. Pick flat faces.`
          : "That face isn't flat, so it can't lie on the bed. Pick a flat face.",
      );
    }
    const down = faceDown(face.direction, face.centroid);
    if (isIdentity(down)) already++;
    bodies.push(hit.body);
    // The face's centre stays over itself: the spin is about the vertical through it.
    matrices.push(
      spin === 0
        ? down
        : compose(rotation([face.centroid[0], face.centroid[1], 0], [0, 0, 1], spin), down),
    );
  }
  if (spin === 0 && already === refs.length) {
    ctx.warn(
      several
        ? 'The faces are already on the bed: nothing moves.'
        : 'The face is already on the bed: nothing moves.',
    );
  }

  // Carried bodies take the face's own turn and drop (ADR-0081 §3): a whole
  // component is placed as one. Only reachable with a single face.
  if (carryRefs.length > 0) {
    const owned = new Set(bodies);
    for (const body of existing(ctx, carryRefs, 'carry along')) {
      if (owned.has(body)) {
        throw new KernelError("The face's own body moves anyway: leave it out of Carry along.");
      }
      bodies.push(body);
      matrices.push(matrices[0] as Matrix12);
    }
  }

  using scope = ctx.kernel.scope();
  const images = bodies.flatMap((body, i) =>
    transformBodies(ctx, scope, [body], matrices[i] as Matrix12, false, 'placeOnBed'),
  );
  let lowest = 0;
  for (const image of images) {
    lowest = Math.min(lowest, ctx.kernel.properties(image.named.shape).bbox.min[2]);
  }
  if (lowest < -BELOW) {
    ctx.warn(
      `Part of ${several ? 'a body' : 'the body'} reaches ${Math.round(-lowest * 100) / 100} mm below the bed: the face isn't its lowest point.`,
    );
  }
  return withImages(ctx, scope, images);
}
