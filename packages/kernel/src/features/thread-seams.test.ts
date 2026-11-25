// Which edges of a threaded body are seams (ADR-0008 §8: `EDGE_SEAM`, an edge closed on one of
// its faces, not drawn and not picked). The bottle cap benchmark's two threaded bodies: a thread's
// root is pieces of one cylinder (or cone) that meet at its seam, and the edges there are seams
// too (ADR-0035's amendment of 2026-11-25: a copy that gave each piece its own surface lost them).
import { type ExtrudoDocument, loadDocument } from '@extrudo/core';
import { strFromU8, unzipSync } from 'fflate';
import { afterAll, beforeAll, expect, it } from 'vitest';
import b9 from '../../../../fixtures/benchmarks/b9-bottle-cap.extrudo?url&inline';
import { Kernel } from '../kernel';
import { EDGE_SEAM } from '../mesh';
import { loadOcct } from '../occt/load';
import { RecomputeEngine } from '../recompute/engine';
import { kernelFeatures } from './index';

let kernel: Kernel;
beforeAll(async () => {
  kernel = new Kernel(await loadOcct());
});
afterAll(() => {
  expect(kernel.stats().liveShapes).toBe(0);
});

const bytesOf = (url: string) =>
  Uint8Array.from(atob(url.slice(url.indexOf(',') + 1)), (c) => c.charCodeAt(0));

it("pins the seam edges of the bottle cap's threaded bodies", { timeout: 120_000 }, async () => {
  const files = unzipSync(bytesOf(b9));
  const doc = loadDocument(JSON.parse(strFromU8(files['document.json'] as Uint8Array)))
    .doc as ExtrudoDocument;
  const engine = new RecomputeEngine(kernel, kernelFeatures(), { strictLeaks: true });
  try {
    const result = await engine.recompute({ doc });
    if (result.status !== 'done') throw new Error('cancelled');
    const seams = Object.fromEntries(
      result.bodies.map((b) => [
        b.id,
        [...(b.mesh?.edgeFlags ?? [])]
          .map((flag, e) =>
            (flag & EDGE_SEAM) !== 0 ? (b.mesh?.edgeIds?.[e] ?? `#${e}`) : undefined,
          )
          .filter((name) => name !== undefined)
          .sort(),
      ]),
    );
    expect(seams).toEqual(SEAMS);
  } finally {
    engine.clear();
  }
});

/** Main's build before ADR-0035's amendment of 2026-11-25 gave these. */
const SEAMS: Record<string, string[]> = {
  '0f7c9723-8a0e-4c1c-af36-534e752d8cd4:0': [
    'e[revolve:0f7c9723-8a0e-4c1c-af36-534e752d8cd4:side:cd3f1f29-32d8-402a-be8e-fd2edebb0d15]',
    'e[thread:4e1bf051-548f-419f-b5f7-d705b0a7d941:side:f0.lead0#1|thread:4e1bf051-548f-419f-b5f7-d705b0a7d941:side:f0.lead0#2]',
    'e[thread:4e1bf051-548f-419f-b5f7-d705b0a7d941:side:f0.root#1|thread:4e1bf051-548f-419f-b5f7-d705b0a7d941:side:f0.root#2]',
    'e[thread:4e1bf051-548f-419f-b5f7-d705b0a7d941:side:f0.root#2|thread:4e1bf051-548f-419f-b5f7-d705b0a7d941:side:f0.root#3]',
    'e[thread:4e1bf051-548f-419f-b5f7-d705b0a7d941:side:f0.root#3|thread:4e1bf051-548f-419f-b5f7-d705b0a7d941:side:f0.root#4]',
    'e[thread:4e1bf051-548f-419f-b5f7-d705b0a7d941:side:f0.root#4]',
  ],
  'ab1cab93-998a-48f6-8f72-59e4bbdb1649:0': [
    'e[thread:4fbaa7f6-ee0f-453f-a086-1c88610624e9:side:f0.root#1|thread:4fbaa7f6-ee0f-453f-a086-1c88610624e9:side:f0.root#4]',
    'e[thread:4fbaa7f6-ee0f-453f-a086-1c88610624e9:side:f0.root#2|thread:4fbaa7f6-ee0f-453f-a086-1c88610624e9:side:f0.root#3]',
    'e[thread:4fbaa7f6-ee0f-453f-a086-1c88610624e9:side:f0.root#2|thread:4fbaa7f6-ee0f-453f-a086-1c88610624e9:side:f0.root#4]',
    'e[thread:4fbaa7f6-ee0f-453f-a086-1c88610624e9:side:f0.root#3|thread:4fbaa7f6-ee0f-453f-a086-1c88610624e9:side:f0.root#5]',
    'e[thread:4fbaa7f6-ee0f-453f-a086-1c88610624e9:side:f0.root#5]',
    'e[thread:4fbaa7f6-ee0f-453f-a086-1c88610624e9:side:f1.root#1]',
    'e[thread:4fbaa7f6-ee0f-453f-a086-1c88610624e9:side:f1.root#1|thread:4fbaa7f6-ee0f-453f-a086-1c88610624e9:side:f1.root#3]',
    'e[thread:4fbaa7f6-ee0f-453f-a086-1c88610624e9:side:f1.root#2|thread:4fbaa7f6-ee0f-453f-a086-1c88610624e9:side:f1.root#3]',
    'e[thread:4fbaa7f6-ee0f-453f-a086-1c88610624e9:side:f1.root#2|thread:4fbaa7f6-ee0f-453f-a086-1c88610624e9:side:f1.root#4]',
    'e[thread:4fbaa7f6-ee0f-453f-a086-1c88610624e9:side:f1.root#4]',
  ],
};
