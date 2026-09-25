/**
 * Byte storage under slash-separated paths ("projects/<id>/document.json").
 * The project store keeps documents and thumbnails here: in OPFS in the
 * browser, in IndexedDB where OPFS isn't available, in memory in tests.
 */
export interface FileStore {
  /** The file's bytes, or `undefined` if there is no such file. */
  read(path: string): Promise<Uint8Array | undefined>;
  /** Writes a whole file, creating folders as needed. */
  write(path: string, data: Uint8Array): Promise<void>;
  /** Removes a file, or a folder and everything in it. Missing paths are fine. */
  remove(path: string): Promise<void>;
}

/** In-memory files, for tests and Node. */
export function memoryFiles(): FileStore & { paths(): string[] } {
  const files = new Map<string, Uint8Array>();
  return {
    async read(path) {
      const data = files.get(path);
      return data ? data.slice() : undefined;
    },
    async write(path, data) {
      files.set(path, data.slice());
    },
    async remove(path) {
      for (const key of [...files.keys()]) {
        if (key === path || key.startsWith(`${path}/`)) files.delete(key);
      }
    },
    paths: () => [...files.keys()].sort(),
  };
}

const isNotFound = (error: unknown) =>
  error instanceof DOMException &&
  (error.name === 'NotFoundError' || error.name === 'TypeMismatchError');

/**
 * Files in the Origin Private File System. `createWritable` writes to a swap
 * file and replaces the original on `close()`, so a crash mid-write leaves
 * the old file intact.
 */
export function opfsFiles(root: FileSystemDirectoryHandle): FileStore {
  const split = (path: string) => {
    const parts = path.split('/').filter(Boolean);
    const name = parts.pop();
    if (!name) throw new Error(`Bad path: ${path}`);
    return { folders: parts, name };
  };
  const folder = async (parts: string[], create: boolean) => {
    let dir = root;
    for (const part of parts) dir = await dir.getDirectoryHandle(part, { create });
    return dir;
  };
  return {
    async read(path) {
      const { folders, name } = split(path);
      try {
        const handle = await (await folder(folders, false)).getFileHandle(name);
        return new Uint8Array(await (await handle.getFile()).arrayBuffer());
      } catch (error) {
        if (isNotFound(error)) return undefined;
        throw error;
      }
    },
    async write(path, data) {
      const { folders, name } = split(path);
      const handle = await (await folder(folders, true)).getFileHandle(name, { create: true });
      const writable = await handle.createWritable();
      try {
        await writable.write(data as Uint8Array<ArrayBuffer>);
        await writable.close();
      } catch (error) {
        await writable.abort().catch(() => {});
        throw error;
      }
    },
    async remove(path) {
      const { folders, name } = split(path);
      try {
        await (await folder(folders, false)).removeEntry(name, { recursive: true });
      } catch (error) {
        if (!isNotFound(error)) throw error;
      }
    },
  };
}
