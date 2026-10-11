import {
  type BodyId,
  type ComponentId,
  createDocument,
  type Joint,
  type JointId,
} from '@extrudo/core';
import { apply } from '@extrudo/kernel/matrix';
import { describe, expect, it } from 'vitest';
import { clampPose, posedBodies, poseMatrix } from './pose';

const frame: Joint['a'] = {
  component: 'leaf' as ComponentId,
  ref: { kind: 'axis', id: 'origin:x' },
};
const hinge = (patch: Partial<Joint> = {}): Joint =>
  ({
    id: 'j1' as JointId,
    name: 'Hinge',
    type: 'revolute',
    a: frame,
    b: { ...frame, component: 'base' as ComponentId },
    ...patch,
  }) as Joint;

// About the line through (0, 10, 0) along +Z.
const report = { status: 'ok', axis: { origin: [0, 10, 0], direction: [0, 0, 1] } } as never;
const near = (p: readonly number[], q: readonly number[]) => {
  for (const [i, v] of p.entries()) expect(v).toBeCloseTo(q[i] as number, 9);
};

describe('poseMatrix', () => {
  it('is the identity at 0', () => {
    near(apply(poseMatrix(report, hinge(), 0), [3, 4, 5]), [3, 4, 5]);
  });

  it('turns a point right-handed about the axis', () => {
    // (10, 10, 0) is 10 mm from the axis along +x: a quarter turn takes it to (0, 20, 0).
    near(apply(poseMatrix(report, hinge(), 90), [10, 10, 0]), [0, 20, 0]);
    near(apply(poseMatrix(report, hinge(), 180), [10, 10, 7]), [-10, 10, 7]);
  });

  it('reverses with flip', () => {
    near(apply(poseMatrix(report, hinge({ flip: true }), 90), [10, 10, 0]), [0, 0, 0]);
  });

  it('moves a slider along its direction, flip reversing', () => {
    const slide = { status: 'ok', axis: { origin: [0, 0, 0], direction: [2, 0, 0] } } as never;
    near(apply(poseMatrix(slide, hinge({ type: 'slider' }), 5), [1, 1, 1]), [6, 1, 1]);
    near(apply(poseMatrix(slide, hinge({ type: 'slider', flip: true }), 5), [1, 1, 1]), [-4, 1, 1]);
  });

  it('leaves a rigid joint, and a report with no axis, alone', () => {
    near(apply(poseMatrix(report, hinge({ type: 'rigid' }), 30), [1, 2, 3]), [1, 2, 3]);
    near(apply(poseMatrix({ status: 'error' }, hinge(), 30), [1, 2, 3]), [1, 2, 3]);
  });
});

describe('clampPose', () => {
  it('holds the value to the range', () => {
    const range = { min: 0, max: 90 };
    expect(clampPose(hinge(), range, 120)).toBe(90);
    expect(clampPose(hinge(), range, -5)).toBe(0);
    expect(clampPose(hinge(), range, 45)).toBe(45);
  });

  it('wraps a whole-turn revolute to (−180, 180]', () => {
    expect(clampPose(hinge(), undefined, 190)).toBe(-170);
    expect(clampPose(hinge(), undefined, -190)).toBe(170);
    expect(clampPose(hinge(), undefined, 180)).toBe(180);
    expect(clampPose(hinge(), undefined, -180)).toBe(180);
    expect(clampPose(hinge(), undefined, 720)).toBe(0);
  });

  it('leaves an unlimited slider and a non-number alone', () => {
    expect(clampPose(hinge({ type: 'slider' }), undefined, 500)).toBe(500);
    expect(clampPose(hinge(), undefined, Number.NaN)).toBe(0);
  });
});

describe('posedBodies', () => {
  it("lists the moving component's bodies and those carried by rigid joints", () => {
    const members = [
      { id: 'base' as ComponentId, bodies: ['b:0' as BodyId] },
      { id: 'leaf' as ComponentId, bodies: ['l:0' as BodyId, 'l:1' as BodyId] },
      { id: 'tab' as ComponentId, bodies: ['t:0' as BodyId] },
    ];
    const rigid = hinge({
      id: 'j2' as JointId,
      name: 'Glue',
      type: 'rigid',
      a: { ...frame, component: 'tab' as ComponentId },
      b: frame,
    });
    const doc = { ...createDocument(), joints: [hinge(), rigid] };
    expect(posedBodies(doc, hinge(), members)).toEqual(['l:0', 'l:1', 't:0']);
  });
});
