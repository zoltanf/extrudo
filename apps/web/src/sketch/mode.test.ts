import {
  createDocument,
  createDocumentStore,
  createSessionStore,
  type FeatureId,
  originPlaneRef,
  renameDocument,
  renameFeature,
} from '@extrudo/core';
import { describe, expect, it } from 'vitest';
import { memoryPreferences } from '../platform';
import { basis } from '../viewport/camera';
import { createViewportStore } from '../viewport/store';
import {
  CREATE_SKETCH,
  cancelCreateSketch,
  createSketchOn,
  editSketch,
  finishSketch,
  startCreateSketch,
} from './mode';

function setup() {
  const stores = {
    store: createDocumentStore(createDocument()),
    session: createSessionStore(),
    viewport: createViewportStore({ preferences: memoryPreferences(), reducedMotion: () => true }),
  };
  return {
    ...stores,
    doc: () => stores.store.getState().doc,
    mode: () => {
      const { mode, activeSketchId, activeTool } = stores.session.getState();
      return { mode, activeSketchId, activeTool };
    },
    direction: () => {
      const { back, right } = basis(stores.viewport.getState().view);
      const round = (v: { x: number; y: number; z: number }) =>
        [v.x, v.y, v.z].map((c) => Math.round(c * 1e6) / 1e6 + 0);
      return { back: round(back), right: round(right) };
    },
  };
}

describe('sketch mode', () => {
  it('Create Sketch waits for a plane, and Esc (cancel) stops waiting', () => {
    const t = setup();
    t.session.getState().select([{ kind: 'body', id: 'b1' }]);
    startCreateSketch(t);
    expect(t.mode()).toEqual({
      mode: 'model',
      activeSketchId: undefined,
      activeTool: CREATE_SKETCH,
    });
    expect(t.session.getState().selection).toEqual([]);
    t.session.getState().setHover({ kind: 'plane', id: 'origin:xy' });
    cancelCreateSketch(t);
    expect(t.mode().activeTool).toBeUndefined();
    expect(t.session.getState().hover).toBeUndefined();
  });

  it('picking a plane adds a sketch, enters it and looks at the plane', () => {
    const t = setup();
    startCreateSketch(t);
    const id = createSketchOn(t, originPlaneRef('origin:xz'));
    expect(t.doc().features.map((f) => [f.id, f.name, f.type])).toEqual([
      [id, 'Sketch1', 'sketch'],
    ]);
    expect(t.mode()).toEqual({ mode: 'sketch', activeSketchId: id, activeTool: undefined });
    expect(t.store.getState().transactionDepth).toBe(1);
    // Front view: the camera sits at −Y; sketch X (world X) points right.
    expect(t.direction()).toEqual({ back: [0, -1, 0], right: [1, 0, 0] });
  });

  it('looks at the YZ and XY planes with sketch X to the right', () => {
    const t = setup();
    createSketchOn(t, originPlaneRef('origin:yz'));
    expect(t.direction()).toEqual({ back: [1, 0, 0], right: [0, 1, 0] });
    finishSketch(t);
    createSketchOn(t, originPlaneRef('origin:xy'));
    expect(t.direction()).toEqual({ back: [0, 0, 1], right: [1, 0, 0] });
  });

  it('collapses the edits made in sketch mode into one undo step on finish', () => {
    const t = setup();
    const id = createSketchOn(t, originPlaneRef('origin:xy'));
    const { dispatch } = t.store.getState();
    dispatch(renameFeature({ id, name: 'Base' }));
    dispatch(renameDocument({ name: 'Bracket' }));
    // Inside the sketch, undo steps through its edits, never past the creation.
    t.store.getState().undo();
    expect(t.doc().name).not.toBe('Bracket');
    t.store.getState().redo();
    finishSketch(t);
    expect(t.mode()).toEqual({ mode: 'model', activeSketchId: undefined, activeTool: undefined });
    expect(t.store.getState()).toMatchObject({ transactionDepth: 0, undoLabel: 'Edit sketch' });
    t.store.getState().undo();
    expect(t.doc()).toMatchObject({ name: 'Untitled', features: [{ name: 'Sketch1' }] });
    expect(t.store.getState().undoLabel).toBe('Create sketch');
    t.store.getState().undo();
    expect(t.doc().features).toEqual([]);
  });

  it('leaves no extra undo step when nothing changed in the sketch', () => {
    const t = setup();
    createSketchOn(t, originPlaneRef('origin:xy'));
    finishSketch(t);
    expect(t.store.getState().undoLabel).toBe('Create sketch');
  });

  it('re-enters a sketch, and finishes the open one when another is entered', () => {
    const t = setup();
    const first = createSketchOn(t, originPlaneRef('origin:xy'));
    finishSketch(t);
    const second = createSketchOn(t, originPlaneRef('origin:yz'));
    expect(editSketch(t, first)).toBe(true);
    expect(t.mode().activeSketchId).toBe(first);
    expect(t.store.getState().transactionDepth).toBe(1);
    expect(editSketch(t, first)).toBe(true);
    expect(t.store.getState().transactionDepth).toBe(1);
    finishSketch(t);
    expect(t.doc().features.map((f) => f.id)).toEqual([first, second]);
  });

  it('refuses to enter a feature that isn’t a valid sketch', () => {
    const t = setup();
    expect(editSketch(t, 'nope' as FeatureId)).toBe(false);
    expect(t.mode().mode).toBe('model');
    expect(t.store.getState().transactionDepth).toBe(0);
  });

  it('ignores Create Sketch while a sketch is open, and Finish outside one', () => {
    const t = setup();
    finishSketch(t);
    createSketchOn(t, originPlaneRef('origin:xy'));
    startCreateSketch(t);
    expect(t.mode().activeTool).toBeUndefined();
  });
});
