/**
 * A real folder on disk linked to the app (FR-PRJ-06, P4-09, ADR-0065 §3),
 * through the File System Access API. Only Chromium has `showDirectoryPicker`,
 * so `Platform.folders` is left out where it is missing and the app shows no
 * linked folder at all (Firefox and Safari).
 *
 * One folder at a time. Its handle is kept in IndexedDB (a `FileSystemHandle`
 * is structured-cloneable, so it survives a reload) and re-permitted from a
 * click when the browser asks for it again. `list` reads only the top level and
 * only `.extrudo` files; nothing here writes anything but those.
 */
import { FILE_EXTENSION } from '@extrudo/core';
import type { HandleStore } from '@extrudo/storage';

/** `granted`, `prompt` or `denied`: the browser's own vocabulary. */
export type FolderPermission = PermissionState;

/** One `.extrudo` file at the top level of the folder. */
export interface FolderFile {
  name: string;
  /** When it was last written, ms since the epoch. */
  modified: number;
  size: number;
}

export interface FolderLink {
  /** The folder's own name, as the home screen shows it. */
  readonly name: string;
  /** What we may do with it right now. */
  permission(): Promise<FolderPermission>;
  /**
   * Asks for access again (`prompt` → `granted`), which needs a click: call it
   * from a button. `false` when the user says no.
   */
  request(): Promise<boolean>;
  /** The `.extrudo` files at the top level, newest first. */
  list(): Promise<FolderFile[]>;
  /** A file's bytes and when it was written. */
  read(name: string): Promise<{ bytes: Uint8Array; modified: number }>;
  /** Writes a file (creating it), answering when the file now says it was written. */
  write(name: string, bytes: Uint8Array): Promise<{ modified: number }>;
}

export interface LinkedFolders {
  /** Offers the folder picker; `undefined` when the user cancels. */
  link(): Promise<FolderLink | undefined>;
  /** The folder this browser has linked, from IndexedDB. */
  current(): Promise<FolderLink | undefined>;
  /** Forgets the folder. The files stay where they are. */
  unlink(): Promise<void>;
}

/**
 * A file the app expected to be there and isn't: someone removed it, or the
 * folder is a different one. The browser's copy of the design is untouched.
 */
export class LinkedFileError extends Error {
  override readonly name = 'LinkedFileError';
}

/**
 * The picker and the permission methods aren't in TypeScript's DOM library
 * yet (they are in the File System Access spec and in Chromium), so they are
 * declared here rather than cast away at each use.
 */
interface PermittedHandle extends FileSystemHandle {
  queryPermission?(descriptor?: { mode?: 'read' | 'readwrite' }): Promise<PermissionState>;
  requestPermission?(descriptor?: { mode?: 'read' | 'readwrite' }): Promise<PermissionState>;
}

type ShowDirectoryPicker = (options?: {
  mode?: 'read' | 'readwrite';
  id?: string;
}) => Promise<PermittedHandle>;

const picker = (): ShowDirectoryPicker | undefined =>
  (globalThis as { showDirectoryPicker?: ShowDirectoryPicker }).showDirectoryPicker;

/**
 * What `for await … of handle.entries()` gives: a name and its entry. (The
 * DOM library declares the same three methods twice, which makes its union of
 * the two entry kinds iterable on its own, not in one expression.)
 */
type Entries = AsyncIterable<[string, FileSystemDirectoryHandle | FileSystemFileHandle]>;

const entriesOf = (handle: FileSystemDirectoryHandle): Entries => handle.entries() as Entries;

/** Whether this browser can link a folder (ADR-0065 §3: Chromium only). */
export const folderAccess = (): boolean => typeof picker() === 'function';

/** Whether a stored value is a directory handle, from a database or a test. */
const isDirectory = (value: unknown): value is FileSystemDirectoryHandle =>
  typeof value === 'object' &&
  value !== null &&
  (value as FileSystemHandle).kind === 'directory' &&
  typeof (value as FileSystemDirectoryHandle).getFileHandle === 'function';

/**
 * Reads the file's own time back after writing: the file system's, not the
 * clock's, since that is what the conflict check compares.
 */
async function readFile(handle: FileSystemFileHandle) {
  const file = await handle.getFile();
  return { bytes: new Uint8Array(await file.arrayBuffer()), modified: file.lastModified };
}

function linkOf(handle: PermittedHandle): FolderLink {
  const dir = handle as FileSystemDirectoryHandle;
  const fileHandle = async (name: string, create = false) => {
    try {
      return await dir.getFileHandle(name, { create });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'NotFoundError') return undefined;
      throw error;
    }
  };
  return {
    name: handle.name,
    async permission() {
      // OPFS handles (what the e2e stub links) have no permission methods at
      // all; a handle we can already write needs no permission.
      if (!handle.queryPermission) return 'granted';
      return handle.queryPermission({ mode: 'readwrite' });
    },
    async request() {
      const state = await handle.requestPermission?.({ mode: 'readwrite' });
      return state === 'granted';
    },
    async list() {
      const files: FolderFile[] = [];
      // `entries()`, not `values()`: the names come with the entries.
      for await (const [name, entry] of entriesOf(dir)) {
        if (entry.kind !== 'file' || !name.endsWith(FILE_EXTENSION)) continue;
        const file = await (entry as FileSystemFileHandle).getFile();
        files.push({ name, modified: file.lastModified, size: file.size });
      }
      return files.sort((a, b) => b.modified - a.modified || a.name.localeCompare(b.name));
    },
    async read(name) {
      const handle = await fileHandle(name);
      if (!handle) throw new LinkedFileError(`${name} isn't in ${dir.name} any more.`);
      return readFile(handle);
    },
    async write(name, bytes) {
      const handle = await fileHandle(name, true);
      if (!handle) throw new LinkedFileError(`Couldn't write ${name} in ${dir.name}.`);
      const writable = await handle.createWritable();
      try {
        await writable.write(bytes as Uint8Array<ArrayBuffer>);
      } finally {
        await writable.close();
      }
      return { modified: (await handle.getFile()).lastModified };
    },
  };
}

/** The web implementation, over the File System Access API and the handle store. */
export function webFolders(handles: HandleStore): LinkedFolders {
  return {
    async link() {
      const show = picker();
      if (!show) return undefined;
      let handle: PermittedHandle;
      try {
        handle = await show({ mode: 'readwrite', id: 'extrudo' });
      } catch {
        // The picker was cancelled (or blocked): no link, no change.
        return undefined;
      }
      if (!isDirectory(handle)) return undefined;
      await handles.put(handle);
      return linkOf(handle);
    },
    async current() {
      const stored = await handles.get();
      return isDirectory(stored) ? linkOf(stored as PermittedHandle) : undefined;
    },
    async unlink() {
      await handles.delete();
    },
  };
}
