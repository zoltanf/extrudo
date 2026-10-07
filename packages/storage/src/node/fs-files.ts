/**
 * Files on the real file system (P6-01, ADR-0075 §2): `FileStore` over
 * `<dir>/projects/<id>/…`, the same layout OPFS has (document, thumbnail,
 * versions, attachments). Paths are the slash-separated ones
 * `createProjectStore` builds ("projects/<id>/document.json"); the store
 * speaks to the operating system through them, so a Windows and a Linux build
 * keep the same logical layout.
 */
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { FileStore } from '../files';
import { StorageError } from '../types';

const isNotFound = (error: unknown) =>
  (error as NodeJS.ErrnoException).code === 'ENOENT' ||
  (error as NodeJS.ErrnoException).code === 'ENOTDIR' ||
  (error as NodeJS.ErrnoException).code === 'EISDIR';

export function nodeFiles(root: string): FileStore {
  /**
   * The absolute path `path` means under `root`, refusing anything that could
   * climb out (P6-01's review): every slash-separated segment must be an
   * ordinary name — not `.`/`..`, not empty, not absolute, no separator or NUL
   * — and the resolved result must stay under `root`. The store already
   * validates ids (`assertId`), so this is the second belt: a future caller
   * passing a raw path cannot escape either.
   */
  const full = (path: string): string => {
    const segments = path.split('/');
    const bad = segments.some(
      (segment) =>
        segment === '' ||
        segment === '.' ||
        segment === '..' ||
        segment.includes('\\') ||
        segment.includes('\0') ||
        isAbsolute(segment),
    );
    if (bad) throw new StorageError(path);
    const base = resolve(root);
    const target = join(base, ...segments);
    if (target !== base && !target.startsWith(base + sep)) throw new StorageError(path);
    return target;
  };
  return {
    async read(path) {
      try {
        return new Uint8Array(await readFile(full(path)));
      } catch (error) {
        if (isNotFound(error)) return undefined;
        throw error;
      }
    },
    async write(path, data) {
      const target = full(path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, data);
    },
    async remove(path) {
      await rm(full(path), { recursive: true, force: true });
    },
    async list(prefix) {
      const from = full(prefix);
      const out: string[] = [];
      const walk = async (dir: string): Promise<void> => {
        const entries = await readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          const child = join(dir, entry.name);
          if (entry.isDirectory()) await walk(child);
          else if (entry.isFile()) out.push(relative(resolve(root), child).split(sep).join('/'));
        }
      };
      try {
        await walk(from);
      } catch (error) {
        if (isNotFound(error)) return [];
        throw error;
      }
      return out.sort();
    },
  };
}
