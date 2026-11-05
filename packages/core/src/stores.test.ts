import { describe, expect, it, vi } from 'vitest';
import { CommandError } from './commands';
import { createDocument } from './document';
import { renameDocument, renameFeature } from './document-commands';
import type { HistoryEvent } from './history';
import type { ComponentId } from './ids';
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
    // With `relabel` the step takes the amending command's label (P4-12: an include).
    s().amend({ ...renameDocument({ name: 'Box' }), label: 'Include 3 curves' }, { relabel: true });
    expect(s()).toMatchObject({ doc: { name: 'Box' }, undoLabel: 'Include 3 curves' });
  });

  it('reverts to a step in one change (ADR-0111)', () => {
    const store = createDocumentStore(sampleDocument());
    const s = () => store.getState();
    s().dispatch(renameDocument({ name: 'A' }));
    const a = s().lastStepId();
    s().dispatch(renameDocument({ name: 'B' }));
    s().dispatch(renameDocument({ name: 'C' }));
    const listener = vi.fn();
    store.subscribe(listener);
    expect(s().canRevertTo(a)).toBe(true);
    expect(s().revertTo(a)).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(s()).toMatchObject({ doc: { name: 'A' }, canRedo: true });
    expect(s().revertTo(a)).toBe(false);
    expect(listener).toHaveBeenCalledTimes(1);
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

  it('reports each history change: new step, joined step, undo, redo (ADR-0127)', () => {
    const store = createDocumentStore(sampleDocument());
    const s = () => store.getState();
    const events: HistoryEvent[] = [];
    const stop = s().subscribeHistory((e) => events.push(e));

    s().dispatch(renameFeature({ id: fid('f1'), name: 'A' }));
    const first = s().lastStepId();
    expect(events.at(-1)).toEqual({
      type: 'dispatch',
      command: 'feature.rename',
      label: 'Rename feature',
      step: first,
    });
    // A command that changes nothing makes no step: `step` is undefined.
    s().dispatch(renameFeature({ id: fid('f1'), name: 'A' }));
    expect(events.at(-1)).toMatchObject({ type: 'dispatch', step: undefined });

    // `amend` joins the latest step and names it (PR #199's bug: a dimension in "Draw").
    s().amend(renameDocument({ name: 'B' }));
    expect(events.at(-1)).toEqual({
      type: 'amend',
      command: 'document.rename',
      label: 'Rename document',
      into: undefined,
      changed: true,
      step: first,
      stepLabel: 'Rename feature',
      relabel: false,
    });
    s().amend(renameDocument({ name: 'C' }), { relabel: true });
    expect(events.at(-1)).toMatchObject({ step: first, stepLabel: 'Rename document' });

    // `amendInto` names the step asked for, even when it is not the latest.
    s().dispatch(renameFeature({ id: fid('f1'), name: 'D' }));
    const second = s().lastStepId();
    s().amendInto(first as number, renameDocument({ name: 'E' }));
    expect(events.at(-1)).toMatchObject({
      type: 'amend',
      into: first,
      changed: true,
      step: first,
      stepLabel: 'Rename document',
    });

    s().undo();
    expect(events.at(-1)).toEqual({ type: 'undo', step: second, label: 'Rename feature' });
    // A gone step: `amendInto` drops the change and says so with `step` undefined.
    s().amendInto(second as number, renameDocument({ name: 'F' }));
    expect(events.at(-1)).toMatchObject({ into: second, changed: true, step: undefined });
    expect(s().doc.name).toBe('E');
    s().redo();
    expect(events.at(-1)).toEqual({ type: 'redo', step: second, label: 'Rename feature' });

    stop();
    s().dispatch(renameFeature({ id: fid('f1'), name: 'G' }));
    expect(events.at(-1)).toMatchObject({ type: 'redo' });
  });

  it('reports transactions, an empty amend and a missing step (ADR-0127)', () => {
    const store = createDocumentStore(sampleDocument());
    const s = () => store.getState();
    const events: HistoryEvent[] = [];
    s().subscribeHistory((e) => events.push(e));
    // No step to join on a fresh document: applied without one.
    s().amend(renameDocument({ name: 'Loaded' }));
    expect(events.at(-1)).toMatchObject({ type: 'amend', changed: true, step: undefined });
    s().amend(renameDocument({ name: 'Loaded' }));
    expect(events.at(-1)).toMatchObject({ type: 'amend', changed: false });
    s().undo();
    expect(events.at(-1)).toEqual({ type: 'undo', step: undefined, label: undefined });

    s().beginTransaction('Edit sketch');
    expect(events.at(-1)).toEqual({ type: 'begin', label: 'Edit sketch', depth: 1 });
    s().dispatch(renameFeature({ id: fid('f1'), name: 'A' }));
    const inner = s().lastStepId();
    s().commitTransaction();
    const outer = s().lastStepId();
    expect(outer).not.toBe(inner);
    expect(events.at(-1)).toEqual({ type: 'commit', label: 'Edit sketch', step: outer, depth: 0 });
    s().beginTransaction('Move');
    s().commitTransaction();
    expect(events.at(-1)).toMatchObject({ type: 'commit', label: 'Move', step: undefined });
    s().beginTransaction('Radius');
    s().cancelTransaction();
    expect(events.at(-1)).toEqual({ type: 'cancel', label: 'Radius', depth: 0 });
    s().revertTo(undefined);
    expect(events.at(-1)).toEqual({ type: 'revert', target: undefined, changed: true });
    s().replaceDocument(sampleDocument());
    expect(events.at(-1)).toEqual({ type: 'replace' });
  });

  it('a listener that throws never blocks the change (ADR-0127)', () => {
    const store = createDocumentStore(sampleDocument());
    store.getState().subscribeHistory(() => {
      throw new Error('broken logger');
    });
    store.getState().dispatch(renameDocument({ name: 'Bracket' }));
    expect(store.getState().doc.name).toBe('Bracket');
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

  it('resets the Slice side when a sketch opens or closes (P4-12)', () => {
    const store = createSessionStore();
    store.getState().enterSketch(fid('f1'));
    store.getState().setSketchSliceFlip(-1);
    expect(store.getState().sketchSliceFlip).toBe(-1);
    // Another sketch opens: the removed side is decided afresh for it.
    store.getState().enterSketch(fid('f2'));
    expect(store.getState().sketchSliceFlip).toBeUndefined();
    store.getState().setSketchSliceFlip(1);
    store.getState().exitSketch();
    expect(store.getState().sketchSliceFlip).toBeUndefined();
  });

  it('keeps the active and isolated component across sketch mode (P6-05 S4)', () => {
    const store = createSessionStore();
    const lid = 'c1' as ComponentId;
    store.getState().activateComponent(lid);
    store.getState().isolateComponent(lid);
    store.getState().enterSketch(fid('f1'));
    expect(store.getState()).toMatchObject({ activeComponent: lid, isolatedComponent: lid });
    store.getState().exitSketch();
    expect(store.getState()).toMatchObject({ activeComponent: lid, isolatedComponent: lid });
    store.getState().activateComponent(undefined);
    expect(store.getState()).toMatchObject({ activeComponent: undefined, isolatedComponent: lid });
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

  it('tracks recompute progress, cleared by a result and by a failure (ADR-0105 §3)', () => {
    const store = createModelStore<{ triangles: number }>();
    const feature = fid('f1');
    store.getState().computing();
    expect(store.getState().progress).toBeUndefined();
    store.getState().setProgress({ done: 1, total: 3, feature });
    expect(store.getState().progress).toEqual({ done: 1, total: 3, feature });
    store.getState().computed({ features: {}, bodies: {} });
    expect(store.getState().progress).toBeUndefined();
    store.getState().setProgress({ done: 2, total: 3, feature });
    store.getState().failed('The geometry kernel crashed.');
    expect(store.getState().progress).toBeUndefined();
    store.getState().setProgress({ done: 2, total: 3, feature });
    store.getState().reset();
    expect(store.getState().progress).toBeUndefined();
  });
});
