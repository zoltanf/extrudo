/**
 * Tool demos (P3-12, FR-UX-04, ADR-0052): a short looping clip in a tool's
 * tooltip. The clips are WebM (VP8) files in `apps/web/public/demos/`,
 * named after the tool's ID, recorded from the real app by
 * `pnpm demos` (`scripts/record-demos.mjs`, `e2e/record-assets.spec.ts`).
 * Each is 2 to 10 seconds at 15 fps, 480 × 300, under 150 kB, framed round the
 * action so it reads at the tooltip's 236 px (the owner's UI review 3, R3-16).
 *
 * They are not part of the JavaScript bundle and not precached: the tooltip
 * asks for one only when it opens, the browser's HTTP cache keeps it after
 * that, and the service worker leaves `demos/` to the network. Offline (or when
 * a file is missing) the tooltip shows its words alone.
 */

/**
 * The tools that have a clip: the first batch of R3-16 is every tile of the Solid tab (in the
 * tab's order), then the clips ADR-0052 recorded first, which the Modify batch re-records.
 */
export const DEMO_TOOLS: readonly string[] = [
  // Solid › Create, Primitives, Features, Pattern, Program, Component.
  'sketch',
  'extrude',
  'revolve',
  'sweep',
  'loft',
  'coil',
  'box',
  'cylinder',
  'sphere',
  'torus',
  'hole',
  'emboss',
  'rib',
  'rectangularPattern',
  'circularPattern',
  'pathPattern',
  'script',
  'recordMacro',
  'stopMacro',
  'newComponent',
  'joint',
  // ADR-0052's: the sketch tools and Modify's.
  'line',
  'rectangle',
  'circle',
  'dimension',
  'fillet',
  'chamfer',
  'shell',
  'pressPull',
];

/** Where a tool's clip is, or `undefined` if it has none. */
export function demoUrl(tool: string): string | undefined {
  return DEMO_TOOLS.includes(tool) ? `${import.meta.env.BASE_URL}demos/${tool}.webm` : undefined;
}
