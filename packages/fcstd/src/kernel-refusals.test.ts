/**
 * S13 (ADR-0144, S3's known limit): a stored shape the kernel refuses is an
 * answer about that shape, not a failed kernel. It costs no restart and
 * doesn't count against `MAX_RESTARTS`, so the shapes after it still come in.
 * Only a kernel that died, ran over its time or answered nonsense is replaced.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  IMPORT_HEAP_RECYCLE_BYTES,
  isKernelRefusal,
  KERNEL_FAILURES,
  KERNEL_REFUSALS,
  MAX_REFUSED_SHARE,
  MAX_RESTARTS,
  REFUSAL_ALLOWANCE_MS,
  REFUSED_TIME,
} from './budget';
import { documentXml, fcstd, label, NO_HISTORY, placement, shape } from './fixtures';
import { importFcstd } from './import';
import type { ImportKernel, StoredShapeStep } from './import-kernel';
import { nodeImportKernel } from './node-kernel-test-support';
import { BOX } from './shape-fixtures';

/**
 * A B-rep text with the format line and a solid's mark (so the reader counts it a final shape)
 * that OCCT's reader refuses past them.
 */
const REFUSED =
  'CASCADE Topology V1, (c) Matra-Datavision\nLocations 1\nnot a location\nTShapes 1\nSo\n';

/** `count` shapes; the odd ones carry `REFUSED`. */
function mixed(count: number): Uint8Array {
  const objects = Array.from({ length: count }, (_, i) => ({
    name: `B${i}`,
    type: 'Part::Feature',
    props: [label(`Box ${i}`), placement(), shape(`B${i}.brp`)],
  }));
  return fcstd({
    'Document.xml': documentXml(objects),
    ...Object.fromEntries(objects.map((o, i) => [`${o.name}.brp`, i % 2 ? REFUSED : BOX])),
  });
}

describe('a kernel that refuses a shape is not a failed kernel (S13)', () => {
  it('brings in the five good shapes of ten when five are refused, with no restart', async () => {
    const kernel = nodeImportKernel();
    const { report, design } = await importFcstd(mixed(10), 'Mixed', { kernel });
    expect(report.shapes.map((s) => s.name)).toEqual(['Box 0', 'Box 2', 'Box 4', 'Box 6', 'Box 8']);
    expect(report.leftOut.map((l) => [l.name, l.reason])).toEqual(
      ['Box 1', 'Box 3', 'Box 5', 'Box 7', 'Box 9'].map((n) => [n, 'kernel']),
    );
    // More refusals than the restart cap allows failures, and none of them cost one.
    expect(5).toBeGreaterThan(MAX_RESTARTS);
    expect(report.restarts).toBe(0);
    expect(kernel.restarts).toBe(0);
    expect(report.refusals).toBe(5);
    expect(design.toJSON().features.filter((f) => f.type === 'import')).toHaveLength(5);
  }, 60_000);

  it('still restarts a kernel that throws something other than a refusal', async () => {
    let restarts = 0;
    let calls = 0;
    const kernel: ImportKernel = {
      storedShapeToStep: async () => {
        calls++;
        // A refusal, then a crash, then a dead worker's plain error.
        if (calls === 1)
          throw Object.assign(new Error('B-rep import failed'), { name: 'KernelError' });
        if (calls === 2)
          throw Object.assign(new Error('unreachable'), { name: 'KernelCrashError' });
        throw new Error('the geometry kernel stopped');
      },
      ...NO_HISTORY,
      restart: async () => {
        restarts++;
      },
    };
    const { report } = await importFcstd(mixed(3), 'X', { kernel });
    expect(report.leftOut.map((l) => l.reason)).toEqual(['kernel', 'kernel', 'kernel']);
    expect(restarts).toBe(2);
    expect(report.refusals).toBe(1);
  });

  it('knows every class that extends KernelError, at any depth, as a refusal or a failure', () => {
    const root = fileURLToPath(new URL('../../kernel/src/', import.meta.url));
    const files = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory()
          ? files(join(dir, e.name))
          : e.name.endsWith('.ts') && !e.name.endsWith('.test.ts')
            ? [join(dir, e.name)]
            : [],
      );
    const parent = new Map<string, string>();
    for (const f of files(root))
      for (const m of readFileSync(f, 'utf8').matchAll(/class (\w+) extends (\w+)/g))
        parent.set(m[1] as string, m[2] as string);
    const kinds = new Set(['KernelError']);
    // Every class whose chain of parents reaches KernelError.
    for (const name of parent.keys()) {
      const seen = new Set<string>();
      for (let at: string | undefined = name; at && !seen.has(at); at = parent.get(at)) {
        seen.add(at);
        if (at === 'KernelError') kinds.add(name);
      }
    }
    expect(kinds.size).toBeGreaterThan(10);
    for (const k of kinds)
      expect(KERNEL_REFUSALS.has(k) || KERNEL_FAILURES.has(k), `${k} is in neither list`).toBe(
        true,
      );
    for (const k of [...KERNEL_REFUSALS, ...KERNEL_FAILURES]) expect(kinds.has(k), k).toBe(true);
    expect(isKernelRefusal(Object.assign(new Error('x'), { name: 'FilletError' }))).toBe(true);
    expect(isKernelRefusal(new Error('x'))).toBe(false);
    expect(isKernelRefusal({ name: 'KernelCrashError' })).toBe(false);
    expect(isKernelRefusal('KernelError')).toBe(false);
    expect(isKernelRefusal(null)).toBe(false);
  });

  it('a refusal’s words decide nothing: one that names memory costs no restart (the file can put them there)', async () => {
    const words = 'bad_alloc out of memory OutOfMemory malloc cannot allocate allocation failed';
    const measure = {
      solids: 1,
      volume: 6000,
      area: 2200,
      box: { min: [0, 0, 0], max: [10, 20, 30] },
      centre: [5, 10, 15],
    };
    let calls = 0;
    let restarts = 0;
    const kernel: ImportKernel = {
      storedShapeToStep: async (): Promise<StoredShapeStep> => {
        if (++calls <= 4)
          throw Object.assign(new Error(`B-rep import failed: ${words}`), { name: 'KernelError' });
        return { ...measure, step: 'ISO-10303-21;', read: measure } as unknown as StoredShapeStep;
      },
      heap: async () => ({ top: 0 }),
      ...NO_HISTORY,
      restart: async () => {
        restarts++;
      },
    };
    const r = await importFcstd(mixed(6), 'X', { kernel });
    expect(restarts).toBe(0);
    expect(r.report.refusals).toBe(4);
    expect(r.report.shapes).toHaveLength(2);
  });

  it('replaces a kernel whose heap has grown past the limit after a refusal, and keeps one that can’t say', async () => {
    const refusal = (message: string) => Object.assign(new Error(message), { name: 'KernelError' });
    const fake = (message: string, top: number) => {
      const k = {
        restarts: 0,
        storedShapeToStep: async (): Promise<StoredShapeStep> => {
          throw refusal(message);
        },
        heap: async () => ({ top }),
        ...NO_HISTORY,
        restart: async () => {
          k.restarts++;
        },
      };
      return k;
    };
    // A kernel that can't report its heap: kept.
    const blind: Partial<ReturnType<typeof fake>> = fake(
      "B-rep import failed: the text couldn't be read.",
      2_000,
    );
    delete blind.heap;
    const a = await importFcstd(mixed(2), 'X', {
      kernel: blind as ImportKernel,
      maxRestarts: 10,
      heapRecycleBytes: 1_000,
    });
    expect(blind.restarts).toBe(0);
    expect(a.report.refusals).toBe(2);
    const big = fake("B-rep import failed: the text couldn't be read.", 2_000);
    const b = await importFcstd(mixed(2), 'X', {
      kernel: big,
      maxRestarts: 10,
      heapRecycleBytes: 1_000,
    });
    expect(big.restarts).toBe(2);
    const small = fake("B-rep import failed: the text couldn't be read.", 500);
    const c = await importFcstd(mixed(2), 'X', {
      kernel: small,
      maxRestarts: 10,
      heapRecycleBytes: 1_000,
    });
    expect(small.restarts).toBe(0);
    expect(c.report.refusals).toBe(2);
    for (const r of [a, b, c])
      expect(r.report.leftOut.map((l) => l.reason)).toEqual(['kernel', 'kernel']);
    // The project kernel's own threshold for a fresh worker (recomputer.ts).
    const recomputer = readFileSync(
      fileURLToPath(new URL('../../kernel/src/recomputer.ts', import.meta.url)),
      'utf8',
    );
    expect(recomputer).toContain('export const HEAP_RECYCLE_BYTES = 1024 * 1024 * 1024;');
    expect(IMPORT_HEAP_RECYCLE_BYTES).toBe(1024 * 1024 * 1024);
  });

  it('counts a refusal only past its allowance, toward a quarter of the import; then the rest is out', async () => {
    // A clock the kernel moves on: each refusal takes `ms` of it, nothing else does.
    let clock = 0;
    const slow = (ms: number) => ({
      storedShapeToStep: async (): Promise<StoredShapeStep> => {
        clock += ms;
        throw Object.assign(new Error('B-rep import failed'), { name: 'KernelError' });
      },
      ...NO_HISTORY,
      restart: async () => {},
    });
    const run = (ms: number) => {
      clock = 0;
      // A 40 s import: a quarter is 10 s of refusals past their allowance.
      return importFcstd(mixed(12), 'X', {
        kernel: slow(ms),
        importTimeoutMs: 40_000,
        now: () => clock,
      });
    };
    // 3.5 s each, 2.5 s past the allowance: the fourth takes the share to 10 s; the rest are out.
    const a = await run(REFUSAL_ALLOWANCE_MS + 2_500);
    const reasons = a.report.leftOut.map((l) => l.reason);
    expect(reasons.slice(0, 4)).toEqual(['kernel', 'kernel', 'kernel', 'kernel']);
    expect(reasons.slice(4)).toEqual(Array.from({ length: 8 }, () => 'import-time'));
    expect(a.report.leftOut[4]?.detail).toBe(REFUSED_TIME);
    // Under the allowance a refusal costs nothing, however many (12 × 0.9 s is past the share).
    const b = await run(REFUSAL_ALLOWANCE_MS - 100);
    expect(b.report.leftOut.map((l) => l.reason)).toEqual(
      Array.from({ length: 12 }, () => 'kernel'),
    );
    expect([MAX_REFUSED_SHARE, REFUSAL_ALLOWANCE_MS]).toEqual([0.25, 1_000]);
  });
});
