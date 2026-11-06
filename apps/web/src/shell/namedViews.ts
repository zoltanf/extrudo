/**
 * Named views (ADR-0008's amendment, 2026-10-10): what the nav bar, the
 * browser and the commands do with the document's `doc.views`. A view is the
 * camera plus the section shown when it was saved (ADR-0045's amendment of
 * 2026-11-06). Saving and updating are document commands (one undo step
 * each); restoring only moves the camera through the viewport store's
 * standard animated move and puts the view's section, if it has one, on
 * screen — view state, never a command, and it never marks the design unsaved.
 * The sketch Slice is never read or written here.
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
  type ViewSection,
} from '@extrudo/core';
import { sectionForView, showViewSection } from '../section/viewSection';
import { cameraToView, viewToCamera } from '../viewport/namedView';
import type { ViewportStore } from '../viewport/store';

/** The browser's and the commands' actions over the named views. */
export interface ViewActions {
  /** Animates the camera to the saved view (its projection and section come with it). */
  restore(id: ViewId): void;
  /** Saves the live camera and the section shown under `name`; `false` (and a message) when refused. */
  save(name: string): boolean;
  /** Overwrites a view's camera and section with the current ones ("Update to Current View"). */
  update(id: ViewId): void;
  /** Renames a view; `false` (and a message) when the name is refused. */
  rename(id: ViewId, name: string): boolean;
  /** Deletes the view. */
  remove(id: ViewId): void;
}

/** `{ section }` when there is one, else nothing: the key stays out of the payload. */
const sectionKey = (section: ViewSection | undefined) => (section ? { section } : {});

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
      // A view without a section leaves the one on screen alone.
      if (view.section) showViewSection(viewport, view.section);
      // The saved projection is part of the camera: an orthographic view
      // restores orthographic.
      viewport.getState().setProjection(view.camera.projection);
      viewport.getState().animateTo(cameraToView(view.camera));
    },
    save(name) {
      const { view, projection, section, sectionBox } = viewport.getState();
      return run(
        saveView({
          id: newId<ViewId>(),
          name,
          camera: viewToCamera(view, projection),
          ...sectionKey(sectionForView(section, sectionBox)),
        }),
      );
    },
    update(id) {
      const { view, projection, section, sectionBox } = viewport.getState();
      run(
        updateView({
          id,
          camera: viewToCamera(view, projection),
          section: sectionForView(section, sectionBox) ?? null,
        }),
      );
    },
    rename(id, name) {
      return run(updateView({ id, name }));
    },
    remove(id) {
      run(removeView({ id }));
    },
  };
}
