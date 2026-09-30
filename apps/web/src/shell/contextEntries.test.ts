import type { BodyId, Feature, FeatureId, SelectionItem } from '@extrudo/core';
import { describe, expect, it, vi } from 'vitest';
import { memoryPreferences } from '../platform/preferences';
import { createViewportStore } from '../viewport/store';
import type { BodyActions, BodyEntry } from './bodies';
import type { AppCommand } from './commands';
import { type ContextInput, contextEntries } from './contextEntries';

const cmd = (id: string, over: Partial<AppCommand> = {}): AppCommand => ({
  id,
  label: id,
  group: 'Test',
  keys: [],
  run: vi.fn(),
  ...over,
});

const bid = (id: string) => id as BodyId;
const body = (id: string, visible = true): BodyEntry => ({
  id: bid(id),
  meta: { name: id, visible },
  stored: true,
});
const item = (kind: SelectionItem['kind'], id: string): SelectionItem => ({ kind, id });

function bodyActions(): BodyActions {
  return {
    rename: vi.fn(() => true),
    setVisible: vi.fn(),
    setColor: vi.fn(),
    setOpacity: vi.fn(),
    remove: vi.fn(),
    exportBodies: vi.fn(),
  };
}

function input(over: Partial<ContextInput> = {}): ContextInput {
  return {
    mode: 'model',
    selection: [],
    commands: [
      cmd('sketch'),
      cmd('section'),
      cmd('measure'),
      cmd('delete'),
      cmd('redo'),
      cmd('lookAtSketch'),
      cmd('repeatLast', { label: 'Repeat Line' }),
    ],
    bodies: [body('B:0')],
    bodyActions: bodyActions(),
    features: [],
    featureActions: { edit: vi.fn(() => true), setVisible: vi.fn(), remove: vi.fn() },
    viewport: createViewportStore({ preferences: memoryPreferences(), reducedMotion: () => true }),
    clearSelection: vi.fn(),
    appearance: vi.fn(),
    ...over,
  };
}

const ids = (i: ContextInput) => contextEntries(i).map((e) => e.id);
const find = (i: ContextInput, id: string) => contextEntries(i).find((e) => e.id === id);

const sketchFeature = (visible = true): Feature =>
  ({
    id: 'S1' as FeatureId,
    type: 'sketch',
    name: 'Sketch1',
    suppressed: false,
    inputs: {},
    ...(visible ? {} : { visible: false }),
  }) as Feature;

describe('the overflow list in the model', () => {
  it('offers only the view commands over empty space', () => {
    expect(ids(input())).toEqual(['fit', 'home', 'projection', 'redo']);
  });

  it('switches the projection entry to the other projection', () => {
    const i = input();
    expect(find(i, 'projection')?.label).toBe('Orthographic');
    i.viewport.getState().setProjection('orthographic');
    expect(find(i, 'projection')?.label).toBe('Perspective');
    find(i, 'projection')?.onSelect();
    expect(i.viewport.getState().projection).toBe('perspective');
  });

  it('fits and goes home through the viewport store', () => {
    const i = input();
    const fit = vi.spyOn(i.viewport.getState(), 'fit');
    find(i, 'fit')?.onSelect();
    expect(fit).toHaveBeenCalled();
  });

  it('adds Sketch on Face, Section Here, Measure and the body entries for a face', () => {
    const i = input({ selection: [item('face', 'B:0:3')] });
    expect(ids(i)).toEqual([
      'sketchOnFace',
      'sectionHere',
      'measure',
      'hideBody',
      'appearance',
      'exportBodies',
      'fit',
      'home',
      'projection',
      'redo',
      'clearSelection',
    ]);
    // Sketch on Face runs the Create Sketch command, which starts on the selected face.
    const sketch = i.commands.find((c) => c.id === 'sketch');
    find(i, 'sketchOnFace')?.onSelect();
    expect(sketch?.run).toHaveBeenCalled();
    // Section Here runs Section Analysis, which cuts at the selected face (P3-09).
    const section = i.commands.find((c) => c.id === 'section');
    find(i, 'sectionHere')?.onSelect();
    expect(section?.run).toHaveBeenCalled();
  });

  it('offers no Sketch on Face for two faces, or for an edge', () => {
    const two = input({ selection: [item('face', 'B:0:1'), item('face', 'B:0:2')] });
    expect(ids(two)).not.toContain('sketchOnFace');
    expect(ids(two)).not.toContain('sectionHere');
    expect(ids(two)).toContain('measure');
    expect(ids(input({ selection: [item('edge', 'B:0:1')] }))).not.toContain('sketchOnFace');
  });

  it('starts each group with a separator', () => {
    const entries = contextEntries(input({ selection: [item('face', 'B:0:3')] }));
    expect(entries.filter((e) => e.separatorBefore).map((e) => e.id)).toEqual([
      'hideBody',
      'fit',
      'redo',
    ]);
    expect(entries[0]?.separatorBefore).toBeUndefined();
  });

  it('hides, shows, exports and deletes the selected bodies through the shared actions', () => {
    const actions = bodyActions();
    const i = input({
      selection: [item('body', 'B:0')],
      bodyActions: actions,
      commands: [cmd('delete'), cmd('redo')],
    });
    expect(ids(i)).toContain('delete');
    find(i, 'hideBody')?.onSelect();
    expect(actions.setVisible).toHaveBeenCalledWith(['B:0'], false);
    find(i, 'exportBodies')?.onSelect();
    expect(actions.exportBodies).toHaveBeenCalledWith(['B:0']);
    find(i, 'appearance')?.onSelect();
    expect(i.appearance).toHaveBeenCalledWith('B:0');
    find(i, 'delete')?.onSelect();
    expect(i.commands.find((c) => c.id === 'delete')?.run).toHaveBeenCalled();
  });

  it('offers Show for a hidden body, and Show All Bodies over empty space', () => {
    const hidden = input({
      selection: [item('body', 'B:0')],
      bodies: [body('B:0', false)],
    });
    expect(find(hidden, 'showBody')?.label).toBe('Show Body');
    const space = input({ bodies: [body('B:0'), body('B:1', false), body('B:2', false)] });
    const all = find(space, 'showAllBodies');
    expect(all).toBeDefined();
    all?.onSelect();
    expect(space.bodyActions.setVisible).toHaveBeenCalledWith(['B:1', 'B:2'], true);
  });

  it('does not delete when only a face is selected (Delete is for bodies)', () => {
    expect(ids(input({ selection: [item('face', 'B:0:3')] }))).not.toContain('delete');
  });

  it('pluralises for several bodies and gives no Appearance for them', () => {
    const i = input({
      selection: [item('body', 'B:0'), item('body', 'B:1')],
      bodies: [body('B:0'), body('B:1')],
    });
    expect(find(i, 'hideBody')?.label).toBe('Hide Bodies');
    expect(find(i, 'appearance')).toBeUndefined();
  });

  it('edits and hides the sketch a picked profile belongs to', () => {
    const feature = sketchFeature();
    const actions = { edit: vi.fn(() => true), setVisible: vi.fn(), remove: vi.fn() };
    const i = input({
      selection: [item('profile', 'S1/p1')],
      features: [feature],
      featureActions: actions,
    });
    find(i, 'editSketch')?.onSelect();
    expect(actions.edit).toHaveBeenCalledWith('S1');
    find(i, 'hideSketch')?.onSelect();
    expect(actions.setVisible).toHaveBeenCalledWith(['S1'], false);
    expect(ids(i)).not.toContain('measure');
  });

  it('edits, hides and deletes a picked construction plane, axis or point (P3-05)', () => {
    const feature = {
      ...sketchFeature(),
      id: 'P1' as FeatureId,
      type: 'offsetPlane',
      name: 'Plane1',
    };
    const actions = { edit: vi.fn(() => true), setVisible: vi.fn(), remove: vi.fn() };
    const i = input({
      selection: [item('plane', 'P1')],
      features: [feature as Feature],
      featureActions: actions,
    });
    expect(find(i, 'editConstruction')?.label).toBe('Edit Plane');
    find(i, 'editConstruction')?.onSelect();
    expect(actions.edit).toHaveBeenCalledWith('P1');
    find(i, 'hideConstruction')?.onSelect();
    expect(actions.setVisible).toHaveBeenCalledWith(['P1'], false);
    find(i, 'deleteConstruction')?.onSelect();
    expect(actions.remove).toHaveBeenCalledWith('P1');
    // An origin plane is no feature: nothing to edit.
    expect(
      ids(input({ selection: [item('plane', 'origin:xy')], features: [feature as Feature] })),
    ).not.toContain('editConstruction');
    const axis = { ...feature, id: 'A1' as FeatureId, type: 'axisThroughPoints' } as Feature;
    expect(
      find(input({ selection: [item('axis', 'A1')], features: [axis] }), 'editConstruction')?.label,
    ).toBe('Edit Axis');
  });

  it('dims an entry whose command is missing or not built yet', () => {
    const i = input({
      selection: [item('face', 'B:0:3')],
      commands: [cmd('sketch', { unavailable: 'Arrives with X.' })],
    });
    expect(find(i, 'sketchOnFace')).toMatchObject({ disabled: true, hint: 'Arrives with X.' });
    expect(find(i, 'measure')?.disabled).toBe(true);
  });

  it('clears the selection', () => {
    const i = input({ selection: [item('face', 'B:0:3')] });
    find(i, 'clearSelection')?.onSelect();
    expect(i.clearSelection).toHaveBeenCalled();
    expect(ids(input())).not.toContain('clearSelection');
  });
});

describe('the overflow list in a sketch', () => {
  const sketch = (over: Partial<ContextInput> = {}) => input({ mode: 'sketch', ...over });

  it('offers Look At Sketch, Fit, Redo and Repeat with nothing selected', () => {
    expect(ids(sketch())).toEqual(['lookAtSketch', 'fit', 'redo', 'repeatLast']);
    expect(find(sketch(), 'repeatLast')?.label).toBe('Repeat Line');
  });

  it('names what Delete deletes', () => {
    const del = (selection: SelectionItem[]) => find(sketch({ selection }), 'delete')?.label;
    expect(del([item('sketchEntity', 'l1')])).toBe('Delete');
    expect(del([item('constraint', 'c1')])).toBe('Delete Constraint');
    expect(del([item('constraint', 'c1'), item('constraint', 'c2')])).toBe('Delete Constraints');
    expect(del([item('dimension', 'd1')])).toBe('Delete Dimension');
    expect(del([item('dimension', 'd1'), item('constraint', 'c1')])).toBe('Delete');
  });

  it('runs Delete through the command, and offers no model entries', () => {
    const i = sketch({ selection: [item('sketchEntity', 'l1')] });
    find(i, 'delete')?.onSelect();
    expect(i.commands.find((c) => c.id === 'delete')?.run).toHaveBeenCalled();
    expect(ids(i)).not.toContain('measure');
    expect(ids(i)).not.toContain('hideBody');
  });

  it('offers Cancel while a tool runs, and no Delete then', () => {
    const cancel = vi.fn();
    const i = sketch({
      selection: [item('sketchEntity', 'l1')],
      runningTool: { label: 'Line', cancel },
    });
    expect(ids(i)[0]).toBe('cancelTool');
    expect(find(i, 'cancelTool')?.label).toBe('Cancel Line');
    find(i, 'cancelTool')?.onSelect();
    expect(cancel).toHaveBeenCalled();
    expect(ids(i)).not.toContain('delete');
  });

  it('ignores curves of other sketches picked in the model', () => {
    expect(ids(sketch({ selection: [item('sketchEntity', 'S1/l1')] }))).not.toContain('delete');
  });
});
