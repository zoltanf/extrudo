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
import { holeDialog } from './hole';
import { mirrorDialog } from './mirror';
import { moveDialog } from './move';
import { offsetFaceDialog } from './offset-face';
import { PATTERN_DIALOGS } from './pattern';
import { placeOnBedDialog } from './place-on-bed';
import { PRIMITIVE_DIALOGS } from './primitives';
import { revolveDialog } from './revolve';
import { shellDialog } from './shell';
import { commandId, type FeatureDialogSpec } from './spec';

export type FeatureDialogs = FeatureRegistry<FeatureDialogSpec>;

export function featureDialogs(): FeatureDialogs {
  const dialogs = new FeatureRegistry<FeatureDialogSpec>()
    .register(extrudeDialog)
    .register(revolveDialog)
    .register(filletDialog)
    .register(chamferDialog)
    .register(shellDialog);
  // Box, cylinder, sphere and torus (P2-10, ADR-0032).
  for (const spec of PRIMITIVE_DIALOGS) dialogs.register(spec);
  // Construction planes, axes and points (P3-05, ADR-0040).
  for (const spec of CONSTRUCTION_DIALOGS) dialogs.register(spec);
  // Combine, Move/Copy and Mirror (P3-06, ADR-0044).
  dialogs.register(combineDialog).register(moveDialog).register(mirrorDialog);
  // Place on Bed (P3-10, ADR-0048).
  dialogs.register(placeOnBedDialog);
  // Hole (P3-04, ADR-0049).
  dialogs.register(holeDialog);
  // Offset Face (P3-08, ADR-0051); Press/Pull opens it, Fillet or Extrude.
  dialogs.register(offsetFaceDialog);
  // Rectangular, circular and path patterns (P3-07, ADR-0047).
  for (const spec of PATTERN_DIALOGS) dialogs.register(spec);
  return dialogs;
}

/** The spec whose command is `id`, if any. */
export function specForCommand(dialogs: FeatureDialogs, id: string): FeatureDialogSpec | undefined {
  return dialogs.list().find((spec) => commandId(spec) === id);
}
