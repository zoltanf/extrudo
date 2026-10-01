// P3-17 (the fuzzer's B5 finding, ADR-0047 amendment): B5's Rectangular Pattern1 with its second
// count raised to 20 (2 × 20 instances) took 54 to 162 s to recompute. Measurement only:
// `BENCH=1 pnpm vitest run packages/kernel/src/pattern-bench.test.ts` prints the time of the
// pattern and the time each `Kernel` method took inside it. `BENCH_COUNT` is the factor on `count2`.
import {
  applyCommand,
  type ExtrudoDocument,
  type FeatureInputs,
  loadDocument,
  updateFeatureInputs,
} from '@extrudo/core';
import { strFromU8, unzipSync } from 'fflate';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import b5 from '../../../fixtures/benchmarks/b5-pcb-enclosure.extrudo?url&inline';
import { kernelFeatures } from './features';
import { Kernel } from './kernel';
import { loadOcct } from './occt/load';
import { RecomputeEngine } from './recompute/engine';

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env;

function load(dataUrl: string): ExtrudoDocument {
  const binary = atob(dataUrl.slice(dataUrl.indexOf(',') + 1));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  const json = unzipSync(bytes)['document.json'];
  if (!json) throw new Error('no document.json');
  return loadDocument(JSON.parse(strFromU8(json))).doc;
}

let kernel: Kernel;
beforeAll(async () => {
  kernel = new Kernel(await loadOcct());
});
afterAll(() => kernel?.dispose());

describe.runIf(env?.BENCH)('B5 pattern with many instances', () => {
  it('recomputes Rectangular Pattern1 at count2 x factor', { timeout: 900_000 }, async () => {
    let doc = load(b5);
    const pattern = doc.features.find((f) => f.name === 'Rectangular Pattern1');
    const count2 = pattern?.inputs.count2;
    if (!pattern || count2?.kind !== 'expr') throw new Error('no count2');
    const factor = Number(env?.BENCH_COUNT ?? 10);
    const inputs: FeatureInputs = {
      count2: { ...count2, expr: `(${count2.expr}) * ${factor}` },
    };
    doc = applyCommand(doc, updateFeatureInputs({ id: pattern.id, inputs })).doc;

    // Time every public method of the kernel while the engine runs.
    const spent = new Map<string, { ms: number; calls: number }>();
    const proto = Object.getPrototypeOf(kernel) as Record<string, unknown>;
    const originals = new Map<string, unknown>();
    for (const name of Object.getOwnPropertyNames(proto)) {
      const fn = proto[name];
      if (name === 'constructor' || typeof fn !== 'function') continue;
      originals.set(name, fn);
      proto[name] = function (this: unknown, ...args: unknown[]) {
        const start = performance.now();
        try {
          return (fn as (...a: unknown[]) => unknown).apply(this, args);
        } finally {
          const caller = new Error().stack?.split('\n')[2]?.trim().split(' ')[1] ?? '?';
          const key = name === 'distance' ? `${name}<${caller}>` : name;
          const entry = spent.get(key) ?? { ms: 0, calls: 0 };
          entry.ms += performance.now() - start;
          entry.calls++;
          spent.set(key, entry);
        }
      };
    }
    const engine = new RecomputeEngine(kernel, kernelFeatures(), { strictLeaks: true });
    let seconds: number;
    let status: string | undefined;
    try {
      const start = performance.now();
      const result = await engine.recompute({ doc });
      seconds = (performance.now() - start) / 1000;
      if (result.status !== 'done') throw new Error(result.status);
      status = result.features[pattern.id]?.status;
    } finally {
      engine.clear();
      for (const [name, fn] of originals) proto[name] = fn;
    }
    const top = [...spent]
      .sort((a, b) => b[1].ms - a[1].ms)
      .slice(0, 8)
      .map(([name, { ms, calls }]) => `${name} ${Math.round(ms)} ms (${calls})`);
    // Vitest swallows console output in some setups: the report is also the failure message.
    expect(`count2 x${factor}: ${seconds.toFixed(1)} s, ${status}; ${top.join('; ')}`).toBe('');
  });
});
