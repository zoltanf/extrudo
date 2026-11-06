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

describe('revertTo (ADR-0111)', () => {
  function threeSteps() {
    const history = new UndoHistory();
    let doc = sampleDocument();
    const ids: number[] = [];
    const docs: ExtrudoDocument[] = [];
    for (const name of ['A', 'B', 'C']) {
      doc = run(history, doc, renameDocument({ name }));
      ids.push(history.lastStepId as number);
      docs.push(doc);
    }
    return { history, doc, ids, docs };
  }

  it('undoes back to a step, and redo brings the rest back', () => {
    const { history, doc, ids, docs } = threeSteps();
    expect(history.canRevertTo(ids[0])).toBe(true);
    let reverted = history.revertTo(doc, ids[0]);
    expect(history.lastStepId).toBe(ids[0]);
    expect(reverted).toEqual(docs[0]);
    reverted = history.redo(history.redo(reverted));
    expect(reverted).toEqual(docs[2]);
  });

  it('undoes every step for undefined, and not when there is none', () => {
    const { history, doc } = threeSteps();
    expect(history.canRevertTo(undefined)).toBe(true);
    expect(history.revertTo(doc, undefined)).toEqual(sampleDocument());
    expect(history.canUndo).toBe(false);
    expect(history.canRevertTo(undefined)).toBe(false);
  });

  it('redoes forward to a step on the redo stack', () => {
    const { history, ids, docs } = threeSteps();
    let doc = history.undo(history.undo(docs[2] as ExtrudoDocument));
    expect(history.canRevertTo(ids[2])).toBe(true);
    doc = history.revertTo(doc, ids[2]);
    expect(history.lastStepId).toBe(ids[2]);
    expect(doc).toEqual(docs[2]);
    expect(history.canRedo).toBe(false);
  });

  it('is false for the latest step and for an unknown id', () => {
    const { history, doc, ids } = threeSteps();
    expect(history.canRevertTo(ids[2])).toBe(false);
    expect(history.canRevertTo(9999)).toBe(false);
    expect(history.revertTo(doc, 9999)).toBe(doc);
  });

  it('does nothing inside a transaction', () => {
    const { history, doc, ids } = threeSteps();
    history.begin('Edit Sketch1');
    expect(history.canRevertTo(ids[0])).toBe(false);
    expect(history.revertTo(doc, ids[0])).toBe(doc);
    expect(history.depth).toBe(1);
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

  it('amendInto joins the step by id even after later steps', () => {
    const history = new UndoHistory();
    const start = sampleDocument();
    let doc = run(history, start, renameDocument({ name: 'A' }));
    const first = history.lastStepId as number;
    doc = run(history, doc, renameDocument({ name: 'B' }));
    expect(history.lastStepId).not.toBe(first);
    const amended = applyCommand(doc, renameFeature({ id: fid('f1'), name: 'Named' }));
    expect(history.amendInto(first, { label: 'Name', ...amended })).toBe(true);
    doc = amended.doc;
    // Undoing B leaves the first rename and the amendment; undoing A takes A only.
    doc = history.undo(doc);
    expect([doc.name, doc.features[0]?.name]).toEqual(['A', 'Named']);
    doc = history.undo(doc);
    expect(doc).toEqual(start);
    expect(history.hasStep(first)).toBe(false);
  });

  it('amendInto and hasStep report false once the step is undone or branched away', () => {
    const history = new UndoHistory();
    let doc = run(history, sampleDocument(), renameDocument({ name: 'A' }));
    const step = history.lastStepId as number;
    expect(history.hasStep(step)).toBe(true);
    doc = history.undo(doc);
    expect(history.hasStep(step)).toBe(false);
    const amended = applyCommand(doc, renameDocument({ name: 'C' }));
    expect(history.amendInto(step, { label: 'Name', ...amended })).toBe(false);
  });

  it('clear drops everything, open transactions included', () => {
    const history = new UndoHistory();
    const doc = run(history, sampleDocument(), renameDocument({ name: 'A' }));
    history.begin('Edit Sketch1');
    run(history, doc, renameDocument({ name: 'B' }));
    history.clear();
    expect([history.depth, history.canUndo, history.canRedo]).toEqual([0, false, false]);
  });
  it('names steps for the recent-actions log: ids, labels, the open transaction (ADR-0127)', () => {
    const history = new UndoHistory();
    const doc = sampleDocument();
    const a = applyCommand(doc, renameDocument({ name: 'A' }));
    const id = history.record({ label: 'Draw', ...a });
    expect(id).toBe(history.lastStepId);
    expect(history.record({ label: 'Nothing', patches: [], inversePatches: [] })).toBeUndefined();
    expect([history.labelOf(id as number), history.undoStepId, history.redoStepId]).toEqual([
      'Draw',
      id,
      undefined,
    ]);
    history.begin('Edit sketch');
    expect([history.transactionLabel, history.undoStepId]).toEqual(['Edit sketch', undefined]);
    expect(history.commit()).toBeUndefined();
    expect(history.transactionLabel).toBeUndefined();
    history.undo(a.doc);
    expect([history.redoStepId, history.labelOf(id as number)]).toEqual([id, undefined]);
  });
});

describe('reopening a sketch session (ADR-0010 amendment, 2026-11-06)', () => {
  /** A session tagged `s1` that renamed the document A then B, committed. */
  function finished() {
    const history = new UndoHistory();
    const start = sampleDocument();
    history.begin('Edit sketch', 's1');
    let doc = run(history, start, renameDocument({ name: 'A' }));
    doc = run(history, doc, renameDocument({ name: 'B' }));
    history.commit();
    return { history, start, doc };
  }

  it('keeps the edits on the step, and reopens it with the document unchanged', () => {
    const { history, doc } = finished();
    expect([history.depth, history.undoLabel, history.reopenTag]).toEqual([0, 'Edit sketch', 's1']);
    expect(history.reopen()).toBe('s1');
    expect([history.depth, history.transactionLabel, history.reopenTag]).toEqual([
      1,
      'Edit sketch',
      undefined,
    ]);
    // Inside, undo takes back one edit at a time.
    let d = history.undo(doc);
    expect(d.name).toBe('A');
    d = history.redo(d);
    expect(d.name).toBe('B');
    // Committed again, the step is reopenable again.
    history.commit();
    expect(history.reopenTag).toBe('s1');
  });

  it('undoes every edit after reopening, and an empty commit leaves no step', () => {
    const { history, start, doc } = finished();
    history.reopen();
    const d = history.undo(history.undo(doc));
    expect(d).toEqual(start);
    expect(history.canUndo).toBe(false);
    expect(history.commit()).toBeUndefined();
    expect(history.canUndo).toBe(false);
  });

  it('keeps the edits in step with a change amended into the step after Finish', () => {
    const { history, start, doc } = finished();
    const amended = applyCommand(doc, renameFeature({ id: fid('f1'), name: 'Later' }));
    history.amend({ label: 'Name', ...amended });
    history.reopen();
    const d = history.undo(history.undo(amended.doc));
    expect(d).toEqual(start);
  });

  it('is not offered for an untagged transaction, nor inside a transaction', () => {
    const history = new UndoHistory();
    history.begin('Dialog');
    const doc = run(history, sampleDocument(), renameDocument({ name: 'A' }));
    history.commit();
    expect(history.reopenTag).toBeUndefined();
    expect(history.reopen()).toBeUndefined();
    expect(history.depth).toBe(0);
    history.begin('Edit sketch', 's1');
    run(history, doc, renameDocument({ name: 'B' }));
    history.commit();
    history.begin('Other');
    expect(history.reopenTag).toBeUndefined();
  });

  it('a plain undo still reverts the whole session, and redo brings it back reopenable', () => {
    const { history, start, doc } = finished();
    const d = history.undo(doc);
    expect(d).toEqual(start);
    expect(history.reopenTag).toBeUndefined();
    expect(history.redo(d).name).toBe('B');
    expect(history.reopenTag).toBe('s1');
  });
});
