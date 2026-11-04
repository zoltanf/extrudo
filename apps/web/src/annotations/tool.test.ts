import { Design } from '@extrudo/api';
import { type BodyId, createDocumentStore, createSessionStore } from '@extrudo/core';
import type { BodyMesh } from '@extrudo/kernel';
import { describe, expect, it } from 'vitest';
import { annotationRefOf, createAnnotateSelect, createSketchAnnotateInput } from './tool';
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
  function setup(active = () => true) {
    const store = createDocumentStore(Design.create().toJSON());
    const ui = createAnnotationsUi();
    const notes: string[] = [];
    const select = createAnnotateSelect({
      store,
      ui,
      base: { onHover: () => {}, onClick: () => {}, onBox: () => {} },
      bodies: () => ({}),
      resolve: undefined,
      active,
      notify: (message) => notes.push(message),
    });
    return { store, ui, select, notes };
  }

  it('drafts a free note with the next number on a click on nothing, and adds nothing', async () => {
    const { store, ui, select } = setup();
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

  it('opens nothing when the answer comes after the tool ended', async () => {
    let on = true;
    const { ui, select } = setup(() => on);
    select.onClick(undefined, false, [1, 2, 0]);
    on = false;
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(ui.getState().draft).toBeUndefined();
  });

  it('skips the click whose press just committed an editor by blurring it', async () => {
    const { ui, select } = setup();
    ui.getState().noteBlur();
    select.onClick(undefined, false, [1, 2, 0]);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(ui.getState().draft).toBeUndefined();
  });
});

describe('annotationRefOf on a mesh body', () => {
  it('takes the body when the face has no persistent name', () => {
    const mesh = { faceRanges: [0, 3], mesh: true };
    const bodies = { 'm1:0': mesh } as unknown as Record<BodyId, BodyMesh>;
    expect(annotationRefOf({ kind: 'face', id: 'm1:0:0' }, bodies)).toEqual({
      kind: 'body',
      id: 'm1:0',
    });
  });
});

describe('createSketchAnnotateInput', () => {
  it('pins a click on a point to it, and a click on empty plane to the sketch', async () => {
    const d = Design.create();
    let corner = '';
    const sketch = d.sketch(d.origin.xy, (k) => {
      corner = k.point([10, 5]).id;
    });
    const store = createDocumentStore(d.toJSON());
    const ui = createAnnotationsUi();
    const session = createSessionStore();
    const input = createSketchAnnotateInput({
      store,
      session,
      ui,
      sketch: sketch.id,
      frame: { origin: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0], normal: [0, 0, 1] },
    });
    const pointer = (x: number, y: number) =>
      ({ point: [x, y], perPixel: 0.1, screen: [0, 0], infer: true }) as never;
    input.onMove(pointer(10.2, 5.1));
    expect(session.getState().hover).toEqual({ kind: 'sketchEntity', id: corner });
    input.onClick(pointer(10.2, 5.1));
    expect(ui.getState().draft).toMatchObject({
      anchor: { kind: 'sketch', sketch: sketch.id, entity: corner },
      at: [10.2, 5.1, 0],
      number: 1,
    });
    const anchor = ui.getState().draft?.anchor;
    const offset = anchor?.kind === 'sketch' ? anchor.at : [Number.NaN, Number.NaN];
    expect(offset[0]).toBeCloseTo(0.2, 9);
    expect(offset[1]).toBeCloseTo(0.1, 9);
    ui.getState().setDraft(undefined);
    input.onClick(pointer(-20, 30));
    expect(ui.getState().draft?.anchor).toEqual({
      kind: 'sketch',
      sketch: sketch.id,
      at: [-20, 30],
    });
  });
});
