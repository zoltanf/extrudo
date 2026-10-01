import { type FileStore, opfsFiles } from './files';
import { idbFiles, idbIndex, openDatabase } from './idb';
import { createProjectStore, localLock } from './project-store';
import type { ProjectStore } from './types';

export interface BrowserProjectStore extends ProjectStore {
  /** Where documents are kept: OPFS, or IndexedDB where OPFS is missing. */
  readonly backend: 'opfs' | 'indexeddb';
}

/**
 * The web app's project store (FR-PRJ-02): the index in IndexedDB,
 * documents and thumbnails in OPFS, falling back to IndexedDB for files
 * when the browser has no OPFS with writable files.
 */
export async function createBrowserProjectStore(
  options: { appVersion?: string } = {},
): Promise<BrowserProjectStore> {
  const db = await openDatabase();
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
  const store = createProjectStore({ index: idbIndex(db), files, lock: webLock(), ...options });
  return Object.assign(store, { backend });
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
