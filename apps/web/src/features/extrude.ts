/**
 * The extrude dialog (P2-06, ADR-0028, FR-FT-01): profiles or flat faces,
 * one side / symmetric / two sides, each side to a distance, an object or
 * through all, with a taper; flip; new body, join, cut or intersect with
 * automatic or picked bodies. Fields are named like the feature's inputs
 * (`ExtrudeInputs`), so the framework's default mapping turns them into
 * inputs and back; hidden fields make no input (side 2 while one-sided).
 *
 * Press-pull: an extruded face proposes **join** when it goes out of its
 * body and **cut** when it goes in (a negative distance, or flip), until
 * the user picks an operation (`propose`). Profiles propose a new body.
 */
import {
  EXTRUDE_OBJECT_KINDS,
  EXTRUDE_PROFILE_KINDS,
  type ExtrudeOperation,
  extrudeFeature,
  type GeomRef,
  parseProfileRefId,
  readSketch,
  type Vec3,
} from '@extrudo/core';
import type { PreviewToolStyle } from '@extrudo/kernel';
import { type Frame, faceFrame, meanFrame, profileFrame } from './geometry';
import { along, cross } from './manipulate';
import {
  type DialogContext,
  type DialogValues,
  defineFeatureDialog,
  type Manipulator,
  type ManipulatorContext,
} from './spec';

const DIRECTIONS = [
  { value: 'one-side', label: 'One side' },
  { value: 'symmetric', label: 'Symmetric' },
  { value: 'two-sides', label: 'Two sides' },
] as const;

const EXTENTS = [
  { value: 'distance', label: 'Distance' },
  { value: 'to-object', label: 'To object' },
  { value: 'through-all', label: 'Through all' },
] as const;

const OPERATIONS = [
  { value: 'new-body', label: 'New body' },
  { value: 'join', label: 'Join' },
  { value: 'cut', label: 'Cut' },
  { value: 'intersect', label: 'Intersect' },
] as const;

const PREVIEW_STYLE: Record<ExtrudeOperation, PreviewToolStyle> = {
  'new-body': 'new',
  join: 'join',
  cut: 'cut',
  intersect: 'intersect',
};

const twoSides = (v: DialogValues) => v.choices.direction === 'two-sides';
const extentOf = (v: DialogValues, side: 1 | 2) =>
  v.choices[side === 1 ? 'extent' : 'extent2'] ?? 'distance';

export const extrudeDialog = defineFeatureDialog({
  ...extrudeFeature,
  command: 'extrude',
  fields: [
    {
      kind: 'selection',
      name: 'profiles',
      label: 'Profiles',
      accepts: EXTRUDE_PROFILE_KINDS,
      prompt: 'Pick profiles or flat faces',
      hint: 'Sketch profiles or flat faces of bodies, all in one plane.',
    },
    {
      kind: 'choice',
      name: 'direction',
      label: 'Direction',
      options: DIRECTIONS,
      default: 'one-side',
    },
    { kind: 'choice', name: 'extent', label: 'Extent', options: EXTENTS, default: 'distance' },
    {
      kind: 'expression',
      name: 'distance',
      label: 'Distance',
      unit: 'length',
      default: '10 mm',
      hint: 'Negative goes the other way. Symmetric: the whole length.',
      shown: (v) => extentOf(v, 1) === 'distance',
    },
    {
      kind: 'selection',
      name: 'toObject',
      label: 'To object',
      accepts: EXTRUDE_OBJECT_KINDS,
      max: 1,
      prompt: 'Pick a flat face or a vertex',
      shown: (v) => extentOf(v, 1) === 'to-object',
    },
    {
      kind: 'expression',
      name: 'taper',
      label: 'Taper',
      unit: 'angle',
      default: '0 deg',
      hint: 'Positive widens the profile along the extrude, negative narrows it.',
    },
    {
      kind: 'choice',
      name: 'extent2',
      label: 'Extent 2',
      options: EXTENTS,
      default: 'distance',
      shown: twoSides,
    },
    {
      kind: 'expression',
      name: 'distance2',
      label: 'Distance 2',
      unit: 'length',
      default: '10 mm',
      hint: 'Side 2 goes against the direction.',
      shown: (v) => twoSides(v) && extentOf(v, 2) === 'distance',
    },
    {
      kind: 'selection',
      name: 'toObject2',
      label: 'To object 2',
      accepts: EXTRUDE_OBJECT_KINDS,
      max: 1,
      prompt: 'Pick a flat face or a vertex',
      shown: (v) => twoSides(v) && extentOf(v, 2) === 'to-object',
    },
    {
      kind: 'expression',
      name: 'taper2',
      label: 'Taper 2',
      unit: 'angle',
      default: '0 deg',
      shown: twoSides,
    },
    { kind: 'toggle', name: 'flip', label: 'Flip', default: false },
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
      hint: 'The bodies to join, cut or intersect. Empty: every body the extrude reaches.',
      shown: (v) => (v.choices.operation ?? 'new-body') !== 'new-body',
    },
  ],
  validate(values) {
    if (values.choices.direction === 'symmetric' && extentOf(values, 1) === 'to-object') {
      return {
        field: 'extent',
        message: "A symmetric extrude can't end at an object. Use two sides instead.",
      };
    }
    return undefined;
  },
  propose: (values, ctx) => proposeOperation(values, ctx),
  manipulators: (values, ctx) => extrudeManipulators(values, ctx),
  previewStyle: (values) =>
    PREVIEW_STYLE[(values.choices.operation ?? 'new-body') as ExtrudeOperation] ?? 'new',
});

/**
 * The press-pull rule (ADR-0028): profiles make a new body; flat faces
 * join when side 1 goes out of their body (along the face's outward
 * normal) and cut when it goes in (a negative distance or flip; through
 * all goes in only when flipped). A symmetric extrude goes both ways and
 * joins; to-object and an invalid distance propose nothing. The framework
 * applies it only while the user hasn't picked an operation. A profile of a
 * sketch on a body's face (P2-09) counts as that face: drawn on a lid and
 * pushed in, it cuts.
 */
export function proposeOperation(
  values: DialogValues,
  ctx: Pick<ManipulatorContext, 'value'> & Partial<Pick<ManipulatorContext, 'doc'>>,
): Partial<DialogValues> | undefined {
  const refs = values.refs.profiles ?? [];
  if (refs.length === 0) return undefined;
  const operation = (op: ExtrudeOperation) => ({ choices: { operation: op } });
  const onFace = (ref: GeomRef) => {
    const sketch = ref.kind === 'profile' ? parseProfileRefId(ref.id)?.feature : undefined;
    const feature = sketch && ctx.doc?.features.find((f) => f.id === sketch);
    return (feature && readSketch(feature)?.plane.kind) === 'face';
  };
  if (!refs.some((r) => r.kind === 'face' || onFace(r))) return operation('new-body');
  if (values.choices.direction === 'symmetric') return operation('join');
  const flip = values.toggles.flip === true ? -1 : 1;
  switch (extentOf(values, 1)) {
    case 'through-all':
      return operation(flip > 0 ? 'join' : 'cut');
    case 'distance': {
      const distance = ctx.value('distance');
      if (distance === undefined || distance === 0) return undefined;
      return operation(distance * flip > 0 ? 'join' : 'cut');
    }
    default:
      return undefined;
  }
}

/**
 * Where the extrude starts: the mean of the picks' centroids, with the
 * first one's normal (a profile's sketch plane, a face's outward normal),
 * like the kernel's direction.
 */
export function extrudeFrame(
  refs: readonly GeomRef[],
  ctx: Pick<DialogContext, 'doc' | 'bodies' | 'sketches'>,
): Frame | undefined {
  return meanFrame(
    refs.map((ref) =>
      ref.kind === 'face' ? faceFrame(ctx.bodies, ref) : profileFrame(ctx.doc, ref, ctx.sketches),
    ),
  );
}

/**
 * A distance arrow per side that ends at a distance (side 1 along the
 * normal, reversed by flip; side 2 against it), from the profiles' centre;
 * symmetric arrows reach half the length. A taper arc at the end of each
 * side, from the way the side goes (back, for a negative distance), turning
 * outwards for a positive taper (it widens along the sweep).
 */
export function extrudeManipulators(values: DialogValues, ctx: ManipulatorContext): Manipulator[] {
  const frame = extrudeFrame(values.refs.profiles ?? [], ctx);
  if (!frame) return [];
  const flip = values.toggles.flip === true;
  const d: Vec3 = flip ? scale(frame.normal, -1) : frame.normal;
  const out = inPlane(d);
  const symmetric = values.choices.direction === 'symmetric';
  const sides: { side: 1 | 2; dir: Vec3; distance: string; taper: string }[] = [
    { side: 1, dir: d, distance: 'distance', taper: 'taper' },
  ];
  if (twoSides(values)) {
    sides.push({ side: 2, dir: scale(d, -1), distance: 'distance2', taper: 'taper2' });
  }
  const manipulators: Manipulator[] = [];
  for (const { side, dir, distance, taper } of sides) {
    const byDistance = extentOf(values, side) === 'distance';
    const reach = side === 1 && symmetric ? 0.5 : 1;
    if (byDistance) {
      manipulators.push({
        kind: 'distance',
        field: distance,
        origin: frame.origin,
        direction: dir,
        ...(reach !== 1 && { scale: reach }),
      });
    }
    const end = byDistance ? (ctx.value(distance) ?? 0) * reach : 0;
    // The taper leans the side away from the way it goes (a negative distance goes back).
    const travel = end < 0 ? scale(dir, -1) : dir;
    manipulators.push({
      kind: 'angle',
      field: taper,
      origin: along(frame.origin, dir, end),
      axis: unit(cross(travel, out)),
      zero: travel,
    });
  }
  return manipulators;
}

/** A unit vector square to `n`, where taper arcs open: towards +Z, or +X when `n` is nearly along Z. */
function inPlane(n: Vec3): Vec3 {
  const other: Vec3 = Math.abs(n[2]) > 0.9 ? [1, 0, 0] : [0, 0, 1];
  const k = n[0] * other[0] + n[1] * other[1] + n[2] * other[2];
  return unit([other[0] - k * n[0], other[1] - k * n[1], other[2] - k * n[2]]);
}

const scale = (v: Vec3, s: number): Vec3 => [v[0] * s, v[1] * s, v[2] * s];

function unit(v: Vec3): Vec3 {
  const length = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / length, v[1] / length, v[2] / length];
}
