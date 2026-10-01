/**
 * What the timeline and the browser do to a feature (P1-12, FR-TL-03): edit
 * a sketch, rename, show or hide, suppress, delete, hover; and since P2-11
 * (ADR-0033) roll the marker to it, move it, and fix its references. Plain functions
 * over the stores, like `sketch/mode.ts`, so both panels and the tests share
 * them. Every change is a command, so it is one undo step.
 *
 * While a sketch is open, its undo transaction is running: renaming and
 * visibility are harmless inside it, but suppressing or deleting a feature
 * could remove the sketch being edited or roll the model under it, so they
 * wait until the sketch is finished (like the timeline marker, moving
 * features and fixing references).
 */
import {
  type Command,
  CommandError,
  type Feature,
  type FeatureId,
  isFeatureVisible,
  moveFeature,
  moveFeatures,
  moveFeaturesProblem,
  moveProblem,
  moveTimelineMarker,
  type ReferenceIssue,
  readSketch,
  removeFeature,
  renameFeature,
  replaceReferences,
  setFeatureSuppressed,
  setFeatureVisibility,
} from '@extrudo/core';
import { editSketch, type SketchModeStores } from '../sketch/mode';

export interface FeatureActions {
  /**
   * Opens a sketch, or another feature's dialog (P2-05). Returns `false` if
   * the feature can't be edited that way.
   */
  edit(id: FeatureId): boolean;
  /** Whether `edit` can open the feature at `index` (a timeline chip, a browser row). */
  canEdit(feature: Feature, index: number, marker: number): boolean;
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
  /** Opens the export dialog for a sketch (P1-13). */
  exportSketch(id: FeatureId): void;
  /** Rolls the model back (or forward) to `index` features (FR-TL-02), one undo step. */
  rollTo(index: number): void;
  /**
   * Moves a feature to `index` (its position afterwards; `active` decides at
   * the marker, see core's `moveFeature`), FR-TL-04. Several features move
   * together, in their order, the first to `index` (core's `moveFeatures`,
   * P3-17). Returns `false`, and says why, when it would break a reference.
   */
  move(id: FeatureId | readonly FeatureId[], index: number, active?: boolean): boolean;
  /** Why `move` would be refused, or `undefined` (drag feedback). */
  moveProblem(id: FeatureId | readonly FeatureId[], index: number): string | undefined;
  /**
   * References a feature lost or the kernel guessed in the last recompute
   * (FR-TL-05), from the model store's status.
   */
  issues(id: FeatureId): readonly ReferenceIssue[];
  /**
   * "Fix References…": a sketch whose plane is lost or guessed picks a new
   * one (Redefine Plane); a feature with a dialog opens it with the lost
   * references taken out; a sketch with lost projections opens.
   */
  fix(id: FeatureId): void;
  /** Stores the kernel's closest matches in place of guessed references, one undo step. */
  keepClosest(id: FeatureId): void;
  /** Picks another plane or flat face for a sketch (ADR-0031 open item). */
  redefinePlane(id: FeatureId): void;
}

export interface FeatureDialogActions {
  exportSketch(id: FeatureId): void;
  /** Opens a feature's dialog for editing (P2-05); `false` if its type has none. */
  editFeature?(id: FeatureId): boolean;
  /** Whether a feature type has a dialog. */
  hasDialog?(type: string): boolean;
  /**
   * Opens a feature's dialog to fix its references (P2-11): lost ones taken
   * out, guesses replaced by the kernel's match, the first such field
   * taking picks. `false` if its type has no dialog.
   */
  fixFeature?(id: FeatureId, issues: readonly ReferenceIssue[]): boolean;
  /** Starts picking a new plane or face for a sketch (P2-11). */
  redefinePlane?(id: FeatureId): void;
}

export function createFeatureActions(
  stores: SketchModeStores,
  notify: (tone: 'info' | 'error', text: string) => void,
  dialogs: FeatureDialogActions = { exportSketch: () => {} },
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
  const issues = (id: FeatureId): readonly ReferenceIssue[] =>
    stores.model?.getState().features[id]?.refs ?? [];
  const redefinePlane = (id: FeatureId) => {
    const why = locked();
    if (why) return notify('info', why);
    dialogs.redefinePlane?.(id);
  };
  const clearHover = (id: FeatureId) => {
    const hover = session.getState().hover;
    if (hover?.kind === 'feature' && hover.id === id) session.getState().setHover(undefined);
  };

  return {
    edit(id) {
      const f = feature(id);
      if (f && readSketch(f)) return editSketch(stores, id);
      if (!f || session.getState().mode === 'sketch') return false;
      return dialogs.editFeature?.(id) ?? false;
    },
    canEdit: (f, index, marker) =>
      isEditableSketch(f, index, marker) ||
      (readSketch(f) === undefined && (dialogs.hasDialog?.(f.type) ?? false)),
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
    exportSketch: (id) => dialogs.exportSketch(id),
    rollTo(index) {
      const why = locked();
      if (why) return notify('info', why);
      if (index !== store.getState().doc.timelineMarker) run(moveTimelineMarker({ index }));
    },
    move(id, index, active) {
      const why = locked();
      if (why) {
        notify('info', why);
        return false;
      }
      const ids = typeof id === 'string' ? [id] : id;
      const at = active !== undefined ? { active } : {};
      return run(
        ids.length === 1
          ? moveFeature({ id: ids[0] as FeatureId, index, ...at })
          : moveFeatures({ ids, index, ...at }),
      );
    },
    moveProblem: (id, index) =>
      locked() ??
      (typeof id === 'string'
        ? moveProblem(store.getState().doc, id, index)
        : moveFeaturesProblem(store.getState().doc, id, index)),
    issues,
    fix(id) {
      const f = feature(id);
      const found = issues(id);
      if (!f || found.length === 0) return;
      const why = locked();
      if (why) return notify('info', why);
      const sketch = readSketch(f);
      if (sketch) {
        const plane = found.some(
          (i) => i.ref.kind === sketch.plane.kind && i.ref.id === sketch.plane.id,
        );
        if (plane) return redefinePlane(id);
        // Lost projections: their curves stay; in the sketch they can be deleted or projected again.
        if (editSketch(stores, id)) {
          notify('info', "Delete the lost projection's curves, or project the edge or face again.");
        }
        return;
      }
      if (!dialogs.fixFeature?.(id, found)) {
        notify('info', `${f.name} has no dialog yet: delete it and make it again.`);
      }
    },
    keepClosest(id) {
      const replace = issues(id).flatMap((i) =>
        i.state === 'guessed' && i.now ? [{ from: i.ref, to: i.now }] : [],
      );
      const why = locked();
      if (why) return notify('info', why);
      if (replace.length > 0) run(replaceReferences({ id, replace }));
    },
    redefinePlane,
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
