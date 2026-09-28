/**
 * The primitive dialogs (P2-10, ADR-0032, FR-FT-03): Box, Cylinder, Sphere
 * and Torus. Each sits on a plane (an origin plane or a flat face of a
 * body, picked like Create Sketch's plane), centred at X and Y in the
 * plane's sketch frame and lifted by Offset; a box also turns (Rotation).
 * Then its sizes, and new body, join, cut or intersect with automatic or
 * picked bodies. Fields are named like the feature's inputs, so the
 * framework's default mapping turns them into inputs and back.
 *
 * `propose` fills in what the user hasn't set: the XY plane when no plane
 * is picked, the centre of a picked face as X and Y (an origin plane's
 * origin otherwise), and the operation: a new body on a plane; on a face,
 * join, or cut for a box or cylinder going into it (a negative height).
 */
import {
  BOX_ROTATION,
  type BodyOperation,
  DEFAULT_PLACEMENT,
  type FeatureDefinition,
  faceSketchFrame,
  fingerprintFrame,
  type GeomRef,
  PLACEMENT_KINDS,
  PLACEMENT_NUMBERS,
  PRIMITIVE_FEATURES,
  PRIMITIVE_SIZES,
  type PrimitiveNumber,
  type PrimitiveType,
  planeFrame,
  type SketchFrame,
  sketchToWorld,
  type Vec3,
  worldToSketch,
} from '@extrudo/core';
import type { PreviewToolStyle } from '@extrudo/kernel';
import type { ToolId } from '../shell/tools';
import { isFlatFace } from '../sketch/facePick';
import { faceFrame } from './geometry';
import { cross } from './manipulate';
import {
  type DialogContext,
  type DialogField,
  type DialogValues,
  defineFeatureDialog,
  type FeatureDialogSpec,
  type Manipulator,
  type ManipulatorContext,
  type ProposeContext,
} from './spec';

const OPERATIONS = [
  { value: 'new-body', label: 'New body' },
  { value: 'join', label: 'Join' },
  { value: 'cut', label: 'Cut' },
  { value: 'intersect', label: 'Intersect' },
] as const;

const PREVIEW_STYLE: Record<BodyOperation, PreviewToolStyle> = {
  'new-body': 'new',
  join: 'join',
  cut: 'cut',
  intersect: 'intersect',
};

/** Each number field's hint, by type and input name (placement ones under `*`). */
const HINTS: Record<PrimitiveType | '*', Record<string, string>> = {
  box: {
    length: 'Along the plane’s X (turned by Rotation).',
    width: 'Along the plane’s Y.',
    height: 'Up from the plane. Negative goes into it.',
    rotation: 'Turns the box about its centre.',
  },
  cylinder: { height: 'Up from the plane. Negative goes into it.' },
  sphere: {},
  torus: {
    diameter: 'Through the middle of the tube.',
    tube: 'The tube’s thickness, smaller than the diameter.',
  },
  '*': {
    x: 'Where the centre sits along the plane’s X.',
    y: 'Where the centre sits along the plane’s Y.',
    offset: 'Lifts it off the plane (negative: below).',
  },
};

function numberField(type: PrimitiveType, number: PrimitiveNumber): DialogField {
  const hint = HINTS[type][number.name] ?? HINTS['*'][number.name];
  return {
    kind: 'expression',
    name: number.name,
    label: number.label,
    unit: number.unit,
    default: number.default,
    ...(hint && { hint }),
  };
}

/** The dialog of one primitive type; its command is the toolbar tool of the same ID. */
function primitiveDialog(type: PrimitiveType): FeatureDialogSpec {
  const feature = PRIMITIVE_FEATURES[type] as FeatureDefinition;
  return defineFeatureDialog({
    ...feature,
    command: type satisfies ToolId,
    fields: [
      {
        kind: 'selection',
        name: 'plane',
        label: 'Plane',
        accepts: PLACEMENT_KINDS,
        max: 1,
        prompt: 'Pick a plane or flat face',
        hint: `An origin plane or a flat face of a body: the ${feature.label.toLowerCase()} sits on it.`,
      },
      ...PRIMITIVE_SIZES[type].map((n) => numberField(type, n)),
      ...PLACEMENT_NUMBERS.map((n) => numberField(type, n)),
      ...(type === 'box' ? [numberField(type, BOX_ROTATION)] : []),
      {
        kind: 'choice',
        name: 'operation',
        label: 'Operation',
        options: OPERATIONS,
        default: 'new-body',
      },
      {
        kind: 'selection',
        name: 'bodies',
        label: 'Bodies',
        accepts: ['body'],
        min: 0,
        prompt: 'Automatic',
        hint: `The bodies to join, cut or intersect. Empty: every body the ${feature.label.toLowerCase()} reaches.`,
        shown: (v) => (v.choices.operation ?? 'new-body') !== 'new-body',
      },
    ],
    validate(values, ctx) {
      const plane = values.refs.plane?.[0];
      if (plane?.kind === 'face' && isCurvedFace(plane, ctx)) {
        return { field: 'plane', message: 'Pick a flat face or a plane.' };
      }
      return undefined;
    },
    propose: (values, ctx) => proposePrimitive(type, values, ctx),
    manipulators: (values, ctx) => primitiveManipulators(type, values, ctx),
    previewStyle: (values) =>
      PREVIEW_STYLE[(values.choices.operation ?? 'new-body') as BodyOperation] ?? 'new',
  });
}

export const boxDialog = primitiveDialog('box');
export const cylinderDialog = primitiveDialog('cylinder');
export const sphereDialog = primitiveDialog('sphere');
export const torusDialog = primitiveDialog('torus');

/** The four primitive dialogs, for the registry. */
export const PRIMITIVE_DIALOGS = [boxDialog, cylinderDialog, sphereDialog, torusDialog] as const;

/** Whether a picked face is one the view's meshes show as curved (the kernel says the rest). */
function isCurvedFace(ref: GeomRef, ctx: Pick<DialogContext, 'bodies'>): boolean {
  for (const mesh of Object.values(ctx.bodies)) {
    const face = mesh.faceIds?.indexOf(ref.id) ?? -1;
    if (face >= 0) return !isFlatFace(mesh, face);
  }
  return false;
}

/**
 * The frame of the plane a primitive sits on, as the kernel makes it: an
 * origin plane's, or a flat face's sketch frame (`faceSketchFrame`) from
 * its mesh (the fingerprint's until the meshes have the face).
 */
export function placementFrame(
  ref: GeomRef | undefined,
  ctx: Pick<DialogContext, 'bodies'>,
): SketchFrame | undefined {
  if (!ref) return undefined;
  if (ref.kind !== 'face') return planeFrame(ref);
  const frame = faceFrame(ctx.bodies, ref);
  return frame ? faceSketchFrame(frame.origin, frame.normal) : fingerprintFrame(ref);
}

/** The value of a number field, or its default while its expression doesn't evaluate. */
function numberValue(type: PrimitiveType, ctx: Pick<ManipulatorContext, 'value'>, name: string) {
  const number = [...PRIMITIVE_SIZES[type], ...PLACEMENT_NUMBERS, BOX_ROTATION].find(
    (n) => n.name === name,
  );
  return ctx.value(name) ?? number?.value ?? 0;
}

/**
 * The primitive's own frame, as the kernel's `PrimitiveOutputData.frame`:
 * the plane's frame moved to (X, Y), lifted by Offset and, for a box,
 * turned by Rotation. Also the plane's frame, where the rotation arc starts.
 */
export function primitiveFrame(
  type: PrimitiveType,
  values: DialogValues,
  ctx: Pick<ManipulatorContext, 'bodies' | 'value'>,
): { frame: SketchFrame; plane: SketchFrame } | undefined {
  const plane = placementFrame(values.refs.plane?.[0], ctx);
  if (!plane) return undefined;
  const v = (name: string) => numberValue(type, ctx, name);
  const at = sketchToWorld(plane, [v('x'), v('y')]);
  const origin = along(at, plane.normal, v('offset'));
  const turn = type === 'box' ? (v('rotation') * Math.PI) / 180 : 0;
  const x = unit(add(scale(plane.x, Math.cos(turn)), scale(plane.y, Math.sin(turn))));
  return { frame: { origin, x, y: cross(plane.normal, x), normal: plane.normal }, plane };
}

/**
 * Arrows for the sizes (a box's length and width and every diameter from
 * the centre, reaching half the size; heights along the normal from the
 * base) and a box's rotation arc about the normal.
 */
export function primitiveManipulators(
  type: PrimitiveType,
  values: DialogValues,
  ctx: ManipulatorContext,
): Manipulator[] {
  const placed = primitiveFrame(type, values, ctx);
  if (!placed) return [];
  const { frame, plane } = placed;
  const { origin, x, y, normal } = frame;
  const arrow = (field: string, direction: Vec3, from = origin, reach = 1): Manipulator => ({
    kind: 'distance',
    field,
    origin: from,
    direction,
    ...(reach !== 1 && { scale: reach }),
  });
  switch (type) {
    case 'box':
      return [
        arrow('length', x, origin, 0.5),
        arrow('width', y, origin, 0.5),
        arrow('height', normal),
        { kind: 'angle', field: 'rotation', origin, axis: normal, zero: plane.x },
      ];
    case 'cylinder':
      return [arrow('diameter', x, origin, 0.5), arrow('height', normal)];
    case 'sphere':
      return [arrow('diameter', x, origin, 0.5)];
    case 'torus': {
      const ring = along(origin, x, numberValue(type, ctx, 'diameter') / 2);
      return [arrow('diameter', x, origin, 0.5), arrow('tube', x, ring, 0.5)];
    }
  }
}

/**
 * What a primitive proposes for the fields the user hasn't set: the XY
 * plane when none is picked; X and Y at the centre of a picked face (in
 * its sketch frame), at the origin on an origin plane; and the operation:
 * a new body on a plane, on a face join, or cut for a box or cylinder that
 * goes into the face (a negative height).
 */
export function proposePrimitive(
  type: PrimitiveType,
  values: DialogValues,
  ctx: Pick<ProposeContext, 'bodies' | 'value'>,
): Partial<DialogValues> {
  const picked = values.refs.plane ?? [];
  const plane = picked[0] ?? DEFAULT_PLACEMENT;
  const out: { refs?: DialogValues['refs']; exprs?: Record<string, string> } & Partial<
    Pick<DialogValues, 'choices'>
  > = {};
  if (picked.length === 0) out.refs = { plane: [plane] };
  const centre = plane.kind === 'face' ? faceCentre(plane, ctx) : [0, 0];
  if (centre) out.exprs = { x: mm(centre[0] ?? 0), y: mm(centre[1] ?? 0) };
  let operation: BodyOperation = 'new-body';
  if (plane.kind === 'face') {
    const height = type === 'box' || type === 'cylinder' ? ctx.value('height') : undefined;
    operation = height !== undefined && height < 0 ? 'cut' : 'join';
  }
  return { ...out, choices: { operation } };
}

/** A face's area centroid in its sketch frame, from the meshes (the fingerprint's until then). */
function faceCentre(
  ref: GeomRef,
  ctx: Pick<DialogContext, 'bodies'>,
): readonly number[] | undefined {
  const frame = placementFrame(ref, ctx);
  const centroid = faceFrame(ctx.bodies, ref)?.origin ?? ref.fingerprint?.at;
  return frame && centroid && worldToSketch(frame, centroid);
}

/** A length as an expression, to the micrometre: "12.5 mm". */
function mm(value: number): string {
  const rounded = Math.round(value * 1000) / 1000;
  return `${Object.is(rounded, -0) ? 0 : rounded} mm`;
}

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (v: Vec3, s: number): Vec3 => [v[0] * s, v[1] * s, v[2] * s];
const along = (o: Vec3, d: Vec3, t: number): Vec3 => add(o, scale(d, t));

function unit(v: Vec3): Vec3 {
  const length = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / length, v[1] / length, v[2] / length];
}
