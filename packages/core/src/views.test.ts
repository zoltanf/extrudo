import { describe, expect, it } from 'vitest';
import { applyCommand, type Command, CommandError } from './commands';
import {
  addParameter,
  defaultViewName,
  removeParameter,
  removeView,
  restoreVersion,
  saveView,
  uniqueViewName,
  updateParameter,
  updateView,
} from './document-commands';
import { UndoHistory } from './history';
import type { ParameterId, ViewId } from './ids';
import {
  DocumentSchema,
  type ExtrudoDocument,
  NamedViewSchema,
  type ViewCamera,
  type ViewSection,
} from './schema';
import { parameter, sampleDocument } from './testing';

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

describe('a named view keeps its section', () => {
  const ref = { kind: 'plane', id: 'origin:xy' } as const;
  const plane = (offset = '10 mm') => ({ plane: ref, offset, flip: false, on: true });
  const planes = (n: number): ViewSection => ({
    kind: 'planes',
    planes: Array.from({ length: n }, () => plane()),
  });
  const box: ViewSection = {
    kind: 'box',
    center: ['0', '0', '0'],
    half: ['wall', '10 mm', 'wall * 2'],
    on: true,
  };
  const view = (section: unknown) => ({ id: 'v1', name: 'V', camera, section });

  it('the schema takes 1 to 3 planes and a box, and refuses the rest', () => {
    for (const ok of [planes(1), planes(3), box]) {
      expect(NamedViewSchema.safeParse(view(ok)).success).toBe(true);
    }
    const { on: _on, ...noOn } = plane();
    for (const bad of [
      { kind: 'planes', planes: [] },
      planes(4),
      { kind: 'cone' },
      { kind: 'planes', planes: [noOn] },
      { ...box, half: ['1', '2'] },
    ]) {
      expect(NamedViewSchema.safeParse(view(bad)).success).toBe(false);
    }
  });

  it('saveView stores the section exactly, or leaves the key out', () => {
    let doc = apply(sampleDocument(), saveView({ id: vid('v1'), name: 'A', camera, section: box }));
    doc = apply(doc, saveView({ id: vid('v2'), name: 'B', camera }));
    expect(doc.views[0]?.section).toEqual(box);
    expect('section' in (doc.views[1] ?? {})).toBe(false);
    expect(DocumentSchema.safeParse(doc).success).toBe(true);
  });

  it('updateView keeps, replaces or removes the section, each undoable', () => {
    const original = apply(
      sampleDocument(),
      saveView({ id: vid('v1'), name: 'A', camera, section: planes(1) }),
    );
    const step = (payload: Parameters<typeof updateView>[0]) => {
      const result = applyCommand(original, updateView(payload));
      const history = new UndoHistory();
      history.record({
        label: 'Update view',
        patches: result.patches,
        inversePatches: result.inversePatches,
      });
      expect(history.undo(result.doc)).toEqual(original);
      return result.doc.views[0];
    };
    expect(step({ id: vid('v1'), name: 'Renamed' })?.section).toEqual(planes(1));
    expect(step({ id: vid('v1'), section: box })?.section).toEqual(box);
    const removed = step({ id: vid('v1'), section: null });
    expect(removed && 'section' in removed).toBe(false);
  });

  it('refuses no planes and too many', () => {
    const doc = apply(sampleDocument(), saveView({ id: vid('v1'), name: 'A', camera }));
    for (const n of [0, 4]) {
      expect(() =>
        apply(doc, saveView({ id: vid('v2'), name: 'B', camera, section: planes(n) })),
      ).toThrow(CommandError);
      expect(() => apply(doc, updateView({ id: vid('v1'), section: planes(n) }))).toThrow(
        CommandError,
      );
    }
  });

  it('a parameter rename rewrites the section expressions, other names stay', () => {
    let doc = apply(
      sampleDocument(),
      saveView({
        id: vid('v1'),
        name: 'A',
        camera,
        section: { kind: 'planes', planes: [plane('wall / 2'), plane('width')] },
      }),
    );
    doc = apply(doc, saveView({ id: vid('v2'), name: 'B', camera, section: box }));
    doc = apply(doc, updateParameter({ id: 'p2' as ParameterId, changes: { name: 'thickness' } }));
    const first = doc.views[0]?.section;
    expect(first?.kind === 'planes' && first.planes.map((p) => p.offset)).toEqual([
      'thickness / 2',
      'width',
    ]);
    const second = doc.views[1]?.section;
    expect(second?.kind === 'box' && [second.center, second.half]).toEqual([
      ['0', '0', '0'],
      ['thickness', '10 mm', 'thickness * 2'],
    ]);
  });

  it('deleting a parameter only a section uses is allowed', () => {
    let doc = apply(
      sampleDocument(),
      addParameter({
        parameter: parameter('p9', 'cutz', '5 mm'),
      }),
    );
    doc = apply(
      doc,
      saveView({
        id: vid('v1'),
        name: 'A',
        camera,
        section: { kind: 'planes', planes: [plane('cutz')] },
      }),
    );
    doc = apply(doc, removeParameter({ id: 'p9' as ParameterId }));
    expect(doc.parameters.some((p) => p.name === 'cutz')).toBe(false);
  });

  it('a document without sections round-trips unchanged', () => {
    const doc = apply(sampleDocument(), saveView({ id: vid('v1'), name: 'A', camera: ortho }));
    const json = JSON.stringify(doc);
    const parsed = DocumentSchema.parse(JSON.parse(json));
    expect(JSON.stringify(parsed)).toBe(json);
    expect(json).not.toContain('section');
  });
});
