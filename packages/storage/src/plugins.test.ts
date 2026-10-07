// Installed plugins (P6-03 slice 2, ADR-0077 §4): the person's store of plugin
// files and its index, over the same `FileStore` the projects use.
import { PluginManifestError } from '@extrudo/core';
import { describe, expect, it } from 'vitest';
import { memoryFiles } from './files';
import { PluginFileError, writePluginFile } from './plugin-file';
import { createPluginStore, PluginStoreError, pluginPath } from './plugins';
import { sha256Hex } from './sha256';

const manifest = (version: string, extra: Record<string, unknown> = {}) => ({
  id: 'tiny',
  name: 'Tiny',
  version,
  description: 'A box.',
  author: 'Someone',
  license: 'MIT',
  main: 'main.ts',
  commands: [{ id: 'box', label: 'Box' }],
  ...extra,
});
const CODE = "export const commands = { box: (design) => design.box({ length: '1 mm' }) };\n";
const file = (version: string, extra?: Record<string, unknown>) =>
  writePluginFile({
    manifest: manifest(version, extra),
    code: CODE,
    readme: `# Tiny ${version}\n`,
  });

function setup() {
  const files = memoryFiles();
  let clock = Date.parse('2026-10-07T10:00:00.000Z');
  const store = createPluginStore(files, undefined, {
    now: () => {
      clock += 1000;
      return new Date(clock);
    },
  });
  return { files, store };
}

describe('PluginStore', () => {
  it('installs a file: the bytes under plugins/<id>/, the index beside them', async () => {
    const { files, store } = setup();
    const bytes = file('1.0.0');
    const installed = await store.install(bytes);
    expect(installed).toEqual({
      id: 'tiny',
      name: 'Tiny',
      version: '1.0.0',
      enabled: true,
      installedAt: '2026-10-07T10:00:01.000Z',
      sha256: sha256Hex(bytes),
    });
    expect(files.paths()).toEqual(['plugins/index.json', pluginPath('tiny')]);
    expect(await store.list()).toEqual([installed]);
    expect(await store.bytes('tiny')).toEqual(bytes);
    const read = await store.read('tiny');
    expect(read.manifest.commands).toEqual([{ id: 'box', label: 'Box' }]);
    expect(read.readme).toBe('# Tiny 1.0.0\n');
    const index = JSON.parse(new TextDecoder().decode(await files.read('plugins/index.json')));
    expect(index).toEqual({ next: 2, plugins: [installed] });
  });

  it('upgrades an older version in place, keeping whether it was enabled', async () => {
    const { store } = setup();
    await store.install(file('1.0.0'));
    await store.setEnabled('tiny', false);
    const upgraded = await store.install(file('1.1.0'));
    expect(upgraded).toMatchObject({ version: '1.1.0', enabled: false });
    expect(await store.list()).toEqual([upgraded]);
    expect((await store.read('tiny')).readme).toBe('# Tiny 1.1.0\n');
  });

  it('refuses the same version, and an older one, naming both', async () => {
    const { store } = setup();
    await store.install(file('1.2.0'));
    await expect(store.install(file('1.2.0'))).rejects.toThrow(
      new PluginStoreError(
        'Tiny 1.2.0 is already installed; this file is the same version, 1.2.0.',
      ),
    );
    await expect(store.install(file('1.1.9'))).rejects.toThrow(
      "Tiny 1.2.0 is installed, which is newer than this file's 1.1.9.",
    );
    expect((await store.list()).map((p) => p.version)).toEqual(['1.2.0']);
  });

  it('removes a plugin, the index first, then its folder', async () => {
    const { files, store } = setup();
    await store.install(file('1.0.0'));
    await store.install(file('1.0.0', { id: 'other', name: 'Other' }));
    await store.remove('tiny');
    expect((await store.list()).map((p) => p.id)).toEqual(['other']);
    expect(files.paths()).toEqual(['plugins/index.json', pluginPath('other')]);
    await store.remove('tiny');
    await store.remove('../escape');
    await expect(store.bytes('tiny')).rejects.toThrow('The plugin "tiny" isn\'t installed.');
  });

  it('enables and disables', async () => {
    const { store } = setup();
    await store.install(file('1.0.0'));
    expect(await store.setEnabled('tiny', false)).toMatchObject({ enabled: false });
    expect((await store.list())[0]?.enabled).toBe(false);
    expect(await store.setEnabled('tiny', true)).toMatchObject({ enabled: true });
    await expect(store.setEnabled('nope', true)).rejects.toThrow(PluginStoreError);
  });

  it("refuses a corrupt file with the reader's words, and stores nothing", async () => {
    const { files, store } = setup();
    await expect(store.install(new Uint8Array([1, 2, 3]))).rejects.toThrow(
      new PluginFileError("This isn't a plugin file: it isn't a zip archive."),
    );
    await expect(store.install(file('1.0', {}))).rejects.toThrow(PluginManifestError);
    expect(files.paths()).toEqual([]);
  });

  it('says a file whose bytes changed under it is damaged', async () => {
    const { files, store } = setup();
    await store.install(file('1.0.0'));
    await files.write(pluginPath('tiny'), file('9.0.0'));
    await expect(store.read('tiny')).rejects.toThrow(
      'The plugin Tiny 1.0.0 is damaged: install it again.',
    );
  });

  it('keeps its index across a reload, and reads a damaged index as empty', async () => {
    const { files, store } = setup();
    await store.install(file('1.0.0'));
    await store.setEnabled('tiny', false);
    const again = createPluginStore(files);
    expect(await again.list()).toEqual(await store.list());
    expect((await again.read('tiny')).manifest.version).toBe('1.0.0');
    await files.write('plugins/index.json', new TextEncoder().encode('{ not json'));
    expect(await createPluginStore(files).list()).toEqual([]);
  });

  it('serialises installs: two at once both land in the index', async () => {
    const { store } = setup();
    await Promise.all([
      store.install(file('1.0.0')),
      store.install(file('1.0.0', { id: 'other', name: 'Other' })),
    ]);
    expect((await store.list()).map((p) => p.id).sort()).toEqual(['other', 'tiny']);
  });
});
