/**
 * Recent files (P6-01 slice 2, ADR-0075 §2): the Open Recent submenu's list and
 * the OS's own recent-documents list. One JSON file under `userData`, at most
 * `MAX_RECENT` paths, most recent first, deduplicated. A path that is gone is
 * dropped when the list is read, so a deleted file never shows in the menu. It
 * is small and read on demand, so writes are synchronous.
 *
 * Free of Electron, so it is unit-tested over a temp file.
 */
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { basename, dirname } from 'node:path';
import type { RecentEntry } from '../shared/ipc';

export const MAX_RECENT = 10;

interface StoredEntry {
  path: string;
  at: number;
}

export interface RecentFile {
  /** The existing paths, most recent first. */
  list(): RecentEntry[];
  /** Adds or moves a path to the front. */
  add(path: string, at?: number): void;
  /** Drops a path (an unreadable file). */
  remove(path: string): void;
  clear(): void;
}

function readEntries(file: string): StoredEntry[] {
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      !Array.isArray((parsed as { files?: unknown }).files)
    ) {
      return [];
    }
    return (parsed as { files: unknown[] }).files.filter(
      (entry): entry is StoredEntry =>
        !!entry && typeof entry === 'object' && typeof (entry as StoredEntry).path === 'string',
    );
  } catch {
    // Missing or damaged: the list is a convenience, start empty.
    return [];
  }
}

function writeEntries(file: string, entries: StoredEntry[]): void {
  mkdirSync(dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  // Write and flush the temp file, then rename: the rename is the commit, and
  // a partial file must never replace the old one (slice 1's writers; P6-01
  // slice 2, finding 6).
  const handle = openSync(temp, 'w');
  try {
    writeSync(handle, `${JSON.stringify({ files: entries }, null, 2)}\n`);
    fsyncSync(handle);
  } finally {
    closeSync(handle);
  }
  try {
    renameSync(temp, file);
  } catch (error) {
    try {
      unlinkSync(temp);
    } catch {
      // Already gone.
    }
    throw error;
  }
}

export function createRecentFile(file: string): RecentFile {
  let entries = readEntries(file);

  const persist = () => writeEntries(file, entries);

  return {
    list() {
      // Missing files drop out of the stored list too, so the menu and the file
      // stay in step (the list is rewritten only when something was dropped).
      const alive = entries.filter((entry) => existsSync(entry.path));
      if (alive.length !== entries.length) {
        entries = alive;
        try {
          persist();
        } catch {
          // A failed cleanup must not break listing.
        }
      }
      return alive.map((entry) => ({ path: entry.path, name: basename(entry.path) }));
    },
    add(path, at = Date.now()) {
      entries = [{ path, at }, ...entries.filter((entry) => entry.path !== path)].slice(
        0,
        MAX_RECENT,
      );
      persist();
    },
    remove(path) {
      const next = entries.filter((entry) => entry.path !== path);
      if (next.length === entries.length) return;
      entries = next;
      persist();
    },
    clear() {
      entries = [];
      persist();
    },
  };
}
