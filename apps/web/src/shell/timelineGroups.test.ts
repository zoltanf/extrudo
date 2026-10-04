/**
 * The timeline's group rules (P4-09, ADR-0065 §2): what is drawn, where the
 * marker may stop, where a drag drops what a chip holds, and which features a
 * hover lights up.
 */
import {
  applyCommand,
  type Command,
  createDocument,
  createDocumentStore,
  type ExtrudoDocument,
  type FeatureId,
  type Group,
  type GroupId,
  moveTimelineMarker,
} from '@extrudo/core';
import { describe, expect, it } from 'vitest';
import {
  createTimelineSelectionStore,
  dropAt,
  foldedGroupAt,
  hoveredFeatureIds,
  openGroupAtMarker,
  planTimeline,
  stepMarker,
} from './timelineGroups';

const fid = (id: string) => id as FeatureId;
const gid = (id: string) => id as GroupId;

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

const grouped = (over: Partial<Omit<Group, 'id'>> & { id?: string }) => {
  const { id = 'g1', ...rest } = over;
  return {
    first: fid('f2'),
    last: fid('f4'),
    collapsed: true,
    name: 'Group1',
    ...rest,
    id: gid(id),
  } as Group;
};

/** The timeline with one group over features 2 to 4, folded or open. */
function withGroup(collapsed = true): ExtrudoDocument {
  return { ...timeline(), groups: [grouped({ id: 'g1', collapsed })] };
}

/** What the list draws, in order: a group's band carries its own chips. */
const drawn = (doc: ExtrudoDocument) =>
  planTimeline(doc).bands.map((band) =>
    band.group
      ? `${band.group.group.collapsed ? 'group' : 'band'}:${band.group.group.id}:[${band.chips
          .map((c) => c.id)
          .join(',')}]`
      : band.chips.map((c) => c.id).join(','),
  );

describe('planTimeline', () => {
  it('draws a folded group as one chip and an open one as a band', () => {
    expect(drawn(withGroup())).toEqual(['f1', 'group:g1:[]', 'f5', 'f6']);
    expect(drawn(withGroup(false))).toEqual(['f1', 'band:g1:[f2,f3,f4]', 'f5', 'f6']);
    // Two groups, folded: each is one chip, in the order they were made.
    const two = {
      ...timeline(),
      groups: [
        grouped({ id: 'g1' }),
        grouped({ id: 'g2', first: fid('f5'), last: fid('f6'), name: 'Group2' }),
      ],
    };
    expect(drawn(two)).toEqual(['f1', 'group:g1:[]', 'group:g2:[]']);
  });

  it('says which group a feature is in', () => {
    const plan = planTimeline(withGroup(false));
    expect(plan.groupOf.get(fid('f3'))).toBe(gid('g1'));
    expect(plan.groupOf.get(fid('f6'))).toBeUndefined();
  });

  it('reads a run the way the chip shows it: members, worst status, standing', () => {
    const doc = withGroup();
    const statuses = {
      f3: { status: 'warning' as const, message: 'Loose reference' },
      f4: { status: 'error' as const, message: 'No solid' },
    };
    const [run] = planTimeline(doc, statuses).runs;
    expect(run?.members.map((f) => f.id)).toEqual([fid('f2'), fid('f3'), fid('f4')]);
    expect(run?.status).toBe('error');
    expect(run?.message).toBe('No solid');
    expect(run?.errors).toBe(1);
    expect(run?.rolledBack).toBe(false);
    expect(run?.suppressed).toBe(false);
    expect(run?.visible).toBe(true);
    // The marker inside the run: some members active, some not.
    const [inside] = planTimeline({ ...doc, timelineMarker: 3 }, statuses).runs;
    expect(inside?.split).toBe(true);
    expect(inside?.rolledBack).toBe(false);
    // Before it: the whole group is rolled back (and its members' verdicts are stale).
    const [after] = planTimeline({ ...doc, timelineMarker: 1 }, statuses).runs;
    expect(after?.rolledBack).toBe(true);
    expect(after?.errors).toBe(0);
  });

  it('never lets the marker stop inside a folded group', () => {
    // The group is features 2 to 4, so the gaps between them (2 and 3) are gone.
    expect(planTimeline(withGroup()).gaps).toEqual([0, 1, 4, 5, 6]);
    // Open, every gap is there.
    expect(planTimeline(withGroup(false)).gaps).toEqual([0, 1, 2, 3, 4, 5, 6]);
    // No groups: all of them.
    expect(planTimeline(timeline()).gaps).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });
});

describe('stepMarker', () => {
  it('passes a folded group whole', () => {
    const { gaps } = planTimeline(withGroup());
    // From before the group: over it, not into it.
    expect(stepMarker(gaps, 1, 1)).toBe(4);
    expect(stepMarker(gaps, 4, -1)).toBe(1);
    // From inside it (a document rolled back that way): out of it, forwards.
    expect(stepMarker([0, 1, 2, 3, 4, 5, 6], 2, 1)).toBe(3);
    // With nowhere to go, it stays.
    expect(stepMarker(gaps, 6, 1)).toBe(6);
    expect(stepMarker(gaps, 0, -1)).toBe(0);
  });

  it('steps over one feature at a time when nothing is folded', () => {
    const { gaps } = planTimeline(timeline());
    expect(stepMarker(gaps, 2, 1)).toBe(3);
    expect(stepMarker(gaps, 2, -1)).toBe(1);
  });
});

describe('dropAt', () => {
  it('counts features, so a folded group is one chip of three features', () => {
    const chips = [
      { from: 0, to: 1 },
      { from: 1, to: 4 },
      { from: 4, to: 5 },
      { from: 5, to: 6 },
    ];
    // After the first chip: feature 1.
    expect(dropAt(chips.slice(0, 1))).toBe(1);
    // After the group's chip: past all three of its members, never inside.
    expect(dropAt(chips.slice(0, 2))).toBe(4);
    expect(dropAt(chips)).toBe(6);
    expect(dropAt([])).toBe(0);
  });
});

describe('hoveredFeatureIds', () => {
  it('lights the hovered feature and, in a group, every member', () => {
    expect([...hoveredFeatureIds(withGroup(), { kind: 'face', id: 'x' })]).toEqual([]);
    expect([...hoveredFeatureIds(withGroup(), { kind: 'feature', id: 'f1' })]).toEqual(['f1']);
    // A member: its whole group, folded or not.
    expect([...hoveredFeatureIds(withGroup(), { kind: 'feature', id: 'f3' })]).toEqual([
      'f2',
      'f3',
      'f4',
    ]);
    expect([...hoveredFeatureIds(withGroup(false), { kind: 'feature', id: 'f3' })]).toEqual([
      'f2',
      'f3',
      'f4',
    ]);
  });
});

describe('foldedGroupAt and openGroupAtMarker', () => {
  it('finds the group the marker would be inside', () => {
    const doc = withGroup();
    expect(foldedGroupAt(doc, 0)).toBeUndefined();
    // Gap 1 is before the group (it starts at feature 2), gap 4 is after it.
    expect(foldedGroupAt(doc, 1)).toBeUndefined();
    expect(foldedGroupAt(doc, 2)?.id).toBe(gid('g1'));
    expect(foldedGroupAt(doc, 3)?.id).toBe(gid('g1'));
    expect(foldedGroupAt(doc, 4)).toBeUndefined();
    // Open: nowhere to be inside.
    expect(foldedGroupAt(withGroup(false), 2)).toBeUndefined();
  });

  it('opens it as part of the step that moved the marker', () => {
    const store = createDocumentStore(withGroup());
    const rolled = apply(store.getState().doc, moveTimelineMarker({ index: 2 }));
    expect(rolled.groups?.[0]?.collapsed).toBe(true);
    store.getState().replaceDocument(rolled);
    // The marker moved into the folded group: the rule opens it, in one step.
    const open = openGroupAtMarker(rolled);
    expect(open?.type).toBe('group.collapsed');
    if (open) store.getState().amend(open);
    expect(store.getState().doc.groups?.[0]?.collapsed).toBe(false);
    expect(store.getState().transactionDepth).toBe(0);
    // Nothing to do when the marker is outside every folded group.
    expect(openGroupAtMarker({ ...rolled, timelineMarker: 0 })).toBeUndefined();
  });
});

describe('the picked chips', () => {
  it('holds the picked feature chips and the picked group, and clears', () => {
    const store = createTimelineSelectionStore();
    expect(store.getState()).toMatchObject({ chips: [], group: undefined });
    store.getState().pick([fid('f2'), fid('f3')]);
    expect(store.getState().chips).toEqual(['f2', 'f3']);
    store.getState().pick([], gid('g1'));
    expect(store.getState()).toMatchObject({ chips: [], group: 'g1' });
    store.getState().clear();
    expect(store.getState()).toMatchObject({ chips: [], group: undefined });
  });
});

const apply = (doc: ExtrudoDocument, command: Command<unknown>) => applyCommand(doc, command).doc;
