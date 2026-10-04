import { describe, expect, it } from 'vitest';
import { applyCommand, type Command, CommandError } from './commands';
import { createDocument } from './document';
import { removeFeature, restoreVersion } from './document-commands';
import {
  groupFeatures,
  groupMembers,
  groupOf,
  groupSuppressed,
  groupVisibility,
  nextGroupName,
  normalizeGroups,
  renameGroup,
  setGroupCollapsed,
  ungroup,
} from './groups';
import { UndoHistory } from './history';
import type { FeatureId, GroupId } from './ids';
import { DocumentSchema, type ExtrudoDocument, type Group } from './schema';
import { feature, fid } from './testing';
import { moveFeature } from './timeline';

const gid = (id: string) => id as GroupId;
const apply = (doc: ExtrudoDocument, command: Command<unknown>) => applyCommand(doc, command).doc;
const issuePaths = (doc: unknown): string[] => {
  const result = DocumentSchema.safeParse(doc);
  return result.success ? [] : (result.error.issues.map((i) => i.path.join('.')) as string[]);
};

function group(over: Partial<Omit<Group, 'id'>> & { id?: string }): Group {
  const { id = 'g1', ...rest } = over;
  return {
    name: 'Group1',
    first: fid('f2'),
    last: fid('f3'),
    collapsed: false,
    ...rest,
    id: gid(id),
  };
}

/** `count` features that use nothing, so every move is allowed. */
function timeline(count = 10): ExtrudoDocument {
  return {
    ...createDocument({ name: 'Groups', now: '2026-10-04T10:00:00.000Z' }),
    features: Array.from({ length: count }, (_, i) =>
      feature(`f${i + 1}`, 'extrude', `Extrude${i + 1}`),
    ),
    timelineMarker: count,
  };
}

const ids = (doc: ExtrudoDocument) => doc.features.map((f) => f.id);
/** Each group's members, in timeline order. */
const membersOf = (doc: ExtrudoDocument) => (doc.groups ?? []).map((g) => groupMembers(doc, g));
/** Each group's range as timeline indices, so a change reads at a glance. */
const ranges = (doc: ExtrudoDocument) =>
  (doc.groups ?? []).map((g) => {
    const at = ids(doc);
    return [at.indexOf(g.first), at.indexOf(g.last)] as const;
  });

/** Applies a command, checks the document validates, undoes and redoes it. */
function undone(doc: ExtrudoDocument, command: Command<unknown>): ExtrudoDocument {
  const history = new UndoHistory();
  const result = applyCommand(doc, command);
  expect(result.doc).not.toEqual(doc);
  expect(issuePaths(result.doc)).toEqual([]);
  history.record({ label: command.label, ...result });
  const back = history.undo(result.doc);
  expect(back).toEqual(doc);
  expect(history.redo(back)).toEqual(result.doc);
  return result.doc;
}

/** Deletes features that nothing refers to, one command each. */
const deleteFeatures = (doc: ExtrudoDocument, ...remove: FeatureId[]): ExtrudoDocument =>
  remove.reduce<ExtrudoDocument>((next, id) => apply(next, removeFeature({ id })), doc);

/** The refusal a command gives, or `undefined` when it accepts the change. */
function refusal(doc: ExtrudoDocument, command: Command<unknown>): string | undefined {
  try {
    const result = applyCommand(doc, command);
    expect(result.doc).toEqual(doc);
    return undefined;
  } catch (error) {
    expect(error).toBeInstanceOf(CommandError);
    return (error as CommandError).message;
  }
}

describe('timeline groups: the schema', () => {
  it('accepts a document with groups and one without', () => {
    const doc = timeline();
    expect(issuePaths(doc)).toEqual([]);
    expect(issuePaths({ ...doc, groups: undefined })).toEqual([]);
    expect(issuePaths({ ...doc, groups: [group({ id: 'g1' })] })).toEqual([]);
  });

  it('refuses a group record with a key the schema does not know', () => {
    const doc = timeline();
    expect(issuePaths({ ...doc, groups: [{ ...group({ id: 'g1' }), colour: 'red' }] })).toEqual([
      'groups.0',
    ]);
  });

  it('puts every problem on the path of the group it is in', () => {
    const doc = timeline();
    // An end that is not a feature of this timeline.
    expect(issuePaths({ ...doc, groups: [group({ id: 'g1', first: fid('nope') })] })).toEqual([
      'groups.0.first',
    ]);
    // `last` before `first`, with a message saying which way round it is.
    const backwards = DocumentSchema.safeParse({
      ...doc,
      groups: [group({ id: 'g1', first: fid('f4'), last: fid('f2') })],
    });
    expect(backwards.success).toBe(false);
    expect(backwards.error?.issues[0]?.message).toContain('"Group1" starts at');
    // Two groups over the same feature: the issue is on the second one.
    expect(
      issuePaths({
        ...doc,
        groups: [
          group({ id: 'g1', first: fid('f1'), last: fid('f4') }),
          group({ id: 'g2', name: 'Group2', first: fid('f3'), last: fid('f6') }),
        ],
      }),
    ).toEqual(['groups.1']);
    // Neighbouring groups are fine.
    expect(
      issuePaths({
        ...doc,
        groups: [
          group({ id: 'g1', first: fid('f1'), last: fid('f3') }),
          group({ id: 'g2', name: 'Group2', first: fid('f4'), last: fid('f6') }),
        ],
      }),
    ).toEqual([]);
  });
});

describe('timeline groups: the commands', () => {
  it('groups neighbours under "Group1" and undoes it', () => {
    const doc = timeline(6);
    const next = undone(doc, groupFeatures({ id: gid('g1'), features: [fid('f2'), fid('f3')] }));
    expect(next.groups).toEqual([
      { id: gid('g1'), name: 'Group1', first: fid('f2'), last: fid('f3'), collapsed: false },
    ]);
    // The payload's order doesn't matter, and the name follows the stored ones.
    expect(
      apply(next, groupFeatures({ id: gid('g2'), features: [fid('f6'), fid('f5')] })).groups?.[1],
    ).toMatchObject({ name: 'Group2', first: fid('f5'), last: fid('f6') });
    // A named group, folded right away.
    expect(
      apply(
        next,
        groupFeatures({
          id: gid('g2'),
          name: 'Bracket',
          features: [fid('f5'), fid('f6')],
          collapsed: true,
        }),
      ).groups?.[1],
    ).toMatchObject({ name: 'Bracket', collapsed: true });
  });

  it('refuses features that do not sit next to each other', () => {
    const doc = timeline(6);
    const message = 'Group features that sit next to each other.';
    for (const features of [
      [fid('f2')],
      [fid('f2'), fid('f2')],
      [fid('f2'), fid('f4')],
      [fid('f1'), fid('f2'), fid('f4')],
      [fid('f2'), fid('nope')],
    ]) {
      expect(refusal(doc, groupFeatures({ id: gid('g1'), features })), features.join(',')).toBe(
        message,
      );
    }
  });

  it('refuses a feature that is already in a group', () => {
    const doc = apply(
      timeline(6),
      groupFeatures({ id: gid('g1'), features: [fid('f2'), fid('f3')] }),
    );
    expect(refusal(doc, groupFeatures({ id: gid('g2'), features: [fid('f3'), fid('f4')] }))).toBe(
      'Extrude3 is already in a group.',
    );
    expect(
      apply(doc, groupFeatures({ id: gid('g2'), features: [fid('f4'), fid('f5')] })).groups,
    ).toHaveLength(2);
    expect(refusal(doc, groupFeatures({ id: gid('g1'), features: [fid('f4'), fid('f5')] }))).toBe(
      'Group g1 already exists.',
    );
  });

  it('renames, folds, suppresses and shows a group, one undo step each', () => {
    const doc = apply(
      timeline(6),
      groupFeatures({ id: gid('g1'), features: [fid('f2'), fid('f3')] }),
    );
    expect(undone(doc, renameGroup({ id: gid('g1'), name: ' Bracket ' })).groups?.[0]?.name).toBe(
      'Bracket',
    );
    expect(refusal(doc, renameGroup({ id: gid('g1'), name: '  ' }))).toBe(
      "The name can't be empty.",
    );
    expect(refusal(doc, renameGroup({ id: gid('g1'), name: 'x'.repeat(101) }))).toBe(
      "A group's name can be at most 100 characters.",
    );
    expect(refusal(doc, renameGroup({ id: gid('g2'), name: 'x' }))).toBe("Group g2 doesn't exist.");
    expect(
      undone(doc, setGroupCollapsed({ id: gid('g1'), collapsed: true })).groups?.[0],
    ).toMatchObject({ collapsed: true });
    const suppressed = undone(doc, groupSuppressed({ id: gid('g1'), suppressed: true }));
    expect(suppressed.features.map((f) => f.suppressed)).toEqual([
      false,
      true,
      true,
      false,
      false,
      false,
    ]);
    expect(
      apply(suppressed, groupSuppressed({ id: gid('g1'), suppressed: false })).features.map(
        (f) => f.suppressed,
      ),
    ).toEqual([false, false, false, false, false, false]);
    const hidden = undone(doc, groupVisibility({ id: gid('g1'), visible: false }));
    expect(hidden.features.map((f) => f.visible)).toEqual([
      undefined,
      false,
      false,
      undefined,
      undefined,
      undefined,
    ]);
    // Showing takes the key away again, like a feature's eye.
    expect(
      apply(hidden, groupVisibility({ id: gid('g1'), visible: true })).features.every(
        (f) => f.visible === undefined,
      ),
    ).toBe(true);
  });

  it('ungroups and undoes', () => {
    const doc = apply(
      timeline(6),
      groupFeatures({ id: gid('g1'), features: [fid('f2'), fid('f3')] }),
    );
    expect(undone(doc, ungroup({ id: gid('g1') })).groups).toEqual([]);
    expect(refusal(doc, ungroup({ id: gid('g2') }))).toBe("Group g2 doesn't exist.");
  });

  it("brings a version's groups back with its timeline", () => {
    const doc = apply(
      timeline(6),
      groupFeatures({ id: gid('g1'), features: [fid('f2'), fid('f3')] }),
    );
    const saved = clone(doc);
    const without = apply(doc, ungroup({ id: gid('g1') }));
    expect(undone(without, restoreVersion({ doc: saved })).groups).toEqual(saved.groups);
    // A version whose timeline has none of a group's features loses the group,
    // key and all, as every command that empties one does.
    const older = { ...saved, features: saved.features.slice(4), timelineMarker: 2 };
    const fromOlder = apply(without, restoreVersion({ doc: older }));
    expect(fromOlder.groups).toEqual(undefined);
    expect(issuePaths(fromOlder)).toEqual([]);
  });

  it('reads the group of a feature and its members', () => {
    const doc = apply(
      timeline(6),
      groupFeatures({ id: gid('g1'), features: [fid('f2'), fid('f3')] }),
    );
    expect(groupOf(doc, fid('f2'))?.id).toBe(gid('g1'));
    expect(groupOf(doc, fid('f5'))).toBeUndefined();
    expect(groupMembers(doc, doc.groups?.[0] as Group)).toEqual([fid('f2'), fid('f3')]);
    expect(nextGroupName(doc)).toBe('Group2');
    expect(nextGroupName({ features: [], groups: [group({ id: 'g1', name: 'Group7' })] })).toBe(
      'Group8',
    );
  });
});

describe('timeline groups: normalizeGroups', () => {
  const grouped = () =>
    apply(
      timeline(6),
      groupFeatures({ id: gid('g1'), features: [fid('f3'), fid('f4'), fid('f5')] }),
    );

  it('lets a feature moved into the range join the group', () => {
    const doc = apply(grouped(), moveFeature({ id: fid('f1'), index: 3 }));
    expect(ids(doc)).toEqual([fid('f2'), fid('f3'), fid('f4'), fid('f1'), fid('f5'), fid('f6')]);
    expect(ranges(doc)).toEqual([[1, 4]]);
    expect(groupMembers(doc, doc.groups?.[0] as Group)).toEqual([
      fid('f3'),
      fid('f4'),
      fid('f1'),
      fid('f5'),
    ]);
  });

  it('leaves the group when a member is moved out of the range', () => {
    const doc = apply(grouped(), moveFeature({ id: fid('f4'), index: 0 }));
    expect(membersOf(doc)).toEqual([[fid('f3'), fid('f5')]]);
  });

  it('swaps the ends when one of them moves past the other', () => {
    // The range runs from whichever end comes first, so what is between them
    // is in the group: f5 is the new start, and f1 and f2 came with it.
    const doc = apply(grouped(), moveFeature({ id: fid('f5'), index: 0 }));
    expect(ids(doc)).toEqual([fid('f5'), fid('f1'), fid('f2'), fid('f3'), fid('f4'), fid('f6')]);
    expect(membersOf(doc)).toEqual([[fid('f5'), fid('f1'), fid('f2'), fid('f3')]]);
    expect(issuePaths(doc)).toEqual([]);
  });

  it('moves an end to the next member when a feature is deleted', () => {
    const three = [fid('f3'), fid('f4'), fid('f5')];
    expect(membersOf(deleteFeatures(grouped(), fid('f3')))).toEqual([[fid('f4'), fid('f5')]]);
    expect(membersOf(deleteFeatures(grouped(), fid('f5')))).toEqual([[fid('f3'), fid('f4')]]);
    // A member in the middle: the range keeps both ends and closes the gap.
    expect(membersOf(deleteFeatures(grouped(), fid('f4')))).toEqual([[fid('f3'), fid('f5')]]);
    // Members deleted one after another: the group follows each one.
    expect(membersOf(deleteFeatures(grouped(), fid('f3'), fid('f4')))).toEqual([[fid('f5')]]);
    // Every member gone: the group is dropped, key and all.
    const emptied = deleteFeatures(grouped(), ...three);
    expect(emptied.groups).toEqual(undefined);
    expect('groups' in emptied).toBe(false);
    expect(issuePaths(emptied)).toEqual([]);
  });

  it('keeps groups from overlapping after a move', () => {
    const two = apply(
      timeline(10),
      groupFeatures({ id: gid('g1'), features: [fid('f3'), fid('f4'), fid('f5')] }),
    );
    const both = apply(two, groupFeatures({ id: gid('g2'), features: [fid('f7'), fid('f8')] }));
    expect(ranges(both)).toEqual([
      [2, 4],
      [6, 7],
    ]);
    // Moving the second group's first end into the middle of the first: the
    // group that would overlap one before it goes.
    const moved = apply(both, moveFeature({ id: fid('f7'), index: 3 }));
    expect(issuePaths(moved)).toEqual([]);
    // Group2 would run over the middle of Group1, which is already there.
    expect(membersOf(moved)).toEqual([[fid('f3'), fid('f7'), fid('f4'), fid('f5')]]);
  });

  it('is pure, so a caller can ask what the groups would be', () => {
    const doc = grouped();
    const snapshot = clone(doc);
    expect(normalizeGroups(doc)).toEqual(doc.groups ?? []);
    expect(doc).toEqual(snapshot);
    // Hand-written groups: one whose end went away with its feature, one after
    // it, and one that would overlap the second.
    expect(
      normalizeGroups({
        features: timeline(10).features,
        groups: [
          { id: gid('g1'), name: 'Group1', first: fid('f3'), last: fid('nope'), collapsed: false },
          { id: gid('g2'), name: 'Group2', first: fid('f7'), last: fid('f9'), collapsed: true },
          { id: gid('g3'), name: 'Group3', first: fid('f8'), last: fid('f10'), collapsed: false },
        ],
      }),
    ).toEqual([
      { id: gid('g1'), name: 'Group1', first: fid('f3'), last: fid('f4'), collapsed: false },
      { id: gid('g2'), name: 'Group2', first: fid('f7'), last: fid('f9'), collapsed: true },
    ]);
  });

  it('keeps groups valid through any run of moves (P4-09)', () => {
    const random = mulberry32(20261004);
    for (let run = 0; run < 40; run++) {
      let doc = apply(
        timeline(),
        groupFeatures({
          id: gid('g1'),
          features: [fid('f2'), fid('f3'), fid('f4')],
          collapsed: run % 2 === 0,
        }),
      );
      doc = apply(doc, groupFeatures({ id: gid('g2'), features: [fid('f7'), fid('f8')] }));
      for (let step = 0; step < 25; step++) {
        const from = Math.floor(random() * doc.features.length);
        const to = Math.floor(random() * doc.features.length);
        doc = apply(
          doc,
          moveFeature({
            id: doc.features[from]?.id as FeatureId,
            index: to,
            active: random() < 0.5,
          }),
        );
        const where = `run ${run} step ${step}`;
        expect(issuePaths(doc), where).toEqual([]);
        // A group is always a contiguous run: its members are what is between
        // its ends, in timeline order.
        const at = ids(doc);
        for (const g of doc.groups ?? []) {
          const first = at.indexOf(g.first);
          const last = at.indexOf(g.last);
          expect(Math.min(first, last), where).toBe(
            at.indexOf(groupMembers(doc, g)[0] as FeatureId),
          );
          expect(Math.max(first, last), where).toBe(
            at.indexOf(groupMembers(doc, g).at(-1) as FeatureId),
          );
        }
      }
    }
  });
});

/** A copy of a document, as a version's JSON is (core's tsconfig has no DOM or Node types). */
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** A small seeded generator, so the property test runs the same moves every time. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
