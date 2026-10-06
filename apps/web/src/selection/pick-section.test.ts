import type { BodyId } from '@extrudo/core';
import { describe, expect, it } from 'vitest';
import type { SectionClip } from '../section/clip';
import { DEFAULT_FILTER, type SelectionFilter } from './filter';
import { type PickScene, pickBox, pickStack, pickTop, projectPoint } from './pick';
import { boxMesh, cameraFrom, topViewPx } from './testing';

/**
 * Picking under a section analysis (P3-09, ADR-0045): what the clipping plane cuts away is
 * never picked, and the cap drawn on the cut hides what lies behind it.
 */
const B = 'b' as BodyId;
const cube = boxMesh([0, 0, 0], [10, 10, 10]);
const plain: PickScene = { bodies: [{ id: B, mesh: cube }], sketches: [], occluding: true };
/** The cube cut at z = 5, everything above removed. */
const removeAbove: SectionClip = { origin: [0, 0, 5], normal: [0, 0, 1] };
const removeBelow: SectionClip = { origin: [0, 0, 5], normal: [0, 0, -1] };
const cut = (...clip: SectionClip[]): PickScene => ({ ...plain, clip });

const only = (...kinds: (keyof SelectionFilter)[]): SelectionFilter =>
  Object.fromEntries(
    Object.keys(DEFAULT_FILTER).map((k) => [k, kinds.includes(k as never)]),
  ) as never;

// From front-right-top: the top (face 1), front (face 2) and right (face 5) faces show.
const iso = cameraFrom([1, -1, 1], { target: [5, 5, 5], size: 40 });
const at = (p: [number, number, number], camera = iso): [number, number] => {
  const s = projectPoint(camera, p);
  if (!s) throw new Error('behind the camera');
  return s;
};

describe('picking under a section', () => {
  it('does not pick a face on the clipped side', () => {
    // Without a section the top face is under the pointer; with it, that face is gone, and the
    // cap on the cut (the ray meets the plane inside the cube) hides the inside behind it.
    expect(pickTop(plain, iso, at([7, 4, 10]), DEFAULT_FILTER)).toEqual({
      kind: 'face',
      id: 'b:1',
    });
    expect(pickTop(cut(removeAbove), iso, at([7, 4, 10]), DEFAULT_FILTER)).toBeUndefined();
    const stack = pickStack(cut(removeAbove), iso, at([7, 4, 10]), DEFAULT_FILTER);
    expect(stack.some((hit) => hit.item.id === 'b:1')).toBe(false);
    // Everything the stack does list lies behind the cap: only "Select other…" offers it.
    expect(stack.length).toBeGreaterThan(0);
    expect(stack.every((hit) => hit.occluded)).toBe(true);
  });

  it('still picks the part of a face that is kept', () => {
    // The front face (−Y, face 2) is cut at z = 5: its lower half stays.
    expect(pickTop(cut(removeAbove), iso, at([5, 0, 2]), DEFAULT_FILTER)).toEqual({
      kind: 'face',
      id: 'b:2',
    });
    expect(pickTop(cut(removeAbove), iso, at([5, 0, 8]), DEFAULT_FILTER)).toBeUndefined();
  });

  it('flipping keeps the other side', () => {
    expect(pickTop(cut(removeBelow), iso, at([7, 4, 10]), DEFAULT_FILTER)).toEqual({
      kind: 'face',
      id: 'b:1',
    });
    // The front face's lower half is gone now and nothing is behind it.
    expect(pickTop(cut(removeBelow), iso, at([5, 0, 2]), DEFAULT_FILTER)).toBeUndefined();
  });

  it('does not pick vertices or edges on the clipped side', () => {
    // The top-front-right corner (vertex 5) is cut away; the bottom one (vertex 1) stays.
    expect(pickTop(plain, iso, at([10, 0, 10]), DEFAULT_FILTER)).toEqual({
      kind: 'vertex',
      id: 'b:5',
    });
    expect(pickTop(cut(removeAbove), iso, at([10, 0, 10]), DEFAULT_FILTER)).toBeUndefined();
    expect(pickTop(cut(removeAbove), iso, at([10, 0, 0]), DEFAULT_FILTER)).toEqual({
      kind: 'vertex',
      id: 'b:1',
    });
    // The vertical front-right edge (edge 9) is cut in two: its kept half can be picked, the
    // cut away one can't.
    const kept = at([10, 0, 2]);
    expect(pickTop(cut(removeAbove), iso, [kept[0] + 3, kept[1]], only('edges'))).toEqual({
      kind: 'edge',
      id: 'b:9',
    });
    const gone = at([10, 0, 8]);
    expect(pickTop(cut(removeAbove), iso, [gone[0] + 3, gone[1]], only('edges'))).toBeUndefined();
    // The top-front edge (edge 2) is wholly clipped.
    expect(pickTop(cut(removeAbove), iso, at([5, 0, 10]), only('edges'))).toBeUndefined();
  });

  it('keeps faces that lie in the plane', () => {
    const flush: SectionClip = { origin: [0, 0, 10], normal: [0, 0, 1] };
    expect(pickTop(cut(flush), iso, at([7, 4, 10]), DEFAULT_FILTER)).toEqual({
      kind: 'face',
      id: 'b:1',
    });
  });

  it('sees the kept side from the other side of the plane', () => {
    const below = cameraFrom([0, 0, -1], { target: [5, 5, 5], size: 40 });
    // From underneath the bottom face comes first, with the section or without.
    expect(pickTop(cut(removeAbove), below, [400, 300], DEFAULT_FILTER)).toEqual({
      kind: 'face',
      id: 'b:0',
    });
  });

  it('works in perspective', () => {
    const view = cameraFrom([1, -1, 1], { target: [5, 5, 5], size: 40, projection: 'perspective' });
    expect(pickTop(cut(removeAbove), view, at([7, 4, 10], view), DEFAULT_FILTER)).toBeUndefined();
    expect(pickTop(cut(removeAbove), view, at([5, 0, 2], view), DEFAULT_FILTER)).toEqual({
      kind: 'face',
      id: 'b:2',
    });
  });

  it('leaves a box selection the faces, edges and vertices that are drawn', () => {
    const top = cameraFrom([0, 0, 1], { target: [5, 5, 5], size: 60 });
    const from = topViewPx(top, -20, 25);
    const to = topViewPx(top, 30, -20);
    const ids = (filter: SelectionFilter, scene: PickScene) =>
      pickBox(scene, top, from, to, filter).map((i) => i.id);
    expect(ids(only('faces'), plain)).toHaveLength(6);
    // The top face is gone; the sides are cut but there.
    expect(ids(only('faces'), cut(removeAbove)).sort()).toEqual(
      ['b:0', 'b:2', 'b:3', 'b:4', 'b:5'].sort(),
    );
    expect(ids(only('vertices'), cut(removeAbove)).sort()).toEqual(
      ['b:0', 'b:1', 'b:2', 'b:3'].sort(),
    );
    // The four top edges are clipped away; the four vertical ones are cut but drawn.
    expect(ids(only('edges'), cut(removeAbove))).toHaveLength(8);
    expect(ids(only('bodies'), cut(removeAbove))).toEqual(['b']);
  });

  describe('several planes (P4-12)', () => {
    // z above 7 and x beyond 5 are cut away: a corner of the cube is gone.
    const high: SectionClip = { origin: [0, 0, 7], normal: [0, 0, 1] };
    const right: SectionClip = { origin: [5, 0, 0], normal: [1, 0, 0] };
    const corner = cut(high, right);

    it('is visible inside every kept side and clipped outside any', () => {
      // The front face (y = 0) where z <= 7 and x <= 5 is kept.
      expect(pickTop(corner, iso, at([2, 0, 3]), DEFAULT_FILTER)).toEqual({
        kind: 'face',
        id: 'b:2',
      });
      // Outside one plane only: above 7 at x = 2, beyond x = 5 at z = 3.
      expect(pickTop(cut(high, right), iso, at([3, 0, 9]), DEFAULT_FILTER)).toBeUndefined();
      expect(pickTop(cut(right), iso, at([8, 0, 3]), DEFAULT_FILTER)?.id).not.toBe('b:2');
    });

    it('never picks the faces both planes cut away', () => {
      const stack = pickStack(corner, iso, at([8, 0, 9]), DEFAULT_FILTER);
      expect(stack.some((hit) => hit.item.id === 'b:1' || hit.item.id === 'b:5')).toBe(false);
    });

    it('occludes what lies behind either plane’s cap', () => {
      // From the left face's point (0, 7, 1) the ray runs through the corner that is cut away
      // and crosses x = 5 inside the cube at z = 6, which the other plane keeps: that cap
      // covers the face, so it is listed only for "Select other…".
      const stack = pickStack(corner, iso, at([0, 7, 1]), DEFAULT_FILTER);
      const left = stack.find((hit) => hit.item.id === 'b:4');
      expect(left?.occluded).toBe(true);
      expect(pickTop(corner, iso, at([0, 7, 1]), DEFAULT_FILTER)).toBeUndefined();
    });
  });
});
