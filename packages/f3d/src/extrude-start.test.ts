/**
 * An extrude's start plane read from its references (`startPlane`): a
 * geometry operand that holds an origin or construction plane in model
 * space, on a hand-built segment.
 */
import { describe, expect, it } from 'vitest';
import { MODEL_PLANE } from './decode/hole';
import { GEOMETRY_OPERAND } from './decode/revolve';
import { Bytes, segment } from './decode/test-segment';
import { startPlane } from './model';

/** Three bytes, then origin, x and y (9 f64), as `readModelPlane` reads them. */
function planeBody(origin: number[], x: number[], y: number[]): number[] {
  const f = new DataView(new ArrayBuffer(72));
  for (const [i, v] of [...origin, ...x, ...y].entries()) f.setFloat64(8 * i, v, true);
  return [0, 0, 0, ...new Uint8Array(f.buffer)];
}

const withPlane = (x: number[], y: number[]) =>
  segment([
    { guid: GEOMETRY_OPERAND, id: 1, body: new Bytes().ref(2).out },
    { guid: MODEL_PLANE, id: 2, body: planeBody([6.8, 0.2, 9.8], x, y) },
  ]);

describe('startPlane', () => {
  it('reads the plane a geometry operand holds as a face with no tags, normal x × y', () => {
    const face = startPlane(withPlane([-1, 0, 0], [0, 0, 1]), [1]);
    expect(face?.tags).toEqual([]);
    const surface = face?.surface as { kind: string; point: number[]; normal: number[] };
    expect(surface.kind).toBe('plane');
    expect(surface.point).toEqual([6.8, 0.2, 9.8]);
    // + 0: −0 is 0 here.
    expect(surface.normal.map((v) => v + 0)).toEqual([0, 1, 0]);
  });

  it('reads no plane where its axes span none, or where no operand holds one', () => {
    expect(startPlane(withPlane([1, 0, 0], [2, 0, 0]), [1])).toBeUndefined();
    expect(startPlane(withPlane([-1, 0, 0], [0, 0, 1]), [2])).toBeUndefined();
  });
});
