// The clearance check's lines, summary and marks (P6-05 J3, ADR-0081 §4).
import type { BodyId, ComponentId, Joint, JointId } from '@extrudo/core';
import type { JointCheck } from '@extrudo/kernel';
import { describe, expect, it } from 'vitest';
import {
  checkBodies,
  checkRange,
  clearanceLines,
  clearanceMarks,
  clearanceSummary,
  defaultMinGap,
} from './clearance';

const A = 'a' as ComponentId;
const B = 'b' as ComponentId;
const C = 'c' as ComponentId;
const joint = (over: Partial<Joint> = {}): Joint => ({
  id: 'j' as JointId,
  name: 'Hinge',
  type: 'revolute',
  a: { component: A, ref: { kind: 'face', id: 'x' } },
  b: { component: B, ref: { kind: 'face', id: 'y' } },
  ...over,
});
const value = (input: { expr: string }) => Number.parseFloat(input.expr);
const deg = (n: number) => ({ kind: 'expr' as const, expr: `${n} deg`, unit: 'angle' as const });

const COLLIDING: JointCheck = {
  samples: 44,
  tightest: {
    at: 72,
    gap: 0.18,
    from: [0, 0, 0],
    to: [0, 0.18, 0],
    pair: ['L:0', 'B:0'] as [BodyId, BodyId],
  },
  collisions: [
    {
      from: 140.0625,
      to: 180,
      volume: 3.21,
      at: 150,
      faces: [
        { body: 'L:0' as BodyId, index: 2 },
        { body: 'B:0' as BodyId, index: 3 },
      ],
    },
  ],
  underMinimum: [{ from: 64, to: 81 }],
};

describe('what the check is asked', () => {
  it('the minimum gap is the tolerance parameter when there is one', () => {
    expect(defaultMinGap({ parameters: [] })).toBe('0.2 mm');
    expect(
      defaultMinGap({
        parameters: [{ id: 'p' as never, name: 'tolerance', expression: '0.1 mm', unit: 'length' }],
      }),
    ).toBe('tolerance');
  });

  it('moving bodies are side a and what rigid joints carry with it', () => {
    const rigid: Joint = {
      ...joint(),
      id: 'r' as JointId,
      name: 'Glue',
      type: 'rigid',
      a: { component: C, ref: { kind: 'body', id: 'C:0' } },
      b: { component: A, ref: { kind: 'body', id: 'L:0' } },
    };
    const of: Record<string, ComponentId | undefined> = { 'L:0': A, 'B:0': B, 'C:0': C };
    expect(
      checkBodies(
        { joints: [joint(), rigid] },
        joint(),
        ['L:0', 'B:0', 'C:0', 'X:0'] as BodyId[],
        (id) => of[id],
      ),
    ).toEqual({ moving: ['L:0', 'C:0'], others: ['B:0', 'X:0'] });
  });

  it('the range: limits, a whole turn, or a slider that needs travel', () => {
    expect(checkRange(joint({ min: deg(0), max: deg(90) }), value)).toEqual({ min: 0, max: 90 });
    expect(checkRange(joint(), value)).toEqual({ min: -180, max: 180 });
    expect(checkRange(joint({ type: 'slider' }), value)).toEqual({
      error: 'Give Hinge a travel to check it.',
    });
    expect(checkRange(joint({ min: deg(90), max: deg(0) }), value)).toEqual({
      error: "Hinge's minimum is above its maximum.",
    });
  });
});

describe('how the result reads', () => {
  it("the panel's lines, with the values Show poses", () => {
    expect(clearanceLines(joint(), { min: 0, max: 180 }, 0.3, COLLIDING)).toEqual([
      { kind: 'tightest', text: 'Tightest gap 0.18 mm at 72°', show: 72 },
      { kind: 'under', text: 'Under 0.3 mm from 64° to 81°', show: 72.5 },
      {
        kind: 'collision',
        text: 'Collides from 140.1° to 180.0° (3.2 mm³ at 150°)',
        show: 150,
      },
    ]);
    const free: JointCheck = {
      samples: 36,
      tightest: { at: 0, gap: 0.3, over: { from: 0, to: 180 }, pair: ['L:0', 'B:0'] as never },
      collisions: [],
      underMinimum: [],
    };
    expect(clearanceLines(joint(), { min: 0, max: 180 }, 0.2, free)).toEqual([
      { kind: 'tightest', text: 'Tightest gap 0.30 mm at 0°–180°', show: 0 },
      { kind: 'free', text: 'No collision from 0° to 180°.' },
    ]);
  });

  it('data-joint-check', () => {
    expect(clearanceSummary('Hinge', 0.3, 'ready', COLLIDING)).toBe(
      'joint=Hinge min=0.3 tightest=0.18 at=72 collides=140.1..180.0 under=64.0..81.0 samples=44',
    );
    expect(clearanceSummary('Leaf hinge', 0.2, 'pending', undefined)).toBe(
      'joint=Leaf_hinge min=0.2 pending',
    );
    expect(clearanceSummary('Hinge', 0.3, 'stale', COLLIDING)).toMatch(/ stale$/);
  });

  it('marks at the pose shown: the leader where the gap was found, faces inside a collision', () => {
    const state = { joint: 'j' as JointId, min: '0.3 mm', on: true };
    const check = { state, status: 'ready' as const, result: COLLIDING };
    expect(clearanceMarks(check, 0)).toEqual({});
    expect(clearanceMarks(check, 72).leader).toEqual({
      from: [0, 0, 0],
      to: [0, 0.18, 0],
      gap: 0.18,
    });
    expect(clearanceMarks(check, 160).collisions).toEqual({ 'L:0': [2], 'B:0': [3] });
    expect(clearanceMarks({ ...check, status: 'stale' }, 72)).toEqual({});
    expect(clearanceMarks({ ...check, state: { ...state, on: false } }, 72)).toEqual({});
  });
});
