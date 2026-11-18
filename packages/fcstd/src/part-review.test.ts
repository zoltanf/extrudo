/**
 * What a review of S11 found (ADR-0144): what one node may add, one set of counters for the
 * whole import, a compound's members used directly too, an object that is both base and tool,
 * planes of a cancelled pass, a unit that loses its first top, and what the report says.
 */
import { loadPlanegcs, type PlanegcsModule, SketchSolver } from '@extrudo/sketch';
import { beforeAll, describe, expect, it } from 'vitest';
import { finalShapes } from './final-shapes';
import { type FcstdImportOptions, importFcstd } from './import';
import type { ImportKernel } from './import-kernel';
import { readFcstd } from './model';
import { nodeImportKernel } from './node-kernel-test-support';
import {
  expandPartXml,
  partBrep,
  partBreps,
  partCase,
  partFile,
  type RawPartObject,
} from './part-parts';
import { partTrees } from './part-tree';

let planegcs: PlanegcsModule;
let kernel: ReturnType<typeof nodeImportKernel>;
beforeAll(async () => {
  planegcs = await loadPlanegcs();
  kernel = nodeImportKernel();
});

const T = 120_000;
const prop = (name: string, type: string, inner: string) =>
  `<Property name="${name}" type="${type}">${inner}</Property>`;
const length = (name: string, v: number) =>
  prop(name, 'App::PropertyLength', `<Float value="${v}"/>`);
const link = (name: string, to: string) => prop(name, 'App::PropertyLink', `<Link value="${to}"/>`);
const links = (name: string, to: readonly string[]) =>
  prop(
    name,
    'App::PropertyLinkList',
    `<LinkList count="${to.length}">${to.map((t) => `<Link value="${t}"/>`).join('')}</LinkList>`,
  );
const placed = (x = 0, y = 0, z = 0) =>
  prop(
    'Placement',
    'App::PropertyPlacement',
    `<PropertyPlacement Px="${x}" Py="${y}" Pz="${z}" Q0="0" Q1="0" Q2="0" Q3="1"/>`,
  );
const shape = (name: string) =>
  prop('Shape', 'Part::PropertyPartShape', `<Part file="${name}.Shape.brp"/>`);
function object(name: string, type: string, props: string[], hidden = true): RawPartObject {
  return {
    name,
    type,
    hidden,
    xml: `<Object name="${name}"><Properties Count="${props.length + 1}" TransientCount="0">${prop('Label', 'App::PropertyString', `<String value="${name}"/>`)}${props.join('')}</Properties></Object>`,
  };
}
const BOX = () => partBrep('box_cyl_cut', 'Box');
const CYL = () => partBrep('box_cyl_cut', 'Cylinder');
const CUT = () => partBrep('box_cyl_cut', 'Cut');
/** The fixture's 30 × 20 × 10 box. */
const box = (name: string) =>
  object(name, 'Part::Box', [
    length('Length', 30),
    length('Width', 20),
    length('Height', 10),
    placed(),
    shape(name),
  ]);
/** The fixture's cylinder through that box. */
const cylinder = (name: string) =>
  object(name, 'Part::Cylinder', [
    length('Radius', 4),
    length('Height', 10),
    placed(15, 10),
    shape(name),
  ]);
const boolean = (name: string, type: string, base: string, tool: string, top = false) =>
  object(name, type, [link('Base', base), link('Tool', tool), placed(), shape(name)], !top);
const compound = (name: string, members: string[]) =>
  object(name, 'Part::Compound', [links('Links', members), placed(), shape(name)]);

/** A document of these objects only, each stored shape given by name. */
const raw = (objects: RawPartObject[], breps: Record<string, string>) =>
  partFile('box_cyl_cut', {
    edit: () => undefined,
    extra: objects,
    entries: Object.fromEntries(Object.entries(breps).map(([k, v]) => [`${k}.Shape.brp`, v])),
  });

/** B-rep text of a compound of `k` copies of a stored solid, each 100 mm further along X. */
function manySolids(text: string, k: number): string {
  const [head, rest] = text.split(/(?=Curve2ds )/) as [string, string];
  const [middle, shapes] = rest.split(/(?=TShapes )/) as [string, string];
  const locations = Number(/Locations (\d+)/.exec(head)?.[1]);
  const added = Array.from(
    { length: k },
    (_, i) => `1\n 1 0 0 ${i * 100} \n 0 1 0 0 \n 0 0 1 0 \n`,
  );
  const lines = shapes.trimEnd().split('\n');
  const count = Number(/TShapes (\d+)/.exec(lines[0] as string)?.[1]);
  const body = lines
    .slice(1, -1)
    .map((l) =>
      l.endsWith('*') ? l.replace(/([+-])(\d+) /g, (_, s, n) => `${s}${Number(n) + 1} `) : l,
    )
    .join('\n');
  const children = added.map((_, i) => `+2 ${locations + i + 1}`).join(' ');
  return `${head.replace(/Locations \d+/, `Locations ${locations + k}`)}${added.join('')}${middle}TShapes ${count + 1}\n${body}\nCo\n\n1100000\n${children} *\n\n+1 0 \n`;
}

async function run(bytes: Uint8Array, options: Partial<FcstdImportOptions> = {}) {
  const r = await importFcstd(bytes, 'Parts', {
    kernel,
    solver: new SketchSolver(planegcs),
    ...options,
  });
  return {
    ...r,
    features: r.design.doc.features.map((f) => `${f.type} ${f.name}`),
    trees: Object.fromEntries(
      r.report.trees.map((t) => [t.object, `${t.outcome}${t.reason ? `:${t.reason}` : ''}`]),
    ),
    nodes: Object.fromEntries(
      r.report.trees.flatMap((t) =>
        t.nodes.map((n) => [n.object, n.outcome === 'leaf' ? `leaf:${n.reason}` : n.outcome]),
      ),
    ),
    passes: Object.fromEntries(r.report.trees.map((t) => [t.object, t.passes])),
  };
}

describe('what one node may add', () => {
  const leaf = (k: number) => ({
    object: object('Many', 'Part::Feature', [placed(), shape('Many')]),
    brep: manySolids(BOX(), k),
  });
  const many = leaf(4);

  it('the test’s stored compound holds its solids', { timeout: T }, async () => {
    const m = await kernel.measureStoredShape(many.brep, []);
    expect(m.solids).toBe(4);
    expect(m.volume).toBeCloseTo(4 * 6000, 6);
  });

  it('a leaf of more bodies than an operand may have, as a cut’s base', {
    timeout: T,
  }, async () => {
    const r = await run(
      raw([many.object, box('Tool'), boolean('Top', 'Part::Cut', 'Many', 'Tool', true)], {
        Many: many.brep,
        Tool: BOX(),
        Top: BOX(),
      }),
      { maxOperandBodies: 3 },
    );
    expect(r.trees).toEqual({ Top: 'shape:limit' });
    expect(r.features).toEqual(['import Import Top']);
  });

  it('as a MultiCommon’s first shape', { timeout: T }, async () => {
    const r = await run(
      raw(
        [
          many.object,
          box('B1'),
          box('B2'),
          object(
            'Top',
            'Part::MultiCommon',
            [links('Shapes', ['Many', 'B1', 'B2']), placed(), shape('Top')],
            false,
          ),
        ],
        { Many: many.brep, B1: BOX(), B2: BOX(), Top: BOX() },
      ),
      { maxOperandBodies: 3 },
    );
    expect(r.trees).toEqual({ Top: 'shape:limit' });
  });

  it('under a fuse kept apart', { timeout: T }, async () => {
    const r = await run(
      raw([many.object, box('Tool'), boolean('Top', 'Part::Fuse', 'Many', 'Tool', true)], {
        Many: many.brep,
        Tool: BOX(),
        Top: manySolids(BOX(), 5),
      }),
      { maxOperandBodies: 3 },
    );
    expect(r.trees).toEqual({ Top: 'shape:limit' });
  });

  it('a node that would pass the features’ cap adds nothing at all', { timeout: T }, async () => {
    let most = 0;
    const counting: ImportKernel = {
      ...kernel,
      rebuild: (doc, ...rest) => {
        most = Math.max(most, doc.features.length);
        return kernel.rebuild(doc, ...rest);
      },
    };
    const r = await run(
      raw([many.object, box('Tool'), boolean('Top', 'Part::Cut', 'Many', 'Tool', true)], {
        Many: many.brep,
        Tool: BOX(),
        Top: BOX(),
      }),
      { kernel: counting, maxTreeFeatures: 3 },
    );
    expect(r.trees).toEqual({ Top: 'shape:limit' });
    expect(most).toBeLessThanOrEqual(3);
  });
});

/** The `body_operand` document with a second, standalone copy of its body. */
function twoBodies() {
  const names = ['Body', 'Sketch', 'Pad', 'PocketSketch', 'Pocket'];
  const renamed = (xml: string) =>
    names.reduce(
      (x, n) =>
        x.replaceAll(`"${n}"`, `"${n}_2"`).replaceAll(`"${n}.Shape.brp"`, `"${n}_2.Shape.brp"`),
      xml,
    );
  const c = partCase('body_operand');
  const texts = partBreps();
  const copies = c.objects.filter((o) => names.includes(o.object));
  return partFile('body_operand', {
    extra: copies.map((o) => ({
      name: `${o.object}_2`,
      type: o.type,
      xml: renamed(expandPartXml(o.xml)),
      hidden: o.object !== 'Body',
    })),
    entries: Object.fromEntries(
      copies.flatMap((o) =>
        o.stored === undefined ? [] : [[`${o.object}_2.Shape.brp`, texts[o.stored] as string]],
      ),
    ),
  });
}

describe('one set of counters for the whole import', () => {
  it('the copy of the body comes in beside the tree', { timeout: T }, async () => {
    const r = await run(twoBodies());
    expect(r.report.bodies.map((b) => b.outcome)).toEqual(['history']);
    expect(r.nodes.Body).toBe('body');
  });

  it('bodies used by trees count towards the file’s features', { timeout: T }, async () => {
    const r = await run(twoBodies(), { maxFileFeatures: 3 });
    expect(r.report.bodies.map((b) => b.outcome)).toEqual(['history']);
    expect(r.nodes.Body).toBe('leaf:body');
  });

  it('a body used by a tree counts towards the trees’ features', { timeout: T }, async () => {
    const r = await run(partFile('body_operand'), { maxTreeFeatures: 4 });
    expect(r.trees).toEqual({ Fusion: 'shape:limit' });
    expect(r.features).toEqual(['import Import Fusion']);
  });
});

describe('a compound’s member used directly too', () => {
  const parts = [box('A'), box('E'), cylinder('B'), cylinder('C'), compound('Holes', ['B', 'C'])];
  const breps = { A: BOX(), E: BOX(), B: CYL(), C: CYL(), T1: CUT(), T2: CUT() };
  const t1 = boolean('T1', 'Part::Cut', 'A', 'Holes', true);
  const t2 = boolean('T2', 'Part::Cut', 'E', 'B', true);

  it('the direct use first', { timeout: T }, async () => {
    const r = await run(raw([...parts, t2, t1], breps));
    expect(r.trees).toEqual({ T2: 'history', T1: 'history' });
    expect(r.passes).toEqual({ T2: 1, T1: 1 });
    expect(r.features.filter((f) => f.startsWith('move'))).toEqual(['move Copy B']);
  });

  it('the compound first', { timeout: T }, async () => {
    const r = await run(raw([...parts, t1, t2], breps));
    expect(r.trees).toEqual({ T1: 'history', T2: 'history' });
    expect(r.passes).toEqual({ T1: 1, T2: 1 });
  });

  it('in one tree', { timeout: T }, async () => {
    const r = await run(
      raw(
        [
          box('A'),
          cylinder('B'),
          cylinder('C'),
          compound('Holes', ['B', 'C']),
          boolean('Inner', 'Part::Cut', 'A', 'Holes'),
          boolean('Top', 'Part::Fuse', 'Inner', 'B', true),
        ],
        { A: BOX(), B: CYL(), C: CYL(), Inner: CUT(), Top: BOX() },
      ),
    );
    expect(r.trees).toEqual({ Top: 'history' });
    expect(r.passes).toEqual({ Top: 1 });
  });
});

describe('one object as both base and tool', () => {
  it.each(['Part::Cut', 'Part::Fuse', 'Part::Common'])('%s', (type) => {
    const doc = readFcstd(
      raw([box('A'), boolean('Top', type, 'A', 'A', true)], { A: BOX(), Top: BOX() }),
    );
    const p = partTrees(doc, finalShapes(doc));
    expect(p.nodes.get('Top')?.leaf?.reason).toBe('operand');
  });
});

describe('a pass that is taken back', () => {
  it('forgets the planes it made: the body comes in with its history on the next pass', {
    timeout: T,
  }, async () => {
    // Other shares the box with the tree of the body, and doesn't hold.
    const r = await run(
      partFile('body_operand', {
        extra: [box('Box2'), boolean('Other', 'Part::Fuse', 'Box', 'Box2', true)],
        entries: { 'Box2.Shape.brp': BOX(), 'Other.Shape.brp': CYL() },
      }),
    );
    expect(r.trees.Other).toMatch(/^shape:/);
    expect(r.trees.Fusion).toBe('history');
    expect(r.nodes.Body).toBe('body');
    expect(r.passes.Fusion).toBe(2);
  });

  it('a unit that loses its first top is built again in the next one’s frame', {
    timeout: T,
  }, async () => {
    const holder = object(
      'Holder',
      'App::Part',
      [links('Group', ['T0']), placed(100, 50, 20)],
      false,
    );
    const r = await run(
      raw(
        [
          box('A'),
          cylinder('B'),
          holder,
          boolean('T0', 'Part::Cut', 'A', 'B', true),
          box('A2'),
          boolean('T1', 'Part::Cut', 'A2', 'B', true),
        ],
        { A: BOX(), B: CYL(), A2: BOX(), T0: CYL(), T1: CUT() },
      ),
    );
    expect(r.trees.T0).toMatch(/^shape:/);
    expect(r.trees.T1).toBe('history');
  });
});

describe('what the report says', () => {
  const withExpression = (path: string, expr: string) => (xml: string) =>
    xml.replace(
      /<ExpressionEngine count="0"><\/ExpressionEngine>/,
      `<ExpressionEngine count="1"><Expression path="${path}" expression="${expr}"/></ExpressionEngine>`,
    );
  const entry = (r: Awaited<ReturnType<typeof run>>, object: string) =>
    r.report.parameters.expressions.find((e) => e.object === object);

  it('a body with a stored-shape step leaves its tree with part of its history', {
    timeout: T,
  }, async () => {
    const r = await run(
      partFile('body_operand', {
        edit: (o, xml) =>
          o === 'Pad'
            ? xml.replace(/(name="Length" type="App::PropertyLength"><Float value=")10"/, '$111"')
            : xml,
      }),
    );
    const body = r.report.trees[0]?.nodes.find((n) => n.object === 'Body');
    expect(body?.outcome).toBe('body');
    expect(body?.body?.steps).toHaveLength(1);
    expect(r.trees).toEqual({ Fusion: 'leaves' });
  });

  it('a fuse kept apart has no feature to hold an expression', { timeout: T }, async () => {
    const edit = withExpression('.Placement.Base.x', '5 mm');
    const r = await run(partFile('nested', { edit: (o, x) => (o === 'Holes' ? edit(x) : x) }));
    expect(r.nodes.Holes).toBe('feature');
    expect(entry(r, 'Holes')).toMatchObject({ outcome: 'target' });
    expect(entry(r, 'Holes')?.detail).toMatch(/no feature of its own/);
  });

  it('a boolean that its own placement turns says why', { timeout: T }, async () => {
    const edit = withExpression('.Placement.Base.x', '5 mm');
    const r = await run(
      partFile('placed_booleans', { edit: (o, x) => (o === 'FusionTilted' ? edit(x) : x) }),
    );
    expect(entry(r, 'FusionTilted')).toMatchObject({ outcome: 'target' });
    expect(entry(r, 'FusionTilted')?.detail).toMatch(/turns/);
  });

  it('an input left out because it is 0 has the reason for a stored 0', {
    timeout: T,
  }, async () => {
    const edit = withExpression('.Placement.Base.z', '0 mm');
    const r = await run(
      partFile('box_cyl_cut', { edit: (o, x) => (o === 'Cylinder' ? edit(x) : x) }),
    );
    expect(entry(r, 'Cylinder')).toMatchObject({ outcome: 'target', number: true });
    expect(entry(r, 'Cylinder')?.detail).toMatch(/its value is 0 in the file/);
  });
});

describe.skipIf(!process.env.BENCH)('the fates of a large tree, measured (BENCH=1)', () => {
  it('500 objects, 64 operands each, whose leaves have no stored shape', {
    timeout: 600_000,
  }, async () => {
    const objects: RawPartObject[] = [];
    const tops: string[] = [];
    for (let m = 0; m < 7; m++) {
      const names = Array.from({ length: 64 }, (_, i) => `L${m}_${i}`);
      for (const n of names) objects.push(object(n, 'Part::Feature', [placed(), shape(n)]));
      objects.push(
        object(`M${m}`, 'Part::MultiFuse', [links('Shapes', names), placed(), shape(`M${m}`)]),
      );
      tops.push(`M${m}`);
    }
    objects.push(
      object('Top', 'Part::MultiFuse', [links('Shapes', tops), placed(), shape('Top')], false),
    );
    const t = performance.now();
    const r = await run(raw(objects, { Top: BOX() }));
    process.stderr.write(
      `S11TIME ${objects.length} objects, every leaf lost: ${Math.round(performance.now() - t)} ms\n`,
    );
    expect(r.trees.Top).toMatch(/^shape:/);
  });
});
