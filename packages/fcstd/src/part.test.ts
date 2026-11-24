/**
 * The Part workbench's trees (P6-25 S11, ADR-0144): the 22 documents FreeCAD
 * made (`part-fixtures.ts`) through `importFcstd` with a kernel in Node. Per
 * case: each object's outcome, the timeline's features in order, the bodies
 * left with their names and visibility, and every top body measured again
 * against FreeCAD's own numbers for that object.
 */
import { loadPlanegcs, type PlanegcsModule, SketchSolver } from '@extrudo/sketch';
import { beforeAll, describe, expect, it } from 'vitest';
import { HISTORY_VOLUME_TOLERANCE } from './check';
import { type FcstdImportOptions, importFcstd } from './import';
import { nodeImportKernel } from './node-kernel-test-support';
import { type PartFileOptions, partCase, partFile } from './part-parts';

let planegcs: PlanegcsModule;
let kernel: ReturnType<typeof nodeImportKernel>;
beforeAll(async () => {
  planegcs = await loadPlanegcs();
  kernel = nodeImportKernel();
});

export async function runPart(
  name: string,
  file: PartFileOptions = {},
  options: Partial<FcstdImportOptions> = {},
) {
  const result = await importFcstd(partFile(name, file), 'Parts', {
    kernel,
    solver: new SketchSolver(planegcs),
    ...options,
  });
  const doc = result.design.doc;
  const bodies = Object.entries(doc.bodies ?? {}).map(([id, b]) => ({
    id,
    name: (b as { name?: string }).name ?? id,
    visible: (b as { visible?: boolean }).visible !== false,
  }));
  return {
    ...result,
    features: doc.features.map((f) => `${f.type} ${f.name}`),
    bodies,
    /** Each object of every tree: `outcome` or `leaf:<reason>`. */
    outcomes: Object.fromEntries(
      result.report.trees.flatMap((t) =>
        t.nodes.map((n) => [n.object, n.outcome === 'leaf' ? `leaf:${n.reason}` : n.outcome]),
      ),
    ),
    trees: Object.fromEntries(
      result.report.trees.map((t) => [
        t.object,
        t.outcome === 'shape' || t.outcome === 'left-out' ? `${t.outcome}:${t.reason}` : t.outcome,
      ]),
    ),
  };
}

/** The design rebuilt once more: each named body's volume against FreeCAD's for that object. */
async function measuresHold(r: Awaited<ReturnType<typeof runPart>>, name: string) {
  const rebuilt = await kernel.rebuild(r.design.toJSON(), r.files);
  expect(rebuilt.failed).toEqual([]);
  const c = partCase(name);
  for (const t of r.report.trees) {
    if (t.outcome !== 'history' && t.outcome !== 'leaves') continue;
    const fc = c.objects.find((o) => o.object === t.object)?.measure;
    expect(fc, t.object).toBeDefined();
    const ms = t.bodies.map((b) => rebuilt.bodies[b]);
    expect(ms.every((m) => m !== undefined)).toBe(true);
    const volume = ms.reduce((v, m) => v + (m?.volume ?? 0), 0);
    expect(
      ms.reduce((n, m) => n + (m?.solids ?? 0), 0),
      t.object,
    ).toBe(fc?.solids);
    expect(
      Math.abs(volume - (fc?.volume as number)) / (fc?.volume as number),
      t.object,
    ).toBeLessThan(HISTORY_VOLUME_TOLERANCE);
  }
  // Every checked node held within the history check's tolerances.
  for (const t of r.report.trees)
    for (const n of t.nodes)
      if (n.outcome === 'feature') expect(n.drift?.volume ?? 1, n.object).toBeLessThanOrEqual(1e-6);
}

const T = 120_000;

describe('Part trees come in with their history', () => {
  it('box_cyl_cut: a box, a cylinder and the cut', { timeout: T }, async () => {
    const r = await runPart('box_cyl_cut');
    expect(r.trees).toEqual({ Cut: 'history' });
    expect(r.outcomes).toEqual({ Box: 'feature', Cylinder: 'feature', Cut: 'feature' });
    expect(r.features).toEqual(['box Box', 'cylinder Cylinder', 'combine Cut']);
    expect(r.bodies.map((b) => b.name)).toEqual(['Cut']);
    expect(r.report.shapes).toEqual([]);
    expect(r.files.size).toBe(0);
    await measuresHold(r, 'box_cyl_cut');
  });

  it('fuse_common: a fuse and a common', { timeout: T }, async () => {
    const r = await runPart('fuse_common');
    expect(r.trees).toEqual({ Fusion: 'history', Common: 'history' });
    expect(r.features).toEqual([
      'box Box',
      'box Box001',
      'combine Fusion',
      'box Box002',
      'sphere Sphere',
      'combine Common',
    ]);
    expect(r.bodies.map((b) => b.name)).toEqual(['Fusion', 'Common']);
    await measuresHold(r, 'fuse_common');
  });

  it('multi: a MultiFuse as one combine, a MultiCommon as a chain', { timeout: T }, async () => {
    const r = await runPart('multi');
    expect(r.trees).toEqual({ Fusion: 'history', Common: 'history' });
    // Extrudo's intersect with several tools is the target and the tools' union, not the
    // common of all: a MultiCommon is the common of each with the next.
    expect(r.features).toEqual([
      'box Box',
      'cylinder Cylinder',
      'box Box001',
      'combine Fusion',
      'box Box002',
      'box Box003',
      'cylinder Cylinder001',
      'combine Common',
      'combine Common 2',
    ]);
    await measuresHold(r, 'multi');
  });

  it('nested: four booleans, a fuse of shapes that do not touch kept apart', {
    timeout: T,
  }, async () => {
    const r = await runPart('nested');
    expect(r.trees).toEqual({ Common: 'history' });
    expect(Object.values(r.outcomes).every((o) => o === 'feature')).toBe(true);
    const holes = r.report.trees[0]?.nodes.find((n) => n.object === 'Holes');
    expect(holes?.apart).toBe(true);
    expect(holes?.features).toEqual([]);
    expect(r.features).toEqual([
      'box Box',
      'cylinder Cylinder',
      'combine Fusion',
      'cylinder Cylinder001',
      'cylinder Cylinder002',
      'combine Cut',
      'box Box001',
      'combine Common',
    ]);
    expect(r.bodies.map((b) => b.name)).toEqual(['Common']);
    await measuresHold(r, 'nested');
  });

  it('placed_primitives: by their own inputs, three with a move', { timeout: T }, async () => {
    const r = await runPart('placed_primitives');
    const placed = Object.fromEntries(r.report.trees.map((t) => [t.object, t.nodes[0]?.placed]));
    expect(placed).toEqual({
      BoxMoved: 'inputs',
      BoxTurnedZ: 'inputs',
      BoxQuarterX: 'inputs',
      BoxTilted: 'move',
      CylMoved: 'inputs',
      CylAlongX: 'inputs',
      CylAlongMinusY: 'inputs',
      CylDown: 'inputs',
      CylTilted: 'move',
      SphereMoved: 'inputs',
      SphereTilted: 'inputs',
    });
    expect(Object.values(r.trees).every((t) => t === 'history')).toBe(true);
    expect(r.features.filter((f) => f.startsWith('move'))).toEqual([
      'move Place BoxTilted',
      'move Place CylTilted',
    ]);
    await measuresHold(r, 'placed_primitives');
  });

  it('torus_cone: the toruses come in, the cones as today', { timeout: T }, async () => {
    const r = await runPart('torus_cone');
    expect(r.trees).toEqual({ Torus: 'history', TorusTilted: 'history' });
    expect(r.features).toEqual([
      'torus Torus',
      'torus TorusTilted',
      'move Place TorusTilted',
      'import Import Cone',
      'import Import ConePointed',
    ]);
    await measuresHold(r, 'torus_cone');
  });

  it('placed_booleans: a boolean’s own placement is a move of its result', {
    timeout: T,
  }, async () => {
    const r = await runPart('placed_booleans');
    expect(Object.values(r.trees)).toEqual(['history', 'history', 'history', 'history']);
    expect(r.features.filter((f) => f.startsWith('move'))).toEqual([
      'move Place CutMoved',
      'move Place FusionTilted',
      'move Place Inner',
      'move Place MultiMoved',
    ]);
    await measuresHold(r, 'placed_booleans');
  });

  it('shared_operand: a copy for every use but the last', { timeout: T }, async () => {
    const r = await runPart('shared_operand');
    expect(Object.values(r.trees)).toEqual(['history', 'history', 'history', 'history']);
    expect(r.features).toEqual([
      'box Box',
      'cylinder Cylinder',
      'move Copy Cylinder',
      'combine Cut',
      'box Box001',
      'combine Cut001',
      'box Box002',
      'cylinder Cylinder001',
      'move Copy Box002',
      'combine Cut002',
      'box Box003',
      'combine Fusion',
    ]);
    expect(r.bodies.map((b) => b.name)).toEqual(['Cut', 'Cut001', 'Cut002', 'Fusion']);
    await measuresHold(r, 'shared_operand');
  });

  it('visible_operand: an operand FreeCAD shows is used up all the same', {
    timeout: T,
  }, async () => {
    const r = await runPart('visible_operand');
    expect(r.trees).toEqual({ Cut: 'history' });
    expect(r.bodies.map((b) => b.name)).toEqual(['Cut']);
  });

  it('hidden_root: a hidden top comes in hidden', { timeout: T }, async () => {
    const r = await runPart('hidden_root');
    expect(r.bodies).toEqual([
      expect.objectContaining({ name: 'Cut', visible: false }),
      expect.objectContaining({ name: 'Box001', visible: true }),
    ]);
  });

  it('refine: the check passes the refined booleans; the faces say what differs', {
    timeout: T,
  }, async () => {
    const r = await runPart('refine');
    expect(r.trees).toEqual({ Fusion: 'history', FusionRefined: 'history', CutRefined: 'history' });
    const faces = Object.fromEntries(
      r.report.trees.flatMap((t) => t.nodes.filter((n) => n.faces).map((n) => [n.object, n.faces])),
    );
    // The solids are the same; the faces differ both ways: Extrudo's join always merges the
    // faces a fuse leaves on one surface (FreeCAD's refine), its cut never does.
    expect(faces).toEqual({
      Fusion: { stored: 10, rebuilt: 6 },
      Step: { stored: 12, rebuilt: 10 },
      CutRefined: { stored: 6, rebuilt: 8 },
    });
    await measuresHold(r, 'refine');
  });

  it('split: a cut that leaves two solids is two bodies', { timeout: T }, async () => {
    const r = await runPart('split');
    expect(r.trees).toEqual({ Cut: 'history' });
    expect(r.bodies.map((b) => b.name)).toEqual(['Cut', 'Cut 2']);
    await measuresHold(r, 'split');
  });

  it('in_containers: one move of each top for its containers', { timeout: T }, async () => {
    const r = await runPart('in_containers');
    expect(r.trees).toEqual({ Cut: 'history', Fusion: 'history', Cut001: 'history' });
    expect(r.features.filter((f) => f.startsWith('move'))).toEqual([
      'move Place Cut',
      'move Place Cut001',
    ]);
    expect(r.report.trees.map((t) => t.containerMove !== undefined)).toEqual([true, false, true]);
  });

  it('deep_chain: twelve cuts in a row', { timeout: T }, async () => {
    const r = await runPart('deep_chain');
    expect(r.trees).toEqual({ Cut011: 'history' });
    expect(r.features).toHaveLength(25);
    expect(r.bodies.map((b) => b.name)).toEqual(['Cut011']);
    await measuresHold(r, 'deep_chain');
  });

  it('fillets_chamfers: a fillet and chamfers by S6’s matcher; the others as today', {
    timeout: T,
  }, async () => {
    const r = await runPart('fillets_chamfers');
    expect(r.trees).toEqual({
      Chamfer: 'history',
      ChamferRim: 'history',
      ChamferTwoSizes: 'history',
      FilletVariable: 'shape:edges',
      FilletTwoRadii: 'shape:edges',
      CutAbove: 'history',
    });
    const cut = r.report.trees.find((t) => t.object === 'CutAbove');
    expect(cut?.nodes.map((n) => `${n.type} ${n.outcome}`)).toEqual([
      'Part::Box feature',
      'Part::Cylinder feature',
      'Part::Cut feature',
      'Part::Fillet feature',
      'Part::Cylinder feature',
      'Part::Cut feature',
    ]);
    expect(cut?.nodes.find((n) => n.object === 'Fillet')?.references?.found).toBe(4);
    await measuresHold(r, 'fillets_chamfers');
  });
});

describe('Part trees with the file’s own shapes below a live boolean', () => {
  it('stored_leaf: a plain stored shape as a base and as a tool', { timeout: T }, async () => {
    const r = await runPart('stored_leaf');
    expect(r.trees).toEqual({ Cut: 'leaves', Cut001: 'leaves' });
    expect(r.outcomes).toEqual({
      Imported: 'leaf:type',
      Cylinder: 'feature',
      Cut: 'feature',
      Box: 'feature',
      Tool: 'leaf:type',
      Cut001: 'feature',
    });
    expect(r.features).toEqual([
      'import Import Imported',
      'cylinder Cylinder',
      'combine Cut',
      // The file's own shapes come first in a tree: one that can't come in is known before
      // anything is built on the way to it.
      'import Import Tool',
      'box Box',
      'combine Cut001',
    ]);
    expect(r.files.size).toBe(2);
    await measuresHold(r, 'stored_leaf');
  });

  it('extrusion_leaf: a Part extrusion of a sketch as the base, an extrude (S13)', {
    timeout: T,
  }, async () => {
    const r = await runPart('extrusion_leaf');
    expect(r.outcomes).toEqual({ Extrude: 'feature', Cylinder: 'feature', Cut: 'feature' });
    await measuresHold(r, 'extrusion_leaf');
  });

  it('other_primitives: the prism cut; the part primitives as today', { timeout: T }, async () => {
    const r = await runPart('other_primitives');
    expect(r.trees).toEqual({
      CylQuarter: 'shape:partial',
      SphereCap: 'shape:partial',
      SphereWedge: 'shape:partial',
      TorusPart: 'shape:partial',
      CylSkewed: 'shape:partial',
      Cut: 'leaves',
    });
    expect(r.outcomes).toEqual({ Box: 'feature', Prism001: 'leaf:type', Cut: 'feature' });
    // The ellipsoid, prism and wedge are no tree tops: S3's shapes, as before.
    expect(r.report.shapes.map((s) => s.name)).toEqual([
      'CylQuarter',
      'SphereCap',
      'SphereWedge',
      'TorusPart',
      'Prism',
      'Wedge',
      'CylSkewed',
    ]);
  });

  it('mirrors: the common of a tilted mirror; the mirror itself as today', {
    timeout: T,
  }, async () => {
    const r = await runPart('mirrors');
    expect(r.trees).toEqual({ Common: 'leaves' });
    expect(r.outcomes).toEqual({
      MirrorTilted: 'leaf:type',
      Box002: 'feature',
      Common: 'feature',
    });
    expect(r.report.shapes.map((s) => s.name)).toEqual(['Mirror']);
  });

  it('body_operand: the body with its history, then the cut and the fuse', {
    timeout: T,
  }, async () => {
    const r = await runPart('body_operand');
    expect(r.trees).toEqual({ Fusion: 'history' });
    expect(r.outcomes).toEqual({
      Body: 'body',
      Cylinder: 'feature',
      Cut: 'feature',
      Box: 'feature',
      Fusion: 'feature',
    });
    const body = r.report.trees[0]?.nodes[0]?.body;
    expect(body?.stop).toBeUndefined();
    expect(body?.mapped.map((m) => m.kind)).toEqual(['pad', 'pocket']);
    expect(r.report.bodies).toEqual([]);
    expect(r.bodies.map((b) => b.name)).toEqual(['Fusion']);
    await measuresHold(r, 'body_operand');
  });

  it('compounds: a compound as a tool stands for its members; as a base it is a leaf', {
    timeout: T,
  }, async () => {
    const r = await runPart('compounds');
    // The compound at the top comes in as its members (S12b): two trees of one primitive each.
    expect(r.trees).toEqual({
      Cut: 'history',
      Cut001: 'leaves',
      Box: 'history',
      Cylinder: 'history',
    });
    expect(r.outcomes).toEqual({
      Box001: 'feature',
      Cylinder001: 'feature',
      Cylinder002: 'feature',
      Holes: 'members',
      Cut: 'feature',
      Blocks: 'leaf:compound',
      Box004: 'feature',
      Cut001: 'feature',
      Box: 'feature',
      Cylinder: 'feature',
    });
    // A compound at the top comes in as its members; the base compound's two solids are cut each.
    expect(r.report.shapes.map((s) => s.name)).toEqual([]);
    expect(r.report.compounds.map((c) => [c.name, c.outcome])).toEqual([['Compound', 'members']]);
    expect(r.features).toContain('combine Cut001 2');
    await measuresHold(r, 'compounds');
  });
});

/** A link property's target changed in an object's XML. */
const relink = (xml: string, property: string, to: string) =>
  xml.replace(
    new RegExp(`(<Property name="${property}" type="App::PropertyLink"><Link value=")[^"]*`),
    `$1${to}`,
  );

describe('A node read wrong is refused by its check', () => {
  it('a size read wrong: the box is the file’s shape, the cut above it holds', {
    timeout: T,
  }, async () => {
    const r = await runPart('box_cyl_cut', {
      edit: (o, xml) =>
        o === 'Box'
          ? xml.replace(
              'name="Length" type="App::PropertyLength"><Float value="30"',
              'name="Length" type="App::PropertyLength"><Float value="31"',
            )
          : xml,
    });
    expect(r.outcomes).toEqual({ Box: 'leaf:differs', Cylinder: 'feature', Cut: 'feature' });
    expect(r.trees).toEqual({ Cut: 'leaves' });
    expect(r.features).toEqual(['import Import Box', 'cylinder Cylinder', 'combine Cut']);
    expect(r.report.trees[0]?.passes).toBe(1);
  });

  it('a placement read wrong: the cylinder is the file’s shape', { timeout: T }, async () => {
    const r = await runPart('box_cyl_cut', {
      edit: (o, xml) => (o === 'Cylinder' ? xml.replace('Px="15"', 'Px="16"') : xml),
    });
    expect(r.outcomes).toEqual({ Box: 'feature', Cylinder: 'leaf:differs', Cut: 'feature' });
  });

  it('base and tool swapped in the middle of nested: nothing of its operands stays, the common holds', {
    timeout: T,
  }, async () => {
    const r = await runPart('nested', {
      edit: (o, xml) =>
        o === 'Cut' ? relink(relink(xml, 'Base', 'Holes'), 'Tool', 'Fusion') : xml,
    });
    expect(r.trees).toEqual({ Common: 'leaves' });
    expect(r.outcomes).toEqual({
      Cut: expect.stringMatching(/^leaf:(differs|failed)$/),
      Box001: 'feature',
      Common: 'feature',
    });
    // The second pass built the cut as the file's shape from the start: no box, fusion or holes.
    expect(r.features).toEqual(['import Import Cut', 'box Box001', 'combine Common']);
    expect(r.report.trees[0]?.passes).toBe(2);
    expect(r.bodies.map((b) => b.name)).toEqual(['Common']);
  });

  it('a top that fails comes in as today', { timeout: T }, async () => {
    const r = await runPart('box_cyl_cut', {
      edit: (o, xml) =>
        o === 'Cut' ? relink(relink(xml, 'Base', 'Cylinder'), 'Tool', 'Box') : xml,
    });
    expect(r.trees).toEqual({ Cut: expect.stringMatching(/^shape:(differs|failed)$/) });
    expect(r.features).toEqual(['import Import Cut']);
    expect(r.report.shapes.map((s) => s.name)).toEqual(['Cut']);
    expect(r.bodies.map((b) => b.name)).toEqual(['Cut']);
  });
});

/** Rebuilds the design and gives each body's measure by name. */
async function measured(
  design: Awaited<ReturnType<typeof runPart>>['design'],
  files: ReadonlyMap<never, Uint8Array>,
) {
  const r = await kernel.rebuild(design.toJSON(), files);
  expect(r.failed).toEqual([]);
  const names = Object.fromEntries(
    Object.entries(design.doc.bodies ?? {}).map(([id, b]) => [
      (b as { name?: string }).name ?? id,
      id,
    ]),
  );
  return (name: string) => r.bodies[names[name] as string];
}

describe('A tree is live', () => {
  it('box_cyl_cut: a box’s length and a cylinder’s place, through the commands the app uses', {
    timeout: T,
  }, async () => {
    const r = await runPart('box_cyl_cut');
    const box = r.design.doc.features.find((f) => f.type === 'box');
    const cyl = r.design.doc.features.find((f) => f.type === 'cylinder');
    const { updateFeatureInputs } = await import('@extrudo/core');
    // A literal length grows the box about its centre (Extrudo's box sits on its centre).
    r.design.state.dispatch(
      updateFeatureInputs({
        id: box?.id as never,
        inputs: { length: { kind: 'expr', expr: '40 mm', unit: 'length' } },
      }),
    );
    r.design.state.dispatch(
      updateFeatureInputs({
        id: cyl?.id as never,
        inputs: { x: { kind: 'expr', expr: '10 mm', unit: 'length' } },
      }),
    );
    const m = (await measured(r.design, r.files as never))('Cut');
    const hole = Math.PI * 16 * 10;
    expect(m?.volume).toBeCloseTo(40 * 20 * 10 - hole, 6);
    expect(m?.box.min[0]).toBeCloseTo(-5, 9);
    expect(m?.box.max[0]).toBeCloseTo(35, 9);
    // The hole moved to x = 10: the centre of mass moves away from it.
    expect(m?.centre[0]).toBeCloseTo((8000 * 15 - hole * 10) / (8000 - hole), 6);
  });

  it('bound: a parameter changed, the body measures what the changed model must', {
    timeout: T,
  }, async () => {
    const r = await runPart('bound');
    const kept = r.report.parameters.expressions.filter((e) => e.outcome === 'kept');
    expect(kept.map((e) => `${e.object}${e.path}`).sort()).toEqual([
      'BoxHeight',
      'BoxLength',
      'BoxWidth',
      'Cut.Placement.Base.z',
      'Cylinder.Placement.Base.x',
      'Cylinder.Placement.Base.y',
      'CylinderHeight',
      'CylinderRadius',
      'SphereRadius',
      'TorusRadius1',
      'TorusRadius2',
    ]);
    r.design.setParameter('length', '40 mm');
    r.design.setParameter('lift', '2 mm');
    const m = await measured(r.design, r.files as never);
    const cut = m('Cut');
    // FreeCAD's model: the box grows from its corner to 40 mm, the hole follows to length / 2, the cut lifts by 2.
    expect(cut?.box.min).toEqual([
      expect.closeTo(0, 9),
      expect.closeTo(0, 9),
      expect.closeTo(2, 9),
    ]);
    expect(cut?.box.max[0]).toBeCloseTo(40, 9);
    expect(cut?.volume).toBeCloseTo(40 * 20 * 10 - Math.PI * 16 * 10, 6);
    expect(cut?.centre[0]).toBeCloseTo(20, 6);
  });
});
