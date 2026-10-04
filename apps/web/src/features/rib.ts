/**
 * The rib dialog (P4-10, ADR-0064 §1, FR-FT-17): the sketch line the wall
 * grows from, how thick it is, which side of the sketch plane it sits on, and
 * which way round the line it grows. Fields are named like the feature's
 * inputs (`curve`, `thickness`, `side`, `flip`), so the framework's default
 * mapping turns them into inputs and back.
 *
 * The line is picked like revolve's axis (one sketch line, construction lines
 * too), and the two arrows stand at its middle: the thickness arrow across the
 * sketch plane — from the near face of the band, half its length for a centred
 * wall — and the flip arrow along `d`, the way the wall grows. That direction
 * is the one the kernel works out (`features/rib.ts`): `n × u` signed towards
 * the body, read from where the bodies' mass is, reversed by flip. Nothing is
 * placed here: the kernel cuts the wall out of a slab it builds around the
 * line, so the wall closes on the body wherever the line reaches it.
 */
import {
  evaluateParameters,
  parseSketchEntityRefId,
  RIB_CURVE_KINDS,
  RIB_DEFAULT_THICKNESS,
  type RibSide,
  readSketch,
  ribFeature,
  type Vec3,
} from '@extrudo/core';
import { sketchFrame } from '../sketch/frame';
import { volumeCentroid } from '../viewport/bodyGeometry';
import { sketchLine } from './geometry';
import { cross } from './manipulate';
import {
  type DialogValues,
  defineFeatureDialog,
  type FeatureDialogSpec,
  type Manipulator,
  type ManipulatorContext,
} from './spec';

const SIDES = [
  { value: 'both', label: 'Centred' },
  { value: 'one', label: 'One side' },
  { value: 'other', label: 'Other side' },
] as const;

const side = (values: DialogValues): RibSide => (values.choices.side ?? 'both') as RibSide;

/** Where the thickness sits about the plane, along its normal, as a share of it. */
const bandOf = (values: DialogValues): [number, number] => {
  const s = side(values);
  return s === 'one' ? [0, 1] : s === 'other' ? [-1, 0] : [-0.5, 0.5];
};

export const ribDialog: FeatureDialogSpec = defineFeatureDialog({
  ...ribFeature,
  command: 'rib',
  fields: [
    {
      kind: 'selection',
      name: 'curve',
      label: 'Line',
      accepts: RIB_CURVE_KINDS,
      max: 1,
      prompt: 'Pick a sketch line',
      hint: 'One straight line of a sketch: the wall grows from it until it meets the body.',
    },
    {
      kind: 'expression',
      name: 'thickness',
      label: 'Thickness',
      unit: 'length',
      default: `${RIB_DEFAULT_THICKNESS} mm`,
      hint: 'How thick the wall is. Drag the arrow across the sketch plane.',
    },
    {
      kind: 'choice',
      name: 'side',
      label: 'Thickness side',
      options: SIDES,
      default: 'both',
    },
    { kind: 'toggle', name: 'flip', label: 'Flip', default: false },
  ],
  // The pick count and the expression are the framework's own checks; this is
  // the one thing it can't know: a wall of no thickness would add nothing.
  validate(values, ctx) {
    const thickness = evaluateParameters(ctx.doc).evaluate(values.exprs.thickness ?? '', 'length');
    if (thickness.ok && thickness.value <= 0) {
      return { field: 'thickness', message: 'The thickness must be greater than 0.' };
    }
    return undefined;
  },
  manipulators: ribManipulators,
  // The wall is part of the body's own material.
  previewStyle: () => 'join',
});

/**
 * The two arrows at the line's middle: the thickness across the sketch plane
 * and the way the wall grows along it. Nothing without a line, or without the
 * plane it lies in (a sketch the document doesn't have yet — the kernel reports
 * that).
 */
export function ribManipulators(values: DialogValues, ctx: ManipulatorContext): Manipulator[] {
  const frame = ribFrame(values, ctx);
  if (!frame) return [];
  // The arrow stands on the band's near face, so it reads as the wall's width.
  const thickness = ctx.value('thickness') ?? RIB_DEFAULT_THICKNESS;
  const near = bandOf(values)[0] * thickness;
  const out: Manipulator[] = [
    {
      kind: 'distance',
      field: 'thickness',
      origin: add(frame.middle, scale(frame.normal, near)),
      direction: frame.normal,
      // A centred wall's arrow is half the thickness, as an extrude's is.
      ...(side(values) === 'both' ? { scale: 0.5 } : {}),
    },
    { kind: 'arrow', field: 'flip', origin: frame.middle, direction: frame.towards },
  ];
  return out;
}

interface RibFrame {
  /** The line's middle in world mm: where the arrows stand. */
  middle: Vec3;
  /** The line's unit direction, from its start to its end. */
  along: Vec3;
  /** The sketch plane's normal: the way the thickness goes. */
  normal: Vec3;
  /** The way the wall grows beside the line, `flip` reversed. */
  towards: Vec3;
}

/**
 * The line, its plane and the way the wall grows, by the rule the kernel uses
 * (`features/rib.ts`): `n × u` signed towards the body's mass, so the arrow
 * shows the side the wall really fills.
 */
export function ribFrame(
  values: DialogValues,
  ctx: Pick<ManipulatorContext, 'doc' | 'bodies' | 'sketches' | 'construction'>,
): RibFrame | undefined {
  const ref = values.refs.curve?.[0];
  const ends = ref && sketchLine(ctx.doc, ref, ctx.sketches, ctx.construction);
  const normal = ref && normalOf(ref, ctx);
  if (!ends || !normal) return undefined;
  const [a, b] = ends;
  const along = unit(sub(b, a));
  const middle = scale(add(a, b), 0.5);
  const across = cross(normal, along);
  const mass = massCentre(ctx.bodies);
  const towards = mass && dot(across, sub(mass, middle)) < 0 ? scale(across, -1) : across;
  return {
    middle,
    along,
    normal,
    towards: values.toggles.flip === true ? scale(towards, -1) : towards,
  };
}

/** The normal of the plane the picked line lies in: its sketch's own plane. */
function normalOf(
  ref: NonNullable<DialogValues['refs']['curve']>[number],
  ctx: Pick<ManipulatorContext, 'doc' | 'sketches' | 'construction'>,
): Vec3 | undefined {
  const parsed = parseSketchEntityRefId(ref.id);
  const feature = parsed && ctx.doc.features.find((f) => f.id === parsed.feature);
  const sketch = feature && readSketch(feature);
  if (!feature || !sketch) return undefined;
  return sketchFrame(feature.id, sketch.plane, ctx.sketches, ctx.construction)?.normal;
}

/** Where the bodies' mass is: the volume centroid of their meshes, volume weighted. */
function massCentre(bodies: ManipulatorContext['bodies']): Vec3 | undefined {
  let volume = 0;
  const sum: [number, number, number] = [0, 0, 0];
  for (const mesh of Object.values(bodies)) {
    const found = volumeCentroid(mesh);
    if (!found) continue;
    volume += found.volume;
    for (let k = 0; k < 3; k++) {
      sum[k] = (sum[k] as number) + (found.centroid[k] as number) * found.volume;
    }
  }
  if (volume <= 0) return undefined;
  return [(sum[0] as number) / volume, (sum[1] as number) / volume, (sum[2] as number) / volume];
}

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (v: Vec3, s: number): Vec3 => [v[0] * s, v[1] * s, v[2] * s];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (v: Vec3): Vec3 => {
  const length = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / length, v[1] / length, v[2] / length];
};
