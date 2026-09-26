/**
 * The tool catalogue for the toolbar and the timeline chips. Tools that
 * aren't built yet are listed with the task that brings them, so the shell
 * shows the real layout (UI spec §2) without pretending they work.
 */
import type { IconName, ToolCategory } from '../design-system';

export interface Tool {
  id: string;
  label: string;
  /** Toolbar label when `label` is too long for a tile. */
  short?: string;
  icon: IconName;
  category: ToolCategory;
  /** One sentence for the tooltip. */
  hint: string;
  shortcut?: string;
  /** Roadmap task that makes it work; absent when it works today. */
  comesWith?: string;
}

export const TOOLS = {
  sketch: {
    id: 'sketch',
    label: 'Create Sketch',
    icon: 'create-sketch',
    category: 'sketch',
    hint: 'Draw a 2D profile on a plane or a flat face.',
  },
  finishSketch: {
    id: 'finishSketch',
    label: 'Finish Sketch',
    icon: 'finish-sketch',
    category: 'sketch',
    hint: 'Leave the sketch; its changes become one undo step.',
  },
  line: {
    id: 'line',
    label: 'Line',
    icon: 'line',
    category: 'sketch',
    hint: 'Lines from point to point. Type a length, Tab to the angle.',
    shortcut: 'L',
  },
  rectangle: {
    id: 'rectangle',
    label: '2-Point Rectangle',
    short: 'Rectangle',
    icon: 'rectangle',
    category: 'sketch',
    hint: 'From two opposite corners. Type the width, Tab to the height.',
    shortcut: 'R',
  },
  rectangle3: {
    id: 'rectangle3',
    label: '3-Point Rectangle',
    icon: 'rectangle-3-point',
    category: 'sketch',
    hint: 'One edge at any angle, then the height.',
  },
  rectangleCenter: {
    id: 'rectangleCenter',
    label: 'Center Rectangle',
    icon: 'rectangle-center',
    category: 'sketch',
    hint: 'From the center out to a corner.',
  },
  circle: {
    id: 'circle',
    label: 'Center Diameter Circle',
    short: 'Circle',
    icon: 'circle',
    category: 'sketch',
    hint: 'From the center out to the rim. Type the diameter.',
    shortcut: 'C',
  },
  circle2: {
    id: 'circle2',
    label: '2-Point Circle',
    icon: 'circle-2-point',
    category: 'sketch',
    hint: 'Across a diameter, from one side to the other.',
  },
  circle3: {
    id: 'circle3',
    label: '3-Point Circle',
    icon: 'circle-3-point',
    category: 'sketch',
    hint: 'Through three points on the rim.',
  },
  arc: {
    id: 'arc',
    label: '3-Point Arc',
    short: 'Arc',
    icon: 'arc',
    category: 'sketch',
    hint: 'Start, end, then a point it passes through.',
    shortcut: 'A',
  },
  arcCenter: {
    id: 'arcCenter',
    label: 'Center Point Arc',
    icon: 'arc-center',
    category: 'sketch',
    hint: 'The center, the start, then how far round.',
  },
  arcTangent: {
    id: 'arcTangent',
    label: 'Tangent Arc',
    icon: 'arc-tangent',
    category: 'sketch',
    hint: 'Carries on smoothly from the end of a line or an arc.',
  },
  point: {
    id: 'point',
    label: 'Point',
    icon: 'point',
    category: 'sketch',
    hint: 'A sketch point, for construction and hole centers.',
  },
  polygon: {
    id: 'polygon',
    label: 'Inscribed Polygon',
    short: 'Polygon',
    icon: 'polygon',
    category: 'sketch',
    hint: 'A regular polygon from its center out to a corner. Tab to the number of sides.',
  },
  polygonCircumscribed: {
    id: 'polygonCircumscribed',
    label: 'Circumscribed Polygon',
    icon: 'polygon-circumscribed',
    category: 'sketch',
    hint: 'A regular polygon sized across the flats, like a nut.',
  },
  polygonEdge: {
    id: 'polygonEdge',
    label: 'Edge Polygon',
    icon: 'polygon-edge',
    category: 'sketch',
    hint: 'A regular polygon built on one edge.',
  },
  slot: {
    id: 'slot',
    label: 'Center to Center Slot',
    short: 'Slot',
    icon: 'slot',
    category: 'sketch',
    hint: 'A slot from one arc center to the other, then the width.',
  },
  slotOverall: {
    id: 'slotOverall',
    label: 'Overall Slot',
    icon: 'slot-overall',
    category: 'sketch',
    hint: 'A slot from end to end, then the width.',
  },
  ellipse: {
    id: 'ellipse',
    label: 'Ellipse',
    icon: 'ellipse',
    category: 'sketch',
    hint: 'An ellipse from its center and two axes.',
  },
  spline: {
    id: 'spline',
    label: 'Fit Point Spline',
    short: 'Spline',
    icon: 'spline',
    category: 'sketch',
    hint: 'A smooth curve through the points you click. Enter to finish.',
  },
  dimension: {
    id: 'dimension',
    label: 'Sketch Dimension',
    short: 'Dimension',
    icon: 'sketch-dimension',
    category: 'sketch',
    hint: 'Lengths, radii and angles that drive the sketch.',
    shortcut: 'D',
  },
  trim: {
    id: 'trim',
    label: 'Trim',
    icon: 'trim',
    category: 'sketch',
    hint: 'Cut curves back to where they cross.',
    shortcut: 'T',
    comesWith: 'P1-10',
  },
  sketchOffset: {
    id: 'sketchOffset',
    label: 'Offset',
    icon: 'sketch-offset',
    category: 'sketch',
    hint: 'Copy curves at a distance.',
    shortcut: 'O',
    comesWith: 'P1-10',
  },
  coincident: {
    id: 'coincident',
    label: 'Coincident',
    icon: 'coincident',
    category: 'sketch',
    hint: 'Join two points, or put a point on a curve.',
  },
  collinear: {
    id: 'collinear',
    label: 'Collinear',
    icon: 'collinear',
    category: 'sketch',
    hint: 'Put two lines on one straight line.',
  },
  concentric: {
    id: 'concentric',
    label: 'Concentric',
    icon: 'concentric',
    category: 'sketch',
    hint: 'Give circles and arcs the same center.',
  },
  midpoint: {
    id: 'midpoint',
    label: 'Midpoint',
    icon: 'midpoint',
    category: 'sketch',
    hint: 'Put a point at the middle of a line or an arc.',
  },
  fix: {
    id: 'fix',
    label: 'Fix/Unfix',
    icon: 'fix',
    category: 'sketch',
    hint: 'Lock something in place, or free it again.',
  },
  parallel: {
    id: 'parallel',
    label: 'Parallel',
    icon: 'parallel',
    category: 'sketch',
    hint: 'Make lines parallel.',
  },
  perpendicular: {
    id: 'perpendicular',
    label: 'Perpendicular',
    icon: 'perpendicular',
    category: 'sketch',
    hint: 'Make two lines meet at a right angle.',
  },
  horizontal: {
    id: 'horizontal',
    label: 'Horizontal',
    icon: 'horizontal',
    category: 'sketch',
    hint: 'Make a line horizontal, or line up two points.',
  },
  vertical: {
    id: 'vertical',
    label: 'Vertical',
    icon: 'vertical',
    category: 'sketch',
    hint: 'Make a line vertical, or line up two points.',
  },
  tangent: {
    id: 'tangent',
    label: 'Tangent',
    icon: 'tangent',
    category: 'sketch',
    hint: 'Make a curve touch another without a corner.',
  },
  smooth: {
    id: 'smooth',
    label: 'Smooth',
    icon: 'smooth',
    category: 'sketch',
    hint: 'Join curves with no jump in curvature (G2).',
  },
  equal: {
    id: 'equal',
    label: 'Equal',
    icon: 'equal',
    category: 'sketch',
    hint: 'Give lines the same length, or circles the same radius.',
  },
  symmetric: {
    id: 'symmetric',
    label: 'Symmetric',
    icon: 'symmetric',
    category: 'sketch',
    hint: 'Mirror two things about a line.',
  },
  extrude: {
    id: 'extrude',
    label: 'Extrude',
    icon: 'extrude',
    category: 'create',
    hint: 'Pull a profile into a solid.',
    shortcut: 'E',
    comesWith: 'P2-06',
  },
  revolve: {
    id: 'revolve',
    label: 'Revolve',
    icon: 'revolve',
    category: 'create',
    hint: 'Spin a profile around an axis.',
    comesWith: 'P2-07',
  },
  box: {
    id: 'box',
    label: 'Box',
    icon: 'box',
    category: 'create',
    hint: 'A box from a size and a position.',
    comesWith: 'P2-10',
  },
  hole: {
    id: 'hole',
    label: 'Hole',
    icon: 'hole',
    category: 'create',
    hint: 'Simple, counterbored or countersunk holes.',
    shortcut: 'H',
    comesWith: 'P3-04',
  },
  pattern: {
    id: 'pattern',
    label: 'Rectangular Pattern',
    short: 'Pattern',
    icon: 'rectangular-pattern',
    category: 'create',
    hint: 'Copies in rows and columns.',
    comesWith: 'P3-07',
  },
  fillet: {
    id: 'fillet',
    label: 'Fillet',
    icon: 'fillet',
    category: 'modify',
    hint: 'Round the selected edges.',
    shortcut: 'F',
    comesWith: 'P3-01',
  },
  chamfer: {
    id: 'chamfer',
    label: 'Chamfer',
    icon: 'chamfer',
    category: 'modify',
    hint: 'Bevel the selected edges.',
    comesWith: 'P3-02',
  },
  shell: {
    id: 'shell',
    label: 'Shell',
    icon: 'shell',
    category: 'modify',
    hint: 'Hollow out a body, leaving walls.',
    comesWith: 'P3-03',
  },
  parameters: {
    id: 'parameters',
    label: 'Parameters',
    icon: 'parameters',
    category: 'modify',
    hint: 'Named values and expressions that drive the model.',
  },
  plane: {
    id: 'plane',
    label: 'Offset Plane',
    icon: 'offset-plane',
    category: 'construct',
    hint: 'A plane parallel to a face or plane.',
    comesWith: 'P3-05',
  },
  axis: {
    id: 'axis',
    label: 'Axis',
    icon: 'axis',
    category: 'construct',
    hint: 'A construction axis for revolves and patterns.',
    comesWith: 'P3-05',
  },
  measure: {
    id: 'measure',
    label: 'Measure',
    icon: 'measure',
    category: 'inspect',
    hint: 'Distances, angles and areas.',
    shortcut: 'I',
    comesWith: 'P2-13',
  },
  insertSvg: {
    id: 'insertSvg',
    label: 'Insert SVG',
    icon: 'insert-svg',
    category: 'insert',
    hint: 'Bring in an SVG as a sketch.',
    comesWith: 'P4-06',
  },
  export: {
    id: 'export',
    label: 'Export',
    icon: 'export',
    category: 'export',
    hint: 'STL, 3MF or STEP for printing and sharing.',
    comesWith: 'P2-12',
  },
  placeOnBed: {
    id: 'placeOnBed',
    label: 'Place on Bed',
    icon: 'place-on-bed',
    category: 'export',
    hint: 'Turn a face down onto the print bed.',
    comesWith: 'P3-10',
  },
  slicer: {
    id: 'slicer',
    label: 'Send to Slicer',
    icon: 'send-to-slicer',
    category: 'export',
    hint: 'Open the model in your slicer.',
    comesWith: 'P4-08',
  },
} satisfies Record<string, Tool>;

export type ToolId = keyof typeof TOOLS;

export interface ToolGroup {
  label: string;
  /** Shown as buttons; the group's menu lists these plus `more`. */
  tools: ToolId[];
  more?: ToolId[];
  /** Small icon-only buttons in two rows (UI spec §4: the row of constraint icons). */
  compact?: boolean;
}

export type TabId = 'solid' | 'sketch' | 'print';

/**
 * Toolbar tabs (UI spec §2). `sketch` shows only while a sketch is open, in
 * place of `solid`; Finish Sketch sits after its groups.
 */
export const TABS: { id: TabId; label: string; groups: ToolGroup[] }[] = [
  {
    id: 'solid',
    label: 'Solid',
    groups: [
      {
        label: 'Create',
        tools: ['sketch', 'extrude', 'revolve'],
        more: ['box', 'hole', 'pattern'],
      },
      { label: 'Modify', tools: ['fillet', 'chamfer', 'shell', 'parameters'] },
      { label: 'Construct', tools: ['plane'], more: ['axis'] },
      { label: 'Inspect', tools: ['measure'] },
      { label: 'Insert', tools: ['insertSvg'] },
      { label: 'Export', tools: ['export'] },
    ],
  },
  {
    id: 'sketch',
    label: 'Sketch',
    groups: [
      {
        label: 'Create',
        tools: ['line', 'rectangle', 'circle', 'arc', 'dimension'],
        more: [
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
        ],
      },
      { label: 'Modify', tools: ['trim', 'sketchOffset'] },
      {
        label: 'Constraints',
        compact: true,
        tools: [
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
        ],
      },
      { label: 'Inspect', tools: ['measure'] },
    ],
  },
  {
    id: 'print',
    label: '3D Print',
    groups: [
      { label: 'Prepare', tools: ['placeOnBed', 'measure'] },
      { label: 'Output', tools: ['export', 'slicer'] },
    ],
  },
];

/** The tool that made a feature, for its timeline chip. Unknown types show as a sketch. */
export function toolForFeature(type: string): Tool {
  return (TOOLS as Record<string, Tool>)[type] ?? TOOLS.sketch;
}
