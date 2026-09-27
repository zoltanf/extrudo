/** The constraint tools (P1-06); `host.test.ts` checks them against `constrain.ts`. */
export const CONSTRAINT_TOOL_IDS: readonly string[] = [
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
];

/** The modify tools (P1-10). */
export const MODIFY_TOOL_IDS: readonly string[] = [
  'trim',
  'extend',
  'break',
  'sketchFillet',
  'sketchChamfer',
  'sketchOffset',
  'sketchMirror',
  'sketchMove',
  'sketchCopy',
  'sketchRectangularPattern',
  'sketchCircularPattern',
  'sketchScale',
];

/** Modify tools that only pick existing geometry (no point placing, no snapping). */
const PICKING_MODIFY_IDS = new Set([
  'trim',
  'extend',
  'break',
  'sketchFillet',
  'sketchChamfer',
  'sketchOffset',
  'sketchMirror',
]);

/**
 * The IDs of every tool the sketch tool host runs (drawing tools, the
 * modify tools, then the constraint tools), apart from the tools themselves: the shell asks whether
 * a tool is one before the tools' chunk has loaded (ADR-0014).
 * `host.test.ts` checks this list against the host's factories.
 */
export const SKETCH_TOOL_IDS: readonly string[] = [
  'line',
  'rectangle',
  'rectangle3',
  'rectangleCenter',
  'circle',
  'circle2',
  'circle3',
  'arc',
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
  'dimension',
  ...MODIFY_TOOL_IDS,
  ...CONSTRAINT_TOOL_IDS,
];

const IDS = new Set(SKETCH_TOOL_IDS);

/** Whether a session tool ID names a sketch drawing tool. */
export function isSketchTool(id: string | undefined): boolean {
  return id !== undefined && IDS.has(id);
}

const CONSTRAINT_IDS = new Set(CONSTRAINT_TOOL_IDS);

/** Whether a session tool ID names a constraint tool, which picks rather than draws. */
export function isConstraintTool(id: string | undefined): boolean {
  return id !== undefined && CONSTRAINT_IDS.has(id);
}

/** Whether a session tool picks entities rather than placing points (constraints, dimensions, most modify tools). */
export function isPickingTool(id: string | undefined): boolean {
  return (
    isConstraintTool(id) || id === 'dimension' || (id !== undefined && PICKING_MODIFY_IDS.has(id))
  );
}
