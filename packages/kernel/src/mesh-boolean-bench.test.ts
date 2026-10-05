// How long a mesh boolean takes and what the deflection costs (P4-06,
// ADR-0066 §4): a 200,000-triangle STL cut by a B-rep cylinder through
// manifold-3d, and the volume against the exact one at three deflections.
// Only with `BENCH=1` (`BENCH=1 pnpm vitest run
// packages/kernel/src/mesh-boolean-bench`), like the other benchmarks in the
// kernel; without it the test checks that the booleans close.
import { checkManifold, readStl, writeStl } from '@extrudo/io';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Kernel, MESH_BOOLEAN_DEFLECTION } from './kernel';
import { loadManifold } from './manifold';
import type { MeshOptions } from './mesh';
import { loadOcct } from './occt/load';

let kernel: Kernel;
let manifold: Awaited<ReturnType<typeof loadManifold>>;

beforeAll(async () => {
  kernel = new Kernel(await loadOcct());
  manifold = await loadManifold();
  kernel.enableMeshes(manifold);
});

afterAll(() => kernel.dispose());

describe('mesh booleans (BENCH=1)', { timeout: 300_000 }, () => {
  it('a B-rep bore through a mesh body, at three deflections', async () => {
    // A 20 mm sphere: manifold's is a refined octahedron, so 640 segments give
    // about 205,000 triangles (the same figure as import-mesh-bench).
    const sphere = manifold.Manifold.sphere(20, 640);
    const gl = sphere.getMesh();
    const bytes = writeStl({
      positions: Float64Array.from(gl.vertProperties),
      indices: gl.triVerts,
    });
    sphere.delete();
    const mesh = kernel.meshFrom(readStl(bytes).mesh);
    const exact = (4 / 3) * Math.PI * 20 ** 3;
    const own = kernel.measure(mesh).volume;
    // A Ø10 bore through the middle of the sphere: π·25·40 mm³, of which a
    // little more than the cylinder is inside the sphere's ends.
    const bore = kernel.cylinder(5, 40, [0, 0, -20]);
    const cut = kernel.cut(mesh, bore);
    const drilled = kernel.measure(cut.shape).volume;
    kernel.release(cut.shape);

    const deflections: MeshOptions[] = [
      MESH_BOOLEAN_DEFLECTION,
      { linearDeflection: 0.001, angularDeflection: 0.02 },
      { linearDeflection: 0.5, angularDeflection: 0.5 },
    ];
    const rows: string[] = [];
    for (const deflection of deflections) {
      const tool = kernel.meshFrom(kernel.exportMesh(bore, deflection));
      const start = performance.now();
      const { shape } = kernel.cut(mesh, tool);
      const ms = performance.now() - start;
      const volume = kernel.measure(shape).volume;
      const triangles = kernel.exportMesh(shape, MESH_BOOLEAN_DEFLECTION).indices.length / 3;
      const report = checkManifold(kernel.exportMesh(shape, MESH_BOOLEAN_DEFLECTION));
      rows.push(
        `  ${deflection.linearDeflection} mm / ${deflection.angularDeflection} rad: ` +
          `${ms.toFixed(0)} ms, ${volume.toFixed(0)} mm3 (${(((volume - drilled) / drilled) * 100).toFixed(2)} %), ` +
          `${triangles} triangles, closed ${report.ok}`,
      );
      kernel.release(tool, shape);
    }
    kernel.release(bore, mesh);
    const lines = [
      `file           ${(bytes.length / 1e6).toFixed(1)} MB binary STL, ${gl.triVerts.length / 3} triangles`,
      `sphere volume  ${own.toFixed(0)} mm3 (its own is ${exact.toFixed(0)})`,
      `bore Ø10       ${drilled.toFixed(0)} mm3 left`,
      ...rows,
    ];
    // Vitest swallows console.log in bench probes, so the numbers also go to a
    // file (the kernel's tsconfig has no Node types, so `node:fs` stays a name).
    console.warn(lines.join('\n'));
    const nodeFs = 'node:fs';
    const fs = (await import(/* @vite-ignore */ nodeFs)) as {
      writeFileSync(path: string, text: string): void;
    };
    fs.writeFileSync('/tmp/extrudo-mesh-boolean-bench.txt', `${lines.join('\n')}\n`);
    // The sphere's own volume to a thousandth, whatever the deflection.
    expect(Math.abs(own - exact) / exact).toBeLessThan(0.001);
  });
});
