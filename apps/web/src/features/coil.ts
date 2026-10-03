/**
 * The coil dialog (P4-01, ADR-0055, FR-FT-14): a plane or flat face picked
 * like a primitive's (ADR-0032), which two of revolutions, height and pitch
 * set its length, the diameter, a taper, which way it winds, the section
 * (circle, square, triangle out or in), its size and where it sits against
 * the diameter, the axis's place on the plane; new body, join, cut or
 * intersect. Fields are named like the feature's inputs (`CoilInputs`), so
 * the framework's default mapping turns them into inputs and back; the
 * number the type doesn't use is hidden and makes no input.
 *
 * `propose` fills in what the user hasn't set, as for a primitive: the XY
 * plane, the centre of a picked face as X and Y, and a new body on a plane
 * or a join on a face. Arrows set the diameter and, when the type has it,
 * the height.
 */
import {
  type BodyOperation,
  COIL_NUMBERS,
  COIL_TYPE_NUMBERS,
  type CoilType,
  coilFeature,
  DEFAULT_PLACEMENT,
  type GeomRef,
  PLACEMENT_KINDS,
  type PrimitiveNumber,
  type SketchFrame,
  sketchToWorld,
  type Vec3,
  worldToSketch,
} from '@extrudo/core';
import { faceFrame } from './geometry';
import { placementFrame } from './primitives';
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
import { operationFields, previewStyleOf } from './sweep';
import { defaultFromInputs } from './values';

const TYPES = [
  { value: 'revolutions-height', label: 'Revolutions and height' },
  { value: 'revolutions-pitch', label: 'Revolutions and pitch' },
  { value: 'height-pitch', label: 'Height and pitch' },
] as const;

const DIRECTIONS = [
  { value: 'counter-clockwise', label: 'Counter-clockwise' },
  { value: 'clockwise', label: 'Clockwise' },
] as const;

const SECTIONS = [
  { value: 'circle', label: 'Circle' },
  { value: 'square', label: 'Square' },
  { value: 'triangle-out', label: 'Triangle, pointing out' },
  { value: 'triangle-in', label: 'Triangle, pointing in' },
] as const;

const POSITIONS = [
  { value: 'inside', label: 'Inside' },
  { value: 'on', label: 'On the diameter' },
  { value: 'outside', label: 'Outside' },
] as const;

const HINTS: Record<string, string> = {
  diameter: 'The helix’s diameter where it starts.',
  revolutions: 'How many turns; fractions are fine.',
  height: 'From the start to the end, along the axis.',
  pitch: 'How far it rises per turn. It must be larger than the section.',
  taper: 'Widens the coil as it rises (negative narrows it).',
  size: 'The circle’s diameter, the square’s side, the triangle’s base.',
  x: 'Where the axis sits along the plane’s X.',
  y: 'Where the axis sits along the plane’s Y.',
  offset: 'Lifts the start off the plane (negative: below).',
};

const typeOf = (v: DialogValues): CoilType => (v.choices.type ?? 'revolutions-height') as CoilType;

/** Whether the coil's type uses a number (revolutions, height, pitch; the rest always). */
const usesNumber = (name: string) => (v: DialogValues) =>
  !['revolutions', 'height', 'pitch'].includes(name) ||
  (COIL_TYPE_NUMBERS[typeOf(v)] as readonly string[]).includes(name);

const number = (name: string): DialogField => {
  const n = COIL_NUMBERS.find((c) => c.name === name) as PrimitiveNumber;
  return {
    kind: 'expression',
    name,
    label: n.label,
    unit: n.unit,
    default: n.default,
    ...(HINTS[name] && { hint: HINTS[name] }),
    shown: usesNumber(name),
  };
};

export const coilDialog: FeatureDialogSpec = defineFeatureDialog({
  ...coilFeature,
  command: 'coil',
  fields: [
    {
      kind: 'selection',
      name: 'plane',
      label: 'Plane',
      accepts: PLACEMENT_KINDS,
      max: 1,
      prompt: 'Pick a plane or flat face',
      hint: 'An origin plane or a flat face of a body: the coil rises from it.',
    },
    { kind: 'choice', name: 'type', label: 'Type', options: TYPES, default: 'revolutions-height' },
    number('diameter'),
    number('revolutions'),
    number('height'),
    number('pitch'),
    number('taper'),
    {
      kind: 'choice',
      name: 'direction',
      label: 'Direction',
      options: DIRECTIONS,
      default: 'counter-clockwise',
      hint: 'Which way it winds, seen from above. Counter-clockwise is a right-hand spring.',
    },
    { kind: 'choice', name: 'section', label: 'Section', options: SECTIONS, default: 'circle' },
    number('size'),
    {
      kind: 'choice',
      name: 'position',
      label: 'Section position',
      options: POSITIONS,
      default: 'on',
      hint: 'Where the section sits against the diameter.',
    },
    number('x'),
    number('y'),
    number('offset'),
    ...operationFields('coil'),
  ],
  // A coil stored without a plane stands on XY (`DEFAULT_PLACEMENT`): show it so.
  fromInputs(inputs) {
    const values = defaultFromInputs(coilDialog, inputs);
    const plane = values.refs?.plane?.length ? values.refs.plane : [DEFAULT_PLACEMENT];
    return { ...values, refs: { ...values.refs, plane } };
  },
  propose: (values, ctx) => proposeCoil(values, ctx),
  manipulators: (values, ctx) => coilManipulators(values, ctx),
  previewStyle: previewStyleOf,
});

/** The value of a number field, or its default while its expression doesn't evaluate. */
function numberOf(ctx: Pick<ManipulatorContext, 'value'>, name: string): number {
  return ctx.value(name) ?? COIL_NUMBERS.find((n) => n.name === name)?.value ?? 0;
}

/** The coil's frame as the kernel makes it (`CoilOutputData.frame`): the plane's, at (X, Y), lifted by Offset. */
export function coilFrame(
  values: DialogValues,
  ctx: Pick<ManipulatorContext, 'bodies' | 'construction' | 'value'>,
): SketchFrame | undefined {
  const plane = placementFrame(values.refs.plane?.[0] ?? DEFAULT_PLACEMENT, ctx);
  if (!plane) return undefined;
  const at = sketchToWorld(plane, [numberOf(ctx, 'x'), numberOf(ctx, 'y')]);
  const lift = numberOf(ctx, 'offset');
  const origin: Vec3 = [
    at[0] + plane.normal[0] * lift,
    at[1] + plane.normal[1] * lift,
    at[2] + plane.normal[2] * lift,
  ];
  return { ...plane, origin };
}

/** The diameter's arrow from the axis, and the height's along it (when the type sets the height). */
export function coilManipulators(values: DialogValues, ctx: ManipulatorContext): Manipulator[] {
  const frame = coilFrame(values, ctx);
  if (!frame) return [];
  const out: Manipulator[] = [
    { kind: 'distance', field: 'diameter', origin: frame.origin, direction: frame.x, scale: 0.5 },
  ];
  if (usesNumber('height')(values)) {
    out.push({ kind: 'distance', field: 'height', origin: frame.origin, direction: frame.normal });
  }
  return out;
}

/**
 * What a coil proposes for the fields the user hasn't set: the XY plane
 * when none is picked; X and Y at the centre of a picked face (in its
 * sketch frame), at the origin on a plane; a new body on a plane, a join on
 * a face.
 */
export function proposeCoil(
  values: DialogValues,
  ctx: Pick<ProposeContext, 'bodies' | 'construction'>,
): Partial<DialogValues> {
  const picked = values.refs.plane ?? [];
  const plane = picked[0] ?? DEFAULT_PLACEMENT;
  const out: Partial<DialogValues> & { exprs?: Record<string, string> } = {};
  if (picked.length === 0) out.refs = { plane: [plane] };
  const centre = plane.kind === 'face' ? faceCentre(plane, ctx) : [0, 0];
  if (centre) out.exprs = { x: mm(centre[0] ?? 0), y: mm(centre[1] ?? 0) };
  const operation: BodyOperation = plane.kind === 'face' ? 'join' : 'new-body';
  return { ...out, choices: { operation } };
}

function faceCentre(
  ref: GeomRef,
  ctx: Pick<DialogContext, 'bodies' | 'construction'>,
): readonly number[] | undefined {
  const frame = placementFrame(ref, ctx);
  const centroid = faceFrame(ctx.bodies, ref)?.origin ?? ref.fingerprint?.at;
  return frame && centroid && worldToSketch(frame, centroid);
}

function mm(value: number): string {
  const rounded = Math.round(value * 1000) / 1000;
  return `${Object.is(rounded, -0) ? 0 : rounded} mm`;
}
