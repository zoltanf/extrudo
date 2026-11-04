import { Design } from '@extrudo/api';
import { type BodyId, createDocumentStore } from '@extrudo/core';
import type { BodyMesh } from '@extrudo/kernel';
import { describe, expect, it } from 'vitest';
import { annotationRefOf, createAnnotateSelect } from './tool';
import { createAnnotationsUi } from './ui';

describe('annotationRefOf', () => {
  const mesh = { faceRanges: [0, 3, 3, 3], faceIds: ['box:f1:cap:end', 'box:f1:cap:start'] };
  const bodies = { 'f1:0': mesh } as unknown as Record<BodyId, BodyMesh>;

  it('names a face by its persistent name, a body by its ID, origin geometry as it is', () => {
    expect(annotationRefOf({ kind: 'face', id: 'f1:0:1' }, bodies)).toEqual({
      kind: 'face',
      id: 'box:f1:cap:start',
    });
    expect(annotationRefOf({ kind: 'body', id: 'f1:0' }, bodies)).toEqual({
      kind: 'body',
      id: 'f1:0',
    });
    expect(annotationRefOf({ kind: 'axis', id: 'origin:z' }, bodies)).toEqual({
      kind: 'axis',
      id: 'origin:z',
    });
    expect(annotationRefOf({ kind: 'sketchEntity', id: 's1/l1' }, bodies)).toEqual({
      kind: 'sketchEntity',
      id: 's1/l1',
    });
  });

  it('takes nothing it cannot sit on', () => {
    expect(annotationRefOf({ kind: 'profile', id: 's1/0' }, bodies)).toBeUndefined();
    expect(annotationRefOf({ kind: 'face', id: 'f9:0:1' }, bodies)).toBeUndefined();
  });
});

describe('createAnnotateSelect', () => {
  it('drafts a free note with the next number on a click on nothing, and adds nothing', async () => {
    const store = createDocumentStore(Design.create().toJSON());
    const ui = createAnnotationsUi();
    const select = createAnnotateSelect({
      store,
      ui,
      base: { onHover: () => {}, onClick: () => {}, onBox: () => {} },
      bodies: () => ({}),
      resolve: undefined,
    });
    select.onClick(undefined, false, [1, 2, 0]);
    await expect
      .poll(() => ui.getState().draft)
      .toEqual({
        anchor: { kind: 'free', at: [1, 2, 0] },
        at: [1, 2, 0],
        number: 1,
      });
    expect(store.getState().doc.annotations).toBeUndefined();
  });
});
