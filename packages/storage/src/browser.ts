import { type FileStore, opfsFiles } from './files';
import { type HandleStore, idbHandles } from './handles';
import { idbFiles, idbIndex, type OpenOptions, openDatabase } from './idb';
import { createProjectStore, localLock } from './project-store';
import type { ProjectStore } from './types';

export interface BrowserProjectStore extends ProjectStore {
  /** Where documents are kept: OPFS, or IndexedDB where OPFS is missing. */
  readonly backend: 'opfs' | 'indexeddb';
  /**
   * Values the app keeps in IndexedDB: the linked folder's handle (P4-09,
   * ADR-0065 §3). From the same connection, so the database is opened once.
   */
  readonly handles: HandleStore;
}

/** `createBrowserProjectStore` takes the database upgrade callbacks (`OpenOptions`). */
export type BrowserProjectStoreOptions = OpenOptions & {
  /** Written into `meta.appVersion` on save. */
  appVersion?: string;
};

/**
 * The web app's project store (FR-PRJ-02): the index in IndexedDB,
 * documents and thumbnails in OPFS, falling back to IndexedDB for files
 * when the browser has no OPFS with writable files.
 */
export async function createBrowserProjectStore(
  options: BrowserProjectStoreOptions = {},
): Promise<BrowserProjectStore> {
  const db = await openDatabase(globalThis.indexedDB, undefined, {
    onBlocked: options.onBlocked,
    onVersionChange: options.onVersionChange,
  });
  let files: FileStore = idbFiles(db);
  let backend: BrowserProjectStore['backend'] = 'indexeddb';
  try {
    const root = await navigator.storage.getDirectory();
    if ('createWritable' in FileSystemFileHandle.prototype) {
      files = opfsFiles(root);
      backend = 'opfs';
    }
  } catch {
    // No OPFS (or it's blocked, as in some private windows): keep IndexedDB.
  }
  const store = createProjectStore({
    index: idbIndex(db),
    files,
    lock: webLock(),
    appVersion: options.appVersion,
  });
  return Object.assign(store, { backend, handles: idbHandles(db) });
}

/**
 * The Web Locks API as the store's lock (P3-13): held across every tab of
 * this origin, so two tabs can't rewrite one version index at once. Where
 * the API is missing (old Safari, some embedded views) the lock holds within
 * this tab only.
 */
export function webLock(): <T>(name: string, task: () => Promise<T>) => Promise<T> {
  const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
  if (!locks) return localLock();
  return (name, task) => locks.request(name, task);
}
