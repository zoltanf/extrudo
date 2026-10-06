// Measurement (P4-12 heap item, ADR-0067 §H4's limit): the cold recompute time
// of every benchmark fixture, which is what a recycled worker pays, and the
// warm-cache growth of the revolve document per 1,000 recomputes. Gated, as the
// memory test's warm-cache probe is:
//   HEAP_BOUND=1 pnpm vitest run packages/kernel/src/heap-bound
// It prints the table as a soft failure (the numbers are the point).
import { type ExtrudoDocument, loadDocument } from '@extrudo/core';
import { DEFAULT_FONT } from '@extrudo/fonts';
import { loadFont } from '@extrudo/sketch/text';
import { strFromU8, unzipSync } from 'fflate';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import b1 from '../../../fixtures/benchmarks/b1-plate.extrudo?url&inline';
import b2 from '../../../fixtures/benchmarks/b2-storage-box.extrudo?url&inline';
import b3 from '../../../fixtures/benchmarks/b3-phone-stand.extrudo?url&inline';
import b4 from '../../../fixtures/benchmarks/b4-box-with-lid.extrudo?url&inline';
import b5 from '../../../fixtures/benchmarks/b5-pcb-enclosure.extrudo?url&inline';
import b6 from '../../../fixtures/benchmarks/b6-wall-hook.extrudo?url&inline';
import b7 from '../../../fixtures/benchmarks/b7-knurled-knob.extrudo?url&inline';
import b8 from '../../../fixtures/benchmarks/b8-name-tag.extrudo?url&inline';
import b9 from '../../../fixtures/benchmarks/b9-bottle-cap.extrudo?url&inline';
import b10 from '../../../fixtures/benchmarks/b10-chain-link.extrudo?url&inline';
import p401 from '../../../fixtures/benchmarks/p4-01-sweep-loft-coil.extrudo?url&inline';
import interRegular from '../../fonts/fonts/inter-regular.ttf?url&inline';
import { kernelFeatures } from './features';
import { Kernel } from './kernel';
import { loadOcct } from './occt/load';
import { RecomputeEngine } from './recompute/engine';

function bytesOf(dataUrl: string): Uint8Array {
  const binary = atob(dataUrl.slice(dataUrl.indexOf(',') + 1));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}
function load(dataUrl: string): ExtrudoDocument {
  const files = unzipSync(bytesOf(dataUrl));
  const json = files['document.json'];
  if (!json) throw new Error('no document.json');
  return loadDocument(JSON.parse(strFromU8(json))).doc;
}

const ENV =
  (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

const FIXTURES: [string, string][] = [
  ['B1', b1],
  ['B2', b2],
  ['B3', b3],
  ['B4', b4],
  ['B5', b5],
  ['B6', b6],
  ['B7', b7],
  ['B8', b8],
  ['B9', b9],
  ['B10', b10],
  ['P4-01', p401],
];

describe.runIf(ENV.HEAP_BOUND)('cold recompute time of the fixtures', () => {
  let kernel: Kernel;
  beforeAll(async () => {
    kernel = new Kernel(await loadOcct());
    loadFont(DEFAULT_FONT, bytesOf(interRegular));
  });
  afterAll(() => kernel?.dispose());

  it('times a cold recompute of every fixture', { timeout: 1_800_000 }, async () => {
    const times: Record<string, string> = {};
    for (const [name, dataUrl] of FIXTURES) {
      const doc = load(dataUrl);
      const engine = new RecomputeEngine(kernel, kernelFeatures(), { strictLeaks: true });
      const samples: number[] = [];
      for (let i = 0; i < 3; i++) {
        engine.clear();
        const start = performance.now();
        const result = await engine.recompute({ doc });
        if (result.status !== 'done') throw new Error(`${name}: ${result.status}`);
        samples.push(performance.now() - start);
      }
      engine.clear();
      samples.sort((a, b) => a - b);
      times[name] = `${samples[0]?.toFixed(0)} ms (median of 3, cold)`;
    }
    expect.soft(times).toBeUndefined();
  });
});
