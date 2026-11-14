/**
 * The stored-shape step in the middle of a body (P6-25 S8, ADR-0144): the
 * parts FreeCAD made (`step-fixtures.ts`) through `importFcstd` with a kernel
 * in Node and the real solver. Each has a feature the importer doesn't map
 * between ones it does; the step brings that feature's stored shape in and
 * the features after it are rebuilt on it and checked against their own.
 */

import { importSettings } from '@extrudo/core';
import { loadPlanegcs, type PlanegcsModule, SketchSolver } from '@extrudo/sketch';
import { beforeAll, describe, expect, it } from 'vitest';
import { type FcstdImportOptions, importFcstd } from './import';
import type { ImportKernel } from './import-kernel';
import { nodeImportKernel } from './node-kernel-test-support';
import { P, type PartChange, type PartOptions } from './pattern-parts';
import { stepFile } from './step-parts';

let planegcs: PlanegcsModule;
let kernel: ReturnType<typeof nodeImportKernel>;
beforeAll(async () => {
  planegcs = await loadPlanegcs();
  kernel = nodeImportKernel();
});

/** The kernel, counting the stored-shape conversions. */
function counting(base: ImportKernel) {
  const count = { conversions: 0 };
  const k: ImportKernel = {
    ...base,
    storedShapeToStep: (...args) => {
      count.conversions++;
      return base.storedShapeToStep(...args);
    },
  };
  return { kernel: k, count };
}

export async function runStep(
  name: string,
  change: PartChange = {},
  options: Partial<FcstdImportOptions> = {},
  part: PartOptions = {},
) {
  const result = await importFcstd(stepFile(name, change, part), 'Parts', {
    kernel,
    solver: new SketchSolver(planegcs),
    ...options,
  });
  const [body] = result.report.bodies;
  return {
    ...result,
    body,
    features: result.design.doc.features.map((f) => `${f.type} ${f.name}`),
  };
}

/** Every attachment of the design is the file of an `import` feature, and each has its bytes. */
function attachmentsInUse(r: Awaited<ReturnType<typeof runStep>>) {
  const used = new Set(
    r.design.doc.features
      .filter((f) => f.type === 'import')
      .map((f) => importSettings(f.inputs as never).file as string),
  );
  const held = Object.keys(r.design.doc.attachments ?? {});
  expect(new Set(held)).toEqual(used);
  for (const id of held) expect(r.files.has(id as never)).toBe(true);
  return held.length;
}

/** Per part: the steps (each the FreeCAD features of its run) and the features live after the last. */
const EXPECTED: Record<string, { steps: string[][]; live: string[] } | 'tip'> = {
  mid_draft: { steps: [['Draft']], live: ['Pocket001', 'Fillet'] },
  mid_thickness_then_pattern: { steps: [['Thickness']], live: ['Pocket', 'LinearPattern'] },
  first_primitive: { steps: [['Box']], live: ['Pocket', 'Chamfer'] },
  two_in_a_row: { steps: [['Draft', 'Thickness']], live: ['Pocket'] },
  last_unmapped: 'tip',
  pattern_of_earlier: { steps: [['Draft']], live: ['LinearPattern'] },
  step_then_step: { steps: [['Draft'], ['Cylinder']], live: ['Pocket001', 'Fillet'] },
  tapered_hole_then_mirror: { steps: [['Hole']], live: ['Pocket', 'Mirrored'] },
  pad_after_step: { steps: [['Thickness']], live: ['Boss', 'Fillet'] },
  nothing_after: 'tip',
};

describe('the fixtures carry on from a stored shape', () => {
  it.each(Object.entries(EXPECTED))(
    '%s',
    async (name, want) => {
      const r = await runStep(name);
      const { body } = r;
      if (want === 'tip') {
        // The run reaches the tip: the body's final shape comes in as before S8.
        expect(body?.outcome).toBe('shape');
        expect(body?.steps).toEqual([]);
        expect(r.features.filter((f) => /^(import|remove) /.test(f))).toEqual([
          'remove Remove Part',
          'import Import Part',
        ]);
      } else {
        expect(body?.stop).toBeUndefined();
        expect(body?.outcome).toBe('history');
        expect(body?.steps.map((s) => s.features.map((x) => x.object))).toEqual(want.steps);
        expect(body?.heldAfterLastStep).toBe(want.live.length);
        const after = body?.steps.at(-1)?.after ?? 0;
        expect(body?.mapped.slice(after).map((m) => m.object)).toEqual(want.live);
        // One import per step, its file the run's last stored shape; no other attachment.
        expect(r.features.filter((f) => f.startsWith('import '))).toHaveLength(want.steps.length);
        expect(attachmentsInUse(r)).toBe(want.steps.length);
        // The final bodies carry the file's name, as a body with its whole history does.
        for (const id of body?.bodies ?? [])
          expect(r.design.doc.bodies?.[id as never]?.name).toMatch(/^Part/);
      }
    },
    60_000,
  );

  it('mid_draft: the features before the step stay, a Remove after the body, the import after the feature', async () => {
    const r = await runStep('mid_draft');
    expect(r.features).toEqual([
      'sketch Sketch',
      'extrude Pad',
      'offsetPlane PocketSketch plane',
      'sketch PocketSketch',
      'extrude Pocket',
      'remove Remove Part',
      'import Import Draft',
      'sketch Pocket001Sketch',
      'extrude Pocket001',
      'fillet Fillet',
    ]);
    expect(r.body?.steps[0]).toMatchObject({
      reason: 'type',
      shape: 'Draft',
      after: 2,
      features: [{ object: 'Draft', name: 'Draft', type: 'PartDesign::Draft' }],
    });
    // The Remove takes out what the pocket left.
    const remove = r.design.doc.features.find((f) => f.id === r.body?.steps[0]?.remove);
    const pocket = r.body?.mapped[1]?.feature;
    expect(JSON.stringify(remove?.inputs)).toContain(`${r.body?.mapped[0]?.feature}:0`);
    expect(pocket).toBeDefined();
  }, 60_000);

  it('step_then_step: two steps, a pocket and a fillet live on the second', async () => {
    const r = await runStep('step_then_step');
    expect(r.features).toEqual([
      'sketch Sketch',
      'extrude Pad',
      'remove Remove Part',
      'import Import Draft',
      'offsetPlane PocketSketch plane',
      'sketch PocketSketch',
      'extrude Pocket',
      'remove Remove Part',
      'import Import Cylinder',
      'sketch Pocket001Sketch',
      'extrude Pocket001',
      'fillet Fillet',
    ]);
    const [one, two] = r.body?.steps ?? [];
    expect(one).toMatchObject({ shape: 'Draft', after: 1 });
    expect(two).toMatchObject({ shape: 'Cylinder', after: 2, reason: 'type' });
    // The second Remove takes out the first step's import and what the pocket made of it.
    const remove = r.design.doc.features.find((f) => f.id === two?.remove);
    expect(JSON.stringify(remove?.inputs)).toContain(`${one?.feature}:0`);
    expect(r.body?.mapped.slice(2).map((m) => m.kind)).toEqual(['pocket', 'fillet']);
    expect(r.body?.bodies).toEqual([`${two?.feature}:0`]);
  }, 60_000);

  it('first_primitive: a step first in the body has nothing to remove', async () => {
    const r = await runStep('first_primitive');
    expect(r.features[0]).toBe('import Import Box');
    expect(r.features.some((f) => f.startsWith('remove '))).toBe(false);
    expect(r.body?.steps[0]?.remove).toBeUndefined();
  }, 60_000);
});

describe('the run rule', () => {
  it('a run is one step, and only the shape it needs is converted', async () => {
    // Draft then Thickness: one Remove, one import of the Thickness; the Draft's shape is never converted.
    const { kernel: k, count } = counting(kernel);
    const r = await runStep('two_in_a_row', {}, { kernel: k });
    expect(r.features.filter((f) => /^(import|remove) /.test(f))).toEqual([
      'remove Remove Part',
      'import Import Thickness',
    ]);
    expect(count.conversions).toBe(1);
  }, 60_000);

  it('a step moves forward when the feature after it fails too, and leaves no file behind', async () => {
    // The pocket after the draft is mapped wrongly (2 mm deep, the file's is 4): the step moves to
    // its stored shape, and the fillet (whose base it is) holds on that.
    const { kernel: k, count } = counting(kernel);
    const r = await runStep(
      'mid_draft',
      { Pocket001: { props: { Length: P.float(2) } } },
      {
        kernel: k,
      },
    );
    expect(r.body?.outcome).toBe('history');
    expect(r.body?.steps).toHaveLength(1);
    expect(r.body?.steps[0]).toMatchObject({ shape: 'Pocket001', reason: 'type' });
    expect(r.body?.steps[0]?.features.map((x) => x.object)).toEqual(['Draft', 'Pocket001']);
    expect(r.features.filter((f) => /^(import|remove) /.test(f))).toEqual([
      'remove Remove Part',
      'import Import Pocket001',
    ]);
    expect(r.body?.mapped.slice(2).map((m) => m.object)).toEqual(['Fillet']);
    expect(attachmentsInUse(r)).toBe(1);
    // The Draft's shape, for the pocket's try, and the pocket's, for the fillet's.
    expect(count.conversions).toBe(2);
  }, 60_000);

  it("a step whose shape can't come in extends the run to the next feature whose shape can", async () => {
    const r = await runStep('mid_draft', { Draft: { stored: null } });
    expect(r.body?.outcome).toBe('history');
    expect(r.body?.steps[0]?.features.map((x) => x.object)).toEqual(['Draft', 'Pocket001']);
    expect(r.body?.steps[0]?.shape).toBe('Pocket001');
    expect(r.body?.mapped.slice(2).map((m) => m.object)).toEqual(['Fillet']);
    expect(attachmentsInUse(r)).toBe(1);
  }, 60_000);

  it('a run that reaches the tip after a step was taken ends as before S8, the step taken back', async () => {
    // The pocket and the fillet both fail: the run Draft, Pocket001, Fillet reaches the tip.
    const r = await runStep('mid_draft', {
      Pocket001: { props: { Length: P.float(2) } },
      Fillet: { props: { Radius: P.float(3) } },
    });
    const before = await runStep('last_unmapped');
    expect(r.body?.outcome).toBe('shape');
    expect(r.body?.stop).toMatchObject({ object: 'Draft', reason: 'type' });
    expect(r.body?.steps).toEqual([]);
    expect(r.features).toEqual(before.features);
    expect(r.body?.bodies).toEqual(before.body?.bodies);
    expect(attachmentsInUse(r)).toBe(1);
    expect(r.report.shapes.map((s) => s.name)).toEqual(['Part']);
  }, 60_000);
});
