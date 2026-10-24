/**
 * Autosave (FR-PRJ-03, P0-08): every document change is saved shortly after
 * edits stop, with a status the app bar shows. Undo and redo are changes
 * too. A save that fails keeps the status at `error` until the next change
 * or `retry()` succeeds; a change made during a save is saved right after.
 *
 * The thumbnail a save leads to stays off the edit's critical path
 * (ADR-0102 §1): it is taken in idle time, waits while the app is busy (a
 * recompute, a pointer button down), is skipped when what it would show is
 * unchanged, and `flush()` takes a pending one at once.
 */
import type { DocumentStore } from '@extrudo/core';
import type { ProjectId, ProjectStore } from '@extrudo/storage';
import { createStore, type StoreApi } from 'zustand/vanilla';
import { whenIdle } from '../idle';

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
  /** A fresh thumbnail after each save, in idle time; failures are ignored. */
  thumbnail?: () => Promise<Blob | null>;
  /**
   * What the thumbnail would show (the document, the camera): when every item
   * is identical (`===`) to the last thumbnail's, none is taken.
   */
  thumbnailKey?: () => readonly unknown[];
  /** False while the app is busy (a recompute, a pointer button down): the thumbnail waits. */
  thumbnailReady?: () => boolean;
}

export const AUTOSAVE_DELAY = 800;

/** Every autosaver that hasn't been disposed of: what `saveEverything` flushes. */
const live = new Set<Autosaver>();

export function createAutosaver(options: AutosaveOptions): Autosaver {
  const { store, projects } = options;
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
        thumbnails.request(summary.id);
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

  const thumbnails = createThumbnailer(options);

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
      await thumbnails.flush();
    },
    retry: () => save(),
    dispose() {
      disposed = true;
      clearTimeout(timer);
      thumbnails.cancel();
      unsubscribe();
      live.delete(autosaver);
    },
  });
  live.add(autosaver);
  return autosaver;
}

/** Whether two thumbnail keys show the same picture: every item identical. */
export function sameThumbnailKey(
  a: readonly unknown[] | undefined,
  b: readonly unknown[],
): boolean {
  return a !== undefined && a.length === b.length && a.every((item, i) => item === b[i]);
}

/**
 * The autosaver's thumbnails: one pending request at a time (a later save
 * replaces it), taken in idle time once `thumbnailReady` allows.
 */
function createThumbnailer({ projects, thumbnail, thumbnailKey, thumbnailReady }: AutosaveOptions) {
  let pending: ProjectId | undefined;
  let cancelIdle: (() => void) | undefined;
  let taking: Promise<void> | undefined;
  let lastKey: readonly unknown[] | undefined;

  const take = (id: ProjectId): Promise<void> => {
    const key = thumbnailKey?.();
    if (key && sameThumbnailKey(lastKey, key)) return Promise.resolve();
    taking = (async () => {
      const png = await thumbnail?.().catch(() => null);
      if (png) {
        await projects.setThumbnail(id, png).catch(() => {});
        lastKey = key;
      }
    })().finally(() => {
      taking = undefined;
      if (pending) schedule();
    });
    return taking;
  };

  const run = () => {
    cancelIdle = undefined;
    if (!pending || taking) return;
    if (thumbnailReady && !thumbnailReady()) return schedule();
    const id = pending;
    pending = undefined;
    void take(id);
  };

  const schedule = () => {
    if (!cancelIdle) cancelIdle = whenIdle(run);
  };

  return {
    request(id: ProjectId) {
      if (!thumbnail) return;
      pending = id;
      if (!taking) schedule();
    },
    /** Takes a pending thumbnail now, busy or not, and waits for any being taken. */
    async flush() {
      await taking;
      if (!pending) return;
      cancelIdle?.();
      cancelIdle = undefined;
      const id = pending;
      pending = undefined;
      await take(id);
    },
    cancel() {
      cancelIdle?.();
      cancelIdle = undefined;
      pending = undefined;
    },
  };
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
