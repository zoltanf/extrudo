/**
 * Where bodies overlap (#89): for every pair whose boxes meet, the volume they
 * share (`common`) and its box. A pair that only touches shares no volume and
 * isn't listed. Runs on the shapes of the last finished recompute; meshes too
 * (`common` takes a mesh pair to manifold-3d).
 */
import type { BodyId } from '@extrudo/core';
import { INTERFERENCE_VOLUME } from './joints/check';
import type { Kernel, ShapeHandle, Vec3 } from './kernel';

export interface Interference {
  a: BodyId;
  b: BodyId;
  /** mm³ */
  volume: number;
  /** mm */
  box: { min: Vec3; max: Vec3 };
}

/** Boxes that meet, with a little slack so a pair that touches still gets the exact test. */
const boxesMeet = (a: { min: Vec3; max: Vec3 }, b: { min: Vec3; max: Vec3 }) =>
  [0, 1, 2].every(
    (k) =>
      (a.min[k] as number) <= (b.max[k] as number) + 1e-6 &&
      (b.min[k] as number) <= (a.max[k] as number) + 1e-6,
  );

/** The overlapping pairs among `bodies`, in their order; `[]` when none overlap. */
export function interferences(
  kernel: Kernel,
  bodies: readonly { id: BodyId; shape: ShapeHandle }[],
): Interference[] {
  const boxes = bodies.map(({ shape }) => kernel.measure(shape).bbox);
  const found: Interference[] = [];
  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      const a = bodies[i] as (typeof bodies)[number];
      const b = bodies[j] as (typeof bodies)[number];
      if (!boxesMeet(boxes[i] as never, boxes[j] as never)) continue;
      using scope = kernel.scope();
      const common = scope.track(kernel.common(a.shape, b.shape)).shape;
      const { volume, bbox } = kernel.measure(common);
      if (volume > INTERFERENCE_VOLUME) found.push({ a: a.id, b: b.id, volume, box: bbox });
    }
  }
  return found;
}
