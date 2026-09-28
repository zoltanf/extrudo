/**
 * The web app's feature registry (architecture §4.2): one dialog spec per
 * feature type, keyed like core's and the kernel's registries. Adding a
 * feature's dialog means registering its spec here; its command then runs
 * the dialog (`shell/commands.tsx`, the toolbar) and its timeline chip and
 * browser row open it for editing.
 */
import { FeatureRegistry } from '@extrudo/core';
import { extrudeDialog } from './extrude';
import { revolveDialog } from './revolve';
import { commandId, type FeatureDialogSpec } from './spec';

export type FeatureDialogs = FeatureRegistry<FeatureDialogSpec>;

export function featureDialogs(): FeatureDialogs {
  return new FeatureRegistry<FeatureDialogSpec>().register(extrudeDialog).register(revolveDialog);
}

/** The spec whose command is `id`, if any. */
export function specForCommand(dialogs: FeatureDialogs, id: string): FeatureDialogSpec | undefined {
  return dialogs.list().find((spec) => commandId(spec) === id);
}
