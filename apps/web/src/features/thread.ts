/**
 * The thread dialog (P4-02, ADR-0056, FR-FT-15): the round faces to thread
 * (a shaft's for an external thread, a hole's wall for an internal one: the
 * kernel tells which), the size, how much of the face, the hand, the print
 * tolerance, the starts and the lead-in chamfer.
 *
 * Fields are named like the feature's inputs, so the framework's default
 * mapping turns them into inputs and back; **Size is the one field that
 * isn't an input**: "Fit the face" stores no diameter and pitch (the kernel
 * picks the ISO coarse thread that fits each face), a preset fills Diameter
 * and Pitch (`onChange`), and the dropdown always shows the preset the two
 * match, else Custom, as the hole's Preset does.
 *
 * A new thread's Tolerance is the document parameter `tolerance` when there
 * is one (FR-3DP-05's parameter; P4-08 adds the helper that makes it), else
 * 0.1 mm: `propose` sets it until the user types their own.
 */
import {
  type FeatureDefinition,
  type GeomRef,
  THREAD_EXTENTS,
  THREAD_FACE_KINDS,
  THREAD_HANDS,
  THREAD_LOAD_FLANKS,
  THREAD_NUMBERS,
  THREAD_PRESETS,
  THREAD_PROFILES,
  type ThreadExtent,
  type ThreadHand,
  type ThreadLoadFlank,
  type ThreadProfileName,
  TOLERANCE_PARAMETER,
  threadFeature,
  threadPreset,
} from '@extrudo/core';
import { isFlatFace } from '../sketch/facePick';
import {
  type DialogContext,
  type DialogField,
  type DialogValues,
  defineFeatureDialog,
  type FeatureDialogSpec,
  type ProposeContext,
} from './spec';
import { defaultFromInputs, defaultInputs } from './values';

/** The Size dropdown's value for "no size: fit the face". */
export const AUTO = 'auto';
const CUSTOM = 'custom';

const EXTENT_LABELS: Record<ThreadExtent, string> = { full: 'Whole face', length: 'Length' };
const HAND_LABELS: Record<ThreadHand, string> = { right: 'Right-handed', left: 'Left-handed' };
const LOAD_FLANK_LABELS: Record<ThreadLoadFlank, string> = {
  start: 'Steep flank at the start',
  end: 'Steep flank at the end',
};
const GROUP_LABELS: Record<string, string> = {
  metric: 'ISO metric',
  'metric-fine': 'ISO metric fine',
  unc: 'UNC',
  unf: 'UNF',
  trapezoidal: 'Trapezoidal',
  bottle: 'Bottle',
};

const size = (v: DialogValues) => v.choices.preset ?? AUTO;
const extent = (v: DialogValues): ThreadExtent => (v.choices.extent ?? 'full') as ThreadExtent;
const profile = (v: DialogValues): ThreadProfileName =>
  (v.choices.profile ?? 'iso') as ThreadProfileName;

const HINTS: Record<string, string> = {
  diameter: 'The nominal (major) diameter: 8 mm for M8.',
  pitch: 'From one crest to the next along the axis.',
  length: 'How long the thread is, from where it starts.',
  offset: 'How far from the face’s end the thread starts.',
  profile:
    'The tooth shape: ISO metric (60°, the default), Trapezoidal (Tr), Buttress (DIN 513) or Bottle (the PCO-1881 soft-drink finish).',
  loadFlank: 'Buttress only: which end of the thread the steep 3° load flank faces.',
  tolerance:
    'Clearance for printing: the whole thread moves this far into the part (a shaft’s thread gets thinner, a hole’s wider). 0.1 mm on both parts leaves 0.4 mm between their diameters.',
};

function shownFor(name: string): ((v: DialogValues) => boolean) | undefined {
  switch (name) {
    case 'diameter':
    case 'pitch':
      return (v) => size(v) !== AUTO;
    case 'length':
      return (v) => extent(v) === 'length';
    default:
      return undefined;
  }
}

function numberField(name: string): DialogField {
  const number = THREAD_NUMBERS.find((n) => n.name === name);
  if (!number) throw new Error(`A thread has no number "${name}".`);
  const shown = shownFor(name);
  const hint = HINTS[name];
  return {
    kind: 'expression',
    name,
    label: number.label,
    unit: 'length',
    default: number.default,
    ...(shown && { shown }),
    ...(hint && { hint }),
  };
}

// ------------------------------------------------------------------ presets

/** The preset the Diameter, Pitch and Profile match exactly (as typed), else `custom`. */
export function presetOf(values: DialogValues): string {
  const match = THREAD_PRESETS.find(
    (p) =>
      p.profile === profile(values) &&
      values.exprs.diameter === p.exprs.diameter &&
      values.exprs.pitch === p.exprs.pitch,
  );
  return match?.id ?? CUSTOM;
}

/**
 * What changing `field` does to the rest: a preset fills Diameter, Pitch and
 * Profile; editing a number leaves Size showing the preset they now match; a
 * profile change re-checks Size (and leaves Fit the face only for ISO).
 */
export function threadOnChange(
  field: string,
  values: DialogValues,
): Partial<DialogValues> | undefined {
  if (field === 'preset') {
    const preset = threadPreset(size(values));
    return preset
      ? { exprs: preset.exprs, choices: { preset: preset.id, profile: preset.profile } }
      : undefined;
  }
  if ((field === 'diameter' || field === 'pitch') && size(values) !== AUTO) {
    const now = presetOf(values);
    return now === size(values) ? undefined : { choices: { preset: now } };
  }
  if (field === 'profile') {
    if (size(values) === AUTO) {
      return profile(values) === 'iso' ? undefined : { choices: { preset: CUSTOM } };
    }
    const now = presetOf(values);
    return now === size(values) ? undefined : { choices: { preset: now } };
  }
  return undefined;
}

/** A new thread's tolerance refers to the document's `tolerance` parameter when there is one. */
export function proposeThread(
  values: DialogValues,
  ctx: Pick<ProposeContext, 'doc'>,
): Partial<DialogValues> | undefined {
  const parameter = ctx.doc.parameters.find(
    (p) => p.name === TOLERANCE_PARAMETER && p.unit === 'length',
  );
  if (!parameter || values.exprs.tolerance === TOLERANCE_PARAMETER) return undefined;
  return { exprs: { tolerance: TOLERANCE_PARAMETER } };
}

/** Whether a picked face is one the view's meshes show as flat (the kernel checks the rest). */
function isFlat(ref: GeomRef, ctx: Pick<DialogContext, 'bodies'>): boolean {
  for (const mesh of Object.values(ctx.bodies)) {
    const face = mesh.faceIds?.indexOf(ref.id) ?? -1;
    if (face >= 0) return isFlatFace(mesh, face);
  }
  return false;
}

// -------------------------------------------------------------------- dialog

export const threadDialog: FeatureDialogSpec = defineFeatureDialog({
  ...(threadFeature as FeatureDefinition),
  command: 'thread',
  fields: [
    {
      kind: 'selection',
      name: 'faces',
      label: 'Faces',
      accepts: THREAD_FACE_KINDS,
      prompt: 'Pick round faces',
      hint: 'The round face of a shaft (an external thread) or of a hole (an internal one). One thread on each.',
    },
    {
      kind: 'choice',
      name: 'preset',
      label: 'Size',
      options: [
        { value: AUTO, label: 'Fit the face (ISO metric)' },
        ...THREAD_PRESETS.map((p) => ({
          value: p.id,
          label: p.group === 'metric' ? p.label : `${p.label} (${GROUP_LABELS[p.group]})`,
        })),
        { value: CUSTOM, label: 'Custom' },
      ],
      default: AUTO,
      hint: 'A standard thread fills Diameter and Pitch. Fit the face picks the ISO metric coarse thread for the shaft or the tap-drill hole.',
    },
    {
      kind: 'choice',
      name: 'profile',
      label: 'Profile',
      options: THREAD_PROFILES.map((p) => ({ value: p.value, label: p.label })),
      default: 'iso',
      hint: HINTS.profile,
    },
    {
      kind: 'choice',
      name: 'loadFlank',
      label: 'Load flank',
      options: THREAD_LOAD_FLANKS.map((value) => ({ value, label: LOAD_FLANK_LABELS[value] })),
      default: 'end',
      shown: (v) => profile(v) === 'buttress',
      hint: HINTS.loadFlank,
    },
    numberField('diameter'),
    numberField('pitch'),
    {
      kind: 'choice',
      name: 'extent',
      label: 'Extent',
      options: THREAD_EXTENTS.map((value) => ({ value, label: EXTENT_LABELS[value] })),
      default: 'full',
    },
    numberField('length'),
    numberField('offset'),
    {
      kind: 'toggle',
      name: 'flip',
      label: 'From the other end',
      default: false,
      hint: 'Measure the offset and length from the face’s other end.',
    },
    {
      kind: 'choice',
      name: 'hand',
      label: 'Hand',
      options: THREAD_HANDS.map((value) => ({ value, label: HAND_LABELS[value] })),
      default: 'right',
    },
    {
      kind: 'expression',
      name: 'starts',
      label: 'Starts',
      unit: 'unitless',
      default: '1',
      hint: 'How many helices start round the face, 1 to 8. The lead is starts × pitch, so a 2-start thread advances twice as far a turn.',
    },
    numberField('tolerance'),
    {
      kind: 'toggle',
      name: 'chamfer',
      label: 'Lead-in chamfer',
      default: true,
      hint: 'A 45° lead-in where the thread runs out of a shaft’s end or a hole’s mouth, so it starts cleanly and screws in.',
    },
  ],
  // Size isn't an input: the stored inputs are the plain diameter and pitch, or neither.
  toInputs(values) {
    const { preset: _preset, ...inputs } = defaultInputs(threadDialog, values);
    // One start is the default and is never stored.
    const starts = inputs.starts;
    if (starts?.kind === 'expr' && (starts.expr.trim() === '' || Number(starts.expr) === 1)) {
      delete inputs.starts;
    }
    return inputs;
  },
  fromInputs(inputs) {
    const stored = defaultFromInputs(threadDialog, inputs);
    const sized = 'diameter' in inputs || 'pitch' in inputs;
    const exprs = stored.exprs ?? {};
    const choices = stored.choices ?? {};
    const preset = sized ? presetOf({ refs: {}, exprs, choices, toggles: {}, labels: {} }) : AUTO;
    return { ...stored, choices: { ...choices, preset } };
  },
  validate(values, ctx) {
    if ((values.refs.faces ?? []).some((ref) => isFlat(ref, ctx))) {
      return { field: 'faces', message: 'Pick round faces: a shaft’s side or a hole’s wall.' };
    }
    return undefined;
  },
  propose: (values, ctx) => proposeThread(values, ctx),
  onChange: threadOnChange,
  previewStyle: () => 'cut',
});
