/**
 * ADR-0065 §3's linked folder over the real file system (P6-01, ADR-0075 §3).
 * One folder at a time, its path kept in a small JSON file under `userData`.
 * The native picker lives in the IPC layer; this module does the bytes: list
 * the `.extrudo` files, read one, write one. Permission is always granted once
 * a folder is picked (there is no browser permission prompt on the desktop).
 * Free of Electron, so the file operations are unit-tested over a temp folder.
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { FILE_EXTENSION } from '@extrudo/core';
import type { FolderEntry, FolderPermission } from '../shared/ipc';

export interface Folders {
  /** Remembers the picked folder (or forgets it with `undefined`). */
  set(folder: string | undefined): void;
  /** The stored folder, if it still exists. */
  current(): { name: string } | undefined;
  unlink(): void;
  permission(): FolderPermission;
  list(): FolderEntry[];
  read(name: string): { bytes: Uint8Array; modified: number };
  write(name: string, bytes: Uint8Array): { modified: number };
}

function readFolder(file: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    const path = (parsed as { path?: unknown } | undefined)?.path;
    return typeof path === 'string' && path ? path : undefined;
  } catch {
    return undefined;
  }
}

function writeFolder(file: string, folder: string | undefined): void {
  mkdirSync(dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  writeFileSync(temp, `${JSON.stringify(folder ? { path: folder } : {})}\n`, 'utf8');
  renameSync(temp, file);
}

/**
 * A file name inside the folder: no separators, no climbing out, and only an
 * `.extrudo` file — the linked folder holds the app's own designs, and a
 * compromised renderer must not read or overwrite anything else in it
 * (P6-01's review).
 */
function safeName(name: string): string {
  const clean = basename(name);
  if (!clean || clean === '.' || clean === '..' || !clean.endsWith(FILE_EXTENSION))
    throw new Error(`Bad file name: ${name}`);
  return clean;
}

export function createFolders(file: string): Folders {
  let folder = readFolder(file);
  const present = () => !!folder && existsSync(folder);
  return {
    set(next) {
      folder = next;
      writeFolder(file, next);
    },
    current() {
      return present() && folder ? { name: basename(folder) } : undefined;
    },
    unlink() {
      folder = undefined;
      writeFolder(file, undefined);
    },
    permission() {
      return present() ? 'granted' : folder ? 'denied' : 'granted';
    },
    list() {
      if (!present() || !folder) throw new Error('No folder is linked.');
      return readdirSync(folder)
        .filter((name) => name.endsWith(FILE_EXTENSION))
        .map((name) => {
          const stats = statSync(join(folder as string, name));
          return { name, modified: stats.mtimeMs, size: stats.size };
        })
        .sort((a, b) => b.modified - a.modified || a.name.localeCompare(b.name));
    },
    read(name) {
      if (!present() || !folder) throw new Error('No folder is linked.');
      const path = join(folder, safeName(name));
      const stats = statSync(path);
      return { bytes: new Uint8Array(readFileSync(path)), modified: stats.mtimeMs };
    },
    write(name, bytes) {
      if (!present() || !folder) throw new Error('No folder is linked.');
      const path = join(folder, safeName(name));
      writeFileSync(path, bytes);
      return { modified: statSync(path).mtimeMs };
    },
  };
}
