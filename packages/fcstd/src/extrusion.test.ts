/**
 * S13 (ADR-0144): a `Part::Extrusion` of a sketch along its normal comes in as the sketch and
 * one extrude, checked against the extrusion's stored shape as every tree node is. S11's
 * `extrusion_leaf` (a sketch extruded 12 mm, cut by a cylinder) is the right case; the same file
 * with a setting changed, so the stored shape no longer fits, is each wrong case.
 */
import { updateFeatureInputs } from '@extrudo/core';
import { loadPlanegcs, type PlanegcsModule, SketchSolver } from '@extrudo/sketch';
import { beforeAll, describe, expect, it } from 'vitest';
import { finalShapes } from './final-shapes';
import { importFcstd } from './import';
import { readFcstd } from './model';
import { nodeImportKernel } from './node-kernel-test-support';
import { type PartFileOptions, partFile } from './part-parts';
import { extrusionPlan, MAX_TREE_EXTRUSIONS, partTrees } from './part-tree';

let planegcs: PlanegcsModule;
beforeAll(async () => {
  planegcs = await loadPlanegcs();
});
const T = 120_000;

const run = (options: PartFileOptions = {}) =>
  importFcstd(partFile('extrusion_leaf', options), 'X', {
    kernel: nodeImportKernel(),
    solver: new SketchSolver(planegcs),
  });
const node = (r: Awaited<ReturnType<typeof run>>, object: string) =>
  r.report.trees.flatMap((t) => t.nodes).find((n) => n.object === object);
/** The extrusion's XML with `from` replaced by `to`. */
const set = (from: RegExp, to: string): PartFileOptions => ({
  edit: (o, xml) => (o === 'Extrude' ? xml.replace(from, to) : xml),
});

describe('a Part extrusion of a sketch (S13)', () => {
  it('comes in as a sketch and an extrude that hold, under the cut, and the tree whole', {
    timeout: T,
  }, async () => {
    const r = await run();
    expect(node(r, 'Extrude')?.outcome).toBe('feature');
    expect(r.report.trees[0]?.outcome).toBe('history');
    expect(r.design.doc.features.map((f) => `${f.type} ${f.name}`)).toEqual([
      'sketch Sketch',
      'extrude Extrude',
      'cylinder Cylinder',
      'combine Cut',
    ]);
    // Live: a longer extrude makes a taller body.
    const extrude = r.design.doc.features.find((f) => f.type === 'extrude');
    if (!extrude) throw new Error('no extrude');
    r.design.state.dispatch(
      updateFeatureInputs({
        id: extrude.id,
        inputs: { distance: { kind: 'expr', expr: '20 mm', unit: 'length' } },
      }),
    );
    const after = await nodeImportKernel().rebuild(r.design.toJSON(), r.files);
    const body = Object.values(after.bodies)[0];
    expect(body?.box.max[2]).toBeCloseTo(20, 6);
  });

  it('an extrusion at the top of the document comes in the same way', { timeout: T }, async () => {
    const r = await run({ edit: (o, xml) => (o === 'Cut' || o === 'Cylinder' ? undefined : xml) });
    expect(r.report.trees.map((t) => [t.object, t.outcome])).toEqual([['Extrude', 'history']]);
    expect(r.design.doc.features.map((f) => f.type)).toEqual(['sketch', 'extrude']);
    expect(r.report.shapes).toEqual([]);
  });

  it('each setting the stored shape doesn’t have: the check refuses it, a stored leaf', {
    timeout: T,
  }, async () => {
    for (const [what, options] of [
      ['symmetric', set(/(name="Symmetric"[^>]*>\s*<Bool value=")false/, '$1true')],
      ['reversed', set(/(name="Reversed"[^>]*>\s*<Bool value=")false/, '$1true')],
      ['two sides', set(/(name="LengthRev"[^>]*>\s*<Float value=")0/, '$15')],
      ['longer', set(/(name="LengthFwd"[^>]*>\s*<Float value=")12/, '$112.01')],
    ] as const) {
      const r = await run(options);
      expect(node(r, 'Extrude'), what).toMatchObject({ outcome: 'leaf', reason: 'differs' });
    }
  });

  it('what Extrudo’s extrude doesn’t do from a file stays a stored leaf, from the file alone', () => {
    const plan = (options: PartFileOptions) => {
      const doc = readFcstd(partFile('extrusion_leaf', options));
      return extrusionPlan(doc, doc.byName.get('Extrude') as never);
    };
    expect(plan({})).toMatchObject({ sketch: 'Sketch', forward: 12, reverse: 0 });
    expect(plan(set(/(name="TaperAngle"[^>]*>\s*<Float value=")0/, '$15'))).toMatchObject({
      reason: 'type',
      detail: 'it is tapered',
    });
    expect(plan(set(/(name="DirMode"[^>]*>\s*<Integer value=")2/, '$10'))).toMatchObject({
      reason: 'type',
    });
    expect(plan(set(/(name="Solid"[^>]*>\s*<Bool value=")true/, '$1false'))).toMatchObject({
      reason: 'type',
      detail: 'it makes no solid',
    });
    expect(plan(set(/(name="Base"[^>]*>\s*<Link value=")Sketch/, '$1Cylinder'))).toMatchObject({
      reason: 'type',
    });
    expect(plan(set(/(name="LengthFwd"[^>]*>\s*<Float value=")12/, '$11e12'))).toMatchObject({
      reason: 'value',
    });
    // Symmetric with no forward length has no length; only backwards is one side turned round.
    const symmetricZero = set(/(name="LengthFwd"[^>]*>\s*<Float value=")12/, '$10');
    expect(
      plan({
        edit: (o, xml) =>
          o === 'Extrude'
            ? xml
                .replace(/(name="LengthFwd"[^>]*>\s*<Float value=")12/, '$10')
                .replace(/(name="Symmetric"[^>]*>\s*<Bool value=")false/, '$1true')
            : xml,
      }),
    ).toMatchObject({ reason: 'value', detail: 'it has no length' });
    expect(plan(symmetricZero)).toMatchObject({ reason: 'value', detail: 'it has no length' });
    expect(
      plan({
        edit: (o, xml) =>
          o === 'Extrude'
            ? xml
                .replace(/(name="LengthFwd"[^>]*>\s*<Float value=")12/, '$10')
                .replace(/(name="LengthRev"[^>]*>\s*<Float value=")0/, '$112')
            : xml,
      }),
    ).toMatchObject({ forward: 0, reverse: 12, symmetric: false });
  });

  it('binds an expression on its length', { timeout: T }, async () => {
    const r = await run({
      edit: (o, xml) =>
        o === 'Extrude'
          ? xml.replace(
              /<ExpressionEngine count="0"><\/ExpressionEngine>/,
              '<ExpressionEngine count="1"><Expression path="LengthFwd" expression="6 * 2"/></ExpressionEngine>',
            )
          : xml,
    });
    const e = r.report.parameters.expressions.find(
      (x) => x.object === 'Extrude' && x.path === 'LengthFwd',
    );
    expect([e?.outcome, e?.detail]).toEqual(['kept', undefined]);
    expect(node(r, 'Extrude')?.outcome).toBe('feature');
  });
});

describe('the import’s extrusions are counted (S13)', () => {
  it('past MAX_TREE_EXTRUSIONS an extrusion is the stored leaf it was before', () => {
    const doc = readFcstd(partFile('extrusion_leaf'));
    const shapes = finalShapes(doc);
    expect(partTrees(doc, shapes).nodes.get('Extrude')?.kind).toBe('extrude');
    const capped = partTrees(doc, shapes, { maxExtrusions: 0 }).nodes.get('Extrude');
    expect(capped).toMatchObject({ kind: 'leaf', leaf: { reason: 'limit' } });
    expect(MAX_TREE_EXTRUSIONS).toBe(1_000);
  });
});
