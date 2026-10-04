/**
 * Timeline groups (P4-09, ADR-0065 §1, FR-TL-06): several neighbouring
 * features under one name, which the timeline draws folded or open.
 *
 * A group is a **range**, stored as its two ends (`schema.ts`), so it stays
 * contiguous whatever moves: a feature moved between them joins the group, an
 * end that moves or is deleted shifts to the next member inside, and a group
 * left with nothing is dropped. `normalizeGroups` is that rule as one pure
 * function; every command that reorders or removes features ends with it
 * (`moveFeature`, `moveFeatures`, `removeFeature`, `restoreVersion`), so the
 * document's groups always describe the timeline it has. Groups don't nest and
 * don't overlap, which the document check also enforces.
 *
 * Nothing else reads groups: the engine, the naming and the recompute ignore
 * them, so grouping is free to do at any time.
 */
import { CommandError, type DocumentDraft, defineCommand } from './commands';
import type { FeatureId, GroupId } from './ids';
import type { Feature, Group } from './schema';

/** The document fields a group range is read from. */
export interface TimelineWithGroups {
  features: readonly Pick<Feature, 'id'>[];
  groups?: readonly Group[] | undefined;
}

/**
 * The groups of `doc` with ADR-0065 §1's rules applied, in document order:
 *
 * - an end that no longer exists moves to the next member inside (the feature
 *   just inside the other end), and a group both of whose ends are gone is
 *   dropped;
 * - a group whose ends swapped places runs from the earlier to the later one
 *   (everything between them is in the group);
 * - a group that would share a feature with an earlier group is dropped, so
 *   groups never overlap.
 *
 * Pure: it never touches the document. Commands assign the result to
 * `doc.groups` (and delete the key when there are no groups left).
 */
export function normalizeGroups(doc: TimelineWithGroups): Group[] {
  const order = new Map<string, number>(doc.features.map((f, i) => [f.id as string, i]));
  const kept: { from: number; to: number }[] = [];
  const out: Group[] = [];
  for (const group of doc.groups ?? []) {
    let first = order.get(group.first);
    let last = order.get(group.last);
    if (first === undefined && last === undefined) continue;
    // An end that went away with its feature: the next member inside is the
    // feature just inside the end that stayed.
    if (first === undefined) first = (last as number) - 1;
    if (last === undefined) last = (first as number) + 1;
    const from = Math.min(first, last);
    const to = Math.max(first, last);
    const firstFeature = doc.features[from]?.id;
    const lastFeature = doc.features[to]?.id;
    if (firstFeature === undefined || lastFeature === undefined) continue;
    if (kept.some((k) => from <= k.to && k.from <= to)) continue;
    kept.push({ from, to });
    out.push({ ...group, first: firstFeature, last: lastFeature });
  }
  return out;
}

/**
 * Normalizes a draft's groups in place (every command that reorders or removes
 * features ends with it), taking the key out of the document when nothing is
 * left grouped.
 */
export function normalizeGroupsInPlace(draft: DocumentDraft): void {
  const groups = normalizeGroups(draft);
  if (groups.length === 0) delete draft.groups;
  else draft.groups = groups;
}

/** The group the feature is in, or `undefined`. */
export function groupOf(doc: TimelineWithGroups, featureId: FeatureId): Group | undefined {
  const range = featureRange(doc);
  const index = doc.features.findIndex((f) => f.id === featureId);
  if (index < 0) return undefined;
  return (doc.groups ?? []).find((g) => {
    const from = range.get(g.first);
    const to = range.get(g.last);
    return from !== undefined && to !== undefined && from <= index && index <= to;
  });
}

/** The features of a group, in timeline order: everything between its ends. */
export function groupMembers(doc: TimelineWithGroups, group: Group): FeatureId[] {
  const range = featureRange(doc);
  const from = range.get(group.first);
  const to = range.get(group.last);
  if (from === undefined || to === undefined) return [];
  return doc.features.slice(Math.min(from, to), Math.max(from, to) + 1).map((f) => f.id);
}

/**
 * The name a new group gets: "Group2" after "Group1". The lowest number above
 * every group's, so a name is never handed out twice while any group still
 * carries it — bodies' rule (ADR-0030), as far as the document's groups let it
 * (a group `normalizeGroups` dropped leaves nothing behind to remember its
 * name).
 */
export function nextGroupName(doc: TimelineWithGroups): string {
  let highest = 0;
  for (const group of doc.groups ?? []) {
    const match = /^Group(\d+)$/.exec(group.name);
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  return `Group${highest + 1}`;
}

/** Feature ID → its index in the timeline, for the ranges above. */
function featureRange(doc: TimelineWithGroups): Map<string, number> {
  return new Map(doc.features.map((f, i) => [f.id as string, i]));
}

/**
 * Groups the given features, which must be neighbours in the timeline and in
 * no group yet, under one name (`nextGroupName`'s by default). One undo step.
 */
export const groupFeatures = defineCommand<{
  id: GroupId;
  /** Absent names the group "Group<n>". */
  name?: string;
  features: readonly FeatureId[];
  /** Fold the new group right away; open by default, so the user sees what it took in. */
  collapsed?: boolean;
}>('group.add', 'Group features', (draft, { id, name, features, collapsed = false }) => {
  if (draft.groups?.some((g) => g.id === id)) {
    throw new CommandError(`Group ${id} already exists.`);
  }
  const unique = [...new Set(features)];
  const at = unique
    .map((f) => draft.features.findIndex((feature) => feature.id === f))
    .sort((a, b) => a - b);
  const neighbours =
    at.length >= 2 &&
    (at[0] as number) >= 0 &&
    at.every((index, i) => index === (at[i - 1] ?? index - 1) + 1);
  if (!neighbours) throw new CommandError('Group features that sit next to each other.');
  const members = at.map((index) => draft.features[index] as Feature);
  const inside = members.find((f) => groupOf(draft, f.id) !== undefined);
  if (inside) throw new CommandError(`${inside.name} is already in a group.`);
  draft.groups = [
    ...(draft.groups ?? []),
    {
      id,
      name: name === undefined ? nextGroupName(draft) : groupName(name),
      first: (members[0] as Feature).id,
      last: (members.at(-1) as Feature).id,
      collapsed,
    },
  ];
});

/**
 * Drops the feature at `index` from the document's groups before it is removed
 * from the timeline (ADR-0065 §1: "deleting an end moves that end to the next
 * feature inside"). Knowing the index makes that exact; `normalizeGroups` has
 * the same rule as its fallback for a document that arrives with an end already
 * missing (a lenient load, P3-13).
 */
export function dropFeatureFromGroups(draft: DocumentDraft, index: number): void {
  if (!draft.groups) return;
  for (const group of draft.groups) {
    const first = draft.features.findIndex((f) => f.id === group.first);
    const last = draft.features.findIndex((f) => f.id === group.last);
    if (group.first === draft.features[index]?.id && index < last) {
      group.first = (draft.features[index + 1] as Feature).id;
    } else if (group.last === draft.features[index]?.id && index > first) {
      group.last = (draft.features[index - 1] as Feature).id;
    }
  }
}

/** Removes a group, leaving its features as they are. One undo step. */
export const ungroup = defineCommand<{ id: GroupId }>(
  'group.remove',
  'Ungroup',
  (draft, { id }) => {
    const groups = (draft.groups ?? []).filter((g) => g.id !== id);
    if (groups.length === (draft.groups ?? []).length) {
      throw new CommandError(`Group ${id} doesn't exist.`);
    }
    draft.groups = groups;
  },
);

/** Renames a group (F2). One undo step. */
export const renameGroup = defineCommand<{ id: GroupId; name: string }>(
  'group.rename',
  'Rename group',
  (draft, { id, name }) => {
    findGroup(draft, id).name = groupName(name);
  },
);

/** Folds a group into one chip or opens it, stored and undoable like a feature's visibility. */
export const setGroupCollapsed = defineCommand<{ id: GroupId; collapsed: boolean }>(
  'group.collapsed',
  'Fold group',
  (draft, { id, collapsed }) => {
    findGroup(draft, id).collapsed = collapsed;
  },
);

/** Suppresses or unsuppresses every feature of a group, one undo step. */
export const groupSuppressed = defineCommand<{ id: GroupId; suppressed: boolean }>(
  'group.suppress',
  'Suppress group',
  (draft, { id, suppressed }) => {
    const group = findGroup(draft, id);
    for (const featureId of groupMembers(draft, group)) {
      const feature = draft.features.find((f) => f.id === featureId);
      if (feature) feature.suppressed = suppressed;
    }
  },
);

/** Shows or hides the group's features' own geometry (their eyes), one undo step. */
export const groupVisibility = defineCommand<{ id: GroupId; visible: boolean }>(
  'group.visibility',
  'Change group visibility',
  (draft, { id, visible }) => {
    const group = findGroup(draft, id);
    for (const featureId of groupMembers(draft, group)) {
      const feature = draft.features.find((f) => f.id === featureId);
      if (!feature) continue;
      if (visible) delete feature.visible;
      else feature.visible = false;
    }
  },
);

function findGroup(draft: DocumentDraft, id: GroupId): Group {
  const group = draft.groups?.find((g) => g.id === id);
  if (!group) throw new CommandError(`Group ${id} doesn't exist.`);
  return group;
}

/** A group's name: trimmed, not empty, and as long as the schema allows. */
function groupName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw new CommandError("The name can't be empty.");
  if (trimmed.length > 100) throw new CommandError("A group's name can be at most 100 characters.");
  return trimmed;
}
