// How long a joint's clearance check takes (P6-05 J3, ADR-0081 §4's budget:
// a print-in-place hinge of about 100 faces a side, a whole turn, under 2 s).
// Only with `BENCH=1` (`BENCH=1 pnpm vitest run
// packages/kernel/src/joints/check-bench`), like the kernel's other benchmarks.
import type { BodyId, JointReport } from '@extrudo/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { kernelFeatures } from '../features';
import { Kernel, type ShapeHandle } from '../kernel';
import { loadOcct } from '../occt/load';
import { RecomputeEngine } from '../recompute/engine';
import type { RecomputeResult } from '../recompute/types';
import { type BodyShapes, checkJoint } from './check';
import { HINGE, hingeDocument } from './testing';

const env =
  (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const BENCH = env.BENCH === '1';

let kernel: Kernel;
let engine: RecomputeEngine;

beforeAll(async () => {
  kernel = new Kernel(await loadOcct());
  engine = new RecomputeEngine(kernel, kernelFeatures(), { strictLeaks: true });
});

afterAll(() => {
  engine.clear();
  expect(kernel.stats().liveShapes).toBe(0);
});

const LEAF = 'LeafPlate:0' as BodyId;
const BASE = 'BasePlate:0' as BodyId;
const go = async () => true;

/** The median of `runs` timings of `task`, ms. */
async function time(task: () => Promise<unknown>, runs = 3): Promise<number> {
  const times: number[] = [];
  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    await task();
    times.push(performance.now() - start);
  }
  return times.sort((a, b) => a - b)[Math.floor(runs / 2)] as number;
}

describe.skipIf(!BENCH)('the clearance check (BENCH=1)', { timeout: 300_000 }, () => {
  it('the hinge fixture and a hinge of about 100 faces a side, a whole turn', async () => {
    const result = (await engine.recompute({ doc: hingeDocument() })) as Extract<
      RecomputeResult,
      { status: 'done' }
    >;
    const report = result.joints?.[HINGE.id] as JointReport;
    const leaf = engine.latestBody(LEAF) as ShapeHandle;
    const base = engine.latestBody(BASE) as ShapeHandle;
    const turn = { min: -180, max: 180 };
    const check = (bodies: BodyShapes) =>
      checkJoint(
        kernel,
        bodies,
        report,
        { joint: HINGE, moving: [LEAF], others: [BASE], range: turn, minGap: 0.2 },
        go,
      );
    const plain = new Map([
      [LEAF, leaf],
      [BASE, base],
    ]);
    const fixture = await time(() => check(plain));
    const samples = (await check(plain)).samples;

    // Each plate with 22 ribs across its top, fused: about 130 faces a side,
    // flat faces and edges as a printed hinge has them.
    const ribbed = (shape: ShapeHandle, y0: number) => {
      using scope = kernel.scope();
      const ribs = [];
      for (let i = 0; i < 22; i++) {
        ribs.push(scope.track(kernel.box([0.8, 20, 1], [-19.5 + i * 1.8, y0, 4])));
      }
      const tool = scope.track(kernel.compound(ribs));
      return kernel.fuse(shape, tool).shape;
    };
    const busyLeaf = ribbed(leaf, 5.5);
    const busyBase = ribbed(base, -25.5);
    try {
      const faces = [kernel.count(busyLeaf, 'face'), kernel.count(busyBase, 'face')];
      const busy = new Map([
        [LEAF, busyLeaf],
        [BASE, busyBase],
      ]);
      const heavy = await time(() => check(busy), 1);
      const result = await check(busy);
      console.log(
        `[bench] joint check, a whole turn: hinge fixture ${fixture.toFixed(0)} ms (${samples} poses); ` +
          `${faces.join(' + ')} faces ${heavy.toFixed(0)} ms (${result.samples} poses)`,
      );
      expect(result.collisions.length).toBeGreaterThan(0);
    } finally {
      kernel.release(busyLeaf, busyBase);
    }
  });
});
