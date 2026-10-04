/**
 * The group commands the menus run (P4-09, ADR-0065 §2): one command each, a
 * refusal says why, and a no-op change is no command.
 */
import {
  createDocument,
  createDocumentStore,
  type ExtrudoDocument,
  type FeatureId,
  type GroupId,
  newId,
} from '@extrudo/core';
import { describe, expect, it, vi } from 'vitest';
import { createGroupActions } from './groupActions';

const fid = (id: string) => id as FeatureId;

function timeline(count = 6): ExtrudoDocument {
  return {
    ...createDocument({
      id: 'doc-groups' as never,
      name: 'Groups',
      now: '2026-10-04T10:00:00.000Z',
    }),
    features: Array.from({ length: count }, (_, i) => ({
      id: fid(`f${i + 1}`),
      type: 'extrude',
      name: `Extrude${i + 1}`,
      suppressed: false,
      inputs: { distance: { kind: 'expr' as const, expr: '10 mm' } },
    })),
    timelineMarker: count,
  };
}

function setup(doc: ExtrudoDocument = timeline()) {
  const store = createDocumentStore(doc);
  const notify = vi.fn();
  const actions = createGroupActions(store, notify);
  const group = (): GroupId | undefined => store.getState().doc.groups?.[0]?.id;
  return { store, notify, actions, group };
}

describe('groupActions', () => {
  it('groups the picked chips under a new name', () => {
    const { store, actions, group } = setup();
    expect(actions.group([fid('f2'), fid('f3')])).toBe(true);
    expect(store.getState().doc.groups).toEqual([
      {
        id: group(),
        name: 'Group1',
        first: fid('f2'),
        last: fid('f3'),
        collapsed: false,
      },
    ]);
    // The ID comes from `newId` in the caller (ADR-0003), never from the recipe.
    expect(group()).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('refuses a run that is not neighbours or already grouped, and says why', () => {
    const { store, actions, notify, group } = setup();
    expect(actions.group([fid('f2')])).toBe(false);
    expect(notify).toHaveBeenLastCalledWith('info', 'Pick the chips to group, next to each other.');
    expect(actions.group([fid('f2'), fid('f5')])).toBe(false);
    expect(notify).toHaveBeenLastCalledWith('error', 'Group features that sit next to each other.');
    expect(store.getState().doc.groups).toBeUndefined();
    actions.group([fid('f2'), fid('f3')]);
    notify.mockClear();
    expect(actions.group([fid('f3'), fid('f4')])).toBe(false);
    expect(notify).toHaveBeenLastCalledWith('error', 'Extrude3 is already in a group.');
    // Folded or not, the features of a group are in one already.
    actions.setCollapsed(group() as GroupId, true);
    notify.mockClear();
    expect(actions.group([fid('f2'), fid('f3')])).toBe(false);
    expect(notify).toHaveBeenLastCalledWith('error', 'Extrude2 is already in a group.');
  });

  it('renames, folds, ungroups and undoes each one', () => {
    const { store, actions, group } = setup();
    actions.group([fid('f2'), fid('f3')]);
    const id = group() as GroupId;
    expect(actions.rename(id, 'Bracket')).toBe(true);
    expect(store.getState().doc.groups?.[0]?.name).toBe('Bracket');
    expect(actions.rename(id, 'Bracket')).toBe(true);
    expect(actions.rename(id, '  ')).toBe(false);
    // The name it already has is no change.
    expect(actions.rename(id, 'Bracket')).toBe(true);
    expect(store.getState().doc.groups?.[0]?.name).toBe('Bracket');
    actions.setCollapsed(id, true);
    expect(store.getState().doc.groups?.[0]?.collapsed).toBe(true);
    store.getState().undo();
    expect(store.getState().doc.groups?.[0]?.collapsed).toBe(false);
    actions.ungroup(id);
    expect(store.getState().doc.groups).toEqual([]);
    store.getState().undo();
    expect(store.getState().doc.groups).toHaveLength(1);
  });

  it('suppresses and shows every member in one step, and no-ops when nothing changes', () => {
    const { store, actions, group } = setup();
    actions.group([fid('f2'), fid('f3'), fid('f4')]);
    const id = group() as GroupId;
    actions.setSuppressed(id, true);
    expect(store.getState().doc.features.map((f) => f.suppressed)).toEqual([
      false,
      true,
      true,
      true,
      false,
      false,
    ]);
    store.getState().undo();
    const before = store.getState().doc;
    actions.setSuppressed(id, false);
    expect(store.getState().doc).toBe(before);
    actions.setVisible(id, false);
    expect(store.getState().doc.features.map((f) => f.visible)).toEqual([
      undefined,
      false,
      false,
      false,
      undefined,
      undefined,
    ]);
    actions.setVisible(id, true);
    expect(store.getState().doc.features.every((f) => f.visible === undefined)).toBe(true);
  });

  it('ignores a group that is not there', () => {
    const { store, actions, notify } = setup();
    const id = newId<GroupId>();
    actions.setCollapsed(id, true);
    actions.setSuppressed(id, true);
    actions.setVisible(id, false);
    actions.ungroup(id);
    expect(store.getState().doc).toEqual(timeline());
    expect(notify).not.toHaveBeenCalled();
  });

  it('leaves the document alone when there is no group to change', () => {
    const { store, actions } = setup();
    const before = store.getState().doc;
    actions.setCollapsed(newId<GroupId>(), true);
    expect(store.getState().doc).toBe(before);
    // A document that already has a group is not touched by an unknown id either.
    actions.group([fid('f2'), fid('f3')]);
    const grouped = store.getState().doc;
    actions.setCollapsed(newId<GroupId>(), false);
    expect(store.getState().doc).toBe(grouped);
  });
});
