/**
 * Values the app keeps in IndexedDB as browser handles (P4-09, ADR-0065 §3):
 * the linked folder's directory handle. A `FileSystemHandle` is
 * structured-cloneable, so it survives a reload, which is what makes a linked
 * folder worth linking; nothing storage itself needs is like it, so it gets a
 * store of its own.
 */
import { HANDLES } from './idb';

export interface HandleStore {
  /** The stored value, or `undefined` when there is none. */
  get(): Promise<unknown>;
  put(value: unknown): Promise<void>;
  delete(): Promise<void>;
}

/** The one key the `handles` store uses (one folder at a time, ADR-0065 §3). */
export const FOLDER_HANDLE_KEY = 'linked-folder';

const done = <T>(request: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const committed = (tx: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });

/** The handle store of a database `openDatabase` opened. */
export function idbHandles(db: IDBDatabase): HandleStore {
  const store = (mode: IDBTransactionMode) => db.transaction(HANDLES, mode).objectStore(HANDLES);
  return {
    get: () => done(store('readonly').get(FOLDER_HANDLE_KEY)),
    async put(value) {
      const s = store('readwrite');
      s.put(value, FOLDER_HANDLE_KEY);
      await committed(s.transaction);
    },
    async delete() {
      const s = store('readwrite');
      s.delete(FOLDER_HANDLE_KEY);
      await committed(s.transaction);
    },
  };
}

/** A handle store in memory, for tests and Node. */
export function memoryHandles(): HandleStore {
  let value: unknown;
  return {
    get: async () => value,
    put: async (next) => {
      value = next;
    },
    delete: async () => {
      value = undefined;
    },
  };
}
