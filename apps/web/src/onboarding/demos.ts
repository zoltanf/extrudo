/**
 * Tool demos (P3-12, FR-UX-04, ADR-0052): a short looping clip in a tool's
 * tooltip. The clips are WebM (VP8) files in `apps/web/public/demos/`,
 * named after the tool's ID, recorded from the real app by
 * `pnpm demos` (`scripts/record-demos.mjs`, `e2e/record-assets.spec.ts`).
 * Each is 3 to 4 seconds at 15 fps, 480 × 300, under 70 kB.
 *
 * They are not part of the JavaScript bundle and not precached: the tooltip
 * asks for one only when it opens, the browser's HTTP cache keeps it after
 * that, and the service worker leaves `demos/` to the network. Offline (or when
 * a file is missing) the tooltip shows its words alone.
 */

/** The tools that have a clip, in the order they were recorded. */
export const DEMO_TOOLS: readonly string[] = [
  'sketch',
  'line',
  'rectangle',
  'circle',
  'dimension',
  'extrude',
  'revolve',
  'fillet',
  'shell',
  'hole',
  'pressPull',
  'rectangularPattern',
];

/** Where a tool's clip is, or `undefined` if it has none. */
export function demoUrl(tool: string): string | undefined {
  return DEMO_TOOLS.includes(tool) ? `${import.meta.env.BASE_URL}demos/${tool}.webm` : undefined;
}
