import { describe, expect, it, vi } from 'vitest';
import { CommandError } from './commands';
import { createDocument } from './document';
import { renameDocument, renameFeature } from './document-commands';
import { createDocumentStore, createModelStore, createSessionStore } from './stores';
import { bid, fid, sampleDocument } from './testing';

describe('document store', () => {
  it('changes the document only through commands, with undo and redo', () => {
    const store = createDocumentStore(sampleDocument());
    const { dispatch, undo, redo } = store.getState();
    dispatch(renameDocument({ name: 'Bracket' }));
    expect(store.getState()).toMatchObject({
      doc: { name: 'Bracket' },
      canUndo: true,
      canRedo: false,
      undoLabel: 'Rename document',
    });
    undo();
    expect(store.getState()).toMatchObject({
      doc: { name: 'Sample' },
      canUndo: false,
      canRedo: true,
    });
    redo();
    expect(store.getState().doc.name).toBe('Bracket');
  });

  it('amends a change into the latest undo step', () => {
    const store = createDocumentStore(sampleDocument());
    const s = () => store.getState();
    s().amend(renameDocument({ name: 'Loaded' }));
    expect(s()).toMatchObject({ doc: { name: 'Loaded' }, canUndo: false });
    s().dispatch(renameFeature({ id: fid('f1'), name: 'A' }));
    s().amend(renameDocument({ name: 'Bracket' }));
    expect(s()).toMatchObject({ doc: { name: 'Bracket' }, undoLabel: 'Rename feature' });
    s().undo();
    expect(s().doc).toMatchObject({ name: 'Loaded', features: [{ name: 'Sketch1' }, {}, {}] });
    s().redo();
    expect(s().doc.name).toBe('Bracket');
  });

  it('freezes the document so components cannot mutate it', () => {
    const store = createDocumentStore(sampleDocument());
    expect(Object.isFrozen(store.getState().doc.features[0])).toBe(true);
    store.getState().dispatch(renameDocument({ name: 'Bracket' }));
    expect(Object.isFrozen(store.getState().doc)).toBe(true);
  });

  it('notifies subscribers once per change and not for a failed command', () => {
    const store = createDocumentStore(sampleDocument());
    const listener = vi.fn();
    store.subscribe(listener);
    store.getState().dispatch(renameDocument({ name: 'Bracket' }));
    expect(listener).toHaveBeenCalledTimes(1);
    expect(() => store.getState().dispatch(renameFeature({ id: fid('x'), name: 'y' }))).toThrow(
      CommandError,
    );
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('runs transactions: commit makes one step, cancel reverts', () => {
    const store = createDocumentStore(sampleDocument());
    const s = () => store.getState();
    s().beginTransaction('Edit Sketch1');
    expect(s().transactionDepth).toBe(1);
    s().dispatch(renameFeature({ id: fid('f1'), name: 'A' }));
    s().dispatch(renameFeature({ id: fid('f1'), name: 'B' }));
    s().commitTransaction();
    expect(s()).toMatchObject({ transactionDepth: 0, undoLabel: 'Edit Sketch1' });
    s().undo();
    expect(s().doc.features[0]?.name).toBe('Sketch1');

    s().beginTransaction('Edit Sketch1');
    s().dispatch(renameFeature({ id: fid('f1'), name: 'C' }));
    s().cancelTransaction();
    expect(s().doc.features[0]?.name).toBe('Sketch1');
    expect(s()).toMatchObject({ transactionDepth: 0, canRedo: true });
  });

  it('replacing the document clears the history', () => {
    const store = createDocumentStore(sampleDocument());
    store.getState().dispatch(renameDocument({ name: 'Bracket' }));
    const other = createDocument({ name: 'Other' });
    store.getState().replaceDocument(other);
    expect(store.getState()).toMatchObject({ doc: { name: 'Other' }, canUndo: false });
  });
});

describe('session store', () => {
  const face = (id: string) => ({ kind: 'face' as const, id });

  it('replaces, adds to and toggles the selection', () => {
    const store = createSessionStore();
    const { select } = store.getState();
    select([face('a'), face('b'), face('a')]);
    expect(store.getState().selection).toEqual([face('a'), face('b')]);
    select([face('c'), face('a')], 'add');
    expect(store.getState().selection).toEqual([face('a'), face('b'), face('c')]);
    select([face('b'), face('d')], 'toggle');
    expect(store.getState().selection).toEqual([face('a'), face('c'), face('d')]);
    store.getState().clearSelection();
    expect(store.getState().selection).toEqual([]);
  });

  it('enters and leaves sketch mode with a clean tool and selection', () => {
    const store = createSessionStore();
    store.getState().select([face('a')]);
    store.getState().setTool('extrude');
    store.getState().enterSketch(fid('f1'));
    expect(store.getState()).toMatchObject({
      mode: 'sketch',
      activeSketchId: 'f1',
      activeTool: undefined,
      selection: [],
    });
    store.getState().exitSketch();
    expect(store.getState()).toMatchObject({ mode: 'model', activeSketchId: undefined });
  });

  it('only notifies when the hovered item really changes', () => {
    const store = createSessionStore();
    const listener = vi.fn();
    store.subscribe(listener);
    store.getState().setHover(face('a'));
    store.getState().setHover(face('a'));
    store.getState().setHover(undefined);
    store.getState().setHover(undefined);
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

describe('model store', () => {
  it('tracks recompute status and results', () => {
    const store = createModelStore<{ triangles: number }>();
    expect(store.getState().status).toBe('idle');
    store.getState().computing();
    expect(store.getState().status).toBe('computing');
    const features = { [fid('f1')]: { status: 'ok' as const } };
    const bodies = { [bid('b1')]: { triangles: 12 } };
    store.getState().computed({ features, bodies });
    expect(store.getState()).toMatchObject({ status: 'ready', features, bodies });
    store.getState().failed('The geometry kernel crashed.');
    expect(store.getState()).toMatchObject({
      status: 'failed',
      error: 'The geometry kernel crashed.',
      bodies,
    });
    store.getState().reset();
    expect(store.getState()).toMatchObject({ status: 'idle', features: {}, bodies: {} });
  });
});
