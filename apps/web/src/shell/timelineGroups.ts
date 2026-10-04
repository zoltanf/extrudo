/**
 * What the timeline draws when a design has groups (P4-09, ADR-0065 §2), as
 * pure functions, so the rules are decided (and unit tested) here rather than
 * in the component: which features are under a group's name, the chips in the
 * order they are drawn, the gaps the marker may stop in (never inside a folded
 * group), and where a drag of a chip would drop what it holds.
 *
 * A group is a range of the timeline (`groups.ts` in core), so a run of
 * features belongs to one name: `planTimeline` turns the document into bands
 * (loose chips, an open group's band, or a folded group's one chip), the gaps
 * the marker may take, and the group every feature is in.
 */
import {
  type Command,
  type ExtrudoDocument,
  type Feature,
  type FeatureId,
  type FeatureStatus,
  type Group,
  type GroupId,
  isFeatureVisible,
  setGroupCollapsed,
} from '@extrudo/core';
import { createStore, type StoreApi } from 'zustand/vanilla';

/** A group as the timeline reads it: its range, its members and how they stand. */
export interface GroupRun {
  group: Group;
  /** The member's index, and one past the last: the group's range. */
  from: number;
  to: number;
  /** Its members, in timeline order. */
  members: Feature[];
  /** The worst of its members' statuses (error > warning > none), for a folded chip. */
  status: 'error' | 'warning' | undefined;
  /** Why it failed, if a member did: the first member that has a message. */
  message: string | undefined;
  /** Every member is rolled back. */
  rolledBack: boolean;
  /** Some member is rolled back and some is not. */
  split: boolean;
  /** Every member is suppressed. */
  suppressed: boolean;
  /** Every member shows its own geometry (a sketch's curves). */
  visible: boolean;
  /** How many of its members the kernel could not compute. */
  errors: number;
}

/** What the list draws, in order: loose chips, and the bands around a group's chips. */
export interface PlanBand {
  /** The open or folded group this band draws, or `undefined` for loose chips. */
  group: GroupRun | undefined;
  /** The chips in order. A folded group has none: it is one chip of its own. */
  chips: Feature[];
  /** The feature index the band starts at, and one past its end. */
  from: number;
  to: number;
}

export interface TimelinePlan {
  bands: PlanBand[];
  /** The features in timeline order. */
  order: FeatureId[];
  /** The gaps (feature indices) the marker may stop in: never inside a folded group. */
  gaps: number[];
  /** Feature ID → the group it belongs to. */
  groupOf: Map<FeatureId, GroupId>;
  /** Every group, in document order. */
  runs: GroupRun[];
}

/**
 * The plan for the document's timeline. A folded group is one chip; an open one
 * is a band around its members' chips; everything else is a loose chip. The
 * marker's gaps skip a folded group's inside, so stepping and dragging pass it
 * whole.
 */
export function planTimeline(
  doc: Pick<ExtrudoDocument, 'features' | 'timelineMarker' | 'groups'>,
  statuses: Readonly<Record<string, FeatureStatus | undefined>> = {},
): TimelinePlan {
  const marker = doc.timelineMarker;
  const runs: GroupRun[] = [];
  const groupOf = new Map<FeatureId, GroupId>();
  const index = new Map<string, number>(doc.features.map((f, i) => [f.id as string, i]));
  for (const group of doc.groups ?? []) {
    const from = index.get(group.first);
    const to = index.get(group.last);
    if (from === undefined || to === undefined) continue;
    const lo = Math.min(from, to);
    const hi = Math.max(from, to);
    const members = doc.features.slice(lo, hi + 1);
    const problems = members.map((f, i) => ({
      f,
      index: lo + i,
      status: statuses[f.id]?.status,
      message: statuses[f.id]?.message,
    }));
    const worst =
      problems.find((p) => p.status === 'error') ?? problems.find((p) => p.status === 'warning');
    runs.push({
      group,
      from: lo,
      to: hi,
      members,
      status:
        worst?.status === 'error' ? 'error' : worst?.status === 'warning' ? 'warning' : undefined,
      message: worst?.message,
      rolledBack: members.every((_, i) => lo + i >= marker),
      split: members.some((_, i) => lo + i >= marker) && members.some((_, i) => lo + i < marker),
      suppressed: members.every((f) => f.suppressed),
      visible: members.every(isFeatureVisible),
      errors: problems.filter((p) => p.status === 'error' && p.index < marker && !p.f.suppressed)
        .length,
    });
    for (const member of members) groupOf.set(member.id, group.id);
  }
  // Open groups are bands around their own chips; folded ones take the place of
  // all of theirs.
  const folded = new Map<number, GroupRun>();
  for (const run of runs) if (run.group.collapsed) folded.set(run.from, run);
  const bands: PlanBand[] = [];
  let i = 0;
  while (i < doc.features.length) {
    const run = folded.get(i);
    if (run) {
      bands.push({ group: run, chips: [], from: run.from, to: run.to + 1 });
      i = run.to + 1;
      continue;
    }
    const open = runs.find((r) => !r.group.collapsed && r.from === i);
    if (open) {
      bands.push({ group: open, chips: open.members, from: open.from, to: open.to + 1 });
      i = open.to + 1;
      continue;
    }
    const feature = doc.features[i] as Feature;
    bands.push({ group: undefined, chips: [feature], from: i, to: i + 1 });
    i += 1;
  }
  const gaps: number[] = [];
  for (let gap = 0; gap <= doc.features.length; gap++) {
    if (runs.some((r) => r.group.collapsed && gap > r.from && gap <= r.to)) continue;
    gaps.push(gap);
  }
  return { bands, gaps, groupOf, runs, order: doc.features.map((f) => f.id) };
}

/**
 * The next gap the marker may take (`direction` of 1 or -1), or `marker`
 * itself when there is none in that direction: stepping passes a folded group
 * whole (ADR-0065 §2).
 */
export function stepMarker(gaps: readonly number[], marker: number, direction: 1 | -1): number {
  return (
    (direction > 0 ? gaps.find((g) => g > marker) : [...gaps].reverse().find((g) => g < marker)) ??
    marker
  );
}

/**
 * The folded group the marker would be inside at `index`, if one: the rule
 * behind the marker never resting inside a folded group (ADR-0065 §2). The
 * marker isn't read, so the timeline counts as wholly active.
 */
export function foldedGroupAt(
  doc: Pick<ExtrudoDocument, 'features' | 'groups'>,
  index: number,
): Group | undefined {
  const runs = planTimeline({ ...doc, timelineMarker: doc.features.length }).runs;
  return runs.find((r) => r.group.collapsed && index > r.from && index <= r.to)?.group;
}

/** One drawn chip: the feature indices it stands for. */
export interface DrawnChip {
  /** The feature index the chip starts at (its own, or its group's). */
  from: number;
  /** One past the last feature index it covers. */
  to: number;
}

/**
 * The feature index a gap after these drawn chips is at (the first of what
 * would move there). With a folded group drawn as one chip, its whole run is
 * counted, so a drop can never land inside it.
 */
export function dropAt(chips: readonly DrawnChip[]): number {
  return chips.reduce((features, chip) => features + (chip.to - chip.from), 0);
}

/**
 * What the timeline's own selection holds: the feature chips picked with a
 * click (P3-17) and the group chip picked with one (P4-09). Session state, not
 * undoable and not saved: the timeline reads it to draw the picked chips, and
 * the marking menu's list to offer "Group" for a picked run.
 */
export interface TimelineSelectionState {
  /** Picked feature chips, in timeline order. */
  chips: FeatureId[];
  /** The picked group chip, if one is picked. */
  group: GroupId | undefined;
  pick(chips: readonly FeatureId[], group?: GroupId): void;
  clear(): void;
}

export type TimelineSelectionStore = StoreApi<TimelineSelectionState>;

/** One selection store per open project. */
export function createTimelineSelectionStore(): TimelineSelectionStore {
  return createStore<TimelineSelectionState>()((set) => ({
    chips: [],
    group: undefined,
    pick(chips, group) {
      set({ chips: [...chips], group });
    },
    clear() {
      set({ chips: [], group: undefined });
    },
  }));
}

/**
 * The features whose geometry a hover highlights (P4-09, ADR-0065 §2): the
 * hovered feature, and, when it is in a group, every member of that group — so
 * the pointer on a group's chip or browser row lights the whole run up. Pure, as
 * the view reads the session's single hover item.
 */
export function hoveredFeatureIds(
  doc: Pick<ExtrudoDocument, 'features' | 'groups'>,
  hover: { kind: string; id: string } | undefined,
): ReadonlySet<FeatureId> {
  const ids = new Set<FeatureId>();
  if (hover?.kind !== 'feature') return ids;
  const hovered = hover.id as FeatureId;
  const index = doc.features.findIndex((f) => f.id === hovered);
  if (index < 0) return ids;
  const run = (doc.groups ?? []).flatMap((group) => {
    const from = doc.features.findIndex((f) => f.id === group.first);
    const to = doc.features.findIndex((f) => f.id === group.last);
    if (from < 0 || to < 0) return [];
    const lo = Math.min(from, to);
    const hi = Math.max(from, to);
    return index >= lo && index <= hi ? doc.features.slice(lo, hi + 1) : [];
  });
  for (const feature of run.length > 0 ? run : [doc.features[index] as Feature]) {
    ids.add(feature.id);
  }
  return ids;
}

/**
 * The command that opens the group the marker landed in, if any (ADR-0065 §2:
 * the marker never rests inside a folded group, so rolling back into one opens
 * it). `AppShell` amends it into the step that moved the marker, which is what
 * makes undo take the opening with it. Pure: nothing is dispatched here.
 */
export function openGroupAtMarker(
  doc: Pick<ExtrudoDocument, 'features' | 'groups' | 'timelineMarker'>,
): Command<unknown> | undefined {
  const group = foldedGroupAt(doc, doc.timelineMarker);
  return group ? setGroupCollapsed({ id: group.id, collapsed: false }) : undefined;
}
