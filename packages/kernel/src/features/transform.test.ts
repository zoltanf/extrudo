// Move/Copy and Mirror (P3-06, ADR-0044, FR-FT-10, FR-FT-11) through the
// recompute engine with real OCCT: translation, turns about the world axes
// and about an axis, point to point, copies with their new body IDs, mirrors
// about origin planes, construction planes and faces (a copy, in place, and
// joined to the original), the names carried through the transform's
// history (a fillet after a move still finds its edge), warnings and errors.
// `golden/transform-options.json` is a golden table of cases (a Vitest file
// snapshot); rewrite it with `pnpm vitest run -u packages/kernel/src/features/transform`
// and review the diff.
import {
  constructionRef,
  extrudeInputs,
  type Feature,
  type FeatureId,
  FeatureRegistry,
  type FeatureStatus,
  filletInputs,
  type GeomRef,
  type MirrorInputOptions,
  type MoveInputOptions,
  mirrorInputs,
  moveInputs,
  originAxisRef,
  originPlaneRef,
  type SketchData,
  sketchInputs,
} from '@extrudo/core';
import { SketchBuilder } from '@extrudo/sketch/fixtures';
import { detectProfiles } from '@extrudo/sketch/profiles';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { SubShapeKind } from '../history';
import { Kernel, type Vec3 } from '../kernel';
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

const XY = originPlaneRef('origin:xy');
const YZ = originPlaneRef('origin:yz');
const AXIS_Z = originAxisRef('origin:z');
const AXIS_X = originAxisRef('origin:x');

function sketch(id: string, data: SketchData): Feature {
  return { ...testFeature(id, 'sketch'), inputs: sketchInputs(XY, data) };
}

/**
 * A `w` × `d` × `h` mm block from (x, y, 0) as body `<id>:0`, made by
 * sketch `S<id>` and extrude `<id>`. Its faces are `extrude:<id>:cap:end`
 * and so on.
 */
function block(id: string, x: number, y: number, w = 40, d = 30, h = 20): Feature[] {
  const b = new SketchBuilder();
  b.line(x, y, x + w, y);
  b.line(x + w, y, x + w, y + d);
  b.line(x + w, y + d, x, y + d);
  b.line(x, y + d, x, y);
  const [found] = detectProfiles(b.sketch);
  if (!found) throw new Error('no profile');
  const profile: GeomRef = { kind: 'profile', id: `S${id}/${found.id}` };
  return [
    sketch(`S${id}`, b.sketch),
    { ...testFeature(id, 'extrude'), inputs: extrudeInputs([profile], { distance: `${h} mm` }) },
  ];
}

const move = (id: string, bodies: string[], options: MoveInputOptions = {}): Feature => ({
  ...testFeature(id, 'move'),
  inputs: moveInputs(bodies, options),
});

const mirror = (
  id: string,
  bodies: string[],
  plane: GeomRef,
  options: MirrorInputOptions = {},
): Feature => ({
  ...testFeature(id, 'mirror'),
  inputs: mirrorInputs(bodies, plane, options),
});

async function run(features: Feature[]): Promise<Done> {
  const result = await engine.recompute({ doc: testDocument(features) });
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

const round = (x: number, digits = 3) => {
  const r = Number(x.toFixed(digits));
  return Object.is(r, -0) ? 0 : r;
};

/** A body's exact box, volume and validity in the last recompute. */
function shapeOf(body: string) {
  const shape = engine.latestBody(body as never);
  if (shape === undefined) throw new Error(`no body ${body}`);
  const props = kernel.properties(shape);
  const r = (v: readonly number[]) => v.map((x) => round(x)) as unknown as Vec3;
  return {
    min: r(props.bbox.min),
    max: r(props.bbox.max),
    volume: round(props.volume),
    faces: kernel.count(shape, 'face'),
    valid: kernel.isValid(shape),
  };
}

const ids = (result: Done) => result.bodies.map((b) => b.id);

/** The names of a body's faces, edges or vertices in the last recompute. */
function namesOf(result: Done, body: string, kind: SubShapeKind): string[] {
  const mesh = result.bodies.find((b) => b.id === body)?.mesh;
  const list = kind === 'face' ? mesh?.faceIds : kind === 'edge' ? mesh?.edgeIds : mesh?.vertexIds;
  return list ?? [];
}

function refTo(result: Done, body: string, kind: SubShapeKind, id: string): GeomRef {
  const index = namesOf(result, body, kind).indexOf(id);
  const ref = index < 0 ? undefined : engine.reference(body as never, kind, index);
  if (!ref) throw new Error(`no ${kind} named ${id} in ${body}`);
  return ref;
}

const A = block('A', 0, 0);

// --------------------------------------------------------------------- move

describe('move', { timeout: 120_000 }, () => {
  it('translates a body and keeps its faces, names and volume', async () => {
    const before = ok(await run(A));
    const result = ok(
      await run([...A, move('M', ['A:0'], { dx: '100 mm', dy: '-5 mm', dz: '7 mm' })]),
    );
    expect(ids(result)).toEqual(['A:0']);
    expect(shapeOf('A:0')).toMatchObject({
      min: [100, -5, 7],
      max: [140, 25, 27],
      volume: 24_000,
      faces: 6,
      valid: true,
    });
    expect(namesOf(result, 'A:0', 'face')).toEqual(namesOf(before, 'A:0', 'face'));
    expect(namesOf(result, 'A:0', 'edge')).toEqual(namesOf(before, 'A:0', 'edge'));
  });

  it('turns about the world axes through the centre of the bodies (free)', async () => {
    ok(await run([...A, move('M', ['A:0'], { rz: '90 deg' })]));
    // 40 × 30 about its centre (20, 15): 30 wide along X, 40 along Y.
    expect(shapeOf('A:0')).toMatchObject({ min: [5, -5, 0], max: [35, 35, 20], volume: 24_000 });
    ok(await run([...A, move('M', ['A:0'], { rx: '90 deg', dx: '10 mm' })]));
    // Turned about X through the centre (y 15, z 10): 30 × 20 become 20 × 30, then moved.
    expect(shapeOf('A:0')).toMatchObject({ min: [10, 5, -5], max: [50, 25, 25] });
  });

  it('turns about an origin axis by an angle (rotate)', async () => {
    ok(await run([...A, move('M', ['A:0'], { mode: 'rotate', axis: AXIS_Z, angle: '90 deg' })]));
    // (x, y) -> (-y, x): the block from x 0…40, y 0…30 lands at x -30…0, y 0…40.
    expect(shapeOf('A:0')).toMatchObject({ min: [-30, 0, 0], max: [0, 40, 20], valid: true });
    ok(await run([...A, move('M', ['A:0'], { mode: 'rotate', axis: AXIS_X, angle: '-90 deg' })]));
    // About X, negative: (y, z) -> (z, -y).
    expect(shapeOf('A:0')).toMatchObject({ min: [0, 0, -30], max: [40, 20, 0] });
  });

  it('turns about a straight edge of another body', async () => {
    const b = block('B', 100, 0);
    const first = ok(await run([...A, ...b]));
    // Any vertical edge of B is a straight edge; pick the one whose name we can find.
    const edge = namesOf(first, 'B:0', 'edge')[0] as string;
    const ref = refTo(first, 'B:0', 'edge', edge);
    const result = await run([
      ...A,
      ...b,
      move('M', ['A:0'], { mode: 'rotate', axis: ref, angle: '90 deg' }),
    ]);
    expect(status(result, 'M').status).toBe('ok');
    expect(shapeOf('A:0').volume).toBe(24_000);
    expect(shapeOf('A:0').valid).toBe(true);
  });

  it('moves point to point: a vertex onto a vertex of another body', async () => {
    const b = block('B', 100, 50);
    const first = ok(await run([...A, ...b]));
    const from = refTo(first, 'A:0', 'vertex', namesOf(first, 'A:0', 'vertex')[0] as string);
    const to = refTo(first, 'B:0', 'vertex', namesOf(first, 'B:0', 'vertex')[0] as string);
    ok(await run([...A, ...b, move('M', ['A:0'], { mode: 'point-to-point', from, to })]));
    // Same size and same vertex order: A lands exactly on B.
    expect(shapeOf('A:0')).toMatchObject({ min: [100, 50, 0], max: [140, 80, 20] });
  });

  it('moves several bodies by the same step, turning about the middle of them all', async () => {
    const b = block('B', 100, 0);
    ok(await run([...A, ...b, move('M', ['A:0', 'B:0'], { dz: '5 mm' })]));
    expect(shapeOf('A:0').min).toEqual([0, 0, 5]);
    expect(shapeOf('B:0').min).toEqual([100, 0, 5]);
    // Free turn of 180° about Z through the centre (70, 15): A and B swap sides.
    ok(await run([...A, ...b, move('M', ['A:0', 'B:0'], { rz: '180 deg' })]));
    expect(shapeOf('A:0')).toMatchObject({ min: [100, 0, 0], max: [140, 30, 20] });
    expect(shapeOf('B:0')).toMatchObject({ min: [0, 0, 0], max: [40, 30, 20] });
  });

  describe('copy', () => {
    it('keeps the body and adds a moved copy under a new ID', async () => {
      const before = ok(await run(A));
      const result = ok(await run([...A, move('M', ['A:0'], { dx: '60 mm', copy: true })]));
      expect(ids(result)).toEqual(['A:0', 'M:0']);
      expect(shapeOf('A:0').min).toEqual([0, 0, 0]);
      expect(shapeOf('M:0')).toMatchObject({ min: [60, 0, 0], max: [100, 30, 20], volume: 24_000 });
      // The copy's faces are named after the original's, so a reference means one body.
      expect(namesOf(result, 'M:0', 'face')).toEqual(
        namesOf(before, 'A:0', 'face').map((n) => `move:M:from:(${n})`),
      );
    });

    it('copies several bodies as <feature>:0, <feature>:1 in the order picked', async () => {
      const b = block('B', 100, 0);
      const result = ok(
        await run([...A, ...b, move('M', ['B:0', 'A:0'], { dy: '50 mm', copy: true })]),
      );
      expect(ids(result)).toEqual(['A:0', 'B:0', 'M:0', 'M:1']);
      expect(shapeOf('M:0').min).toEqual([100, 50, 0]);
      expect(shapeOf('M:1').min).toEqual([0, 50, 0]);
    });
  });

  it('later features find the faces of a moved body: a fillet after a move', async () => {
    const first = ok(await run(A));
    const edge = namesOf(first, 'A:0', 'edge')[0] as string;
    const ref = refTo(first, 'A:0', 'edge', edge);
    const filleted = (features: Feature[]) => [
      ...features,
      {
        ...testFeature('F', 'fillet'),
        inputs: filletInputs([{ edges: [ref], radius: '2 mm' }]),
      },
    ];
    const plain = ok(await run(filleted(A)));
    const moved = ok(
      await run(filleted([...A, move('M', ['A:0'], { dx: '10 mm', rz: '30 deg' })])),
    );
    expect(status(moved, 'F')).toEqual({ status: 'ok' });
    expect(shapeOf('A:0').faces).toBe(7);
    expect(shapeOf('A:0').volume).toBeLessThan(24_000);
    // Same faces, by name, before and after the move.
    expect(namesOf(moved, 'A:0', 'face').sort()).toEqual(namesOf(plain, 'A:0', 'face').sort());
  });

  it('warns when nothing moves, and follows a parameter-free zero', async () => {
    const result = await run([...A, move('M', ['A:0'])]);
    expect(status(result, 'M')).toMatchObject({ status: 'warning' });
    expect(status(result, 'M').message).toMatch(/Nothing moves/);
    expect(shapeOf('A:0').min).toEqual([0, 0, 0]);
  });

  it('says what is missing', async () => {
    const noBodies = await run([...A, move('M', [])]);
    expect(status(noBodies, 'M')).toMatchObject({
      status: 'error',
      message: 'Pick the bodies to move.',
    });
    const noAxis = await run([...A, move('M', ['A:0'], { mode: 'rotate', angle: '30 deg' })]);
    expect(status(noAxis, 'M').message).toBe('Pick the axis to turn about.');
    const noPoints = await run([...A, move('M', ['A:0'], { mode: 'point-to-point' })]);
    expect(status(noPoints, 'M').message).toBe('Pick the point to move from.');
  });

  it('a body that is gone is a lost reference', async () => {
    const result = await run([...A, move('M', ['Z:0'], { dx: '1 mm' })]);
    expect(status(result, 'M')).toMatchObject({ status: 'error' });
    expect(status(result, 'M').message).toMatch(/no longer exists/);
    expect(status(result, 'M').refs).toEqual([{ ref: { kind: 'body', id: 'Z:0' }, state: 'lost' }]);
  });

  it('a move can be edited: its result follows the expression', async () => {
    ok(await run([...A, move('M', ['A:0'], { dx: '10 mm' })]));
    expect(shapeOf('A:0').min[0]).toBe(10);
    ok(await run([...A, move('M', ['A:0'], { dx: '25 mm' })]));
    expect(shapeOf('A:0').min[0]).toBe(25);
  });
});

// ------------------------------------------------------------------- mirror

describe('mirror', { timeout: 120_000 }, () => {
  // A block at x 10…50 (mirrors to -50…-10 about the YZ plane).
  const C = block('C', 10, 0);

  it('adds a mirrored copy by default, keeping the original', async () => {
    const before = ok(await run(C));
    const result = ok(await run([...C, mirror('R', ['C:0'], YZ)]));
    expect(ids(result)).toEqual(['C:0', 'R:0']);
    expect(shapeOf('C:0').min).toEqual([10, 0, 0]);
    expect(shapeOf('R:0')).toMatchObject({
      min: [-50, 0, 0],
      max: [-10, 30, 20],
      volume: 24_000,
      faces: 6,
      valid: true,
    });
    expect(namesOf(result, 'R:0', 'face')).toEqual(
      namesOf(before, 'C:0', 'face').map((n) => `mirror:R:from:(${n})`),
    );
  });

  it('mirrors the body itself without a copy', async () => {
    const result = ok(await run([...C, mirror('R', ['C:0'], YZ, { copy: false })]));
    expect(ids(result)).toEqual(['C:0']);
    expect(shapeOf('C:0')).toMatchObject({ min: [-50, 0, 0], max: [-10, 30, 20], valid: true });
  });

  it('a mirrored solid is a proper solid: its volume is positive and it is valid', async () => {
    ok(await run([...C, mirror('R', ['C:0'], originPlaneRef('origin:xz'))]));
    expect(shapeOf('R:0')).toMatchObject({ min: [10, -30, 0], max: [50, 0, 20], valid: true });
    expect(shapeOf('R:0').volume).toBe(24_000);
  });

  it('joins the copy to its original: one body, merged faces', async () => {
    // A block touching the plane: x 0…40, mirrored to x -40…0.
    const result = ok(await run([...A, mirror('R', ['A:0'], YZ, { join: true })]));
    expect(ids(result)).toEqual(['A:0']);
    expect(shapeOf('A:0')).toMatchObject({
      min: [-40, 0, 0],
      max: [40, 30, 20],
      volume: 48_000,
      faces: 6,
      valid: true,
    });
  });

  it("a copy that doesn't touch its original stays a body of its own, with a warning", async () => {
    const result = await run([...C, mirror('R', ['C:0'], YZ, { join: true })]);
    expect(status(result, 'R')).toMatchObject({ status: 'warning' });
    expect(status(result, 'R').message).toMatch(/doesn't touch its original/);
    expect(ids(result)).toEqual(['C:0', 'R:0']);
  });

  it('mirrors about a construction plane', async () => {
    const plane: Feature = {
      ...testFeature('P', 'offsetPlane'),
      inputs: {
        plane: { kind: 'ref', refs: [YZ] },
        distance: { kind: 'expr', expr: '60 mm', unit: 'length' },
      },
    };
    const ref = constructionRef(plane) as GeomRef;
    ok(await run([...C, plane, mirror('R', ['C:0'], ref)]));
    // x -> 120 - x: 10…50 becomes 70…110.
    expect(shapeOf('R:0')).toMatchObject({ min: [70, 0, 0], max: [110, 30, 20] });
  });

  it('mirrors about a flat face of another body', async () => {
    const d = block('D', 100, 0);
    const first = ok(await run([...A, ...d]));
    // D's cap:start face is on z = 0, its cap:end on z = 20: mirror A about D's top.
    const top = refTo(first, 'D:0', 'face', 'extrude:D:cap:end');
    ok(await run([...A, ...d, mirror('R', ['A:0'], top)]));
    expect(shapeOf('R:0')).toMatchObject({ min: [0, 0, 20], max: [40, 30, 40], valid: true });
  });

  it('a mirror can be edited and later features follow its names', async () => {
    const first = ok(await run([...C, mirror('R', ['C:0'], YZ)]));
    const edge = namesOf(first, 'R:0', 'edge')[0] as string;
    const fillet: Feature = {
      ...testFeature('F', 'fillet'),
      inputs: filletInputs([{ edges: [refTo(first, 'R:0', 'edge', edge)], radius: '2 mm' }]),
    };
    const result = await run([...C, mirror('R', ['C:0'], YZ), fillet]);
    expect(status(result, 'F')).toEqual({ status: 'ok' });
    expect(shapeOf('R:0').faces).toBe(7);
    expect(shapeOf('C:0').faces).toBe(6);
  });

  it('says what is missing', async () => {
    const noPlane = await run([
      ...C,
      {
        ...testFeature('R', 'mirror'),
        inputs: { ...mirrorInputs(['C:0'], YZ), plane: { kind: 'ref', refs: [] } },
      },
    ]);
    expect(status(noPlane, 'R').message).toBe('Pick the plane to mirror in.');
    const noBodies = await run([...C, mirror('R', [], YZ)]);
    expect(status(noBodies, 'R').message).toBe('Pick the bodies to mirror.');
  });
});

// -------------------------------------------------------------- golden table

describe('transform golden table', { timeout: 240_000 }, () => {
  const cases: [string, Feature[]][] = [];
  const B = block('B', 100, 20, 10, 10, 10);
  cases.push([
    'move free dx dy dz',
    [...A, move('M', ['A:0'], { dx: '1 mm', dy: '2 mm', dz: '3 mm' })],
  ]);
  cases.push(['move free rx 45', [...A, move('M', ['A:0'], { rx: '45 deg' })]]);
  cases.push(['move free ry 30 rz 60', [...A, move('M', ['A:0'], { ry: '30 deg', rz: '60 deg' })]]);
  cases.push([
    'move free all',
    [...A, move('M', ['A:0'], { dx: '5 mm', rx: '10 deg', ry: '20 deg', rz: '30 deg' })],
  ]);
  cases.push([
    'move rotate z 90',
    [...A, move('M', ['A:0'], { mode: 'rotate', axis: AXIS_Z, angle: '90 deg' })],
  ]);
  cases.push([
    'move rotate x 45',
    [...A, move('M', ['A:0'], { mode: 'rotate', axis: AXIS_X, angle: '45 deg' })],
  ]);
  cases.push(['move copy', [...A, move('M', ['A:0'], { dx: '50 mm', copy: true })]]);
  cases.push(['move two bodies', [...A, ...B, move('M', ['A:0', 'B:0'], { rz: '90 deg' })]]);
  cases.push(['mirror yz copy', [...A, mirror('R', ['A:0'], YZ)]]);
  cases.push(['mirror yz move', [...A, mirror('R', ['A:0'], YZ, { copy: false })]]);
  cases.push(['mirror xy copy', [...A, mirror('R', ['A:0'], XY)]]);
  cases.push(['mirror yz join', [...A, mirror('R', ['A:0'], YZ, { join: true })]]);
  cases.push(['mirror two bodies', [...A, ...B, mirror('R', ['A:0', 'B:0'], YZ)]]);

  it('every case computes, with the bodies, faces and boxes of its golden', async () => {
    const table: Record<string, unknown> = {};
    for (const [name, features] of cases) {
      engine.clear();
      const result = await run(features);
      const problems = Object.entries(result.features).filter(([, s]) => s.status === 'error');
      table[name] = {
        errors: problems.map(([id, s]) => `${id}: ${s.message}`),
        bodies: result.bodies.map((b) => ({ id: b.id, ...shapeOf(b.id) })),
      };
    }
    await expect(`${JSON.stringify(table, null, 2)}\n`).toMatchFileSnapshot(
      './golden/transform-options.json',
    );
  });
});
