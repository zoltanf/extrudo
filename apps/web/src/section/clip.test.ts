import { type GeomRef, originPlaneRef } from '@extrudo/core';
import type { BodyMesh } from '@extrudo/kernel';
import { describe, expect, it } from 'vitest';
import { boxMesh } from '../selection/testing';
import {
  arrowBase,
  boxClips,
  boxFaceCentre,
  boxSummary,
  CLIP_EPS,
  clipDistance,
  clipSummary,
  clipsSummary,
  defaultBox,
  dragBoxFace,
  isClipped,
  isClippedAny,
  middleOffset,
  type SectionState,
  sectionClip,
  sectionFrame,
  sectionSummary,
  sectionsSummary,
} from './clip';
import { lengthExpression, planeName } from './useSection';

describe('sectionClip', () => {
  const xy = { origin: [0, 0, 0] as const, normal: [0, 0, 1] as const };

  it('removes the side the normal points to, at the offset along the normal', () => {
    const clip = sectionClip(xy, 20, false);
    expect(clip).toEqual({ origin: [0, 0, 20], normal: [0, 0, 1] });
    expect(isClipped(clip, 3, 4, 25)).toBe(true);
    expect(isClipped(clip, 3, 4, 15)).toBe(false);
    expect(clipDistance(clip, 0, 0, 27)).toBe(7);
    expect(clipDistance(clip, 0, 0, 12)).toBe(-8);
  });

  it('flips the side and keeps the cut where it is', () => {
    const clip = sectionClip(xy, 20, true);
    // The plane stays at z = 20; the normal, and so the removed side, turn round.
    expect(clip.origin).toEqual([0, 0, 20]);
    expect(clip.normal).toEqual([0, 0, -1]);
    expect(isClipped(clip, 0, 0, 15)).toBe(true);
    expect(isClipped(clip, 0, 0, 25)).toBe(false);
  });

  it('offsets along a tilted frame normal', () => {
    const s = Math.SQRT1_2;
    const clip = sectionClip({ origin: [10, 0, 0], normal: [s, 0, s] }, 10, false);
    expect(clip.origin[0]).toBeCloseTo(10 + 10 * s);
    expect(clip.origin[2]).toBeCloseTo(10 * s);
  });

  it('keeps what lies in the plane', () => {
    const clip = sectionClip(xy, 5, false);
    expect(isClipped(clip, 0, 0, 5)).toBe(false);
    expect(isClipped(clip, 0, 0, 5 + CLIP_EPS / 2)).toBe(false);
    expect(isClipped(clip, 0, 0, 5 + 1e-3)).toBe(true);
  });
});

describe('sectionFrame', () => {
  const bodies: Record<string, BodyMesh> = {};

  it('finds an origin plane', () => {
    expect(sectionFrame(originPlaneRef('origin:xz'), { bodies })).toEqual({
      origin: [0, 0, 0],
      normal: [0, -1, 0],
    });
  });

  it('follows a face through the current mesh', () => {
    const mesh = {
      ...boxMesh([0, 0, 0], [10, 20, 30]),
      faceIds: ['f-bottom', 'f-top', 'f-a', 'f-b', 'f-c', 'f-d'],
    };
    const top: GeomRef = { kind: 'face', id: 'f-top' };
    const frame = sectionFrame(top, { bodies: { B: mesh } });
    expect(frame?.normal).toEqual([0, 0, 1]);
    expect(frame?.origin[2]).toBeCloseTo(30);
  });

  it('falls back to the fingerprint of a face the meshes lack, and to nothing for a lost plane', () => {
    const ref: GeomRef = {
      kind: 'face',
      id: 'gone',
      fingerprint: { type: 'plane', at: [5, 5, 12], dir: [0, 0, 1] },
    } as GeomRef;
    const frame = sectionFrame(ref, { bodies });
    expect(frame?.origin).toEqual([5, 5, 12]);
    expect(frame?.normal).toEqual([0, 0, 1]);
    expect(sectionFrame({ kind: 'plane', id: 'nope' }, { bodies })).toBeUndefined();
    expect(sectionFrame({ kind: 'face', id: 'gone' }, { bodies })).toBeUndefined();
  });
});

describe('the arrow and the first cut', () => {
  const xy = { origin: [0, 0, 0] as const, normal: [0, 0, 1] as const };

  it('stands on the plane under the middle of what is shown', () => {
    expect(arrowBase(xy, [20, 40, 30])).toEqual([20, 40, 0]);
    const tilted = { origin: [0, 0, 10] as const, normal: [0, 0, -1] as const };
    expect(arrowBase(tilted, [1, 2, 3])).toEqual([1, 2, 10]);
  });

  it('starts a section through the middle of the box, along the normal', () => {
    const box = { min: [0, 0, 0] as const, max: [40, 80, 60] as const };
    expect(middleOffset(xy, box)).toBe(30);
    // A face on top of the part (outward normal +Z at z = 60) cuts 30 mm below itself.
    expect(middleOffset({ origin: [20, 40, 60], normal: [0, 0, 1] }, box)).toBe(-30);
    // A plane outside the part reaches in.
    expect(middleOffset({ origin: [0, 0, -10], normal: [0, 0, 1] }, box)).toBe(40);
  });
});

describe('summaries and names', () => {
  const state: SectionState = {
    plane: originPlaneRef('origin:xy'),
    offset: '20 mm',
    flip: false,
    on: true,
  };

  it('writes the state and the plane for tests', () => {
    expect(sectionSummary(undefined)).toBeUndefined();
    expect(sectionSummary(state)).toBe('origin:xy offset=20 mm on');
    expect(sectionSummary({ ...state, flip: true, on: false })).toBe(
      'origin:xy offset=20 mm flipped off',
    );
    expect(clipSummary(sectionClip({ origin: [0, 0, 0], normal: [0, 0, 1] }, 20, true))).toBe(
      '0,0,20:0,0,-1',
    );
  });

  it('names the plane for the panel and the browser', () => {
    const names = {
      construction: (id: string) => (id === 'P1' ? 'Offset Plane1' : undefined),
      faceBody: (id: string) => (id === 'f1' ? 'Body1' : undefined),
    };
    expect(planeName(originPlaneRef('origin:yz'), names)).toBe('YZ plane');
    expect(planeName({ kind: 'plane', id: 'P1' }, names)).toBe('Offset Plane1');
    expect(planeName({ kind: 'face', id: 'f1' }, names)).toBe('Face of Body1');
    expect(planeName({ kind: 'face', id: 'f2' }, names)).toBe('Face');
  });

  it('writes an offset in the document unit', () => {
    expect(lengthExpression(12.5, { units: 'mm', precision: 2 })).toBe('12.5 mm');
    expect(lengthExpression(25.4, { units: 'in', precision: 3 })).toBe('1 in');
    expect(lengthExpression(-30, { units: 'mm', precision: 2 })).toBe('-30 mm');
  });
});

describe('several planes and a box (P4-12)', () => {
  const xy = { origin: [0, 0, 0] as const, normal: [0, 0, 1] as const };
  const yz = { origin: [0, 0, 0] as const, normal: [1, 0, 0] as const };

  it('clips what any plane cuts away: the kept part is the intersection', () => {
    const clips = [sectionClip(xy, 30, false), sectionClip(yz, 20, false)];
    expect(isClippedAny(clips, 10, 0, 10)).toBe(false);
    expect(isClippedAny(clips, 10, 0, 40)).toBe(true);
    expect(isClippedAny(clips, 30, 0, 10)).toBe(true);
    expect(isClippedAny(clips, 30, 0, 40)).toBe(true);
    expect(isClippedAny([], 30, 0, 40)).toBe(false);
    expect(isClippedAny(undefined, 30, 0, 40)).toBe(false);
    // Three planes: one more cut.
    const three = [...clips, sectionClip({ origin: [0, 0, 0], normal: [0, 1, 0] }, 5, true)];
    expect(isClippedAny(three, 10, 0, 10)).toBe(true);
    expect(isClippedAny(three, 10, 6, 10)).toBe(false);
  });

  it('lists every plane in the order added', () => {
    const clips = [sectionClip(xy, 30, false), sectionClip(yz, 20, false)];
    expect(clipsSummary(clips)).toBe('0,0,30:0,0,1;20,0,0:1,0,0');
    expect(clipsSummary([])).toBeUndefined();
    const plane = originPlaneRef('origin:xy');
    const states: SectionState[] = [
      { plane, offset: '30 mm', flip: false, on: true },
      { plane: originPlaneRef('origin:yz'), offset: '20 mm', flip: true, on: false },
    ];
    expect(sectionsSummary(states.slice(0, 1))).toBe('origin:xy offset=30 mm on');
    expect(sectionsSummary(states)).toBe(
      'origin:xy offset=30 mm on;origin:yz offset=20 mm flipped off',
    );
    expect(sectionsSummary([])).toBeUndefined();
  });

  it('makes a box of six planes, each facing out', () => {
    const box = { center: [10, 0, 5] as const, half: [4, 3, 2] as const };
    const clips = boxClips(box);
    expect(clips.map((c) => `${c.origin}:${c.normal}`)).toEqual([
      '14,0,5:1,0,0',
      '6,0,5:-1,0,0',
      '10,3,5:0,1,0',
      '10,-3,5:0,-1,0',
      '10,0,7:0,0,1',
      '10,0,3:0,0,-1',
    ]);
    expect(isClippedAny(clips, 10, 0, 5)).toBe(false);
    for (const p of [
      [15, 0, 5],
      [5, 0, 5],
      [10, 4, 5],
      [10, -4, 5],
      [10, 0, 8],
      [10, 0, 2],
    ] as const)
      expect(isClippedAny(clips, p[0], p[1], p[2])).toBe(true);
    expect(boxSummary(box, true)).toBe('box=10,0,5:4,3,2 on');
    expect(sectionsSummary([], { box, on: false })).toBe('box=10,0,5:4,3,2 off');
    expect(boxFaceCentre(box, '-y')).toEqual([10, -3, 5]);
  });

  it('starts the box at the shown bounds grown 5 %', () => {
    const box = defaultBox({ min: [0, -40, 0], max: [40, 40, 60] });
    expect(box.center).toEqual([20, 0, 30]);
    expect(box.half[0]).toBeCloseTo(21);
    expect(box.half[1]).toBeCloseTo(42);
    expect(box.half[2]).toBeCloseTo(31.5);
  });

  it('drags a face and keeps the opposite one', () => {
    const box = { center: [0, 0, 0] as const, half: [10, 10, 10] as const };
    const moved = dragBoxFace(box, '+x', 4);
    expect(moved.center).toEqual([-3, 0, 0]);
    expect(moved.half).toEqual([7, 10, 10]);
    const back = dragBoxFace(box, '-z', -14);
    expect(back.center[2]).toBe(-2);
    expect(back.half[2]).toBe(12);
    // A face can't cross the opposite one: the box keeps a sliver.
    const squeezed = dragBoxFace(box, '+y', -50);
    expect(squeezed.half[1]).toBeGreaterThan(0);
    expect(squeezed.center[1] - squeezed.half[1]).toBeCloseTo(-10);
  });
});
