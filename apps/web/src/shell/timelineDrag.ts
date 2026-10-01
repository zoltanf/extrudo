/**
 * Pure pieces of the timeline's chip dragging and selection (P3-17, ADR-0033 amendment).
 */
import type { FeatureId } from '@extrudo/core';

/** How near the list's ends a drag scrolls it (P3-17), px, and how fast at most, px a frame. */
export const EDGE_PX = 32;
export const EDGE_SPEED = 14;

/**
 * How far to scroll the chip list this frame while something is dragged at `x` (P3-17): towards
 * an end the pointer is within `edge` px of (or past), faster the closer it gets; 0 elsewhere.
 */
export function edgeScrollStep(
  x: number,
  left: number,
  right: number,
  edge = EDGE_PX,
  speed = EDGE_SPEED,
): number {
  if (right - left <= 2 * edge) return 0;
  if (x < left + edge) return -Math.ceil(speed * Math.min(1, (left + edge - x) / edge));
  if (x > right - edge) return Math.ceil(speed * Math.min(1, (x - (right - edge)) / edge));
  return 0;
}

/**
 * The chip selection after a click on `id` (P3-17): a plain click selects it alone, Ctrl or ⌘
 * adds or removes it, Shift selects the run from the last clicked chip (`anchor`). In timeline
 * order.
 */
export function chipSelection(
  order: readonly FeatureId[],
  selected: readonly FeatureId[],
  id: FeatureId,
  mode: 'replace' | 'toggle' | 'range',
  anchor: FeatureId | undefined,
): FeatureId[] {
  if (mode === 'replace') return [id];
  if (mode === 'toggle') {
    const next = selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id];
    return order.filter((f) => next.includes(f));
  }
  const a = anchor ? order.indexOf(anchor) : -1;
  const b = order.indexOf(id);
  if (a < 0 || b < 0) return [id];
  const [from, to] = a < b ? [a, b] : [b, a];
  const run = order.slice(from, to + 1);
  return order.filter((f) => run.includes(f) || selected.includes(f));
}
