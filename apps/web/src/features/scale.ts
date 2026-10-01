/**
 * The Scale dialog (P3-08, FR-FT-12): bodies, the point that stays where
 * it is (a vertex or construction point; empty: the middle of the bodies'
 * box), uniform or per-axis factors, and a copy toggle. Fields are named
 * like the feature's inputs (`ScaleInputs`), so the framework's default
 * mapping turns them into inputs and back; the other mode's fields are
 * hidden and make no input.
 */
import { SCALE_AXES, SCALE_POINT_KINDS, type ScaleMode, scaleFeature } from '@extrudo/core';
import { type DialogValues, defineFeatureDialog } from './spec';

const MODES: readonly { value: ScaleMode; label: string }[] = [
  { value: 'uniform', label: 'Uniform' },
  { value: 'non-uniform', label: 'Non-uniform' },
];

const isMode = (mode: ScaleMode) => (v: DialogValues) => (v.choices.mode ?? 'uniform') === mode;

export const scaleDialog = defineFeatureDialog({
  ...scaleFeature,
  command: 'scale',
  fields: [
    {
      kind: 'selection',
      name: 'bodies',
      label: 'Bodies',
      accepts: ['body'],
      prompt: 'Pick bodies',
      hint: 'The bodies to scale.',
    },
    {
      kind: 'selection',
      name: 'point',
      label: 'Point',
      accepts: SCALE_POINT_KINDS,
      min: 0,
      max: 1,
      prompt: 'Box centre (or pick a point)',
      hint: "A vertex or construction point that stays where it is. Empty: the middle of the bodies' box.",
    },
    { kind: 'choice', name: 'mode', label: 'Scale type', options: MODES, default: 'uniform' },
    {
      kind: 'expression',
      name: 'factor',
      label: 'Scale factor',
      unit: 'unitless',
      default: '1',
      hint: '2 doubles every size, 0.5 halves it.',
      shown: isMode('uniform'),
    },
    ...SCALE_AXES.map((axis) => ({
      kind: 'expression' as const,
      name: axis,
      label: `${axis.toUpperCase()} factor`,
      unit: 'unitless' as const,
      default: '1',
      hint: `Along the world ${axis.toUpperCase()} axis. Curved faces scaled unevenly become free-form surfaces.`,
      shown: isMode('non-uniform'),
    })),
    {
      kind: 'toggle',
      name: 'copy',
      label: 'Create copy',
      default: false,
      hint: 'Keep the bodies as they are and add scaled copies.',
    },
  ],
  // Scaled bodies replace the originals (or join them as copies).
  previewStyle: () => 'new',
});
