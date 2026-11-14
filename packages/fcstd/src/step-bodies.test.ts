/**
 * After a stored-shape step (P6-25 S8, ADR-0144): references into the step's
 * import, patterns of features from before it, and the other FreeCAD bodies
 * of a file across a step (the walk's `settled`, `lastMeasures` and
 * `restartsAtHold` invariants).
 */

import { boxBrep } from '@extrudo/kernel/brep-test-support';
import { loadPlanegcs, type PlanegcsModule, SketchSolver } from '@extrudo/sketch';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Drift } from './check';
import { documentXml, fcstd } from './fixtures';
import { bodyParts, rectangle } from './history-fixtures';
import { type FcstdImportOptions, importFcstd } from './import';
import { nodeImportKernel } from './node-kernel-test-support';
import { P, type PartChange, partObjects } from './pattern-parts';
import { STEP_FIXTURES, stepFile } from './step-parts';

let planegcs: PlanegcsModule;
let kernel: ReturnType<typeof nodeImportKernel>;
beforeAll(async () => {
  planegcs = await loadPlanegcs();
  kernel = nodeImportKernel();
});

async function runBytes(bytes: Uint8Array, options: Partial<FcstdImportOptions> = {}) {
  const result = await importFcstd(bytes, 'Parts', {
    kernel,
    solver: new SketchSolver(planegcs),
    ...options,
  });
  return {
    ...result,
    body: result.report.bodies.find((b) => b.object === 'Body'),
    features: result.design.doc.features.map((f) => `${f.type} ${f.name}`),
  };
}

const inputsOf = (r: Awaited<ReturnType<typeof runBytes>>, id: string | undefined) =>
  JSON.stringify(r.design.doc.features.find((f) => f.id === id)?.inputs);

describe('references after a step', () => {
  it("mid_draft's fillet names an edge of the step's import", async () => {
    const r = await runBytes(stepFile('mid_draft'));
    const fillet = r.body?.mapped.at(-1);
    expect(fillet?.references).toMatchObject({ found: 1, none: 0, several: 0 });
    expect(inputsOf(r, fillet?.feature)).toContain(r.body?.steps[0]?.feature);
  }, 60_000);

  it("step_then_step's fillet names the second step's import, never the first's", async () => {
    const r = await runBytes(stepFile('step_then_step'));
    const [one, two] = r.body?.steps ?? [];
    const fillet = inputsOf(r, r.body?.mapped.at(-1)?.feature);
    expect(fillet).toContain(two?.feature);
    expect(fillet).not.toContain(one?.feature);
  }, 60_000);

  it("pad_after_step's fillet is on the boss built on the step's import", async () => {
    const r = await runBytes(stepFile('pad_after_step'));
    expect(r.body?.mapped.at(-1)?.references).toMatchObject({ found: 1 });
  }, 60_000);
});

describe('patterns of features from before a step', () => {
  it('pattern_of_earlier repeats the pocket from before the step onto the import, equal to FreeCAD', async () => {
    const r = await runBytes(stepFile('pattern_of_earlier'));
    const [pad, pocket, pattern] = r.body?.mapped ?? [];
    expect(pattern).toMatchObject({ object: 'LinearPattern', kind: 'linear' });
    expect(pad?.object).toBe('Pad');
    // Its feature is the pocket's Extrudo feature, whose own body the step's Remove took out.
    expect(inputsOf(r, pattern?.feature)).toContain(pocket?.feature);
    expect(r.body?.steps[0]?.after).toBe(2);
    expect(pattern?.drift.volume).toBeLessThan(1e-9);
  }, 60_000);

  it.each([[['Pad']], [['Pad', 'Pocket']]])(
    'a pattern of %j (the first feature) after a step is refused: the body is the stored shape now',
    async (originals) => {
      const r = await runBytes(
        stepFile('pattern_of_earlier', {
          LinearPattern: { props: { Originals: P.list(originals) } },
        }),
      );
      // The pattern joins the draft's run, which reaches the tip: the body ends on its final shape,
      // as before S8, and the report says why the pattern didn't hold.
      expect(r.body?.outcome).toBe('shape');
      expect(r.body?.stop).toMatchObject({ object: 'Draft', reason: 'type' });
      expect(r.body?.stop?.run).toMatchObject([{ object: 'LinearPattern', reason: 'original' }]);
      expect(r.body?.stop?.run?.[0]?.detail).toMatch(/a stored shape has taken the body's place/);
      expect(r.body?.steps).toEqual([]);
    },
    60_000,
  );
});

/** A box body (`Big…`) beside an S8 part, before it (`first`) or after it in the file. */
function withBig(
  name: string,
  box: { min: [number, number, number]; max: [number, number, number] },
  change: PartChange = {},
  first = true,
): Uint8Array {
  const big = bodyParts({
    name: 'BigBody',
    label: 'Big',
    sketches: [
      {
        name: 'BigSketch',
        geometry: rectangle(box.min[0], box.min[1], box.max[0], box.max[1]),
        placement: [0, 0, box.min[2]],
      },
    ],
    features: [
      {
        name: 'BigPad',
        type: 'Pad',
        sketch: 'BigSketch',
        length: box.max[2] - box.min[2],
        stored: boxBrep(box.min, box.max),
      },
    ],
  });
  const part = partObjects(name, change, { fixtures: STEP_FIXTURES });
  const objects = first ? [...big.objects, ...part.objects] : [...part.objects, ...big.objects];
  return fcstd({
    'Document.xml': documentXml(objects, { version: '1.1.4R (Git)' }),
    ...big.entries,
    ...part.entries,
  });
}

const apart = { min: [1000, 0, 0], max: [1010, 10, 10] } as {
  min: [number, number, number];
  max: [number, number, number];
};

describe('two bodies in a file, one taking a step', () => {
  it.each([
    ['before', true],
    ['after', false],
  ])(
    'the other body (%s it) is untouched',
    async (_, first) => {
      const seen: Drift[] = [];
      const r = await runBytes(withBig('step_then_step', apart, {}, first), {
        onUntouched: (d) => seen.push(d),
      });
      const big = r.report.bodies.find((b) => b.object === 'BigBody');
      expect(big?.outcome).toBe('history');
      expect(big?.bodies).toHaveLength(1);
      expect(r.design.doc.bodies?.[big?.bodies[0] as never]?.name).toBe('Big');
      expect(r.body?.outcome).toBe('history');
      expect(r.body?.steps).toHaveLength(2);
      // Each step's rebuild measured the other body when it came first: exactly as it was.
      if (first) {
        expect(seen.length).toBeGreaterThanOrEqual(2);
        for (const d of seen) expect(d).toMatchObject({ volume: 0, area: 0, corner: 0, centre: 0 });
      }
      // Neither body's Remove takes the other's bodies.
      for (const st of r.body?.steps ?? [])
        expect(inputsOf(r, st.remove)).not.toContain(big?.bodies[0]);
    },
    60_000,
  );

  it('a step that moves forward leaves the other body as it was too', async () => {
    const seen: Drift[] = [];
    const r = await runBytes(
      withBig('mid_draft', apart, { Pocket001: { props: { Length: P.float(2) } } }),
      {
        onUntouched: (d) => seen.push(d),
      },
    );
    expect(r.body?.steps[0]?.shape).toBe('Pocket001');
    expect(r.report.bodies.find((b) => b.object === 'BigBody')?.outcome).toBe('history');
    expect(seen.length).toBeGreaterThanOrEqual(2);
    for (const d of seen) expect(d).toMatchObject({ volume: 0, area: 0, corner: 0, centre: 0 });
  }, 60_000);

  it("a mirror after the step that would cut the other body doesn't hold, as S7's check says", async () => {
    // The mirrored pocket (radius 2 at x = -12, y = 4, 4 mm deep) reaches into a block there.
    const block = { min: [-14, 2, 7], max: [-10.5, 6, 9] } as typeof apart;
    const r = await runBytes(withBig('tapered_hole_then_mirror', block));
    expect(r.report.bodies.find((b) => b.object === 'BigBody')?.outcome).toBe('history');
    expect(r.body?.stop).toMatchObject({ object: 'Mirrored', reason: 'differs' });
    expect(r.body?.stop?.detail).toMatch(/another FreeCAD body/);
    // The mirror is the tip: the body's final shape comes in; the hole's step stays before it.
    expect(r.body?.outcome).toBe('shape');
    expect(r.body?.steps.map((s) => s.shape)).toEqual(['Hole']);
    expect(r.features.filter((f) => /^(import|remove) /.test(f))).toEqual([
      'remove Remove Part',
      'import Import Hole',
      'remove Remove Part',
      'import Import Part',
    ]);
  }, 60_000);
});
