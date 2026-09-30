/**
 * The web app's feature registry (architecture §4.2): one dialog spec per
 * feature type, keyed like core's and the kernel's registries. Adding a
 * feature's dialog means registering its spec here; its command then runs
 * the dialog (`shell/commands.tsx`, the toolbar) and its timeline chip and
 * browser row open it for editing.
 */
import { FeatureRegistry } from '@extrudo/core';
import { chamferDialog } from './chamfer';
import { combineDialog } from './combine';
import { CONSTRUCTION_DIALOGS } from './construction';
import { extrudeDialog } from './extrude';
import { filletDialog } from './fillet';
import { mirrorDialog } from './mirror';
import { moveDialog } from './move';
import { PRIMITIVE_DIALOGS } from './primitives';
import { revolveDialog } from './revolve';
import { commandId, type FeatureDialogSpec } from './spec';

export type FeatureDialogs = FeatureRegistry<FeatureDialogSpec>;

export function featureDialogs(): FeatureDialogs {
  const dialogs = new FeatureRegistry<FeatureDialogSpec>()
    .register(extrudeDialog)
    .register(revolveDialog)
    .register(filletDialog)
    .register(chamferDialog);
  // Box, cylinder, sphere and torus (P2-10, ADR-0032).
  for (const spec of PRIMITIVE_DIALOGS) dialogs.register(spec);
  // Construction planes, axes and points (P3-05, ADR-0040).
  for (const spec of CONSTRUCTION_DIALOGS) dialogs.register(spec);
  // Combine, Move/Copy and Mirror (P3-06, ADR-0044).
  dialogs.register(combineDialog).register(moveDialog).register(mirrorDialog);
  return dialogs;
}

/** The spec whose command is `id`, if any. */
export function specForCommand(dialogs: FeatureDialogs, id: string): FeatureDialogSpec | undefined {
  return dialogs.list().find((spec) => commandId(spec) === id);
}
