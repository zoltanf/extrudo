/**
 * IndexedDB: the project index, and a file store for browsers without OPFS.
 * One database, `extrudo`, with two object stores.
 */
import type { FileStore } from './files';
import type { ProjectId, ProjectSummary } from './types';

/** The list of projects, kept apart from their (larger) documents. */
export interface ProjectIndex {
  all(): Promise<ProjectSummary[]>;
  get(id: ProjectId): Promise<ProjectSummary | undefined>;
  put(summary: ProjectSummary): Promise<void>;
  delete(id: ProjectId): Promise<void>;
}

/** An in-memory index, for tests and Node. */
export function memoryIndex(): ProjectIndex {
  const entries = new Map<ProjectId, ProjectSummary>();
  return {
    all: async () => [...entries.values()].map((s) => ({ ...s })),
    get: async (id) => {
      const s = entries.get(id);
      return s ? { ...s } : undefined;
    },
    put: async (summary) => void entries.set(summary.id, { ...summary }),
    delete: async (id) => void entries.delete(id),
  };
}

export const DB_NAME = 'extrudo';
const DB_VERSION = 1;
const PROJECTS = 'projects';
const FILES = 'files';

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

/**
 * Opens (or creates) the database. If it exists without all its object
 * stores (created by an older or interrupted version), it is upgraded to
 * the next version to add them, instead of failing on every transaction.
 */
export async function openDatabase(
  factory: IDBFactory = globalThis.indexedDB,
  name = DB_NAME,
): Promise<IDBDatabase> {
  const open = (version?: number) => {
    const request = version === undefined ? factory.open(name) : factory.open(name, version);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const store of [PROJECTS, FILES]) {
        if (!db.objectStoreNames.contains(store)) {
          db.createObjectStore(store, store === PROJECTS ? { keyPath: 'id' } : undefined);
        }
      }
    };
    return done(request);
  };
  let db = await open();
  if (db.version < DB_VERSION || ![PROJECTS, FILES].every((s) => db.objectStoreNames.contains(s))) {
    const next = Math.max(DB_VERSION, db.version + 1);
    db.close();
    db = await open(next);
  }
  return db;
}

export function idbIndex(db: IDBDatabase): ProjectIndex {
  const store = (mode: IDBTransactionMode) => db.transaction(PROJECTS, mode).objectStore(PROJECTS);
  const write = async (run: (s: IDBObjectStore) => void) => {
    const s = store('readwrite');
    run(s);
    await committed(s.transaction);
  };
  return {
    all: () => done(store('readonly').getAll() as IDBRequest<ProjectSummary[]>),
    get: (id) => done(store('readonly').get(id) as IDBRequest<ProjectSummary | undefined>),
    put: (summary) => write((s) => s.put(summary)),
    delete: (id) => write((s) => s.delete(id)),
  };
}

/** Files as IndexedDB values keyed by path: the fallback when OPFS is missing. */
export function idbFiles(db: IDBDatabase): FileStore {
  const store = (mode: IDBTransactionMode) => db.transaction(FILES, mode).objectStore(FILES);
  return {
    async read(path) {
      const value = await done(store('readonly').get(path) as IDBRequest<Uint8Array | undefined>);
      return value ? new Uint8Array(value) : undefined;
    },
    async write(path, data) {
      const s = store('readwrite');
      s.put(data.slice(), path);
      await committed(s.transaction);
    },
    async remove(path) {
      const s = store('readwrite');
      s.delete(path);
      // Everything under the folder: keys from "path/" up to "path/￿".
      s.delete(IDBKeyRange.bound(`${path}/`, `${path}/￿`));
      await committed(s.transaction);
    },
    async list(prefix) {
      const start = `${prefix}/`;
      const keys = await done(
        store('readonly').getAllKeys(IDBKeyRange.bound(start, `${start}￿`)) as IDBRequest<
          IDBValidKey[]
        >,
      );
      return keys.map(String).sort();
    },
  };
}
