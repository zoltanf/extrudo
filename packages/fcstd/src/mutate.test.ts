/**
 * Seeded hostile files (P6-25 S13, ADR-0144): our own fixture documents of every slice, each
 * mutated (`mutate.ts`), through the reader and, for a share, the whole import with the kernel
 * in Node. For every mutant: nothing throws past the entry point but a clean refusal
 * (`FcstdFormatError`), nothing runs past its bound, the same seed gives the same outcome, the
 * design that comes out passes the document schema, its expressions parse and its parameters
 * evaluate, its files are exactly its attachments, the report's shapes and left-out shapes
 * are apart, and the kernel holds no shape the design doesn't.
 *
 *   FCSTD_MUTATE_STEPS=20000 FCSTD_MUTATE_SEED=7 pnpm vitest run packages/fcstd/src/mutate.test.ts
 *
 * `FCSTD_MUTATE_STEPS` reader mutants (default 240), a tenth of them (at least 8) through the
 * whole import, on consecutive seeds so a run of 150 or more imports every base; every fifth
 * import runs twice and must give the same design and report; `FCSTD_MUTATE_SEED` the first
 * seed (default 1).
 */
import { evaluateParameters, loadDocument, parse } from '@extrudo/core';
import { loadPlanegcs, SketchSolver } from '@extrudo/sketch';
import { describe, expect, it } from 'vitest';
import { chainDocuments, chainFile } from './chain-parts';
import { FcstdFormatError } from './errors';
import { finalShapes } from './final-shapes';
import { partFile as basicPartFile, bodyFile10, bodyFile021, sheetFile } from './fixtures';
import { importFcstd } from './import';
import { readFcstd } from './model';
import { mutant } from './mutate';
import { nodeImportKernel } from './node-kernel-test-support';
import { PARAM_PARTS, paramFile } from './parameter-parts';
import { PART_DOCUMENTS, partFile } from './part-parts';
import { PATTERN_PARTS, partFile as patternFile } from './pattern-parts';
import { REF_PARTS, refFile } from './reference-parts';
import { shapesFile } from './shape-fixtures';
import { STEP_PARTS, stepFile } from './step-parts';
import { structureDocuments, structureFile } from './structure-parts';

const STEPS = Number(process.env.FCSTD_MUTATE_STEPS ?? 240);
const SEED = Number(process.env.FCSTD_MUTATE_SEED ?? 1);
const IMPORTS = Math.max(8, Math.floor(STEPS / 10));
/** One reader mutant's bound, ms (a loaded, shared machine). */
const READ_MS = 5_000;
/** One import's bound, ms: its own budget, cut for the test, and room to finish. */
const IMPORT_BUDGET_MS = 60_000;

/** Every fixture document of every slice, by a name for messages. */
function bases(): [string, Uint8Array][] {
  return [
    ['shapes', shapesFile()],
    ['body10', bodyFile10()],
    ['body021', bodyFile021()],
    ['part', basicPartFile()],
    ['sheet', sheetFile()],
    ...structureDocuments().map((n): [string, Uint8Array] => [`structure ${n}`, structureFile(n)]),
    ...chainDocuments().map((n): [string, Uint8Array] => [`chain ${n}`, chainFile(n)]),
    ...PARAM_PARTS.map((n): [string, Uint8Array] => [`param ${n}`, paramFile(n)]),
    ...PART_DOCUMENTS.map((n): [string, Uint8Array] => [`tree ${n}`, partFile(n)]),
    ...PATTERN_PARTS.map((n): [string, Uint8Array] => [`pattern ${n}`, patternFile(n)]),
    ...STEP_PARTS.map((n): [string, Uint8Array] => [`step ${n}`, stepFile(n)]),
    ...REF_PARTS.map((n): [string, Uint8Array] => [`ref ${n}`, refFile(n)]),
  ];
}

/** What the reader made of a file, as text: compared across two runs of one seed. */
function readOutcome(bytes: Uint8Array): string {
  try {
    const doc = readFcstd(bytes);
    const shapes = finalShapes(doc);
    return JSON.stringify({
      objects: doc.objects.map((o) => [o.name, o.type, Object.keys(o.properties).length]),
      shapes: shapes.map((s) => [s.object.name, s.kind]),
      problems: doc.problems,
    });
  } catch (error) {
    if (error instanceof FcstdFormatError) return `refused: ${error.message}`;
    throw error;
  }
}

/** Every `{ kind: 'expr', expr }` in a document, and its parameters' expressions. */
function expressions(doc: unknown): string[] {
  const out: string[] = [];
  const stack: unknown[] = [doc];
  while (stack.length > 0) {
    const v = stack.pop();
    if (Array.isArray(v)) stack.push(...v);
    else if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      if (o.kind === 'expr' && typeof o.expr === 'string') out.push(o.expr);
      for (const x of Object.values(o)) stack.push(x);
    }
  }
  return out;
}

/**
 * A design and its report as text two imports of one file share: IDs (random UUIDs) as their
 * order of first appearance, times left out.
 */
function comparable(doc: unknown, report: unknown): string {
  const ids = new Map<string, string>();
  return JSON.stringify({ doc, report }, (key, value) =>
    key === 'created' || key === 'modified' ? undefined : value,
  ).replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, (id) => {
    let k = ids.get(id);
    if (k === undefined) {
      k = `#${ids.size}`;
      ids.set(id, k);
    }
    return k;
  });
}

const seeds = (n: number) => Array.from({ length: n }, (_, i) => SEED + i);

describe('seeded hostile files (S13)', () => {
  it(`the reader on ${STEPS} mutants: a result or a clean refusal, bounded, the same twice`, () => {
    const files = bases();
    const counts = { read: 0, refused: 0, slowest: 0 };
    for (const seed of seeds(STEPS)) {
      const [name, file] = files[seed % files.length] as [string, Uint8Array];
      const m = mutant(file, seed);
      const again = mutant(file, seed);
      expect(again.bytes, `seed ${seed} gives other bytes`).toEqual(m.bytes);
      const start = performance.now();
      let first: string;
      try {
        first = readOutcome(m.bytes);
      } catch (error) {
        throw new Error(`seed ${seed} (${name}: ${m.steps.join('; ')}): ${(error as Error).stack}`);
      }
      const ms = performance.now() - start;
      counts.slowest = Math.max(counts.slowest, ms);
      expect(ms, `seed ${seed} (${name}: ${m.steps.join('; ')})`).toBeLessThan(READ_MS);
      expect(readOutcome(m.bytes), `seed ${seed} differs on a second read`).toBe(first);
      if (first.startsWith('refused')) counts.refused++;
      else counts.read++;
    }
    if (process.env.FCSTD_MUTATE_STEPS)
      process.stderr.write(`MUTATE reader ${JSON.stringify({ seed: SEED, ...counts })}\n`);
    expect(counts.read + counts.refused).toBe(STEPS);
  }, 3_600_000);

  it(`the whole import on ${IMPORTS} mutants: a sound design or a clean refusal`, async () => {
    const files = bases();
    const solver = new SketchSolver(await loadPlanegcs());
    const counts = { designs: 0, refused: 0, restarts: 0, slowest: 0, twice: 0 };
    const based = new Set<string>();
    for (const s of seeds(IMPORTS)) {
      // The reader's own seeds, so consecutive imports walk every base (and share its mutants).
      const [name, file] = files[s % files.length] as [string, Uint8Array];
      based.add(name);
      const m = mutant(file, s);
      const what = `seed ${s} (${name}: ${m.steps.join('; ')})`;
      const start = performance.now();
      // A kernel of its own: what it still holds at the end is the import's leak.
      const kernel = nodeImportKernel();
      let result: Awaited<ReturnType<typeof importFcstd>>;
      try {
        result = await importFcstd(m.bytes, 'Mutant', {
          kernel,
          solver,
          importTimeoutMs: IMPORT_BUDGET_MS,
          shapeTimeoutMs: 20_000,
        });
      } catch (error) {
        if (!(error instanceof FcstdFormatError))
          throw new Error(`${what}: ${(error as Error).stack}`);
        expect((await kernel.service().dispose()).liveShapes, `${what}: shapes left held`).toBe(0);
        // A clean refusal is the same refusal the second time.
        if (s % 5 === 0) {
          const again = await importFcstd(m.bytes, 'Mutant', {
            kernel: nodeImportKernel(),
            solver,
            importTimeoutMs: IMPORT_BUDGET_MS,
            shapeTimeoutMs: 20_000,
          }).then(
            () => 'a design',
            (e: unknown) => (e instanceof Error ? e.message : String(e)),
          );
          expect(again, `${what}: a second import differs`).toBe(error.message);
          counts.twice++;
        }
        counts.refused++;
        continue;
      }
      const ms = performance.now() - start;
      counts.slowest = Math.max(counts.slowest, ms);
      expect(ms, what).toBeLessThan(IMPORT_BUDGET_MS + 30_000);
      const { design, files: bytes, report } = result;
      const doc = design.toJSON();
      // The document schema, its expressions and its parameters.
      expect(() => loadDocument(JSON.parse(JSON.stringify(doc))), what).not.toThrow();
      for (const e of expressions(doc)) expect(() => parse(e), `${what}: ${e}`).not.toThrow();
      expect(() => evaluateParameters(doc), what).not.toThrow();
      // Its files are exactly its attachments: nothing of a cancelled attempt is left.
      expect([...bytes.keys()].sort(), what).toEqual(Object.keys(doc.attachments ?? {}).sort());
      // A shape is in or out, never both, and never twice.
      const ins = report.shapes.map((x) => x.object);
      const outs = new Set(report.leftOut.map((x) => x.object));
      expect(new Set(ins).size, what).toBe(ins.length);
      expect(
        ins.filter((o) => outs.has(o)),
        what,
      ).toEqual([]);
      expect(report.restarts, what).toBeLessThanOrEqual(3);
      counts.restarts += report.restarts;
      // It rebuilds, in a fresh kernel, with no failed feature.
      const fresh = nodeImportKernel();
      const rebuilt = await fresh.rebuild(doc, bytes);
      expect(rebuilt.failed, what).toEqual([]);
      await fresh.service().dispose();
      counts.designs++;
      // Its kernel (the current one, after any restart) holds no shape once its rebuild cache is
      // emptied (`dispose`).
      expect((await kernel.service().dispose()).liveShapes, `${what}: shapes left held`).toBe(0);
      // The same seed gives the same design and report: every fifth import is run again.
      if (s % 5 === 0) {
        const again = await importFcstd(m.bytes, 'Mutant', {
          kernel: nodeImportKernel(),
          solver,
          importTimeoutMs: IMPORT_BUDGET_MS,
          shapeTimeoutMs: 20_000,
        });
        expect(
          comparable(again.design.toJSON(), again.report),
          `${what}: a second import differs`,
        ).toBe(comparable(doc, report));
        counts.twice++;
      }
    }
    if (process.env.FCSTD_MUTATE_STEPS)
      process.stderr.write(
        `MUTATE import ${JSON.stringify({ seed: SEED, ...counts, bases: based.size })}\n`,
      );
    expect(counts.designs + counts.refused).toBe(IMPORTS);
  }, 7_200_000);
});
