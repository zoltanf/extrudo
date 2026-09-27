import {
  createDocument,
  createDocumentStore,
  createSessionStore,
  type FeatureId,
  originPlaneRef,
} from '@extrudo/core';
import { describe, expect, it } from 'vitest';
import { memoryPreferences } from '../platform';
import { createSketchOn, finishSketch } from '../sketch/mode';
import { createViewportStore } from '../viewport/store';
import { createFeatureActions } from './featureActions';

function setup() {
  const stores = {
    store: createDocumentStore(createDocument()),
    session: createSessionStore(),
    viewport: createViewportStore({ preferences: memoryPreferences(), reducedMotion: () => true }),
  };
  const messages: string[] = [];
  const actions = createFeatureActions(stores, (tone, text) => messages.push(`${tone}: ${text}`));
  const a = createSketchOn(stores, originPlaneRef('origin:xy'));
  finishSketch(stores);
  const b = createSketchOn(stores, originPlaneRef('origin:xz'));
  finishSketch(stores);
  const s = stores.store.getState;
  const feature = (id: FeatureId) => s().doc.features.find((f) => f.id === id);
  return { ...stores, actions, messages, a, b, s, feature };
}

describe('feature actions', () => {
  it('rename in one undo step, refuse an empty name and ignore an unchanged one', () => {
    const t = setup();
    expect(t.actions.rename(t.a, '  Base  ')).toBe(true);
    expect(t.feature(t.a)?.name).toBe('Base');
    expect(t.s().undoLabel).toBe('Rename feature');
    expect(t.actions.rename(t.a, ' ')).toBe(false);
    expect(t.messages).toEqual(["error: The name can't be empty."]);
    expect(t.actions.rename(t.a, 'Base')).toBe(true);
    t.s().undo();
    expect(t.feature(t.a)?.name).toBe('Sketch1');
  });

  it('hide and show several features in one step, leaving the unchanged ones alone', () => {
    const t = setup();
    t.actions.setVisible([t.a], false);
    t.actions.setVisible([t.a, t.b], false);
    expect(t.feature(t.a)?.visible).toBe(false);
    expect(t.feature(t.b)?.visible).toBe(false);
    t.s().undo();
    expect(t.feature(t.b)?.visible).toBeUndefined();
    expect(t.feature(t.a)?.visible).toBe(false);
    const before = t.s().doc;
    t.actions.setVisible([t.b], true);
    expect(t.s().doc).toBe(before);
  });

  it('suppress and delete, but not while a sketch is open', () => {
    const t = setup();
    t.actions.toggleSuppressed(t.a);
    expect(t.feature(t.a)?.suppressed).toBe(true);
    t.actions.toggleSuppressed(t.a);
    expect(t.feature(t.a)?.suppressed).toBe(false);

    t.actions.edit(t.b);
    expect(t.actions.locked()).toBe('Finish the sketch first.');
    t.actions.remove(t.a);
    t.actions.toggleSuppressed(t.a);
    expect(t.feature(t.a)).toMatchObject({ suppressed: false });
    expect(t.messages).toEqual([
      'info: Finish the sketch first.',
      'info: Finish the sketch first.',
    ]);
    finishSketch(t);

    t.actions.hover(t.a);
    t.actions.remove(t.a);
    expect(t.feature(t.a)).toBeUndefined();
    expect(t.session.getState().hover).toBeUndefined();
    expect(t.s().undoLabel).toBe('Delete feature');
    t.s().undo();
    expect(t.s().doc.features.map((f) => f.id)).toEqual([t.a, t.b]);
  });

  it('hover a feature and clear only a feature hover', () => {
    const t = setup();
    t.actions.hover(t.b);
    expect(t.session.getState().hover).toEqual({ kind: 'feature', id: t.b });
    t.actions.hover(undefined);
    expect(t.session.getState().hover).toBeUndefined();
    t.session.getState().setHover({ kind: 'plane', id: 'origin:xy' });
    t.actions.hover(undefined);
    expect(t.session.getState().hover).toEqual({ kind: 'plane', id: 'origin:xy' });
  });

  it('open a sketch for editing', () => {
    const t = setup();
    expect(t.actions.edit(t.a)).toBe(true);
    expect(t.session.getState().activeSketchId).toBe(t.a);
  });
});
