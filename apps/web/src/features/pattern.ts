/**
 * The pattern dialogs (P3-07, ADR-0047, FR-FT-11): rectangular, circular and
 * on-path patterns of bodies or of features. Fields are named like the
 * features' inputs (`RectangularPatternInputs` …), so the framework's
 * default mapping turns them into inputs and back; fields that don't apply
 * (a second direction that isn't picked, the bodies of a features pattern)
 * are hidden and make no input.
 *
 * - **Pattern** (`objects`): `Bodies` copies the picked bodies (new bodies,
 *   or Join: fused into the original); `Features` ticks features before the
 *   pattern (extrudes, revolves and primitives that join or cut) whose tool
 *   is repeated and applied to the bodies it touches.
 * - Counts and distances are expression fields; the count includes the
 *   original. The distance is between neighbours or the whole distance from
 *   first to last (`measure`).
 * - The in-view handles: a distance arrow per direction (from the middle of
 *   the picked bodies, or of all bodies), and for circular an angle ring
 *   about the axis. The ghosts are the evaluator's preview tools.
 */
import {
  circularPatternFeature,
  PATTERN_DIRECTION_KINDS,
  PATTERN_PATH_KINDS,
  PATTERNABLE_FEATURE_TYPES,
  pathPatternFeature,
  rectangularPatternFeature,
  type Vec3,
} from '@extrudo/core';
import { boundsOf } from '../viewport/bodyGeometry';
import { axisLine } from './geometry';
import { cross } from './manipulate';
import { pivotOf } from './move';
import {
  type DialogContext,
  type DialogField,
  type DialogValues,
  defineFeatureDialog,
  type Manipulator,
  type ManipulatorContext,
} from './spec';

const OBJECTS = [
  { value: 'bodies', label: 'Bodies' },
  { value: 'features', label: 'Features' },
] as const;

const MEASURES = [
  { value: 'spacing', label: 'Between instances' },
  { value: 'extent', label: 'First to last' },
] as const;

const ANGLES = [
  { value: 'total', label: 'Whole angle' },
  { value: 'step', label: 'Between instances' },
] as const;

const forObjects = (objects: 'bodies' | 'features') => (v: DialogValues) =>
  (v.choices.objects ?? 'bodies') === objects;

/** What every pattern repeats: bodies to copy, or features to replay. */
const objectFields = (): DialogField[] => [
  {
    kind: 'choice',
    name: 'objects',
    label: 'Pattern',
    options: OBJECTS,
    default: 'bodies',
    hint: 'Copy whole bodies, or repeat features (a hole, a boss) on the body they changed.',
  },
  {
    kind: 'selection',
    name: 'bodies',
    label: 'Bodies',
    accepts: ['body'],
    prompt: 'Pick bodies',
    hint: 'The bodies to copy.',
    shown: forObjects('bodies'),
  },
  {
    kind: 'features',
    name: 'features',
    label: 'Features',
    types: PATTERNABLE_FEATURE_TYPES,
    hint: 'Extrudes, revolves and primitives that join or cut: their tool is repeated at every instance.',
    shown: forObjects('features'),
  },
];

const joinField = (): DialogField => ({
  kind: 'toggle',
  name: 'join',
  label: 'Join',
  default: false,
  hint: 'Fuse the copies into the original body instead of making new bodies.',
  shown: forObjects('bodies'),
});

const countField = (name: string, label: string, value: string, shown?: DialogField['shown']) =>
  ({
    kind: 'expression',
    name,
    label,
    unit: 'unitless',
    default: value,
    hint: 'How many instances, the original included.',
    ...(shown && { shown }),
  }) as const;

const lengthField = (name: string, label: string, hint: string, shown?: DialogField['shown']) =>
  ({
    kind: 'expression',
    name,
    label,
    unit: 'length',
    default: '20 mm',
    hint,
    ...(shown && { shown }),
  }) as const;

const hasRef = (field: string) => (v: DialogValues) => (v.refs[field]?.length ?? 0) > 0;

// ------------------------------------------------------------ manipulators

/** The middle of what is patterned: the picked bodies, else every body. */
function centreOf(values: DialogValues, ctx: DialogContext): Vec3 | undefined {
  const picked =
    (values.choices.objects ?? 'bodies') === 'bodies' ? pivotOf(values, ctx) : undefined;
  if (picked) return picked.centre;
  const box = boundsOf(Object.values(ctx.bodies))?.box;
  if (!box) return undefined;
  return [0, 1, 2].map((k) => ((box.min[k] ?? 0) + (box.max[k] ?? 0)) / 2) as unknown as Vec3;
}

const unit = (v: Vec3): Vec3 => {
  const length = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / length, v[1] / length, v[2] / length];
};

function rectangularManipulators(values: DialogValues, ctx: ManipulatorContext): Manipulator[] {
  const centre = centreOf(values, ctx);
  if (!centre) return [];
  const out: Manipulator[] = [];
  for (const n of ['1', '2'] as const) {
    const ref = values.refs[`direction${n}`]?.[0];
    const line = ref && axisLine(ref, ctx);
    if (!line) continue;
    out.push({
      kind: 'distance',
      field: `distance${n}`,
      origin: centre,
      direction: line.direction,
    });
  }
  return out;
}

function circularManipulators(values: DialogValues, ctx: ManipulatorContext): Manipulator[] {
  const centre = centreOf(values, ctx);
  const ref = values.refs.axis?.[0];
  const line = ref && axisLine(ref, ctx);
  if (!centre || !line) return [];
  const d = line.direction;
  const o = line.origin;
  const t = (centre[0] - o[0]) * d[0] + (centre[1] - o[1]) * d[1] + (centre[2] - o[2]) * d[2];
  const foot: Vec3 = [o[0] + t * d[0], o[1] + t * d[1], o[2] + t * d[2]];
  const out: Vec3 = [centre[0] - foot[0], centre[1] - foot[1], centre[2] - foot[2]];
  const zero =
    Math.hypot(...out) > 1e-9
      ? unit(out)
      : unit(cross(d, Math.abs(d[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]));
  return [{ kind: 'angle', field: 'angle', origin: foot, axis: d, zero, fullTurn: true }];
}

// ----------------------------------------------------------------- specs

export const rectangularPatternDialog = defineFeatureDialog({
  ...rectangularPatternFeature,
  command: 'rectangularPattern',
  fields: [
    ...objectFields(),
    {
      kind: 'selection',
      name: 'direction1',
      label: 'Direction',
      accepts: PATTERN_DIRECTION_KINDS,
      max: 1,
      prompt: 'Pick a direction',
      hint: 'An origin or construction axis, a straight edge or a sketch line.',
    },
    countField('count1', 'Count', '3'),
    lengthField(
      'distance1',
      'Distance',
      'Drag the arrow, or type. See "Measure" for what it spans.',
    ),
    {
      kind: 'choice',
      name: 'measure1',
      label: 'Measure',
      options: MEASURES,
      default: 'spacing',
      hint: 'Whether the distance is between neighbours or from the first instance to the last.',
    },
    {
      kind: 'toggle',
      name: 'symmetric1',
      label: 'Symmetric',
      default: false,
      hint: 'Put the original in the middle of the row instead of at its start.',
    },
    {
      kind: 'selection',
      name: 'direction2',
      label: 'Direction 2',
      accepts: PATTERN_DIRECTION_KINDS,
      min: 0,
      max: 1,
      prompt: 'Add a second direction',
      hint: 'Optional: a second direction makes a grid.',
    },
    countField('count2', 'Count 2', '2', hasRef('direction2')),
    lengthField(
      'distance2',
      'Distance 2',
      'Between neighbours in the second direction.',
      hasRef('direction2'),
    ),
    {
      kind: 'choice',
      name: 'measure2',
      label: 'Measure 2',
      options: MEASURES,
      default: 'spacing',
      shown: hasRef('direction2'),
    },
    {
      kind: 'toggle',
      name: 'symmetric2',
      label: 'Symmetric 2',
      default: false,
      shown: hasRef('direction2'),
    },
    joinField(),
  ],
  manipulators: rectangularManipulators,
  previewStyle: () => 'new',
});

export const circularPatternDialog = defineFeatureDialog({
  ...circularPatternFeature,
  command: 'circularPattern',
  fields: [
    ...objectFields(),
    {
      kind: 'selection',
      name: 'axis',
      label: 'Axis',
      accepts: PATTERN_DIRECTION_KINDS,
      max: 1,
      prompt: 'Pick an axis',
      hint: 'An origin or construction axis, a straight edge or a sketch line.',
    },
    countField('count', 'Count', '3'),
    {
      kind: 'expression',
      name: 'angle',
      label: 'Angle',
      unit: 'angle',
      default: '360 deg',
      hint: 'Right-handed about the axis. A whole turn is spread evenly. Drag the ring, or type.',
    },
    {
      kind: 'choice',
      name: 'measure',
      label: 'Measure',
      options: ANGLES,
      default: 'total',
      hint: 'Whether the angle is the whole spread or between neighbours.',
    },
    {
      kind: 'toggle',
      name: 'symmetric',
      label: 'Symmetric',
      default: false,
      hint: 'Put the original in the middle instead of at the start.',
    },
    joinField(),
  ],
  manipulators: circularManipulators,
  previewStyle: () => 'new',
});

export const pathPatternDialog = defineFeatureDialog({
  ...pathPatternFeature,
  command: 'pathPattern',
  fields: [
    ...objectFields(),
    {
      kind: 'selection',
      name: 'path',
      label: 'Path',
      accepts: PATTERN_PATH_KINDS,
      prompt: 'Pick the path',
      hint: 'Sketch curves or edges that meet end to end. The pattern starts where the path does.',
    },
    countField('count', 'Count', '3'),
    lengthField('distance', 'Distance', 'Along the path. See "Measure" for what it spans.'),
    {
      kind: 'choice',
      name: 'measure',
      label: 'Measure',
      options: MEASURES,
      default: 'spacing',
      hint: 'Whether the distance is between neighbours or from the first instance to the last.',
    },
    {
      kind: 'toggle',
      name: 'aligned',
      label: 'Follow path',
      default: false,
      hint: 'Turn each instance to the way the path runs; off keeps the original’s orientation.',
    },
    {
      kind: 'toggle',
      name: 'flip',
      label: 'Flip',
      default: false,
      hint: 'Walk the path from its other end.',
    },
    joinField(),
  ],
  previewStyle: () => 'new',
});

/** The three specs, by feature type. */
export const PATTERN_DIALOGS = [
  rectangularPatternDialog,
  circularPatternDialog,
  pathPatternDialog,
] as const;
