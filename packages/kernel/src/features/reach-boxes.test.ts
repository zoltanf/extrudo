// The box questions of ADR-0024's rule B against the plain loops they stand for, on fixed box sets
// (no kernel): `bodiesBox` (six reaches along the axes from the origin) against every body's
// minimum and maximum, `farOver` against the farther of each box's lowest and highest corners.
import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../kernel';
import type { EvalContext } from '../recompute/types';
import { bodiesBox } from './extrude';
import { type Box, farOver } from './operation';
import { corners, length, sub } from './vec';

const SETS: Record<string, Box[]> = {
  'no bodies': [],
  'one body': [{ min: [-3, 2, 0], max: [4, 5, 7] }],
  'wholly on one side of the origin each way': [
    { min: [5, -9, 6], max: [6, -7, 8] },
    { min: [7, -4, 5], max: [9, -2, 6] },
  ],
  'round the origin': [
    { min: [-40, -5, 0], max: [-30, 5, 10] },
    { min: [-5, -5, -2], max: [5, 5, 10] },
    { min: [15, 10, 0], max: [25, 20, 30] },
  ],
};

/** A context whose bodies are `boxes`, measured as they are, with no engine questions. */
const contextOf = (boxes: Box[]) =>
  ({
    bodies: new Map(boxes.map((box, i) => [`b${i}:0`, box])),
    kernel: { measureBox: (box: Box) => box },
  }) as unknown as EvalContext<never>;

describe('the box questions against the plain loops (ADR-0024, rule B)', () => {
  it.each(Object.entries(SETS))('bodiesBox: %s', (_, boxes) => {
    const box = bodiesBox(contextOf(boxes));
    if (boxes.length === 0) {
      expect(box).toBeUndefined();
      return;
    }
    const lo = [0, 1, 2].map((k) => Math.min(...boxes.map((b) => b.min[k] as number)));
    const hi = [0, 1, 2].map((k) => Math.max(...boxes.map((b) => b.max[k] as number)));
    // `+ 0` makes a -0 a 0: a box starting at 0 comes back as -(-0).
    expect(box?.min.map((x) => x + 0)).toEqual(lo);
    expect(box?.max).toEqual(hi);
  });

  it.each(Object.entries(SETS))('farOver: %s', (_, boxes) => {
    const from: Vec3 = [1, -2, 3];
    const far = farOver(
      boxes.map((b) => corners(b.min as Vec3, b.max as Vec3)),
      from,
    );
    if (boxes.length === 0) {
      expect(far).toBeUndefined();
      return;
    }
    let plain = Number.NEGATIVE_INFINITY;
    for (const b of boxes) {
      plain = Math.max(plain, length(sub(b.max as Vec3, from)), length(sub(b.min as Vec3, from)));
    }
    expect(far).toBe(plain);
  });
});
