/**
 * The construction dialogs (P3-05, ADR-0040, FR-FT-13): Offset Plane, Plane
 * at Angle, Midplane, Plane Through 3 Points, Tangent Plane, Axis Through 2
 * Points, Axis Through Cylinder, Axis Along Edge and Point. Each is a
 * declarative spec like the primitives': fields named like the feature's
 * inputs, so the framework's default mapping turns them into inputs and
 * back. There is nothing to add to a body, so the preview is the plane,
 * axis or point itself, drawn in the view (`ViewPreview.construction`).
 *
 * A field that takes planes (`plane`, `planes`) is picked like Create
 * Sketch's plane: origin planes, construction planes and flat faces
 * (`features/planePicker.ts`).
 */
import {
  AXIS_ALONG_EDGE_TYPE,
  AXIS_THROUGH_CYLINDER_TYPE,
  AXIS_THROUGH_POINTS_TYPE,
  CONSTRUCTION_FEATURES,
  CONSTRUCTION_POINT_TYPE,
  type ConstructionType,
  type ExtrudoDocument,
  type FeatureDefinition,
  type GeomRef,
  INTERSECTION_SOURCE_KINDS,
  LINE_SOURCE_KINDS,
  MIDPLANE_ANGLED_TYPE,
  MIDPLANE_TYPE,
  OFFSET_PLANE_TYPE,
  PATH_SOURCE_KINDS,
  PLANE_ALONG_PATH_TYPE,
  PLANE_AT_ANGLE_TYPE,
  PLANE_SOURCE_KINDS,
  PLANE_THROUGH_POINTS_TYPE,
  POINT_AT_INTERSECTION_TYPE,
  POINT_ON_PATH_TYPE,
  POINT_SOURCE_KINDS,
  parseSketchEntityRefId,
  readSketch,
  TANGENT_PLANE_TYPE,
  type Vec3,
} from '@extrudo/core';
import type { ToolId } from '../shell/tools';
import { isFlatFace } from '../sketch/facePick';
import { axisLine, faceFrame } from './geometry';
import { cross } from './manipulate';
import { placementFrame } from './primitives';
import {
  type DialogContext,
  type DialogField,
  type DialogValues,
  defineFeatureDialog,
  type FeatureDialogSpec,
  type Manipulator,
  type ManipulatorContext,
} from './spec';

const selection = (
  name: string,
  label: string,
  accepts: readonly GeomRef['kind'][],
  options: { min?: number; max?: number; prompt: string; hint: string },
): DialogField => ({ kind: 'selection', name, label, accepts, ...options });

const expression = (
  name: string,
  label: string,
  unit: 'length' | 'angle' | 'unitless',
  value: string,
  hint?: string,
): DialogField => ({
  kind: 'expression',
  name,
  label,
  unit,
  default: value,
  ...(hint && { hint }),
});

const choice = (
  name: string,
  label: string,
  options: readonly { value: string; label: string }[],
  value: string,
  hint?: string,
): DialogField => ({ kind: 'choice', name, label, options, default: value, ...(hint && { hint }) });

const toggle = (name: string, label: string, value: boolean, hint?: string): DialogField => ({
  kind: 'toggle',
  name,
  label,
  default: value,
  ...(hint && { hint }),
});

/** The shared fields of a point or plane along a path (P4-12). */
function pathFields(noun: string): DialogField[] {
  return [
    selection('path', 'Path', PATH_SOURCE_KINDS, {
      min: 1,
      prompt: 'Pick sketch curves or edges',
      hint: `The sketch curves and edges the ${noun} follows, chained end to end.`,
    }),
    choice(
      'by',
      'By',
      [
        { value: 'position', label: 'Position' },
        { value: 'length', label: 'Length' },
      ],
      'position',
      'A fraction of the path, or a length from its start.',
    ),
    {
      ...expression('position', 'Position', 'unitless', '0.5', 'A fraction from 0 to 1.'),
      shown: (values) => values.choices.by !== 'length',
    },
    {
      ...expression('distance', 'Distance', 'length', '20 mm', 'A length from the path’s start.'),
      shown: (values) => values.choices.by === 'length',
    },
    toggle('flip', 'Flip', false, 'Measure from the other end of the path.'),
  ];
}

const planeHint = 'An origin plane, a construction plane or a flat face.';

/** A spec for one construction type; its command is the toolbar tool of the same ID. */
function construction(
  type: ConstructionType,
  fields: readonly DialogField[],
  extra: Pick<FeatureDialogSpec, 'validate' | 'manipulators'> = {},
): FeatureDialogSpec {
  const feature = CONSTRUCTION_FEATURES[type] as FeatureDefinition;
  return defineFeatureDialog({
    ...feature,
    command: type satisfies ToolId,
    fields,
    ...extra,
  });
}

// ------------------------------------------------------------------- checks

/** Whether a picked face is one the view's meshes show as flat (the kernel says the rest). */
function isFlat(ref: GeomRef, ctx: Pick<DialogContext, 'bodies'>): boolean | undefined {
  for (const mesh of Object.values(ctx.bodies)) {
    const face = mesh.faceIds?.indexOf(ref.id) ?? -1;
    if (face >= 0) return isFlatFace(mesh, face);
  }
  return undefined;
}

/** A face field that wants curved faces: flat ones and planes are refused early. */
function curvedFace(field: string, message: string): FeatureDialogSpec['validate'] {
  return (values, ctx) => {
    const face = values.refs[field]?.[0];
    if (face?.kind === 'face' && isFlat(face, ctx) === true) return { field, message };
    return undefined;
  };
}

/** A picked sketch curve (`<sketch>/<entity>`) must be a line. */
function isSketchLine(doc: ExtrudoDocument, ref: GeomRef): boolean {
  const parsed = parseSketchEntityRefId(ref.id);
  const feature = parsed && doc.features.find((f) => f.id === parsed.feature);
  const sketch = feature && readSketch(feature);
  // A sketch the document doesn't have is the kernel's to report.
  if (!parsed || !sketch) return true;
  return sketch.data.entities[parsed.entity]?.type === 'line';
}

const lineOnly =
  (field: string): FeatureDialogSpec['validate'] =>
  (values, ctx) => {
    const ref = values.refs[field]?.[0];
    if (ref?.kind === 'sketchEntity' && !isSketchLine(ctx.doc, ref)) {
      return { field, message: 'Pick a straight line.' };
    }
    return undefined;
  };

// --------------------------------------------------------- manipulator maths

const scale = (v: Vec3, s: number): Vec3 => [v[0] * s, v[1] * s, v[2] * s];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (v: Vec3): Vec3 => scale(v, 1 / (Math.hypot(v[0], v[1], v[2]) || 1));

/** A unit vector square to `d`, as the kernel's `perpendicular` finds it. */
export function squareTo(d: Vec3): Vec3 {
  const helper: Vec3 = Math.abs(d[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  return unit(cross(d, helper));
}

/** A plane reference's normal and where the view draws it (its centre): from the frames the app knows. */
export function planeAnchor(
  ref: GeomRef | undefined,
  ctx: Pick<DialogContext, 'bodies' | 'construction'>,
): { anchor: Vec3; normal: Vec3 } | undefined {
  if (!ref) return undefined;
  const frame = placementFrame(ref, ctx);
  if (!frame) return undefined;
  if (ref.kind === 'face') {
    const face = faceFrame(ctx.bodies, ref);
    return { anchor: face?.origin ?? ref.fingerprint?.at ?? frame.origin, normal: frame.normal };
  }
  const report = ctx.construction?.[ref.id as never];
  return { anchor: report?.kind === 'plane' ? report.anchor : [0, 0, 0], normal: frame.normal };
}

/** The offset plane's arrow: from the plane's centre along its normal, to the distance. */
function offsetManipulators(values: DialogValues, ctx: ManipulatorContext): Manipulator[] {
  const base = planeAnchor(values.refs.plane?.[0], ctx);
  if (!base) return [];
  return [{ kind: 'distance', field: 'distance', origin: base.anchor, direction: base.normal }];
}

/**
 * The handle along a path (P4-12): from the path's start, along its direction,
 * to the value. Only a straight path shows one, so the handle's own line is the
 * path; the draft's report says where the path starts and how long it is.
 */
function pathManipulators(values: DialogValues, ctx: ManipulatorContext): Manipulator[] {
  const report = ctx.draftConstruction;
  const along = report?.kind === 'point' || report?.kind === 'plane' ? report.path : undefined;
  if (!along?.straight) return [];
  const byLength = values.choices.by === 'length';
  return [
    {
      kind: 'distance',
      field: byLength ? 'distance' : 'position',
      origin: along.from,
      direction: along.tangent,
      scale: byLength ? 1 : along.length,
    },
  ];
}

/** The angle arc about the line, from where the plane's normal is at 0°. */
function angleManipulators(values: DialogValues, ctx: ManipulatorContext): Manipulator[] {
  const ref = values.refs.axis?.[0];
  const line = ref && axisLine(ref, ctx);
  if (!line) return [];
  let zero = squareTo(line.direction);
  const reference = planeAnchor(values.refs.plane?.[0], ctx);
  if (reference) {
    const flat = unit([
      reference.normal[0] - line.direction[0] * dot(reference.normal, line.direction),
      reference.normal[1] - line.direction[1] * dot(reference.normal, line.direction),
      reference.normal[2] - line.direction[2] * dot(reference.normal, line.direction),
    ]);
    if (Number.isFinite(flat[0]) && Math.hypot(...flat) > 0.5) zero = flat;
  }
  return [{ kind: 'angle', field: 'angle', origin: line.origin, axis: line.direction, zero }];
}

// -------------------------------------------------------------------- specs

export const offsetPlaneDialog = construction(
  OFFSET_PLANE_TYPE,
  [
    selection('plane', 'Plane', PLANE_SOURCE_KINDS, {
      max: 1,
      prompt: 'Pick a plane or flat face',
      hint: planeHint,
    }),
    expression(
      'distance',
      'Distance',
      'length',
      '10 mm',
      'Along the plane’s normal (a face’s outward one). Negative goes the other way.',
    ),
  ],
  { manipulators: offsetManipulators },
);

export const planeAtAngleDialog = construction(
  PLANE_AT_ANGLE_TYPE,
  [
    selection('axis', 'Line', LINE_SOURCE_KINDS, {
      max: 1,
      prompt: 'Pick an axis, a straight edge or a sketch line',
      hint: 'The line the plane turns about.',
    }),
    selection('plane', 'Reference plane', PLANE_SOURCE_KINDS, {
      min: 0,
      max: 1,
      prompt: 'Automatic',
      hint: 'The plane the angle counts from. Without one, 0° is the most horizontal plane through the line.',
    }),
    expression('angle', 'Angle', 'angle', '45 deg', 'Right-handed about the line.'),
  ],
  { validate: lineOnly('axis'), manipulators: angleManipulators },
);

export const midplaneDialog = construction(MIDPLANE_TYPE, [
  selection('planes', 'Planes', PLANE_SOURCE_KINDS, {
    min: 2,
    max: 2,
    prompt: 'Pick two parallel planes or faces',
    hint: 'Two parallel planes or flat faces: the plane halfway between them.',
  }),
]);

export const planeThroughPointsDialog = construction(PLANE_THROUGH_POINTS_TYPE, [
  selection('points', 'Points', POINT_SOURCE_KINDS, {
    min: 3,
    max: 3,
    prompt: 'Pick three points',
    hint: 'Construction points or body vertices that don’t lie on one line.',
  }),
]);

export const tangentPlaneDialog = construction(
  TANGENT_PLANE_TYPE,
  [
    selection('face', 'Face', ['face'], {
      max: 1,
      prompt: 'Pick a cylindrical, conical or spherical face',
      hint: 'The face the plane touches.',
    }),
    selection('plane', 'Reference plane', PLANE_SOURCE_KINDS, {
      min: 0,
      max: 1,
      prompt: 'Automatic',
      hint: 'Where round the face it touches: where the face’s normal is closest to the plane’s normal.',
    }),
    selection('point', 'Nearest point', POINT_SOURCE_KINDS, {
      min: 0,
      max: 1,
      prompt: 'Automatic',
      hint: 'Touch the face nearest this point. A torus and a free-form face need it.',
    }),
    expression(
      'angle',
      'Angle',
      'angle',
      '0 deg',
      'Turns the touching point about the face’s axis. A sphere ignores it.',
    ),
    {
      // A free-form face's touching point comes from a fine mesh, not the
      // analytic surface: say so rather than dropping the report's `basis`
      // (P4-12 review L6).
      kind: 'info',
      name: 'basis',
      label: 'Tangent',
      shown: (_values, ctx) =>
        ctx?.draftConstruction?.kind === 'plane' && ctx.draftConstruction.basis === 'mesh',
      text: (_values, ctx) => {
        const report = ctx.draftConstruction;
        return report?.kind === 'plane' && report.basis === 'mesh'
          ? 'Tangent read from the display mesh.'
          : '';
      },
    },
  ],
  { validate: curvedFace('face', 'Pick a curved face: a flat face is its own plane.') },
);

export const axisThroughPointsDialog = construction(AXIS_THROUGH_POINTS_TYPE, [
  selection('points', 'Points', POINT_SOURCE_KINDS, {
    min: 2,
    max: 2,
    prompt: 'Pick two points',
    hint: 'Construction points or body vertices: the axis runs from the first to the second.',
  }),
]);

export const axisThroughCylinderDialog = construction(
  AXIS_THROUGH_CYLINDER_TYPE,
  [
    selection('face', 'Face', ['face'], {
      max: 1,
      prompt: 'Pick a cylindrical face',
      hint: 'A cylindrical, conical or toroidal face: its own axis.',
    }),
  ],
  { validate: curvedFace('face', 'A flat face has no axis. Pick a cylindrical face.') },
);

export const axisAlongEdgeDialog = construction(
  AXIS_ALONG_EDGE_TYPE,
  [
    selection('edge', 'Edge', ['edge', 'sketchEntity'], {
      max: 1,
      prompt: 'Pick an edge or sketch line',
      hint: 'A straight edge or sketch line, or a circular edge (its axis through the centre).',
    }),
  ],
  { validate: lineOnly('edge') },
);

export const constructionPointDialog = construction(CONSTRUCTION_POINT_TYPE, [
  selection('at', 'Position', ['point', 'vertex', 'edge', 'face'], {
    min: 0,
    max: 1,
    prompt: 'Origin',
    hint: 'A vertex, a point, a circular edge’s centre, an edge’s middle or a face’s centre. Empty: the origin.',
  }),
  expression('x', 'X', 'length', '0 mm', 'Moves the point along the world X axis.'),
  expression('y', 'Y', 'length', '0 mm', 'Moves the point along the world Y axis.'),
  expression('z', 'Z', 'length', '0 mm', 'Moves the point along the world Z axis.'),
]);

export const pointOnPathDialog = construction(POINT_ON_PATH_TYPE, pathFields('point'), {
  manipulators: pathManipulators,
});

export const planeAlongPathDialog = construction(PLANE_ALONG_PATH_TYPE, pathFields('plane'), {
  manipulators: pathManipulators,
});

export const pointAtIntersectionDialog = construction(POINT_AT_INTERSECTION_TYPE, [
  selection('entities', 'Entities', INTERSECTION_SOURCE_KINDS, {
    min: 2,
    max: 3,
    prompt: 'Pick two edges, an edge and a plane, or three planes',
    hint: 'Two edges, an edge and a plane or flat face, or three planes: they meet at the point.',
  }),
]);

export const midplaneAngledDialog = construction(MIDPLANE_ANGLED_TYPE, [
  selection('planes', 'Planes', PLANE_SOURCE_KINDS, {
    min: 2,
    max: 2,
    prompt: 'Pick two planes or faces at an angle',
    hint: 'Two non-parallel planes or flat faces: the plane that bisects them.',
  }),
  toggle('flip', 'Flip', false, 'Take the other bisector.'),
]);

/** The thirteen construction dialogs, for the registry. */
export const CONSTRUCTION_DIALOGS = [
  offsetPlaneDialog,
  planeAtAngleDialog,
  midplaneDialog,
  planeThroughPointsDialog,
  tangentPlaneDialog,
  axisThroughPointsDialog,
  axisThroughCylinderDialog,
  axisAlongEdgeDialog,
  constructionPointDialog,
  pointOnPathDialog,
  pointAtIntersectionDialog,
  planeAlongPathDialog,
  midplaneAngledDialog,
] as const;
