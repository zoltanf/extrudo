/**
 * The Remove dialog (P3-17, ADR-0030 amendment): which bodies a Remove feature takes out of the
 * model. Delete on bodies makes the feature at once (`BodyActions.remove`); its chip and row
 * open this dialog to change the bodies, and Fix References offers it for a lost one. The
 * command of its own ("Remove Bodies") also makes one from picked or pre-selected bodies. The
 * live preview is the model without them.
 */
import { removeBodiesFeature } from '@extrudo/core';
import { defineFeatureDialog } from './spec';

export const REMOVE_BODIES_COMMAND = 'removeBodies';

export const removeDialog = defineFeatureDialog({
  ...removeBodiesFeature,
  command: {
    id: REMOVE_BODIES_COMMAND,
    label: 'Remove Bodies',
    icon: 'remove',
    category: 'modify',
    group: 'Solid › Modify',
    hint: 'Takes bodies out of the model from here on, as a step in the timeline.',
  },
  fields: [
    {
      kind: 'selection',
      name: 'bodies',
      label: 'Bodies',
      accepts: ['body'],
      prompt: 'Pick bodies to remove',
      hint: 'They leave the model at this step; rolling back before it brings them back.',
    },
  ],
});
