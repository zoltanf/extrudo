import {
  addToSketch,
  CommandError,
  type ConstraintId,
  createDocument,
  createDocumentStore,
  createSessionStore,
  type DimensionId,
  originPlaneRef,
  readSketch,
  type SketchEntityId,
} from '@extrudo/core';
import { describe, expect, it } from 'vitest';
import { memoryPreferences } from '../platform';
import { createViewportStore } from '../viewport/store';
import { createSketchOn, finishSketch } from './mode';
import { deleteSelection, selectedConstraints, selectedDimensions } from './selection';

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
      dimensions: {
        ['k1' as DimensionId]: {
          type: 'distance',
          orientation: 'aligned',
          a: e('l'),
          expr: '10',
          paramName: 'd1',
          driven: false,
        },
        ['k2' as DimensionId]: {
          type: 'distance',
          orientation: 'horizontal',
          a: e('a'),
          b: e('b'),
          expr: 'd1',
          driven: true,
        },
      },
    }),
  );
  const data = () => {
    const f = stores.store.getState().doc.features[0];
    const view = f && readSketch(f);
    if (!view) throw new Error('no sketch');
    return view.data;
  };
  const constraints = () => Object.keys(data().constraints);
  const dimensions = () => Object.keys(data().dimensions);
  return { ...stores, constraints, dimensions };
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

describe('deleting selected dimensions', () => {
  it('removes dimensions with constraints in one step', () => {
    const t = setup();
    t.session.getState().select([
      { kind: 'dimension', id: 'k2' },
      { kind: 'constraint', id: 'h' },
      { kind: 'dimension', id: 'gone' },
    ]);
    expect(selectedDimensions(t)).toEqual(['k2']);
    expect(deleteSelection(t)).toBe(true);
    expect(t.dimensions()).toEqual(['k1']);
    expect(t.constraints()).toEqual(['f']);
    t.store.getState().undo();
    expect(t.dimensions().sort()).toEqual(['k1', 'k2']);
  });

  it('refuses to delete a dimension whose parameter is still used', () => {
    const t = setup();
    // k2 is driven, so it doesn't count; a user parameter does.
    t.session.getState().select([{ kind: 'dimension', id: 'k1' }]);
    expect(deleteSelection(t)).toBe(true);
    t.store.getState().undo();
    t.store.getState().dispatch(
      addToSketch({
        feature: t.session.getState().activeSketchId as never,
        dimensions: {
          ['k3' as DimensionId]: {
            type: 'distance',
            orientation: 'vertical',
            a: 'a' as SketchEntityId,
            b: 'b' as SketchEntityId,
            expr: 'd1 / 2',
            driven: false,
          },
        },
      }),
    );
    t.session.getState().select([{ kind: 'dimension', id: 'k1' }]);
    expect(() => deleteSelection(t)).toThrow(CommandError);
    expect(t.dimensions().sort()).toEqual(['k1', 'k2', 'k3']);
    expect(t.session.getState().selection).toHaveLength(1);
  });
});
