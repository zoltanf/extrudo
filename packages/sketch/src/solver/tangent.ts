import type { SketchData } from '@extrudo/core';
import { mapSketch } from './mapping';

const PROBE = '#tangent-probe';

/**
 * The `reversed` flag to store on a new tangent between curves `a` and `b`
 * (P1-06 sets it when the constraint is created): true if their directions
 * point opposite ways where they meet, false if the same way, undefined if
 * they don't meet at an endpoint (no joint, so no side to keep). Reads the
 * current geometry the same way the solver does.
 */
export function tangentReversed(sketch: SketchData, a: string, b: string): boolean | undefined {
  const probe = {
    ...sketch,
    constraints: { ...sketch.constraints, [PROBE]: { type: 'tangent', a, b } },
  } as SketchData;
  const item = mapSketch(probe).items.find((i) => i.id === PROBE);
  const prim = item?.prims[0];
  return prim?.type === 'angle_via_point' ? prim.angle === Math.PI : undefined;
}
