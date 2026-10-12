/**
 * Writing back to a file main itself handed the renderer (P6-01 slice 2,
 * finding 3). Opening a `.extrudo` from a path (Open…, the association, Open
 * Recent) or Save-As'ing to one links the project to that real file, not to a
 * file in the linked folder. The renderer writes it back through these
 * methods, but **only for a path main issued this session**: a compromised
 * renderer cannot name an arbitrary path to read or write, because `issue` is
 * called from exactly the two places main chooses a path — `deliverOpen` and
 * `savedFile` — and `ensure` refuses anything else.
 *
 * The project keeps its link across restarts, so main keeps the paths too: in
 * a file of its own under `userData` that only `issue` writes (a project
 * reopened from the home screen after a restart was refused on every save,
 * 2026-10-12). Main also issues the paths in its recent list at start, which
 * covers the links made before the file existed.
 *
 * Free of Electron, so it is unit-tested over a temp directory.
 */
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeSync,
} from 'node:fs';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { StorageError } from '@extrudo/storage';

const REFUSED = 'Extrudo was not asked to open that file.';

/** The most paths kept on disk; the oldest go first. */
export const MAX_EXTERNAL_PATHS = 500;

/** The set of paths main handed to the renderer. */
export interface ExternalPaths {
  /** Records a path main itself chose (deliverOpen, Save As…, the recent list). */
  issue(path: string): void;
  /** Whether main handed this path out. */
  issued(path: string): boolean;
}

function readPaths(file: string): string[] {
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    const paths = (parsed as { paths?: unknown } | null)?.paths;
    return Array.isArray(paths) ? paths.filter((p): p is string => typeof p === 'string') : [];
  } catch {
    // Missing or damaged: start empty, as before the file existed.
    return [];
  }
}

function writePaths(file: string, paths: readonly string[]): void {
  mkdirSync(dirname(file), { recursive: true });
  // Temp file, flushed, then renamed: a partial file never replaces the old one.
  const temp = `${file}.tmp`;
  const handle = openSync(temp, 'w');
  try {
    writeSync(handle, `${JSON.stringify({ paths }, null, 2)}\n`);
    fsyncSync(handle);
  } finally {
    closeSync(handle);
  }
  renameSync(temp, file);
}

/**
 * The issued paths, kept in `file` when one is given (main passes
 * `userData/external-paths.json`); without one they last the session.
 */
export function createExternalPaths(file?: string): ExternalPaths {
  // Insertion order is age: a re-issued path moves to the end.
  const issued = new Set<string>(file ? readPaths(file) : []);
  return {
    issue(path) {
      if (!path) return;
      issued.delete(path);
      issued.add(path);
      while (issued.size > MAX_EXTERNAL_PATHS) {
        issued.delete(issued.values().next().value as string);
      }
      if (!file) return;
      try {
        writePaths(file, [...issued]);
      } catch {
        // Keeping the path for later sessions is a convenience: this one works.
      }
    },
    issued: (path) => issued.has(path),
  };
}

export interface ExternalFiles {
  /** Writes the bytes to an issued path and answers its new mtime. */
  write(path: string, bytes: Uint8Array): Promise<{ modified: number }>;
  /** An issued path's mtime, or `undefined` when it isn't there. */
  stat(path: string): Promise<{ modified: number } | undefined>;
  /** An issued path's bytes and mtime. */
  read(path: string): Promise<{ bytes: Uint8Array; modified: number }>;
}

export function createExternalFiles(paths: ExternalPaths): ExternalFiles {
  const ensure = (path: string): void => {
    if (!paths.issued(path)) throw new StorageError(path, REFUSED);
  };
  return {
    async write(path, bytes) {
      ensure(path);
      await writeFile(path, bytes);
      const info = await stat(path);
      return { modified: info.mtimeMs };
    },
    async stat(path) {
      ensure(path);
      try {
        const info = await stat(path);
        return { modified: info.mtimeMs };
      } catch {
        // A removed file is "not on disk", not an error: the conflict check
        // reads `undefined` the same way a missing folder file.
        return undefined;
      }
    },
    async read(path) {
      ensure(path);
      const [bytes, info] = await Promise.all([readFile(path), stat(path)]);
      return { bytes: new Uint8Array(bytes), modified: info.mtimeMs };
    },
  };
}
