/**
 * IndexedDB: the project index, a file store for browsers without OPFS, and a
 * store for the values the app keeps as browser handles. One database,
 * `extrudo`, with three object stores.
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
/** The database version; raised whenever a store is added (`STORES` above). */
export const DB_VERSION = 2;
const PROJECTS = 'projects';
const FILES = 'files';
/** Browser handles the app keeps: the linked folder's (P4-09, ADR-0065 §3). */
export const HANDLES = 'handles';
const STORES: { name: string; keyPath?: string }[] = [
  { name: PROJECTS, keyPath: 'id' },
  { name: FILES },
  { name: HANDLES },
];

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

export interface OpenOptions {
  /**
   * Another tab holds an older version of the database, so this open waits for
   * it. The request keeps waiting and succeeds once the other tabs let go; this
   * says meanwhile, so the app can tell the user (an open that waits in silence
   * looks like the app hanging).
   */
  onBlocked?(): void;
  /**
   * Another tab is upgrading the database, so this connection has to go. Called
   * first, then the connection is closed and every later use of it fails, which
   * is why an app wants to hear this and save.
   */
  onVersionChange?(): void;
}

/**
 * Opens (or creates) the database. If it exists without all its object
 * stores (created by an older or interrupted version), it is upgraded to
 * the next version to add them, instead of failing on every transaction. An
 * upgrade is held up by the other tabs of this origin, which is what
 * `onBlocked` and `onVersionChange` are for.
 */
export async function openDatabase(
  factory: IDBFactory = globalThis.indexedDB,
  name = DB_NAME,
  options: OpenOptions = {},
): Promise<IDBDatabase> {
  const open = (version?: number) => {
    const request = version === undefined ? factory.open(name) : factory.open(name, version);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const store of STORES) {
        if (!db.objectStoreNames.contains(store.name)) {
          db.createObjectStore(store.name, store.keyPath ? { keyPath: store.keyPath } : undefined);
        }
      }
    };
    if (options.onBlocked) request.onblocked = () => options.onBlocked?.();
    return done(request);
  };
  let db = await open();
  if (db.version < DB_VERSION || !STORES.every((s) => db.objectStoreNames.contains(s.name))) {
    const next = Math.max(DB_VERSION, db.version + 1);
    db.close();
    db = await open(next);
  }
  // Another tab upgrading makes this connection stale: let go of it, or that
  // tab's upgrade waits for ever.
  if (options.onVersionChange) {
    db.onversionchange = () => {
      options.onVersionChange?.();
      db.close();
    };
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
