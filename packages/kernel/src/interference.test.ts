import type { BodyId } from '@extrudo/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { interferences } from './interference';
import { Kernel } from './kernel';
import { loadOcct } from './occt/load';

let kernel: Kernel;
beforeAll(async () => {
  kernel = new Kernel(await loadOcct());
});
afterAll(() => kernel.dispose());

const id = (s: string) => s as BodyId;

describe('interferences (#89)', () => {
  it('finds the volume two cubes share, and nothing where they only touch', () => {
    const a = kernel.box([20, 20, 20]);
    const b = kernel.box([20, 20, 20], [10, 0, 0]);
    const c = kernel.box([20, 20, 20], [30, 0, 0]);
    const far = kernel.box([5, 5, 5], [100, 100, 100]);
    const before = kernel.stats().liveShapes;
    const found = interferences(kernel, [
      { id: id('a'), shape: a },
      { id: id('b'), shape: b },
      { id: id('c'), shape: c },
      { id: id('far'), shape: far },
    ]);
    // a and b share 10 × 20 × 20; b and c only touch at x = 30; far meets nothing.
    expect(found.map((f) => [f.a, f.b, Math.round(f.volume)])).toEqual([['a', 'b', 4000]]);
    expect(found[0]?.box.min.map((v) => Math.round(v) + 0)).toEqual([10, 0, 0]);
    expect(found[0]?.box.max.map((v) => Math.round(v) + 0)).toEqual([20, 20, 20]);
    expect(kernel.stats().liveShapes).toBe(before);
    kernel.release(a, b, c, far);
  });
});
