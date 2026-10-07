/**
 * The sweep dialog (P4-01, ADR-0055, FR-FT-14): profiles or flat faces, a
 * path of sketch curves or edges (picked in any order; edges bring their
 * tangent chain), how the profile turns (follows the path or stays fixed),
 * a twist and an end scale; new body, join, cut or intersect with automatic
 * or picked bodies. Fields are named like the feature's inputs
 * (`SweepInputs`), so the framework's default mapping turns them into
 * inputs and back; the twist hides (and makes no input) while the profile
 * stays fixed.
 *
 * Faces of a body propose **join**, profiles a new body, until the user
 * picks an operation (`proposeSweep`, the rule extrude and revolve share).
 *
 * The read-only "Placement" line says where the profile sits against the
 * path's start (P4-12, ADR-0067 §H5's follow-up), from the preview's
 * `SweepReport` — before OK, where the warning only comes after it.
 */
import {
  type BodyOperation,
  formatQuantity,
  LENGTH,
  type Settings,
  SWEEP_PATH_KINDS,
  SWEEP_PROFILE_KINDS,
  type SweepReport,
  sweepFeature,
} from '@extrudo/core';
import type { PreviewToolStyle } from '@extrudo/kernel';
import { proposeSweep } from './operation';
import { type DialogField, type DialogValues, defineFeatureDialog } from './spec';

export const OPERATIONS = [
  { value: 'new-body', label: 'New body' },
  { value: 'join', label: 'Join' },
  { value: 'cut', label: 'Cut' },
  { value: 'intersect', label: 'Intersect' },
] as const;

export const PREVIEW_STYLE: Record<BodyOperation, PreviewToolStyle> = {
  'new-body': 'new',
  join: 'join',
  cut: 'cut',
  intersect: 'intersect',
};

const ORIENTATIONS = [
  { value: 'follow', label: 'Follow the path' },
  { value: 'fixed', label: 'Keep fixed' },
] as const;

/** The operation and bodies fields every solid feature of P4-01 ends with. */
export function operationFields(noun: string): DialogField[] {
  return [
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
      hint: `The bodies to join, cut or intersect. Empty: every body the ${noun} reaches.`,
      shown: (v) => (v.choices.operation ?? 'new-body') !== 'new-body',
    },
  ];
}

export const previewStyleOf = (values: DialogValues): PreviewToolStyle =>
  PREVIEW_STYLE[(values.choices.operation ?? 'new-body') as BodyOperation] ?? 'new';

/**
 * The placement line's text (P4-12, ADR-0067 §H5's follow-up), from the
 * preview's `SweepReport`: on the path, or how far off it the section will
 * be swept. The distance is one decimal in the document's unit.
 */
export function sweepPlacementText(report: SweepReport, settings: Settings): string {
  if (report.offset <= report.limit) return "Profile on the path's start.";
  const d = formatQuantity(report.offset, LENGTH, { ...settings, precision: 1 });
  return `Profile ${d} from the path's start: the sweep carries it where it is drawn.`;
}

export const sweepDialog = defineFeatureDialog({
  ...sweepFeature,
  command: 'sweep',
  fields: [
    {
      kind: 'selection',
      name: 'profiles',
      label: 'Profiles',
      accepts: SWEEP_PROFILE_KINDS,
      prompt: 'Pick profiles or flat faces',
      hint: 'Sketch profiles or flat faces of bodies, all in one plane. They need not touch the path.',
    },
    {
      kind: 'selection',
      name: 'path',
      label: 'Path',
      accepts: SWEEP_PATH_KINDS,
      prompt: 'Pick the path',
      tangentChain: true,
      hint: 'Sketch curves or edges that join end to end. The profile travels from the end nearer to it.',
    },
    {
      kind: 'info',
      name: 'placement',
      label: 'Placement',
      shown: (_values, ctx) => ctx?.draftSweep !== undefined,
      text: (_values, ctx) =>
        ctx.draftSweep ? sweepPlacementText(ctx.draftSweep, ctx.doc.settings) : '',
    },
    {
      kind: 'choice',
      name: 'orientation',
      label: 'Orientation',
      options: ORIENTATIONS,
      default: 'follow',
      hint: 'Follow: the profile turns with the path. Fixed: it stays parallel to where it starts.',
    },
    {
      kind: 'expression',
      name: 'twist',
      label: 'Twist',
      unit: 'angle',
      default: '0 deg',
      hint: 'Turns the profile about the path from start to end. Needs a smooth path.',
      shown: (v) => (v.choices.orientation ?? 'follow') === 'follow',
    },
    {
      kind: 'expression',
      name: 'scale',
      label: 'End scale',
      unit: 'unitless',
      default: '1',
      hint: 'The profile’s size at the end, as a factor: 0.5 halves it on the way.',
    },
    ...operationFields('sweep'),
  ],
  propose(values, ctx) {
    const operation = proposeSweep(values.refs.profiles ?? [], 'both', ctx.doc);
    return operation ? { choices: { operation } } : undefined;
  },
  previewStyle: previewStyleOf,
});
