/**
 * The dialog debug page's feature dialog (P2-05, ADR-0027): press-pull of
 * flat faces, computed by the kernel's `test-press` test feature (only the
 * debug page's kernel worker registers it). It uses every part of the
 * framework: a selection field, a dropdown, expression fields with a
 * distance arrow and an angle arc, a toggle that shows a field, custom
 * input mapping, and a preview style. Not in the app's registry.
 */
import { FeatureInputsSchema, type Vec3 } from '@extrudo/core';
import { faceFrame, meanFrame } from '../features/geometry';
import { cross } from '../features/manipulate';
import { defineFeatureDialog, type Manipulator } from '../features/spec';
import { defaultFromInputs, defaultInputs } from '../features/values';

const OPERATIONS = [
  { value: 'join', label: 'Join' },
  { value: 'cut', label: 'Cut' },
  { value: 'new', label: 'New body' },
  { value: 'intersect', label: 'Intersect' },
] as const;

export const pressDialog = defineFeatureDialog({
  type: 'test-press',
  label: 'Press Pull',
  category: 'create',
  icon: 'extrude',
  // The kernel's test feature checks its own inputs strictly.
  inputsSchema: FeatureInputsSchema,
  command: {
    id: 'debugPressPull',
    label: 'Press Pull (test)',
    icon: 'extrude',
    category: 'create',
    group: 'Debug',
    hint: 'Push or pull flat faces: the feature dialog framework on the debug page.',
  },
  fields: [
    {
      kind: 'selection',
      name: 'faces',
      label: 'Faces',
      accepts: ['face'],
      prompt: 'Pick a flat face',
    },
    {
      kind: 'choice',
      name: 'operation',
      label: 'Operation',
      options: OPERATIONS,
      default: 'join',
    },
    { kind: 'expression', name: 'distance', label: 'Distance', unit: 'length', default: '5 mm' },
    { kind: 'toggle', name: 'tilted', label: 'Tilt', default: false },
    {
      kind: 'expression',
      name: 'angle',
      label: 'Angle',
      unit: 'angle',
      default: '15 deg',
      shown: (values) => values.toggles.tilted === true,
    },
  ],
  // `tilted` only shows the angle; the feature has an angle or not.
  toInputs(values) {
    const { tilted: _, ...inputs } = defaultInputs(pressDialog, values);
    return inputs;
  },
  fromInputs(inputs) {
    const values = defaultFromInputs(pressDialog, inputs);
    return { ...values, toggles: { tilted: inputs.angle !== undefined } };
  },
  manipulators(values, ctx) {
    const frame = meanFrame((values.refs.faces ?? []).map((ref) => faceFrame(ctx.bodies, ref)));
    if (!frame) return [];
    const n = frame.normal;
    const a = tiltAxis(n);
    const tilted = values.toggles.tilted === true;
    const t = ((tilted ? (ctx.value('angle') ?? 0) : 0) * Math.PI) / 180;
    const [c, s] = [Math.cos(t), Math.sin(t)];
    const direction: Vec3 = [c * n[0] + s * a[0], c * n[1] + s * a[1], c * n[2] + s * a[2]];
    const out: Manipulator[] = [
      { kind: 'distance', field: 'distance', origin: frame.origin, direction },
    ];
    if (tilted) {
      out.push({ kind: 'angle', field: 'angle', origin: frame.origin, axis: cross(n, a), zero: n });
    }
    return out;
  },
  previewStyle: (values) => (values.choices.operation as 'join') ?? 'join',
});

/** The in-plane direction `test-press` tilts towards (the kernel's `tiltAxis`). */
function tiltAxis(n: Vec3): Vec3 {
  const other: Vec3 = Math.abs(n[2]) > 0.9 ? [1, 0, 0] : [0, 0, 1];
  const c = cross(n, other);
  const length = Math.hypot(...c);
  return [c[0] / length, c[1] / length, c[2] / length];
}
