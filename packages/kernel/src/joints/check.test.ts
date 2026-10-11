// The clearance check along a joint's motion (P6-05 J3, ADR-0081 §4) with
// real OCCT and strict leaks: the hinge fixture's document swung through its
// range and past it, its pin with no clearance, a carriage in a channel on a
// slider, the leaf as an STL mesh body, a cancel, and the evaluation budget.
import type { BodyId, ExtrudoDocument, Joint, JointId, JointReport } from '@extrudo/core';
import { readStl, writeStl } from '@extrudo/io';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { kernelFeatures } from '../features';
import { Kernel, type ShapeHandle } from '../kernel';
import { loadManifold } from '../manifold';
import { loadOcct } from '../occt/load';
import { RecomputeEngine } from '../recompute/engine';
import type { RecomputeResult } from '../recompute/types';
import { type BodyShapes, CancelledError, checkJoint, type JointCheckRequest } from './check';
import { MAX_JOINT_EVALS } from './sampling';
import { HINGE, hingeDocument } from './testing';

let kernel: Kernel;
let engine: RecomputeEngine;

beforeAll(async () => {
  kernel = new Kernel(await loadOcct());
  kernel.enableMeshes(await loadManifold());
  engine = new RecomputeEngine(kernel, kernelFeatures(), { strictLeaks: true });
});

afterAll(() => {
  engine.clear();
  expect(kernel.stats().liveShapes).toBe(0);
});

type Done = Extract<RecomputeResult, { status: 'done' }>;

const LEAF = 'LeafPlate:0' as BodyId;
const BASE = 'BasePlate:0' as BodyId;
const go = async () => true;

async function hinge(doc: ExtrudoDocument = hingeDocument()) {
  const result = (await engine.recompute({ doc })) as Done;
  if (result.status !== 'done') throw new Error('cancelled');
  const report = result.joints?.[HINGE.id] as JointReport;
  const bodies: BodyShapes = new Map(
    result.bodies.map((b) => [b.id, engine.latestBody(b.id) as ShapeHandle]),
  );
  const faceName = (body: BodyId, index: number) =>
    result.bodies.find((b) => b.id === body)?.mesh?.faceIds?.[index];
  return { result, report, bodies, faceName };
}

const request = (range: { min: number; max: number }, minGap = 0.2): JointCheckRequest => ({
  joint: HINGE,
  moving: [LEAF],
  others: [BASE],
  range,
  minGap,
});

/**
 * Where the leaf first reaches the base, from the fixture's own numbers: the
 * leaf plate's inner edge is `e` = 15.5 − 10 = 5.5 mm from the pin's axis and
 * the plates are 2t = 4 mm thick about it. Turned by θ past 90°, the plate's
 * inner corner meets the base's top when e·sin θ + t·cos θ = t, so
 * θ = 180° − 2·atan(t / e).
 */
const CONTACT_ANGLE = 180 - (2 * Math.atan(2 / 5.5) * 180) / Math.PI;

describe('checkJoint (ADR-0081 §4)', () => {
  it("the hinge from 0 to 90 degrees: no collision, the pin's clearance is the tightest", {
    timeout: 60_000,
  }, async () => {
    const { report, bodies } = await hinge();
    const live = kernel.stats().liveShapes;
    const check = await checkJoint(kernel, bodies, report, request({ min: 0, max: 90 }), go);
    expect(check.collisions).toEqual([]);
    expect(check.underMinimum).toEqual([]);
    expect(check.tightest?.gap).toBeCloseTo(0.3, 3);
    expect(check.tightest?.over).toEqual({ from: 0, to: 90 });
    expect(check.tightest?.at).toBe(0);
    expect(check.tightest?.pair).toEqual([LEAF, BASE]);
    expect(check.samples).toBeLessThanOrEqual(MAX_JOINT_EVALS);
    expect(kernel.stats().liveShapes).toBe(live);
  });

  it('past 90 degrees the leaf collides with the base where the geometry says', {
    timeout: 60_000,
  }, async () => {
    const { report, bodies, faceName } = await hinge();
    const live = kernel.stats().liveShapes;
    const check = await checkJoint(kernel, bodies, report, request({ min: 0, max: 180 }), go);
    expect(check.collisions).toHaveLength(1);
    const [collision] = check.collisions;
    expect(collision?.from).toBeGreaterThan(CONTACT_ANGLE - 0.2);
    expect(collision?.from).toBeLessThan(CONTACT_ANGLE + 0.2);
    expect(collision?.to).toBe(180);
    expect(collision?.volume).toBeGreaterThan(0);
    // The leaf plate's flat sides and the base plate's, which face each other folded.
    const names = (collision?.faces ?? []).map((f) => faceName(f.body, f.index));
    expect(names.some((n) => /^box:LeafPlate:cap:/.test(n ?? ''))).toBe(true);
    expect(names.some((n) => /^box:BasePlate:cap:/.test(n ?? ''))).toBe(true);
    // The tightest pose before the collision is closer than the pin's 0.3 mm.
    expect(check.tightest?.gap).toBeLessThan(0.3);
    expect(check.tightest?.at).toBeLessThan(collision?.from as number);
    // Closer than the minimum just before it, not inside it.
    const under = check.underMinimum.at(-1);
    expect(under?.to).toBeCloseTo(collision?.from as number, 6);
    expect(check.samples).toBeLessThanOrEqual(MAX_JOINT_EVALS);
    expect(kernel.stats().liveShapes).toBe(live);
  });

  it('a pin with no clearance touches the hole without colliding', {
    timeout: 60_000,
  }, async () => {
    const doc = hingeDocument();
    const touching: ExtrudoDocument = {
      ...doc,
      parameters: doc.parameters.map((p) =>
        p.name === 'clearance' ? { ...p, expression: '0 mm' } : p,
      ),
    };
    const { report, bodies } = await hinge(touching);
    const check = await checkJoint(kernel, bodies, report, request({ min: 0, max: 90 }), go);
    expect(check.collisions).toEqual([]);
    expect(check.tightest?.gap).toBeCloseTo(0, 6);
    expect(check.underMinimum).toEqual([{ from: 0, to: 90 }]);
  });

  it('the leaf as an STL mesh body is measured with minGap', { timeout: 60_000 }, async () => {
    const { report, bodies } = await hinge();
    const exported = kernel.exportMesh(bodies.get(LEAF) as ShapeHandle, {
      linearDeflection: 0.01,
      angularDeflection: 0.1,
    });
    const { mesh } = readStl(writeStl(exported));
    const leaf = kernel.meshFrom(mesh);
    try {
      const spy = vi.spyOn(kernel, 'minGap');
      const meshes: BodyShapes = new Map([...bodies, [LEAF, leaf]]);
      const check = await checkJoint(kernel, meshes, report, request({ min: 0, max: 90 }), go);
      expect(spy).toHaveBeenCalled();
      spy.mockRestore();
      expect(check.collisions).toEqual([]);
      // Within the mesh's deflection of the exact 0.3 mm.
      expect(Math.abs((check.tightest?.gap ?? 0) - 0.3)).toBeLessThan(0.02);
    } finally {
      kernel.release(leaf);
    }
  });

  it('cancelled midway it throws and leaves nothing behind', { timeout: 60_000 }, async () => {
    const { report, bodies } = await hinge();
    const live = kernel.stats().liveShapes;
    let calls = 0;
    const stop = async () => ++calls < 10;
    await expect(
      checkJoint(kernel, bodies, report, request({ min: 0, max: 180 }), stop),
    ).rejects.toBeInstanceOf(CancelledError);
    expect(kernel.stats().liveShapes).toBe(live);
  });

  it('never transforms more than the budget', { timeout: 60_000 }, async () => {
    const { report, bodies } = await hinge();
    const spy = vi.spyOn(kernel, 'transform');
    const check = await checkJoint(kernel, bodies, report, request({ min: -180, max: 180 }), go);
    expect(spy.mock.calls.length).toBeLessThanOrEqual(MAX_JOINT_EVALS);
    expect(check.samples).toBeLessThanOrEqual(MAX_JOINT_EVALS);
    spy.mockRestore();
    expect(check.collisions).toHaveLength(2);
  });

  it('refuses a joint whose frames disagree', async () => {
    const { bodies } = await hinge();
    const report: JointReport = {
      status: 'warning',
      message: "Hinge's axes are 0.4 mm apart: the parts aren't where the joint was made.",
      axis: { origin: [0, 0, 2], direction: [1, 0, 0] },
      offset: 0.4,
    };
    await expect(
      checkJoint(kernel, bodies, report, request({ min: 0, max: 90 }), go),
    ).rejects.toThrow(/0.4 mm apart/);
  });
});

describe('a slider: a carriage in a channel', () => {
  // The carriage 10 × 10 × 5 at x 0…10, 0.25 mm clear of the channel's walls
  // and floor; the channel's end wall at x 60.
  const SLIDE: Joint = {
    id: 'slide' as JointId,
    name: 'Slide',
    type: 'slider',
    a: { component: 'carriage' as never, ref: { kind: 'axis', id: 'origin:x' } },
    b: { component: 'channel' as never, ref: { kind: 'axis', id: 'origin:x' } },
  };
  const REPORT: JointReport = {
    status: 'ok',
    axis: { origin: [0, 0, 0], direction: [1, 0, 0] },
  };
  let shapes: ShapeHandle[] = [];
  let bodies: BodyShapes;

  beforeAll(() => {
    shapes = [
      kernel.box([10, 10, 5], [0, -5, 0.25]),
      kernel.box([65, 14, 2], [-5, -7, -2]),
      kernel.box([65, 1.75, 8], [-5, -7, -2]),
      kernel.box([65, 1.75, 8], [-5, 5.25, -2]),
      kernel.box([2, 14, 8], [60, -7, -2]),
    ];
    bodies = new Map(shapes.map((s, i) => [`b${i}` as BodyId, s]));
  });
  afterAll(() => kernel.release(...shapes));

  const slide = (max: number): JointCheckRequest => ({
    joint: SLIDE,
    moving: ['b0' as BodyId],
    others: ['b1', 'b2', 'b3', 'b4'] as BodyId[],
    range: { min: 0, max },
    minGap: 0.2,
  });

  it('runs 0.25 mm clear along its travel', async () => {
    const check = await checkJoint(kernel, bodies, REPORT, slide(40), go);
    expect(check.collisions).toEqual([]);
    expect(check.tightest?.gap).toBeCloseTo(0.25, 6);
    expect(check.tightest?.over).toEqual({ from: 0, to: 40 });
  });

  it("collides from the channel's end", async () => {
    const check = await checkJoint(kernel, bodies, REPORT, slide(60), go);
    expect(check.collisions).toHaveLength(1);
    expect(check.collisions[0]?.from).toBeCloseTo(50, 1);
    expect(check.collisions[0]?.to).toBe(60);
    expect(check.collisions[0]?.faces.some((f) => f.body === 'b4')).toBe(true);
  });
});
