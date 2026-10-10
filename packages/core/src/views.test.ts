import { describe, expect, it } from 'vitest';
import { applyCommand, type Command } from './commands';
import {
  defaultViewName,
  removeView,
  restoreVersion,
  saveView,
  uniqueViewName,
  updateView,
} from './document-commands';
import { UndoHistory } from './history';
import type { ViewId } from './ids';
import { DocumentSchema, type ExtrudoDocument, type ViewCamera } from './schema';
import { sampleDocument } from './testing';

const vid = (id: string) => id as ViewId;
const apply = (doc: ExtrudoDocument, command: Command<unknown>) => applyCommand(doc, command).doc;

const camera: ViewCamera = {
  projection: 'perspective',
  position: [100, -100, 100],
  target: [10, 20, 30],
  up: [0, Math.SQRT1_2, -Math.SQRT1_2],
};

const ortho: ViewCamera = { ...camera, projection: 'orthographic', size: 120 };

describe('named view names', () => {
  it('defaultViewName gives the lowest View<n> no view uses', () => {
    expect(defaultViewName([])).toBe('View1');
    expect(defaultViewName([{ id: vid('v1'), name: 'View1', camera }])).toBe('View2');
    expect(defaultViewName([{ id: vid('v1'), name: 'View2', camera }])).toBe('View1');
    expect(
      defaultViewName([
        { id: vid('v1'), name: 'View1', camera },
        { id: vid('v2'), name: 'View2', camera },
      ]),
    ).toBe('View3');
    // A view the user named doesn't take a View<n> slot.
    expect(defaultViewName([{ id: vid('v1'), name: 'Front', camera }])).toBe('View1');
  });

  it('uniqueViewName trims, refuses empty, and uniquifies a taken name', () => {
    const views = [
      { id: vid('v1'), name: 'Front', camera },
      { id: vid('v2'), name: 'Front 2', camera },
    ];
    expect(uniqueViewName(views, '  Top ')).toBe('Top');
    expect(uniqueViewName(views, 'Front')).toBe('Front 3');
    expect(uniqueViewName(views, ' Front ', vid('v1'))).toBe('Front');
    expect(() => uniqueViewName(views, '   ')).toThrow("The name can't be empty.");
  });
});

describe('view commands', () => {
  it('saveView adds a view with a trimmed, unique name', () => {
    let doc = apply(sampleDocument(), saveView({ id: vid('v1'), name: ' Top ', camera }));
    expect(doc.views).toEqual([{ id: vid('v1'), name: 'Top', camera }]);
    // A taken name gets the next free suffix.
    doc = apply(doc, saveView({ id: vid('v2'), name: 'Top', camera }));
    expect(doc.views[1]?.name).toBe('Top 2');
    expect(() => apply(doc, saveView({ id: vid('v1'), name: 'Other', camera }))).toThrow(
      'View v1 already exists.',
    );
    expect(() => apply(doc, saveView({ id: vid('v3'), name: '  ', camera }))).toThrow(
      "The name can't be empty.",
    );
    expect(doc.views).toHaveLength(2);
    expect(DocumentSchema.safeParse(doc).success).toBe(true);
  });

  it('updateView renames, overwrites the camera, and does nothing with neither', () => {
    let doc = apply(sampleDocument(), saveView({ id: vid('v1'), name: 'View1', camera }));
    doc = apply(doc, updateView({ id: vid('v1'), name: '  Bottomish ' }));
    expect(doc.views[0]?.name).toBe('Bottomish');
    // A rename to a taken name (another view) is uniquified, self apart.
    doc = apply(doc, saveView({ id: vid('v2'), name: 'Front', camera }));
    doc = apply(doc, updateView({ id: vid('v1'), name: 'Front' }));
    expect(doc.views[0]?.name).toBe('Front 2');
    doc = apply(doc, updateView({ id: vid('v1'), camera: ortho }));
    expect(doc.views[0]?.camera).toEqual(ortho);
    expect(doc.views[0]?.name).toBe('Front 2');
    // Renaming to the name it already has is allowed and changes nothing.
    doc = apply(doc, updateView({ id: vid('v1'), name: ' Front 2 ' }));
    expect(doc.views[0]?.name).toBe('Front 2');
    expect(() => apply(doc, updateView({ id: vid('nope'), name: 'X' }))).toThrow(/doesn't exist/);
  });

  it('removeView deletes a view and refuses an unknown one', () => {
    let doc = apply(sampleDocument(), saveView({ id: vid('v1'), name: 'View1', camera }));
    doc = apply(doc, saveView({ id: vid('v2'), name: 'View2', camera }));
    doc = apply(doc, removeView({ id: vid('v1') }));
    expect(doc.views.map((v) => v.id)).toEqual([vid('v2')]);
    expect(() => apply(doc, removeView({ id: vid('v1') }))).toThrow(/doesn't exist/);
    // The next default name reuses the freed number.
    expect(defaultViewName(doc.views)).toBe('View1');
  });

  it('undoes and redoes each command, and restoreVersion brings views back', () => {
    const original = sampleDocument();
    const history = new UndoHistory();
    let doc = apply(original, saveView({ id: vid('v1'), name: 'Top', camera: ortho }));
    doc = apply(doc, updateView({ id: vid('v1'), name: 'Reading' }));
    const result = applyCommand(doc, removeView({ id: vid('v1') }));
    history.record({
      label: 'Delete view',
      patches: result.patches,
      inversePatches: result.inversePatches,
    });
    expect(result.doc.views).toEqual([]);
    expect(history.undo(result.doc)).toEqual(doc);
    expect(history.redo(doc)).toEqual(result.doc);

    // A version restore (ADR-0036) restores the views with the rest.
    const saved = { ...original, views: [{ id: vid('v9'), name: 'Old', camera: ortho }] };
    const back = apply(result.doc, restoreVersion({ doc: saved }));
    expect(back.views).toEqual(saved.views);
  });
});
