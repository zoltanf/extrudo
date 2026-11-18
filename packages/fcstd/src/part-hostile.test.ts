/**
 * S11's limits and hostile files (ADR-0144): every link, count, size and
 * placement of a Part tree is the file's. Past a limit a node is a stored leaf
 * or the tree's top comes in as today, each with its reason; nothing throws
 * out of the import. The planner's cases need no kernel; the rest run the
 * import with a kernel in Node.
 */
import { loadPlanegcs, type PlanegcsModule, SketchSolver } from '@extrudo/sketch';
import { beforeAll, describe, expect, it } from 'vitest';
import { finalShapes } from './final-shapes';
import { type FcstdImportOptions, importFcstd } from './import';
import { readFcstd } from './model';
import { nodeImportKernel } from './node-kernel-test-support';
import { type PartFileOptions, partBrep, partFile, type RawPartObject } from './part-parts';
import { MAX_MULTI_OPERANDS, partTrees } from './part-tree';

let planegcs: PlanegcsModule;
let kernel: ReturnType<typeof nodeImportKernel>;
beforeAll(async () => {
  planegcs = await loadPlanegcs();
  kernel = nodeImportKernel();
});

const T = 120_000;
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const prop = (name: string, type: string, inner: string) =>
  `<Property name="${name}" type="${type}">${inner}</Property>`;
const length = (name: string, v: number | string) =>
  prop(name, 'App::PropertyLength', `<Float value="${v}"/>`);
const link = (name: string, to: string) =>
  prop(name, 'App::PropertyLink', `<Link value="${esc(to)}"/>`);
const links = (name: string, to: readonly string[]) =>
  prop(
    name,
    'App::PropertyLinkList',
    `<LinkList count="${to.length}">${to.map((t) => `<Link value="${esc(t)}"/>`).join('')}</LinkList>`,
  );
const placed = (x = 0, y = 0, z = 0, q = '0" Q1="0" Q2="0" Q3="1') =>
  prop(
    'Placement',
    'App::PropertyPlacement',
    `<PropertyPlacement Px="${x}" Py="${y}" Pz="${z}" Q0="${q}"/>`,
  );
const shape = (name: string) =>
  prop('Shape', 'Part::PropertyPartShape', `<Part file="${esc(name)}.Shape.brp"/>`);
function object(name: string, type: string, props: string[], hidden = false): RawPartObject {
  return {
    name,
    type,
    hidden,
    xml: `<Object name="${esc(name)}"><Properties Count="${props.length + 1}" TransientCount="0">${prop('Label', 'App::PropertyString', `<String value="${esc(name)}"/>`)}${props.join('')}</Properties></Object>`,
  };
}
const BOX = () => partBrep('box_cyl_cut', 'Box');
const box = (name: string, l: number | string = 30, extra: string[] = []) =>
  object(
    name,
    'Part::Box',
    [
      length('Length', l),
      length('Width', 20),
      length('Height', 10),
      placed(),
      shape(name),
      ...extra,
    ],
    true,
  );

/** A document of raw objects only (the fixture case's own objects dropped). */
function rawFile(
  objects: RawPartObject[],
  entries: Record<string, string | Uint8Array> = {},
): Uint8Array {
  return partFile('box_cyl_cut', { edit: () => undefined, extra: objects, entries });
}
const plan = (bytes: Uint8Array, limits = {}) => {
  const doc = readFcstd(bytes);
  return partTrees(doc, finalShapes(doc), limits);
};
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
  };
}
const edit = (name: string, change: (xml: string) => string): PartFileOptions => ({
  edit: (o, xml) => (o === name ? change(xml) : xml),
});

describe('the planner (no kernel)', () => {
  it('a link to an object that is not in the file, to itself, to a sketch, sheet or container', () => {
    for (const to of ['Nowhere', 'Cut', 'Sheet', 'Group', 'Sketch']) {
      const p = plan(
        rawFile(
          [
            box('Box'),
            object('Sheet', 'Spreadsheet::Sheet', []),
            object('Group', 'App::DocumentObjectGroup', []),
            object('Sketch', 'Sketcher::SketchObject', []),
            object('Cut', 'Part::Cut', [
              link('Base', 'Box'),
              link('Tool', to),
              placed(),
              shape('Cut'),
            ]),
          ],
          { 'Box.Shape.brp': BOX(), 'Cut.Shape.brp': BOX() },
        ),
      );
      const cut = p.nodes.get('Cut');
      expect(cut?.kind, to).toBe('leaf');
      expect(cut?.leaf?.reason, to).toBe('operand');
    }
  });

  it('a cycle of links: A’s base is B, B’s base is A', () => {
    const p = plan(
      rawFile(
        [
          box('Tool'),
          object(
            'A',
            'Part::Cut',
            [link('Base', 'B'), link('Tool', 'Tool'), placed(), shape('A')],
            true,
          ),
          object(
            'B',
            'Part::Cut',
            [link('Base', 'A'), link('Tool', 'Tool'), placed(), shape('B')],
            true,
          ),
          object('Top', 'Part::Cut', [
            link('Base', 'A'),
            link('Tool', 'Tool'),
            placed(),
            shape('Top'),
          ]),
        ],
        {
          'A.Shape.brp': BOX(),
          'B.Shape.brp': BOX(),
          'Tool.Shape.brp': BOX(),
          'Top.Shape.brp': BOX(),
        },
      ),
    );
    expect(p.nodes.get('B')?.leaf?.reason).toBe('cycle');
    // B, the node that links back, is a leaf: A is built on it, the top on A.
    expect(p.trees.map((t) => t.order)).toEqual([['B', 'Tool', 'A', 'Top']]);
  });

  it('the same object twice in one Shapes list, one operand, none', () => {
    for (const shapes of [['Box', 'Box'], ['Box'], []]) {
      const p = plan(
        rawFile(
          [
            box('Box'),
            object('F', 'Part::MultiFuse', [links('Shapes', shapes), placed(), shape('F')]),
          ],
          { 'Box.Shape.brp': BOX(), 'F.Shape.brp': BOX() },
        ),
      );
      expect(p.nodes.get('F')?.leaf?.reason, shapes.join()).toBe('operand');
    }
    const none = plan(
      rawFile([object('C', 'Part::Cut', [placed(), shape('C')])], { 'C.Shape.brp': BOX() }),
    );
    expect(none.nodes.get('C')?.leaf).toEqual({
      reason: 'operand',
      detail: 'it has no Base to cut',
    });
  });

  it(`a MultiFuse of more than ${MAX_MULTI_OPERANDS} shapes`, () => {
    const names = Array.from({ length: MAX_MULTI_OPERANDS + 1 }, (_, i) => `B${i}`);
    const p = plan(
      rawFile(
        [
          ...names.map((n) => box(n)),
          object('F', 'Part::MultiFuse', [links('Shapes', names), placed(), shape('F')]),
        ],
        {
          'F.Shape.brp': BOX(),
        },
      ),
    );
    expect(p.nodes.get('F')?.leaf?.reason).toBe('limit');
  });

  it('sizes that are 0, negative, not finite or past the length limit', () => {
    for (const l of ['0', '-5', '1e999', 'nan', '2e7']) {
      const p = plan(rawFile([box('Box', l)], { 'Box.Shape.brp': BOX() }));
      expect(p.nodes.get('Box')?.leaf?.reason, l).toBe('value');
    }
  });

  it('placements that are not finite, past the length limit, or no rotation', () => {
    const cases: [string, string][] = [
      ['1e999', placed('1e999' as never)],
      ['far', placed(2e7)],
      [
        'zero quaternion',
        prop(
          'Placement',
          'App::PropertyPlacement',
          '<PropertyPlacement Px="0" Py="0" Pz="0" Q0="0" Q1="0" Q2="0" Q3="0"/>',
        ),
      ],
      [
        'zero axis',
        prop(
          'Placement',
          'App::PropertyPlacement',
          '<PropertyPlacement Px="0" Py="0" Pz="0" A="1" Ox="0" Oy="0" Oz="0"/>',
        ),
      ],
    ];
    for (const [what, pl] of cases) {
      const o = object('Box', 'Part::Box', [
        length('Length', 30),
        length('Width', 20),
        length('Height', 10),
        pl,
        shape('Box'),
      ]);
      const p = plan(rawFile([o], { 'Box.Shape.brp': BOX() }));
      expect(p.nodes.get('Box')?.leaf?.reason, what).toBe('placement');
    }
  });

  it('a chain of 10,000 cuts: the walk is iterative, the tree past its cap comes in as today', () => {
    const objects: RawPartObject[] = [box('C0')];
    for (let i = 1; i <= 10_000; i++)
      objects.push(
        object(
          `C${i}`,
          'Part::Cut',
          [link('Base', `C${i - 1}`), link('Tool', 'C0'), placed()],
          true,
        ),
      );
    objects.push(
      object('Top', 'Part::Cut', [
        link('Base', 'C10000'),
        link('Tool', 'C0'),
        placed(),
        shape('Top'),
      ]),
    );
    const t0 = Date.now();
    const p = plan(rawFile(objects, { 'Top.Shape.brp': BOX() }));
    expect(Date.now() - t0).toBeLessThan(5_000);
    expect(p.trees[0]?.asToday?.reason).toBe('limit');
    expect(p.trees[0]?.asToday?.detail).toMatch(/more than 500 objects/);
  });

  it('nodes per import: past the cap the later trees come in as today', () => {
    const p = plan(
      rawFile(
        ['A', 'B', 'C'].map((n) => ({ ...box(n), hidden: false })),
        { 'A.Shape.brp': BOX(), 'B.Shape.brp': BOX(), 'C.Shape.brp': BOX() },
      ),
      { maxImportNodes: 2 },
    );
    expect(p.trees.map((t) => `${t.top.object.name}:${t.asToday?.reason ?? 'ok'}`)).toEqual([
      'A:ok',
      'B:ok',
      'C:limit',
    ]);
  });
});

/** A Part fillet's edge list: count, then (index, first, second) per edge. */
function edgeList(
  count: number,
  edges: readonly (readonly [number, number, number])[],
  bytes?: number,
) {
  const out = new Uint8Array(bytes ?? 4 + 20 * edges.length);
  const v = new DataView(out.buffer);
  v.setUint32(0, count, true);
  edges.forEach(([i, a, b], k) => {
    if (4 + 20 * k + 20 > out.length) return;
    v.setInt32(4 + 20 * k, i, true);
    v.setFloat64(8 + 20 * k, a, true);
    v.setFloat64(16 + 20 * k, b, true);
  });
  return out;
}

describe('a Part fillet’s edge list', () => {
  const fillet = (entry: Uint8Array | undefined) =>
    partFile('fillets_chamfers', {
      ...(entry ? { entries: { Edges: entry } } : { entries: {} }),
      edit: (o, xml) =>
        entry === undefined && o === 'Fillet'
          ? xml.replace('<FilletEdges file="Edges"/>', '<FilletEdges file=""/>')
          : xml,
    });
  const cases: [string, Uint8Array | undefined, RegExp][] = [
    ['a count larger than the entry', edgeList(9, [[2, 2, 2]]), /says 9 edges but holds 24 bytes/],
    [
      'a truncated entry',
      edgeList(
        2,
        [
          [2, 2, 2],
          [7, 2, 2],
        ],
        30,
      ),
      /says 2 edges but holds 30 bytes/,
    ],
    ['a count past the cap', edgeList(5_000, [[2, 2, 2]]), /5000 edges, more than 1000/],
    ['an index of 0', edgeList(1, [[0, 2, 2]]), /edge 0 has sizes/],
    ['a size of 0', edgeList(1, [[2, 0, 0]]), /sizes 0 and 0/],
    ['a negative size', edgeList(1, [[2, -2, -2]]), /sizes -2 and -2/],
    ['a size not finite', edgeList(1, [[2, Number.NaN, Number.NaN]]), /sizes NaN and NaN/],
    ['no entry', undefined, /stores no edge list/],
  ];
  for (const [what, entry, detail] of cases)
    it(what, () => {
      const p = plan(fillet(entry));
      const n = p.nodes.get('Fillet');
      expect(n?.leaf?.reason).toBe('edges');
      expect(n?.leaf?.detail).toMatch(detail);
    });

  it('an index past the base’s edges: the fillet is the file’s shape, the cut above holds', {
    timeout: T,
  }, async () => {
    const r = await run(fillet(edgeList(1, [[999, 2, 2]])));
    expect(r.nodes.Fillet).toBe('leaf:element');
    expect(r.trees.CutAbove).toBe('leaves');
    // Its base was built for it: a second pass leaves nothing of Box, Cylinder or Cut.
    expect(r.report.trees.find((t) => t.object === 'CutAbove')?.passes).toBe(2);
    expect(r.features.filter((f) => /Box |Cylinder |Cut$/.test(f))).toEqual([]);
  });
});

describe('the import with a kernel', () => {
  it('two tops that share an object in different containers: the second comes in as today', {
    timeout: T,
  }, async () => {
    // The unit is built in the first top's frame; the second, at the document's top, would stay
    // there. The container turns the cut half a turn about the hole, so both hold in that frame.
    const cut = partBrep('box_cyl_cut', 'Cut');
    const r = await run(
      partFile('box_cyl_cut', {
        extra: [
          object('Holder', 'App::Part', [
            links('Group', ['Box', 'Cylinder', 'Cut']),
            placed(30, 20, 0, '0" Q1="0" Q2="1" Q3="0'),
          ]),
          box('Box2'),
          object('Other', 'Part::Cut', [
            link('Base', 'Box2'),
            link('Tool', 'Cylinder'),
            placed(),
            shape('Other'),
          ]),
        ],
        entries: { 'Box2.Shape.brp': BOX(), 'Other.Shape.brp': cut },
      }),
    );
    expect(r.trees).toEqual({ Cut: 'history', Other: 'shape:container' });
    expect(r.features).toEqual([
      'box Box',
      'cylinder Cylinder',
      'combine Cut',
      'move Place Cut',
      'import Import Other',
    ]);
  });

  it('an operand whose stored shape is missing or has no solid: its user and the top come in as today', {
    timeout: T,
  }, async () => {
    for (const brep of [
      undefined,
      '\nCASCADE Topology V1, (c) Matra-Datavision\nLocations 0\nCurve2ds 0\nCurves 0\nPolygon3D 0\nPolygonOnTriangulations 0\nSurfaces 0\nTriangulations 0\n\nTShapes 1\nCo\n\n0101100\n*\n\n+1 0 \n',
    ]) {
      const r = await run(
        partFile('stored_leaf', { brep: (o, t) => (o === 'Imported' ? brep : t) }),
      );
      expect(r.trees.Cut, String(brep)).toMatch(/^shape:operand$/);
      expect(r.trees.Cut001).toBe('leaves');
      expect(r.design.validate()).toEqual([]);
    }
  });

  it('a root whose stored shape is a compound of nothing is no tree and no shape', {
    timeout: T,
  }, async () => {
    const empty =
      '\nCASCADE Topology V1, (c) Matra-Datavision\nLocations 0\nCurve2ds 0\nCurves 0\nPolygon3D 0\nPolygonOnTriangulations 0\nSurfaces 0\nTriangulations 0\n\nTShapes 1\nCo\n\n0101100\n*\n\n+1 0 \n';
    const r = await run(partFile('box_cyl_cut', { brep: (o, t) => (o === 'Cut' ? empty : t) }));
    expect(r.report.trees).toEqual([]);
    expect(r.features).toEqual([]);
  });

  it('features one import emits: past the cap the trees come in as today', {
    timeout: T,
  }, async () => {
    const r = await run(partFile('shared_operand'), { maxTreeFeatures: 4 });
    expect(r.trees).toEqual({
      Cut: 'history',
      Cut001: 'shape:limit',
      Cut002: 'shape:limit',
      Fusion: 'shape:limit',
    });
    // The unit of Cut and Cut001 shares the cylinder: taken back together, Cut comes in again.
    expect(r.design.validate()).toEqual([]);
  });

  it('a stored leaf past the design’s attachments: its user and the top come in as today', {
    timeout: T,
  }, async () => {
    const r = await run(partFile('stored_leaf'), { maxAttachmentsBytes: 1_000 });
    expect(r.trees.Cut).toMatch(/^(shape|left-out):operand$/);
    expect(r.design.validate()).toEqual([]);
  });

  it('a unit that needs more passes than the cap comes in as today', { timeout: T }, async () => {
    const r = await run(
      partFile(
        'nested',
        edit('Cut', (xml) =>
          xml
            .replace('<Link value="Fusion"/>', '<Link value="Holes"/>')
            .replace(
              /(<Property name="Tool" type="App::PropertyLink"><Link value=")Holes/,
              '$1Fusion',
            ),
        ),
      ),
      { maxTreePasses: 1 },
    );
    expect(r.trees).toEqual({ Common: 'shape:passes' });
    expect(r.features).toEqual(['import Import Common']);
  });
});

describe.skipIf(!process.env.BENCH)('a long chain, measured (BENCH=1)', () => {
  for (const n of [12, 100, 300])
    it(`${n} fuses of the same box`, { timeout: 1_200_000 }, async () => {
      const objects: RawPartObject[] = [];
      const entries: Record<string, string> = {};
      for (let i = 0; i <= n; i++) {
        objects.push(box(`B${i}`));
        entries[`B${i}.Shape.brp`] = BOX();
      }
      let base = 'B0';
      for (let i = 1; i <= n; i++) {
        const name = `F${i}`;
        objects.push(
          object(
            name,
            'Part::Fuse',
            [link('Base', base), link('Tool', `B${i}`), placed(), shape(name)],
            i < n,
          ),
        );
        entries[`${name}.Shape.brp`] = BOX();
        base = name;
      }
      let calls = 0;
      const counting = {
        ...kernel,
        rebuild: (...a: Parameters<typeof kernel.rebuild>) => {
          calls++;
          return kernel.rebuild(...a);
        },
        measureStoredShape: (...a: Parameters<typeof kernel.measureStoredShape>) => {
          calls++;
          return kernel.measureStoredShape(...a);
        },
      };
      const t0 = Date.now();
      const r = await run(rawFile(objects, entries), {
        kernel: counting as never,
        maxTreeNodes: 1_000,
      });
      const ms = Date.now() - t0;
      process.stderr.write(
        `S11TIME chain of ${n} fuses: ${ms} ms, ${calls} kernel calls, ${r.trees[`F${n}`]}\n`,
      );
      expect(r.trees[`F${n}`]).toBe('history');
    });
});
