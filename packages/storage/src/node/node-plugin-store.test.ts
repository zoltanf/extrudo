// The desktop's installed plugins (P6-03 slice 2): the plugin store over real
// files in a temp directory, with the index written atomically.
import { existsSync } from 'node:fs';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { writePluginFile } from '../plugin-file';
import { createNodePluginStore, nodePluginIndex } from './index';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'extrudo-plugins-'));
  dirs.push(dir);
  return dir;
}

const file = (version: string) =>
  writePluginFile({
    manifest: {
      id: 'tiny',
      name: 'Tiny',
      version,
      description: 'A box.',
      author: 'Someone',
      license: 'MIT',
      main: 'main.ts',
      commands: [{ id: 'box', label: 'Box' }],
    },
    code: 'export const commands = {};\n',
  });

describe('createNodePluginStore', () => {
  it('keeps plugins under <dir>/plugins, and a second store reads them back', async () => {
    const dir = await tempDir();
    const store = createNodePluginStore(dir);
    await store.install(file('1.0.0'));
    expect(existsSync(join(dir, 'plugins', 'tiny', 'plugin.extrudo-plugin'))).toBe(true);
    const index = JSON.parse(await readFile(join(dir, 'plugins', 'index.json'), 'utf8'));
    expect(index.plugins.map((p: { id: string }) => p.id)).toEqual(['tiny']);
    await store.install(file('1.1.0'));
    const again = createNodePluginStore(dir);
    expect((await again.read('tiny')).manifest.version).toBe('1.1.0');
    await again.remove('tiny');
    expect(await readdir(join(dir, 'plugins'))).toEqual(['index.json']);
  });

  it('leaves the old index whole when a write fails before its rename', async () => {
    const dir = await tempDir();
    const path = join(dir, 'plugins', 'index.json');
    await createNodePluginStore(dir).install(file('1.0.0'));
    const before = await readFile(path, 'utf8');
    const index = nodePluginIndex(path, {
      beforeRename() {
        throw new Error('crash');
      },
    });
    await expect(index.write('{"next":9,"plugins":[]}')).rejects.toThrow('crash');
    expect(await readFile(path, 'utf8')).toBe(before);
    expect(await index.read()).toBe(before);
  });
});
