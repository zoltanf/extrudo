// The shell feature (P3-03, ADR-0046) through the recompute engine with real
// OCCT: faces removed as openings, closed hollow bodies, inside and outside,
// several bodies, the names shell faces get (ADR-0005: the outer skin keeps
// the original names), lost references, and the messages of failed shells
// with the largest thickness that works (FR-UX-06).
// `golden/shell-options.json` is a golden table of cases (a Vitest file
// snapshot); rewrite it with `pnpm vitest run -u packages/kernel/src/features/shell`
// and review the diff.
import {
  type ExtrudoDocument,
  extrudeInputs,
  type Feature,
  type FeatureId,
  FeatureRegistry,
  type FeatureStatus,
  filletInputs,
  type GeomRef,
  originPlaneRef,
  type ShellInputOptions,
  type SketchData,
  shellInputs,
  sketchInputs,
} from '@extrudo/core';
import { SketchBuilder } from '@extrudo/sketch/fixtures';
import { detectProfiles } from '@extrudo/sketch/profiles';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { SubShapeKind } from '../history';
import { Kernel, type ShapeHandle } from '../kernel';
import { edgeName } from '../naming';
import { loadOcct } from '../occt/load';
import { RecomputeEngine } from '../recompute/engine';
import { testDocument, testFeature, testFeatures } from '../recompute/testing';
import type { KernelFeatureDefinition, RecomputeResult } from '../recompute/types';

let kernel: Kernel;
let engine: RecomputeEngine;

beforeAll(async () => {
  kernel = new Kernel(await loadOcct());
});

beforeEach(() => {
  engine?.clear();
  expect(kernel.stats().liveShapes).toBe(0);
  const registry = new FeatureRegistry<KernelFeatureDefinition>();
  for (const definition of testFeatures().registry.list()) registry.register(definition);
  engine = new RecomputeEngine(kernel, registry, { strictLeaks: true });
});

afterAll(() => {
  engine.clear();
  expect(kernel.stats().liveShapes).toBe(0);
});

type Done = Extract<RecomputeResult, { status: 'done' }>;

// ------------------------------------------------------------------ helpers

function rect(b: SketchBuilder, x: number, y: number, w: number, h: number) {
  return {
    bottom: b.line(x, y, x + w, y).id,
    right: b.line(x + w, y, x + w, y + h).id,
    top: b.line(x + w, y + h, x, y + h).id,
    left: b.line(x, y + h, x, y).id,
  };
}

function sketch(id: string, data: SketchData): Feature {
  return { ...testFeature(id, 'sketch'), inputs: sketchInputs(originPlaneRef('origin:xy'), data) };
}

function extrude(id: string, sketchId: string, data: SketchData, distance: string): Feature {
  const found = detectProfiles(data)[0];
  if (!found) throw new Error('no profile');
  const ref: GeomRef = { kind: 'profile', id: `${sketchId}/${found.id}` };
  return { ...testFeature(id, 'extrude'), inputs: extrudeInputs([ref], { distance }) };
}

function shell(
  id: string,
  faces: GeomRef[],
  thickness: string,
  options: ShellInputOptions = {},
): Feature {
  return { ...testFeature(id, 'shell'), inputs: shellInputs(faces, thickness, options) };
}

async function run(doc: ExtrudoDocument): Promise<Done> {
  const result = await engine.recompute({ doc });
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

/** The body shapes of the last `runWithShapes`. */
let bodyShapes = new Map<string, ShapeHandle>();

/** A recompute that also captures the body shapes (through a spy on the kernel's mesh call). */
async function runWithShapes(doc: ExtrudoDocument): Promise<Done> {
  bodyShapes = new Map();
  const shapes: ShapeHandle[] = [];
  const mesh = kernel.mesh.bind(kernel);
  kernel.mesh = (shape, options) => {
    shapes.push(shape);
    return mesh(shape, options);
  };
  try {
    const result = await run(doc);
    result.bodies.forEach((b, i) => {
      const shape = shapes[i];
      if (shape !== undefined) bodyShapes.set(b.id, shape);
    });
    return result;
  } finally {
    kernel.mesh = mesh;
  }
}

function measure(body: string) {
  const shape = bodyShapes.get(body) as ShapeHandle;
  return {
    volume: kernel.measure(shape).volume,
    faces: kernel.count(shape, 'face'),
    valid: kernel.isValid(shape),
  };
}

const round = (x: number, digits = 3) => {
  const r = Number(x.toFixed(digits));
  return Object.is(r, -0) ? 0 : r;
};

const BOX = { w: 40, d: 30, h: 20 };
const BOX_VOLUME = BOX.w * BOX.d * BOX.h;

/** A 40 × 30 × 20 mm block (body `B:0`) on XY from z = 0 up. */
function block() {
  const b = new SketchBuilder();
  const lines = rect(b, 0, 0, BOX.w, BOX.d);
  return {
    lines,
    features: [sketch('SB', b.sketch), extrude('B', 'SB', b.sketch, `${BOX.h} mm`)],
  };
}

/** The name of the edge between two faces of block B. */
const between = (a: string, b: string) => edgeName([a, b]);
const cap = 'extrude:B:cap:end';
const floor = 'extrude:B:cap:start';
const side = (line: string) => `extrude:B:side:${line}`;

/** A block whose four vertical edges are rounded with 5 mm. */
async function roundedBlock() {
  const base = block();
  const l = base.lines;
  const corners = [
    between(side(l.bottom), side(l.right)),
    between(side(l.right), side(l.top)),
    between(side(l.top), side(l.left)),
    between(side(l.left), side(l.bottom)),
  ];
  const first = ok(await run(testDocument(base.features)));
  const rounded: Feature = {
    ...testFeature('R', 'fillet'),
    inputs: {
      edges: { kind: 'ref', refs: corners.map((name) => refTo(first, 'edge', name)) },
      radius: { kind: 'expr', expr: '5 mm', unit: 'length' },
    },
  };
  return { base, features: [...base.features, rounded] };
}

const faceNames = (result: Done, body = 0) => result.bodies[body]?.mesh?.faceIds ?? [];

/** The shells' face references of block B, from a first recompute. */
async function withBlock() {
  const base = block();
  const first = ok(await run(testDocument(base.features)));
  return {
    base,
    top: refTo(first, 'face', cap),
    bottom: refTo(first, 'face', floor),
    front: refTo(first, 'face', side(base.lines.bottom)),
    right: refTo(first, 'face', side(base.lines.right)),
  };
}

describe('shell', { timeout: 120_000 }, () => {
  it('removes the top face: walls all round, the outer faces keep their names', async () => {
    const { base, top } = await withBlock();
    const result = ok(
      await runWithShapes(testDocument([...base.features, shell('S', [top], '2 mm')])),
    );
    const m = measure('B:0');
    expect(m.valid).toBe(true);
    // 4 outer sides and floor, the same 5 inside, and the rim around the opening.
    expect(m.faces).toBe(11);
    expect(m.volume).toBeCloseTo(BOX_VOLUME - (BOX.w - 4) * (BOX.d - 4) * (BOX.h - 2), 2);
    const names = faceNames(result);
    expect(names).not.toContain(cap);
    expect(names).toContain(floor);
    for (const line of Object.values(base.lines)) expect(names).toContain(side(line));
    expect(names).toContain(`shell:S:rim:(${cap})`);
    expect(names).toContain(`shell:S:inner:(${floor})`);
    for (const line of Object.values(base.lines)) {
      expect(names).toContain(`shell:S:inner:(${side(line)})`);
    }
    expect(new Set(names).size).toBe(names.length);
  });

  it('outside: the walls grow outwards, the original surface is the cavity, outer names stay outer', async () => {
    const { base, top } = await withBlock();
    const inside = ok(
      await runWithShapes(testDocument([...base.features, shell('S', [top], '2 mm')])),
    );
    const result = ok(
      await runWithShapes(
        testDocument([...base.features, shell('S', [top], '2 mm', { direction: 'outside' })]),
      ),
    );
    const shape = bodyShapes.get('B:0') as ShapeHandle;
    const { bbox, volume } = kernel.measure(shape);
    // The sides and the floor grow by 2 mm; the open top stays at z = 20.
    expect(bbox.min.map((x) => round(x, 1))).toEqual([-2, -2, -2]);
    expect(bbox.max.map((x) => round(x, 1))).toEqual([BOX.w + 2, BOX.d + 2, BOX.h]);
    expect(kernel.isValid(shape)).toBe(true);
    // The original block is the cavity: what is left is more than the inside shell's walls.
    expect(volume).toBeGreaterThan(BOX_VOLUME - (BOX.w - 4) * (BOX.d - 4) * (BOX.h - 2));
    const names = faceNames(result);
    // The outer skin is the offset of each face and carries the original names.
    for (const line of Object.values(base.lines)) expect(names).toContain(side(line));
    expect(names).toContain(floor);
    expect(names).toContain(`shell:S:inner:(${floor})`);
    expect(names).toContain(`shell:S:rim:(${cap})`);
    // The outer corners are round: faces made from edges.
    expect(names.filter((n) => n.startsWith('shell:S:round:')).length).toBeGreaterThan(0);
    // The outer names are the same either way.
    const outer = (list: string[]) => list.filter((n) => !n.startsWith('shell:')).sort();
    expect(outer(names)).toEqual(outer(faceNames(inside)));
  });

  it('with no face it hollows the body closed: a sealed void', async () => {
    const { base } = await withBlock();
    const result = ok(
      await runWithShapes(
        testDocument([...base.features, shell('S', [], '2 mm', { bodies: ['B:0'] })]),
      ),
    );
    const m = measure('B:0');
    expect(m.valid).toBe(true);
    expect(m.faces).toBe(12);
    expect(m.volume).toBeCloseTo(BOX_VOLUME - (BOX.w - 4) * (BOX.d - 4) * (BOX.h - 4), 2);
    const names = faceNames(result);
    expect(names).toContain(cap);
    expect(names).toContain(`shell:S:inner:(${cap})`);
    expect(names).toContain(`shell:S:inner:(${floor})`);
    // Outside instead: the block is the void in a bigger one.
    ok(
      await runWithShapes(
        testDocument([
          ...base.features,
          shell('S', [], '2 mm', { bodies: ['B:0'], direction: 'outside' }),
        ]),
      ),
    );
    expect(measure('B:0').valid).toBe(true);
    const bbox = kernel.measure(bodyShapes.get('B:0') as ShapeHandle).bbox;
    expect(bbox.max.map((x) => round(x, 1))).toEqual([BOX.w + 2, BOX.d + 2, BOX.h + 2]);
  });

  it('removes several faces of one body', async () => {
    const { base, top, front } = await withBlock();
    const result = ok(
      await runWithShapes(testDocument([...base.features, shell('S', [top, front], '2 mm')])),
    );
    expect(measure('B:0').valid).toBe(true);
    const names = faceNames(result);
    expect(names).not.toContain(cap);
    expect(names).not.toContain(side(base.lines.bottom));
    expect(names).toContain(`shell:S:rim:(${cap})`);
    expect(names).toContain(`shell:S:rim:(${side(base.lines.bottom)})`);
  });

  it('shells each body on its own; a body with no face picked is hollowed closed', async () => {
    const one = block();
    const b = new SketchBuilder();
    const l = rect(b, 100, 0, 30, 30);
    const features = [
      ...one.features,
      sketch('SC', b.sketch),
      extrude('C', 'SC', b.sketch, '20 mm'),
    ];
    const first = ok(await run(testDocument(features)));
    const topB = refTo(first, 'face', cap);
    const topC = refTo(first, 'face', 'extrude:C:cap:end');
    const both = ok(
      await runWithShapes(testDocument([...features, shell('S', [topB, topC], '2 mm')])),
    );
    expect(both.bodies.map((body) => body.id)).toEqual(['B:0', 'C:0']);
    expect(measure('B:0').faces).toBe(11);
    expect(measure('C:0').faces).toBe(11);
    expect(measure('C:0').volume).toBeCloseTo(30 * 30 * 20 - 26 * 26 * 18, 2);
    // B opened, C hollowed closed.
    ok(
      await runWithShapes(
        testDocument([...features, shell('S', [topB], '2 mm', { bodies: ['C:0'] })]),
      ),
    );
    expect(measure('B:0').faces).toBe(11);
    expect(measure('C:0').faces).toBe(12);
    expect(measure('C:0').volume).toBeCloseTo(30 * 30 * 20 - 26 * 26 * 16, 2);
    expect(Object.keys(l)).toHaveLength(4);
  });

  it('keeps its face names when the thickness changes, and the outside stays put', async () => {
    const { base, top } = await withBlock();
    const at = (thickness: string) =>
      run(testDocument([...base.features, shell('S', [top], thickness)]));
    const thin = ok(await at('1 mm'));
    const thick = ok(await at('4 mm'));
    expect(faceNames(thick)).toEqual(faceNames(thin));
  });

  it('later features find the shell’s faces by name, and keep finding them when the wall changes', async () => {
    const { base, top } = await withBlock();
    const first = ok(await run(testDocument([...base.features, shell('S', [top], '2 mm')])));
    // A fillet on the edge where the rim meets the inside of the front wall.
    const rimEdge = between(`shell:S:rim:(${cap})`, `shell:S:inner:(${side(base.lines.bottom)})`);
    const ref = refTo(first, 'edge', rimEdge);
    const fillet: Feature = {
      ...testFeature('R', 'fillet'),
      inputs: filletInputs([{ edges: [ref], radius: '0.5 mm' }]),
    };
    ok(await run(testDocument([...base.features, shell('S', [top], '2 mm'), fillet])));
    const thicker = ok(
      await run(testDocument([...base.features, shell('S', [top], '3 mm'), fillet])),
    );
    expect(faceNames(thicker).some((n) => n.startsWith('fillet:R:'))).toBe(true);
  });

  it('shells a block with rounded corners: the inner walls follow the arcs', async () => {
    const { base, features } = await roundedBlock();
    const first = ok(await run(testDocument(features)));
    const top = refTo(first, 'face', cap);
    const result = ok(await runWithShapes(testDocument([...features, shell('S', [top], '2 mm')])));
    const m = measure('B:0');
    expect(m.valid).toBe(true);
    // The rounded block's volume less the cavity (inner radius 3, 36 × 26 × 18).
    const cornerLoss = (4 - Math.PI) * 25 * BOX.h;
    const cavity = (36 * 26 - (4 - Math.PI) * 9) * 18;
    expect(m.volume).toBeCloseTo(BOX_VOLUME - cornerLoss - cavity, 1);
    expect(faceNames(result).filter((n) => n.startsWith('shell:S:inner:')).length).toBe(9);
    expect(Object.keys(base.lines)).toHaveLength(4);
  });

  it('too thick a wall says how thick it may be, and that maximum works', async () => {
    const { base, top } = await withBlock();
    const failed = await run(testDocument([...base.features, shell('S', [top], '16 mm')]));
    const st = status(failed, 'S');
    expect(st.status).toBe('error');
    const match = /^A 16 mm wall is too thick for this body \(max ≈ ([\d.]+) mm\)\./.exec(
      st.message ?? '',
    );
    expect(match, st.message).not.toBeNull();
    const max = Number(match?.[1]);
    // The block is 30 mm deep: the side walls meet at 15 mm (the floor has 20).
    expect(max).toBeGreaterThanOrEqual(14);
    expect(max).toBeLessThanOrEqual(15);
    const again = await run(testDocument([...base.features, shell('S', [top], `${max} mm`)]));
    expect(status(again, 'S').status).toBe('ok');
    // Growing outwards has no such limit.
    const out = await run(
      testDocument([...base.features, shell('S', [top], '12 mm', { direction: 'outside' })]),
    );
    expect(status(out, 'S').status).toBe('ok');
  });

  it('a wall thicker than a hole’s radius is refused, not built inside out', async () => {
    // A cylinder of radius 10 shelled with 12 mm walls: OCCT itself gives a valid junk solid.
    const b = new SketchBuilder();
    b.circle(0, 0, 10);
    const features = [sketch('SB', b.sketch), extrude('B', 'SB', b.sketch, '30 mm')];
    const first = ok(await run(testDocument(features)));
    const topRef = refTo(first, 'face', 'extrude:B:cap:end');
    const failed = await run(testDocument([...features, shell('S', [topRef], '12 mm')]));
    expect(status(failed, 'S').message).toMatch(/is too thick for this body \(max ≈ (9\.\d|10)/);
  });

  it('a flat face next to a fillet opens through a plug; a rounded face can’t be removed', async () => {
    const { base, features } = await roundedBlock();
    const first = ok(await run(testDocument(features)));
    // References read from the last recompute's meshes, so all of them before the shells run.
    const front = refTo(first, 'face', side(base.lines.bottom));
    const corner = faceNames(first).find((n) => n.startsWith('fillet:R:'));
    if (!corner) throw new Error('no rounded face');
    const roundRef = refTo(first, 'face', corner);
    const top = refTo(first, 'face', cap);
    // P4-12: the front runs smoothly into the rounded corners and meets the top and the
    // floor square, so the body is hollowed closed and the opening cut out as a plug.
    const opened = ok(
      await runWithShapes(testDocument([...features, shell('S', [front], '2 mm')])),
    );
    const m = measure('B:0');
    expect(m.valid).toBe(true);
    const area = (inset: number, r: number) =>
      (BOX.w - 2 * inset) * (BOX.d - 2 * inset) - 4 * r * r * (1 - Math.PI / 4);
    // The block less its cavity less the front wall between the rounds: 30 × 2 × 16 mm.
    expect(m.volume).toBeCloseTo(area(0, 5) * BOX.h - area(2, 3) * (BOX.h - 4) - 30 * 2 * 16, 1);
    const names = faceNames(opened);
    expect(names).not.toContain(side(base.lines.bottom));
    expect(
      names.filter((n) => n.startsWith(`shell:S:rim:(${side(base.lines.bottom)})`)).length,
    ).toBe(4);
    expect(names).toContain(cap);
    expect(names).toContain(`shell:S:inner:(${cap})`);
    expect(new Set(names).size).toBe(names.length);
    // A rounded corner's face runs smoothly into both sides: there is no flat outline to open.
    const failed = await run(testDocument([...features, shell('S', [roundRef], '2 mm')]));
    const st = status(failed, 'S');
    expect(st.status).toBe('error');
    expect(st.message).toMatch(
      /^Face \d+ can't be removed: it runs smoothly into the faces next to it \(a fillet or another tangent face\)/,
    );
    // The top meets the rounded corners at a crease, so it goes the usual way.
    const fine = await run(testDocument([...features, shell('S', [top], '2 mm')]));
    expect(status(fine, 'S').status).toBe('ok');
  });

  it('a body OCCT can’t offset says so in plain words', async () => {
    // Removing a cylinder's whole side leaves nothing to hold the walls.
    const b = new SketchBuilder();
    const c = b.circle(0, 0, 10);
    const features = [sketch('SB', b.sketch), extrude('B', 'SB', b.sketch, '30 mm')];
    const first = ok(await run(testDocument(features)));
    const wall = refTo(first, 'face', `extrude:B:side:${c.id}`);
    const failed = await run(testDocument([...features, shell('S', [wall], '2 mm')]));
    expect(status(failed, 'S').message).toMatch(
      /^The walls can't be built with those faces removed/,
    );
  });

  it('asks for a face or a body, for a thickness above zero, and for faces that exist', async () => {
    const { base, top } = await withBlock();
    const messageOf = async (feature: Feature) =>
      status(await run(testDocument([...base.features, feature])), 'S').message;
    expect(await messageOf(shell('S', [], '2 mm'))).toBe(
      'Pick a face to remove, or a body to hollow out.',
    );
    expect(await messageOf(shell('S', [top], '0 mm'))).toBe(
      'The wall thickness is 0 mm. Enter a thickness greater than 0.',
    );
    const st = status(
      await run(testDocument([...base.features, shell('S', [], '1 mm', { bodies: ['NOPE:0'] })])),
      'S',
    );
    expect(st.status).toBe('error');
    expect(st.message).toMatch(/body to hollow out no longer exists/);
    expect(st.refs).toEqual([{ ref: { kind: 'body', id: 'NOPE:0' }, state: 'lost' }]);
  });

  it('a lost face is a lost reference the timeline can fix', async () => {
    const base = block();
    const gone: GeomRef = { kind: 'face', id: 'extrude:B:cap:nowhere' };
    const result = await run(testDocument([...base.features, shell('S', [gone], '1 mm')]));
    const st = status(result, 'S');
    expect(st.status).toBe('error');
    expect(st.message).toMatch(/Can't find a face to remove any more/);
    expect(st.refs).toEqual([{ ref: { kind: 'face', id: gone.id }, state: 'lost' }]);
  });

  it('golden table of cases', async () => {
    const { base, top, bottom, front, right } = await withBlock();
    const rounded = await roundedBlock();
    const roundedFirst = ok(await run(testDocument(rounded.features)));
    const roundedTop = refTo(roundedFirst, 'face', cap);
    const roundedFront = refTo(roundedFirst, 'face', side(rounded.base.lines.bottom));
    const roundedFloor = refTo(roundedFirst, 'face', floor);
    type Case = {
      features: Feature[];
      shell: Parameters<typeof shell> extends [string, ...infer A] ? A : never;
    };
    const cases: Record<string, Case> = {
      'top removed 2': { features: base.features, shell: [[top], '2 mm'] },
      'top removed 0.5': { features: base.features, shell: [[top], '0.5 mm'] },
      'top removed 9.5': { features: base.features, shell: [[top], '9.5 mm'] },
      'top removed 16 too thick': { features: base.features, shell: [[top], '16 mm'] },
      'top removed outside 2': {
        features: base.features,
        shell: [[top], '2 mm', { direction: 'outside' }],
      },
      'top removed outside 15': {
        features: base.features,
        shell: [[top], '15 mm', { direction: 'outside' }],
      },
      'bottom removed 3': { features: base.features, shell: [[bottom], '3 mm'] },
      'front removed 2': { features: base.features, shell: [[front], '2 mm'] },
      'front removed outside 2': {
        features: base.features,
        shell: [[front], '2 mm', { direction: 'outside' }],
      },
      'top and front removed 2': { features: base.features, shell: [[top, front], '2 mm'] },
      'top and right removed outside 1.5': {
        features: base.features,
        shell: [[top, right], '1.5 mm', { direction: 'outside' }],
      },
      'closed 2': { features: base.features, shell: [[], '2 mm', { bodies: ['B:0'] }] },
      'closed 9': { features: base.features, shell: [[], '9 mm', { bodies: ['B:0'] }] },
      'closed 11 too thick': {
        features: base.features,
        shell: [[], '11 mm', { bodies: ['B:0'] }],
      },
      'closed outside 3': {
        features: base.features,
        shell: [[], '3 mm', { bodies: ['B:0'], direction: 'outside' }],
      },
      'rounded, top removed 2': { features: rounded.features, shell: [[roundedTop], '2 mm'] },
      'rounded, top removed 6 too thick': {
        features: rounded.features,
        shell: [[roundedTop], '6 mm'],
      },
      'rounded, closed 2': {
        features: rounded.features,
        shell: [[], '2 mm', { bodies: ['B:0'] }],
      },
      'rounded, top removed outside 2': {
        features: rounded.features,
        shell: [[roundedTop], '2 mm', { direction: 'outside' }],
      },
      // P4-12 (ADR-0046's amendment): a thickness per face, and openings cut as plugs.
      'top removed 2, floor 4': {
        features: base.features,
        shell: [[top], '2 mm', { walls: [{ faces: [bottom], thickness: '4 mm' }] }],
      },
      'top removed outside 2, floor 4': {
        features: base.features,
        shell: [
          [top],
          '2 mm',
          { direction: 'outside', walls: [{ faces: [bottom], thickness: '4 mm' }] },
        ],
      },
      'top removed 2, floor 4, front 3': {
        features: base.features,
        shell: [
          [top],
          '2 mm',
          {
            walls: [
              { faces: [bottom], thickness: '4 mm' },
              { faces: [front], thickness: '3 mm' },
            ],
          },
        ],
      },
      'top removed 2, floor 25 too thick': {
        features: base.features,
        shell: [[top], '2 mm', { walls: [{ faces: [bottom], thickness: '25 mm' }] }],
      },
      'closed 2, top 5': {
        features: base.features,
        shell: [[], '2 mm', { bodies: ['B:0'], walls: [{ faces: [top], thickness: '5 mm' }] }],
      },
      'rounded, top removed 2, floor 4': {
        features: rounded.features,
        shell: [[roundedTop], '2 mm', { walls: [{ faces: [roundedFloor], thickness: '4 mm' }] }],
      },
      'rounded, front removed 2 (plug)': {
        features: rounded.features,
        shell: [[roundedFront], '2 mm'],
      },
      'rounded, front removed outside 2 (plug)': {
        features: rounded.features,
        shell: [[roundedFront], '2 mm', { direction: 'outside' }],
      },
      'rounded, front removed 2, floor 4 (plug)': {
        features: rounded.features,
        shell: [[roundedFront], '2 mm', { walls: [{ faces: [roundedFloor], thickness: '4 mm' }] }],
      },
    };
    const table: Record<string, unknown> = {};
    for (const [key, one] of Object.entries(cases)) {
      const feature = shell('S', ...one.shell);
      const result = await runWithShapes(testDocument([...one.features, feature]));
      const st = status(result, 'S');
      if (st.status === 'error') {
        table[key] = { error: st.message };
        continue;
      }
      const m = measure('B:0');
      table[key] = {
        volume: round(m.volume, 2),
        faces: m.faces,
        valid: m.valid,
        shellFaces: faceNames(result)
          .filter((n) => n.startsWith('shell:S:'))
          .sort(),
      };
    }
    await expect(`${JSON.stringify(table, null, 1)}\n`).toMatchFileSnapshot(
      './golden/shell-options.json',
    );
  });
});
