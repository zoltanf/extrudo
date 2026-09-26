import {
  addToSketch,
  type ConstraintId,
  createDocument,
  createDocumentStore,
  createSessionStore,
  originPlaneRef,
  readSketch,
  type SketchEntityId,
} from '@extrudo/core';
import { describe, expect, it } from 'vitest';
import { memoryPreferences } from '../platform';
import { createViewportStore } from '../viewport/store';
import { createSketchOn, finishSketch } from './mode';
import { deleteSelection, selectedConstraints } from './selection';

function setup() {
  const stores = {
    store: createDocumentStore(createDocument()),
    session: createSessionStore(),
    viewport: createViewportStore({ preferences: memoryPreferences(), reducedMotion: () => true }),
  };
  const id = createSketchOn(stores, originPlaneRef('origin:xy'));
  const e = (s: string) => s as SketchEntityId;
  stores.store.getState().dispatch(
    addToSketch({
      feature: id,
      entities: {
        [e('a')]: { type: 'point', x: 0, y: 0 },
        [e('b')]: { type: 'point', x: 10, y: 0 },
        [e('l')]: { type: 'line', start: e('a'), end: e('b'), construction: false },
      },
      constraints: {
        ['h' as ConstraintId]: { type: 'horizontal', a: e('l') },
        ['f' as ConstraintId]: { type: 'fix', entity: e('a') },
      },
    }),
  );
  const constraints = () => {
    const f = stores.store.getState().doc.features[0];
    return Object.keys((f && readSketch(f)?.data.constraints) ?? {});
  };
  return { ...stores, constraints };
}

describe('deleting selected constraints', () => {
  it('removes the selected constraints as one undo step and clears the selection', () => {
    const t = setup();
    t.session.getState().select([
      { kind: 'constraint', id: 'h' },
      { kind: 'constraint', id: 'f' },
      { kind: 'sketchEntity', id: 'l' },
    ]);
    expect(deleteSelection(t)).toBe(true);
    expect(t.constraints()).toEqual([]);
    expect(t.session.getState().selection).toEqual([]);
    t.store.getState().undo();
    expect(t.constraints()).toEqual(['h', 'f']);
  });

  it('skips constraints that are gone, and does nothing without a selection', () => {
    const t = setup();
    t.session.getState().select([
      { kind: 'constraint', id: 'gone' },
      { kind: 'constraint', id: 'f' },
    ]);
    expect(selectedConstraints(t)).toEqual(['f']);
    t.session.getState().clearSelection();
    expect(deleteSelection(t)).toBe(false);
    expect(t.constraints()).toEqual(['h', 'f']);
    finishSketch(t);
    t.session.getState().select([{ kind: 'constraint', id: 'h' }]);
    expect(deleteSelection(t)).toBe(false);
  });
});
