/**
 * What the Annotations folder in the browser does with a note (ADR-0126 §6): select it and
 * look at it, hover it, edit it in place, hide it, tick it off, delete it. Every change is
 * one command; looking and hovering are view state.
 */
import {
  type AnnotationId,
  CommandError,
  type DocumentStore,
  type ModelStore,
  removeAnnotation,
  type SessionStore,
  updateAnnotation,
} from '@extrudo/core';
import type { ViewportStore } from '../viewport/store';
import { type OpenSketch, placedNow } from './anchor';
import type { AnnotationsUiStore } from './ui';

export interface AnnotationActions {
  /** Selects the note (`toggle` adds or removes it) and turns the view to it. */
  select(id: AnnotationId, toggle: boolean): void;
  /** The pointer on a note's row (`undefined` when it leaves): drawn in full, highlighted. */
  hover(id: AnnotationId | undefined): void;
  edit(id: AnnotationId): void;
  setHidden(id: AnnotationId, hidden: boolean): void;
  setDone(id: AnnotationId, done: boolean): void;
  remove(ids: readonly AnnotationId[]): void;
  /** Deletes every ticked-off note, one step ("Delete 3 done annotations"). */
  removeDone(): void;
}

const annotationByNumberOf = (store: DocumentStore, id: AnnotationId) =>
  store.getState().doc.annotations?.find((a) => a.id === id)?.number ?? '?';

/** How far around a note "look at" keeps in frame, mm. */
const LOOK_ROOM = 15;

export function createAnnotationActions(deps: {
  store: DocumentStore;
  session: SessionStore;
  model: ModelStore<unknown>;
  viewport: ViewportStore;
  ui: AnnotationsUiStore;
  notify(message: string): void;
  /** The sketch open for editing: its notes are drawn even while the sketch is hidden. */
  openSketch(): OpenSketch | undefined;
}): AnnotationActions {
  const { store, session, model, viewport, ui, notify } = deps;
  const placed = (id: AnnotationId) =>
    placedNow(store.getState().doc, model.getState(), deps.openSketch()).find(
      (p) => p.annotation.id === id,
    );
  const run = (command: Parameters<ReturnType<DocumentStore['getState']>['dispatch']>[0]) => {
    try {
      store.getState().dispatch(command);
    } catch (error) {
      if (!(error instanceof CommandError)) throw error;
      notify(error.message);
    }
  };
  return {
    select(id, toggle) {
      session.getState().select([{ kind: 'annotation', id }], toggle ? 'toggle' : 'replace');
      if (toggle) return;
      const found = placed(id);
      if (!found) return;
      const [x, y, z] = found.at;
      viewport.getState().lookAtBox({
        min: [x - LOOK_ROOM, y - LOOK_ROOM, z - LOOK_ROOM],
        max: [x + LOOK_ROOM, y + LOOK_ROOM, z + LOOK_ROOM],
      });
    },
    hover(id) {
      const current = session.getState().hover;
      if (id) session.getState().setHover({ kind: 'annotation', id });
      else if (current?.kind === 'annotation') session.getState().setHover(undefined);
    },
    edit(id) {
      // Only a note the view can place can be edited in place (a sketch note needs its sketch).
      if (!placed(id)) {
        notify(`#${annotationByNumberOf(store, id)} isn't drawn: show its sketch to edit it.`);
        return;
      }
      ui.getState().edit(id);
    },
    setHidden: (id, hidden) => run(updateAnnotation({ id, changes: { hidden } })),
    setDone: (id, done) => run(updateAnnotation({ id, changes: { done } })),
    remove: (ids) => run(removeAnnotation({ ids })),
    removeDone() {
      const ids = (store.getState().doc.annotations ?? []).filter((a) => a.done).map((a) => a.id);
      if (ids.length === 0) return;
      const state = store.getState();
      state.beginTransaction(
        `Delete ${ids.length} done ${ids.length === 1 ? 'annotation' : 'annotations'}`,
      );
      run(removeAnnotation({ ids }));
      state.commitTransaction();
    },
  };
}
