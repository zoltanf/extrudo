/**
 * The notes tools' pure parts (P6-24 S4, plan §4.1, §4.5): what Leader Note, Centre Mark and
 * Centreline take, what their picks make, the words their panels say, and the change that
 * picks a lost anchor again. Text and Sticky Note take no picks: they are placed by a click
 * and typed in place (`SheetTextEditor`).
 *
 * - **Leader Note**: one pick of anything: an edge whole (the arrow lands on its nearest
 *   point), a vertex, an outline, or a face under the pointer (a dot; `faceHit`). The note
 *   then follows the pointer; a click places it and its text is typed in place.
 * - **Centre Mark**: one circle: a whole circular edge, or a cylinder's outline taken as its
 *   face whole. Placed at once.
 * - **Centreline**: a cylinder's or cone's outline (its face whole: the axis), placed at
 *   once; or two parallel straight edges (or an edge and an outline) in one view, placed at
 *   the second.
 *
 * What the kernel says doesn't fit (a cone's outline for a centre mark, an axis seen end-on)
 * is refused by the pick tool with the layout's reason; only these shapes can be hovered.
 */
import type {
  SheetAnchor,
  SheetCentreLineItem,
  SheetCentreMarkItem,
  SheetItem,
  SheetItemChanges,
  SheetItemId,
  SheetLeaderItem,
  Vec2,
} from '@extrudo/core';
import { lineOf, parallel, pickAnchor, type SheetHit, type SheetPick } from './dimensionTool';

/** The anchored note tools. */
export type NoteTool = 'leader' | 'centreMark' | 'centreLine';

/** A leader note's text while it is placed, before its own is typed. */
export const LEADER_PLACEHOLDER = 'Note';

/** A hit's straight line in its view (a line edge, an outline), view mm. */
function hitLine(hit: SheetHit) {
  const { pickable } = hit;
  if (hit.end !== undefined || pickable.shape.type !== 'line') return undefined;
  return pickable.kind === 'edge' || pickable.kind === 'outline' ? pickable.shape : undefined;
}

/** Whether a click on `hit` is the next pick of `tool` after `picks`. */
export function noteAccepts(tool: NoteTool, hit: SheetHit, picks: readonly SheetPick[]): boolean {
  const { pickable } = hit;
  switch (tool) {
    case 'leader':
      return picks.length === 0;
    case 'centreMark':
      if (picks.length > 0 || hit.end !== undefined) return false;
      return (
        pickable.kind === 'outline' ||
        (pickable.kind === 'edge' && pickable.shape.type === 'circle')
      );
    case 'centreLine': {
      const line = hitLine(hit);
      if (picks.length === 0) return line !== undefined;
      const [first] = picks;
      const before = first && lineOf(first);
      if (picks.length > 1 || !before || !line || first?.key === pickable.key) return false;
      return parallel(before, line);
    }
  }
}

/** Whether an outline hit is taken as its face whole (a centre mark, a centre line's axis). */
export function noteWhole(tool: NoteTool, hit: SheetHit, picks: readonly SheetPick[]): boolean {
  if (hit.pickable.kind !== 'outline') return false;
  return tool === 'centreMark' || (tool === 'centreLine' && picks.length === 0);
}

/** How many picks each tool takes at most. */
export const NOTE_MOST: Readonly<Record<NoteTool, number>> = {
  leader: 1,
  centreMark: 1,
  centreLine: 2,
};

/**
 * The item `tool`'s picks make, its place `at` (view mm, a leader's text) and its `text` (a
 * leader's: the placeholder until typed), or `undefined` while they make none yet.
 */
export function noteItem(
  tool: NoteTool,
  id: SheetItemId,
  picks: readonly SheetPick[],
  at: Vec2,
  text = LEADER_PLACEHOLDER,
): SheetLeaderItem | SheetCentreMarkItem | SheetCentreLineItem | undefined {
  const [first, second] = picks;
  if (!first) return undefined;
  const view = first.view;
  switch (tool) {
    case 'leader':
      return { kind: 'leader', id, view, anchor: pickAnchor(first), at: [at[0], at[1]], text };
    case 'centreMark':
      return { kind: 'centreMark', id, view, anchors: [pickAnchor(first)] };
    case 'centreLine': {
      const anchors: SheetAnchor[] =
        first.kind === 'face'
          ? [pickAnchor(first)]
          : second
            ? [pickAnchor(first), pickAnchor(second)]
            : [];
      return anchors.length > 0 ? { kind: 'centreLine', id, view, anchors } : undefined;
    }
  }
}

/** What the panel asks for next. */
export function noteStep(tool: NoteTool, picks: readonly SheetPick[]): string {
  switch (tool) {
    case 'leader':
      return picks.length === 0
        ? 'Pick an edge, a point or a face to point at.'
        : 'Click where the text goes, then type.';
    case 'centreMark':
      return 'Pick a circle, or a cylinder seen from the side.';
    case 'centreLine':
      return picks.length === 0
        ? "Pick a straight edge, or a cylinder's or cone's outline for its axis."
        : 'Pick the parallel edge on the other side.';
  }
}

/**
 * The change that picks anchor `index` of a leader note, centre mark or centre line again as
 * `pick`, or why it can't (said in the status bar). A centre line on an axis takes a face
 * again; one between two lines a line parallel to the other.
 */
export function noteRepick(
  item: SheetLeaderItem | SheetCentreMarkItem | SheetCentreLineItem,
  index: number,
  pick: SheetPick,
): SheetItemChanges | string {
  const anchor = pickAnchor(pick);
  switch (item.kind) {
    case 'leader':
      return { anchor } as SheetItemChanges;
    case 'centreMark':
      if (pick.kind === 'face' || (pick.kind === 'edge' && pick.shape.type === 'circle')) {
        return { anchors: [anchor] } as SheetItemChanges;
      }
      return 'A centre mark takes a circle: drag onto a circle or a cylinder.';
    case 'centreLine': {
      if (item.anchors.length === 1) {
        if (pick.kind === 'face') return { anchors: [anchor] } as SheetItemChanges;
        return "This centre line runs along an axis: drag onto a cylinder's or cone's outline.";
      }
      if (!lineOf(pick)) return 'A centre line runs between two straight edges: drag onto one.';
      const anchors = item.anchors.map((a, i) => (i === index ? anchor : a));
      return { anchors } as SheetItemChanges;
    }
  }
}

/** What a hit takes in a re-pick of `item` (the same kinds as its tool, any index). */
export function repickAccepts(item: SheetItem, hit: SheetHit): boolean {
  switch (item.kind) {
    case 'leader':
      return true;
    case 'centreMark':
      return noteAccepts('centreMark', hit, []);
    case 'centreLine':
      return item.anchors.length === 1
        ? hit.pickable.kind === 'outline'
        : hitLine(hit) !== undefined;
    case 'dimension':
      return hit.pickable.kind !== 'face';
    default:
      return false;
  }
}

/** Whether a re-pick of `item` takes an outline as its face whole. */
export function repickWhole(item: SheetItem, hit: SheetHit): boolean {
  if (hit.pickable.kind !== 'outline') return false;
  return item.kind === 'centreMark' || (item.kind === 'centreLine' && item.anchors.length === 1);
}
