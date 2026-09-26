/**
 * Selection in the open sketch: constraints picked by their glyphs (P1-06)
 * and dimensions by their labels (P1-07). P1-09 adds entities, box select
 * and deleting geometry.
 */
import {
  type ConstraintId,
  type DimensionId,
  type DocumentStore,
  readSketch,
  removeFromSketch,
  type SessionStore,
  type SketchData,
} from '@extrudo/core';

export interface SketchSelectionStores {
  store: DocumentStore;
  session: SessionStore;
}

function openSketch({ store, session }: SketchSelectionStores): SketchData | undefined {
  const { activeSketchId } = session.getState();
  const feature =
    activeSketchId && store.getState().doc.features.find((f) => f.id === activeSketchId);
  return feature ? readSketch(feature)?.data : undefined;
}

/** The selected constraints that the open sketch still has. */
export function selectedConstraints(stores: SketchSelectionStores): ConstraintId[] {
  const data = openSketch(stores);
  if (!data) return [];
  return stores.session
    .getState()
    .selection.filter((s) => s.kind === 'constraint' && s.id in data.constraints)
    .map((s) => s.id as ConstraintId);
}

/** The selected dimensions that the open sketch still has. */
export function selectedDimensions(stores: SketchSelectionStores): DimensionId[] {
  const data = openSketch(stores);
  if (!data) return [];
  return stores.session
    .getState()
    .selection.filter((s) => s.kind === 'dimension' && s.id in data.dimensions)
    .map((s) => s.id as DimensionId);
}

/**
 * Deletes the selected constraints and dimensions as one undo step and
 * clears the selection. Returns false, changing nothing, if none is
 * selected. Throws the command's `CommandError`, changing nothing, if a
 * dimension's parameter is still used elsewhere.
 */
export function deleteSelection(stores: SketchSelectionStores): boolean {
  const feature = stores.session.getState().activeSketchId;
  const constraints = selectedConstraints(stores);
  const dimensions = selectedDimensions(stores);
  if (!feature || constraints.length + dimensions.length === 0) return false;
  stores.store.getState().dispatch(removeFromSketch({ feature, constraints, dimensions }));
  stores.session.getState().clearSelection();
  return true;
}
