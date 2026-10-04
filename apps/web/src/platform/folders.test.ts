import type { HandleStore } from '@extrudo/storage';
import { memoryHandles } from '@extrudo/storage';
import { afterEach, describe, expect, it } from 'vitest';
import { type FolderFile, folderAccess, LinkedFileError, webFolders } from './folders';

/** A directory handle of our own, since Node has none: files in a Map. */
function fakeDirectory(files: Map<string, Uint8Array> = new Map(), name = 'Designs') {
  const written: Record<string, number> = {};
  let permission: PermissionState = 'granted';
  let request: PermissionState = 'granted';
  const notFound = (fileName: string) => new DOMException(`${fileName} not found`, 'NotFoundError');
  const file = (fileName: string, bytes: Uint8Array) => ({
    kind: 'file' as const,
    name: fileName,
    async getFile() {
      const data = files.get(fileName) ?? bytes;
      return {
        arrayBuffer: async () => data.buffer,
        size: data.length,
        lastModified: written[fileName] ?? 1_000,
      };
    },
    async createWritable() {
      let chunk = new Uint8Array<ArrayBuffer>(new ArrayBuffer(0));
      return {
        write: async (next: Uint8Array<ArrayBuffer>) => {
          chunk = next;
        },
        close: async () => {
          files.set(fileName, chunk);
          // A real file system moves its own clock on.
          written[fileName] = (written[fileName] ?? 1_000) + 10;
        },
      };
    },
  });
  const directory = {
    kind: 'directory' as const,
    name,
    // Only files are listed, and a sub-folder is not one. `values()` yields the
    // entries alone, as a real handle does; the app reads `entries()`.
    async *entries() {
      yield [name, directory];
      yield ['notes.txt', file('notes.txt', new Uint8Array([104, 105]))];
      for (const [fileName, bytes] of files) yield [fileName, file(fileName, bytes)];
    },
    async getFileHandle(fileName: string, options?: { create?: boolean }) {
      if (!files.has(fileName) && !options?.create) throw notFound(fileName);
      if (!files.has(fileName)) files.set(fileName, new Uint8Array());
      return file(fileName, files.get(fileName) as Uint8Array);
    },
    queryPermission: async () => permission,
    requestPermission: async () => {
      permission = request;
      return request;
    },
  };
  return {
    directory: directory as unknown as FileSystemDirectoryHandle & {
      queryPermission(): Promise<PermissionState>;
      requestPermission(): Promise<PermissionState>;
    },
    files,
    setPermission(state: PermissionState) {
      permission = state;
    },
    setRequest(state: PermissionState) {
      request = state;
    },
  };
}

const pickerOf = (value: unknown) => {
  Object.assign(globalThis, { showDirectoryPicker: value });
};

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'showDirectoryPicker');
});

const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

describe('webFolders (P4-09, ADR-0065 §3)', () => {
  it('says there is no folder access without the picker', () => {
    expect(folderAccess()).toBe(false);
    pickerOf(() => {});
    expect(folderAccess()).toBe(true);
  });

  it('links a folder, keeps its handle and finds it again', async () => {
    const folder = fakeDirectory();
    pickerOf(async () => folder.directory);
    const handles = memoryHandles();
    const folders = webFolders(handles);

    const link = await folders.link();
    expect(link?.name).toBe('Designs');
    expect(await handles.get()).toBeDefined();
    const again = await folders.current();
    expect(again?.name).toBe('Designs');

    await folders.unlink();
    expect(await folders.current()).toBeUndefined();
  });

  it('links nothing when the picker is cancelled', async () => {
    pickerOf(async () => {
      throw new DOMException('The user aborted a request.', 'AbortError');
    });
    const handles: HandleStore = memoryHandles();
    expect(await webFolders(handles).link()).toBeUndefined();
    expect(await handles.get()).toBeUndefined();
  });

  it('lists the .extrudo files at the top level, newest first', async () => {
    const folder = fakeDirectory(
      new Map([
        ['Bracket.extrudo', new Uint8Array([1, 2])],
        ['b2.extrudo', new Uint8Array([3])],
      ]),
    );
    pickerOf(async () => folder.directory);
    const link = await webFolders(memoryHandles()).link();
    // Writing a file moves its own clock, so it is the newest.
    await link?.write('b2.extrudo', new Uint8Array([4, 5, 6]));
    const listed: FolderFile[] = (await link?.list()) ?? [];
    // notes.txt is not an Extrudo file, and a sub-folder is not a file.
    expect(listed.map((f) => f.name)).toEqual(['b2.extrudo', 'Bracket.extrudo']);
    expect(listed[0]).toMatchObject({ size: 3, modified: 1_010 });
    expect(listed[1]).toMatchObject({ size: 2, modified: 1_000 });
  });

  it('writes a file and reads back what the file says it was written', async () => {
    const folder = fakeDirectory();
    pickerOf(async () => folder.directory);
    const link = await webFolders(memoryHandles()).link();

    const written = await link?.write('Bracket.extrudo', new Uint8Array([7, 8, 9]));
    expect(written?.modified).toBe(1_010);
    expect(text((await link?.read('Bracket.extrudo'))?.bytes ?? new Uint8Array())).toBe(
      String.fromCharCode(7, 8, 9),
    );
    expect(folder.files.has('Bracket.extrudo')).toBe(true);
  });

  it('says a file that is not there is not there', async () => {
    pickerOf(async () => fakeDirectory().directory);
    const link = await webFolders(memoryHandles()).link();
    await expect(link?.read('Gone.extrudo')).rejects.toThrow(LinkedFileError);
  });

  it('reports the permission, and asks for it again from a click', async () => {
    const folder = fakeDirectory();
    pickerOf(async () => folder.directory);
    const link = await webFolders(memoryHandles()).link();
    expect(await link?.permission()).toBe('granted');
    folder.setPermission('prompt');
    expect(await link?.permission()).toBe('prompt');
    folder.setRequest('granted');
    expect(await link?.request()).toBe(true);
    folder.setRequest('denied');
    expect(await link?.request()).toBe(false);
  });

  it('treats a handle with no permission methods as granted (OPFS)', async () => {
    const directory = fakeDirectory().directory as unknown as Record<string, unknown>;
    delete directory.queryPermission;
    pickerOf(async () => fakeDirectory().directory);
    const handles = memoryHandles();
    await handles.put(directory);
    const link = await webFolders(handles).current();
    expect(await link?.permission()).toBe('granted');
  });
});
