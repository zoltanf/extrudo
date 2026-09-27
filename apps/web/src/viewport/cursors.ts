/**
 * Cursors for the navigation tools (FR-VP-01): the pointer shows what a
 * left-drag will do. CSS has hands for panning; orbit and zoom get small
 * SVG cursors of our own, drawn white over a dark outline so they read on
 * both themes and on bodies. Each falls back to a stock cursor.
 */
import type { NavAction } from './navigation';

/** An SVG cursor: every path drawn twice, dark and wide, then white and thin. */
function svgCursor(paths: string[], hotspot: [number, number], fallback: string): string {
  const stroke = (color: string, width: number) =>
    `<g fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round">${paths.map((d) => `<path d="${d}"/>`).join('')}</g>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">${stroke('#15171c', 4)}${stroke('#ffffff', 1.75)}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${hotspot[0]} ${hotspot[1]}, ${fallback}`;
}

/** Orbit: a circular arrow around the centre dot (the hotspot). */
const ORBIT = svgCursor(
  ['M20 12a8 8 0 1 1-2.34-5.66', 'M18.5 2.5v4h-4', 'M12 12h.01'],
  [12, 12],
  'move',
);

/** Zoom: a magnifier with a plus; the hotspot is the lens centre. */
const ZOOM = svgCursor(
  ['M10 3.5a6.5 6.5 0 1 0 0 13a6.5 6.5 0 1 0 0-13', 'M14.8 14.8L20.5 20.5', 'M10 7v6', 'M7 10h6'],
  [10, 10],
  'zoom-in',
);

/** The CSS cursor while a nav tool waits for a drag, and while a drag of that kind runs. */
export function navCursor(action: NavAction, dragging: boolean): string {
  switch (action) {
    case 'pan':
      return dragging ? 'grabbing' : 'grab';
    case 'orbit':
      return ORBIT;
    case 'zoom':
      return ZOOM;
  }
}
