/**
 * Autosave (FR-PRJ-03, P0-08): every document change is saved shortly after
 * edits stop, with a status the app bar shows. Undo and redo are changes
 * too. A save that fails keeps the status at `error` until the next change
 * or `retry()` succeeds; a change made during a save is saved right after.
 */
import type { DocumentStore } from '@extrudo/core';
import type { ProjectStore } from '@extrudo/storage';
import { createStore, type StoreApi } from 'zustand/vanilla';

export type SaveStatus = 'saved' | 'unsaved' | 'saving' | 'error';

export interface AutosaveState {
  status: SaveStatus;
  /** Why the last save failed, in plain words. */
  error: string | undefined;
  /** ISO time of the last successful save. */
  savedAt: string | undefined;
}

export interface Autosaver extends StoreApi<AutosaveState> {
  /** Saves now if anything is unsaved, and waits for it. */
  flush(): Promise<void>;
  retry(): Promise<void>;
  dispose(): void;
}

export interface AutosaveOptions {
  store: DocumentStore;
  projects: ProjectStore;
  /** Quiet time after the last change before saving, in ms. */
  delay?: number;
  /** A fresh thumbnail after each save; failures are ignored. */
  thumbnail?: () => Promise<Blob | null>;
}

export const AUTOSAVE_DELAY = 800;

/** Every autosaver that hasn't been disposed of: what `saveEverything` flushes. */
const live = new Set<Autosaver>();

export function createAutosaver(options: AutosaveOptions): Autosaver {
  const { store, projects, thumbnail } = options;
  const delay = options.delay ?? AUTOSAVE_DELAY;
  const state = createStore<AutosaveState>()(() => ({
    status: 'saved',
    error: undefined,
    savedAt: undefined,
  }));

  let timer: ReturnType<typeof setTimeout> | undefined;
  let running: Promise<void> | undefined;
  let dirty = false;
  let disposed = false;

  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(() => void save(), delay);
  };

  const save = (): Promise<void> => {
    clearTimeout(timer);
    timer = undefined;
    if (running) return running;
    if (!dirty) return Promise.resolve();
    running = (async () => {
      dirty = false;
      state.setState({ status: 'saving' });
      try {
        const summary = await projects.save(store.getState().doc);
        if (thumbnail) {
          const png = await thumbnail().catch(() => null);
          if (png) await projects.setThumbnail(summary.id, png).catch(() => {});
        }
        state.setState({
          status: dirty ? 'unsaved' : 'saved',
          error: undefined,
          savedAt: summary.modified,
        });
      } catch (error) {
        dirty = true;
        state.setState({ status: 'error', error: messageOf(error) });
      } finally {
        running = undefined;
      }
      // Changes that came in while saving.
      if (dirty && state.getState().status === 'unsaved' && !disposed) schedule();
    })();
    return running;
  };

  const unsubscribe = store.subscribe((s, prev) => {
    if (s.doc === prev.doc || disposed) return;
    dirty = true;
    if (!running && state.getState().status !== 'error') state.setState({ status: 'unsaved' });
    if (running) return;
    schedule();
  });

  const autosaver: Autosaver = Object.assign(state, {
    async flush() {
      await running;
      await save();
    },
    retry: () => save(),
    dispose() {
      disposed = true;
      clearTimeout(timer);
      unsubscribe();
      live.delete(autosaver);
    },
  });
  live.add(autosaver);
  return autosaver;
}

function messageOf(error: unknown): string {
  if (error instanceof DOMException && error.name === 'QuotaExceededError') {
    return 'The browser is out of storage space for this site.';
  }
  return error instanceof Error ? error.message : String(error);
}

const pending = new Set<Promise<void>>();

/**
 * Flushes and disposes of an autosaver without waiting, for when its page
 * closes. `allSaved()` waits for these, so the home screen lists fresh data.
 */
export function closeAutosaver(autosaver: Autosaver): void {
  const done = autosaver
    .flush()
    .catch(() => {})
    .finally(() => {
      autosaver.dispose();
      pending.delete(done);
    });
  pending.add(done);
}

/**
 * Saves every open design now (for a reload the person asked for, ADR-0054) and says whether
 * everything is stored: false while a save failed, so the caller must not reload.
 */
export async function saveEverything(): Promise<boolean> {
  await allSaved();
  await Promise.all([...live].map((autosaver) => autosaver.flush().catch(() => {})));
  return [...live].every((autosaver) => autosaver.getState().status === 'saved');
}

/** Resolves once every closing autosaver has finished its last save. */
export async function allSaved(): Promise<void> {
  await Promise.all([...pending]);
}
