// The P4-06 mesh fixtures (`fixtures/imports/`): the mesh files
// `features/import-mesh.test.ts` and `e2e/import-mesh.spec.ts` import,
// written through `@extrudo/io`'s own writers so they are what Extrudo exports
// of its own geometry (a 20 mm cube, the same cube with one face missing, and
// a two-object 3MF in centimetres). The ASCII STL and the Y-up OBJ are
// hand-written (a mesh tool's text output).
//
// With `WRITE_FIXTURES=1` this rewrites the three binary files.
import { triangleNormal, write3mf, writeStl } from '@extrudo/io';
import { expect, it } from 'vitest';

const env =
  (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

/** A 20 mm cube's twelve triangles, counter-clockwise from outside. */
function box(size: number, at: [number, number, number] = [0, 0, 0]) {
  const [x, y, z] = at;
  return {
    positions: new Float64Array([
      x,
      y,
      z,
      x + size,
      y,
      z,
      x + size,
      y + size,
      z,
      x,
      y + size,
      z,
      x,
      y,
      z + size,
      x + size,
      y,
      z + size,
      x + size,
      y + size,
      z + size,
      x,
      y + size,
      z + size,
    ]),
    // biome-ignore format: two triangles per side
    indices: new Uint32Array([
      0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 2, 3, 7, 2, 7, 6, 1, 2, 6, 1, 6, 5, 3, 0, 4,
      3, 4, 7,
    ]),
  };
}

/**
 * The same box as ASCII STL: `facet normal`, `outer loop` and three `vertex`
 * lines per triangle, which is what a mesh tool writes for a text format.
 */
function writeAsciiStl(mesh: ReturnType<typeof box>, name: string): string {
  const lines = [`solid ${name}`];
  const p = mesh.positions;
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const [a, b, c] = [
      mesh.indices[t] as number,
      mesh.indices[t + 1] as number,
      mesh.indices[t + 2] as number,
    ];
    const normal = triangleNormal(p, a, b, c);
    lines.push(`  facet normal ${normal.map((v) => v.toFixed(6)).join(' ')}`);
    lines.push('    outer loop');
    for (const node of [a, b, c]) {
      lines.push(
        `      vertex ${[0, 1, 2].map((k) => (p[3 * node + k] as number).toFixed(6)).join(' ')}`,
      );
    }
    lines.push('    endloop', '  endfacet');
  }
  lines.push(`endsolid ${name}`, '');
  return lines.join('\n');
}

/**
 * The Node file system, without the kernel's tsconfig knowing about it (it has
 * no Node types): the module name in a variable keeps `tsc` out of it.
 */
async function write(path: string, data: Uint8Array): Promise<void> {
  const nodeFs = 'node:fs';
  const fs = (await import(/* @vite-ignore */ nodeFs)) as {
    writeFileSync(target: URL, bytes: Uint8Array): void;
  };
  fs.writeFileSync(new URL(`../../../../fixtures/imports/${path}`, import.meta.url), data);
}

it('writes the P4-06 mesh fixtures', () => {
  const cube = box(20);
  // A cube with one of its twelve faces left out: three open edges.
  const open = { ...cube, indices: cube.indices.slice(0, cube.indices.length - 3) };
  // A lid and a box in centimetres, as a slicer that measures in cm writes.
  const parts = write3mf(
    [
      { name: 'Lid', mesh: box(4, [0, 0, 0]) },
      { name: 'Box', mesh: box(6, [0, 0, 0]) },
    ],
    { unit: 'centimeter', application: 'Extrudo fixtures' },
  );
  // Sizes: the cube's 684 bytes, the open one 634, the 3MF a couple of kB.
  expect(cube.indices.length).toBe(36);
  expect(open.indices.length).toBe(33);
  expect(parts.length).toBeGreaterThan(500);

  const ascii = writeAsciiStl(cube, 'cube');
  expect(ascii.split('\n').filter((line) => line.includes('facet normal')).length).toBe(12);

  if (env.WRITE_FIXTURES === '1') {
    void write('cube.stl', writeStl(cube, { header: 'Extrudo fixture: a 20 mm cube' }));
    void write('open.stl', writeStl(open, { header: 'Extrudo fixture: a cube with a hole' }));
    void write('ascii-cube.stl', new TextEncoder().encode(ascii));
    void write('two-parts.3mf', parts);
    // Two cubes that share one edge: importing this separates them
    // (ADR-0066's 2026-10-09 amendment).
    void write(
      'touching-cubes.stl',
      writeStl([box(20), box(20, [20, 20, 0])], {
        header: 'Extrudo fixture: two cubes sharing an edge',
      }),
    );
  }
});
