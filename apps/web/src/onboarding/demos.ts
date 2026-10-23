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
 * The tools that have a clip: every tile of the Solid, Modify, Construct, 3D Print and
 * Sketch tabs (in the tabs' order), all recorded in the current UI (R3-16). The Sketch tab's
 * tiles are the ribbon's; the tools in its "more" menus have none.
 */
export const DEMO_TOOLS: readonly string[] = [
  // Solid › Create, Primitives, Features, Pattern, Program, Assemble.
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
  // Modify › Modify, Transform.
  'pressPull',
  'fillet',
  'chamfer',
  'shell',
  'offsetFace',
  'draft',
  'thread',
  'move',
  'mirror',
  'combine',
  'splitBody',
  'scale',
  // Construct › Planes, Axes, Points, Inspect.
  'offsetPlane',
  'planeAtAngle',
  'midplane',
  'tangentPlane',
  'planeThroughPoints',
  'planeAlongPath',
  'midplaneAngled',
  'axisThroughPoints',
  'axisThroughCylinder',
  'axisAlongEdge',
  'constructionPoint',
  'pointOnPath',
  'pointAtIntersection',
  'measure',
  'section',
  // 3D Print › Prepare, Output (Measure is Construct's).
  'placeOnBed',
  'printInfo',
  'tolerance',
  'overhang',
  'wallThickness',
  'export',
  'slicer',
  'render',
  // Sketch › Create, Modify, Constraints, Export.
  'line',
  'rectangle',
  'circle',
  'arc',
  'dimension',
  'sketchFillet',
  'trim',
  'sketchOffset',
  'parameters',
  'coincident',
  'collinear',
  'concentric',
  'midpoint',
  'fix',
  'parallel',
  'perpendicular',
  'horizontal',
  'vertical',
  'tangent',
  'smooth',
  'equal',
  'symmetric',
  'exportSketch',
];

/** Where a tool's clip is, or `undefined` if it has none. */
export function demoUrl(tool: string): string | undefined {
  return DEMO_TOOLS.includes(tool) ? `${import.meta.env.BASE_URL}demos/${tool}.webm` : undefined;
}
