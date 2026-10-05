// The Import dialog (P4-06, ADR-0066 §0, §2): the file it read is a read-only
// line, `Units` is there for a mesh only, `Up` turns a Y-up file, and OK adds
// the attachment record and the feature as one undo step.
import {
  type AttachmentId,
  type ExtrudoDocument,
  type Feature,
  ImportInputsSchema,
  importInputs,
  newId,
} from '@extrudo/core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  clearPendingImport,
  formatSize,
  importDialog,
  importedFile,
  type PendingImport,
  pendingImportStore,
} from './import';
import { featureDialogs, specForCommand } from './registry';
import {
  evaluateOverride,
  overrideInputs,
  overrideIssue,
  overrideValues,
  rowOrder,
  SCAD_ORDER,
} from './scadRows';
import type { DialogContext, DialogValues } from './spec';
import { setupDialogs } from './testing';
import { shownFields } from './values';

const pick = (
  fileName: string,
  mediaType: PendingImport['attachment']['mediaType'] = 'model/step',
) => {
  const pending = {
    id: newId<AttachmentId>(),
    attachment: {
      name: fileName.replace(/\..*$/, ''),
      fileName,
      mediaType,
      sha256: 'b'.repeat(64),
      size: 30_906,
    },
  };
  pendingImportStore.setState({ pending });
  return pending;
};

afterEach(() => clearPendingImport());

describe('the Import dialog', () => {
  it("is the app's dialog for the importBody command", () => {
    expect(specForCommand(featureDialogs(), 'importBody')?.type).toBe('import');
  });

  it('names the file it reads and shows no Units for a STEP file', () => {
    const pending = pick('b3.step');
    const t = setupDialogs([importDialog]);
    t.controller.start('import');
    const values = (t.open()?.values ?? {}) as DialogValues;
    const ctx = contextOf(emptyDocument(), pending);
    expect(shownFields(importDialog, values, ctx).map((f) => f.name)).toEqual(['file', 'up']);
    // The file is a read-only line: it fills no input and takes no picks.
    expect(importDialog.fields[0]).toMatchObject({ kind: 'info', name: 'file', label: 'File' });
    expect(importedFile(ctx)).toEqual(pending);
    expect(importDialog.toInputs?.(values, ctx)).toEqual({
      file: { kind: 'file', id: pending.id },
      up: { kind: 'enum', value: 'z' },
    });
  });

  it('shows Units for a mesh file, which the dialog turns into an input', () => {
    const pending = pick('bracket.stl', 'model/stl');
    const t = setupDialogs([importDialog]);
    t.controller.start('import');
    const open = t.open();
    const ctx = contextOf(emptyDocument(), pending);
    const values = (open?.values ?? {}) as DialogValues;
    expect(shownFields(importDialog, values, ctx).map((f) => f.name)).toEqual([
      'file',
      'units',
      'up',
    ]);
    t.controller.setChoice('units', 'in');
    t.controller.setChoice('up', 'y');
    const inputs = t.open()?.draft.inputs;
    expect(ImportInputsSchema.safeParse(inputs).success).toBe(true);
    expect(inputs).toMatchObject({
      file: { kind: 'file', id: pending.id },
      units: { kind: 'enum', value: 'in' },
      up: { kind: 'enum', value: 'y' },
    });
  });

  it('adds the attachment record and the feature as one undo step', () => {
    const pending = pick('b3.step');
    const t = setupDialogs([importDialog]);
    t.controller.start('import');
    expect(ImportInputsSchema.safeParse(t.open()?.draft.inputs).success).toBe(true);
    expect(t.controller.ok()).toBe(true);
    const doc = t.store.getState().doc;
    expect(doc.features.at(-1)).toMatchObject({ type: 'import', name: 'Import1' });
    expect(doc.attachments?.[pending.id]).toEqual(pending.attachment);
    // One step: undo takes the feature and the file's record away together.
    t.store.getState().undo();
    expect(t.store.getState().doc.features.some((f) => f.type === 'import')).toBe(false);
    expect(t.store.getState().doc.attachments).toBeUndefined();
    t.store.getState().redo();
    expect(t.store.getState().doc.features.some((f) => f.type === 'import')).toBe(true);
    expect(t.store.getState().doc.attachments?.[pending.id]).toEqual(pending.attachment);
  });

  it('edits a stored import without adding the file again', () => {
    const pending = pick('b3.step');
    const t = setupDialogs([importDialog]);
    t.controller.start('import');
    t.controller.ok();
    const id = t.store.getState().doc.features.at(-1)?.id;
    if (!id) throw new Error('no feature');
    t.controller.edit(id);
    // The edited dialog reads the file from the document, not from the picker.
    clearPendingImport();
    const feature = t.store.getState().doc.features.find((f) => f.id === id);
    if (!feature) throw new Error('no feature');
    expect(importedFile(contextOf(t.store.getState().doc, pending, feature))).toEqual(pending);
    expect(t.open()?.values.choices.up).toBe('z');
    t.controller.setChoice('up', 'y');
    expect(t.controller.ok()).toBe(true);
    expect(t.store.getState().doc.features.at(-1)?.inputs.up).toEqual({
      kind: 'enum',
      value: 'y',
    });
    // Editing is one step too, and the record is not added twice.
    expect(Object.keys(t.store.getState().doc.attachments ?? {})).toEqual([pending.id]);
    t.store.getState().undo();
    expect(t.store.getState().doc.features.at(-1)?.inputs.up).toEqual({
      kind: 'enum',
      value: 'z',
    });
  });

  it('refuses OK without a file', () => {
    const t = setupDialogs([importDialog]);
    t.controller.start('import');
    expect(t.open()?.checked.first?.message).toBe('Pick a file to import.');
    expect(t.controller.ok()).toBe(false);
    expect(t.store.getState().doc.features.some((f) => f.type === 'import')).toBe(false);
  });

  it('shows a file size the way the dialog reads it', () => {
    expect(formatSize(512)).toBe('512 B');
    expect(formatSize(30_906)).toBe('30 kB');
    expect(formatSize(2.5 * 1024 * 1024)).toBe('2.5 MB');
  });
});

describe("the Import dialog's OpenSCAD rows (P5-04 slice 2)", () => {
  const values = (exprs: Record<string, string>, order: string[]): DialogValues => ({
    refs: {},
    exprs,
    choices: {},
    toggles: {},
    labels: { [SCAD_ORDER]: order },
  });

  it('names an OpenSCAD file in the info line and turns rows into packed pairs', () => {
    const pending = pick('gear.scad', 'application/x-openscad');
    const t = setupDialogs([importDialog]);
    t.controller.start('import');
    const ctx = contextOf(emptyDocument(), pending);
    const info = importDialog.fields[0];
    expect(info?.kind === 'info' && info.text(t.open()?.values as DialogValues, ctx)).toBe(
      'gear.scad · 30 kB · OpenSCAD',
    );
    // The list arrived: the rows' order is the file's.
    t.controller.setLabels(SCAD_ORDER, ['width', 'depth', 'holes']);
    t.controller.setExpr('scad:width', '60');
    t.controller.setExpr('scad:holes', '3');
    let inputs = t.open()?.draft.inputs;
    expect(ImportInputsSchema.safeParse(inputs).success).toBe(true);
    expect(inputs).toMatchObject({
      scadName: { kind: 'enum', value: 'width' },
      scadValue: { kind: 'expr', expr: '60', unit: 'unitless' },
      scadName2: { kind: 'enum', value: 'holes' },
      scadValue2: { kind: 'expr', expr: '3', unit: 'unitless' },
    });
    // Emptying a row takes its pair out, and the others move up: no hole.
    t.controller.setExpr('scad:width', '');
    inputs = t.open()?.draft.inputs;
    expect(inputs).toMatchObject({
      scadName: { kind: 'enum', value: 'holes' },
      scadValue: { kind: 'expr', expr: '3', unit: 'unitless' },
    });
    expect(inputs?.scadName2).toBeUndefined();
    expect(inputs?.scadValue2).toBeUndefined();
    expect(t.controller.ok()).toBe(true);
    expect(t.store.getState().doc.features.at(-1)?.inputs.scadName).toEqual({
      kind: 'enum',
      value: 'holes',
    });
  });

  it("stores each value with the unit its expression has, a parameter's own", () => {
    const doc: ExtrudoDocument = {
      ...emptyDocument(),
      parameters: [
        { id: 'p1' as never, name: 'plateWidth', expression: '60 mm', unit: 'length' },
        { id: 'p2' as never, name: 'count', expression: '4', unit: 'unitless' },
      ],
    };
    const inputs = overrideInputs(
      values(
        { 'scad:width': 'plateWidth', 'scad:holes': 'count', 'scad:tilt': '30 deg', 'scad:n': '3' },
        ['width', 'holes', 'tilt', 'n'],
      ),
      doc,
    );
    expect(Object.values(inputs).filter((i) => i.kind === 'expr')).toEqual([
      { kind: 'expr', expr: 'plateWidth', unit: 'length' },
      { kind: 'expr', expr: 'count', unit: 'unitless' },
      { kind: 'expr', expr: '30 deg', unit: 'angle' },
      { kind: 'expr', expr: '3', unit: 'unitless' },
    ]);
    // In an inch document a plain number is still the number OpenSCAD gets.
    const inch = { ...doc, settings: { units: 'in' as const, precision: 2 } };
    expect(evaluateOverride(inch, '24')).toMatchObject({ unit: 'unitless', result: { value: 24 } });
    expect(evaluateOverride(inch, 'plateWidth')).toMatchObject({ unit: 'length' });
    expect(overrideIssue(values({ 'scad:width': 'plateWidht' }, ['width']), doc)?.message).toMatch(
      /^width: /,
    );
  });

  it("reads stored pairs back as rows, and keeps the file's order with stored extras last", () => {
    const stored = importInputs({
      file: 'f' as AttachmentId,
      overrides: [
        { name: 'holes', value: '3' },
        { name: 'gone', value: '2' },
        { name: 'width', value: 'plateWidth', unit: 'length' },
      ],
    });
    const read = overrideValues(stored);
    expect(read.exprs).toEqual({ 'scad:holes': '3', 'scad:gone': '2', 'scad:width': 'plateWidth' });
    expect(read.labels?.[SCAD_ORDER]).toEqual(['holes', 'gone', 'width']);
    // The file's list: numbers become rows, a string or a boolean is read only (no row order).
    const list = [
      { name: 'width', type: 'number', initial: 40 },
      { name: 'depth', type: 'number', initial: 30 },
      { name: 'holes', type: 'number', initial: 2 },
      { name: 'label', type: 'string', initial: 'plate' },
      { name: 'size', type: 'number', initial: [1, 2] },
    ];
    expect(rowOrder(list, ['holes', 'gone', 'width'])).toEqual(['width', 'depth', 'holes', 'gone']);
    expect(rowOrder(undefined, ['holes', 'gone'])).toEqual(['holes', 'gone']);
    // Editing: the dialog's values hold the rows.
    const t = setupDialogs([importDialog]);
    const pending = pick('gear.scad', 'application/x-openscad');
    t.controller.start('import');
    t.controller.setLabels(SCAD_ORDER, ['width', 'holes']);
    t.controller.setExpr('scad:holes', '5');
    t.controller.ok();
    const id = t.store.getState().doc.features.at(-1)?.id;
    clearPendingImport();
    if (!id) throw new Error('no feature');
    t.controller.edit(id);
    expect(t.open()?.values.exprs['scad:holes']).toBe('5');
    expect(t.open()?.values.labels[SCAD_ORDER]).toEqual(['holes']);
    expect(t.store.getState().doc.attachments?.[pending.id]).toBeDefined();
  });
});

/** A dialog context over a document with one attachment, as the framework builds it. */
function contextOf(
  _doc: ExtrudoDocument,
  pending: PendingImport,
  feature?: Feature,
): DialogContext {
  return {
    doc: {
      ...emptyDocument(),
      attachments: { [pending.id]: pending.attachment },
      ...(feature && { features: [feature] }),
    },
    bodies: {},
    ...(feature && { feature }),
  };
}

/** A document with nothing in it but `id`, as a new design's. */
function emptyDocument(): ExtrudoDocument {
  return {
    format: 'extrudo',
    formatVersion: 1,
    id: 'd1' as ExtrudoDocument['id'],
    name: 'Design',
    settings: { units: 'mm', precision: 2 },
    parameters: [],
    features: [],
    timelineMarker: 0,
    bodies: {},
    views: [],
    meta: {
      created: '2026-10-04T00:00:00.000Z',
      modified: '2026-10-04T00:00:00.000Z',
      appVersion: '0.4.0',
    },
  };
}
