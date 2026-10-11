/**
 * What the browser and the commands do to joints (P6-05, ADR-0081 §4, §6): open the Joint
 * dialog (new, edit, Fix References), rename, suppress, delete, keep the kernel's closest match.
 * Each write is one command, so one undo step; a refused one says why through `notify`.
 */
import {
  type Command,
  CommandError,
  type DocumentStore,
  type JointId,
  type ModelStore,
  type ReferenceIssue,
  removeJoint,
  renameJoint,
  replaceReferences,
  setJointSuppressed,
} from '@extrudo/core';
import type { JointDialog } from './jointController';

export interface JointActions {
  /** Opens the Joint dialog for a new joint (pre-selection fills it). */
  start(): void;
  /** Opens a joint in the dialog; with `fix`, for Fix References. */
  edit(id: JointId, options?: { fix?: readonly ReferenceIssue[] }): void;
  /** `false` (and a message) if the name is refused. */
  rename(id: JointId, name: string): boolean;
  setSuppressed(ids: readonly JointId[], suppressed: boolean): void;
  remove(ids: readonly JointId[]): void;
  /** Opens the Joint panel to pose a joint (P6-05 J2); absent where there is no view. */
  pose?(id: JointId): void;
  /** Stores what the kernel guessed for each guessed frame, so it resolves exactly again. */
  keepClosestMatch(id: JointId): void;
}

export function createJointActions(
  stores: {
    store: DocumentStore;
    model: ModelStore<unknown>;
    dialog: JointDialog;
    pose?: (id: JointId) => void;
  },
  notify: (tone: 'info' | 'error', text: string) => void,
): JointActions {
  const { store, model, dialog, pose } = stores;
  const run = (command: Command<unknown>): boolean => {
    try {
      store.getState().dispatch(command);
      return true;
    } catch (error) {
      if (!(error instanceof CommandError)) throw error;
      notify('error', error.message);
      return false;
    }
  };
  const jointOf = (id: JointId) => store.getState().doc.joints?.find((j) => j.id === id);
  return {
    start() {
      const components = store.getState().doc.components ?? [];
      if (components.length < 2) {
        notify('info', 'Make two components first.');
        return;
      }
      dialog.start();
    },
    edit(id, options) {
      dialog.edit(id, options);
    },
    ...(pose && { pose }),
    rename(id, name) {
      const joint = jointOf(id);
      if (!joint) return false;
      if (name.trim() === joint.name) return true;
      return run(renameJoint({ id, name }));
    },
    setSuppressed(ids, suppressed) {
      if (ids.length > 0) run(setJointSuppressed({ ids, suppressed }));
    },
    remove(ids) {
      const known = ids.filter((id) => jointOf(id));
      if (known.length > 0) run(removeJoint({ ids: known }));
    },
    keepClosestMatch(id) {
      const refs = model.getState().joints[id]?.refs ?? [];
      const replace = refs.flatMap((issue) =>
        issue.state === 'guessed' && issue.now ? [{ from: issue.ref, to: issue.now }] : [],
      );
      if (replace.length > 0) run(replaceReferences({ id, replace }));
    },
  };
}
