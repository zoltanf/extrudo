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
  MIDPLANE_TYPE,
  type MidplaneInputs,
  OFFSET_PLANE_TYPE,
  type OffsetPlaneInputs,
  PLANE_AT_ANGLE_TYPE,
  PLANE_THROUGH_POINTS_TYPE,
  type PlaneAtAngleInputs,
  type PlaneThroughPointsInputs,
  TANGENT_PLANE_TYPE,
  type TangentPlaneInputs,
  usesBodies,
} from '@extrudo/core';
import { KernelError, type Vec3 } from '../kernel';
import { LostReferenceError } from '../naming/resolve';
import type { EvalContext, FeatureOutput, KernelFeatureDefinition } from '../recompute/types';
import { lineOf, planeOf, pointOf } from './references';
import { add, cross, dot, length, perpendicular, scale, sub, unit } from './vec';

/** Distances (mm) below which two points are the same, and cosines within 1e-9 of ±1 are parallel. */
const EPS = 1e-7;
const PARALLEL = 1e-9;

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
function plane(point: Vec3, normal: Vec3, anchor: Vec3): ConstructionReport {
  const frame = faceSketchFrame(point, normal);
  // The anchor slid onto the plane, so the square is drawn in it.
  const off = dot(sub(anchor, frame.origin), frame.normal);
  return { kind: 'plane', frame, anchor: sub(anchor, scale(frame.normal, off)) };
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
  const { face, plane: reference } = inputs<TangentPlaneInputs>(ctx);
  const hit = ctx.resolve(one(face?.refs, 'a curved face'), {
    label: 'the face for the tangent plane',
  });
  const info = ctx.describe(hit.shape).faces[hit.index];
  const surface = ctx.kernel.surfaceGeometry(hit.shape, hit.index);
  if (!info || !surface.origin) {
    throw new KernelError('Pick a cylindrical, conical or spherical face for a tangent plane.');
  }
  const refNormal = reference?.refs[0]
    ? planeOf(ctx, reference.refs[0], 'the reference plane').frame.normal
    : undefined;
  const angle = optional(ctx, 'angle');
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

/** The nine construction features' kernel definitions. */
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
] as const;

// ------------------------------------------------------------------- tidying

/** Rounding noise off every number (−0, 1e-15) so reports compare and hash the same. */
function tidy(report: ConstructionReport): ConstructionReport {
  const c = (x: number) => {
    const r = Math.round(x * 1e9) / 1e9;
    return Object.is(r, -0) ? 0 : r;
  };
  const v = (p: Vec3): Vec3 => [c(p[0]), c(p[1]), c(p[2])];
  switch (report.kind) {
    case 'plane': {
      const { frame } = report;
      return {
        kind: 'plane',
        anchor: v(report.anchor),
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
      return { kind: 'point', point: v(report.point) };
  }
}
