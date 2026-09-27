/**
 * Selection in the open sketch: constraints picked by their glyphs (P1-06),
 * dimensions by their labels (P1-07), and points and curves picked or
 * box-selected in the view (P1-09, the tool host).
 */
import {
  type ConstraintId,
  type DimensionId,
  type DocumentStore,
  readSketch,
  removeFromSketch,
  type SessionStore,
  type SketchData,
  type SketchEntityId,
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

/** The selected points and curves that the open sketch still has. */
export function selectedEntities(stores: SketchSelectionStores): SketchEntityId[] {
  const data = openSketch(stores);
  if (!data) return [];
  return stores.session
    .getState()
    .selection.filter((s) => s.kind === 'sketchEntity' && s.id in data.entities)
    .map((s) => s.id as SketchEntityId);
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
 * Deletes the selected entities, constraints and dimensions as one undo
 * step and clears the selection. Deleted geometry takes its constraints and
 * dimensions with it (`removeFromSketch`). Returns false, changing nothing,
 * if none is selected. Throws the command's `CommandError`, changing
 * nothing, if a dimension's parameter is still used elsewhere.
 */
export function deleteSelection(stores: SketchSelectionStores): boolean {
  const feature = stores.session.getState().activeSketchId;
  const entities = selectedEntities(stores);
  const constraints = selectedConstraints(stores);
  const dimensions = selectedDimensions(stores);
  if (!feature || entities.length + constraints.length + dimensions.length === 0) return false;
  stores.store
    .getState()
    .dispatch(removeFromSketch({ feature, entities, constraints, dimensions }));
  stores.session.getState().clearSelection();
  return true;
}
