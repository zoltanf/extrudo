// The topological-naming suite (P2-04, ADR-0005): real OCCT, real sketches,
// the recompute engine, and test features that use the same naming
// operations a real extrude, revolve or fillet does. Each scenario edits a
// document the way a user would and checks that references still land on
// the same face, edge or vertex, or fail the way they should.
import {
  type BodyId,
  EMBOSS_TYPE,
  type ExtrudoDocument,
  embossInputs,
  type Feature,
  type FeatureId,
  type FeatureStatus,
  type GeomRef,
  type Input,
  originPlaneRef,
  type SketchData,
  sketchInputs,
} from '@extrudo/core';
import { SketchBuilder } from '@extrudo/sketch/fixtures';
import { detectProfiles, type Profile, profileCentroid } from '@extrudo/sketch/profiles';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { SubShapeKind } from '../history';
import { Kernel } from '../kernel';
import { loadOcct } from '../occt/load';
import { RecomputeEngine } from '../recompute/engine';
import { type TestFeatures, testDocument, testFeature, testFeatures } from '../recompute/testing';
import type { RecomputeResult } from '../recompute/types';

let kernel: Kernel;
let features: TestFeatures;
let engine: RecomputeEngine;

beforeAll(async () => {
  kernel = new Kernel(await loadOcct());
});

beforeEach(() => {
  engine?.clear();
  expect(kernel.stats().liveShapes).toBe(0);
  features = testFeatures();
  engine = new RecomputeEngine(kernel, features.registry, { strictLeaks: true });
});

afterAll(() => {
  engine.clear();
  expect(kernel.stats().liveShapes).toBe(0);
});

type Plane = 'origin:xy' | 'origin:xz' | 'origin:yz';
type Done = Extract<RecomputeResult, { status: 'done' }>;

// ------------------------------------------------------------------ sketches

/** A rectangle's lines: bottom, right, top, left (counter-clockwise). */
function rect(b: SketchBuilder, x: number, y: number, w: number, h: number): string[] {
  return [
    b.line(x, y, x + w, y).id,
    b.line(x + w, y, x + w, y + h).id,
    b.line(x + w, y + h, x, y + h).id,
    b.line(x, y + h, x, y).id,
  ];
}

function sketch(id: string, data: SketchData, plane: Plane = 'origin:xy'): Feature {
  return { ...testFeature(id, 'sketch'), inputs: sketchInputs(originPlaneRef(plane), data) };
}

/** The profile of `data` that `pick` chooses (default: the largest), as a reference. */
function profile(
  sketchId: string,
  data: SketchData,
  pick: (profiles: Profile[]) => Profile | undefined = (p) => p[0],
): GeomRef {
  const found = pick(detectProfiles(data).sort((a, b) => b.area - a.area));
  if (!found) throw new Error('no profile');
  return { kind: 'profile', id: `${sketchId}/${found.id}` };
}

const refs = (...list: GeomRef[]): Input => ({ kind: 'ref', refs: list });
const enumInput = (value: string): Input => ({ kind: 'enum', value });

function extrude(
  id: string,
  profiles: GeomRef[],
  distance: string,
  options: { operation?: 'new' | 'join' | 'cut'; symmetric?: boolean } = {},
): Feature {
  return testFeature(
    id,
    'test-extrude',
    { distance },
    {
      profile: refs(...profiles),
      ...(options.operation ? { operation: enumInput(options.operation) } : {}),
      ...(options.symmetric ? { symmetric: { kind: 'bool', value: true } } : {}),
    },
  );
}

function revolve(id: string, prof: GeomRef, axis: 'x' | 'y', angle: string): Feature {
  return testFeature(
    id,
    'test-revolve',
    {},
    {
      profile: refs(prof),
      axis: enumInput(axis),
      angle: { kind: 'expr', expr: angle, unit: 'angle', paramName: `a_${id}` },
    },
  );
}

const fillet = (id: string, edges: GeomRef[], radius: string) =>
  testFeature(id, 'test-fillet', { radius }, { edges: refs(...edges) });
const probe = (id: string, ...targets: GeomRef[]) =>
  testFeature(id, 'test-probe', {}, { target: refs(...targets) });

// ------------------------------------------------------------------ results

async function run(doc: ExtrudoDocument, on: RecomputeEngine = engine): Promise<Done> {
  const result = await on.recompute({ doc });
  if (result.status !== 'done') throw new Error('cancelled');
  return result;
}

const status = (result: Done, id: string): FeatureStatus =>
  result.features[id as FeatureId] ?? { status: 'ok' };

function ok(result: Done): Done {
  for (const [id, s] of Object.entries(result.features)) {
    if (s.status !== 'ok') throw new Error(`${id}: ${s.status} ${s.message ?? ''}`);
  }
  return result;
}

/** The persistent names of one body of a result (default: the first). */
function names(result: Done, body?: string) {
  const found = body ? result.bodies.find((b) => b.id === body) : result.bodies[0];
  const mesh = found?.mesh;
  if (!found || !mesh?.faceIds || !mesh.edgeIds || !mesh.vertexIds) throw new Error('no names');
  return { faces: mesh.faceIds, edges: mesh.edgeIds, vertices: mesh.vertexIds, body: found.id };
}

/** A reference, with its fingerprint, to the sub-shape named `id` in the last recompute. */
function refTo(result: Done, kind: SubShapeKind, id: string): GeomRef {
  for (const body of result.bodies) {
    const list =
      kind === 'face'
        ? body.mesh?.faceIds
        : kind === 'edge'
          ? body.mesh?.edgeIds
          : body.mesh?.vertexIds;
    const index = list?.indexOf(id) ?? -1;
    if (index < 0) continue;
    const ref = engine.reference(body.id, kind, index);
    if (ref) return ref;
  }
  throw new Error(`no ${kind} named ${id}`);
}

const withoutFingerprint = (ref: GeomRef): GeomRef => ({ kind: ref.kind, id: ref.id });

/** Where a named face (centroid), edge (midpoint) or vertex is now. */
function whereIs(result: Done, kind: SubShapeKind, id: string): [number, number, number] {
  return refTo(result, kind, id).fingerprint?.at as [number, number, number];
}

const lastProbe = (feature: string) =>
  [...features.probes].reverse().find((p) => p.feature === feature);

const E = (role: string) => `extrude:E:${role}`;
const edge = (...faces: string[]) => `e[${[...faces].sort().join('|')}]`;
const vertex = (...faces: string[]) => `v[${[...faces].sort().join('|')}]`;

// ----------------------------------------------------------------- the part

/** A 30 × 10 plate, 5 mm thick, from a rectangle on XY; `h` moves its top line. */
function plate(h = 10, more?: (b: SketchBuilder) => void) {
  const b = new SketchBuilder();
  const [bottom, right, top, left] = rect(b, 0, 0, 30, h) as [string, string, string, string];
  more?.(b);
  return { data: b.sketch, bottom, right, top, left };
}

/** A slot cut across the plate's top (x from `at` to `at + 4`, z 3..7), through in y. */
function slotCut(id: string, at: number): Feature[] {
  const b = new SketchBuilder();
  rect(b, at, 3, 4, 4);
  return [
    sketch(`${id}s`, b.sketch, 'origin:xz'),
    extrude(id, [profile(`${id}s`, b.sketch)], '40 mm', { operation: 'cut', symmetric: true }),
  ];
}

describe('topological naming', { timeout: 60_000 }, () => {
  it('1. an extrude names every face after why it exists, and edges and vertices after their faces', async () => {
    const p = plate();
    const result = ok(
      await run(testDocument([sketch('S', p.data), extrude('E', [profile('S', p.data)], '5 mm')])),
    );
    const n = names(result);
    expect([...n.faces].sort()).toEqual(
      [
        E('cap:start'),
        E('cap:end'),
        ...[p.bottom, p.right, p.top, p.left].map((l) => E(`side:${l}`)),
      ].sort(),
    );
    expect(new Set(n.edges).size).toBe(12);
    expect(new Set(n.vertices).size).toBe(8);
    expect(n.edges).toContain(edge(E('cap:end'), E(`side:${p.top}`)));
    expect(n.edges).toContain(edge(E(`side:${p.left}`), E(`side:${p.top}`)));
    expect(n.vertices).toContain(vertex(E('cap:end'), E(`side:${p.left}`), E(`side:${p.top}`)));
    // The names sit on the right geometry.
    expect(whereIs(result, 'face', E('cap:end'))).toEqual([15, 5, 5]);
    expect(whereIs(result, 'face', E(`side:${p.top}`))).toEqual([15, 10, 2.5]);
    expect(
      whereIs(
        result,
        'vertex',
        vertex(E('cap:start'), E(`side:${p.bottom}`), E(`side:${p.right}`)),
      ),
    ).toEqual([30, 0, 0]);
  });

  it('2. names are the same after a kernel restart and on cache hits', async () => {
    const p = plate(10, (b) => b.circle(20, 5, 2));
    const doc = testDocument([
      sketch('S', p.data),
      extrude('E', [profile('S', p.data)], '5 mm'),
      ...slotCut('C', 8),
    ]);
    const first = names(ok(await run(doc)));
    const again = await run(doc);
    expect(again.stats.evaluated).toEqual([]);
    expect(names(again)).toEqual(first);

    const other = new Kernel(await loadOcct());
    const fresh = new RecomputeEngine(other, testFeatures().registry, { strictLeaks: true });
    expect(names(ok(await run(doc, fresh)))).toEqual(first);
    fresh.clear();
    other.dispose();
  });

  it('3. a fillet stays on its edge when a sketch dimension changes', async () => {
    const make = (h: number, target?: GeomRef) => {
      const p = plate(h);
      const features = [sketch('S', p.data), extrude('E', [profile('S', p.data)], '5 mm')];
      if (target) features.push(fillet('F', [target], '1 mm'));
      return { doc: testDocument(features), p };
    };
    const { doc, p } = make(10);
    const rim = edge(E('cap:end'), E(`side:${p.top}`));
    const target = refTo(ok(await run(doc)), 'edge', rim);

    const before = ok(await run(make(10, target).doc));
    const round = `fillet:F:from:(${rim})`;
    expect(names(before).faces).toContain(round);
    // A quarter-round of radius 1 about (y 9, z 4): its centroid is 2/π off the axis.
    expect(whereIs(before, 'face', round)[1]).toBeCloseTo(9 + 2 / Math.PI, 3);

    // The top line moves from y = 10 to y = 14 (its dimension changed).
    const after = ok(await run(make(14, target).doc));
    expect(names(after).faces).toContain(round);
    expect(whereIs(after, 'face', round)[1]).toBeCloseTo(13 + 2 / Math.PI, 3);
    expect(names(after).faces).toEqual(names(before).faces);
  });

  it('4. adding and removing a hole in the sketch adds and removes its faces, nothing else', async () => {
    const plain = plate();
    const holed = plate(10, (b) => b.circle(20, 5, 2));
    const hole = Object.keys(holed.data.entities).find((k) => k.startsWith('c')) as string;
    // A hole doesn't change the outline, so the profile keeps its ID.
    expect(profile('S', holed.data)).toEqual(profile('S', plain.data));
    const doc = (data: SketchData, target?: GeomRef) =>
      testDocument([
        sketch('S', data),
        extrude('E', [profile('S', data)], '5 mm'),
        ...(target ? [fillet('F', [target], '1 mm')] : []),
      ]);
    const rim = edge(E('cap:end'), E(`side:${plain.top}`));
    const target = refTo(ok(await run(doc(plain.data))), 'edge', rim);

    const without = names(ok(await run(doc(plain.data, target))));
    const withHole = names(ok(await run(doc(holed.data, target))));
    const added = withHole.faces.filter((f) => !without.faces.includes(f));
    expect(added).toEqual([E(`side:${hole}`)]);
    expect(without.faces.every((f) => withHole.faces.includes(f))).toBe(true);
    expect(withHole.edges).toContain(edge(E(`side:${hole}`))); // the seam
    expect(withHole.edges).toContain(edge(E('cap:end'), E(`side:${hole}`)));

    // Remove it again: the same names as before.
    expect(names(ok(await run(doc(plain.data, target))))).toEqual(without);
  });

  it('5. a reference to a removed sketch edge fails with a message that says what to do', async () => {
    // A plate with its top-right corner chamfered by line `cut`.
    const chamfered = (withChamfer: boolean) => {
      const b = new SketchBuilder();
      const bottom = b.line(0, 0, 30, 0).id;
      const right = b.line(30, 0, 30, withChamfer ? 7 : 10).id;
      const cut = b.line(30, 7, 27, 10).id;
      const top = b.line(withChamfer ? 27 : 30, 10, 0, 10).id;
      const left = b.line(0, 10, 0, 0).id;
      if (!withChamfer) delete b.entities[cut];
      return { data: b.sketch, bottom, right, cut, top, left };
    };
    const a = chamfered(true);
    const doc = (data: SketchData, ...more: Feature[]) =>
      testDocument([sketch('S', data), extrude('E', [profile('S', data)], '5 mm'), ...more]);
    const first = ok(await run(doc(a.data)));
    const corner = refTo(first, 'edge', edge(E('cap:end'), E(`side:${a.cut}`)));
    const kept = refTo(first, 'edge', edge(E('cap:end'), E(`side:${a.left}`)));
    ok(await run(doc(a.data, probe('P', kept, corner))));

    // Without the chamfer line (the extrude's profile follows the new outline).
    const b = chamfered(false);
    const result = await run(doc(b.data, probe('P', kept), probe('Q', withoutFingerprint(corner))));
    expect(status(result, 'P')).toEqual({ status: 'ok' });
    expect(lastProbe('P')?.resolved?.via).toBe('name');
    expect(status(result, 'Q')).toEqual({
      status: 'error',
      message:
        "Can't find its edge any more: an earlier change removed it. Edit the feature and pick it again.",
      refs: [{ ref: { kind: 'edge', id: expect.any(String) }, state: 'lost' }],
    });
  });

  it('6. reordering sketch entities changes no name', async () => {
    const p = plate(10, (b) => {
      b.circle(20, 5, 2);
      b.arc(5, 5, 2, 0, 180);
      b.line(3, 5, 7, 5);
    });
    const reversed: SketchData = {
      ...p.data,
      entities: Object.fromEntries(Object.entries(p.data.entities).reverse()),
    };
    const doc = (data: SketchData) =>
      testDocument([sketch('S', data), extrude('E', [profile('S', data)], '5 mm')]);
    expect(names(ok(await run(doc(reversed))))).toEqual(names(ok(await run(doc(p.data)))));
  });

  it('7. a cut that splits a face numbers the pieces by position, and keeps them when the cut moves', async () => {
    const p = plate();
    const doc = (at: number) =>
      testDocument([
        sketch('S', p.data),
        extrude('E', [profile('S', p.data)], '5 mm'),
        ...slotCut('C', at),
      ]);
    const result = ok(await run(doc(10)));
    const n = names(result);
    expect(n.faces).not.toContain(E('cap:end'));
    expect(n.faces).toContain(E('cap:end#1'));
    expect(n.faces).toContain(E('cap:end#2'));
    expect(whereIs(result, 'face', E('cap:end#1'))[0]).toBeCloseTo(5);
    expect(whereIs(result, 'face', E('cap:end#2'))[0]).toBeCloseTo(22);
    // The slot's walls and floor are named after the cut's sketch.
    expect(n.faces.filter((f) => f.startsWith('extrude:C:side:'))).toHaveLength(3);
    // A side face with a notch in it is still one face.
    expect(n.faces).toContain(E(`side:${p.bottom}`));

    const moved = ok(await run(doc(18)));
    expect(names(moved).faces).toEqual(n.faces);
    expect(whereIs(moved, 'face', E('cap:end#1'))[0]).toBeCloseTo(9);
  });

  it('8. a face a cut removes entirely is reported as missing', async () => {
    const p = plate();
    const base = [sketch('S', p.data), extrude('E', [profile('S', p.data)], '5 mm')];
    const end = refTo(ok(await run(testDocument(base))), 'face', E(`side:${p.right}`));
    // Cut away everything past x = 25, the whole right end.
    const b = new SketchBuilder();
    rect(b, 25, -1, 10, 7);
    const cut = [
      sketch('Rs', b.sketch, 'origin:xz'),
      extrude('R', [profile('Rs', b.sketch)], '40 mm', { operation: 'cut', symmetric: true }),
    ];
    const result = await run(testDocument([...base, ...cut, probe('P', withoutFingerprint(end))]));
    expect(names(result).faces).not.toContain(E(`side:${p.right}`));
    expect(status(result, 'P')).toMatchObject({
      status: 'error',
      message: expect.stringMatching(/^Can't find its face any more/),
      refs: [{ ref: { kind: 'face', id: E(`side:${p.right}`) }, state: 'lost' }],
    });
  });

  it('9. a name that no longer exists falls back to the fingerprint, with a warning', async () => {
    const p = plate();
    const top = refTo(
      ok(
        await run(
          testDocument([sketch('S', p.data), extrude('E', [profile('S', p.data)], '5 mm')]),
        ),
      ),
      'face',
      E(`side:${p.top}`),
    );
    // The extrude was deleted and made again: same geometry, new feature ID.
    const again = [sketch('S', p.data), extrude('E2', [profile('S', p.data)], '5 mm')];
    const result = await run(testDocument([...again, probe('P', top)]));
    expect(lastProbe('P')?.resolved).toMatchObject({
      via: 'fingerprint',
      id: `extrude:E2:side:${p.top}`,
    });
    expect(status(result, 'P')).toEqual({
      status: 'warning',
      message:
        'Lost its face after an earlier change and picked the closest match. Check the result, or edit the feature and pick it again.',
      // What it took, with a fresh fingerprint: storing it makes the reference exact (ADR-0033).
      refs: [
        {
          ref: { kind: 'face', id: top.id },
          state: 'guessed',
          now: {
            kind: 'face',
            id: `extrude:E2:side:${p.top}`,
            fingerprint: expect.objectContaining({ type: 'plane' }),
          },
        },
      ],
    });
    // Nothing like it left (a revolved ring instead): an error, not a wild guess.
    const b = new SketchBuilder();
    rect(b, 50, 0, 2, 2);
    const ring = [sketch('T', b.sketch), revolve('V', profile('T', b.sketch), 'y', '360 deg')];
    const none = await run(testDocument([...ring, probe('P', top)]));
    expect(status(none, 'P').status).toBe('error');
  });

  it('10. a split face is found again: edges by related names, faces by fingerprint', async () => {
    const p = plate();
    const base = [sketch('S', p.data), extrude('E', [profile('S', p.data)], '5 mm')];
    const first = ok(await run(testDocument(base)));
    const leftRim = refTo(first, 'edge', edge(E('cap:end'), E(`side:${p.left}`)));
    const top = refTo(first, 'face', E('cap:end'));
    // A slot is inserted before the probes, splitting the top face.
    const result = await run(
      testDocument([...base, ...slotCut('C', 10), probe('P', leftRim), probe('Q', top)]),
    );
    expect(lastProbe('P')?.resolved).toMatchObject({
      via: 'related',
      id: edge(E('cap:end#1'), E(`side:${p.left}`)),
    });
    expect(status(result, 'P')).toEqual({ status: 'ok' });
    // The larger piece, right of the slot, is closer to the old top face.
    expect(lastProbe('Q')?.resolved).toMatchObject({ via: 'related', id: E('cap:end#2') });
    expect(status(result, 'Q')).toMatchObject({
      status: 'warning',
      message: expect.stringMatching(/^Its face was split/),
      refs: [
        { ref: { kind: 'face', id: E('cap:end') }, state: 'guessed', now: { id: E('cap:end#2') } },
      ],
    });
  });

  it('11. a partial revolve names its caps and sides, and keeps them when the angle changes', async () => {
    const b = new SketchBuilder();
    const lines = rect(b, 5, 0, 3, 4);
    const doc = (angle: string) =>
      testDocument([sketch('S', b.sketch), revolve('V', profile('S', b.sketch), 'y', angle)]);
    const quarter = ok(await run(doc('90 deg')));
    const n = names(quarter);
    expect([...n.faces].sort()).toEqual(
      [
        'revolve:V:cap:start',
        'revolve:V:cap:end',
        ...lines.map((l) => `revolve:V:side:${l}`),
      ].sort(),
    );
    expect(whereIs(quarter, 'face', 'revolve:V:cap:start')).toEqual([6.5, 2, 0]);
    const wider = ok(await run(doc('120 deg')));
    expect(names(wider)).toEqual(n);
  });

  it('12. a full revolve has no caps and names every swept face, cones included', async () => {
    const b = new SketchBuilder();
    const lines = rect(b, 5, 0, 3, 4);
    const ring = ok(
      await run(
        testDocument([sketch('S', b.sketch), revolve('V', profile('S', b.sketch), 'y', '360 deg')]),
      ),
    );
    // The annuli square to the axis (OCCT's MakeRevol::Generated misses them) are named too.
    expect([...names(ring).faces].sort()).toEqual(lines.map((l) => `revolve:V:side:${l}`).sort());

    const c = new SketchBuilder();
    const base = c.line(0, 0, 5, 0).id;
    const slant = c.line(5, 0, 0, 6).id;
    c.line(0, 6, 0, 0); // on the axis: sweeps into nothing
    const cone = ok(
      await run(
        testDocument([sketch('S', c.sketch), revolve('V', profile('S', c.sketch), 'y', '360 deg')]),
      ),
    );
    const n = names(cone);
    expect([...n.faces].sort()).toEqual(
      [`revolve:V:side:${base}`, `revolve:V:side:${slant}`].sort(),
    );
    expect(new Set(n.edges).size).toBe(n.edges.length);
    expect(n.vertices).toContain(vertex(`revolve:V:side:${slant}`)); // the apex
  });

  it('13. a hole cut through a body is named after its circle, and a fillet on its rim survives a new radius', async () => {
    const p = plate();
    const make = (radius: number, target?: GeomRef) => {
      const b = new SketchBuilder();
      const circle = b.circle(15, 5, radius).id;
      return {
        circle,
        doc: testDocument([
          sketch('S', p.data),
          extrude('E', [profile('S', p.data)], '5 mm'),
          sketch('Hs', b.sketch),
          extrude('H', [profile('Hs', b.sketch)], '20 mm', { operation: 'cut', symmetric: true }),
          ...(target ? [fillet('F', [target], '0.5 mm')] : []),
        ]),
      };
    };
    const { circle, doc } = make(2);
    const first = ok(await run(doc));
    const wall = `extrude:H:side:${circle}`;
    expect(names(first).faces).toContain(wall);
    expect(refTo(first, 'face', wall).fingerprint?.type).toBe('cylinder');
    const rim = edge(E('cap:end'), wall);
    const target = refTo(first, 'edge', rim);
    const filleted = ok(await run(make(2, target).doc));
    expect(names(filleted).faces).toContain(`fillet:F:from:(${rim})`);
    const larger = ok(await run(make(3, target).doc));
    expect(names(larger).faces).toContain(`fillet:F:from:(${rim})`);
    expect(names(larger).faces).toEqual(names(filleted).faces);
  });

  it('14. joining two bodies keeps the names of both; a flush join merges faces under the older name', async () => {
    const p = plate();
    const b = new SketchBuilder();
    const boss = rect(b, 10, 2, 6, 6);
    const two = [
      sketch('S', p.data),
      extrude('E', [profile('S', p.data)], '5 mm'),
      sketch('Bs', b.sketch),
      extrude('B', [profile('Bs', b.sketch)], '8 mm'),
    ];
    const separate = ok(await run(testDocument(two)));
    expect(separate.bodies.map((body) => body.id)).toEqual(['E:0', 'B:0']);
    const joined = ok(await run(testDocument([...two, testFeature('J', 'test-combine')])));
    expect(joined.bodies.map((body) => body.id)).toEqual(['E:0']);
    const n = names(joined);
    expect(n.faces).toContain(E('cap:end'));
    // The boss's bottom lay inside the plate's: merged back into one face.
    expect(n.faces).toContain(E('cap:start'));
    expect(n.faces).not.toContain('extrude:B:cap:start');
    expect(n.faces).toContain('extrude:B:cap:end');
    for (const line of boss) expect(n.faces).toContain(`extrude:B:side:${line}`);

    // A block flush with the plate's front (y = 0) and ends: the front faces merge.
    const c = new SketchBuilder();
    const block = rect(c, 0, 0, 30, 2);
    const flush = ok(
      await run(
        testDocument([
          sketch('S', p.data),
          extrude('E', [profile('S', p.data)], '5 mm'),
          sketch('Fs', c.sketch),
          extrude('K', [profile('Fs', c.sketch)], '9 mm', { operation: 'join' }),
        ]),
      ),
    );
    const merged = names(flush).faces;
    // Front, ends and bottom merged with the plate's and kept its names; the
    // block keeps only its top and the back of the step.
    for (const face of [`side:${p.bottom}`, `side:${p.left}`, `side:${p.right}`, 'cap:start']) {
      expect(merged).toContain(E(face));
    }
    expect(merged.filter((f) => f.startsWith('extrude:K:')).sort()).toEqual(
      ['extrude:K:cap:end', `extrude:K:side:${block[2]}`].sort(),
    );
    expect(merged).toHaveLength(8);
  });

  it('15. circles, arcs and slots: periodic faces, seams and their vertices are named', async () => {
    const b = new SketchBuilder();
    const circle = b.circle(0, 0, 5).id;
    const s1 = b.line(20, 0, 40, 0).id;
    const a1 = b.arc(40, 5, 5, -90, 90).id;
    const s2 = b.line(40, 10, 20, 10).id;
    const a2 = b.arc(20, 5, 5, 90, 270).id;
    const byX = (x: number) => (profiles: Profile[]) =>
      profiles.find((q) => Math.abs((profileCentroid(q)[0] as number) - x) < 1);
    const doc = testDocument([
      sketch('S', b.sketch),
      extrude('E', [profile('S', b.sketch, byX(0))], '3 mm'),
      extrude('L', [profile('S', b.sketch, byX(30))], '3 mm'),
    ]);
    const result = ok(await run(doc));
    const cyl = names(result, 'E:0');
    expect([...cyl.faces].sort()).toEqual([E('cap:end'), E('cap:start'), E(`side:${circle}`)]);
    expect([...cyl.edges].sort()).toEqual(
      [
        edge(E('cap:end'), E(`side:${circle}`)),
        edge(E('cap:start'), E(`side:${circle}`)),
        edge(E(`side:${circle}`)),
      ].sort(),
    );
    expect([...cyl.vertices].sort()).toEqual(
      [
        vertex(E('cap:end'), E(`side:${circle}`)),
        vertex(E('cap:start'), E(`side:${circle}`)),
      ].sort(),
    );
    const slot = names(result, 'L:0');
    for (const curve of [s1, a1, s2, a2]) expect(slot.faces).toContain(`extrude:L:side:${curve}`);
    expect(refTo(result, 'face', `extrude:L:side:${a1}`).fingerprint?.type).toBe('cylinder');
    expect(new Set(slot.edges).size).toBe(slot.edges.length);
  });

  it('16. a curve that bounds a profile twice names both side faces, numbered along x', async () => {
    // A U crossed by a line through both prongs: the U's base below the line
    // is bounded by two pieces of that line.
    const make = (w: number) => {
      const b = new SketchBuilder();
      const pts: [number, number][] = [
        [0, 0],
        [w, 0],
        [w, 20],
        [w - 10, 20],
        [w - 10, 10],
        [10, 10],
        [10, 20],
        [0, 20],
      ];
      pts.forEach((pt, i) => {
        const next = pts[(i + 1) % pts.length] as [number, number];
        b.line(pt[0], pt[1], next[0], next[1]);
      });
      const across = b.line(-5, 15, w + 5, 15).id;
      return { data: b.sketch, across };
    };
    const doc = (w: number) => {
      const { data } = make(w);
      return testDocument([sketch('S', data), extrude('E', [profile('S', data)], '5 mm')]);
    };
    const { across } = make(30);
    const result = ok(await run(doc(30)));
    const n = names(result);
    expect(n.faces).toContain(E(`side:${across}#1`));
    expect(n.faces).toContain(E(`side:${across}#2`));
    expect(whereIs(result, 'face', E(`side:${across}#1`))[0]).toBeCloseTo(5);
    expect(whereIs(result, 'face', E(`side:${across}#2`))[0]).toBeCloseTo(25);
    const wider = ok(await run(doc(40)));
    expect(names(wider).faces).toEqual(n.faces);
    expect(whereIs(wider, 'face', E(`side:${across}#2`))[0]).toBeCloseTo(35);
  });

  it('17. several profiles at once: repeated names are numbered; symmetric keeps the roles', async () => {
    const b = new SketchBuilder();
    const left = rect(b, 0, 0, 10, 10);
    const right = rect(b, 20, 0, 10, 10);
    const both = detectProfiles(b.sketch).map(
      (q) => ({ kind: 'profile', id: `S/${q.id}` }) as GeomRef,
    );
    const result = ok(
      await run(
        testDocument([sketch('S', b.sketch), extrude('E', both, '6 mm', { symmetric: true })]),
      ),
    );
    const n = names(result);
    for (const cap of ['cap:start#1', 'cap:start#2', 'cap:end#1', 'cap:end#2'])
      expect(n.faces).toContain(E(cap));
    for (const line of [...left, ...right]) expect(n.faces).toContain(E(`side:${line}`));
    expect(whereIs(result, 'face', E('cap:start#1'))).toEqual([5, 5, -3]);
    expect(whereIs(result, 'face', E('cap:end#2'))).toEqual([25, 5, 3]);
  });

  it('18. every reference the engine hands out resolves back to its own sub-shape', async () => {
    const p = plate(10, (b) => b.circle(20, 5, 2));
    const base = [
      sketch('S', p.data),
      extrude('E', [profile('S', p.data)], '5 mm'),
      ...slotCut('C', 8),
    ];
    const first = ok(await run(testDocument(base)));
    const body = first.bodies[0]?.id as BodyId;
    const n = names(first);
    const all: GeomRef[] = [];
    const expected: string[] = [];
    for (const kind of ['face', 'edge', 'vertex'] as const) {
      const list = kind === 'face' ? n.faces : kind === 'edge' ? n.edges : n.vertices;
      list.forEach((id, index) => {
        const ref = engine.reference(body, kind, index);
        expect(ref?.id).toBe(id);
        all.push(ref as GeomRef);
        expected.push(`${kind}:${index}`);
      });
    }
    expect(new Set(n.faces).size + new Set(n.edges).size + new Set(n.vertices).size).toBe(
      all.length,
    );
    ok(await run(testDocument([...base, probe('P', ...all)])));
    const got = features.probes
      .filter((q) => q.feature === 'P')
      .map((q) => `${q.resolved?.kind}:${q.resolved?.index}`);
    expect(got).toEqual(expected);
    expect(features.probes.every((q) => q.resolved?.via === 'name')).toBe(true);
  });

  it('19. a wrap on a cylinder names its walls after the sketch curves, and they keep their names', async () => {
    const b = new SketchBuilder();
    const lines = rect(b, -5, 8, 10, 4);
    const data = b.sketch;
    const cylinder = (height: string): Feature => ({
      ...testFeature('C', 'cylinder'),
      inputs: {
        diameter: { kind: 'expr', expr: '40 mm', unit: 'length' },
        height: { kind: 'expr', expr: height, unit: 'length' },
      },
    });
    const doc = (height: string, targets?: GeomRef[]) =>
      testDocument([
        cylinder(height),
        sketch('S', data, 'origin:xz'),
        {
          ...testFeature('M', EMBOSS_TYPE),
          inputs: embossInputs(
            [profile('S', data)],
            { kind: 'face', id: 'cylinder:C:side:wall' },
            { depth: '1 mm' },
          ),
        },
        ...(targets ? [probe('P', ...targets)] : []),
      ]);

    const first = names(ok(await run(doc('20 mm'))));
    const walls = lines.map((line) => `emboss:M:side:${line}`);
    // The letters stand 1 mm proud of the wall; their own cap on the wall merges
    // into it, and the four side faces are named after the sketch's lines.
    expect(first.faces).toContain('emboss:M:cap:end');
    for (const wall of walls) expect(first.faces).toContain(wall);
    expect(new Set(first.faces).size).toBe(first.faces.length);
    const again = ok(await run(doc('20 mm')));
    const letters = [...walls, 'emboss:M:cap:end'].map((id) => refTo(again, 'face', id));
    // Every one of them resolves by its own name, and still does when the
    // cylinder gets taller (the wrap moves with the letters).
    ok(await run(doc('20 mm', letters)));
    expect(features.probes.filter((q) => q.feature === 'P').at(-1)?.resolved?.via).toBe('name');
    const taller = ok(await run(doc('30 mm', letters)));
    expect(names(taller).faces).toEqual(first.faces);
    expect(
      features.probes.filter((q) => q.feature === 'P').every((q) => q.resolved?.via === 'name'),
    ).toBe(true);
  });

  it('20. bodies without naming tables are named by position; a table that does not fit fails without leaking', async () => {
    const result = ok(await run(testDocument([testFeature('B', 'test-box', { size: '10 mm' })])));
    expect([...names(result).faces].sort()).toEqual(
      Array.from({ length: 6 }, (_, i) => `test-box:B:face#${i + 1}`).sort(),
    );
    const bad = await run(testDocument([testFeature('X', 'test-bad-names')]));
    expect(status(bad, 'X')).toEqual({
      status: 'error',
      message: "Internal error: gives body X:0 a naming table that doesn't match its shape",
    });
    expect(bad.stats.liveShapes).toBe(engine.size.shapes);
  });
});
