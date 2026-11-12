/**
 * Fillets and chamfers against bad files and a lying kernel (P6-25 S6,
 * ADR-0144): every bad sub-element, base or size ends the body's history
 * with a reason from the closed set, and every new kernel reply is checked
 * before it is used (a reply that fails is a kernel failure: the kernel is
 * restarted and the body falls back to its stored shape).
 */
import type { GeomRef } from '@extrudo/core';
import { MAX_DESCRIBED_EDGES as KERNEL_MAX_DESCRIBED_EDGES } from '@extrudo/kernel';
import { loadPlanegcs, type PlanegcsModule, SketchSolver } from '@extrudo/sketch';
import { beforeAll, describe, expect, it } from 'vitest';
import { NONSENSE_REPLY } from './budget';
import { DRESSUP_CASES, type DressUpFixtureFeature, dressUpSpec } from './dressup-fixtures';
import { type BodySpec, historyFile, num, rectangle } from './history-fixtures';
import { importFcstd } from './import';
import type { ImportKernel, ShapeElements } from './import-kernel';
import {
  MATCH_TOLERANCE,
  MAX_DESCRIBED_EDGES,
  namedFeatures,
  saneElements,
  saneReference,
} from './match';
import { nodeImportKernel } from './node-kernel-test-support';

let planegcs: PlanegcsModule;
let base: ReturnType<typeof nodeImportKernel>;
beforeAll(async () => {
  planegcs = await loadPlanegcs();
  base = nodeImportKernel();
});

const [PAD, FILLET] = DRESSUP_CASES.fillet_one_edge as [
  DressUpFixtureFeature,
  DressUpFixtureFeature,
];

/** A box padded from the fixture's sketch, then its fillet with `change`. */
const filletBody = (
  change: Partial<DressUpFixtureFeature> = {},
  extra: Partial<BodySpec> = {},
): BodySpec => ({
  name: 'Body',
  label: 'Part',
  sketches: [{ name: 'Sketch', geometry: rectangle(0, 0, 10, 20) }],
  features: [
    { name: 'Pad', type: 'Pad', length: 30, stored: PAD.stored },
    dressUpSpec(FILLET, change),
  ],
  ...extra,
});

async function run(bodies: BodySpec[], kernel: ImportKernel = base, shapeTimeoutMs?: number) {
  const r = await importFcstd(historyFile(bodies), 'Hostile', {
    kernel,
    solver: new SketchSolver(planegcs),
    ...(shapeTimeoutMs ? { shapeTimeoutMs } : {}),
  });
  return { ...r, body: r.report.bodies[0] };
}

describe('what a file names', () => {
  it.each([
    [['Edge0'], 'element', /Edge0, which is not an edge or a face/],
    [['Edge999999'], 'element', /Edge999999, but its base has 12 edges/],
    [['Face7'], 'element', /Face7, but its base has 6 faces/],
    [['Edge1e9'], 'element', /not an edge or a face/],
    [['Vertex1'], 'element', /not an edge or a face/],
    [['Edge-1'], 'element', /not an edge or a face/],
    [[], 'edges', /names no edges/],
  ])('%j stops with %s', async (subs, reason, detail) => {
    const { body } = await run([filletBody({ subs })]);
    expect(body?.stop).toMatchObject({ object: 'Fillet', reason });
    expect(body?.stop?.detail).toMatch(detail);
    expect(body?.outcome).toBe('shape');
    expect(body?.mapped.map((m) => m.kind)).toEqual(['pad']);
  });

  it('refuses 100,000 sub-elements before looking at one', async () => {
    const subs = Array.from({ length: 100_000 }, (_, i) => `Edge${(i % 12) + 1}`);
    const t = performance.now();
    const { body } = await run([filletBody({ subs })]);
    expect(body?.stop).toMatchObject({ reason: 'edges' });
    expect(body?.stop?.detail).toMatch(/100000 elements, more than 1000/);
    expect(performance.now() - t).toBeLessThan(20_000);
  });

  it('takes the same edge named twice once', async () => {
    const { body } = await run([filletBody({ subs: ['Edge1', 'Edge1'] })]);
    expect(body?.outcome).toBe('history');
    expect(body?.mapped[1]?.references?.found).toBe(1);
  });

  it.each([
    ['Nothing', /Nothing isn't in the file/],
    ['Sketch', /Sketch is not the feature before it/],
    ['', /it has no base/],
  ])('refuses a base %j', async (name, detail) => {
    const { body } = await run([filletBody({ base: name })]);
    expect(body?.stop).toMatchObject({ reason: 'base' });
    expect(body?.stop?.detail).toMatch(detail);
  });

  it("refuses a base in another body (not the feature before it in this one's chain)", async () => {
    const other: BodySpec = {
      name: 'Other',
      sketches: [{ name: 'SketchB', geometry: rectangle(0, 0, 10, 20) }],
      features: [{ name: 'PadB', type: 'Pad', sketch: 'SketchB', length: 30, stored: PAD.stored }],
    };
    const { report } = await run([other, filletBody({ base: 'PadB' })]);
    expect(report.bodies[1]?.stop).toMatchObject({ reason: 'base' });
  });

  it('refuses a fillet first in its body, on a feature of another', async () => {
    const other: BodySpec = {
      name: 'Other',
      sketches: [{ name: 'SketchB', geometry: rectangle(0, 0, 10, 20) }],
      features: [{ name: 'PadB', type: 'Pad', sketch: 'SketchB', length: 30, stored: PAD.stored }],
    };
    const alone: BodySpec = {
      ...filletBody(),
      sketches: [],
      features: [{ ...dressUpSpec(FILLET, { base: 'PadB' }), base: null }],
    };
    const { report } = await run([other, alone]);
    expect(report.bodies[1]?.stop).toMatchObject({ reason: 'no-base' });
  });

  it.each([['nan'], ['1e999'], ['0'], ['-2'], ['1e8']])(
    'refuses a radius of %s',
    async (radius) => {
      const spec = dressUpSpec(FILLET);
      const props = (spec.props ?? []).filter((p) => !p.includes('name="Radius"'));
      const { body } = await run([
        {
          ...filletBody(),
          features: [
            filletBody().features[0] as never,
            { ...spec, props: [...props, num('Radius', radius)] },
          ],
        },
      ]);
      expect(body?.stop).toMatchObject({ object: 'Fillet', reason: 'value' });
    },
  );

  it('refuses UseAllEdges', async () => {
    const { body } = await run([filletBody({ UseAllEdges: true })]);
    expect(body?.stop).toMatchObject({ reason: 'option' });
  });

  it('refuses a chamfer type it does not know', async () => {
    const [pad, chamfer] = DRESSUP_CASES.chamfer_equal as [
      DressUpFixtureFeature,
      DressUpFixtureFeature,
    ];
    const { body } = await run([
      {
        ...filletBody(),
        features: [
          { name: 'Pad', type: 'Pad', length: 30, stored: pad.stored },
          dressUpSpec(chamfer, { ChamferTypeIndex: 7 }),
        ],
      },
    ]);
    expect(body?.stop).toMatchObject({ object: 'Chamfer', reason: 'value' });
  });
});

describe('matching', () => {
  /** The kernel, but the stored shape it describes is moved first by `by`. */
  const shifted = (by: [number, number, number]): ImportKernel => ({
    ...base,
    rebuild: (...a) => base.rebuild(...a),
    measureStoredShape: (...a) => base.measureStoredShape(...a),
    describeBodies: (b, n) => base.describeBodies(b, n),
    references: (i) => base.references(i),
    restart: () => base.restart(),
    describeStoredShape: (text, chain, ask) =>
      base.describeStoredShape(text, [{ position: by, rotation: [0, 0, 0, 1] }, ...chain], ask),
  });

  it('stops with `reference` when an edge has no counterpart, saying how near the nearest was', async () => {
    const { body } = await run([filletBody()], shifted([1e-3, 0, 0]));
    expect(body?.stop).toMatchObject({ reason: 'reference' });
    expect(body?.stop?.detail).toMatch(/no counterpart/);
    expect(body?.stop?.references).toMatchObject({ found: 0, none: 1, several: 0 });
    expect(body?.stop?.references?.nearestMiss).toBeCloseTo(1e-3, 9);
  });

  it('finds an edge moved by less than the tolerance', async () => {
    const { body } = await run([filletBody()], shifted([MATCH_TOLERANCE / 4, 0, 0]));
    expect(body?.outcome).toBe('history');
  });

  it('stops with `reference` when two rebuilt edges are within the tolerance', async () => {
    // The body described with each of its edges twice: every stored edge has two candidates.
    const twice: ImportKernel = {
      ...base,
      rebuild: (...a) => base.rebuild(...a),
      measureStoredShape: (...a) => base.measureStoredShape(...a),
      describeStoredShape: (...a) => base.describeStoredShape(...a),
      references: (i) => base.references(i),
      restart: () => base.restart(),
      describeBodies: async (bodies, near) => {
        const real = (await base.describeBodies(bodies, near)) as Record<string, ShapeElements>;
        const out: Record<string, ShapeElements> = {};
        for (const [id, d] of Object.entries(real))
          out[id] = {
            ...d,
            edgeCount: d.edgeCount * 2,
            edges: [...d.edges, ...d.edges.map((e) => ({ ...e, index: e.index + d.edgeCount }))],
            faces: d.faces.map((f) => ({
              ...f,
              edges: [...f.edges, ...f.edges.map((e) => e + d.edgeCount)],
            })),
          };
        return out;
      },
    };
    const { body } = await run([filletBody()], twice);
    expect(body?.stop).toMatchObject({ reason: 'reference' });
    expect(body?.stop?.detail).toMatch(/2 counterparts/);
    expect(body?.stop?.references).toMatchObject({ several: 1 });
  });

  it('finds the edges of a body in a moved and turned container (turned about z: S4 places no other)', async () => {
    const { body } = await run([filletBody({}, { placement: [5, -7, 9, Math.PI / 3, [0, 0, 1]] })]);
    expect(body?.stop).toBeUndefined();
    expect(body?.outcome).toBe('history');
  });
});

describe('a kernel that lies', () => {
  type Lie = (k: ImportKernel) => Partial<ImportKernel>;
  const lying = (lie: Lie): ImportKernel => {
    const honest: ImportKernel = {
      storedShapeToStep: (...a) => base.storedShapeToStep(...a),
      measureStoredShape: (...a) => base.measureStoredShape(...a),
      rebuild: (...a) => base.rebuild(...a),
      describeStoredShape: (...a) => base.describeStoredShape(...a),
      describeBodies: (b, n) => base.describeBodies(b, n),
      references: (i) => base.references(i),
      restart: () => base.restart(),
    };
    return { ...honest, ...lie(honest) };
  };
  const stored =
    (change: (d: ShapeElements) => unknown): Lie =>
    (k) => ({
      describeStoredShape: async (...a) =>
        change(await k.describeStoredShape(...a)) as ShapeElements,
    });
  const bodies =
    (change: (d: Record<string, ShapeElements>) => unknown): Lie =>
    (k) => ({
      describeBodies: async (b, n) =>
        change((await k.describeBodies(b, n)) as Record<string, ShapeElements>) as never,
    });
  const refs =
    (change: (r: (GeomRef | undefined)[]) => unknown): Lie =>
    (k) => ({
      references: async (i) => change([...(await k.references(i))]) as never,
    });
  const firstBody = (d: Record<string, ShapeElements>) => Object.values(d)[0] as ShapeElements;

  const lies: [string, Lie][] = [
    [
      'a stored count too small for the edge asked',
      stored((d) => ({ ...d, edgeCount: 0, edges: [] })),
    ],
    [
      'a stored edge out of its count',
      stored((d) => ({ ...d, edges: d.edges.map((e) => ({ ...e, index: 1e6 })) })),
    ],
    [
      'a NaN midpoint',
      stored((d) => ({
        ...d,
        edges: d.edges.map((e) => ({ ...e, midpoint: [Number.NaN, 0, 0] })),
      })),
    ],
    [
      'an infinite length',
      stored((d) => ({ ...d, edges: d.edges.map((e) => ({ ...e, length: Infinity })) })),
    ],
    [
      'a face index out of range',
      stored((d) => ({ ...d, edges: d.edges.map((e) => ({ ...e, faces: [99] })) })),
    ],
    [
      'a __proto__ key on an edge',
      stored((d) => ({
        ...d,
        edges: d.edges.map((e) => JSON.parse(`{"__proto__":{"x":1},${JSON.stringify(e).slice(1)}`)),
      })),
    ],
    ['not an object', stored(() => 'edges')],
    ['an edge given twice', stored((d) => ({ ...d, edges: [...d.edges, ...d.edges] }))],
    ['a body not asked for', bodies((d) => ({ ...d, other: firstBody(d) }))],
    [
      'a __proto__ body',
      bodies((d) => JSON.parse(`{"__proto__":${JSON.stringify(firstBody(d))}}`)),
    ],
    [
      'a body missing its edges',
      bodies((d) =>
        Object.fromEntries(
          Object.entries(d).map(([k, v]) => [k, { ...v, edges: v.edges.slice(1) }]),
        ),
      ),
    ],
    [
      'a body count over the cap',
      bodies((d) =>
        Object.fromEntries(Object.entries(d).map(([k, v]) => [k, { ...v, edgeCount: 1e12 }])),
      ),
    ],
    [
      'a reference of another body',
      refs((r) =>
        r.map(
          (x) =>
            x && { ...x, id: 'e[extrude:somewhere-else:side:a|extrude:somewhere-else:side:b]' },
        ),
      ),
    ],
    ['a face for an edge', refs((r) => r.map((x) => x && { ...x, kind: 'face' }))],
    ['a reference with an extra key', refs((r) => r.map((x) => x && { ...x, extra: 1 }))],
    [
      'a reference with a __proto__ key',
      refs((r) => r.map((x) => x && JSON.parse(`{"__proto__":{},${JSON.stringify(x).slice(1)}`))),
    ],
    [
      'a NaN fingerprint',
      refs((r) =>
        r.map((x) => x && { ...x, fingerprint: { type: 'line', at: [Number.NaN, 0, 0] } }),
      ),
    ],
    ['too few references', refs(() => [])],
    ['a missing reference', refs((r) => r.map(() => undefined))],
    [
      'a reference ID past its limit',
      refs((r) => r.map((x) => x && { ...x, id: `e[${'a:b:c|'.repeat(1000)}]` })),
    ],
  ];

  it('a body past the cap is a limit, not a kernel failure: no restart', async () => {
    const before = base.restarts;
    const over = bodies((d) =>
      Object.fromEntries(
        Object.entries(d).map(([k, v]) => [
          k,
          { edgeCount: 30_000, faceCount: v.faceCount, edges: [], faces: [], over: 30_000 },
        ]),
      ),
    );
    const { body } = await run([filletBody()], lying(over));
    expect(body?.stop).toMatchObject({ reason: 'limit' });
    expect(body?.stop?.detail).toMatch(/30000 edges/);
    expect(base.restarts).toBe(before);
  });

  it.each(lies)('%s is a kernel failure: restarted, the body falls back', async (_, lie) => {
    const before = base.restarts;
    const { body } = await run([filletBody()], lying(lie));
    expect(body?.stop).toMatchObject({
      object: 'Fillet',
      reason: 'kernel',
      detail: NONSENSE_REPLY,
    });
    expect(body?.outcome).toBe('shape');
    expect(base.restarts).toBe(before + 1);
  });

  it.each([['describeStoredShape' as const], ['describeBodies' as const], ['references' as const]])(
    '%s that throws or hangs stops the body',
    async (call) => {
      const throws = await run(
        [filletBody()],
        lying(() => ({ [call]: () => Promise.reject(new Error('boom')) })),
      );
      expect(throws.body?.stop).toMatchObject({ reason: 'kernel', detail: 'boom' });
      const hangs = await run(
        [filletBody()],
        lying(() => ({ [call]: () => new Promise(() => {}) })),
        2_000,
      );
      expect(hangs.body?.stop).toMatchObject({ reason: 'time' });
    },
  );
});

describe('the reply checks, alone', () => {
  it("use the kernel's cap on described edges", () => {
    expect(MAX_DESCRIBED_EDGES).toBe(KERNEL_MAX_DESCRIBED_EDGES);
  });

  it('take a reference only in the naming grammar, of the document sent and of the body', () => {
    const sent = new Set(['P', 'F', 'Q']);
    const body = new Set(['P', 'F']);
    const ok = {
      kind: 'edge',
      id: 'e[extrude:P:cap:end|fillet:F:from:(e[extrude:P:side:a|extrude:P:side:b])]@2',
    };
    expect(saneReference(ok, 'edge', sent, body)).toEqual(ok);
    expect(
      saneReference({ ...ok, id: 'e[extrude:Q:cap:end]' }, 'edge', sent, body),
    ).toBeUndefined();
    expect(
      saneReference({ ...ok, id: 'e[extrude:X:cap:end|extrude:P:cap:a]' }, 'edge', sent, body),
    ).toBeUndefined();
    expect(
      saneReference({ ...ok, id: 'e[extrude:P:cap:(end]' }, 'edge', sent, body),
    ).toBeUndefined();
    expect(saneReference({ kind: 'face', id: 'extrude:P:cap:end#2' }, 'face', sent, body)).toEqual({
      kind: 'face',
      id: 'extrude:P:cap:end#2',
    });
    expect(saneReference({ kind: 'face', id: ok.id }, 'face', sent, body)).toBeUndefined();
    expect(namedFeatures(`${'e['.repeat(40)}a:b:c${']'.repeat(40)}`)).toBeUndefined();
  });

  it('take a description only with every asked element in range', () => {
    const edge = {
      index: 0,
      type: 'line',
      length: 1,
      midpoint: [0, 0, 0],
      ends: [
        [0, 0, 0],
        [1, 0, 0],
      ],
      faces: [0],
    };
    const good = { edgeCount: 1, faceCount: 1, edges: [edge], faces: [] };
    expect(saneElements(good, { edges: [0], faces: [] })).toEqual(good);
    expect(saneElements(good, { edges: [0], faces: [0] })).toBeUndefined();
    expect(saneElements({ ...good, over: 10 }, { edges: [0], faces: [] })).toBeUndefined();
    expect(
      saneElements(
        { ...good, edges: [{ ...edge, type: 'LINE; drop' }] },
        { edges: [0], faces: [] },
      ),
    ).toBeUndefined();
  });
});
