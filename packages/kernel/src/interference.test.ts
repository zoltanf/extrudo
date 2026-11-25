import {
  type BodyId,
  createDocument,
  type ExtrudoDocument,
  originPlaneRef,
  primitiveInputs,
} from '@extrudo/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { kernelFeatures } from './features/index';
import { interferences } from './interference';
import { Kernel } from './kernel';
import { loadOcct } from './occt/load';
import { RecomputeEngine } from './recompute/engine';

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

  it("gives the shared volume's exact box, not measure's loose one (ADR-0035, 2026-11-24)", async () => {
    // A torus (outer radius 25, tube radius 5, about Y) inside a box: they share the torus.
    // `measure`'s box of a torus reaches ±27.06; the box shown is the exact ±25.
    const doc = {
      ...createDocument({ name: 'torus' }),
      features: [
        {
          id: 'P',
          type: 'torus',
          name: 'Torus',
          suppressed: false,
          inputs: primitiveInputs('torus', {
            numbers: { diameter: '40 mm', tube: '10 mm' },
            plane: originPlaneRef('origin:xz'),
          }),
        },
      ],
      timelineMarker: 1,
    } as ExtrudoDocument;
    const engine = new RecomputeEngine(kernel, kernelFeatures(), {});
    try {
      await engine.recompute({ doc });
      const torus = engine.latestBody('P:0' as BodyId);
      if (torus === undefined) throw new Error('no torus');
      const box = kernel.box([60, 20, 60], [-30, -10, -30]);
      const [found] = interferences(kernel, [
        { id: 't' as BodyId, shape: torus },
        { id: 'b' as BodyId, shape: box },
      ]);
      const round = (v: number) => Math.round(v * 1e6) / 1e6 + 0;
      expect([...(found?.box.min ?? []), ...(found?.box.max ?? [])].map(round)).toEqual([
        -25, -5, -25, 25, 5, 25,
      ]);
      kernel.release(box);
    } finally {
      engine.clear();
    }
  });
});
