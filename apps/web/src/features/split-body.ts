/**
 * The Split Body dialog (P3-08, FR-FT-12): bodies, the plane to cut them
 * along (an origin plane, a construction plane or a flat face, picked like
 * Create Sketch's plane; a face cuts along its whole plane, past its edges)
 * and which side to keep. Fields are named like the feature's inputs
 * (`SplitBodyInputs`), so the framework's default mapping turns them into
 * inputs and back.
 */
import { SPLIT_KEEP, SPLIT_TOOL_KINDS, type SplitKeep, splitBodyFeature } from '@extrudo/core';
import { defineFeatureDialog } from './spec';

const KEEP_LABELS: Record<SplitKeep, string> = {
  both: 'Both sides',
  above: 'Above the plane',
  below: 'Below the plane',
};

export const splitBodyDialog = defineFeatureDialog({
  ...splitBodyFeature,
  command: 'splitBody',
  fields: [
    {
      kind: 'selection',
      name: 'bodies',
      label: 'Bodies',
      accepts: ['body'],
      prompt: 'Pick bodies',
      hint: 'The bodies to cut. Each side becomes a body of its own.',
    },
    {
      kind: 'selection',
      name: 'plane',
      label: 'Plane',
      accepts: SPLIT_TOOL_KINDS,
      max: 1,
      prompt: 'Pick a plane or flat face',
      hint: 'An origin plane, a construction plane or a flat face. A face cuts along its whole plane, past its edges.',
    },
    {
      kind: 'choice',
      name: 'keep',
      label: 'Keep',
      options: SPLIT_KEEP.map((value) => ({ value, label: KEEP_LABELS[value] })),
      default: 'both',
      hint: "Above is the side the plane's normal points to: +Z for the XY plane, outside the body for a face.",
    },
  ],
  // The pieces replace the bodies they came from: drawn as bodies.
  previewStyle: () => 'new',
});
