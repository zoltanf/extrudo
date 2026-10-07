/**
 * The construction features in the kernel (P3-05, ADR-0040, FR-FT-13):
 * planes, axes and points computed from what the references name, with no
 * shapes of their own. Everything is arithmetic on the geometry the kernel
 * already reports (`describe`, `surfaceGeometry`, `edgeGeometry`, sketch
 * frames), so the facade is untouched. The result is a
 * `ConstructionReport`, both the feature's `data` (for later features,
 * through `ctx.output`) and its `report` (for the UI thread).
 *
 * A plane's frame follows the rule of a sketch on a flat face
 * (`faceSketchFrame`): it depends on the plane alone.
 */
import {
  AXIS_ALONG_EDGE_TYPE,
  AXIS_THROUGH_CYLINDER_TYPE,
  AXIS_THROUGH_POINTS_TYPE,
  type AxisAlongEdgeInputs,
  type AxisThroughCylinderInputs,
  type AxisThroughPointsInputs,
  CONSTRUCTION_FEATURES,
  CONSTRUCTION_POINT_TYPE,
  type ConstructionPointInputs,
  type ConstructionReport,
  type ConstructionType,
  type FeatureDefinition,
  type FeatureInputs,
  faceSketchFrame,
  type GeomRef,
  MIDPLANE_ANGLED_TYPE,
  MIDPLANE_TYPE,
  type MidplaneAngledInputs,
  type MidplaneInputs,
  OFFSET_PLANE_TYPE,
  type OffsetPlaneInputs,
  type PathAlong,
  PLANE_ALONG_PATH_TYPE,
  PLANE_AT_ANGLE_TYPE,
  PLANE_THROUGH_POINTS_TYPE,
  type PlaneAlongPathInputs,
  type PlaneAtAngleInputs,
  type PlaneThroughPointsInputs,
  POINT_AT_INTERSECTION_TYPE,
  POINT_ON_PATH_TYPE,
  type PointAtIntersectionInputs,
  type PointOnPathInputs,
  TANGENT_PLANE_TYPE,
  type TangentPlaneInputs,
  usesBodies,
} from '@extrudo/core';
import { KernelError, type ShapeHandle, type Vec3 } from '../kernel';
import type { BodyMesh, MeshOptions } from '../mesh';
import { LostReferenceError } from '../naming/resolve';
import type { EvalContext, FeatureOutput, KernelFeatureDefinition } from '../recompute/types';
import { type Path, pathFromRefs } from './pattern-path';
import { lineOf, planeOf, pointOf } from './references';
import { add, cross, dot, length, perpendicular, scale, sub, unit } from './vec';

/** Distances (mm) below which two points are the same, and cosines within 1e-9 of ±1 are parallel. */
const EPS = 1e-7;
const PARALLEL = 1e-9;
/**
 * How far two edges may be apart and still count as meeting, and how close an
 * edge must be to a plane to count as lying in it or meeting it (P4-12; one
 * tolerance for both, L5).
 */
const MEET = 1e-3;
/**
 * A fine mesh of the face a free-form tangent plane reads (P4-12): 0.01 mm
 * deflection, the same as a mesh boolean, not the view's coarser display
 * tessellation. Exported so a test can re-mesh the same triangles.
 */
export const MESH_NORMAL: MeshOptions = { linearDeflection: 0.01, angularDeflection: 0.1 };
/** Samples of a body edge that isn't a line, circle or ellipse when crossed with a plane (M2). */
const POLYLINE_SAMPLES = 360;

type Evaluate = (ctx: EvalContext) => ConstructionReport;

function define(type: ConstructionType, evaluate: Evaluate): KernelFeatureDefinition {
  const feature = CONSTRUCTION_FEATURES[type] as FeatureDefinition;
  return {
    ...feature,
    // Faces, edges and vertices come from the bodies before it; everything else needs none.
    bodyAccess: (inputs: FeatureInputs) => (usesBodies({ inputs }) ? 'read' : 'none'),
    evaluate(ctx): FeatureOutput {
      const report = tidy(evaluate(ctx));
      return { data: report, report };
    },
  };
}

const inputs = <I>(ctx: EvalContext): I => ctx.inputs as unknown as I;

/** The value of an optional `expr` input in mm or degrees, 0 when the input is absent. */
const optional = (ctx: EvalContext, name: string): number =>
  name in ctx.inputs ? ctx.value(name) : 0;

/** A plane through `point` with unit `normal`; the frame is the sketch-on-face one. */
function plane(
  point: Vec3,
  normal: Vec3,
  anchor: Vec3,
  basis?: 'surface' | 'mesh',
): ConstructionReport {
  const frame = faceSketchFrame(point, normal);
  // The anchor slid onto the plane, so the square is drawn in it.
  const off = dot(sub(anchor, frame.origin), frame.normal);
  const report: ConstructionReport = {
    kind: 'plane',
    frame,
    anchor: sub(anchor, scale(frame.normal, off)),
  };
  return basis ? { ...report, basis } : report;
}

const one = (refs: readonly GeomRef[] | undefined, what: string): GeomRef => {
  const ref = refs?.[0];
  if (!ref) throw new KernelError(`Pick ${what}.`);
  return ref;
};

/** Rotates `v` about the unit `axis` by `degrees`, right-handed. */
function rotate(v: Vec3, axis: Vec3, degrees: number): Vec3 {
  const t = (degrees * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  return add(add(scale(v, c), scale(cross(axis, v), s)), scale(axis, dot(axis, v) * (1 - c)));
}

/** `v` without its part along the unit `axis`, as a unit vector; `undefined` if it lies along it. */
function across(v: Vec3, axis: Vec3): Vec3 | undefined {
  const flat = sub(v, scale(axis, dot(v, axis)));
  return length(flat) > 1e-9 ? unit(flat) : undefined;
}

/** Where along a path of sketch curves and edges a point or plane sits (P4-12). */
function pathAt(
  ctx: EvalContext,
  settings: { path?: { refs: GeomRef[] }; by?: { value: string }; flip?: { value: boolean } },
): { along: PathAlong; point: Vec3; tangent: Vec3 } {
  const path = pathFromRefs(ctx, settings.path?.refs ?? [], settings.flip?.value ?? false);
  const byLength = settings.by?.value === 'length';
  const fraction = 'position' in ctx.inputs ? ctx.value('position') : 0.5;
  const at = path.at(byLength ? optional(ctx, 'distance') : fraction * path.length);
  return { along: pathAlong(path), point: at.point, tangent: at.tangent };
}

/** The start, direction, length and straightness of a path, for the view's handle (P4-12). */
function pathAlong(path: Path): PathAlong {
  const from = path.points[0] as Vec3;
  const last = path.points[path.points.length - 1] as Vec3;
  const chord = length(sub(last, from));
  return {
    from,
    tangent: unit(sub(last, from)),
    length: path.length,
    straight: chord > 0 && Math.abs(path.length - chord) <= 1e-6,
  };
}

/**
 * The point of triangle `a b c` nearest `p`: `p` projected onto the triangle's
 * plane and clamped into it (Ericson, *Real-Time Collision Detection* §5.1.5),
 * the nearest point of a triangle, not its centroid (P4-12 review M3).
 */
function closestOnTriangle(p: Vec3, a: Vec3, b: Vec3, c: Vec3): Vec3 {
  const ab = sub(b, a);
  const ac = sub(c, a);
  const ap = sub(p, a);
  const d1 = dot(ab, ap);
  const d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return a;
  const bp = sub(p, b);
  const d3 = dot(ab, bp);
  const d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return b;
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) return add(a, scale(ab, d1 / (d1 - d3)));
  const cp = sub(p, c);
  const d5 = dot(ab, cp);
  const d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return c;
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) return add(a, scale(ac, d2 / (d2 - d6)));
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    return add(b, scale(sub(c, b), (d4 - d3) / (d4 - d3 + (d5 - d6))));
  }
  const denom = 1 / (va + vb + vc);
  return add(a, add(scale(ab, vb * denom), scale(ac, vc * denom)));
}

/**
 * A tangent plane on a free-form face (P4-12): the point of the face's fine
 * mesh nearest `target` and that triangle's outward normal. `surfaceGeometry`
 * gives no surface to place a B-spline from, so this is the honest fallback,
 * and the report says so with `basis: 'mesh'`.
 */
function meshTangent(
  ctx: EvalContext,
  shape: ShapeHandle,
  face: number,
  target: Vec3,
): ConstructionReport {
  const mesh: BodyMesh = ctx.kernel.mesh(shape, MESH_NORMAL);
  const first = mesh.faceRanges[2 * face] ?? 0;
  const count = mesh.faceRanges[2 * face + 1] ?? mesh.indices.length / 3;
  const inFace = (t: number) => t >= first && t < first + count;
  let best: { at: Vec3; normal: Vec3; distance: number } | undefined;
  const at = (i: number): Vec3 => [
    mesh.positions[3 * i] ?? 0,
    mesh.positions[3 * i + 1] ?? 0,
    mesh.positions[3 * i + 2] ?? 0,
  ];
  for (let t = 0; t < mesh.indices.length / 3; t++) {
    if (!inFace(t)) continue;
    const a = at(mesh.indices[3 * t] ?? 0);
    const b = at(mesh.indices[3 * t + 1] ?? 0);
    const c = at(mesh.indices[3 * t + 2] ?? 0);
    // The triangle is chosen by the distance to its nearest point, not to its
    // centroid, and the touching point is that nearest point (M3).
    const near = closestOnTriangle(target, a, b, c);
    const d = length(sub(near, target));
    if (!best || d < best.distance) {
      best = { at: near, normal: unit(cross(sub(b, a), sub(c, a))), distance: d };
    }
  }
  if (!best || length(best.normal) < 0.5) {
    throw new KernelError("Couldn't find the face's surface there. Pick another face.");
  }
  return plane(best.at, best.normal, best.at, 'mesh');
}

// ------------------------------------------------------------------- planes

/** A plane or face moved along its normal (a face's outward one) by the distance. */
export const kernelOffsetPlane = define(OFFSET_PLANE_TYPE, (ctx) => {
  const { plane: refs } = inputs<OffsetPlaneInputs>(ctx);
  const base = planeOf(
    ctx,
    one(refs?.refs, 'a plane or a flat face to offset from'),
    'the plane to offset from',
  );
  const move = scale(base.frame.normal, optional(ctx, 'distance'));
  return plane(add(base.frame.origin, move), base.frame.normal, add(base.anchor, move));
});

/**
 * The plane through a line, turned about it by the angle from a reference
 * plane's direction (right-handed about the line). The reference gives the
 * plane's normal at 0°, taken square to the line; without one, the normal
 * square to the line and as close to vertical as `perpendicular` finds.
 */
export const kernelPlaneAtAngle = define(PLANE_AT_ANGLE_TYPE, (ctx) => {
  const { axis, plane: reference } = inputs<PlaneAtAngleInputs>(ctx);
  const line = lineOf(
    ctx,
    one(axis?.refs, 'a line to turn about'),
    'the line the plane turns about',
  );
  let zero = perpendicular(line.direction);
  if (reference?.refs[0]) {
    const base = planeOf(ctx, reference.refs[0], 'the reference plane');
    const projected = across(base.frame.normal, line.direction);
    if (!projected) {
      throw new KernelError(
        "The line is square to the reference plane, so there's no plane to start from. Pick a line in or beside the plane.",
      );
    }
    zero = projected;
  }
  const normal = rotate(zero, line.direction, optional(ctx, 'angle'));
  return plane(line.origin, normal, line.origin);
});

/** The plane halfway between two parallel planes or faces. */
export const kernelMidplane = define(MIDPLANE_TYPE, (ctx) => {
  const refs = inputs<MidplaneInputs>(ctx).planes?.refs ?? [];
  if (refs.length < 2) throw new KernelError('Pick two planes or flat faces.');
  const [a, b] = [
    planeOf(ctx, refs[0] as GeomRef, 'the first plane'),
    planeOf(ctx, refs[1] as GeomRef, 'the second plane'),
  ];
  const n = a.frame.normal;
  if (Math.abs(dot(n, b.frame.normal)) < 1 - PARALLEL * 1e3) {
    throw new KernelError("The two planes aren't parallel. Pick parallel planes or faces.");
  }
  const gap = dot(sub(b.frame.origin, a.frame.origin), n);
  if (Math.abs(gap) <= EPS) throw new KernelError('The two planes are the same plane.');
  const point = add(a.frame.origin, scale(n, gap / 2));
  return plane(point, n, scale(add(a.anchor, b.anchor), 0.5));
});

/** The plane through three points that don't lie on a line; its normal follows their order. */
export const kernelPlaneThroughPoints = define(PLANE_THROUGH_POINTS_TYPE, (ctx) => {
  const refs = inputs<PlaneThroughPointsInputs>(ctx).points?.refs ?? [];
  if (refs.length < 3) throw new KernelError('Pick three points.');
  const [a, b, c] = refs.map((ref, i) => pointOf(ctx, ref, `point ${i + 1}`)) as [Vec3, Vec3, Vec3];
  const normal = cross(sub(b, a), sub(c, a));
  if (length(normal) <= EPS) {
    throw new KernelError(
      'The three points lie on one line, or two of them are the same. Pick points that span a plane.',
    );
  }
  return plane(a, unit(normal), scale(add(add(a, b), c), 1 / 3));
});

/**
 * A plane touching a cylindrical, conical or spherical face along a line
 * (a point for a sphere). Where round the face: the reference plane's
 * normal, square to the axis, turned by the angle about the axis.
 */
export const kernelTangentPlane = define(TANGENT_PLANE_TYPE, (ctx) => {
  const { face, plane: reference, point: pointRef } = inputs<TangentPlaneInputs>(ctx);
  const hit = ctx.resolve(one(face?.refs, 'a curved face'), {
    label: 'the face for the tangent plane',
  });
  const info = ctx.describe(hit.shape).faces[hit.index];
  const surface = ctx.kernel.surfaceGeometry(hit.shape, hit.index);
  const target = pointRef?.refs[0]
    ? pointOf(ctx, pointRef.refs[0], 'the point for the tangent plane')
    : undefined;
  // A free-form face (or one surfaceGeometry can't place): the display mesh's nearest triangle.
  if ((!info || !surface.origin) && target) {
    return meshTangent(ctx, hit.shape, hit.index, target);
  }
  if (!info || !surface.origin) {
    throw new KernelError('Pick a cylindrical, conical or spherical face for a tangent plane.');
  }
  const refNormal = reference?.refs[0]
    ? planeOf(ctx, reference.refs[0], 'the reference plane').frame.normal
    : undefined;
  const angle = optional(ctx, 'angle');
  // A point picks where the plane touches (P4-12): the face point nearest it.
  if (target) {
    switch (surface.type) {
      case 'torus': {
        // The exact nearest point: project to the tube's centre circle (the
        // major radius in the plane square to the axis), then step along the
        // tube's radial direction by the minor radius. A target on the centre
        // circle itself has no radial direction, so the outward one is taken.
        const axis = unit(surface.direction as Vec3);
        const out = across(sub(target, surface.origin), axis) ?? perpendicular(axis);
        const tube = add(surface.origin, scale(out, surface.radius ?? 0));
        const radial = sub(target, tube);
        const normal = length(radial) > EPS ? unit(radial) : out;
        const point = add(tube, scale(normal, surface.minorRadius ?? 0));
        return plane(point, normal, point, 'surface');
      }
      case 'cylinder': {
        const axis = unit(surface.direction as Vec3);
        const along = dot(sub(target, surface.origin), axis);
        const out =
          across(sub(target, add(surface.origin, scale(axis, along))), axis) ?? perpendicular(axis);
        const point = add(add(surface.origin, scale(axis, along)), scale(out, surface.radius ?? 0));
        return plane(point, out, point, 'surface');
      }
      case 'sphere': {
        const offset = sub(target, surface.origin);
        const out = unit(offset);
        const direction =
          length(offset) > EPS ? out : unit((surface.direction as Vec3) ?? [0, 0, 1]);
        return plane(
          add(surface.origin, scale(direction, surface.radius ?? 0)),
          direction,
          add(surface.origin, scale(direction, surface.radius ?? 0)),
          'surface',
        );
      }
      case 'cone': {
        // The exact nearest generatrix: the target's radial direction about the
        // axis picks it, its foot on that line (never behind the apex) is where
        // the plane touches. The surface is the infinite one, as the cylinder's.
        const apex = surface.origin;
        const axis = unit(surface.direction as Vec3);
        const opening = dot(sub(info.centroid, apex), axis) >= 0 ? axis : scale(axis, -1);
        const half = Math.abs(surface.halfAngle ?? 0);
        const d = sub(target, apex);
        const radial = sub(d, scale(opening, dot(d, opening)));
        if (length(radial) > EPS) {
          const out = unit(radial);
          const generatrix = add(scale(opening, Math.cos(half)), scale(out, Math.sin(half)));
          const foot = add(apex, scale(generatrix, Math.max(0, dot(d, generatrix))));
          const normal = unit(sub(scale(out, Math.cos(half)), scale(opening, Math.sin(half))));
          return plane(foot, normal, foot, 'surface');
        }
        ctx.warn(
          "The point lies on the cone's axis, so every generatrix is as near: the plane follows the angle.",
        );
        break;
      }
      default:
        break;
    }
  }
  switch (surface.type) {
    case 'cylinder': {
      const axis = unit(surface.direction as Vec3);
      const zero = (refNormal && across(refNormal, axis)) || perpendicular(axis);
      const out = rotate(zero, axis, angle);
      const along = dot(sub(info.centroid, surface.origin), axis);
      const point = add(add(surface.origin, scale(axis, along)), scale(out, surface.radius ?? 0));
      return plane(point, out, point);
    }
    case 'cone': {
      const axis = unit(surface.direction as Vec3);
      // The axis points from the apex into the cone's body, whichever way its sign was stored.
      const opening = dot(sub(info.centroid, surface.origin), axis) >= 0 ? axis : scale(axis, -1);
      const zero = (refNormal && across(refNormal, opening)) || perpendicular(opening);
      const out = rotate(zero, opening, angle);
      const half = Math.abs(surface.halfAngle ?? 0);
      const normal = unit(sub(scale(out, Math.cos(half)), scale(opening, Math.sin(half))));
      // The plane holds the apex; the view draws it around the face's middle.
      return plane(surface.origin, normal, info.centroid);
    }
    case 'sphere': {
      const out = refNormal
        ? refNormal
        : unit((surface.direction as Vec3 | undefined) ?? [0, 0, 1]);
      const point = add(surface.origin, scale(out, surface.radius ?? 0));
      return plane(point, out, point);
    }
    default:
      throw new KernelError('Pick a cylindrical, conical or spherical face for a tangent plane.');
  }
});

// --------------------------------------------------------------------- axes

/** The line through two different points, pointing from the first to the second. */
export const kernelAxisThroughPoints = define(AXIS_THROUGH_POINTS_TYPE, (ctx) => {
  const refs = inputs<AxisThroughPointsInputs>(ctx).points?.refs ?? [];
  if (refs.length < 2) throw new KernelError('Pick two points.');
  const [a, b] = refs.map((ref, i) => pointOf(ctx, ref, `point ${i + 1}`)) as [Vec3, Vec3];
  const along = sub(b, a);
  if (length(along) <= EPS)
    throw new KernelError('The two points are the same. Pick two different points.');
  return { kind: 'axis', origin: scale(add(a, b), 0.5), direction: unit(along) };
});

/** The axis of a cylindrical, conical or toroidal face (or a face of revolution). */
export const kernelAxisThroughCylinder = define(AXIS_THROUGH_CYLINDER_TYPE, (ctx) => {
  const { face } = inputs<AxisThroughCylinderInputs>(ctx);
  const hit = ctx.resolve(one(face?.refs, 'a cylindrical face'), {
    label: 'the face for the axis',
  });
  const info = ctx.describe(hit.shape).faces[hit.index];
  const surface = ctx.kernel.surfaceGeometry(hit.shape, hit.index);
  const round = ['cylinder', 'cone', 'torus', 'revolution'].includes(surface.type);
  if (!info || !round || !surface.origin || !surface.direction) {
    throw new KernelError('That face has no axis. Pick a cylindrical, conical or toroidal face.');
  }
  const direction = unit(surface.direction);
  const along = dot(sub(info.centroid, surface.origin), direction);
  return { kind: 'axis', origin: add(surface.origin, scale(direction, along)), direction };
});

/**
 * A straight edge or sketch line as an axis, or a circular edge's axis: the
 * line through its centre, square to its plane.
 */
export const kernelAxisAlongEdge = define(AXIS_ALONG_EDGE_TYPE, (ctx) => {
  const { edge } = inputs<AxisAlongEdgeInputs>(ctx);
  const ref = one(edge?.refs, 'an edge');
  if (ref.kind === 'edge') {
    const hit = ctx.resolve(ref, { label: 'the edge for the axis' });
    const info = ctx.describe(hit.shape).edges[hit.index];
    if (info?.type === 'circle') {
      const geometry = ctx.kernel.edgeGeometry(hit.shape, hit.index);
      if (geometry.type === 'circle' && geometry.conic) {
        return {
          kind: 'axis',
          origin: geometry.conic.center,
          direction: unit(geometry.conic.axis),
        };
      }
    }
  }
  const line = lineOf(ctx, ref, 'the edge for the axis');
  return { kind: 'axis', origin: line.origin, direction: line.direction };
});

// -------------------------------------------------------------------- point

/**
 * A point: a vertex, a construction point, the centre of a circular edge
 * (the middle of another edge) or of a face, or the origin, moved along the
 * world axes by X, Y and Z.
 */
export const kernelConstructionPoint = define(CONSTRUCTION_POINT_TYPE, (ctx) => {
  const { at } = inputs<ConstructionPointInputs>(ctx);
  const ref = at?.refs[0];
  let start: Vec3 = [0, 0, 0];
  if (ref?.kind === 'vertex' || ref?.kind === 'point') {
    start = pointOf(ctx, ref, 'the point');
  } else if (ref?.kind === 'edge') {
    const hit = ctx.resolve(ref, { label: 'the edge for the point' });
    const info = ctx.describe(hit.shape).edges[hit.index];
    if (!info)
      throw new LostReferenceError("Can't find the edge for the point. Pick it again.", ref);
    start = info.midpoint;
    if (info.type === 'circle') {
      const geometry = ctx.kernel.edgeGeometry(hit.shape, hit.index);
      if (geometry.type === 'circle' && geometry.conic) start = geometry.conic.center;
    }
  } else if (ref?.kind === 'face') {
    const hit = ctx.resolve(ref, { label: 'the face for the point' });
    const info = ctx.describe(hit.shape).faces[hit.index];
    if (!info)
      throw new LostReferenceError("Can't find the face for the point. Pick it again.", ref);
    start = info.centroid;
    if (info.type === 'sphere' || info.type === 'torus') {
      const surface = ctx.kernel.surfaceGeometry(hit.shape, hit.index);
      if (surface.origin) start = surface.origin;
    }
  }
  const move: Vec3 = [optional(ctx, 'x'), optional(ctx, 'y'), optional(ctx, 'z')];
  return { kind: 'point', point: add(start, move) };
});

// ------------------------------------------------------ paths and intersections

const round2 = (x: number) => Math.round(x * 100) / 100;

/** A point a fraction or a length along a path of sketch curves and edges (P4-12). */
export const kernelPointOnPath = define(POINT_ON_PATH_TYPE, (ctx) => {
  const { point, along } = pathAt(ctx, inputs<PointOnPathInputs>(ctx));
  return { kind: 'point', point, path: along };
});

/** The plane square to a path at a point on it (P4-12); its frame follows `faceSketchFrame`. */
export const kernelPlaneAlongPath = define(PLANE_ALONG_PATH_TYPE, (ctx) => {
  const { point, tangent, along } = pathAt(ctx, inputs<PlaneAlongPathInputs>(ctx));
  const report = plane(point, tangent, point) as Extract<ConstructionReport, { kind: 'plane' }>;
  return { ...report, path: along };
});

/** Two edges: the facade's closest points of the edge sub-shapes, the midpoint of the two. */
function edgesMeeting(ctx: EvalContext, refs: readonly GeomRef[]): Vec3 {
  using scope = ctx.kernel.scope();
  const [a, b] = refs.map((ref, i) => {
    const hit = ctx.resolve(ref, { label: i === 0 ? 'the first edge' : 'the second edge' });
    return scope.track(ctx.kernel.subShape(hit.shape, 'edge', hit.index));
  }) as [ShapeHandle, ShapeHandle];
  const { distance, from, to } = ctx.kernel.closestPoints(a, b);
  if (distance > MEET) {
    throw new KernelError(`The two edges don't meet (${round2(distance)} mm apart).`);
  }
  return scale(add(from, to), 0.5);
}

const LIES_IN_PLANE =
  'The edge lies in the plane, so they meet in a line, not a point. Pick another.';
const NO_PLANE_MEET = "The edge doesn't meet the plane. Pick another.";

/** A signed distance from the plane {origin, normal}. */
const planeDistance = (p: Vec3, origin: Vec3, normal: Vec3) => dot(sub(p, origin), normal);

/** Whether a sampled conic's angle `theta` lies on the arc's own sweep. */
function onArc(theta: number, first: number, span: number, whole: boolean): boolean {
  if (whole) return true;
  const off = (((theta - first) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  return off <= span + 1e-9;
}

/**
 * Where a circle or an ellipse crosses a plane, exactly (P4-12 review M2): the
 * conic `center + a cos t · u + b sin t · v` meets the plane where
 * `A + B cos t + C sin t = 0`, solved with one `acos`. This beats walking the
 * sampled polyline, whose chord is short of the curve by its sagitta.
 */
function conicMeetsPlane(
  conic: {
    center: Vec3;
    axis: Vec3;
    xDirection: Vec3;
    radius: number;
    minor?: number;
    first: number;
    last: number;
  },
  closed: boolean,
  origin: Vec3,
  normal: Vec3,
): Vec3 {
  const axis = unit(conic.axis);
  const u = unit(conic.xDirection);
  const v = cross(axis, u);
  const major = conic.radius;
  const minor = conic.minor ?? conic.radius;
  const a = planeDistance(conic.center, origin, normal);
  const b = major * dot(u, normal);
  const c = minor * dot(v, normal);
  const radius = Math.hypot(b, c);
  // The conic's plane is parallel to the given one: it lies in it or misses it.
  if (radius <= EPS * Math.max(major, minor)) {
    if (Math.abs(a) <= MEET) throw new KernelError(LIES_IN_PLANE);
    throw new KernelError(NO_PLANE_MEET);
  }
  const cos = -a / radius;
  if (cos < -1 || cos > 1) throw new KernelError(NO_PLANE_MEET);
  const span = conic.last - conic.first;
  const whole = closed || span >= 2 * Math.PI - 1e-9;
  const phi = Math.atan2(c, b);
  const delta = Math.acos(Math.min(1, Math.max(-1, cos)));
  const found = [phi + delta, phi - delta].filter((t) => onArc(t, conic.first, span, whole));
  if (found.length === 0) throw new KernelError(NO_PLANE_MEET);
  // The crossing the polyline walk would meet first: nearest the arc's start.
  const along = (t: number) =>
    whole ? 0 : (((t - conic.first) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const theta = found.reduce((x, y) => (along(x) <= along(y) ? x : y));
  return add(
    conic.center,
    add(scale(u, major * Math.cos(theta)), scale(v, minor * Math.sin(theta))),
  );
}

/** An edge crossed with a plane or flat face: the exact point where the line or conic crosses (M2). */
function edgeMeetsPlane(ctx: EvalContext, edge: GeomRef, planeRef: GeomRef): Vec3 {
  const hit = ctx.resolve(edge, { label: 'the edge' });
  const { frame } = planeOf(ctx, planeRef, 'the plane');
  const { normal, origin } = frame;
  const geometry = ctx.kernel.edgeGeometry(hit.shape, hit.index, POLYLINE_SAMPLES);
  if (geometry.type === 'degenerate' || geometry.points.length < 2) {
    throw new KernelError('The edge has no length. Pick another.');
  }
  const points = geometry.points;
  // A line: its ends are exact, so the crossing is exact.
  if (geometry.type === 'line') {
    const a = points[0] as Vec3;
    const b = points[points.length - 1] as Vec3;
    const da = planeDistance(a, origin, normal);
    const db = planeDistance(b, origin, normal);
    if (Math.abs(da) <= MEET && Math.abs(db) <= MEET) throw new KernelError(LIES_IN_PLANE);
    if (Math.abs(da) <= MEET) return a;
    if (Math.abs(db) <= MEET) return b;
    if (da < 0 !== db < 0) return add(a, scale(sub(b, a), da / (da - db)));
    throw new KernelError(NO_PLANE_MEET);
  }
  // A circle or an ellipse: solved analytically.
  if ((geometry.type === 'circle' || geometry.type === 'ellipse') && geometry.conic) {
    return conicMeetsPlane(geometry.conic, geometry.closed, origin, normal);
  }
  // Anything else: walk a dense polyline, with the one `MEET` tolerance (L5).
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i] as Vec3;
    const b = points[i + 1] as Vec3;
    const da = planeDistance(a, origin, normal);
    const db = planeDistance(b, origin, normal);
    if (Math.abs(da) <= MEET && Math.abs(db) <= MEET) throw new KernelError(LIES_IN_PLANE);
    if (Math.abs(da) <= MEET) return a;
    if (Math.abs(db) <= MEET) return b;
    if (da < 0 !== db < 0) return add(a, scale(sub(b, a), da / (da - db)));
  }
  throw new KernelError(NO_PLANE_MEET);
}

/** Whether a face reference is flat (a curved one goes to `edgeMeetsFace`). */
function isFlatFace(ctx: EvalContext, face: GeomRef): boolean {
  const hit = ctx.resolve(face, { label: 'the face' });
  return ctx.kernel.surfaceGeometry(hit.shape, hit.index).type === 'plane';
}

/** An edge and a curved face: the facade's closest points of the two sub-shapes, their midpoint. */
function edgeMeetsFace(ctx: EvalContext, edge: GeomRef, face: GeomRef): Vec3 {
  using scope = ctx.kernel.scope();
  const e = ctx.resolve(edge, { label: 'the edge' });
  const f = ctx.resolve(face, { label: 'the face' });
  const a = scope.track(ctx.kernel.subShape(e.shape, 'edge', e.index));
  const b = scope.track(ctx.kernel.subShape(f.shape, 'face', f.index));
  const { distance, from, to } = ctx.kernel.closestPoints(a, b);
  if (distance > MEET) {
    throw new KernelError(`The edge doesn't meet the face (${round2(distance)} mm apart).`);
  }
  return scale(add(from, to), 0.5);
}

/** Three planes or flat faces through one point (Cramer's rule on their normals). */
function threePlanesMeet(ctx: EvalContext, refs: readonly GeomRef[]): Vec3 {
  const [a, b, c] = refs.map((ref, i) => planeOf(ctx, ref, `plane ${i + 1}`)) as [
    ReturnType<typeof planeOf>,
    ReturnType<typeof planeOf>,
    ReturnType<typeof planeOf>,
  ];
  const n1 = a.frame.normal;
  const n2 = b.frame.normal;
  const n3 = c.frame.normal;
  const det = dot(n1, cross(n2, n3));
  if (Math.abs(det) < 1e-9) {
    throw new KernelError("The planes don't meet at one point: two are parallel or share a line.");
  }
  const c1 = dot(n1, a.frame.origin);
  const c2 = dot(n2, b.frame.origin);
  const c3 = dot(n3, c.frame.origin);
  return scale(
    add(add(scale(cross(n2, n3), c1), scale(cross(n3, n1), c2)), scale(cross(n1, n2), c3)),
    1 / det,
  );
}

/** Two edges, an edge and a plane, or three planes meeting at one point (P4-12). */
export const kernelPointAtIntersection = define(POINT_AT_INTERSECTION_TYPE, (ctx) => {
  const refs = inputs<PointAtIntersectionInputs>(ctx).entities?.refs ?? [];
  const edges = refs.filter((ref) => ref.kind === 'edge');
  const planes = refs.filter((ref) => ref.kind === 'plane' || ref.kind === 'face');
  if (refs.length === 2 && edges.length === 2) {
    return { kind: 'point', point: edgesMeeting(ctx, refs) };
  }
  if (refs.length === 2 && edges.length === 1 && planes.length === 1) {
    const only = planes[0] as GeomRef;
    if (only.kind === 'face' && !isFlatFace(ctx, only)) {
      return { kind: 'point', point: edgeMeetsFace(ctx, edges[0] as GeomRef, only) };
    }
    return { kind: 'point', point: edgeMeetsPlane(ctx, edges[0] as GeomRef, only) };
  }
  if (refs.length === 3 && planes.length === 3) {
    return { kind: 'point', point: threePlanesMeet(ctx, refs) };
  }
  throw new KernelError('Pick two edges, an edge and a plane or face, or three planes.');
});

/** The bisector of two non-parallel planes or flat faces, through their intersection line (P4-12). */
export const kernelMidplaneAngled = define(MIDPLANE_ANGLED_TYPE, (ctx) => {
  const { planes, flip } = inputs<MidplaneAngledInputs>(ctx);
  const refs = planes?.refs ?? [];
  if (refs.length < 2) throw new KernelError('Pick two planes or flat faces.');
  const [a, b] = [
    planeOf(ctx, refs[0] as GeomRef, 'the first plane'),
    planeOf(ctx, refs[1] as GeomRef, 'the second plane'),
  ];
  const n1 = a.frame.normal;
  const n2 = b.frame.normal;
  const k = dot(n1, n2);
  if (Math.abs(k) >= 1 - PARALLEL * 1e3) {
    throw new KernelError('These planes are parallel. Use Midplane.');
  }
  const along = unit(cross(n1, n2));
  const c1 = dot(n1, a.frame.origin);
  const c2 = dot(n2, b.frame.origin);
  const den = 1 - k * k;
  const point = add(scale(n1, (c1 - c2 * k) / den), scale(n2, (c2 - c1 * k) / den));
  // Order-independent: the two normals are sorted before `±`, so the same pair
  // gives the same bisector whichever face was picked first (P4-12 review L1).
  const compare = (x: Vec3, y: Vec3) => x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
  const [p, q] = [n1, n2].sort(compare) as [Vec3, Vec3];
  const normal = unit(flip?.value ? sub(q, p) : add(p, q));
  const middle = scale(add(a.anchor, b.anchor), 0.5);
  const anchor = add(point, scale(along, dot(sub(middle, point), along)));
  return plane(point, normal, anchor);
});

/** The thirteen construction features' kernel definitions. */
export const KERNEL_CONSTRUCTION = [
  kernelOffsetPlane,
  kernelPlaneAtAngle,
  kernelMidplane,
  kernelPlaneThroughPoints,
  kernelTangentPlane,
  kernelAxisThroughPoints,
  kernelAxisThroughCylinder,
  kernelAxisAlongEdge,
  kernelConstructionPoint,
  kernelPointOnPath,
  kernelPointAtIntersection,
  kernelPlaneAlongPath,
  kernelMidplaneAngled,
] as const;

// ------------------------------------------------------------------- tidying

/** Rounding noise off every number (−0, 1e-15) so reports compare and hash the same. */
function tidy(report: ConstructionReport): ConstructionReport {
  const c = (x: number) => {
    const r = Math.round(x * 1e9) / 1e9;
    return Object.is(r, -0) ? 0 : r;
  };
  const v = (p: Vec3): Vec3 => [c(p[0]), c(p[1]), c(p[2])];
  const along = (p: PathAlong): PathAlong => ({
    from: v(p.from),
    tangent: v(p.tangent),
    length: c(p.length),
    straight: p.straight,
  });
  switch (report.kind) {
    case 'plane': {
      const { frame } = report;
      return {
        kind: 'plane',
        anchor: v(report.anchor),
        ...(report.basis ? { basis: report.basis } : {}),
        ...(report.path ? { path: along(report.path) } : {}),
        frame: {
          origin: v(frame.origin),
          x: v(frame.x),
          y: v(frame.y),
          normal: v(frame.normal),
        },
      };
    }
    case 'axis':
      return { kind: 'axis', origin: v(report.origin), direction: v(report.direction) };
    case 'point':
      return {
        kind: 'point',
        point: v(report.point),
        ...(report.path ? { path: along(report.path) } : {}),
      };
  }
}
