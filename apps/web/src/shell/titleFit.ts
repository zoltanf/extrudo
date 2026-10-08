/** How the design's name and save state share the top bar's middle (ADR-0079, round 2). */
export type TitleFit = 'full' | 'dot' | 'truncate';

/** The space between the name and the save state's dot. */
export const TITLE_GAP = 4;
/** The save state's dot alone, with its padding. */
export const DOT_WIDTH = 18;

/**
 * What fits in `available` px: the name and the save state with its word (`full`);
 * else the name and the dot, the word kept as the tooltip and accessible name (`dot`);
 * else the name cut short with an ellipsis (`truncate`). Widths are natural, in px.
 */
export function titleFit(
  available: number,
  nameWidth: number,
  statusWidth: number,
  dotWidth: number = DOT_WIDTH,
): TitleFit {
  if (nameWidth + TITLE_GAP + statusWidth <= available) return 'full';
  if (nameWidth + TITLE_GAP + dotWidth <= available) return 'dot';
  return 'truncate';
}
