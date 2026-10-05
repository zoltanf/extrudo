// How long a big mesh body takes (P4-06, ADR-0066 §3): a 200,000-triangle
// STL of a sphere, written through our own `writeStl` and imported through the
// `import` feature, as the ADR's Results measure it. Only with `BENCH=1`
// (`BENCH=1 pnpm vitest run packages/kernel/src/features/import-mesh-bench`),
// like the other benchmarks in the kernel.
import { type AttachmentId, type ExtrudoDocument, importInputs } from '@extrudo/core';
import { expect, it } from 'vitest';
import { Kernel } from '../kernel';
import { loadManifold } from '../manifold';
import { loadOcct } from '../occt/load';
import { RecomputeEngine } from '../recompute/engine';
import { testDocument, testFeature } from '../recompute/testing';
import type { ImportedFile } from '../recompute/types';
import { kernelFeatures } from '.';

const env =
  (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

/** How many triangles the sphere is refined to (a 20 mm sphere, mm). */
const TRIANGLES = 200_000;

it('imports a 200,000-triangle STL', { timeout: 300_000 }, async () => {
  const manifold = await loadManifold();
  // manifold's sphere is a refined octahedron: it has half as many triangles
  // as the segments squared, so 640 gives about 205,000.
  const sphere = manifold.Manifold.sphere(20, 640);
  const gl = sphere.getMesh();
  const mesh = { positions: Float64Array.from(gl.vertProperties), indices: gl.triVerts };
  expect(mesh.indices.length / 3).toBeGreaterThanOrEqual(TRIANGLES);
  const { writeStl } = await import('@extrudo/io');
  const bytes = writeStl(mesh);
  if (env.BENCH !== '1') {
    // The measurement is only interesting when asked for; without it the test
    // checks the one thing that must hold at any size: it imports.
    expect(bytes.length).toBe(84 + (mesh.indices.length / 3) * 50);
    return;
  }
  const file = 'bench' as AttachmentId;
  const held = new Map<AttachmentId, ImportedFile>([
    [file, { bytes, mediaType: 'model/stl', fileName: 'sphere.stl' }],
  ]);
  const doc: ExtrudoDocument = {
    ...testDocument([
      {
        ...testFeature('Import1', 'import'),
        inputs: importInputs({ file }),
      },
    ]),
    attachments: {
      [file]: {
        name: 'sphere',
        fileName: 'sphere.stl',
        mediaType: 'model/stl',
        sha256: 'd'.repeat(64),
        size: bytes.length,
      },
    },
  };
  const kernel = new Kernel(await loadOcct());
  kernel.enableMeshes(manifold);
  const engine = new RecomputeEngine(kernel, kernelFeatures(), {
    files: (id) => held.get(id),
  });
  // The heap before and after: what the import costs in JavaScript memory
  // (manifold-3d's own WASM heap is inside its module, not this one).
  const heap = () =>
    (
      globalThis as {
        process?: { memoryUsage(): { heapUsed: number; external: number } };
      }
    ).process?.memoryUsage();
  const beforeHeap = heap();
  const before = performance.now();
  const result = await engine.recompute({
    doc,
    tessellation: { linearDeflection: 0.05, angularDeflection: 0.3 },
  });
  const ms = performance.now() - before;
  const afterHeap = heap();
  if (result.status !== 'done') throw new Error('cancelled');
  const status = Object.values(result.features)[0]?.status;
  const body = result.bodies[0];
  const volume = body ? kernel.measure(engine.latestBody(body.id) ?? (0 as never)).volume : 0;
  const lines = [
    `triangles      ${mesh.indices.length / 3}`,
    `file           ${(bytes.length / 1e6).toFixed(1)} MB binary STL`,
    `recompute      ${ms.toFixed(0)} ms (cold, display mesh included)`,
    `status         ${status}`,
    `volume         ${volume.toFixed(0)} mm3`,
    `live shapes    ${result.stats.liveShapes}`,
    ...(beforeHeap && afterHeap
      ? [
          `js heap        +${((afterHeap.heapUsed - beforeHeap.heapUsed) / 1e6).toFixed(1)} MB`,
          `external       +${((afterHeap.external - beforeHeap.external) / 1e6).toFixed(1)} MB`,
        ]
      : []),
  ];
  // Vitest swallows console.log in bench probes, so the numbers also go to a
  // file (the kernel's tsconfig has no Node types, so `node:fs` stays a name).
  console.warn(lines.join('\n'));
  const nodeFs = 'node:fs';
  const fs = (await import(/* @vite-ignore */ nodeFs)) as {
    writeFileSync(path: string, text: string): void;
  };
  fs.writeFileSync('/tmp/extrudo-import-mesh-bench.txt', `${lines.join('\n')}\n`);
  engine.clear();
  kernel.dispose();
  expect(status).toBe('ok');
});
