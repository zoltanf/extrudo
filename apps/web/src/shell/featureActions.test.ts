import {
  createDocument,
  createDocumentStore,
  createModelStore,
  createSessionStore,
  type FeatureId,
  type GeomRef,
  originPlaneRef,
  readSketch,
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
    model: createModelStore<unknown>(),
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

  it("open another feature's dialog, if its type has one (P2-05)", () => {
    const t = setup();
    const opened: FeatureId[] = [];
    const actions = createFeatureActions(t, () => {}, {
      exportSketch: () => {},
      editFeature: (id) => {
        opened.push(id);
        return true;
      },
      hasDialog: (type) => type === 'press',
    });
    const press = { id: 'p' as FeatureId, type: 'press', name: 'P', suppressed: false, inputs: {} };
    const other = { ...press, id: 'q' as FeatureId, type: 'fillet' };
    t.store.setState({
      doc: { ...t.s().doc, features: [...t.s().doc.features, press, other], timelineMarker: 4 },
    });
    expect(actions.canEdit(press, 2, 4)).toBe(true);
    expect(actions.canEdit(other, 3, 4)).toBe(false);
    expect(actions.canEdit(t.feature(t.a) as never, 0, 4)).toBe(true);
    expect(actions.edit(press.id)).toBe(true);
    expect(opened).toEqual(['p']);
    // Not while a sketch is open.
    actions.edit(t.a);
    expect(actions.edit(press.id)).toBe(false);
    expect(opened).toEqual(['p']);
  });

  it('roll the marker and move features, one step each, refused while a sketch is open (P2-11)', () => {
    const t = setup();
    t.actions.rollTo(1);
    expect(t.s().doc.timelineMarker).toBe(1);
    expect(t.s().undoLabel).toBe('Move timeline marker');
    // Rolled back already: no step.
    t.actions.rollTo(1);
    t.s().undo();
    expect(t.s().doc.timelineMarker).toBe(2);
    expect(t.actions.moveProblem(t.b, 0)).toBeUndefined();
    expect(t.actions.move(t.b, 0)).toBe(true);
    expect(t.s().doc.features.map((f) => f.id)).toEqual([t.b, t.a]);
    expect(t.s().undoLabel).toBe('Move feature');
    t.actions.edit(t.a);
    expect(t.actions.moveProblem(t.b, 1)).toBe('Finish the sketch first.');
    expect(t.actions.move(t.b, 1)).toBe(false);
    t.actions.rollTo(0);
    expect(t.s().doc.timelineMarker).toBe(2);
    expect(t.messages).toEqual([
      'info: Finish the sketch first.',
      'info: Finish the sketch first.',
    ]);
  });

  it('fix references: redefine a lost plane, open a dialog, keep closest matches', () => {
    const t = setup();
    const fixed: string[] = [];
    const actions = createFeatureActions(t, (tone, text) => t.messages.push(`${tone}: ${text}`), {
      exportSketch: () => {},
      fixFeature: (id, issues) => {
        fixed.push(`dialog ${id} ${issues.length}`);
        return true;
      },
      redefinePlane: (id) => fixed.push(`plane ${id}`),
    });
    const plane = readSketch(t.feature(t.a) as never)?.plane as GeomRef;
    const now: GeomRef = { kind: 'plane', id: 'origin:yz' };
    t.model.getState().computed({
      features: {
        [t.a]: { status: 'warning', refs: [{ ref: plane, state: 'guessed', now }] },
      },
      bodies: {},
    });
    expect(actions.issues(t.a)).toHaveLength(1);
    expect(actions.issues(t.b)).toEqual([]);
    actions.fix(t.a);
    actions.fix(t.b);
    expect(fixed).toEqual([`plane ${t.a}`]);
    actions.keepClosest(t.a);
    expect(readSketch(t.feature(t.a) as never)?.plane).toEqual(now);
    expect(t.s().undoLabel).toBe('Fix references');

    const press = { id: 'p' as FeatureId, type: 'press', name: 'P', suppressed: false, inputs: {} };
    t.store.setState({
      doc: { ...t.s().doc, features: [...t.s().doc.features, press], timelineMarker: 3 },
    });
    t.model.getState().computed({
      features: { p: { status: 'error', refs: [{ ref: plane, state: 'lost' }] } } as never,
      bodies: {},
    });
    actions.fix(press.id);
    expect(fixed).toEqual([`plane ${t.a}`, 'dialog p 1']);
    actions.redefinePlane(t.b);
    expect(fixed.at(-1)).toBe(`plane ${t.b}`);
  });

  it('export opens the dialog for the sketch', () => {
    const t = setup();
    const opened: FeatureId[] = [];
    const actions = createFeatureActions(t, () => {}, { exportSketch: (id) => opened.push(id) });
    actions.exportSketch(t.b);
    expect(opened).toEqual([t.b]);
  });
});
