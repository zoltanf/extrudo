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
 * Free of Electron, so it is unit-tested over a temp directory.
 */
import { readFile, stat, writeFile } from 'node:fs/promises';
import { StorageError } from '@extrudo/storage';

const REFUSED = 'Extrudo was not asked to open that file.';

/** The set of paths main handed to the renderer this session. */
export interface ExternalPaths {
  /** Records a path main itself chose (deliverOpen, Save As…). */
  issue(path: string): void;
  /** Whether main handed this path out. */
  issued(path: string): boolean;
}

export function createExternalPaths(): ExternalPaths {
  const issued = new Set<string>();
  return {
    issue(path) {
      if (path) issued.add(path);
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
