/**
 * The import's peak memory at its caps (P6-25 S13, ADR-0144), measured, not asserted: each case
 * alone (`-t`), in a process of its own (`--pool=forks`), as the growth of the process's peak
 * resident memory over what it had before the case.
 *
 *   BENCH_HEAP=1 pnpm vitest run packages/fcstd/src/heap.test.ts --pool=forks -t "<case>"
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { loadPlanegcs, SketchSolver } from '@extrudo/sketch';
import { zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { documentXml, label, NO_HISTORY, placement, prop, shape } from './fixtures';
import { importFcstd } from './import';
import type { ImportKernel, StoredShapeStep } from './import-kernel';
import { bms } from './mesh-parts';
import { MAX_STORED_BREP_BYTES } from './model';
import { nodeImportKernel } from './node-kernel-test-support';

const peakMb = () => process.resourceUsage().maxRSS / 1024;
const report = (what: string, before: number, extra = '') =>
  process.stderr.write(
    `HEAP ${what}: peak +${(peakMb() - before).toFixed(0)} MB (process ${peakMb().toFixed(0)} MB)${extra}\n`,
  );
const enc = (s: string) => new TextEncoder().encode(s);
const DIR = process.env.BENCH_HEAP ?? '/tmp';
/**
 * The case's file from disk: made and written by a first run (which measures nothing, since
 * making it raises the peak), read by the second as the app holds a file's bytes.
 */
function cached(name: string, make: () => Uint8Array): Uint8Array | undefined {
  const path = `${DIR}/heap-${name}.FCStd`;
  if (existsSync(path)) return new Uint8Array(readFileSync(path));
  writeFileSync(path, make());
  process.stderr.write(`HEAP ${name}: made ${path}; run again to measure\n`);
  return undefined;
}

/** A fake kernel that converts every shape to a small STEP: what is measured is the importer's own. */
const fake: ImportKernel = {
  storedShapeToStep: async () => {
    const m = {
      solids: 1,
      volume: 6000,
      area: 2200,
      box: { min: [0, 0, 0], max: [10, 20, 30] },
      centre: [5, 10, 15],
    };
    return { ...m, step: 'ISO-10303-21;', read: m } as unknown as StoredShapeStep;
  },
  ...NO_HISTORY,
  restart: async () => {},
};

/** A closed box mesh of 12·k² facets at `x` along X. */
function gridBox(k: number, x: number): { points: number[]; facets: number[] } {
  const points: number[] = [];
  const facets: number[] = [];
  const index = new Map<string, number>();
  const at = (p: [number, number, number]) => {
    const key = p.join(',');
    let i = index.get(key);
    if (i === undefined) {
      i = points.length / 3;
      index.set(key, i);
      points.push(p[0] + x, p[1], p[2]);
    }
    return i;
  };
  // Each face of the unit-k cube as a k × k grid, wound outwards.
  for (let axis = 0; axis < 3; axis++)
    for (const side of [0, k]) {
      const u = (axis + 1) % 3;
      const v = (axis + 2) % 3;
      for (let a = 0; a < k; a++)
        for (let b = 0; b < k; b++) {
          const p = (da: number, db: number) => {
            const q: [number, number, number] = [0, 0, 0];
            q[axis] = side;
            q[u] = a + da;
            q[v] = b + db;
            return at(q);
          };
          const [p00, p10, p11, p01] = [p(0, 0), p(1, 0), p(1, 1), p(0, 1)];
          if (side === k) facets.push(p00, p10, p11, p00, p11, p01);
          else facets.push(p00, p11, p10, p00, p01, p11);
        }
    }
  return { points, facets };
}

describe.skipIf(!process.env.BENCH_HEAP)('peak memory at the caps (BENCH_HEAP=1)', () => {
  it('a 96 MB file of three stored shapes at the 32 MB limit', async () => {
    const file = cached('large-file', () => {
      const big = (n: number) =>
        `CASCADE Topology V1, (c) Matra-Datavision\n${' '.repeat(n)}\nTShapes 1\nSo\n`;
      const objects = [0, 1, 2].map((i) => ({
        name: `B${i}`,
        type: 'Part::Feature',
        props: [label(`B${i}`), placement(), shape(`B${i}.brp`)],
      }));
      const entries: Record<string, Uint8Array> = { 'Document.xml': enc(documentXml(objects)) };
      for (const o of objects) entries[`${o.name}.brp`] = enc(big(MAX_STORED_BREP_BYTES - 100));
      return zipSync(entries, { level: 0 });
    });
    if (!file) return;
    const before = peakMb();
    const t = Date.now();
    const r = await importFcstd(file, 'X', { kernel: fake });
    report('96 MB file', before, `, ${(file.length / 1e6).toFixed(0)} MB, ${Date.now() - t} ms`);
    expect(r.report.shapes).toHaveLength(3);
  }, 600_000);

  it('a Document.xml of 990,000 elements', async () => {
    const file = cached('elements', () => {
      const cells = Array.from(
        { length: 990_000 },
        (_, i) => `<Cell address="A${(i % 99_999) + 1}" content="${i}"/>`,
      ).join('');
      const xml = documentXml([
        {
          name: 'Sheet',
          type: 'Spreadsheet::Sheet',
          props: [
            label('Sheet'),
            prop(
              'cells',
              'Spreadsheet::PropertySheet',
              `<Cells Count="990000" xlink="1"><XLinks count="0"></XLinks>${cells}</Cells>`,
            ),
          ],
        },
      ]);
      return zipSync({ 'Document.xml': enc(xml) });
    });
    if (!file) return;
    const before = peakMb();
    const t = Date.now();
    await importFcstd(file, 'X', { kernel: fake });
    report(
      '990,000 elements',
      before,
      `, file ${(file.length / 1e6).toFixed(1)} MB, ${Date.now() - t} ms`,
    );
  }, 600_000);

  it('512 meshes of 3,888 facets each (the facets cap), with the kernel', async () => {
    const file = cached('meshes', () => {
      const objects = [];
      const entries: Record<string, Uint8Array> = {};
      for (let i = 0; i < 512; i++) {
        const { points, facets } = gridBox(18, 30 * i);
        entries[`M${i}.bms`] = bms(points, facets);
        objects.push({
          name: `M${i}`,
          type: 'Mesh::Feature',
          props: [
            label(`M${i}`),
            prop('Mesh', 'Mesh::PropertyMeshKernel', `<Mesh file="M${i}.bms"/>`),
            placement(),
          ],
        });
      }
      entries['Document.xml'] = enc(documentXml(objects));
      return zipSync(entries);
    });
    if (!file) return;
    const before = peakMb();
    const t = Date.now();
    const r = await importFcstd(file, 'X', {
      kernel: nodeImportKernel(),
      solver: new SketchSolver(await loadPlanegcs()),
    });
    report(
      '512 meshes',
      before,
      `, ${r.report.meshes.filter((m) => m.outcome === 'in').length} in, ${Date.now() - t} ms`,
    );
  }, 3_600_000);
});
