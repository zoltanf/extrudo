/**
 * Construction geometry (P3-05, ADR-0040, FR-FT-13): planes, axes and points
 * that make no body but give other features something to sit on, turn about
 * or measure from. Each is a feature of its own type in the timeline; the
 * kernel adds the evaluators and the web app the dialogs, each in its own
 * registry keyed by the types here (ADR-0003).
 *
 * | Type | Makes | From |
 * |---|---|---|
 * | `offsetPlane` | plane | a plane or flat face, moved along its normal by `distance` |
 * | `planeAtAngle` | plane | a line (axis, straight edge, sketch line) turned by `angle` from a reference plane |
 * | `midplane` | plane | two parallel planes or flat faces: the one halfway between |
 * | `planeThroughPoints` | plane | three points (construction points or vertices) |
 * | `tangentPlane` | plane | a cylindrical, conical or spherical face, touching it at `angle` |
 * | `axisThroughPoints` | axis | two points |
 * | `axisThroughCylinder` | axis | a cylindrical, conical or toroidal face's own axis |
 * | `axisAlongEdge` | axis | a straight edge or sketch line, or a circular edge's axis |
 * | `constructionPoint` | point | a vertex, point, circular edge's centre or face's centre, moved by `x`, `y`, `z` |
 *
 * P4-12's amendment adds four more (2026-10-06): `pointOnPath` and
 * `planeAlongPath` (a fraction or length along a path of sketch curves and
 * edges, `pathFromRefs`), `pointAtIntersection` (two edges, an edge and a
 * plane, or three planes) and `midplaneAngled` (the bisector of two
 * non-parallel planes). `tangentPlane` gained a `point` for the touching point
 * nearest it, which reaches tori and free-form faces.
 *
 * **References.** A later feature refers to a construction feature with a
 * reference of the kind it makes and the *feature's ID* as the reference ID:
 * `{ kind: 'plane', id: '<feature>' }`, `{ kind: 'axis', … }`,
 * `{ kind: 'point', … }` (`constructionRef`). The IDs of the origin planes
 * and axes (`origin:xy`, `origin:z`) can't clash with a feature's UUID. So a
 * sketch, a primitive's placement, an extrude's "to object", a revolve's
 * axis or another construction feature depends on it through the ordinary
 * rules (`referencedFeatures`, the engine's dependencies, "Fix References").
 *
 * **Geometry.** A plane's frame follows the one rule of a sketch on a flat
 * face (`faceSketchFrame`, ADR-0031), so it depends on the plane alone. The
 * kernel reports each construction feature as a `ConstructionReport`.
 */
import { enumInput, exprOf, refsOf } from './feature-inputs';
import type { FeatureDefinition } from './features';
import type { FeatureId } from './ids';
import { BoolInputSchema, type Feature, type GeomRef, type GeomRefKind } from './schema';
import type { SketchFrame, Vec3 } from './sketch/planes';
import { z } from './zod';

export const OFFSET_PLANE_TYPE = 'offsetPlane';
export const PLANE_AT_ANGLE_TYPE = 'planeAtAngle';
export const MIDPLANE_TYPE = 'midplane';
export const PLANE_THROUGH_POINTS_TYPE = 'planeThroughPoints';
export const TANGENT_PLANE_TYPE = 'tangentPlane';
export const AXIS_THROUGH_POINTS_TYPE = 'axisThroughPoints';
export const AXIS_THROUGH_CYLINDER_TYPE = 'axisThroughCylinder';
export const AXIS_ALONG_EDGE_TYPE = 'axisAlongEdge';
export const CONSTRUCTION_POINT_TYPE = 'constructionPoint';
export const POINT_ON_PATH_TYPE = 'pointOnPath';
export const POINT_AT_INTERSECTION_TYPE = 'pointAtIntersection';
export const PLANE_ALONG_PATH_TYPE = 'planeAlongPath';
export const MIDPLANE_ANGLED_TYPE = 'midplaneAngled';

export const CONSTRUCTION_TYPES = [
  OFFSET_PLANE_TYPE,
  PLANE_AT_ANGLE_TYPE,
  MIDPLANE_TYPE,
  PLANE_THROUGH_POINTS_TYPE,
  TANGENT_PLANE_TYPE,
  AXIS_THROUGH_POINTS_TYPE,
  AXIS_THROUGH_CYLINDER_TYPE,
  AXIS_ALONG_EDGE_TYPE,
  CONSTRUCTION_POINT_TYPE,
  POINT_ON_PATH_TYPE,
  POINT_AT_INTERSECTION_TYPE,
  PLANE_ALONG_PATH_TYPE,
  MIDPLANE_ANGLED_TYPE,
] as const;
export type ConstructionType = (typeof CONSTRUCTION_TYPES)[number];

export function isConstructionType(type: string): type is ConstructionType {
  return (CONSTRUCTION_TYPES as readonly string[]).includes(type);
}

/** What a construction feature makes: the kind of reference to it. */
export type ConstructionKind = 'plane' | 'axis' | 'point';

const KIND_OF: Readonly<Record<ConstructionType, ConstructionKind>> = {
  offsetPlane: 'plane',
  planeAtAngle: 'plane',
  midplane: 'plane',
  planeThroughPoints: 'plane',
  tangentPlane: 'plane',
  axisThroughPoints: 'axis',
  axisThroughCylinder: 'axis',
  axisAlongEdge: 'axis',
  constructionPoint: 'point',
  pointOnPath: 'point',
  pointAtIntersection: 'point',
  planeAlongPath: 'plane',
  midplaneAngled: 'plane',
};

/** What a construction feature type makes. */
export function constructionKindOf(type: ConstructionType): ConstructionKind {
  return KIND_OF[type];
}

/** The reference to what a construction feature makes, or `undefined` for another feature. */
export function constructionRef(feature: Pick<Feature, 'id' | 'type'>): GeomRef | undefined {
  return isConstructionType(feature.type)
    ? { kind: KIND_OF[feature.type], id: feature.id }
    : undefined;
}

/** Whether a plane, axis or point reference names a construction feature (not an origin plane or axis). */
export function isConstructionRef(ref: Pick<GeomRef, 'kind' | 'id'>): boolean {
  return (
    (ref.kind === 'plane' || ref.kind === 'axis' || ref.kind === 'point') &&
    !ref.id.startsWith('origin:')
  );
}

// ------------------------------------------------------------------- reports

/**
 * How a point or plane sits along a path (P4-12): enough for the view's
 * handle when the path is a straight run.
 */
export interface PathAlong {
  /** The path's start. */
  from: Vec3;
  /** Unit direction of the path from its start. */
  tangent: Vec3;
  /** Length along the path (its polyline). */
  length: number;
  /** Whether the whole path is one straight run, so a straight handle is honest. */
  straight: boolean;
}

/**
 * What the kernel reports about a construction feature (`FeatureOutput.data`
 * for the features after it, `.report` for the UI thread: the model store's
 * `construction`). World mm.
 */
export type ConstructionReport =
  | {
      kind: 'plane';
      /** `faceSketchFrame` of the plane: what a sketch on it gets. */
      frame: SketchFrame;
      /** Where the view draws the plane's square: a point of the plane near what it was made from. */
      anchor: Vec3;
      /**
       * How a tangent plane found its touching point when one was asked for
       * (P4-12): the analytic surface, or the display mesh's nearest triangle.
       * Absent for every other plane and for the old tangent rules.
       */
      basis?: 'surface' | 'mesh';
      /** A plane along a path: where along it (P4-12). */
      path?: PathAlong;
    }
  | {
      kind: 'axis';
      /** A point on the axis near what it was made from (where the view draws it). */
      origin: Vec3;
      /** Unit length. */
      direction: Vec3;
    }
  | {
      kind: 'point';
      point: Vec3;
      /** A point on a path: the path's tangent there and where it starts (P4-12). */
      path?: PathAlong;
    };

/** Whether a kernel report is a construction report (the others are sketch reports). */
export function isConstructionReport(report: unknown): report is ConstructionReport {
  const kind = (report as { kind?: unknown } | null | undefined)?.kind;
  return kind === 'plane' || kind === 'axis' || kind === 'point';
}

export type ConstructionReports = Readonly<Record<FeatureId, ConstructionReport>>;

/** The frame of a construction plane reference, when the kernel has reported it. */
export function constructionPlaneFrame(
  ref: Pick<GeomRef, 'kind' | 'id'>,
  reports: ConstructionReports | undefined,
): SketchFrame | undefined {
  if (ref.kind !== 'plane') return undefined;
  const report = reports?.[ref.id as FeatureId];
  return report?.kind === 'plane' ? report.frame : undefined;
}

/** The axis a construction axis reference names (a point on it and its unit direction), if reported. */
export function constructionAxisLine(
  ref: Pick<GeomRef, 'kind' | 'id'>,
  reports: ConstructionReports | undefined,
): { origin: Vec3; direction: Vec3 } | undefined {
  if (ref.kind !== 'axis') return undefined;
  const report = reports?.[ref.id as FeatureId];
  return report?.kind === 'axis'
    ? { origin: report.origin, direction: report.direction }
    : undefined;
}

// -------------------------------------------------------------------- inputs

/** What a plane input takes: origin and construction planes, or a flat face. */
export const PLANE_SOURCE_KINDS: readonly GeomRefKind[] = ['plane', 'face'];
/** What a point input takes: a construction point or a vertex of a body. */
export const POINT_SOURCE_KINDS: readonly GeomRefKind[] = ['point', 'vertex'];
/** A line a plane turns about: an axis (origin or construction), a straight edge or a sketch line. */
export const LINE_SOURCE_KINDS: readonly GeomRefKind[] = ['axis', 'edge', 'sketchEntity'];
/** A path for a point or plane along: the path pattern's sketch curves and edges (ADR-0047). */
export const PATH_SOURCE_KINDS: readonly GeomRefKind[] = ['sketchEntity', 'edge'];
/** What a point at an intersection names: two edges, an edge and a plane, or three planes. */
export const INTERSECTION_SOURCE_KINDS: readonly GeomRefKind[] = ['edge', 'plane', 'face'];

/** How far along a path a point or plane is: a fraction of it, or a length from its start. */
export const PATH_POSITIONS = ['position', 'length'] as const;
export type PathPosition = (typeof PATH_POSITIONS)[number];

const length = (what: string) => exprOf('length').optional().describe(what);
const angle = (what: string) => exprOf('angle').optional().describe(what);

/** The inputs a point or plane on a path shares (`pointOnPath`, `planeAlongPath`). */
const PathPlacement = {
  /** The sketch curves and edges to follow. */
  path: refsOf(PATH_SOURCE_KINDS)
    .optional()
    .describe('The sketch curves and edges to follow, chained end to end.'),
  /** Default `position`. */
  by: enumInput(PATH_POSITIONS)
    .optional()
    .describe(
      'How the place along the path is measured: a fraction of it, or a length from its start. Default position.',
    ),
  /** Default 0.5. */
  position: exprOf('unitless')
    .optional()
    .describe('How far along the path, a fraction from 0 (its start) to 1 (its end). Default 0.5.'),
  /** Only with `by` = `length`. */
  distance: length('How far along the path, a length from its start. Only when By is Length.'),
  /** Default false. */
  flip: BoolInputSchema.optional().describe(
    'Measure from the other end of the path. Default false.',
  ),
};

export const OffsetPlaneInputsSchema = z.strictObject({
  /** The plane or flat face to offset from. Missing: the feature fails until one is picked. */
  plane: refsOf(PLANE_SOURCE_KINDS, 1)
    .optional()
    .describe('The plane or flat face to offset from.'),
  /** Along the plane's normal (a face's outward one); negative goes the other way. Default 0. */
  distance: length("Along the plane's normal; a length. Default 0."),
});
export type OffsetPlaneInputs = z.infer<typeof OffsetPlaneInputsSchema>;

export const PlaneAtAngleInputsSchema = z.strictObject({
  /** The line the plane turns about. */
  axis: refsOf(LINE_SOURCE_KINDS, 1).optional().describe('The line the plane turns about.'),
  /**
   * The plane the angle counts from (right-handed about the axis). Without
   * one, 0° is the plane through the axis that is as horizontal as it can be.
   */
  plane: refsOf(PLANE_SOURCE_KINDS, 1)
    .optional()
    .describe(
      'The plane the angle counts from. Without one, 0 deg is the plane through the axis that is as horizontal as it can be.',
    ),
  /** Default 0. */
  angle: angle('From that plane, right-handed about the axis; an angle. Default 0 deg.'),
});
export type PlaneAtAngleInputs = z.infer<typeof PlaneAtAngleInputsSchema>;

export const MidplaneInputsSchema = z.strictObject({
  /** Two parallel planes or flat faces. */
  planes: refsOf(PLANE_SOURCE_KINDS, 2).optional().describe('Two parallel planes or flat faces.'),
});
export type MidplaneInputs = z.infer<typeof MidplaneInputsSchema>;

export const PlaneThroughPointsInputsSchema = z.strictObject({
  /** Three points that don't lie on one line; the plane's normal follows their order (right-handed). */
  points: refsOf(POINT_SOURCE_KINDS, 3)
    .optional()
    .describe('Three points that do not lie on one line; the normal follows their order.'),
});
export type PlaneThroughPointsInputs = z.infer<typeof PlaneThroughPointsInputsSchema>;

export const TangentPlaneInputsSchema = z.strictObject({
  /** A cylindrical, conical or spherical face. */
  face: refsOf(['face'], 1)
    .optional()
    .describe('The cylindrical, conical or spherical face to touch.'),
  /**
   * The plane that says where round the face the tangent plane touches: it
   * touches where the face's normal is closest to the plane's normal.
   * Without one, a fixed direction square to the face's axis.
   */
  plane: refsOf(PLANE_SOURCE_KINDS, 1)
    .optional()
    .describe(
      "The plane that says where round the face it touches: it touches where the face's normal is closest to this one. Without one, a fixed direction square to the face's axis.",
    ),
  /** Turns the touching point about the face's axis (right-handed), from the reference. Default 0. */
  angle: angle("Turns the touching point about the face's axis; an angle. Default 0 deg."),
  /**
   * The face point nearest this is where it touches (P4-12): a construction
   * point or a vertex. Without it, `plane` and `angle` decide.
   */
  point: refsOf(POINT_SOURCE_KINDS, 1)
    .optional()
    .describe(
      'Touch the face nearest this point (a point or a vertex; a cone too). Without it, the reference plane and angle decide.',
    ),
});
export type TangentPlaneInputs = z.infer<typeof TangentPlaneInputsSchema>;

export const AxisThroughPointsInputsSchema = z.strictObject({
  /** Two different points; the axis points from the first to the second. */
  points: refsOf(POINT_SOURCE_KINDS, 2)
    .optional()
    .describe('Two different points; the axis runs from the first to the second.'),
});
export type AxisThroughPointsInputs = z.infer<typeof AxisThroughPointsInputsSchema>;

export const AxisThroughCylinderInputsSchema = z.strictObject({
  /** A cylindrical, conical or toroidal face (or a face of revolution). */
  face: refsOf(['face'], 1)
    .optional()
    .describe('The round face (a cylinder, cone or torus) whose own axis is taken.'),
});
export type AxisThroughCylinderInputs = z.infer<typeof AxisThroughCylinderInputsSchema>;

export const AxisAlongEdgeInputsSchema = z.strictObject({
  /** A straight edge or sketch line, or a circular edge (the axis through its centre, square to it). */
  edge: refsOf(['edge', 'sketchEntity'], 1)
    .optional()
    .describe('A straight edge or sketch line, or a circular edge (the axis through its centre).'),
});
export type AxisAlongEdgeInputs = z.infer<typeof AxisAlongEdgeInputsSchema>;

export const ConstructionPointInputsSchema = z.strictObject({
  /**
   * Where it starts: a vertex, a construction point, a circular edge (its
   * centre; another edge, its middle) or a face (its centre). Without one, the origin.
   */
  at: refsOf(['point', 'vertex', 'edge', 'face'], 1)
    .optional()
    .describe(
      'What it starts from: a vertex, a point, a circular edge (its centre) or a face (its centre). Without one, the origin.',
    ),
  /** Moves it along the world axes, default 0. */
  x: length('How far it moves along the world X axis; a length. Default 0.'),
  y: length('How far it moves along the world Y axis; a length. Default 0.'),
  z: length('How far it moves along the world Z axis; a length. Default 0.'),
});
export type ConstructionPointInputs = z.infer<typeof ConstructionPointInputsSchema>;

export const PointOnPathInputsSchema = z.strictObject({ ...PathPlacement });
export type PointOnPathInputs = z.infer<typeof PointOnPathInputsSchema>;

export const PlaneAlongPathInputsSchema = z.strictObject({ ...PathPlacement });
export type PlaneAlongPathInputs = z.infer<typeof PlaneAlongPathInputsSchema>;

export const PointAtIntersectionInputsSchema = z.strictObject({
  /** Two edges, an edge and a plane, or three planes that meet at a point. */
  entities: refsOf(INTERSECTION_SOURCE_KINDS, 3)
    .optional()
    .describe('Two edges, an edge and a plane or face, or three planes: they meet at the point.'),
});
export type PointAtIntersectionInputs = z.infer<typeof PointAtIntersectionInputsSchema>;

export const MidplaneAngledInputsSchema = z.strictObject({
  /** Two planes or flat faces that are not parallel. */
  planes: refsOf(PLANE_SOURCE_KINDS, 2)
    .optional()
    .describe('Two planes or flat faces that meet at an angle.'),
  /** Default false: the other bisector. */
  flip: BoolInputSchema.optional().describe('Take the other bisector. Default false.'),
});
export type MidplaneAngledInputs = z.infer<typeof MidplaneAngledInputsSchema>;

const definition = (
  type: ConstructionType,
  label: string,
  icon: string,
  inputsSchema: z.ZodType<unknown>,
): FeatureDefinition =>
  ({ type, label, category: 'construct', icon, inputsSchema }) as unknown as FeatureDefinition;

export const offsetPlaneFeature = definition(
  OFFSET_PLANE_TYPE,
  'Offset Plane',
  'offset-plane',
  OffsetPlaneInputsSchema,
);
export const planeAtAngleFeature = definition(
  PLANE_AT_ANGLE_TYPE,
  'Plane at Angle',
  'plane-angle',
  PlaneAtAngleInputsSchema,
);
export const midplaneFeature = definition(
  MIDPLANE_TYPE,
  'Midplane',
  'midplane',
  MidplaneInputsSchema,
);
export const planeThroughPointsFeature = definition(
  PLANE_THROUGH_POINTS_TYPE,
  'Plane Through 3 Points',
  'plane-3-points',
  PlaneThroughPointsInputsSchema,
);
export const tangentPlaneFeature = definition(
  TANGENT_PLANE_TYPE,
  'Tangent Plane',
  'plane-tangent',
  TangentPlaneInputsSchema,
);
export const axisThroughPointsFeature = definition(
  AXIS_THROUGH_POINTS_TYPE,
  'Axis Through 2 Points',
  'axis',
  AxisThroughPointsInputsSchema,
);
export const axisThroughCylinderFeature = definition(
  AXIS_THROUGH_CYLINDER_TYPE,
  'Axis Through Cylinder',
  'axis-cylinder',
  AxisThroughCylinderInputsSchema,
);
export const axisAlongEdgeFeature = definition(
  AXIS_ALONG_EDGE_TYPE,
  'Axis Along Edge',
  'axis-edge',
  AxisAlongEdgeInputsSchema,
);
export const constructionPointFeature = definition(
  CONSTRUCTION_POINT_TYPE,
  'Point',
  'point',
  ConstructionPointInputsSchema,
);
export const pointOnPathFeature = definition(
  POINT_ON_PATH_TYPE,
  'Point on Path',
  'point',
  PointOnPathInputsSchema,
);
export const pointAtIntersectionFeature = definition(
  POINT_AT_INTERSECTION_TYPE,
  'Point at Intersection',
  'point',
  PointAtIntersectionInputsSchema,
);
export const planeAlongPathFeature = definition(
  PLANE_ALONG_PATH_TYPE,
  'Plane Along Path',
  'plane-angle',
  PlaneAlongPathInputsSchema,
);
export const midplaneAngledFeature = definition(
  MIDPLANE_ANGLED_TYPE,
  'Angled Midplane',
  'midplane',
  MidplaneAngledInputsSchema,
);

/** The thirteen definitions, by type. */
export const CONSTRUCTION_FEATURES: Readonly<Record<ConstructionType, FeatureDefinition>> = {
  offsetPlane: offsetPlaneFeature,
  planeAtAngle: planeAtAngleFeature,
  midplane: midplaneFeature,
  planeThroughPoints: planeThroughPointsFeature,
  tangentPlane: tangentPlaneFeature,
  axisThroughPoints: axisThroughPointsFeature,
  axisThroughCylinder: axisThroughCylinderFeature,
  axisAlongEdge: axisAlongEdgeFeature,
  constructionPoint: constructionPointFeature,
  pointOnPath: pointOnPathFeature,
  pointAtIntersection: pointAtIntersectionFeature,
  planeAlongPath: planeAlongPathFeature,
  midplaneAngled: midplaneAngledFeature,
};

/** The inputs of `type` whose references are bodies' faces, edges or vertices: the kernel needs the bodies for them. */
export function usesBodies(feature: Pick<Feature, 'inputs'>): boolean {
  return Object.values(feature.inputs).some(
    (input) =>
      input.kind === 'ref' &&
      input.refs.some((r) => r.kind === 'face' || r.kind === 'edge' || r.kind === 'vertex'),
  );
}
