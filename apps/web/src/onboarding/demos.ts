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
 * The tools that have a clip: every tile of the Solid, Modify, Construct, Make and
 * Sketch tabs (in the tabs' order), all recorded in the current UI (R3-16), and every tool
 * of the Sketch tab's Create ▾ and Modify ▾ menus but Import Drawing (P6-22, ADR-0116). A
 * menu item has no tooltip, so those clips play on the tools' pages in the docs.
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
  'removeFaces',
  'draft',
  'thread',
  'meshToSolid',
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
  'annotate',
  'section',
  // Make › Prepare, Output (Measure is Construct's).
  'placeOnBed',
  'printInfo',
  'tolerance',
  'overhang',
  'wallThickness',
  'simplifyForPrint',
  'export',
  'slicer',
  'render',
  // Sketch › Create, Modify, Constraints, Export.
  'line',
  'rectangle',
  'circle',
  'arc',
  'dimension',
  'project',
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
  // Sketch › the Create ▾ and Modify ▾ menus (Project's is above, with the tiles).
  'rectangle3',
  'rectangleCenter',
  'circle2',
  'circle3',
  'arcCenter',
  'arcTangent',
  'point',
  'polygon',
  'polygonCircumscribed',
  'polygonEdge',
  'slot',
  'slotOverall',
  'ellipse',
  'spline',
  'splineControl',
  'conic',
  'text',
  'intersect',
  'sketchMirror',
  'sketchRectangularPattern',
  'sketchCircularPattern',
  'sketchChamfer',
  'extend',
  'break',
  'sketchMove',
  'sketchCopy',
  'sketchScale',
];

/** Tiles whose clip is still to record (`pnpm demos`): none now. */
export const DEMO_CLIPS_PENDING: readonly string[] = [];

/** Where a tool's clip is, or `undefined` if it has none. */
export function demoUrl(tool: string): string | undefined {
  return DEMO_TOOLS.includes(tool) ? `${import.meta.env.BASE_URL}demos/${tool}.webm` : undefined;
}
