/**
 * The history import's hardening (P6-25 S5, the review's fix round): body IDs
 * from the kernel, synchronous throws, the budget before a feature's work,
 * one object walked once per file, stored-shape size, expression caps and the
 * bounded cost of a profile sketch's regions. Authored files only.
 */
import { Design } from '@extrudo/api';
import { MAX_BREP_BYTES } from '@extrudo/kernel';
import { boxBrep } from '@extrudo/kernel/brep-test-support';
import { loadPlanegcs, type PlanegcsModule, SketchSolver } from '@extrudo/sketch';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { MAX_PROFILE_CURVES, profileRefs, saneRebuild } from './bodies';
import { KernelBudget } from './budget';
import { type BodySpec, historyFile, rectangle } from './history-fixtures';
import { type FcstdImportOptions, importFcstd } from './import';
import type { ImportKernel } from './import-kernel';
import { MAX_STORED_BREP_BYTES, readFcstd, storedShapeText } from './model';
import { nodeImportKernel } from './node-kernel-test-support';
import { line } from './sketch-fixtures';

let planegcs: PlanegcsModule;
let base: ReturnType<typeof nodeImportKernel>;
beforeAll(async () => {
  planegcs = await loadPlanegcs();
  base = nodeImportKernel();
});
afterEach(() => {
  vi.restoreAllMocks();
});

const BOX = boxBrep([0, 0, 0], [10, 20, 30]);
const padBody = (name = 'Body', label = 'Bracket', sketch = 'Sketch'): BodySpec => ({
  name,
  label,
  sketches: [{ name: sketch, geometry: rectangle(0, 0, 10, 20) }],
  features: [{ name: `${name}Pad`, type: 'Pad', sketch, length: 30, stored: BOX }],
});

async function run(bodies: BodySpec[], options: Partial<FcstdImportOptions> = {}) {
  const result = await importFcstd(historyFile(bodies), 'History', {
    kernel: base,
    solver: new SketchSolver(planegcs),
    ...options,
  });
  return { ...result, features: result.design.doc.features.map((f) => `${f.type} ${f.name}`) };
}

/** The node kernel with its `rebuild` answer replaced. */
const lying = (answer: (real: unknown) => unknown): ImportKernel => ({
  ...base,
  storedShapeToStep: (t, c) => base.storedShapeToStep(t, c),
  measureStoredShape: (t, c) => base.measureStoredShape(t, c),
  restart: () => base.restart(),
  rebuild: async (d, f, s) => answer(await base.rebuild(d, f, s)) as never,
});

describe('body IDs from the kernel', () => {
  const m = {
    solids: 1,
    volume: 1,
    area: 1,
    box: { min: [0, 0, 0], max: [1, 1, 1] },
    centre: [0.5, 0.5, 0.5],
  };
  const features = new Set(['f1']);
  it('takes only `<feature of the document>:<n>`, short, with measures under own keys', () => {
    expect(
      saneRebuild({ ids: ['f1:0'], bodies: { 'f1:0': m }, failed: [] }, features),
    ).toBeDefined();
    for (const id of ['constructor', '__proto__', 'f2:0', 'f1:x', 'f1', `${'f'.repeat(300)}:0`])
      expect(saneRebuild({ ids: [id], bodies: {}, failed: [] }, features)).toBeUndefined();
    // A measure under a key that is no body, and one reached through the prototype.
    expect(
      saneRebuild({ ids: ['f1:0'], bodies: { constructor: m }, failed: [] }, features),
    ).toBeUndefined();
    const parsed = JSON.parse('{"ids":["f1:0"],"bodies":{"__proto__":{"solids":1}},"failed":[]}');
    expect(saneRebuild(parsed, features)).toBeUndefined();
    const inherited = { ids: ['f1:0'], bodies: Object.create({ 'f1:0': m }), failed: [] };
    expect(saneRebuild(inherited, features)?.bodies.get('f1:0')).toBeUndefined();
  });

  for (const id of ['constructor', '__proto__', 'nowhere:0', `${'x'.repeat(5000)}:0`])
    it(`treats a rebuild naming ${id.length > 40 ? 'a very long ID' : id} as a kernel failure`, async () => {
      const r = await run([padBody()], {
        kernel: lying((real) => ({ ...(real as object), ids: [id], bodies: {} })),
      });
      expect(r.report.bodies[0]?.stop).toMatchObject({ reason: 'kernel' });
      expect(r.report.restarts).toBe(1);
      expect(r.features).toEqual(['import Import Bracket']);
      expect(
        Object.keys(r.design.doc.bodies).some((b) => b === '__proto__' || b === 'constructor'),
      ).toBe(false);
    });
});

describe('synchronous throws', () => {
  it('turn a `work` that throws before it returns a promise into a kernel outcome and a restart', async () => {
    let restarts = 0;
    const budget = new KernelBudget({ ...base, restart: async () => void restarts++ });
    const outcome = await budget.call(
      () => {
        throw new Error('could not spawn');
      },
      (_: unknown): _ is unknown => true,
    );
    expect(outcome).toEqual({ kind: 'kernel', detail: 'could not spawn' });
    expect(restarts).toBe(1);
  });

  it("stop the body when a feature's own work throws, and the import goes on", async () => {
    vi.spyOn(Design.prototype, 'feature').mockImplementation(() => {
      throw new Error(`no such feature ${'!'.repeat(1000)}`);
    });
    const r = await run([padBody()]);
    const stop = r.report.bodies[0]?.stop;
    expect(stop).toMatchObject({ reason: 'failed' });
    expect(stop?.detail?.length).toBeLessThanOrEqual(300);
    expect(r.features).toEqual(['import Import Bracket']);
  });
});

describe('the budget before a feature', () => {
  it('stops a body without touching its sketch once the import is out of time', async () => {
    let clock = 0;
    const kernel = lying((real) => {
      // The first body's one rebuild uses the whole import's time.
      clock = 1e9;
      return real;
    });
    const sketches = vi.spyOn(Design.prototype, 'sketch');
    const r = await run([padBody('A', 'First', 'SketchA'), padBody('B', 'Second', 'SketchB')], {
      kernel,
      now: () => clock,
      importTimeoutMs: 1000,
    });
    expect(r.report.bodies.map((b) => b.stop?.reason)).toEqual([undefined, 'import-time']);
    expect(sketches).toHaveBeenCalledTimes(1);
    // The shapes import after it is out of time as well.
    expect(r.report.leftOut.map((l) => [l.name, l.reason])).toEqual([['Second', 'import-time']]);
  });
});

describe('one object, one body, once per file', () => {
  it('does not map a feature a second body reaches', async () => {
    const second: BodySpec = {
      name: 'Other',
      label: 'Other',
      sketches: [],
      features: [],
      tip: 'BodyPad',
      group: ['Sketch', 'BodyPad'],
      final: BOX,
    };
    const r = await run([padBody(), second]);
    expect(r.report.bodies.map((b) => [b.mapped.length, b.stop?.reason])).toEqual([
      [1, undefined],
      [0, 'chain'],
    ]);
    expect(r.report.bodies[1]?.stop?.detail).toMatch(/feature of another body/);
  });

  it("does not try another body's sketch again, imported or not", async () => {
    const tilted = {
      name: 'Shared',
      geometry: rectangle(0, 0, 10, 20),
      placement: [0, 0, 0, 0.3, [1, 1, 0]] as BodySpec['sketches'][number]['placement'],
    };
    const a: BodySpec = { ...padBody('A', 'First', 'Shared'), sketches: [tilted] };
    const b: BodySpec = { ...padBody('B', 'Second', 'Shared'), sketches: [] };
    const r = await run([a, b]);
    expect(r.report.bodies.map((x) => x.stop?.reason)).toEqual(['sketch', 'chain']);
    expect(r.report.bodies[1]?.stop?.detail).toMatch(/belongs to another body/);
  });

  it('refuses a feature of a kind it does not map before looking at the sketch it names', async () => {
    const b: BodySpec = {
      ...padBody('B', 'Second', 'SketchB'),
      features: [
        { name: 'BPad', type: 'Pad', sketch: 'SketchB', length: 30, stored: BOX },
        { name: 'BDraft', type: 'PartDesign::Draft', sketch: 'Sketch', stored: BOX },
      ],
    };
    const r = await run([padBody(), b]);
    expect(r.report.bodies[1]?.stop).toMatchObject({ object: 'BDraft', reason: 'type' });
  });
});

describe('stored shapes too large to read', () => {
  it('uses the kernel’s limit', () => {
    expect(MAX_STORED_BREP_BYTES).toBe(MAX_BREP_BYTES);
  });

  it('are left out by the archive’s size, never inflated or decoded', () => {
    const doc = readFcstd(historyFile([padBody()]));
    const entries = doc.entries;
    let read = 0;
    (doc as { entries: typeof entries }).entries = {
      names: entries.names,
      problems: entries.problems,
      has: (name: string) => entries.has(name),
      size: (name: string) =>
        name === 'BodyPad.brp' ? MAX_STORED_BREP_BYTES + 1 : entries.size(name),
      get: (name: string) => {
        read++;
        return entries.get(name);
      },
    };
    expect(storedShapeText(doc, 'BodyPad')).toBeUndefined();
    expect(read).toBe(0);
    expect(doc.problems.at(-1)).toMatch(/more than the 32 MB/);
  });
});

describe('expressions per feature', () => {
  it('keeps at most 64 and says how many were dropped', async () => {
    const body = padBody();
    const expressions = Array.from(
      { length: 100 },
      (_, i) => `<Expression path="Length${i === 0 ? '' : `.x${i}`}" expression="${i + 1}"/>`,
    );
    (body.features[0] as { props?: string[] }).props = [
      `<Property name="ExpressionEngine" type="App::PropertyExpressionEngine">\n<ExpressionEngine count="100">${expressions.join('')}</ExpressionEngine>\n</Property>`,
    ];
    const mapped = (await run([body])).report.bodies[0]?.mapped[0];
    expect(mapped?.expressions).toHaveLength(64);
    expect(mapped?.expressionsDropped).toBe(36);
  });
});

describe("a profile sketch's cost", () => {
  it(`refuses a sketch of more than ${MAX_PROFILE_CURVES} drawn curves before its regions`, async () => {
    const body = padBody();
    (body.sketches[0] as { geometry: string[] }).geometry = [
      ...rectangle(0, 0, 10, 20),
      ...Array.from({ length: MAX_PROFILE_CURVES }, (_, i) => line(20 + i, 0, 20 + i, 1)),
    ];
    const r = await run([body]);
    expect(r.report.bodies[0]?.stop).toMatchObject({ reason: 'sketch' });
    expect(r.report.bodies[0]?.stop?.detail).toMatch(new RegExp(`more than ${MAX_PROFILE_CURVES}`));
  });

  // The worst cases at the cap, measured: a grid of crossing lines and concentric circles.
  const timed = (build: Parameters<Design['sketch']>[1]) => {
    const d = Design.create({});
    const s = d.sketch(d.origin.xy, build);
    const t = performance.now();
    const refs = profileRefs(s, true);
    return { ms: performance.now() - t, refs };
  };
  it('picks the faces of a grid of crossing lines at the cap in a few seconds', () => {
    const half = MAX_PROFILE_CURVES / 2;
    const { ms, refs } = timed((k) => {
      for (let i = 0; i < half; i++) k.line([i, -1], [i, half]);
      for (let i = 0; i < half; i++) k.line([-1, i], [half, i]);
    });
    // 249 × 249 cells: past the region cap, refused after the detection.
    expect(refs).toMatch(/62001 closed regions/);
    console.log(`grid of ${MAX_PROFILE_CURVES} lines: ${Math.round(ms)} ms`);
    // About 1–2 s unloaded (the ADR's table); room for a loaded runner.
    expect(ms).toBeLessThan(10_000);
  }, 60_000);

  it('picks the faces of concentric circles at the cap in a few seconds', () => {
    const { ms, refs } = timed((k) => {
      for (let i = 1; i <= MAX_PROFILE_CURVES; i++) k.circle([0, 0], i * 100);
    });
    // Bullseye: every other ring, from the outermost.
    expect(refs).toHaveLength(MAX_PROFILE_CURVES / 2);
    console.log(`${MAX_PROFILE_CURVES} concentric circles: ${Math.round(ms)} ms`);
    // About 1–2 s unloaded (the ADR's table); room for a loaded runner.
    expect(ms).toBeLessThan(10_000);
  }, 60_000);

  it('still picks a plate with holes and an island as FreeCAD does', () => {
    const d = Design.create({});
    const s = d.sketch(d.origin.xy, (k) => {
      k.rectangle([0, 0], [100, 100]);
      k.circle([30, 30], 10);
      k.circle([70, 70], 20);
      k.circle([70, 70], 5);
    });
    // The plate less two holes, and the island in the second.
    const refs = profileRefs(s, true);
    expect(Array.isArray(refs) && refs.length).toBe(2);
  });
});
