// P4-12 (ADR-0067 §H2): B9's recompute with the cap's diameter doubled, the
// case whose `mergeTools` asked OCCT for the exact distance between the
// adapter's two thread tools — 26 s of a 30 s recompute in ADR-0039's B9
// amendment, the reason B9 fuzzed 6 steps on request.
//
// Measured on this branch (2026-10-05, a 4-core machine): warm 14 ms, cold
// 7.9 s, and the exact distance asked **twice**, both before and after the
// heavy-tool rule: B9's threads are a few turns each (30-odd faces), so they
// are light and keep the exact test. The 26 s of ADR-0039 is B9's
// `capDia × 2` *at the time*, when the collar's M60 thread and the M20 one
// were longer (and `METRIC_COARSE` stopped at M30); today's B9 no longer
// needs the rule, but a longer document does: the exact distance between two
// tools of 36 and 30 turns is 277 s (`thread.test.ts` times every `Kernel`
// method to find it), and `mergeTools` now merges tools of over
// `HEAVY_TOOL_FACES` faces without asking.
// Measurement only:
//   BENCH=1 pnpm vitest run packages/kernel/src/features/thread-bench
import { applyCommand, type ExtrudoDocument, loadDocument, updateParameter } from '@extrudo/core';
import { strFromU8, unzipSync } from 'fflate';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import b9 from '../../../../fixtures/benchmarks/b9-bottle-cap.extrudo?url&inline';
import { kernelFeatures } from '../features';
import { Kernel } from '../kernel';
import { loadOcct } from '../occt/load';
import { RecomputeEngine } from '../recompute/engine';
import type { RecomputeResult } from '../recompute/types';

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env;

let kernel: Kernel;
beforeAll(async () => {
  kernel = new Kernel(await loadOcct());
});
afterAll(() => kernel?.dispose());

function load(dataUrl: string): ExtrudoDocument {
  const binary = atob(dataUrl.slice(dataUrl.indexOf(',') + 1));
  const json = unzipSync(Uint8Array.from(binary, (c) => c.charCodeAt(0)))['document.json'];
  if (!json) throw new Error('no document.json');
  return loadDocument(JSON.parse(strFromU8(json))).doc;
}

describe.runIf(env?.BENCH)('B9 with capDia × 2', () => {
  it('recomputes in seconds, warm and cold', { timeout: 600_000 }, async () => {
    const original = load(b9);
    const capDia = original.parameters.find((p) => p.name === 'capDia');
    if (!capDia) throw new Error('no capDia');
    const doc = applyCommand(
      original,
      updateParameter({ id: capDia.id, changes: { expression: `(${capDia.expression}) * 2` } }),
    ).doc;
    const engine = new RecomputeEngine(kernel, kernelFeatures(), { strictLeaks: true });
    let asked = 0;
    const distance = kernel.distance.bind(kernel);
    kernel.distance = ((...args: Parameters<typeof distance>) => {
      asked++;
      return distance(...args);
    }) as typeof kernel.distance;
    try {
      await engine.recompute({ doc });
      const started = performance.now();
      const result = await engine.recompute({ doc });
      const warm = Math.round(performance.now() - started);
      const coldStarted = performance.now();
      const coldEngine = new RecomputeEngine(kernel, kernelFeatures(), { strictLeaks: true });
      try {
        const cold = (await coldEngine.recompute({ doc })) as Extract<
          RecomputeResult,
          { status: 'done' }
        >;
        expect(cold.status).toBe('done');
      } finally {
        coldEngine.clear();
      }
      const cold = Math.round(performance.now() - coldStarted);
      if (result.status !== 'done') throw new Error(result.status);
      // The numbers show as a soft failure, like the fuzzer's report.
      expect.soft({ warm, cold, asked }, 'B9 capDia x 2 (report)').toBeUndefined();
      expect(warm).toBeLessThan(120_000);
      // B9's threads are light (a few turns each), so their exact distance is
      // still asked: it is seconds, not the minutes two heavy tools take.
      expect(asked, 'the two light thread tools').toBeLessThanOrEqual(2);
    } finally {
      kernel.distance = distance;
      engine.clear();
    }
  });
});
