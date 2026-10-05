/**
 * `@extrudo/sketch/build`: the pure builders that put geometry into a sketch.
 *
 * The drawing tools (`apps/web/src/sketch/tools/`) and `@extrudo/api`'s
 * `SketchBuilder` (ADR-0068 §5) both write through these, so a rectangle the
 * Rectangle tool draws and one a script makes are the same four lines with the
 * same constraints. Nothing here knows about a pointer, the stores or the DOM;
 * an `edit` is the three maps a sketch change carries and an `ids` is an ID
 * factory plus the construction flag.
 */
export {
  type ArcPoints,
  addArc,
  addCircle,
  addDimension,
  addEllipse,
  addEntity,
  addLine,
  addPoint,
  addSpline,
  addText,
  type BuildIds,
  constrain,
  constrainOne,
  emptyAdd,
  type SketchAdd,
  type TextContent,
} from './add';
export {
  arcEndDirection,
  axisOf,
  type CurveEnd,
  curveEnd,
  place,
  type Typed,
  tangentJoin,
  throughPoint,
  typedEnd,
} from './inference';
export {
  type AddedArc,
  type AddedLine,
  type PolygonMode,
  type PolygonResult,
  type PolygonShape,
  polygonAround,
  polygonEdit,
  polygonOnEdge,
  type RectangleMode,
  type RectangleResult,
  rectangleEdit,
  type SlotMode,
  type SlotResult,
  type SlotShape,
  slotEdit,
  slotOutline,
  slotShape,
} from './shapes';
