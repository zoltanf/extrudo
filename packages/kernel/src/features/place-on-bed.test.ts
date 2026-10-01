// Place on Bed (P3-10, ADR-0048, FR-3DP-04) through the recompute engine
// with real OCCT: a flat face turns down onto the XY plane at z = 0 (the
// smallest turn), whatever the body's position or tilt; names survive; the
// feature follows an edited body; warnings and errors are worded for the
// user. The matrix maths is tested pure at the top.
import {
  combineInputs,
  extrudeInputs,
  type Feature,
  type FeatureId,
  FeatureRegistry,
  type FeatureStatus,
  type GeomRef,
  moveInputs,
  originPlaneRef,
  placeOnBedInputs,
  type SketchData,
  sketchInputs,
} from '@extrudo/core';
import { SketchBuilder } from '@extrudo/sketch/fixtures';
import { detectProfiles } from '@extrudo/sketch/profiles';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Kernel, type Vec3 } from '../kernel';
import { loadOcct } from '../occt/load';
import { RecomputeEngine } from '../recompute/engine';
import { testDocument, testFeature, testFeatures } from '../recompute/testing';
import type { KernelFeatureDefinition, RecomputeResult } from '../recompute/types';
import { apply, determinant, faceDown } from './matrix';

const near = (a: readonly number[], b: readonly number[]) => {
  a.forEach((x, i) => {
    expect(x).toBeCloseTo(b[i] as number, 9);
  });
};

describe('faceDown', () => {
  it('leaves a face that already faces down at z = 0', () => {
    const m = faceDown([0, 0, -1], [5, 6, 0]);
    near(apply(m, [1, 2, 3]), [1, 2, 3]);
  });

  it('drops a face that faces down but floats', () => {
    near(apply(faceDown([0, 0, -1], [5, 6, 7]), [1, 2, 10]), [1, 2, 3]);
  });

  it('turns a face that faces up half a turn about X', () => {
    const m = faceDown([0, 0, 1], [5, 6, 20]);
    // The face centre stays over itself and goes to z = 0; the body hangs from it.
    near(apply(m, [5, 6, 20]), [5, 6, 0]);
    near(apply(m, [5, 6, 0]), [5, 6, 20]);
    near(apply(m, [5, 16, 20]), [5, -4, 0]);
    expect(determinant(m)).toBeCloseTo(1, 12);
  });

  it('turns a side face a quarter turn, the smallest turn', () => {
    const m = faceDown([1, 0, 0], [40, 15, 10]);
    near(apply(m, [40, 15, 10]), [40, 15, 0]);
    // The outward normal ends up down: a point 1 mm out from the face goes 1 mm below.
    near(apply(m, [41, 15, 10]), [40, 15, -1]);
    expect(determinant(m)).toBeCloseTo(1, 12);
  });

  it('turns a tilted face by the angle between its normal and down', () => {
    const s = Math.SQRT1_2;
    const n: Vec3 = [s, 0, s];
    const m = faceDown(n, [0, 0, 0]);
    near(apply(m, [s, 0, s]), [0, 0, -1]);
    // The centre of the face has no y turn: a point along Y stays.
    near(apply(m, [0, 3, 0]), [0, 3, 0]);
  });
});

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

const XY = originPlaneRef('origin:xy');

function sketch(id: string, data: SketchData): Feature {
  return { ...testFeature(id, 'sketch'), inputs: sketchInputs(XY, data) };
}

/** A `w` × `d` × `h` mm block from (x, y, 0) as body `<id>:0`. */
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

const placeOnBed = (id: string, face: GeomRef | GeomRef[], spin?: string): Feature => ({
  ...testFeature(id, 'placeOnBed'),
  inputs: placeOnBedInputs(face, spin),
});

async function run(features: Feature[]): Promise<Done> {
  const result = await engine.recompute({ doc: testDocument(features) });
  if (result.status !== 'done') throw new Error('cancelled');
  return result;
}

const status = (result: Done, id: string): FeatureStatus =>
  result.features[id as FeatureId] ?? { status: 'ok' };

const round = (x: number, digits = 3) => {
  const r = Number(x.toFixed(digits));
  return Object.is(r, -0) ? 0 : r;
};

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

/** The reference to the face of `body` that a predicate on its fingerprint picks (last recompute). */
function faceWhere(
  result: Done,
  body: string,
  pick: (dir: Vec3, at: Vec3) => boolean,
  fromResult: Done = result,
): GeomRef {
  const names = fromResult.bodies.find((b) => b.id === body)?.mesh?.faceIds ?? [];
  for (let i = 0; i < names.length; i++) {
    const ref = engine.reference(body as never, 'face', i);
    const f = ref?.fingerprint;
    if (ref && f?.dir && pick(f.dir as Vec3, f.at as Vec3)) return ref;
  }
  throw new Error('no such face');
}

/** The current fingerprint of a named face. */
function fingerprintOf(result: Done, body: string, name: string) {
  const index = (result.bodies.find((b) => b.id === body)?.mesh?.faceIds ?? []).indexOf(name);
  return engine.reference(body as never, 'face', index)?.fingerprint;
}

const A = block('A', 0, 0);
const facing = (want: Vec3) => (dir: Vec3) =>
  Math.abs(dir[0] - want[0]) + Math.abs(dir[1] - want[1]) + Math.abs(dir[2] - want[2]) < 1e-6;

describe('placeOnBed', { timeout: 120_000 }, () => {
  it('turns a body lying on a side face onto that face (the top face, half a turn)', async () => {
    const first = await run(A);
    const top = faceWhere(first, 'A:0', facing([0, 0, 1]));
    const result = await run([...A, placeOnBed('P', top)]);
    expect(status(result, 'P')).toEqual({ status: 'ok' });
    expect(shapeOf('A:0')).toMatchObject({
      min: [0, 0, 0],
      max: [40, 30, 20],
      volume: 24_000,
      faces: 6,
      valid: true,
    });
    // The face that was on top is now the bottom, at z = 0, facing down.
    const after = fingerprintOf(result, 'A:0', top.id);
    expect(after?.dir?.map((x) => round(x))).toEqual([0, 0, -1]);
    expect(round(after?.at[2] as number)).toBe(0);
  });

  it('puts a side face on the bed: the box lies on its side, its extent becomes the height', async () => {
    const first = await run(A);
    const side = faceWhere(first, 'A:0', facing([1, 0, 0]));
    const result = await run([...A, placeOnBed('P', side)]);
    expect(status(result, 'P')).toEqual({ status: 'ok' });
    // The 40 mm along X is the height now; Y stays; the 20 mm height goes along X.
    expect(shapeOf('A:0')).toMatchObject({ volume: 24_000, valid: true });
    const box = shapeOf('A:0');
    expect(box.min[2]).toBe(0);
    expect(box.max[2]).toBe(40);
    expect(round(box.max[1] - box.min[1])).toBe(30);
    expect(round(box.max[0] - box.min[0])).toBe(20);
    const after = fingerprintOf(result, 'A:0', side.id);
    expect(after?.dir?.map((x) => round(x))).toEqual([0, 0, -1]);
    expect(round(after?.at[2] as number)).toBe(0);
  });

  it('exports the body as it lies: the mesh sits on z = 0 with its face down', async () => {
    const first = await run(A);
    const side = faceWhere(first, 'A:0', facing([1, 0, 0]));
    await run([...A, placeOnBed('P', side)]);
    const shape = engine.latestBody('A:0' as never);
    if (shape === undefined) throw new Error('no body');
    const mesh = kernel.exportMesh(shape, { linearDeflection: 0.02, angularDeflection: 0.26 });
    const z: number[] = [];
    for (let i = 2; i < mesh.positions.length; i += 3) z.push(mesh.positions[i] as number);
    expect(round(Math.min(...z))).toBe(0);
    expect(round(Math.max(...z))).toBe(40);
  });

  it('follows the face of a body that was tilted and lifted before it', async () => {
    const first = await run(A);
    const top = faceWhere(first, 'A:0', facing([0, 0, 1]));
    const moved = {
      ...testFeature('M', 'move'),
      inputs: moveInputs(['A:0'], { rx: '30 deg', dz: '50 mm' }),
    };
    const result = await run([...A, moved, placeOnBed('P', top)]);
    expect(status(result, 'P')).toEqual({ status: 'ok' });
    // Flat on the bed again, the same block turned over.
    // (Its X and Y position is where the tilt left the face's centre.)
    const box = shapeOf('A:0');
    expect(box).toMatchObject({ volume: 24_000, valid: true });
    expect([box.min[2], box.max[2]]).toEqual([0, 20]);
    expect([round(box.max[0] - box.min[0]), round(box.max[1] - box.min[1])]).toEqual([40, 30]);
    const after = fingerprintOf(result, 'A:0', top.id);
    expect(after?.dir?.map((x) => round(x))).toEqual([0, 0, -1]);
  });

  it('says so when the face is already on the bed, and changes nothing', async () => {
    const first = await run(A);
    const bottom = faceWhere(first, 'A:0', facing([0, 0, -1]));
    const result = await run([...A, placeOnBed('P', bottom)]);
    expect(status(result, 'P')).toMatchObject({ status: 'warning' });
    expect(status(result, 'P').message).toMatch(/already on the bed/);
    expect(shapeOf('A:0').min).toEqual([0, 0, 0]);
  });

  it('warns when part of the body ends up below the bed', async () => {
    // An L: a 20 mm block with a 40 mm block on its right. The face at the step (up, z = 20)
    // goes down, so the tall block ends up 20 mm below the bed.
    const B = block('B', 40, 0, 40, 30, 40);
    const joined: Feature = {
      ...testFeature('J', 'combine'),
      inputs: combineInputs('A:0', ['B:0']),
    };
    const first = await run([...A, ...B, joined]);
    const step = faceWhere(
      first,
      'A:0',
      (dir, at) => facing([0, 0, 1])(dir) && Math.abs(at[2] - 20) < 1e-6,
    );
    const result = await run([...A, ...B, joined, placeOnBed('P', step)]);
    expect(status(result, 'P')).toMatchObject({ status: 'warning' });
    expect(status(result, 'P').message).toMatch(/below the bed/);
    expect(shapeOf('A:0').min[2]).toBe(-20);
  });

  it('spins the body about the vertical through its face centre', async () => {
    const first = await run(A);
    const top = faceWhere(first, 'A:0', facing([0, 0, 1]));
    // 90 degrees: the 40 x 30 footprint becomes 30 x 40, centred where the face centre was.
    const result = await run([...A, placeOnBed('P', top, '90 deg')]);
    expect(status(result, 'P')).toEqual({ status: 'ok' });
    expect(shapeOf('A:0')).toMatchObject({
      min: [5, -5, 0],
      max: [35, 35, 20],
      volume: 24_000,
      valid: true,
    });
    const after = fingerprintOf(result, 'A:0', top.id);
    expect(after?.dir?.map((x) => round(x))).toEqual([0, 0, -1]);
    expect(after?.at.map((x) => round(x))).toEqual([20, 15, 0]);
  });

  it('spins a body that already lies on the bed, and doesn’t say nothing moves', async () => {
    const first = await run(A);
    const bottom = faceWhere(first, 'A:0', facing([0, 0, -1]));
    const result = await run([...A, placeOnBed('P', bottom, '90 deg')]);
    expect(status(result, 'P')).toEqual({ status: 'ok' });
    expect(shapeOf('A:0').min).toEqual([5, -5, 0]);
  });

  it('puts several bodies down, each on its own face', async () => {
    const B = block('B', 100, 0, 20, 20, 10);
    const first = await run([...A, ...B]);
    const topA = faceWhere(first, 'A:0', facing([0, 0, 1]));
    const sideB = faceWhere(first, 'B:0', facing([1, 0, 0]));
    const result = await run([...A, ...B, placeOnBed('P', [topA, sideB])]);
    expect(status(result, 'P')).toEqual({ status: 'ok' });
    // A turned over (same box); B on its side: 10 mm along X is the height now.
    expect(shapeOf('A:0')).toMatchObject({ min: [0, 0, 0], max: [40, 30, 20], valid: true });
    expect(shapeOf('B:0')).toMatchObject({ volume: 4_000, valid: true });
    expect(shapeOf('B:0').min[2]).toBe(0);
    expect(shapeOf('B:0').max[2]).toBe(20);
    expect(fingerprintOf(result, 'B:0', sideB.id)?.dir?.map((x) => round(x))).toEqual([0, 0, -1]);
  });

  it('refuses two faces of one body', async () => {
    const first = await run(A);
    const top = faceWhere(first, 'A:0', facing([0, 0, 1]));
    const side = faceWhere(first, 'A:0', facing([1, 0, 0]));
    const result = await run([...A, placeOnBed('P', [top, side])]);
    expect(status(result, 'P')).toMatchObject({ status: 'error' });
    expect(status(result, 'P').message).toMatch(/same body/);
  });

  it('says what is missing or wrong', async () => {
    const empty: Feature = {
      ...testFeature('P', 'placeOnBed'),
      inputs: { face: { kind: 'ref', refs: [] } },
    };
    const none = await run([...A, empty]);
    expect(status(none, 'P')).toMatchObject({ status: 'error' });
    expect(status(none, 'P').message).toMatch(/Pick the flat face/);
    const gone = await run([
      ...A,
      placeOnBed('P', { kind: 'face', id: 'extrude:nothing:cap:end' }),
    ]);
    expect(status(gone, 'P')).toMatchObject({ status: 'error' });
  });
});
