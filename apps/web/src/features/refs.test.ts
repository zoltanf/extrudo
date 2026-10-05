import type { BodyId } from '@extrudo/core';
import { describe, expect, it } from 'vitest';
import { combineFilters, DEFAULT_FILTER } from '../selection/filter';
import { boxMesh } from '../selection/testing';
import { faceFrame, meanFrame, meshFaceFrame } from './geometry';
import { previewDrawing, previewSummary } from './preview';
import { accepts, fieldFilter, itemRef, refItems } from './refs';
import { BOX, faceItem, namedBoxMesh } from './testing';

describe('references and items', () => {
  const bodies = { [BOX]: namedBoxMesh() };

  it('turns picks into persistent references and back into items to highlight', () => {
    expect(itemRef(faceItem(1), bodies)).toEqual({ kind: 'face', id: 'box:top' });
    expect(itemRef({ kind: 'edge', id: `${BOX}:2` }, bodies)).toEqual({
      kind: 'edge',
      id: 'box:e2',
    });
    expect(itemRef(faceItem(1), { [BOX]: boxMesh() })).toBeUndefined();
    expect(
      refItems(
        [
          { kind: 'face', id: 'box:right' },
          { kind: 'profile', id: 's/r1' },
          { kind: 'face', id: 'gone' },
        ],
        bodies,
      ),
    ).toEqual([faceItem(5), { kind: 'profile', id: 's/r1' }]);
  });

  it('narrows the filter to what a field takes, under the user filter', () => {
    const faces = fieldFilter(['face', 'profile']);
    expect(
      Object.entries(faces)
        .filter(([, on]) => on)
        .map(([k]) => k),
    ).toEqual(['faces', 'profiles']);
    const user = { ...DEFAULT_FILTER, profiles: false };
    expect(combineFilters(user, faces)).toMatchObject({
      faces: true,
      profiles: false,
      edges: false,
    });
    expect(combineFilters(user, undefined)).toBe(user);
    expect(accepts(['face'], faceItem(0))).toBe(true);
    expect(accepts(['face'], { kind: 'body', id: BOX })).toBe(false);
  });
});

describe('manipulator frames', () => {
  it('takes a face centroid and normal from its triangles', () => {
    expect(meshFaceFrame(boxMesh([0, 0, 0], [10, 20, 30]), 1)).toEqual({
      origin: [5, 10, 30],
      normal: [0, 0, 1],
      flatness: 1,
    });
    expect(faceFrame({ [BOX]: namedBoxMesh() }, { kind: 'face', id: 'box:left' })).toEqual({
      origin: [0, 5, 5],
      normal: [-1, 0, 0],
      flatness: 1,
    });
    expect(faceFrame({}, { kind: 'face', id: 'box:left' })).toBeUndefined();
    expect(
      meanFrame([
        { origin: [0, 0, 0], normal: [0, 0, 1] },
        undefined,
        { origin: [4, 2, 0], normal: [0, 1, 0] },
      ]),
    ).toEqual({ origin: [2, 1, 0], normal: [0, 0, 1] });
  });
});

describe('preview drawings', () => {
  it('draws tools, or else the bodies the draft changed', () => {
    const same = namedBoxMesh();
    const changed = boxMesh([0, 0, 0], [5, 5, 5]);
    const tool = boxMesh([0, 0, 10], [1, 1, 11]);
    const model = { [BOX]: same, ['other' as BodyId]: same };
    const bodies = { [BOX]: changed, ['other' as BodyId]: same, ['new' as BodyId]: tool };
    expect(previewDrawing({ features: {}, bodies, tools: [] }, model, 'cut')).toEqual({
      shapes: [
        { mesh: changed, style: 'cut' },
        { mesh: tool, style: 'cut' },
      ],
      tools: false,
    });
    const drawing = previewDrawing(
      { features: {}, bodies, tools: [{ mesh: tool, style: 'join' }] },
      model,
      'cut',
    );
    expect(drawing).toEqual({ shapes: [{ mesh: tool, style: 'join' }], tools: true });
    expect(previewSummary({ shapes: drawing.shapes, dimmed: false })).toBe('join');
    expect(previewSummary(undefined)).toBeUndefined();
  });

  it('draws the skipped instances of a pattern beside the rest, not instead (P4-12)', () => {
    const same = namedBoxMesh();
    const changed = boxMesh([0, 0, 0], [5, 5, 5]);
    const ghost = boxMesh([20, 0, 0], [25, 5, 5]);
    const model = { [BOX]: same };
    // A pattern of bodies has no other tools: its ghosts show with the copies.
    const drawing = previewDrawing(
      {
        features: {},
        bodies: { [BOX]: changed, ['new' as BodyId]: ghost },
        tools: [{ mesh: ghost, style: 'skip' }],
      },
      model,
      'new',
    );
    expect(drawing).toEqual({
      shapes: [
        { mesh: changed, style: 'new' },
        { mesh: ghost, style: 'new' },
        { mesh: ghost, style: 'skip' },
      ],
      tools: false,
    });
    expect(previewSummary({ shapes: drawing.shapes, dimmed: false })).toBe('new new skip');
    // A body the draft didn't change adds nothing, so the ghost is all that is drawn.
    expect(
      previewDrawing(
        { features: {}, bodies: { [BOX]: same }, tools: [{ mesh: ghost, style: 'skip' }] },
        model,
        'cut',
      ),
    ).toEqual({ shapes: [{ mesh: ghost, style: 'skip' }], tools: false });
  });
});
