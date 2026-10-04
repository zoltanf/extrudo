/**
 * What the timeline and the marking menu do to a group of features (P4-09,
 * ADR-0065 §2): group a picked run under a name, rename it, ungroup it, fold
 * or open it, and suppress or hide all of it. Plain functions over the
 * document store, like `featureActions.ts`, so the menus, the chips and the
 * tests share them. Every change is a command, so each is one undo step.
 *
 * Folding and unfolding is stored (`collapsed` in the document, ADR-0065 §1),
 * and the marker never stays inside a folded group: `AppShell` opens a group
 * the marker lands in, as part of the step that moved the marker.
 */
import {
  type Command,
  CommandError,
  type DocumentStore,
  type FeatureId,
  type GroupId,
  groupFeatures,
  groupMembers,
  groupSuppressed,
  groupVisibility,
  isFeatureVisible,
  newId,
  renameGroup,
  setGroupCollapsed,
  ungroup,
} from '@extrudo/core';

export interface GroupActions {
  /**
   * Groups a run of neighbouring chips under a new "Group<n>" (its ID comes
   * from `newId`, like every entity's). Refused, with a toast, when the
   * features don't sit next to each other or one is in a group already.
   */
  group(features: readonly FeatureId[]): boolean;
  /** Renames a group (F2). Returns `false` when the name is refused (empty). */
  rename(id: GroupId, name: string): boolean;
  /** Removes the group; its features stay as they are. */
  ungroup(id: GroupId): void;
  /** Folds a group into one chip or opens it. */
  setCollapsed(id: GroupId, collapsed: boolean): void;
  /** Suppresses or unsuppresses every member, one undo step. */
  setSuppressed(id: GroupId, suppressed: boolean): void;
  /** Shows or hides every member's own geometry, one undo step. */
  setVisible(id: GroupId, visible: boolean): void;
}

export function createGroupActions(
  store: DocumentStore,
  notify: (tone: 'info' | 'error', text: string) => void,
): GroupActions {
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
  return {
    group(features) {
      if (features.length < 2) {
        notify('info', 'Pick the chips to group, next to each other.');
        return false;
      }
      return run(groupFeatures({ id: newId<GroupId>(), features }));
    },
    rename(id, name) {
      const group = store.getState().doc.groups?.find((g) => g.id === id);
      if (!group) return false;
      if (name.trim() === group.name) return true;
      return run(renameGroup({ id, name }));
    },
    ungroup(id) {
      if (!store.getState().doc.groups?.some((g) => g.id === id)) return;
      run(ungroup({ id }));
    },
    setCollapsed(id, collapsed) {
      const group = store.getState().doc.groups?.find((g) => g.id === id);
      if (!group || group.collapsed === collapsed) return;
      run(setGroupCollapsed({ id, collapsed }));
    },
    setSuppressed(id, suppressed) {
      const group = store.getState().doc.groups?.find((g) => g.id === id);
      if (!group) return;
      const members = groupMembers(store.getState().doc, group);
      const current = members.every((featureId) => {
        const feature = store.getState().doc.features.find((f) => f.id === featureId);
        return feature?.suppressed === suppressed;
      });
      if (current) return;
      run(groupSuppressed({ id, suppressed }));
    },
    setVisible(id, visible) {
      const group = store.getState().doc.groups?.find((g) => g.id === id);
      if (!group) return;
      const members = groupMembers(store.getState().doc, group);
      const current = members.every((featureId) => {
        const feature = store.getState().doc.features.find((f) => f.id === featureId);
        return feature !== undefined && isFeatureVisible(feature) === visible;
      });
      if (current) return;
      run(groupVisibility({ id, visible }));
    },
  };
}
