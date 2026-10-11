/**
 * Named views (ADR-0008's amendment, 2026-10-10): what the nav bar, the
 * browser and the commands do with the document's `doc.views`. Saving and
 * updating are document commands (one undo step each); restoring only moves
 * the camera through the viewport store's standard animated move — view
 * state, never a command, and it never marks the design unsaved.
 */
import {
  type Command,
  CommandError,
  type DocumentStore,
  newId,
  removeView,
  saveView,
  updateView,
  type ViewId,
} from '@extrudo/core';
import { cameraToView, viewToCamera } from '../viewport/namedView';
import type { ViewportStore } from '../viewport/store';

/** The browser's and the commands' actions over the named views. */
export interface ViewActions {
  /** Animates the camera to the saved view (its projection comes with it). */
  restore(id: ViewId): void;
  /** Saves the live camera under `name`; `false` (and a message) when refused. */
  save(name: string): boolean;
  /** Overwrites a view's camera with the current one ("Update to Current View"). */
  update(id: ViewId): void;
  /** Renames a view; `false` (and a message) when the name is refused. */
  rename(id: ViewId, name: string): boolean;
  /** Deletes the view. */
  remove(id: ViewId): void;
}

export function createViewActions(
  store: DocumentStore,
  viewport: ViewportStore,
  notify: (tone: 'info' | 'error', text: string) => void,
): ViewActions {
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
    restore(id) {
      const view = store.getState().doc.views.find((v) => v.id === id);
      if (!view) return;
      // The saved projection is part of the camera: an orthographic view
      // restores orthographic.
      viewport.getState().setProjection(view.camera.projection);
      viewport.getState().animateTo(cameraToView(view.camera));
    },
    save(name) {
      const { view, projection } = viewport.getState();
      return run(
        saveView({
          id: newId<ViewId>(),
          name,
          camera: viewToCamera(view, projection),
        }),
      );
    },
    update(id) {
      const { view, projection } = viewport.getState();
      run(updateView({ id, camera: viewToCamera(view, projection) }));
    },
    rename(id, name) {
      return run(updateView({ id, name }));
    },
    remove(id) {
      run(removeView({ id }));
    },
  };
}
