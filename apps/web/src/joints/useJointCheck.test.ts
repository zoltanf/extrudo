// The clearance check's controller (P6-05 J3, ADR-0081 §4): what it asks the kernel, the
// result, `stale` after a change, cancelling, and the refusals it words itself.
import {
  addJoint,
  addParameter,
  type BodyId,
  type Joint,
  type JointId,
  type ParameterId,
} from '@extrudo/core';
import type { JointCheck, JointCheckRequest } from '@extrudo/kernel';
import { describe, expect, it, vi } from 'vitest';
import { memoryPreferences } from '../platform/preferences';
import { createViewportStore } from '../viewport/store';
import { BASE, LEAF, settle, setupJoints } from './testing';
import { createJointCheck, type JointCheckKernel } from './useJointCheck';

const HINGE: Joint = {
  id: 'hinge' as JointId,
  name: 'Hinge',
  type: 'revolute',
  a: { component: LEAF, ref: { kind: 'face', id: 'L:face1' } },
  b: { component: BASE, ref: { kind: 'face', id: 'B:face1' } },
  min: { kind: 'expr', expr: '0 deg', unit: 'angle' },
  max: { kind: 'expr', expr: '90 deg', unit: 'angle' },
};

const RESULT: JointCheck = {
  samples: 36,
  tightest: { at: 0, gap: 0.3, over: { from: 0, to: 90 }, pair: ['L:0', 'B:0'] as never },
  collisions: [],
  underMinimum: [],
};

function setup(joint: Joint = HINGE) {
  const t = setupJoints();
  t.store.getState().dispatch(addJoint({ joint }));
  const viewport = createViewportStore({
    preferences: memoryPreferences(),
    reducedMotion: () => true,
  });
  const requests: JointCheckRequest[] = [];
  let answer: (result: JointCheck) => void = () => {};
  let fail: (error: Error) => void = () => {};
  const kernel: JointCheckKernel = {
    checkJoint: vi.fn(
      (request: JointCheckRequest, onProgress?: (done: number, of: number) => void) => {
        requests.push(request);
        onProgress?.(3, 36);
        return new Promise<JointCheck>((resolve, reject) => {
          answer = resolve;
          fail = reject;
        });
      },
    ),
    cancelCheck: vi.fn(),
  };
  const check = createJointCheck({
    viewport,
    doc: () => t.store.getState().doc,
    bodies: () => ['B:0', 'L:0', 'X:0'] as BodyId[],
    componentOf: (id) => t.store.getState().doc.bodies[id]?.component ?? undefined,
    kernel,
  });
  return {
    ...t,
    viewport,
    kernel,
    check,
    requests,
    answer: (r: JointCheck) => answer(r),
    fail: (e: Error) => fail(e),
  };
}

describe('the clearance check', () => {
  it('opens on a joint with the default minimum gap, without running', () => {
    const t = setup();
    t.check.open(HINGE.id);
    expect(t.viewport.getState().jointCheck).toEqual({ joint: HINGE.id, min: '0.2 mm', on: true });
    expect(t.kernel.checkJoint).not.toHaveBeenCalled();
  });

  it("takes the design's tolerance as the minimum when it has one", () => {
    const t = setup();
    t.store.getState().dispatch(
      addParameter({
        parameter: {
          id: 'p-tol' as ParameterId,
          name: 'tolerance',
          expression: '0.3 mm',
          unit: 'length',
        },
      }),
    );
    t.check.open(HINGE.id);
    expect(t.viewport.getState().jointCheck?.min).toBe('tolerance');
  });

  it('asks the kernel with the moving and the other bodies, the range and the minimum', async () => {
    const t = setup();
    t.check.open(HINGE.id);
    void t.check.start();
    await settle();
    expect(t.requests).toEqual([
      {
        joint: HINGE,
        moving: ['L:0'],
        others: ['B:0', 'X:0'],
        range: { min: 0, max: 90 },
        minGap: 0.2,
      },
    ]);
    const doc = t.store.getState().doc;
    const state = t.viewport.getState().jointCheck;
    expect(t.check.status(doc, state)).toBe('pending');
    expect(t.check.run.getState().progress).toEqual({ done: 3, of: 36 });
    t.answer(RESULT);
    await settle();
    expect(t.check.status(doc, state)).toBe('ready');
    expect(t.check.run.getState().result).toBe(RESULT);
  });

  it('is stale after any change to the design or the minimum', async () => {
    const t = setup();
    t.check.open(HINGE.id);
    void t.check.start();
    await settle();
    t.answer(RESULT);
    await settle();
    t.check.setMin('0.5 mm');
    let state = t.viewport.getState().jointCheck;
    expect(t.check.status(t.store.getState().doc, state)).toBe('stale');
    t.check.setMin('0.2 mm');
    state = t.viewport.getState().jointCheck;
    expect(t.check.status(t.store.getState().doc, state)).toBe('ready');
    t.store.getState().dispatch(addJoint({ joint: { ...HINGE, id: 'j2' as JointId, name: 'J2' } }));
    expect(t.check.status(t.store.getState().doc, state)).toBe('stale');
  });

  it('cancel stops the kernel and forgets the run', async () => {
    const t = setup();
    t.check.open(HINGE.id);
    void t.check.start();
    await settle();
    t.check.cancel();
    expect(t.kernel.cancelCheck).toHaveBeenCalledOnce();
    t.answer(RESULT);
    await settle();
    expect(t.check.run.getState().status).toBe('idle');
  });

  it('a recompute that stops it leaves it idle, an error says why', async () => {
    const t = setup();
    t.check.open(HINGE.id);
    void t.check.start();
    await settle();
    t.fail(
      Object.assign(new Error('The clearance check was cancelled.'), { name: 'CancelledError' }),
    );
    await settle();
    expect(t.check.run.getState().status).toBe('idle');
    void t.check.start();
    await settle();
    t.fail(new Error("Hinge's axes are 0.4 mm apart."));
    await settle();
    expect(t.check.run.getState()).toMatchObject({
      status: 'error',
      error: "Hinge's axes are 0.4 mm apart.",
    });
  });

  it('refuses a slider without travel before asking the kernel', async () => {
    const slide: Joint = {
      ...HINGE,
      id: 'slide' as JointId,
      name: 'Slide1',
      type: 'slider',
    };
    delete (slide as Partial<Joint>).min;
    delete (slide as Partial<Joint>).max;
    const t = setup(slide);
    t.check.open(slide.id);
    await t.check.start();
    expect(t.kernel.checkJoint).not.toHaveBeenCalled();
    expect(t.check.run.getState().error).toBe('Give Slide1 a travel to check it.');
  });

  it('remove ends the check', async () => {
    const t = setup();
    t.check.open(HINGE.id);
    void t.check.start();
    await settle();
    t.check.remove();
    expect(t.viewport.getState().jointCheck).toBeUndefined();
    expect(t.kernel.cancelCheck).toHaveBeenCalledOnce();
  });
});
