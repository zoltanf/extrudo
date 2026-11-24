/**
 * S13's FreeCAD-made cases (ADR-0144; `final-fixtures.ts`, made with FreeCAD 1.1.4 by our own
 * `scripts/make-final-fixtures.py`): Part extrusions of sketches in every setting the importer
 * reads, and a body whose pocket sketch is attached to its pad's top face. Each outcome is
 * asserted and each body that comes in is measured against FreeCAD's own numbers.
 */
import type { Design } from '@extrudo/api';
import { type AttachmentId, updateFeatureInputs, updateParameter } from '@extrudo/core';
import { loadPlanegcs, type PlanegcsModule, SketchSolver } from '@extrudo/sketch';
import { beforeAll, describe, expect, it } from 'vitest';
import { finalBrep, finalFile, finalObject, finalXml } from './final-parts';
import { importFcstd } from './import';
import { readFcstd } from './model';
import { nodeImportKernel } from './node-kernel-test-support';
import { extrusionPlan } from './part-tree';

let planegcs: PlanegcsModule;
beforeAll(async () => {
  planegcs = await loadPlanegcs();
});
const T = 120_000;

const run = (name: string) =>
  importFcstd(finalFile(name), name, {
    kernel: nodeImportKernel(),
    solver: new SketchSolver(planegcs),
  });
type Run = Awaited<ReturnType<typeof run>>;

/** The design's live bodies, measured by a fresh rebuild, together. */
async function measured(design: Design, files: ReadonlyMap<AttachmentId, Uint8Array>) {
  const r = await nodeImportKernel().rebuild(design.toJSON(), files);
  expect(r.failed).toEqual([]);
  const ms = Object.values(r.bodies);
  const volume = ms.reduce((v, m) => v + m.volume, 0);
  const min = [0, 1, 2].map((i) => Math.min(...ms.map((m) => m.box.min[i] as number)));
  const max = [0, 1, 2].map((i) => Math.max(...ms.map((m) => m.box.max[i] as number)));
  return { solids: ms.reduce((n, m) => n + m.solids, 0), volume, box: [...min, ...max] };
}

/** The design measures as FreeCAD's record of `object` (volume within 1e-6, box within 1e-4 of its diagonal). */
async function asFreecad(r: Run, name: string, object: string) {
  const want = finalObject(name, object).measure as unknown as {
    solids: number;
    volume: number;
    box: number[];
  };
  const got = await measured(r.design, r.files);
  expect(got.solids).toBe(want.solids);
  expect(Math.abs(got.volume / want.volume - 1)).toBeLessThan(1e-6);
  const diagonal = Math.hypot(
    ...[0, 1, 2].map((i) => (want.box[i + 3] as number) - (want.box[i] as number)),
  );
  for (const [i, v] of got.box.entries())
    expect(Math.abs(v - (want.box[i] as number))).toBeLessThan(1e-4 * diagonal + 1e-6);
}

const features = (r: Run) => r.design.doc.features.map((f) => `${f.type} ${f.name}`);
const node = (r: Run, object: string) =>
  r.report.trees.flatMap((t) => t.nodes).find((n) => n.object === object);
const extrudeOf = (r: Run) => {
  const f = r.design.doc.features.find((x) => x.type === 'extrude');
  if (!f) throw new Error('no extrude');
  return f;
};

describe('Part extrusions of sketches that come in with their history (S13)', () => {
  for (const name of [
    'extrusion_forward',
    'extrusion_both',
    'extrusion_symmetric',
    'extrusion_reversed',
    'extrusion_placed',
  ])
    it(`${name}: the sketch and an extrude, measured as FreeCAD's`, { timeout: T }, async () => {
      const r = await run(name);
      expect(r.report.trees.map((t) => [t.object, t.outcome])).toEqual([['Extrude', 'history']]);
      // The tilted sketch's plane first where it needs one.
      expect(features(r).slice(-2)).toEqual(['sketch Sketch', 'extrude Extrude']);
      expect(r.report.shapes).toEqual([]);
      await asFreecad(r, name, 'Extrude');
    });

  it('extrusion_in_part: built in its part’s frame and moved by it once', {
    timeout: T,
  }, async () => {
    const r = await run('extrusion_in_part');
    expect(r.report.trees.map((t) => [t.object, t.outcome])).toEqual([['Extrude', 'history']]);
    expect(features(r)).toEqual(['sketch Sketch', 'extrude Extrude', 'move Place Extrude']);
    // FreeCAD's measure of the part: the extrusion where the part shows it.
    await asFreecad(r, 'extrusion_in_part', 'Part');
  });

  it('extrusion_bound: its length follows its spreadsheet parameter, live', {
    timeout: T,
  }, async () => {
    const r = await run('extrusion_bound');
    expect(node(r, 'Extrude')?.outcome).toBe('feature');
    const e = r.report.parameters.expressions.find(
      (x) => x.object === 'Extrude' && x.path === 'LengthFwd',
    );
    expect(e?.outcome).toBe('kept');
    await asFreecad(r, 'extrusion_bound', 'Extrude');
    const p = Object.values(r.design.doc.parameters ?? {}).find((x) => x?.name === 'height');
    if (!p) throw new Error('no height parameter');
    r.design.state.dispatch(updateParameter({ id: p.id, changes: { expression: '20 mm' } }));
    const after = await measured(r.design, r.files);
    expect(after.box[5]).toBeCloseTo(20, 6);
  });

  it('extrusion_under_cut: the extrusion of a sketch with a hole under a live cut', {
    timeout: T,
  }, async () => {
    const r = await run('extrusion_under_cut');
    expect(r.report.trees.map((t) => [t.object, t.outcome])).toEqual([['Cut', 'history']]);
    expect(features(r)).toEqual([
      'sketch Sketch',
      'extrude Extrude',
      'cylinder Cylinder',
      'combine Cut',
    ]);
    await asFreecad(r, 'extrusion_under_cut', 'Cut');
    // A longer extrusion: the cut follows on top of it.
    const before = await measured(r.design, r.files);
    r.design.state.dispatch(
      updateFeatureInputs({
        id: extrudeOf(r).id,
        inputs: { distance: { kind: 'expr', expr: '20 mm', unit: 'length' } },
      }),
    );
    const after = await measured(r.design, r.files);
    expect(after.box[5]).toBeCloseTo(20, 6);
    expect(after.volume).toBeGreaterThan(before.volume);
  });
});

describe('Part extrusions Extrudo doesn’t rebuild: the file’s shape, exactly as before (S13)', () => {
  for (const [name, detail] of [
    ['extrusion_tapered', 'it is tapered'],
    ['extrusion_custom', "it doesn't extrude along its sketch's normal"],
    ['extrusion_of_face', 'it extrudes a Part::Plane, not a sketch'],
  ] as const)
    it(`${name}: a plain shape, ${detail}`, { timeout: T }, async () => {
      const r = await run(name);
      // Refused from the file alone, with its reason (under a boolean: a stored leaf).
      const doc = readFcstd(finalFile(name));
      expect(extrusionPlan(doc, doc.byName.get('Extrude') as never)).toEqual({
        reason: 'type',
        detail,
      });
      // No tree: an extrusion at the top that isn't rebuilt is a plain shape, as before.
      expect(r.report.trees).toEqual([]);
      expect(r.report.shapes.map((s) => s.object)).toEqual(['Extrude']);
      expect(features(r)).toEqual(['import Import Extrude']);
      await asFreecad(r, name, 'Extrude');
    });
});

describe('a body’s sketch on a face (S13)', () => {
  it('body_on_face: the pocket’s sketch stays on the pad’s top face and follows it', {
    timeout: T,
  }, async () => {
    const r = await run('body_on_face');
    expect(r.report.bodies.map((b) => b.outcome)).toEqual(['history']);
    expect(r.report.bodies[0]?.sketches.map((s) => [s.sketch, s.plane])).toEqual([
      ['Sketch', 'origin'],
      ['PocketSketch', 'face'],
    ]);
    await asFreecad(r, 'body_on_face', 'Body');
    // A 16 mm pad: the pocket (a 4 mm circle, 5 deep) is still cut from its top face.
    const pad = r.design.doc.features.find((f) => f.name === 'Pad');
    if (!pad) throw new Error('no Pad');
    r.design.state.dispatch(
      updateFeatureInputs({
        id: pad.id,
        inputs: { distance: { kind: 'expr', expr: '16 mm', unit: 'length' } },
      }),
    );
    const after = await measured(r.design, r.files);
    expect(after.box[5]).toBeCloseTo(16, 6);
    expect(after.volume).toBeCloseTo(40 * 20 * 16 - Math.PI * 16 * 5, 3);
  });
});

/**
 * `extrusion_forward`'s stored shape moved `dz` along Z: one more location (a translation) in
 * its table, given to its root, whose own location is the identity.
 */
function movedForward(dz: number): string {
  const text = finalBrep('extrusion_forward', 'Extrude');
  const n = Number(/\nLocations (\d+)\n/.exec(text)?.[1]);
  const root = /\n\+1 (\d+) $/.exec(text);
  if (!root || !n) throw new Error('not the shape this test knows');
  return text
    .replace(`\nLocations ${n}\n`, `\nLocations ${n + 1}\n`)
    .replace('\nCurve2ds ', `\n1\n 1 0 0 0 \n 0 1 0 0 \n 0 0 1 ${dz} \nCurve2ds `)
    .replace(/\n\+1 \d+ $/, `\n+1 ${n + 1} `);
}

describe('a node whose check fails leaves no plane behind (S13)', () => {
  it('an extrusion under a cut that doesn’t hold at an offset, then one that does at that offset', {
    timeout: T,
  }, async () => {
    // The cut's extrusion is moved 5 mm up with its stored shape left at -3 to 12: its check
    // fails and it becomes a stored leaf (no operands, so the pass goes on), its node cancelled
    // with the plane its sketch made. A second extrusion 5 mm up, stored at 5 to 17, must make
    // its plane again, not reuse the cancelled one.
    const up = (xml: string) =>
      xml.replace(/(name="Placement"[^>]*>\s*<PropertyPlacement [^>]*Pz=")0/, '$15');
    const file = finalFile('extrusion_under_cut', {
      edit: (o, xml) => (o === 'Sketch' ? up(xml) : xml),
      extra: (['Sketch', 'Extrude'] as const).map((object) => {
        const own = finalObject('extrusion_forward', object);
        const xml = finalXml('extrusion_forward', object)
          .replaceAll(`name="${object}"`, `name="${object}2"`)
          .replace('<Link value="Sketch"/>', '<Link value="Sketch2"/>')
          .replace('file="Extrude.Shape.brp"', 'file="Extrude2.Shape.brp"');
        return { name: `${object}2`, type: own.type, xml: object === 'Sketch' ? up(xml) : xml };
      }),
      entries: { 'Extrude2.Shape.brp': movedForward(5) },
    });
    const r = await importFcstd(file, 'x', {
      kernel: nodeImportKernel(),
      solver: new SketchSolver(planegcs),
    });
    expect(
      r.report.trees.flatMap((t) => t.nodes).find((n) => n.object === 'Extrude')?.outcome,
    ).toBe('leaf');
    expect(r.report.trees.find((t) => t.object === 'Extrude2')?.outcome).toBe('history');
  });
});

describe('extrusions take only what the trees from before this slice leave (S13)', () => {
  /** `extrusion_forward` (an extrusion at the top, first in the file) and `extrusion_under_cut`'s cut after it. */
  const file = () =>
    finalFile('extrusion_forward', {
      extra: (['Sketch', 'Extrude', 'Cylinder', 'Cut'] as const).map((object) => {
        const own = finalObject('extrusion_under_cut', object);
        const rename = (x: string) => (x === 'Sketch' || x === 'Extrude' ? `${x}2` : x);
        const xml = finalXml('extrusion_under_cut', object)
          .replaceAll(`name="${object}"`, `name="${rename(object)}"`)
          .replace('<Link value="Sketch"/>', '<Link value="Sketch2"/>')
          .replace('<Link value="Extrude"/>', '<Link value="Extrude2"/>')
          .replace(`file="${object}.Shape.brp"`, `file="${rename(object)}.Shape.brp"`);
        return { name: rename(object), type: own.type, xml };
      }),
      entries: Object.fromEntries(
        (['Extrude', 'Cylinder', 'Cut'] as const).map((object) => [
          `${object === 'Extrude' ? 'Extrude2' : object}.Shape.brp`,
          finalBrep('extrusion_under_cut', object),
        ]),
      ),
    });
  const outcomes = (r: Run) => r.report.trees.map((t) => [t.object, t.outcome]);

  it('at the import’s objects: the cut keeps its history, the extrusion stays a plain shape', {
    timeout: T,
  }, async () => {
    const r = await importFcstd(file(), 'x', {
      kernel: nodeImportKernel(),
      solver: new SketchSolver(planegcs),
      maxImportTreeNodes: 3,
    });
    expect(outcomes(r)).toEqual([['Cut', 'history']]);
    expect(r.report.shapes.map((x) => x.object)).toEqual(['Extrude']);
  });

  it('at the trees’ features: the cut keeps its history', { timeout: T }, async () => {
    const r = await importFcstd(file(), 'x', {
      kernel: nodeImportKernel(),
      solver: new SketchSolver(planegcs),
      maxTreeFeatures: 3,
    });
    expect(outcomes(r)[0]).toEqual(['Cut', 'history']);
    expect(r.report.shapes.map((x) => x.object)).toContain('Extrude');
  });
});
