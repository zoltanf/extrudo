/**
 * Selection in the open sketch (P1-06): constraints picked by their glyphs.
 * P1-09 adds entities, box select and deleting geometry.
 */
import {
  type ConstraintId,
  type DocumentStore,
  readSketch,
  removeFromSketch,
  type SessionStore,
} from '@extrudo/core';

export interface SketchSelectionStores {
  store: DocumentStore;
  session: SessionStore;
}

/** The selected constraints that the open sketch still has. */
export function selectedConstraints({ store, session }: SketchSelectionStores): ConstraintId[] {
  const { activeSketchId, selection } = session.getState();
  const feature =
    activeSketchId && store.getState().doc.features.find((f) => f.id === activeSketchId);
  const data = feature ? readSketch(feature)?.data : undefined;
  if (!data) return [];
  return selection
    .filter((s) => s.kind === 'constraint' && s.id in data.constraints)
    .map((s) => s.id as ConstraintId);
}

/**
 * Deletes the selected constraints as one undo step and clears the
 * selection. Returns false, changing nothing, if none is selected.
 */
export function deleteSelection(stores: SketchSelectionStores): boolean {
  const feature = stores.session.getState().activeSketchId;
  const constraints = selectedConstraints(stores);
  if (!feature || constraints.length === 0) return false;
  stores.store.getState().dispatch(removeFromSketch({ feature, constraints }));
  stores.session.getState().clearSelection();
  return true;
}
