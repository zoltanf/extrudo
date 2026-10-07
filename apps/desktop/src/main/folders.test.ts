import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createFolders } from './folders';

const dirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'extrudo-folders-'));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('the linked folder over a temp directory (P6-01 review)', () => {
  it('lists only .extrudo files and reads and writes them', async () => {
    const root = await tempDir();
    const folder = join(root, 'Models');
    await mkdir(folder, { recursive: true });
    await mkdir(join(folder, 'sub'));
    await writeFile(join(folder, 'Bracket.extrudo'), 'bytes');
    await writeFile(join(folder, 'notes.txt'), 'no');
    await writeFile(join(folder, 'sub', 'Nested.extrudo'), 'no');

    const folders = createFolders(join(root, 'link.json'));
    expect(folders.permission()).toBe('granted');
    expect(folders.current()).toBeUndefined();
    folders.set(folder);
    expect(folders.current()).toEqual({ name: 'Models' });
    expect(folders.permission()).toBe('granted');
    expect(folders.list().map((file) => file.name)).toEqual(['Bracket.extrudo']);
    expect(new TextDecoder().decode(folders.read('Bracket.extrudo').bytes)).toBe('bytes');

    const written = folders.write('Other.extrudo', new Uint8Array([1, 2]));
    expect(written.modified).toBeGreaterThan(0);
    expect(
      folders
        .list()
        .map((file) => file.name)
        .sort(),
    ).toEqual(['Bracket.extrudo', 'Other.extrudo']);
  });

  it('refuses a name that is not an .extrudo file, and neutralises a path', async () => {
    const root = await tempDir();
    const folder = join(root, 'Models');
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, 'Bracket.extrudo'), 'inside');
    const folders = createFolders(join(root, 'link.json'));
    folders.set(folder);

    expect(() => folders.read('secrets.txt')).toThrow('Bad file name');
    expect(() => folders.read('.')).toThrow('Bad file name');
    expect(() => folders.write('notes.txt', new Uint8Array())).toThrow('Bad file name');
    // A path is reduced to its base name, so it stays inside the folder.
    expect(new TextDecoder().decode(folders.read('../Bracket.extrudo').bytes)).toBe('inside');
  });

  it('reports a folder that is gone as denied and refuses its files', async () => {
    const root = await tempDir();
    const folder = join(root, 'Models');
    await mkdir(folder);
    const folders = createFolders(join(root, 'link.json'));
    folders.set(folder);
    await rm(folder, { recursive: true, force: true });
    expect(folders.permission()).toBe('denied');
    expect(folders.current()).toBeUndefined();
    expect(() => folders.list()).toThrow('No folder is linked');
  });
});
