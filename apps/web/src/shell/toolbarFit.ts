/**
 * Toolbars that fit the window (ADR-0079 §3). When a tab's groups are wider
 * than the toolbar, the group with the most visible tiles moves its last tile
 * into its ▾ menu, one tile at a time, until the row fits; a group keeps at
 * least one tile. Pure, so the rule is tested without a DOM: the toolbar
 * measures the widths and asks again on every resize and tab change.
 */

/** One toolbar group as the rule sees it. */
export interface FitGroup {
  /** Each tile's width in px, gap included, in order. */
  tiles: number[];
  /** Whether the group has a ▾ menu of its own (tools that are never tiles, plugin items). */
  menu: boolean;
  /**
   * The width of the group's label without the chevron. A group is never
   * narrower than its label, and a label that gains a ▾ grows by `CHEVRON`.
   */
  label?: number;
}

/** The ▾ after a group's label: a 10 px chevron and its gap. */
export const CHEVRON = 12;

/** A group's width with `hidden` of its tiles moved into its menu. */
export function groupWidth(group: FitGroup, hidden: number): number {
  const shown = group.tiles.slice(0, group.tiles.length - hidden);
  const tiles = shown.reduce((sum, w) => sum + w, 0);
  const label = (group.label ?? 0) + (group.menu || hidden > 0 ? CHEVRON : 0);
  return Math.max(tiles, label);
}

/**
 * How many tiles each group moves into its menu so that the groups, plus
 * `chrome` (padding, separators, anything that isn't a group), fit in
 * `available` px. All zeros when they fit. The fullest group gives first; of
 * groups equally full, the **earlier** one gives (the prototype's rule). When
 * every group is down to one tile and the row still doesn't fit, the counts
 * stay there and the toolbar scrolls.
 *
 * The sequence of moves doesn't depend on `available` (it only decides where
 * the sequence stops), so the counts never grow when the window widens.
 */
export function fitToolbar(
  groups: readonly FitGroup[],
  available: number,
  chrome: number,
): number[] {
  const hidden = groups.map(() => 0);
  const total = () => groups.reduce((sum, g, i) => sum + groupWidth(g, hidden[i] ?? 0), chrome);
  while (total() > available) {
    let best = -1;
    let bestVisible = 1;
    groups.forEach((g, i) => {
      const visible = g.tiles.length - (hidden[i] ?? 0);
      if (visible > bestVisible) {
        best = i;
        bestVisible = visible;
      }
    });
    if (best < 0) break;
    hidden[best] = (hidden[best] ?? 0) + 1;
  }
  return hidden;
}
