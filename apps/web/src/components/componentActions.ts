/**
 * What the browser does to components (P6-05 S3, ADR-0081 §6): rename, show/ghost/hide,
 * delete, select their bodies, make a new one. Each write is one command, so one undo
 * step; a refused one says why through `notify`.
 */
import {
  addComponent,
  type BodyId,
  type Command,
  CommandError,
  type ComponentId,
  type DocumentStore,
  newId,
  removeComponent,
  renameComponent,
  type SelectMode,
  type SessionStore,
  setComponentDisplay,
} from '@extrudo/core';
import type { BodyDisplay } from '../shell/bodies';

export interface ComponentActions {
  /** `false` (and a message) if the name is refused. */
  rename(id: ComponentId, name: string): boolean;
  setDisplay(ids: readonly ComponentId[], display: BodyDisplay): void;
  remove(id: ComponentId): void;
  /** Puts every live member into the session selection (kind `body`). */
  select(id: ComponentId, mode: SelectMode): void;
  /** Makes a component of `bodies` (none: an empty one); returns its ID. */
  newComponent(bodies: readonly BodyId[]): ComponentId | undefined;
}

export function createComponentActions(
  stores: { store: DocumentStore; session: SessionStore },
  /** A component's live body IDs, in browser order. */
  members: (id: ComponentId) => readonly BodyId[],
  notify: (tone: 'info' | 'error', text: string) => void,
): ComponentActions {
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
  const nameOf = (id: ComponentId) =>
    store.getState().doc.components?.find((c) => c.id === id)?.name;
  return {
    rename(id, name) {
      const current = nameOf(id);
      if (current === undefined) return false;
      if (name.trim() === current) return true;
      return run(renameComponent({ id, name }));
    },
    setDisplay(ids, display) {
      if (ids.length === 0) return;
      run(setComponentDisplay({ ids, display }));
    },
    remove(id) {
      const name = nameOf(id);
      if (name === undefined) return;
      if (!run(removeComponent({ id }))) return;
      notify('info', `Deleted ${name}. Its bodies stay in the design.`);
    },
    select(id, mode) {
      session.getState().select(
        members(id).map((body) => ({ kind: 'body' as const, id: body })),
        mode,
      );
    },
    newComponent(bodies) {
      const id = newId<ComponentId>();
      return run(addComponent({ id, bodies })) ? id : undefined;
    },
  };
}
