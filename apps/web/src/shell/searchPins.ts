/**
 * The search's pins (UI review 3, R3-05): tiles over the list, at most
 * `PIN_LIMIT` of them in two rows of five. Pure, so the rules are tested
 * without a DOM.
 */

/** How many pins the search shows, and how many a person may have in one mode. */
export const PIN_LIMIT = 10;

/** What a pin button says when the pins are full. */
export const PINS_FULL = `Up to ${PIN_LIMIT} pins: unpin one first.`;

/**
 * The pinned commands offered here, in the stored order, at most
 * `PIN_LIMIT`. A stored list can be longer (pinned before the cap, or pins
 * of the other mode): the rest stay stored and show when there is room.
 */
export function shownPins<C extends { id: string }>(
  pinned: readonly string[],
  commands: readonly C[],
): C[] {
  const byId = new Map(commands.map((c) => [c.id, c]));
  return pinned
    .map((id) => byId.get(id))
    .filter((c): c is C => c !== undefined)
    .slice(0, PIN_LIMIT);
}

/**
 * Whether toggling `id` may go ahead: unpinning always may, pinning only
 * while fewer than `PIN_LIMIT` pins are shown.
 */
export function canTogglePin(id: string, pinned: readonly string[], shown: number): boolean {
  return pinned.includes(id) || shown < PIN_LIMIT;
}
