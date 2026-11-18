/**
 * What a loose chain does with a file that is wrong, and what it is once it has come in (P6-25
 * S12a, ADR-0144): the features that don't hold are stored-shape steps, a chain that can't carry
 * on comes in as today, every limit ends in a clean outcome, and what came in is live.
 */
import { setSketchGeometry, updateFeatureInputs, updateParameter } from '@extrudo/core';
import {
  loadPlanegcs,
  type PlanegcsModule,
  SketchSolver,
  settleSketches,
} from '@extrudo/sketch';
import { beforeAll, describe, expect, it } from 'vitest';
import { asOldFile, chainFile, type ChainFileOptions } from './chain-parts';
import { type FcstdImportOptions, type FcstdImportResult, importFcstd } from './import';
import { nodeImportKernel } from './node-kernel-test-support';

let planegcs: PlanegcsModule;
let kernel: ReturnType<typeof nodeImportKernel>;
beforeAll(async () => {
  planegcs = await loadPlanegcs();
  kernel = nodeImportKernel();
});

type Limits = Partial<FcstdImportOptions>;
const run = (bytes: Uint8Array, limits: Limits = {}) =>
  importFcstd(bytes, 'Chains', { kernel, solver: new SketchSolver(planegcs), ...limits });

/** Changes one object's XML. */
const editing = (object: string, change: (xml: string) => string): ChainFileOptions => ({
  edit: (name, xml) => (name === object ? change(xml) : xml),
});
const setLength = (value: number) => (xml: string) =>
  xml.replace(/(<Property name="Length"[^>]*><Float value=")[^"]*/, `$1${value}`);
const setLink = (property: string, value: string) => (xml: string) =>
  xml.replace(new RegExp(`(<Property name="${property}"[^>]*><Link value=")[^"]*`), `$1${value}`);

/** Sets one number of an object's own `Placement` (its `AttachmentOffset` has the same attributes). */
const setPlacement = (attribute: string, value: string) => (xml: string) =>
  xml.replace(/<Property name="Placement".*?<\/Property>/s, (p) =>
    p.replace(new RegExp(` ${attribute}="[^"]*"`), ` ${attribute}="${value}"`),
  );

const chainOf = (r: FcstdImportResult, tip: string) => {
  const c = r.report.bodies.find((b) => b.object === tip);
  if (!c) throw new Error(`no chain ${tip}`);
  return c;
};
const imports = (r: FcstdImportResult) =>
  r.design.doc.features.filter((f) => f.type === 'import').map((f) => f.name);

/** As today: the tip's stored shape as one `import`, and nothing lost. */
function expectAsToday(r: FcstdImportResult, tip: string, reason: string) {
  const c = chainOf(r, tip);
  expect(c.outcome).toBe('shape');
  expect(c.stop?.reason).toBe(reason);
  expect(imports(r)).toContain(`Import ${tip}`);
  expect(r.report.shapes.map((s) => s.object)).toContain(tip);
  expect(r.report.leftOut).toEqual([]);
}

describe('a feature that doesn’t hold', () => {
  it('a pad’s length read wrong is a step, and the pocket after it holds', {
    timeout: 60_000,
  }, async () => {
    const r = await run(chainFile('pad_pocket', editing('Pad', setLength(9))));
    const c = chainOf(r, 'Pocket');
    expect(c.outcome).toBe('history');
    expect(c.steps.map((s) => [s.reason, s.shape])).toEqual([['differs', 'Pad']]);
    expect(c.mapped.map((m) => m.object)).toEqual(['Pocket']);
    expect(imports(r)).toEqual(['Import Pad']);
  });

  it('a sketch’s placement read wrong likewise', { timeout: 60_000 }, async () => {
    const r = await run(
      chainFile(
        'chain_five',
        editing('Sketch001', setPlacement('Px', '1')),
      ),
    );
    const c = chainOf(r, 'Lug');
    expect(c.outcome).toBe('history');
    expect(c.steps.map((s) => [s.reason, s.shape])).toEqual([['differs', 'Hole']]);
    expect(c.mapped.map((m) => m.object)).toEqual(['Pad', 'Boss', 'Recess', 'Lug']);
  });

  it('a base named wrong likewise: the recess’s sketch on the pad, in an old file', {
    timeout: 60_000,
  }, async () => {
    const r = await run(
      asOldFile(
        'chain_five',
        '0.14',
        editing('Sketch003', (xml) => xml.replace('<LinkSub value="Boss"', '<LinkSub value="Pad"')),
      ),
    );
    const c = chainOf(r, 'Lug');
    expect(c.outcome).toBe('history');
    expect(c.steps.map((s) => s.shape)).toEqual(['Recess']);
    expect(c.mapped.at(-1)?.object).toBe('Lug');
  });

  it('a chain whose only feature fails comes in as today', { timeout: 60_000 }, async () => {
    const r = await run(chainFile('pad_only', editing('Pad', setLength(11))));
    expectAsToday(r, 'Pad', 'differs');
    expect(r.design.doc.features.map((f) => f.type)).toEqual(['import']);
  });

  it('a foreign base whose shape can’t come in leaves the chain as today', {
    timeout: 60_000,
  }, async () => {
    const r = await run(
      chainFile('on_part_cut', { brep: (o, t) => (o === 'Cut' ? undefined : t) }),
    );
    expect(chainOf(r, 'Pad').outcome).toBe('shape');
    expect(r.report.shapes.map((s) => s.object)).toEqual(['Pad']);
  });
});

describe('it is live', () => {
  /** The bodies' volume and the height of their centre of mass after a rebuild. */
  async function measure(r: FcstdImportResult) {
    const rebuilt = await kernel.rebuild(r.design.toJSON(), new Map(r.files), []);
    expect(rebuilt.failed).toEqual([]);
    const [m] = Object.values(rebuilt.bodies);
    return { volume: m?.volume as number, z: m?.centre[2] as number };
  }
  /** A block of `h` with a blind hole of radius `r`, `d` deep from its top. */
  const block = (area: number, h: number, radius: number, d: number) => {
    const hole = Math.PI * radius * radius * d;
    const volume = area * h - hole;
    return { volume, z: (area * h * (h / 2) - hole * (h - d / 2)) / volume };
  };
  const expectBlock = (got: { volume: number; z: number }, want: typeof got) => {
    expect(got.volume).toBeCloseTo(want.volume, 6);
    expect(got.z).toBeCloseTo(want.z, 6);
  };

  it.each([
    ['new', () => chainFile('bound')],
    ['0.16', () => asOldFile('bound', '0.16')],
  ])('bound (%s): the height moves the pad, and the pocket stays on its top face', {
    timeout: 60_000,
  }, async (_, file) => {
    const r = await run(file());
    expect(chainOf(r, 'Pocket').sketches.map((s) => s.plane)).toEqual(['origin', 'face']);
    const kept = r.report.parameters.expressions.filter((e) => e.outcome === 'kept');
    expect(kept.map((e) => `${e.object}.${e.path}`).sort()).toEqual([
      'Pad.Length',
      'Pocket.Length',
      'Sketch.Constraints[4]',
    ]);
    expectBlock(await measure(r), block(30 * 20, 12, 4, 4));
    const d = r.design;
    const p = d.doc.parameters.find((x) => x.name === 'height');
    if (!p) throw new Error('no parameter height');
    const before = d.doc;
    d.state.beginTransaction('Edit height');
    d.state.dispatch(updateParameter({ id: p.id, changes: { expression: '15 mm' } }));
    for (const c of settleSketches({ solver: new SketchSolver(planegcs), before, after: d.doc }))
      d.state.dispatch(setSketchGeometry({ feature: c.feature, points: c.points, radii: c.radii }));
    d.state.commitTransaction();
    expectBlock(await measure(r), block(30 * 20, 15, 4, 4));
  });

  it.each([
    ['new', () => chainFile('pad_pocket')],
    ['0.14', () => asOldFile('pad_pocket', '0.14')],
  ])('pad_pocket (%s): a pad’s length edited by hand', { timeout: 60_000 }, async (_, file) => {
    const r = await run(file());
    const pad = r.design.doc.features.find((f) => f.name === 'Pad');
    if (!pad) throw new Error('no pad');
    const distance = pad.inputs.distance as { kind: 'expr'; expr: string; unit: 'length' };
    r.design.state.dispatch(
      updateFeatureInputs({ id: pad.id, inputs: { distance: { ...distance, expr: '10 mm' } } }),
    );
    expectBlock(await measure(r), block(40 * 30, 10, 4, 5));
  });
});

describe('hostile files', () => {
  it('more features than a chain may have: as today', { timeout: 60_000 }, async () => {
    const r = await run(chainFile('long_chain'), { maxBodyFeatures: 3 });
    expectAsToday(r, 'Hole11', 'limit');
    expect(chainOf(r, 'Hole11').mapped).toEqual([]);
  });

  it('more chains than an import may have: the rest as today', { timeout: 60_000 }, async () => {
    const r = await run(chainFile('pad_kinds'), { maxLooseChains: 1 });
    expect(chainOf(r, 'Symmetric').outcome).toBe('history');
    expectAsToday(r, 'Reversed', 'limit');
    expectAsToday(r, 'TwoSides', 'limit');
  });

  it('the import’s features run out across chains: the rest as today', {
    timeout: 60_000,
  }, async () => {
    const r = await run(chainFile('branch'), { maxFileFeatures: 3 });
    expect(chainOf(r, 'PocketA').outcome).toBe('history');
    expectAsToday(r, 'PocketB', 'limit');
  });

  it('a feature that is its own base: as today', { timeout: 60_000 }, async () => {
    const r = await run(
      chainFile('pad_pocket', editing('Pocket', setLink('BaseFeature', 'Pocket'))),
    );
    expectAsToday(r, 'Pocket', 'chain');
  });

  it('two features on each other, below a tip: as today', { timeout: 60_000 }, async () => {
    const r = await run(chainFile('long_chain', editing('Hole0', setLink('BaseFeature', 'Hole1'))));
    expectAsToday(r, 'Hole11', 'chain');
    expect(chainOf(r, 'Hole11').stop?.detail).toMatch(/lead back/);
  });

  it.each([
    ['isn’t in the file', 'Gone'],
    ['is a sketch', 'PadSketch'],
  ])('a base that %s: as today', { timeout: 60_000 }, async (_, base) => {
    const r = await run(chainFile('pad_pocket', editing('Pocket', setLink('BaseFeature', base))));
    expectAsToday(r, 'Pocket', 'chain');
  });

  it('Originals empty: the pattern is the end of a run, as today', {
    timeout: 60_000,
  }, async () => {
    const r = await run(
      chainFile(
        'patterns',
        editing('Mirrored', (xml) =>
          xml.replace(/(<Property name="Originals"[^>]*>).*?(<\/Property>)/s, '$1<LinkList count="0"/>$2'),
        ),
      ),
    );
    expectAsToday(r, 'Mirrored', 'original');
  });

  it.each([
    ['isn’t a face', 'Edge1'],
    ['is past the base’s faces', 'Face999'],
  ])('a support whose sub-name %s: the sketch takes its stored plane', {
    timeout: 60_000,
  }, async (_, sub) => {
    const r = await run(
      chainFile(
        'pad_pocket',
        editing('Sketch001', (xml) => xml.replace('sub="Face6"', `sub="${sub}"`)),
      ),
    );
    const c = chainOf(r, 'Pocket');
    expect(c.outcome).toBe('history');
    expect(c.sketches.map((s) => s.plane)).toEqual(['origin', 'offset']);
  });

  it('one sketch used by two features: the check decides', { timeout: 60_000 }, async () => {
    const r = await run(
      chainFile(
        'pad_pocket',
        editing('Pocket', (xml) => xml.replace('<LinkSub value="Sketch001"', '<LinkSub value="PadSketch"')),
      ),
    );
    expect(chainOf(r, 'Pocket').outcome).toBe('shape');
    expect(r.report.shapes.map((s) => s.object)).toEqual(['Pocket']);
  });

  it('a feature with neither Profile nor Sketch: as today', { timeout: 60_000 }, async () => {
    const r = await run(
      chainFile(
        'pad_pocket',
        editing('Pocket', (xml) =>
          xml.replace(/<Property name="Profile"[^>]*>.*?<\/Property>/s, ''),
        ),
      ),
    );
    expectAsToday(r, 'Pocket', 'profile');
  });

  it('a sketch placement that isn’t finite: a step or as today, never a throw', {
    timeout: 60_000,
  }, async () => {
    const r = await run(
      chainFile('pad_pocket', editing('Sketch001', setPlacement('Pz', '1e999'))),
    );
    expectAsToday(r, 'Pocket', 'sketch');
  });
});
