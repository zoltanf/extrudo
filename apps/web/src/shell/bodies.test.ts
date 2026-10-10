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
  updateBody,
} from '@extrudo/core';
import { describe, expect, it } from 'vitest';
import {
  bodiesEmptyState,
  bodyEntries,
  bodyMetaOf,
  createBodyActions,
  followBodyNames,
  importedColors,
  isSwatch,
  parseBodyColor,
  pendingBodyEntries,
} from './bodies';

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

  it("takes a STEP import's colour when it first names a body (P4-12), never later", () => {
    const { store, model } = setup();
    followBodyNames(store, model as ModelStore<unknown>);
    const imports = (colors: Record<string, string>) => ({
      B: { kind: 'import' as const, colors: colors as Record<BodyId, string>, coloredFaces: 0 },
    });
    model.getState().computed({
      features: {},
      bodies: live('A:0', 'B:0', 'B:1'),
      imports: imports({ 'B:0': '#C81E28', 'A:0': 'not a colour' }),
      doc: store.getState().doc,
    });
    const meta = (id: string) => store.getState().doc.bodies[bid(id)];
    expect(meta('B:0')).toEqual({ name: 'Body2', visible: true, color: '#c81e28' });
    expect(meta('B:1')).toEqual({ name: 'Body3', visible: true });
    expect(meta('A:0')).toEqual({ name: 'Body1', visible: true });
    // The user's colour wins: a later report (a re-import, another Up) repaints nothing.
    store.getState().dispatch(updateBody({ id: bid('B:0'), changes: { color: '#22b3c2' } }));
    model.getState().computed({
      features: {},
      bodies: live('A:0', 'B:0', 'B:1'),
      imports: imports({ 'B:0': '#102030', 'B:1': '#405060' }),
      doc: store.getState().doc,
    });
    expect(meta('B:0')?.color).toBe('#22b3c2');
    expect(meta('B:1')?.color).toBeUndefined();
  });
});

describe('importedColors', () => {
  it('merges every import report, keeping only colours the document can store', () => {
    const colors = importedColors({
      ['F' as FeatureId]: {
        kind: 'import',
        colors: { [bid('F:0')]: '#ABCDEF', [bid('F:1')]: 'red' },
        coloredFaces: 3,
      },
    });
    expect([...colors]).toEqual([['F:0', '#abcdef']]);
    expect(importedColors(undefined).size).toBe(0);
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

  it('ghosts a body (while hidden) and shows or hides it again', () => {
    const t = actions();
    // A ghost is `visible: false` plus `ghost: true` (ADR-0030's amendment).
    t.a.setDisplay([bid('A:0')], 'ghost');
    expect(t.meta('A:0')).toEqual({ name: 'Body1', visible: false, ghost: true });
    // Hiding a ghost clears the flag.
    t.a.setDisplay([bid('A:0')], 'hidden');
    expect(t.meta('A:0')).toEqual({ name: 'Body1', visible: false });
    // Showing it does the same from the other side.
    t.a.setDisplay([bid('A:0')], 'ghost');
    t.a.setDisplay([bid('A:0')], 'shown');
    expect(t.meta('A:0')).toEqual({ name: 'Body1', visible: true });
    // Nothing to change leaves no undo step.
    const before = t.store.getState().undoLabel;
    t.a.setDisplay([bid('A:0')], 'shown');
    expect(t.store.getState().undoLabel).toBe(before);
  });

  it('ghosts several bodies in one undo step, labelled "Ghost bodies"', () => {
    const t = actions();
    t.a.setDisplay([bid('A:0'), bid('B:0')], 'ghost');
    expect([t.meta('A:0')?.ghost, t.meta('B:0')?.ghost]).toEqual([true, true]);
    expect(t.store.getState().undoLabel).toBe('Ghost bodies');
    t.store.getState().undo();
    expect(t.meta('A:0')).toBeUndefined();
    expect(t.meta('B:0')).toBeUndefined();
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

describe('custom body colours (P3-17)', () => {
  it('reads a typed hex code as the document stores it', () => {
    expect(parseBodyColor('#A1B2C3')).toBe('#a1b2c3');
    expect(parseBodyColor(' a1b2c3 ')).toBe('#a1b2c3');
    expect(parseBodyColor('#f80')).toBe('#ff8800');
    expect(parseBodyColor('#ff88')).toBeUndefined();
    expect(parseBodyColor('orange')).toBeUndefined();
    expect(parseBodyColor('')).toBeUndefined();
  });

  it('tells swatches from custom colours', () => {
    expect(isSwatch('#5b7cff')).toBe(true);
    expect(isSwatch(undefined)).toBe(true);
    expect(isSwatch('#123456')).toBe(false);
  });
});

describe('pendingBodyEntries (ADR-0078)', () => {
  const doc = {
    features: [feature('A'), feature('B')],
    bodies: {
      [bid('B:0')]: { name: 'Lid', visible: false },
      [bid('A:0')]: { name: 'Bracket', visible: true, color: '#c81e28' },
    },
  };
  it('lists the cached bodies with their stored metadata, in timeline order', () => {
    const entries = pendingBodyEntries(doc, ['B:0', 'A:0']);
    expect(entries.map((e) => [e.id, e.meta.name, e.pending, e.stored])).toEqual([
      ['A:0', 'Bracket', true, true],
      ['B:0', 'Lid', true, true],
    ]);
    expect(entries[0]?.meta.color).toBe('#c81e28');
  });
  it('skips an ID with no stored metadata', () => {
    expect(pendingBodyEntries(doc, ['A:0', 'Z:9']).map((e) => e.id)).toEqual(['A:0']);
    expect(pendingBodyEntries(doc, [])).toEqual([]);
  });
});

describe('bodiesEmptyState', () => {
  it('computes only before the first recompute, with features and nothing listed', () => {
    expect(bodiesEmptyState({ listed: 0, finished: false, activeFeatures: 2 })).toBe('computing');
    expect(bodiesEmptyState({ listed: 0, finished: false, activeFeatures: 0 })).toBe('none');
    expect(bodiesEmptyState({ listed: 0, finished: true, activeFeatures: 2 })).toBe('none');
    expect(bodiesEmptyState({ listed: 1, finished: false, activeFeatures: 2 })).toBe('none');
  });
});
