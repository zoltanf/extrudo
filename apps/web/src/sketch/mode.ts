/**
 * Sketch mode (P1-01, UI spec §4, ADR-0010): Create Sketch, entering and
 * finishing a sketch. Plain functions over the stores, so they run in unit
 * tests and any control (toolbar, browser, timeline, shortcuts) can call them.
 *
 * - **Create Sketch** sets the session's active tool to `CREATE_SKETCH`; the
 *   viewport then shows the origin planes as pickable, and the prompt offers
 *   them as buttons. Picking one adds the sketch (one undo step) and enters it.
 * - **Entering** a sketch opens an undo transaction: undo steps through the
 *   sketch's edits only. The camera looks at the plane, sketch X to the right.
 * - **Finish Sketch** commits the transaction, so the edits become one step.
 */
import {
  addProjection,
  createSketch,
  type DocumentStore,
  type FeatureId,
  type GeomRef,
  type ModelStore,
  newId,
  type ProjectionId,
  readSketch,
  type SessionStore,
  type SketchFrame,
} from '@extrudo/core';
import type { ViewportStore } from '../viewport/store';
import { sketchFrame } from './frame';

/** The session tool that means "Create Sketch is waiting for a plane". */
export const CREATE_SKETCH = 'sketch';

export interface SketchModeStores {
  store: DocumentStore;
  session: SessionStore;
  viewport: ViewportStore;
  /** The kernel's results: where sketches on faces lie (P2-09). */
  model?: ModelStore<unknown>;
}

/** Starts Create Sketch (waits for a plane). Does nothing while a sketch is open. */
export function startCreateSketch({ session }: SketchModeStores): void {
  const s = session.getState();
  if (s.mode === 'sketch') return;
  s.clearSelection();
  s.setTool(CREATE_SKETCH);
}

/** Cancels Create Sketch if it is waiting for a plane. */
export function cancelCreateSketch({ session }: SketchModeStores): void {
  const s = session.getState();
  if (s.activeTool !== CREATE_SKETCH) return;
  s.setTool(undefined);
  if (s.hover?.kind === 'plane') s.setHover(undefined);
}

/** Adds a sketch on `plane` and opens it. Returns the new sketch's ID. */
export function createSketchOn(stores: SketchModeStores, plane: GeomRef): FeatureId {
  const id = newId<FeatureId>();
  cancelCreateSketch(stores);
  const { store, viewport } = stores;
  // Auto-project (P6-07, ADR-0074): a sketch starting on a face can bring the
  // face's outline with it, in the same undo step as the sketch.
  const outline =
    viewport.getState().autoProject && viewport.getState().autoProjectFace && plane.kind === 'face';
  if (outline) store.getState().beginTransaction('Create sketch');
  try {
    store.getState().dispatch(createSketch({ id, plane }));
    if (outline) {
      store
        .getState()
        .dispatch(addProjection({ feature: id, id: newId<ProjectionId>(), ref: plane }));
    }
    if (outline) store.getState().commitTransaction();
  } catch (error) {
    if (outline) store.getState().cancelTransaction();
    throw error;
  }
  editSketch(stores, id);
  return id;
}

/**
 * Opens a sketch for editing (finishing any other open sketch first).
 * Returns `false`, and changes nothing, if the feature isn't a valid sketch.
 */
export function editSketch(stores: SketchModeStores, id: FeatureId): boolean {
  const { store, session } = stores;
  const feature = store.getState().doc.features.find((f) => f.id === id);
  const sketch = feature && readSketch(feature);
  if (!sketch) return false;
  const current = session.getState();
  if (current.mode === 'sketch') {
    if (current.activeSketchId === id) return true;
    finishSketch(stores);
  }
  cancelCreateSketch(stores);
  store.getState().beginTransaction('Edit sketch');
  session.getState().enterSketch(id);
  lookAtSketch(stores);
  return true;
}

/** Commits the open sketch's edits as one undo step and leaves sketch mode. */
export function finishSketch({ store, session }: SketchModeStores): void {
  if (session.getState().mode !== 'sketch') return;
  if (store.getState().transactionDepth > 0) store.getState().commitTransaction();
  session.getState().exitSketch();
}

/** Turns the camera to face the open sketch's plane, sketch X to the right (palette "Look at"). */
export function lookAtSketch(stores: SketchModeStores): void {
  const frame = activeSketchFrame(stores);
  if (frame) stores.viewport.getState().lookFrom(frame.normal, frame.y);
}

/**
 * The frame of the sketch being edited, if its plane is known: an origin
 * plane's, or a face's from the kernel (or, until it has answered, from the
 * face's fingerprint).
 */
export function activeSketchFrame({
  store,
  session,
  model,
}: SketchModeStores): SketchFrame | undefined {
  const id = session.getState().activeSketchId;
  const feature = id && store.getState().doc.features.find((f) => f.id === id);
  const sketch = feature ? readSketch(feature) : undefined;
  return feature && sketch
    ? sketchFrame(
        feature.id,
        sketch.plane,
        model?.getState().sketches,
        model?.getState().construction,
      )
    : undefined;
}
