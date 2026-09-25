/**
 * The tool catalogue for the toolbar and the timeline chips. Tools that
 * aren't built yet are listed with the task that brings them, so the shell
 * shows the real layout (UI spec §2) without pretending they work.
 */
import type { IconName, ToolCategory } from '../design-system';

export interface Tool {
  id: string;
  label: string;
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
    comesWith: 'P1-01',
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
}

export const TABS: { id: 'solid' | 'print'; label: string; groups: ToolGroup[] }[] = [
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
