import { describe, expect, it } from 'vitest';
import { applyCommand, type Command } from './commands';
import { renameDocument, renameFeature, setFeatureSuppressed } from './document-commands';
import { UndoHistory } from './history';
import type { ExtrudoDocument } from './schema';
import { fid, sampleDocument } from './testing';

function run(history: UndoHistory, doc: ExtrudoDocument, command: Command<unknown>) {
  const result = applyCommand(doc, command);
  history.record({ label: command.label, ...result });
  return result.doc;
}

describe('UndoHistory', () => {
  it('starts empty and reports labels of the next undo and redo', () => {
    const history = new UndoHistory();
    expect([history.canUndo, history.canRedo, history.undoLabel, history.depth]).toEqual([
      false,
      false,
      undefined,
      0,
    ]);
    let doc = run(history, sampleDocument(), renameDocument({ name: 'A' }));
    expect(history.undoLabel).toBe('Rename document');
    doc = history.undo(doc);
    expect(history.redoLabel).toBe('Rename document');
    expect(history.canUndo).toBe(false);
    expect(history.undo(doc)).toBe(doc);
  });

  it('drops the redo steps when a new change is recorded', () => {
    const history = new UndoHistory();
    let doc = run(history, sampleDocument(), renameDocument({ name: 'A' }));
    doc = history.undo(doc);
    run(history, doc, renameDocument({ name: 'B' }));
    expect(history.canRedo).toBe(false);
  });

  it('ignores changes that changed nothing', () => {
    const history = new UndoHistory();
    run(history, sampleDocument(), renameDocument({ name: 'Sample' }));
    expect(history.canUndo).toBe(false);
  });

  it('keeps at most `limit` steps', () => {
    const history = new UndoHistory({ limit: 3 });
    let doc = sampleDocument();
    for (const name of ['A', 'B', 'C', 'D', 'E']) doc = run(history, doc, renameDocument({ name }));
    for (let i = 0; i < 5; i++) doc = history.undo(doc);
    expect(doc.name).toBe('B');
  });
});

describe('transactions', () => {
  it('undo inside a transaction only steps through its own changes', () => {
    const history = new UndoHistory();
    let doc = run(history, sampleDocument(), renameDocument({ name: 'Before sketch' }));
    history.begin('Edit Sketch1');
    expect(history.canUndo).toBe(false);
    doc = run(history, doc, renameFeature({ id: fid('f1'), name: 'S-a' }));
    doc = run(history, doc, renameFeature({ id: fid('f1'), name: 'S-b' }));
    doc = history.undo(doc);
    doc = history.undo(doc);
    expect(doc.features[0]?.name).toBe('Sketch1');
    expect(history.canUndo).toBe(false);
    expect(doc.name).toBe('Before sketch');
    doc = history.redo(doc);
    expect(doc.features[0]?.name).toBe('S-a');
  });

  it('commit collapses the transaction into one undo step', () => {
    const history = new UndoHistory();
    const start = sampleDocument();
    history.begin('Edit Sketch1');
    let doc = run(history, start, renameFeature({ id: fid('f1'), name: 'S-a' }));
    doc = run(history, doc, setFeatureSuppressed({ id: fid('f1'), suppressed: true }));
    doc = run(history, doc, renameFeature({ id: fid('f1'), name: 'S-b' }));
    doc = history.undo(doc); // back to S-a, suppressed; the S-b step is dropped on commit
    history.commit();
    const committed = doc;

    expect(history.depth).toBe(0);
    expect(history.undoLabel).toBe('Edit Sketch1');
    expect(history.canRedo).toBe(false);
    doc = history.undo(doc);
    expect(doc).toEqual(start);
    expect(history.canUndo).toBe(false);
    expect(history.redo(doc)).toEqual(committed);
  });

  it('an empty transaction leaves no step', () => {
    const history = new UndoHistory();
    history.begin('Edit Sketch1');
    history.commit();
    expect(history.canUndo).toBe(false);
  });

  it('cancel reverts the transaction and keeps the outer history', () => {
    const history = new UndoHistory();
    const outer = run(history, sampleDocument(), renameDocument({ name: 'Outer' }));
    history.begin('Edit Sketch1');
    let doc = run(history, outer, renameFeature({ id: fid('f1'), name: 'S-a' }));
    doc = run(history, doc, renameFeature({ id: fid('f2'), name: 'E-a' }));
    doc = history.cancel(doc);
    expect(doc).toEqual(outer);
    expect(history.undoLabel).toBe('Rename document');
  });

  it('nest: an inner commit becomes one step of the outer transaction', () => {
    const history = new UndoHistory();
    const start = sampleDocument();
    history.begin('Extrude dialog');
    let doc = run(history, start, renameFeature({ id: fid('f2'), name: 'Base' }));
    history.begin('Edit Sketch1');
    doc = run(history, doc, renameFeature({ id: fid('f1'), name: 'S-a' }));
    doc = run(history, doc, renameFeature({ id: fid('f1'), name: 'S-b' }));
    history.commit();
    expect(history.depth).toBe(1);
    expect(history.undoLabel).toBe('Edit Sketch1');
    doc = history.undo(doc);
    expect(doc.features.map((f) => f.name)).toEqual(['Sketch1', 'Base', 'Fillet1']);
    doc = history.redo(doc);
    history.commit();
    expect(history.undoLabel).toBe('Extrude dialog');
    expect(history.undo(doc)).toEqual(start);
  });

  it('closing without an open transaction is a bug', () => {
    const history = new UndoHistory();
    expect(() => history.commit()).toThrow('No transaction is open.');
    expect(() => history.cancel(sampleDocument())).toThrow('No transaction is open.');
  });

  it('amend adds a change to the latest step, so undo and redo take it along', () => {
    const history = new UndoHistory();
    const start = sampleDocument();
    let doc = run(history, start, renameDocument({ name: 'A' }));
    const amended = applyCommand(doc, renameFeature({ id: fid('f1'), name: 'Named' }));
    expect(history.amend({ label: 'Name', ...amended })).toBe(true);
    doc = amended.doc;
    expect(history.undoLabel).toBe('Rename document');
    const undone = history.undo(doc);
    expect(undone).toEqual(start);
    expect(history.redo(undone)).toEqual(doc);
  });

  it('amend joins the enclosing step while a transaction has none, and keeps redo', () => {
    const history = new UndoHistory();
    let doc = run(history, sampleDocument(), renameDocument({ name: 'A' }));
    doc = run(history, doc, renameDocument({ name: 'B' }));
    doc = history.undo(doc);
    history.begin('Edit Sketch1');
    const amended = applyCommand(doc, renameFeature({ id: fid('f1'), name: 'Named' }));
    history.amend({ label: 'Name', ...amended });
    doc = history.cancel(amended.doc);
    // The change belongs to the step before the transaction: cancel leaves it.
    expect(doc.features[0]?.name).toBe('Named');
    expect(history.canRedo).toBe(true);
    doc = history.undo(doc);
    expect([doc.name, doc.features[0]?.name]).toEqual(['Sample', 'Sketch1']);
  });

  it('amend with no step records nothing', () => {
    const history = new UndoHistory();
    const amended = applyCommand(sampleDocument(), renameDocument({ name: 'A' }));
    expect(history.amend({ label: 'Name', ...amended })).toBe(false);
    expect(history.canUndo).toBe(false);
  });

  it('clear drops everything, open transactions included', () => {
    const history = new UndoHistory();
    const doc = run(history, sampleDocument(), renameDocument({ name: 'A' }));
    history.begin('Edit Sketch1');
    run(history, doc, renameDocument({ name: 'B' }));
    history.clear();
    expect([history.depth, history.canUndo, history.canRedo]).toEqual([0, false, false]);
  });
});
