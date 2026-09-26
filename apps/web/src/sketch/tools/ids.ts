/**
 * The drawing tools' IDs, apart from the tools themselves: the shell asks
 * whether a tool is a drawing tool before the tools' chunk has loaded
 * (ADR-0014). `host.test.ts` checks this list against the host's factories.
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
];

const IDS = new Set(SKETCH_TOOL_IDS);

/** Whether a session tool ID names a sketch drawing tool. */
export function isSketchTool(id: string | undefined): boolean {
  return id !== undefined && IDS.has(id);
}
