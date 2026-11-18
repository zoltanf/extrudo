/**
 * Every S12a fixture document, new grammar (P6-25, ADR-0144): each chain's outcome, the timeline
 * in order, the bodies left with their names and visibility, and each tip measured against
 * FreeCAD's own numbers for it.
 */
import { loadPlanegcs, type PlanegcsModule, SketchSolver } from '@extrudo/sketch';
import { beforeAll, describe, expect, it } from 'vitest';
import { asOldFile, chainCase, chainDocuments, chainFile, type OldVersion } from './chain-parts';
import { importFcstd } from './import';
import { nodeImportKernel } from './node-kernel-test-support';

let planegcs: PlanegcsModule;
let kernel: ReturnType<typeof nodeImportKernel>;
beforeAll(async () => {
  planegcs = await loadPlanegcs();
  kernel = nodeImportKernel();
});

const run = (bytes: Uint8Array) =>
  importFcstd(bytes, 'Chains', { kernel, solver: new SketchSolver(planegcs) });

/** Where the chain's steps come from: a foreign base's shape, as one step before the features. */
interface Expected {
  readonly chains: Readonly<Record<string, string>>;
  readonly features: readonly string[];
  readonly bodies: readonly string[];
  /** The sketches' planes, chain by chain. */
  readonly planes?: Readonly<Record<string, readonly string[]>>;
}

const pair = (sketch: string, feature: string) => [`sketch ${sketch}`, `extrude ${feature}`];

const EXPECTED: Readonly<Record<string, Expected>> = {
  pad_only: {
    chains: { Pad: 'whole' },
    features: ['planeAtAngle Sketch plane', 'offsetPlane Sketch plane', ...pair('Sketch', 'Pad')],
    bodies: ['Pad'],
    planes: { Pad: ['angle-offset'] },
  },
  pad_pocket: {
    chains: { Pocket: 'whole' },
    features: [...pair('PadSketch', 'Pad'), ...pair('Sketch001', 'Pocket')],
    bodies: ['Pocket'],
    planes: { Pocket: ['origin', 'face'] },
  },
  chain_five: {
    chains: { Lug: 'whole' },
    features: [
      ...pair('PadSketch', 'Pad'),
      ...pair('Sketch001', 'Hole'),
      ...pair('Sketch002', 'Boss'),
      ...pair('Sketch003', 'Recess'),
      ...pair('Sketch004', 'Lug'),
    ],
    bodies: ['Lug'],
    planes: { Lug: ['origin', 'face', 'face', 'face', 'face'] },
  },
  pad_kinds: {
    chains: { Symmetric: 'whole', Reversed: 'whole', TwoSides: 'whole' },
    features: [
      ...pair('SketchA', 'Symmetric'),
      ...pair('SketchB', 'Reversed'),
      ...pair('SketchC', 'TwoSides'),
    ],
    bodies: ['Symmetric', 'Reversed', 'TwoSides'],
  },
  revolved: {
    chains: { Groove: 'whole' },
    features: ['sketch Sketch', 'revolve Revolution', 'sketch Sketch001', 'revolve Groove'],
    bodies: ['Groove'],
  },
  dressups: {
    chains: { Chamfer: 'whole' },
    features: [
      ...pair('PadSketch', 'Pad'),
      'fillet Fillet',
      ...pair('Sketch001', 'Pocket'),
      'chamfer Chamfer',
    ],
    bodies: ['Chamfer'],
  },
  patterns: {
    chains: { Mirrored: 'whole' },
    features: [
      ...pair('PadSketch', 'Pad'),
      ...pair('Sketch001', 'Pocket'),
      'rectangularPattern LinearPattern',
      ...pair('Sketch002', 'Boss'),
      'constructionPoint PolarPattern point 1',
      'constructionPoint PolarPattern point 2',
      'axisThroughPoints PolarPattern axis',
      'circularPattern PolarPattern',
      ...pair('Sketch003', 'Corner'),
      'constructionPoint Mirrored point 1',
      'constructionPoint Mirrored point 2',
      'constructionPoint Mirrored point 3',
      'planeThroughPoints Mirrored plane',
      'mirror Mirrored',
    ],
    bodies: ['Mirrored'],
  },
  on_part_box: {
    chains: { Pocket: 'steps:foreign-base' },
    features: ['import Import Box', ...pair('Sketch', 'Pad'), ...pair('Sketch001', 'Pocket')],
    bodies: ['Pocket'],
    planes: { Pocket: ['face', 'face'] },
  },
  on_part_cut: {
    chains: { Pad: 'steps:foreign-base' },
    features: ['import Import Cut', ...pair('Sketch', 'Pad')],
    bodies: ['Pad'],
  },
  branch: {
    chains: { PocketA: 'whole', PocketB: 'whole' },
    features: [
      ...pair('PadSketch', 'Pad'),
      ...pair('Sketch001', 'PocketA'),
      ...pair('PadSketch', 'Pad'),
      ...pair('Sketch002', 'PocketB'),
    ],
    bodies: ['PocketA', 'PocketB'],
  },
  in_part: {
    chains: { Pocket: 'whole', Loose: 'whole' },
    features: [
      ...pair('PadSketch', 'Pad'),
      ...pair('Sketch001', 'Pocket'),
      ...pair('LooseSketch', 'Loose'),
    ],
    bodies: ['Pocket', 'Loose'],
  },
  long_chain: {
    chains: { Hole11: 'whole' },
    features: [
      ...pair('PadSketch', 'Pad'),
      ...Array.from({ length: 12 }, (_, i) => pair(`HoleSketch${i}`, `Hole${i}`)).flat(),
    ],
    bodies: ['Hole11'],
  },
  bound: {
    chains: { Pocket: 'whole' },
    features: [...pair('Sketch', 'Pad'), ...pair('Sketch001', 'Pocket')],
    bodies: ['Pocket'],
  },
};

const outcomeOf = (b: { outcome: string; steps: readonly { reason: string }[] }) =>
  b.outcome !== 'history'
    ? b.outcome
    : b.steps.length > 0
      ? `steps:${b.steps.map((s) => s.reason).join(',')}`
      : 'whole';

describe('loose chains, new grammar', () => {
  it('has an expectation for each document', () => {
    expect([...Object.keys(EXPECTED), 'tip_in_tree'].sort()).toEqual(chainDocuments().sort());
  });

  it('tip_in_tree: the chains come in with their history under a live cut and a live fuse', {
    timeout: 120_000,
  }, async () => {
    const { report, design, files } = await run(chainFile('tip_in_tree'));
    expect(report.trees.map((t) => [t.object, t.outcome])).toEqual([
      ['Cut', 'history'],
      ['Fusion', 'history'],
    ]);
    expect(
      report.trees.flatMap((t) => t.nodes.map((n) => [n.object, n.outcome, n.body?.loose])),
    ).toEqual([
      ['Pocket', 'body', {}],
      ['Cylinder', 'feature', undefined],
      ['Cut', 'feature', undefined],
      ['Slab', 'body', {}],
      ['Box', 'feature', undefined],
      ['Fusion', 'feature', undefined],
    ]);
    expect(design.doc.features.map((f) => `${f.type} ${f.name}`)).toEqual([
      ...pair('PadSketch', 'Pad'),
      ...pair('Sketch001', 'Pocket'),
      'cylinder Cylinder',
      'combine Cut',
      ...pair('SlabSketch', 'Slab'),
      'box Box',
      'combine Fusion',
    ]);
    expect(design.doc.features.filter((f) => f.type === 'import')).toEqual([]);
    const rebuilt = await kernel.rebuild(design.toJSON(), files);
    expect(rebuilt.failed).toEqual([]);
    const volumes = Object.values(rebuilt.bodies).map((m) => m.volume);
    for (const root of ['Cut', 'Fusion']) {
      const fc = chainCase('tip_in_tree').objects.find((o) => o.object === root)?.measure;
      expect(volumes.some((v) => Math.abs(v / (fc?.volume ?? 1) - 1) < 1e-6)).toBe(true);
    }
  });

  it.each(Object.keys(EXPECTED))('%s', { timeout: 120_000 }, async (name) => {
    const want = EXPECTED[name] as Expected;
    const { report, design, files } = await run(chainFile(name));
    const chains = report.bodies.filter((b) => b.loose);
    expect(Object.fromEntries(chains.map((c) => [c.object, outcomeOf(c)]))).toEqual(want.chains);
    expect(design.doc.features.map((f) => `${f.type} ${f.name}`)).toEqual(want.features);
    expect(
      Object.values(design.doc.bodies ?? {}).map(
        (b) => `${b.name}${b.visible === false ? ' (hidden)' : ''}`,
      ),
    ).toEqual(want.bodies);
    expect(report.finalShapes).toBe(chainCase(name).roots.length);
    for (const [tip, planes] of Object.entries(want.planes ?? {}))
      expect(chains.find((c) => c.object === tip)?.sketches.map((s) => s.plane)).toEqual(planes);

    // Every feature held against its own stored shape, and each tip measures as FreeCAD says.
    const rebuilt = await kernel.rebuild(design.toJSON(), files);
    expect(rebuilt.failed).toEqual([]);
    for (const c of chains) {
      expect(c.mapped.length).toBe(c.features);
      for (const m of c.mapped) expect(m.drift.volume, m.object).toBeLessThan(1e-6);
      const fc = chainCase(name).objects.find((o) => o.object === c.object)?.measure;
      if (!fc) throw new Error(`${c.object} has no measure`);
      const ms = c.bodies.map((b) => rebuilt.bodies[b]);
      const sum = (f: (m: NonNullable<(typeof ms)[number]>) => number) =>
        ms.reduce((v, m) => v + (m ? f(m) : 0), 0);
      expect(sum((m) => m.solids), c.object).toBe(fc.solids);
      expect(Math.abs(sum((m) => m.volume) / fc.volume - 1), c.object).toBeLessThan(1e-6);
      expect(Math.abs(sum((m) => m.area) / fc.area - 1), c.object).toBeLessThan(1e-6);
    }
  });

  it('a chain is told from a body, and a foreign base is named', { timeout: 60_000 }, async () => {
    const { report } = await run(chainFile('on_part_box'));
    expect(report.bodies[0]?.loose).toEqual({ foreignBase: 'Box' });
  });
});

const OLD: readonly (readonly [string, OldVersion])[] = [
  ['pad_pocket', '0.14'],
  ['chain_five', '0.14'],
  ['pad_kinds', '0.14'],
  ['revolved', '0.14'],
  ['dressups', '0.14'],
  ['patterns', '0.14'],
  ['branch', '0.14'],
  ['long_chain', '0.14'],
  ['bound', '0.16'],
];

describe('loose chains, old grammar', () => {
  it.each(OLD)('%s as %s comes in as the new form does', { timeout: 120_000 }, async (name, v) => {
    const fresh = await run(chainFile(name));
    const old = await run(asOldFile(name, v));
    const timeline = (r: typeof fresh) => r.design.doc.features.map((f) => `${f.type} ${f.name}`);
    expect(timeline(old)).toEqual(timeline(fresh));
    expect(old.report.bodies.map(outcomeOf)).toEqual(fresh.report.bodies.map(outcomeOf));
    const measures = async (r: typeof fresh) => {
      const rebuilt = await kernel.rebuild(r.design.toJSON(), r.files);
      return r.report.bodies.flatMap((b) => b.bodies.map((id) => rebuilt.bodies[id]));
    };
    const [a, b] = [await measures(old), await measures(fresh)];
    expect(a.length).toBe(b.length);
    a.forEach((m, i) => {
      expect(Math.abs((m?.volume ?? 0) / (b[i]?.volume ?? 1) - 1)).toBeLessThan(1e-9);
      expect(Math.abs((m?.area ?? 0) / (b[i]?.area ?? 1) - 1)).toBeLessThan(1e-9);
    });
  });
});
