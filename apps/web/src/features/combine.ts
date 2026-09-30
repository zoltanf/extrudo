/**
 * The Combine dialog (P3-06, ADR-0044, FR-FT-09): a target body, the tool
 * bodies, join / cut / intersect and "keep tools". Fields are named like
 * the feature's inputs (`CombineInputs`), so the framework's default mapping
 * turns them into inputs and back. Bodies selected before the tool fill the
 * fields in order: the first becomes the target, the rest the tools. The
 * live preview draws the tool bodies in the operation's style (join and
 * intersect translucent, cut red) over the model.
 */
import { type CombineOperation, combineFeature } from '@extrudo/core';
import type { PreviewToolStyle } from '@extrudo/kernel';
import { defineFeatureDialog } from './spec';

const OPERATIONS = [
  { value: 'join', label: 'Join' },
  { value: 'cut', label: 'Cut' },
  { value: 'intersect', label: 'Intersect' },
] as const satisfies readonly { value: CombineOperation; label: string }[];

const PREVIEW_STYLE: Record<CombineOperation, PreviewToolStyle> = {
  join: 'join',
  cut: 'cut',
  intersect: 'intersect',
};

export const combineDialog = defineFeatureDialog({
  ...combineFeature,
  command: 'combine',
  fields: [
    {
      kind: 'selection',
      name: 'target',
      label: 'Target',
      accepts: ['body'],
      max: 1,
      prompt: 'Pick the target body',
      hint: 'The body that stays. The result keeps its name and colour.',
    },
    {
      kind: 'selection',
      name: 'tools',
      label: 'Tools',
      accepts: ['body'],
      prompt: 'Pick tool bodies',
      hint: 'The bodies combined into the target. They are used up unless you keep them.',
    },
    {
      kind: 'choice',
      name: 'operation',
      label: 'Operation',
      options: OPERATIONS,
      default: 'join',
    },
    {
      kind: 'toggle',
      name: 'keepTools',
      label: 'Keep tools',
      default: false,
      hint: 'Leave the tool bodies in the model after combining.',
    },
  ],
  validate(values) {
    const target = values.refs.target?.[0];
    if (target && (values.refs.tools ?? []).some((tool) => tool.id === target.id)) {
      return { field: 'tools', message: "The target can't be one of its own tools." };
    }
    return undefined;
  },
  previewStyle: (values) =>
    PREVIEW_STYLE[(values.choices.operation ?? 'join') as CombineOperation] ?? 'join',
});
