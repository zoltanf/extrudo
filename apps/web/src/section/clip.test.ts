import { type GeomRef, originPlaneRef } from '@extrudo/core';
import type { BodyMesh } from '@extrudo/kernel';
import { describe, expect, it } from 'vitest';
import { boxMesh } from '../selection/testing';
import {
  arrowBase,
  CLIP_EPS,
  clipDistance,
  clipSummary,
  isClipped,
  middleOffset,
  type SectionState,
  sectionClip,
  sectionFrame,
  sectionSummary,
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
