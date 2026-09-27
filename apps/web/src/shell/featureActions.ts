/**
 * What the timeline and the browser do to a feature (P1-12, FR-TL-03): edit
 * a sketch, rename, show or hide, suppress, delete, hover. Plain functions
 * over the stores, like `sketch/mode.ts`, so both panels and the tests share
 * them. Every change is a command, so it is one undo step.
 *
 * While a sketch is open, its undo transaction is running: renaming and
 * visibility are harmless inside it, but suppressing or deleting a feature
 * could remove the sketch being edited or roll the model under it, so they
 * wait until the sketch is finished (like the timeline marker).
 */
import {
  type Command,
  CommandError,
  type FeatureId,
  isFeatureVisible,
  readSketch,
  removeFeature,
  renameFeature,
  setFeatureSuppressed,
  setFeatureVisibility,
} from '@extrudo/core';
import { editSketch, type SketchModeStores } from '../sketch/mode';

export interface FeatureActions {
  /** Opens a sketch. Returns `false` if the feature isn't an editable sketch. */
  edit(id: FeatureId): boolean;
  /** Renames a feature. Returns `false`, and says why, if the name is refused (empty). */
  rename(id: FeatureId, name: string): boolean;
  /** Shows or hides features (a browser eye or a folder's eye). */
  setVisible(ids: readonly FeatureId[], visible: boolean): void;
  toggleSuppressed(id: FeatureId): void;
  remove(id: FeatureId): void;
  /** Highlights a feature's geometry while the pointer is on its chip or row. */
  hover(id: FeatureId | undefined): void;
  /** Why suppress and delete are unavailable right now, or `undefined` if they aren't. */
  locked(): string | undefined;
}

export function createFeatureActions(
  stores: SketchModeStores,
  notify: (tone: 'info' | 'error', text: string) => void,
): FeatureActions {
  const { store, session } = stores;
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
  const feature = (id: FeatureId) => store.getState().doc.features.find((f) => f.id === id);
  const locked = () =>
    session.getState().mode === 'sketch' ? 'Finish the sketch first.' : undefined;
  const clearHover = (id: FeatureId) => {
    const hover = session.getState().hover;
    if (hover?.kind === 'feature' && hover.id === id) session.getState().setHover(undefined);
  };

  return {
    edit: (id) => editSketch(stores, id),
    rename(id, name) {
      const current = feature(id);
      if (!current) return false;
      if (name.trim() === current.name) return true;
      return run(renameFeature({ id, name }));
    },
    setVisible(ids, visible) {
      const changed = ids.filter((id) => {
        const f = feature(id);
        return f && isFeatureVisible(f) !== visible;
      });
      if (changed.length > 0) run(setFeatureVisibility({ ids: changed, visible }));
    },
    toggleSuppressed(id) {
      const f = feature(id);
      const why = locked();
      if (!f) return;
      if (why) return notify('info', why);
      run(setFeatureSuppressed({ id, suppressed: !f.suppressed }));
    },
    remove(id) {
      const why = locked();
      if (why) return notify('info', why);
      if (run(removeFeature({ id }))) clearHover(id);
    },
    hover(id) {
      if (id) session.getState().setHover({ kind: 'feature', id });
      else if (session.getState().hover?.kind === 'feature') session.getState().setHover(undefined);
    },
    locked,
  };
}

/** Whether a feature can be opened for editing from the timeline or the browser. */
export function isEditableSketch(
  feature: Parameters<typeof readSketch>[0],
  index: number,
  marker: number,
): boolean {
  return index < marker && readSketch(feature) !== undefined;
}
