import {
  type BodyId,
  createDocument,
  createDocumentStore,
  createModelStore,
  createSessionStore,
  type DocumentStore,
  type Feature,
  type FeatureId,
  insertFeature,
  type ModelStore,
  REMOVE_TYPE,
  removedBodies,
  renameDocument,
} from '@extrudo/core';
import { describe, expect, it } from 'vitest';
import { bodyEntries, bodyMetaOf, createBodyActions, followBodyNames } from './bodies';

const feature = (id: string): Feature => ({
  id: id as FeatureId,
  type: 'extrude',
  name: id,
  suppressed: false,
  inputs: {},
});
const bid = (id: string) => id as BodyId;
const live = (...ids: string[]) => Object.fromEntries(ids.map((id) => [id, {}]));

describe('bodyEntries', () => {
  const features = [feature('A'), feature('B')];

  it('lists the live bodies in timeline order, named Body1, Body2… without metadata', () => {
    const entries = bodyEntries({ features, bodies: {} }, live('B:0', 'A:1', 'A:0'));
    expect(entries.map((e) => [e.id, e.meta.name, e.stored])).toEqual([
      ['A:0', 'Body1', false],
      ['A:1', 'Body2', false],
      ['B:0', 'Body3', false],
    ]);
    expect(bodyMetaOf(entries)[bid('A:1')]).toEqual({ name: 'Body2', visible: true });
  });

  it('uses stored metadata, skips names in use (gone bodies too), leaves out gone bodies', () => {
    const bodies = {
      [bid('A:0')]: { name: 'Body1', visible: false },
      [bid('gone:0')]: { name: 'Body2', visible: true },
    };
    const entries = bodyEntries({ features, bodies }, live('A:0', 'B:0'));
    expect(entries.map((e) => [e.id, e.meta, e.stored])).toEqual([
      ['A:0', { name: 'Body1', visible: false }, true],
      ['B:0', { name: 'Body3', visible: true }, false],
    ]);
  });
});

/** A document store with features A and B (each made one undo step), and a model store. */
function setup() {
  const store = createDocumentStore(createDocument());
  const model = createModelStore<object>();
  const session = createSessionStore();
  store.getState().dispatch(insertFeature({ feature: feature('A') }));
  store.getState().dispatch(insertFeature({ feature: feature('B') }));
  const computed = (...ids: string[]) =>
    model.getState().computed({ features: {}, bodies: live(...ids), doc: store.getState().doc });
  return { store, model, session, computed };
}

const names = (store: DocumentStore) =>
  Object.fromEntries(Object.entries(store.getState().doc.bodies).map(([id, m]) => [id, m.name]));

describe('followBodyNames', () => {
  it('stores names for new bodies in the step that made them', () => {
    const { store, model, computed } = setup();
    const stop = followBodyNames(store, model as ModelStore<unknown>);
    computed('A:0', 'B:0');
    expect(names(store)).toEqual({ 'A:0': 'Body1', 'B:0': 'Body2' });
    // No step of its own: undo takes B's step and both names with it (the names joined it).
    expect(store.getState().undoLabel).toBe('Add feature');
    store.getState().undo();
    expect(names(store)).toEqual({});
    store.getState().redo();
    expect(names(store)).toEqual({ 'A:0': 'Body1', 'B:0': 'Body2' });
    stop();
  });

  it('names never shift when an earlier body goes', () => {
    const { store, model, computed } = setup();
    followBodyNames(store, model as ModelStore<unknown>);
    computed('A:0', 'B:0');
    computed('B:0');
    expect(bodyEntries(store.getState().doc, live('B:0'))[0]?.meta.name).toBe('Body2');
    computed('B:0', 'B:1');
    expect(names(store)['B:1']).toBe('Body3');
  });

  it('skips a result for an older document, or one that names no document', () => {
    const { store, model } = setup();
    followBodyNames(store, model as ModelStore<unknown>);
    const old = store.getState().doc;
    store.getState().dispatch(renameDocument({ name: 'Newer' }));
    model.getState().computed({ features: {}, bodies: live('A:0'), doc: old });
    expect(store.getState().doc.bodies).toEqual({});
    model.getState().computed({ features: {}, bodies: live('A:0') });
    expect(store.getState().doc.bodies).toEqual({});
  });

  it('names the bodies of a freshly opened document without an undo step', () => {
    const store = createDocumentStore(createDocument());
    const model = createModelStore<object>();
    model.getState().computed({ features: {}, bodies: live('X:0'), doc: store.getState().doc });
    followBodyNames(store, model as ModelStore<unknown>);
    expect(names(store)).toEqual({ 'X:0': 'Body1' });
    expect(store.getState().canUndo).toBe(false);
  });
});

describe('body actions', () => {
  function actions() {
    const t = setup();
    const messages: string[] = [];
    const entries = () => bodyEntries(t.store.getState().doc, live('A:0', 'B:0'));
    const a = createBodyActions(t, entries, (tone, text) => messages.push(`${tone}: ${text}`));
    return { ...t, a, messages, meta: (id: string) => t.store.getState().doc.bodies[bid(id)] };
  }

  it('rename stores the name (and the metadata of a body without any), refusing an empty one', () => {
    const t = actions();
    expect(t.a.rename(bid('B:0'), ' Lid ')).toBe(true);
    expect(t.meta('B:0')).toEqual({ name: 'Lid', visible: true });
    expect(t.a.rename(bid('B:0'), '')).toBe(false);
    expect(t.messages).toEqual(["error: The name can't be empty."]);
    t.store.getState().undo();
    expect(t.meta('B:0')).toBeUndefined();
  });

  it('hides several bodies in one step', () => {
    const t = actions();
    t.a.setVisible([bid('A:0'), bid('B:0')], false);
    expect([t.meta('A:0')?.visible, t.meta('B:0')?.visible]).toEqual([false, false]);
    expect(t.store.getState().undoLabel).toBe('Hide bodies');
    t.a.setVisible([bid('A:0')], true);
    expect(t.store.getState().undoLabel).toBe('Change body');
  });

  it('colour and opacity, back to the defaults', () => {
    const t = actions();
    t.a.setColor(bid('A:0'), '#5b7cff');
    t.a.setOpacity(bid('A:0'), 0.5);
    expect(t.meta('A:0')).toEqual({ name: 'Body1', visible: true, color: '#5b7cff', opacity: 0.5 });
    t.a.setColor(bid('A:0'), undefined);
    t.a.setOpacity(bid('A:0'), 1);
    expect(t.meta('A:0')).toEqual({ name: 'Body1', visible: true });
  });

  it('remove adds a Remove feature at the marker and drops the bodies from the selection', () => {
    const t = actions();
    t.session.getState().select([
      { kind: 'body', id: 'A:0' },
      { kind: 'face', id: 'B:0:1' },
    ]);
    const id = t.a.remove([bid('A:0')]);
    const added = t.store.getState().doc.features.at(-1);
    expect(added).toMatchObject({ id, type: REMOVE_TYPE, name: 'Remove1' });
    expect(added && removedBodies(added)).toEqual(['A:0']);
    expect(t.session.getState().selection).toEqual([{ kind: 'face', id: 'B:0:1' }]);
    expect(t.store.getState().undoLabel).toBe('Add feature');

    t.session.getState().enterSketch('A' as FeatureId);
    expect(t.a.remove([bid('B:0')])).toBeUndefined();
    expect(t.messages).toEqual(['info: Finish the sketch first.']);
  });
});
