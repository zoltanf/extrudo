// Measurement only: `BENCH=1 pnpm vitest run apps/web/src/sketch/autoProject-bench.test.ts`
// (see ADR-0074's Results). Measures the per-move cost of the auto-project model
// picker on the B5 fixture's bodies, which is what a drawing tool pays on every
// pointer move; over 2 ms a move the pick is coalesced to one per animation frame.
import type { BodyId, SketchFrame } from '@extrudo/core';
import { type BodyMesh, Kernel } from '@extrudo/kernel';
import { kernelFeatures, loadOcct, RecomputeEngine } from '@extrudo/kernel/node';
import { readArchive } from '@extrudo/storage';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import b5 from '../../../../fixtures/benchmarks/b5-pcb-enclosure.extrudo?url&inline';
import { memoryPreferences } from '../platform';
import type { PickScene } from '../selection/pick';
import { createViewportStore } from '../viewport/store';
import { modelSnapAt } from './autoProject';

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env;

let kernel: Kernel;
beforeAll(async () => {
  kernel = new Kernel(await loadOcct());
});
afterAll(() => kernel?.dispose());

describe.runIf(env?.BENCH)('auto-project model picker cost', () => {
  it('times modelSnapAt over the B5 bodies', { timeout: 300_000 }, async () => {
    const bytes = Uint8Array.from(atob(b5.slice(b5.indexOf(',') + 1)), (c) => c.charCodeAt(0));
    const doc = readArchive(bytes).doc;
    const engine = new RecomputeEngine(kernel, kernelFeatures());
    let bodies: Record<BodyId, BodyMesh> = {};
    try {
      const result = await engine.recompute({ doc });
      if (result.status !== 'done') throw new Error(result.status);
      bodies = Object.fromEntries(
        result.bodies
          .filter((b): b is typeof b & { mesh: BodyMesh } => b.mesh !== undefined)
          .map((b) => [b.id, b.mesh]),
      );
    } finally {
      engine.clear();
    }
    const viewport = createViewportStore({
      preferences: memoryPreferences(),
      reducedMotion: () => true,
    });
    const scene: PickScene = {
      bodies: Object.entries(bodies).map(([id, mesh]) => ({ id: id as BodyId, mesh })),
      sketches: [],
      occluding: true,
    };
    const frame: SketchFrame = {
      origin: [0, 0, 0],
      normal: [0, 0, 1],
      x: [1, 0, 0],
      y: [0, 1, 0],
    };
    const { view, projection } = viewport.getState();
    const camera = { view, projection, width: 1440, height: 900 };
    const moves = 2000;
    let hits = 0;
    const start = performance.now();
    for (let i = 0; i < moves; i++) {
      const x = 200 + ((i * 37) % 1000);
      const y = 150 + ((i * 53) % 600);
      if (modelSnapAt(scene, camera, frame, [x, y], [0, 0], bodies)) hits++;
    }
    const ms = (performance.now() - start) / moves;
    expect(
      `modelSnapAt on B5: ${ms.toFixed(3)} ms per move over ${moves} moves (${hits} hits)`,
    ).toBe('');
  });
});
