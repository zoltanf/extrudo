/**
 * The tool catalogue for the toolbar, the timeline chips and command search.
 * Tools that aren't built yet are listed with the task that brings them, so
 * the shell shows the real layout (UI spec §2) without pretending they work.
 * Their keys are in `commands/keymap.ts`.
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
  project: {
    id: 'project',
    label: 'Project',
    icon: 'project',
    category: 'sketch',
    hint: 'Bring body edges, faces, vertices and bodies into the sketch; they follow the model.',
  },
  intersect: {
    id: 'intersect',
    label: 'Intersect',
    icon: 'intersect',
    category: 'sketch',
    hint: 'Bring in the curves where a face or body meets the sketch plane; they follow the model.',
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
  },
  rectangle: {
    id: 'rectangle',
    label: '2-Point Rectangle',
    short: 'Rectangle',
    icon: 'rectangle',
    category: 'sketch',
    hint: 'From two opposite corners. Type the width, Tab to the height.',
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
  splineControl: {
    id: 'splineControl',
    label: 'Control Point Spline',
    short: 'Control Spline',
    icon: 'spline-control',
    category: 'sketch',
    hint: 'A smooth curve guided by the points you click. Enter to finish.',
  },
  conic: {
    id: 'conic',
    label: 'Conic',
    icon: 'conic',
    category: 'sketch',
    hint: 'A conic from its two ends and the shoulder point. Rho sets how full it is.',
  },
  text: {
    id: 'text',
    label: 'Text',
    icon: 'text',
    category: 'sketch',
    hint: 'Type text on the sketch. Its letters are closed regions like any other profile.',
  },
  importDrawing: {
    id: 'importDrawing',
    label: 'Import Drawing…',
    short: 'Import Drawing',
    icon: 'insert-svg',
    category: 'sketch',
    hint: 'Bring an SVG or DXF drawing into the sketch as ordinary curves.',
  },
  dimension: {
    id: 'dimension',
    label: 'Sketch Dimension',
    short: 'Dimension',
    icon: 'sketch-dimension',
    category: 'sketch',
    hint: 'Lengths, radii and angles that drive the sketch.',
  },
  sketchMirror: {
    id: 'sketchMirror',
    label: 'Mirror',
    icon: 'mirror',
    category: 'sketch',
    hint: 'Mirror curves about a line; the copies stay symmetric.',
  },
  sketchRectangularPattern: {
    id: 'sketchRectangularPattern',
    label: 'Rectangular Pattern',
    icon: 'rectangular-pattern',
    category: 'sketch',
    hint: 'Copies in rows and columns. Type the counts and spacing.',
  },
  sketchCircularPattern: {
    id: 'sketchCircularPattern',
    label: 'Circular Pattern',
    icon: 'circular-pattern',
    category: 'sketch',
    hint: 'Copies around a center. Type the count and the angle.',
  },
  sketchFillet: {
    id: 'sketchFillet',
    label: 'Sketch Fillet',
    short: 'Fillet',
    icon: 'fillet',
    category: 'sketch',
    hint: 'Round the corner between two lines. Type the radius.',
  },
  sketchChamfer: {
    id: 'sketchChamfer',
    label: 'Sketch Chamfer',
    short: 'Chamfer',
    icon: 'chamfer',
    category: 'sketch',
    hint: 'Cut the corner between two lines. Type the distance.',
  },
  trim: {
    id: 'trim',
    label: 'Trim',
    icon: 'trim',
    category: 'sketch',
    hint: 'Cut curves back to where they cross.',
  },
  extend: {
    id: 'extend',
    label: 'Extend',
    icon: 'extend',
    category: 'sketch',
    hint: 'Lengthen a line or an arc to the next curve.',
  },
  break: {
    id: 'break',
    label: 'Break',
    icon: 'break',
    category: 'sketch',
    hint: 'Split a curve where other curves cross it.',
  },
  sketchOffset: {
    id: 'sketchOffset',
    label: 'Offset',
    icon: 'sketch-offset',
    category: 'sketch',
    hint: 'Copy a chain of curves at a distance. Type the distance.',
  },
  sketchMove: {
    id: 'sketchMove',
    label: 'Move',
    icon: 'move',
    category: 'sketch',
    hint: 'Move curves from one point to another; constraints come along.',
  },
  sketchCopy: {
    id: 'sketchCopy',
    label: 'Copy',
    icon: 'copy',
    category: 'sketch',
    hint: 'Copy curves from one point to another, as often as you click.',
  },
  sketchScale: {
    id: 'sketchScale',
    label: 'Sketch Scale',
    short: 'Scale',
    icon: 'scale',
    category: 'sketch',
    hint: 'Scale curves about a point, with their dimensions.',
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
    hint: 'Pull a profile into a solid, or push and pull a flat face.',
  },
  revolve: {
    id: 'revolve',
    label: 'Revolve',
    icon: 'revolve',
    category: 'create',
    hint: 'Spin a profile around an axis.',
  },
  box: {
    id: 'box',
    label: 'Box',
    icon: 'box',
    category: 'create',
    hint: 'A box on a plane or a flat face, from its length, width and height.',
  },
  cylinder: {
    id: 'cylinder',
    label: 'Cylinder',
    icon: 'cylinder',
    category: 'create',
    hint: 'A cylinder on a plane or a flat face, from its diameter and height.',
  },
  sphere: {
    id: 'sphere',
    label: 'Sphere',
    icon: 'sphere',
    category: 'create',
    hint: 'A sphere centred on a plane or a flat face.',
  },
  torus: {
    id: 'torus',
    label: 'Torus',
    icon: 'torus',
    category: 'create',
    hint: 'A ring centred on a plane or a flat face, from its diameter and tube diameter.',
  },
  sweep: {
    id: 'sweep',
    label: 'Sweep',
    icon: 'sweep',
    category: 'create',
    hint: 'Move profiles along a path of sketch curves or edges, with an optional twist and end scale.',
  },
  loft: {
    id: 'loft',
    label: 'Loft',
    icon: 'loft',
    category: 'create',
    hint: 'A solid through profiles on different planes, in order; a point can start or end it.',
  },
  coil: {
    id: 'coil',
    label: 'Coil',
    icon: 'coil',
    category: 'create',
    hint: 'A spring: a circle, square or triangle wound along a helix, from its turns, height and pitch.',
  },
  emboss: {
    id: 'emboss',
    label: 'Emboss',
    icon: 'emboss',
    category: 'create',
    hint: 'Raise the letters of a sketch, or a whole text, off a face, or press them into it; round a cylinder or a cone they keep their width.',
  },
  script: {
    id: 'script',
    label: 'Script',
    icon: 'script',
    category: 'create',
    hint: 'Make features with TypeScript or JavaScript, using the design’s parameters.',
  },
  recordMacro: {
    id: 'recordMacro',
    label: 'Record Macro',
    icon: 'record-macro',
    category: 'create',
    hint: 'Start recording: what you make from here on becomes code you can keep as a Script.',
  },
  stopMacro: {
    id: 'stopMacro',
    label: 'Stop Macro',
    icon: 'stop-macro',
    category: 'create',
    hint: 'Stop recording and see the code for what you made.',
  },
  rib: {
    id: 'rib',
    label: 'Rib',
    icon: 'rib',
    category: 'create',
    hint: 'A thin wall from a sketch line to the body.',
  },
  hole: {
    id: 'hole',
    label: 'Hole',
    icon: 'hole',
    category: 'create',
    hint: 'Simple, counterbored or countersunk holes, blind or through, at a click or at sketch points.',
  },
  rectangularPattern: {
    id: 'rectangularPattern',
    label: 'Rectangular Pattern',
    // The tiles stand in the Pattern group (ADR-0079), which says what they are.
    short: 'Rectangular',
    icon: 'rectangular-pattern',
    category: 'create',
    hint: 'Copies of bodies, or repeats of features, in a row or a grid.',
  },
  circularPattern: {
    id: 'circularPattern',
    label: 'Circular Pattern',
    short: 'Circular',
    icon: 'circular-pattern',
    category: 'create',
    hint: 'Copies of bodies, or repeats of features, spread round an axis.',
  },
  pathPattern: {
    id: 'pathPattern',
    label: 'Path Pattern',
    short: 'Path',
    icon: 'path-pattern',
    category: 'create',
    hint: 'Copies of bodies, or repeats of features, along sketch curves or edges.',
  },
  fillet: {
    id: 'fillet',
    label: 'Fillet',
    icon: 'fillet',
    category: 'modify',
    hint: 'Round the selected edges.',
  },
  chamfer: {
    id: 'chamfer',
    label: 'Chamfer',
    icon: 'chamfer',
    category: 'modify',
    hint: 'Bevel the selected edges.',
  },
  shell: {
    id: 'shell',
    label: 'Shell',
    icon: 'shell',
    category: 'modify',
    hint: 'Hollow out a body, leaving walls.',
  },
  pressPull: {
    id: 'pressPull',
    label: 'Press Pull',
    icon: 'press-pull',
    category: 'modify',
    hint: 'Push or pull what is selected: a face moves, an edge is rounded, a sketch profile is extruded.',
  },
  offsetFace: {
    id: 'offsetFace',
    label: 'Offset Face',
    icon: 'offset-face',
    category: 'modify',
    hint: 'Move faces along their normals; the faces next to them follow. A curved wall changes its radius.',
  },
  splitBody: {
    id: 'splitBody',
    label: 'Split Body',
    short: 'Split',
    icon: 'split-body',
    category: 'modify',
    hint: 'Cut bodies in two along a plane or a flat face; each side becomes a body. Keep both or one.',
  },
  scale: {
    id: 'scale',
    label: 'Scale',
    icon: 'scale',
    category: 'modify',
    hint: 'Make bodies larger or smaller about a point, by one factor or one per axis.',
  },
  draft: {
    id: 'draft',
    label: 'Draft',
    icon: 'draft',
    category: 'modify',
    hint: 'Tilt faces by a few degrees about a plane, so the part comes off the bed or out of a mould.',
  },
  thread: {
    id: 'thread',
    label: 'Thread',
    icon: 'thread',
    category: 'modify',
    hint: 'A real, printable screw thread on a shaft or in a hole: ISO metric or inch, with a print clearance.',
  },
  remove: {
    id: 'remove',
    label: 'Remove',
    icon: 'remove',
    category: 'modify',
    hint: 'Take bodies out of the model: select them and press Delete, or use a body menu.',
  },
  move: {
    id: 'move',
    label: 'Move/Copy',
    short: 'Move',
    icon: 'move',
    category: 'modify',
    hint: 'Move or turn bodies with the gizmo, about an axis or point to point. Copy keeps the original.',
  },
  mirror: {
    id: 'mirror',
    label: 'Mirror',
    icon: 'mirror',
    category: 'modify',
    hint: 'Mirror bodies about a plane or a flat face, as copies or in place.',
  },
  combine: {
    id: 'combine',
    label: 'Combine',
    icon: 'combine',
    category: 'modify',
    hint: 'Join, cut or intersect a target body with tool bodies.',
  },
  parameters: {
    id: 'parameters',
    label: 'Parameters',
    icon: 'parameters',
    category: 'modify',
    hint: 'Named values and expressions that drive the model.',
  },
  customizer: {
    id: 'customizer',
    label: 'Customizer',
    icon: 'customizer',
    category: 'modify',
    hint: 'The few parameters this design exposes, with sliders, and named configurations.',
  },
  offsetPlane: {
    id: 'offsetPlane',
    label: 'Offset Plane',
    icon: 'offset-plane',
    category: 'construct',
    hint: 'A plane parallel to a plane or a flat face, a distance away.',
  },
  planeAtAngle: {
    id: 'planeAtAngle',
    label: 'Plane at Angle',
    short: 'Angle Plane',
    icon: 'plane-angle',
    category: 'construct',
    hint: 'A plane turned about a line, at an angle from a reference plane.',
  },
  midplane: {
    id: 'midplane',
    label: 'Midplane',
    icon: 'midplane',
    category: 'construct',
    hint: 'The plane halfway between two parallel planes or faces.',
  },
  planeThroughPoints: {
    id: 'planeThroughPoints',
    label: 'Plane Through 3 Points',
    short: 'Plane Through 3 Points',
    icon: 'plane-3-points',
    category: 'construct',
    hint: 'A plane through three points.',
  },
  tangentPlane: {
    id: 'tangentPlane',
    label: 'Tangent Plane',
    icon: 'plane-tangent',
    category: 'construct',
    hint: 'A plane touching a cylindrical, conical or spherical face.',
  },
  axisThroughPoints: {
    id: 'axisThroughPoints',
    label: 'Axis Through 2 Points',
    short: '2-Point Axis',
    icon: 'axis',
    category: 'construct',
    hint: 'A construction axis through two points, for revolves and patterns.',
  },
  axisThroughCylinder: {
    id: 'axisThroughCylinder',
    label: 'Axis Through Cylinder',
    short: 'Cylinder Axis',
    icon: 'axis-cylinder',
    category: 'construct',
    hint: 'The axis of a cylindrical, conical or toroidal face.',
  },
  axisAlongEdge: {
    id: 'axisAlongEdge',
    label: 'Axis Along Edge',
    short: 'Edge Axis',
    icon: 'axis-edge',
    category: 'construct',
    hint: 'An axis along a straight edge or sketch line, or through a circular edge.',
  },
  constructionPoint: {
    id: 'constructionPoint',
    label: 'Point',
    icon: 'point',
    category: 'construct',
    hint: 'A construction point at a vertex, a circle center, a face center or coordinates.',
  },
  pointOnPath: {
    id: 'pointOnPath',
    label: 'Point on Path',
    short: 'Path Point',
    icon: 'point',
    category: 'construct',
    hint: 'A point a fraction or a length along a path of sketch curves and edges.',
  },
  pointAtIntersection: {
    id: 'pointAtIntersection',
    label: 'Point at Intersection',
    short: 'Intersection Point',
    icon: 'point',
    category: 'construct',
    hint: 'The point where two edges, an edge and a plane, or three planes meet.',
  },
  planeAlongPath: {
    id: 'planeAlongPath',
    label: 'Plane Along Path',
    short: 'Plane Along Path',
    icon: 'plane-angle',
    category: 'construct',
    hint: 'A plane square to a path at a point on it, for a sweep to draw its section on.',
  },
  midplaneAngled: {
    id: 'midplaneAngled',
    label: 'Angled Midplane',
    short: 'Angled Midplane',
    icon: 'midplane',
    category: 'construct',
    hint: 'The plane that bisects two non-parallel planes or flat faces.',
  },
  measure: {
    id: 'measure',
    label: 'Measure',
    icon: 'measure',
    category: 'inspect',
    hint: 'Distances, angles, areas and volumes. Pick one thing, or two to measure between.',
  },
  section: {
    id: 'section',
    label: 'Section Analysis',
    short: 'Section',
    icon: 'section',
    category: 'inspect',
    hint: 'Cut the view through a plane, with the cut filled in. Look inside without changing the model.',
  },
  importBody: {
    id: 'importBody',
    label: 'Import STEP, mesh or OpenSCAD…',
    short: 'Import Model',
    icon: 'insert-svg',
    category: 'insert',
    hint: 'Bring in a STEP file, a mesh (STL, 3MF, OBJ) or an OpenSCAD file as bodies you can cut, combine and print.',
  },
  canvas: {
    id: 'canvas',
    label: 'Canvas',
    icon: 'canvas',
    category: 'insert',
    hint: 'Lay a picture on a plane as a reference to trace, and calibrate it to real scale.',
  },
  export: {
    id: 'export',
    label: 'Export',
    icon: 'export',
    category: 'export',
    hint: 'STL, 3MF or STEP for printing and sharing.',
  },
  exportSketch: {
    id: 'exportSketch',
    label: 'Export Sketch',
    short: 'Export',
    icon: 'export',
    category: 'export',
    hint: 'Save the sketch or its profiles as SVG or DXF, at 1 unit = 1 mm.',
  },
  placeOnBed: {
    id: 'placeOnBed',
    label: 'Place on Bed',
    icon: 'place-on-bed',
    category: 'export',
    hint: 'Turn a flat face down onto the print bed: the body turns with it.',
  },
  printInfo: {
    id: 'printInfo',
    label: 'Print Info',
    icon: 'print-info',
    category: 'export',
    hint: 'Volume, weight and filament length for PLA, PETG, ABS, TPU or your own density.',
  },
  tolerance: {
    id: 'tolerance',
    label: 'Tolerance',
    icon: 'tolerance',
    category: 'export',
    hint: 'How much room a printed fit gets: hole presets and threads add it to their sizes.',
  },
  overhang: {
    id: 'overhang',
    label: 'Overhang Analysis',
    short: 'Overhangs',
    icon: 'overhang',
    category: 'export',
    hint: 'Shade the faces that lean out more than an angle: they need support to print.',
  },
  wallThickness: {
    id: 'wallThickness',
    label: 'Wall Thickness',
    icon: 'wall-thickness',
    category: 'export',
    hint: 'Shade the walls thinner than a minimum: they print weak or not at all.',
  },
  slicer: {
    id: 'slicer',
    label: 'Send to Slicer',
    icon: 'send-to-slicer',
    category: 'export',
    hint: 'Open the model in your slicer.',
    // Ready where the platform has `openInSlicer`: the desktop app (P6-02, ADR-0062).
    comesWith: 'the desktop app',
  },
  // The Home tab's file actions (ADR-0079): commands, run through the page's `FileActions`
  // (`FILE_COMMANDS`), not tools; listed here for their tiles, icons and hints.
  newDesign: {
    id: 'newDesign',
    label: 'New Design',
    icon: 'new-design',
    category: 'file',
    hint: 'Start a new, empty design.',
  },
  openFile: {
    id: 'openFile',
    label: 'Open File…',
    short: 'Open File',
    icon: 'import-design',
    category: 'file',
    hint: 'Open an .extrudo file from disk: the design stays linked to that file.',
  },
  saveAs: {
    id: 'saveAs',
    label: 'Save As…',
    short: 'Save As',
    icon: 'export-design',
    category: 'file',
    hint: 'Save this design as an .extrudo file on disk and keep it linked to that file.',
  },
  allDesigns: {
    id: 'allDesigns',
    label: 'All Designs',
    icon: 'all-designs',
    category: 'file',
    hint: 'Back to the home screen with every design in this browser.',
  },
  saveVersion: {
    id: 'saveVersion',
    label: 'Save Version…',
    short: 'Save Version',
    icon: 'save-version',
    category: 'file',
    hint: 'Keep this state of the design with a description, to come back to later.',
  },
  versionHistory: {
    id: 'versionHistory',
    label: 'Version History…',
    short: 'Version History',
    icon: 'version-history',
    category: 'file',
    hint: 'Saved versions of this design: save one, restore one, or open one as a copy.',
  },
  exportProject: {
    id: 'exportProject',
    label: 'Export .extrudo',
    short: 'Export Design',
    icon: 'export-design',
    category: 'file',
    hint: 'Download the whole design as an .extrudo file, with its versions and attachments.',
  },
  exportScript: {
    id: 'exportScript',
    label: 'Export Design as Script…',
    short: 'Export as Script',
    icon: 'export-script',
    category: 'file',
    hint: 'Download the design as TypeScript that makes it again with the document API.',
  },
  importProject: {
    id: 'importProject',
    label: 'Import .extrudo…',
    short: 'Import Design',
    icon: 'import-design',
    category: 'file',
    hint: 'Open an .extrudo file as a new design.',
  },
  saveToLinkedFolder: {
    id: 'saveToLinkedFolder',
    label: 'Save to Linked Folder',
    short: 'Save to Linked Folder',
    icon: 'linked-folder',
    category: 'file',
    hint: 'Keep this design as an .extrudo file in the linked folder on disk.',
  },
  plugins: {
    id: 'plugins',
    label: 'Plugins…',
    short: 'Plugins',
    icon: 'plugins',
    category: 'file',
    hint: 'Install, enable and remove plugins: custom features and commands.',
  },
} satisfies Record<string, Tool>;

export type ToolId = keyof typeof TOOLS;

export interface ToolGroup {
  label: string;
  /** Shown as tiles while they fit (ADR-0079 §3); the group's ▾ menu lists the ones that don't, then `more`. */
  tools: ToolId[];
  more?: ToolId[];
  /** Small icon-only buttons in two rows (UI spec §4: the row of constraint icons). */
  compact?: boolean;
  /** A tile's label in this group when it differs from the tool's (Home's "Export Model"). */
  labels?: Partial<Record<ToolId, string>>;
}

export type TabId = 'home' | 'solid' | 'modify' | 'construct' | 'inspect' | 'sketch' | 'print';

export interface Tab {
  id: TabId;
  label: string;
  groups: ToolGroup[];
}

/**
 * Toolbar tabs (UI spec §2, ADR-0079). Home holds what concerns the design as a
 * whole (its files, versions, parameters and plugins: the old File menu and the
 * Insert tab); Solid makes geometry, Modify changes it, Construct and Inspect
 * have tabs of their own, and 3D Print prepares the model's export. `sketch`
 * shows only while a sketch is open, in place of Solid, Modify, Construct and
 * Inspect, whose tools don't apply there; Finish Sketch sits after its groups.
 */
export const TABS: Tab[] = [
  {
    id: 'home',
    label: 'Home',
    groups: [
      { label: 'Design', tools: ['newDesign', 'openFile', 'saveAs', 'allDesigns'] },
      { label: 'Versions', tools: ['saveVersion', 'versionHistory'] },
      {
        label: 'Files',
        // P4-06: a model file becomes bodies, a drawing becomes sketch curves, and a
        // picture lies on a plane to trace (ADR-0066).
        tools: [
          'importProject',
          'importBody',
          'importDrawing',
          'canvas',
          'exportProject',
          'export',
          'exportScript',
          'saveToLinkedFolder',
        ],
        labels: { export: 'Export Model' },
      },
      // What a design exposes is a few of its parameters (P4-07).
      { label: 'Parameters', tools: ['parameters', 'customizer'] },
      { label: 'Extend', tools: ['plugins'] },
    ],
  },
  {
    id: 'solid',
    label: 'Solid',
    groups: [
      // The enabled plugins' custom features are listed in Create's menu (P6-03).
      { label: 'Create', tools: ['sketch', 'extrude', 'revolve', 'sweep', 'loft', 'coil'] },
      { label: 'Primitives', tools: ['box', 'cylinder', 'sphere', 'torus'] },
      { label: 'Features', tools: ['hole', 'emboss', 'rib'] },
      { label: 'Pattern', tools: ['rectangularPattern', 'circularPattern', 'pathPattern'] },
      // Record and Stop show one at a time (P5-05).
      { label: 'Program', tools: ['script', 'recordMacro', 'stopMacro'] },
    ],
  },
  {
    id: 'modify',
    label: 'Modify',
    groups: [
      {
        label: 'Modify',
        tools: ['pressPull', 'fillet', 'chamfer', 'shell', 'offsetFace', 'draft', 'thread'],
      },
      { label: 'Transform', tools: ['move', 'mirror', 'combine', 'splitBody', 'scale'] },
    ],
  },
  {
    id: 'construct',
    label: 'Construct',
    groups: [
      {
        label: 'Planes',
        tools: [
          'offsetPlane',
          'planeAtAngle',
          'midplane',
          'tangentPlane',
          'planeThroughPoints',
          'planeAlongPath',
          'midplaneAngled',
        ],
      },
      { label: 'Axes', tools: ['axisThroughPoints', 'axisThroughCylinder', 'axisAlongEdge'] },
      { label: 'Points', tools: ['constructionPoint', 'pointOnPath', 'pointAtIntersection'] },
    ],
  },
  {
    id: 'inspect',
    label: 'Inspect',
    groups: [{ label: 'Inspect', tools: ['measure', 'section'] }],
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
          'splineControl',
          'conic',
          'text',
          'importDrawing',
          'project',
          'intersect',
          'sketchMirror',
          'sketchRectangularPattern',
          'sketchCircularPattern',
        ],
      },
      {
        label: 'Modify',
        // Parameters too, as in the Home tab: dimensions use them while sketching.
        tools: ['sketchFillet', 'trim', 'sketchOffset', 'parameters'],
        more: ['sketchChamfer', 'extend', 'break', 'sketchMove', 'sketchCopy', 'sketchScale'],
      },
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
      // Measure works on bodies (P2-13); measuring sketch geometry comes later.
      { label: 'Export', tools: ['exportSketch'] },
    ],
  },
  {
    id: 'print',
    label: '3D Print',
    groups: [
      {
        label: 'Prepare',
        tools: ['placeOnBed', 'measure', 'printInfo', 'tolerance', 'overhang', 'wallThickness'],
      },
      { label: 'Output', tools: ['export', 'slicer'] },
    ],
  },
];

/** The tabs a sketch replaces with its own (ADR-0079 §2): their tools work on bodies. */
const MODEL_ONLY: ReadonlySet<TabId> = new Set(['solid', 'modify', 'construct', 'inspect']);

/**
 * The tabs shown in a mode, in order: Home, Solid, Modify, Construct, Inspect and
 * 3D Print in the model; Home, Sketch and 3D Print while a sketch is open.
 */
export function visibleTabs(mode: 'model' | 'sketch'): Tab[] {
  return TABS.filter((t) => (mode === 'sketch' ? !MODEL_ONLY.has(t.id) : t.id !== 'sketch'));
}

/** The tab a mode opens on: Solid in the model, Sketch in a sketch. */
export function defaultTab(mode: 'model' | 'sketch'): TabId {
  return mode === 'sketch' ? 'sketch' : 'solid';
}

/** The first visible tab whose groups list a tool (as a tile or in a menu). */
export function tabOfTool(id: string, mode: 'model' | 'sketch'): TabId | undefined {
  return visibleTabs(mode).find((tab) =>
    tab.groups.some((g) => [...g.tools, ...(g.more ?? [])].includes(id as ToolId)),
  )?.id;
}

/**
 * The Home tab's file commands (ADR-0079): which `FileActions` method each runs.
 * A command whose method the page leaves out (Save to Linked Folder without a
 * linked folder) is not offered, as the File menu left the item out.
 */
export const FILE_COMMANDS = {
  newDesign: 'newDesign',
  // Desktop only (ADR-0075, 2026-10-09): the page leaves the methods out on the web.
  openFile: 'openFile',
  saveAs: 'saveAs',
  allDesigns: 'home',
  saveVersion: 'saveVersion',
  versionHistory: 'versionHistory',
  exportProject: 'exportFile',
  exportScript: 'exportScript',
  importProject: 'importFile',
  saveToLinkedFolder: 'saveToLinkedFolder',
  plugins: 'plugins',
} as const satisfies Partial<Record<ToolId, string>>;

export type FileCommandId = keyof typeof FILE_COMMANDS;

export const isFileCommand = (id: string): id is FileCommandId => id in FILE_COMMANDS;

/** The tool that made a feature, for its timeline chip. Unknown types show as a sketch. */
export function toolForFeature(type: string): Tool {
  // The Wall bracket template's placeholder `plane` type, from before P3-05.
  if (type === 'plane') return TOOLS.offsetPlane;
  return (TOOLS as Record<string, Tool>)[type] ?? TOOLS.sketch;
}
