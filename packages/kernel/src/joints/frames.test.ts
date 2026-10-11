// Joint frames at the marker (P6-05, ADR-0081 §4): the engine's joint pass on
// the hinge fixture's document, with real OCCT and strict leaks.
import type { ExtrudoDocument, Joint } from '@extrudo/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { kernelFeatures } from '../features';
import { Kernel } from '../kernel';
import { loadOcct } from '../occt/load';
import { RecomputeEngine } from '../recompute/engine';
import type { RecomputeResult } from '../recompute/types';
import { HINGE, hingeDocument, PIN_WALL } from './testing';

let kernel: Kernel;
let engine: RecomputeEngine;

beforeAll(async () => {
  kernel = new Kernel(await loadOcct());
  engine = new RecomputeEngine(kernel, kernelFeatures(), { strictLeaks: true });
});

afterAll(() => {
  engine.clear();
  expect(kernel.stats().liveShapes).toBe(0);
});

type Done = Extract<RecomputeResult, { status: 'done' }>;

async function recompute(doc: ExtrudoDocument): Promise<Done> {
  const result = await engine.recompute({ doc });
  if (result.status !== 'done') throw new Error('cancelled');
  return result;
}

const withJoint = (joint: Partial<Joint>, doc = hingeDocument()): ExtrudoDocument => ({
  ...doc,
  joints: [{ ...HINGE, ...joint }],
});

/** The persistent name of an edge of the leaf the predicate picks, from the meshes. */
function edgeOf(result: Done, ...faces: string[]): string {
  const leaf = result.bodies.find((b) => b.id === 'LeafPlate:0');
  const found = leaf?.mesh?.edgeIds?.find((id) => faces.every((f) => id.includes(f)));
  if (!found) throw new Error(`no edge between ${faces.join(' and ')}`);
  return found;
}

describe('the joint pass (ADR-0081 §4)', () => {
  it('a hole wall and a pin wall give one axis', { timeout: 60_000 }, async () => {
    const result = await recompute(hingeDocument());
    for (const status of Object.values(result.features)) expect(status.status).toBe('ok');
    const report = result.joints?.[HINGE.id];
    expect(report?.status).toBe('ok');
    expect(report?.offset).toBeCloseTo(0, 6);
    expect(report?.bodies).toEqual({ a: 'LeafPlate:0', b: 'BasePlate:0' });
    const { origin, direction } = report?.axis ?? { origin: [], direction: [] };
    expect(Math.abs(direction[0] ?? 0)).toBeCloseTo(1, 9);
    expect(origin[1]).toBeCloseTo(0, 9);
    expect(origin[2]).toBeCloseTo(2, 9);
  });

  it('a circular edge of the hole gives the same axis', async () => {
    const first = await recompute(hingeDocument());
    const edge = edgeOf(first, 'Hole:side:wall', 'Bridge:side:right');
    const result = await recompute(
      withJoint({ a: { ...HINGE.a, ref: { kind: 'edge', id: edge } } }),
    );
    const report = result.joints?.[HINGE.id];
    expect(report?.status).toBe('ok');
    expect(report?.offset).toBeCloseTo(0, 6);
  });

  it("a slider takes a flat face's normal", async () => {
    const result = await recompute(
      withJoint({
        type: 'slider',
        a: { ...HINGE.a, ref: { kind: 'face', id: 'box:LeafPlate:cap:end' } },
        b: { ...HINGE.b, ref: { kind: 'face', id: 'box:BasePlate:cap:end' } },
        min: { kind: 'expr', expr: '0 mm', unit: 'length' },
        max: { kind: 'expr', expr: '10 mm', unit: 'length' },
      }),
    );
    const report = result.joints?.[HINGE.id];
    expect(report?.status).toBe('ok');
    expect(report?.axis?.direction.map((x) => Math.abs(x))).toEqual([0, 0, 1]);
    expect(report?.axis?.origin[2]).toBeCloseTo(4, 9);
  });

  it('axes 0.4 mm apart are a warning with the offset', async () => {
    const doc = hingeDocument();
    const moved: ExtrudoDocument = {
      ...doc,
      features: doc.features.map((f) =>
        f.id === 'Hole'
          ? { ...f, inputs: { ...f.inputs, y: { kind: 'expr', expr: '2.4 mm', unit: 'length' } } }
          : f,
      ),
    };
    const report = (await recompute(moved)).joints?.[HINGE.id];
    expect(report?.status).toBe('warning');
    expect(report?.offset).toBeCloseTo(0.4, 6);
    expect(report?.message).toBe(
      "Hinge's axes are 0.4 mm apart: the parts aren't where the joint was made.",
    );
  });

  it('a deleted pin is an error with the lost frame', async () => {
    const doc = hingeDocument();
    const report = (
      await recompute({
        ...doc,
        features: doc.features.filter((f) => f.id !== 'Pin'),
        timelineMarker: doc.features.length - 1,
      })
    ).joints?.[HINGE.id];
    expect(report?.status).toBe('error');
    expect(report?.refs).toEqual([{ ref: { kind: 'face', id: PIN_WALL.id }, state: 'lost' }]);
  });

  it('a frame on a rolled-back feature is inactive', async () => {
    const doc = hingeDocument();
    const report = (await recompute({ ...doc, timelineMarker: doc.features.length - 1 })).joints?.[
      HINGE.id
    ];
    expect(report).toEqual({
      status: 'inactive',
      message: 'Hinge uses Pin, which is rolled back.',
    });
  });

  it('a flat face is no axis for a revolute', async () => {
    const report = (
      await recompute(
        withJoint({ b: { ...HINGE.b, ref: { kind: 'face', id: 'box:BasePlate:cap:end' } } }),
      )
    ).joints?.[HINGE.id];
    expect(report).toEqual({
      status: 'error',
      message: 'Pick a round face, a straight or circular edge or an axis for the joint.',
    });
  });

  it('a suppressed joint is not resolved, and a rigid one only checks its frames', async () => {
    const doc = hingeDocument();
    const result = await recompute({
      ...doc,
      joints: [
        { ...HINGE, suppressed: true },
        {
          ...HINGE,
          id: 'glue' as Joint['id'],
          name: 'Glue',
          type: 'rigid',
          min: undefined,
          max: undefined,
          b: { ...HINGE.b, ref: { kind: 'body', id: 'BasePlate:0' } },
        },
      ],
    });
    expect(result.joints).toEqual({
      glue: { status: 'ok', bodies: { a: 'LeafPlate:0', b: 'BasePlate:0' } },
    });
  });

  it('editing a joint recomputes no feature', async () => {
    await recompute(hingeDocument());
    const result = await recompute(
      withJoint({ max: { kind: 'expr', expr: '120 deg', unit: 'angle' }, flip: true }),
    );
    expect(result.stats.evaluated).toEqual([]);
    expect(result.stats.reused).toBe(hingeDocument().features.length);
    expect(result.joints?.[HINGE.id]?.status).toBe('ok');
    // The dialog's readout resolves against the same marker, evaluating nothing.
    expect(engine.resolveJoint({ ...HINGE, name: 'Other' }).status).toBe('ok');
  });
});
