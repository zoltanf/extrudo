// The plugin store's bridge in main (P6-03 slice 2): the whitelist, the
// argument checks and the errors as data, against a memory store.
import { createPluginStore, memoryFiles, writePluginFile } from '@extrudo/storage';
import { describe, expect, it } from 'vitest';
import { pluginCall } from './plugin-call';

const bytes = writePluginFile({
  manifest: {
    id: 'tiny',
    name: 'Tiny',
    version: '1.0.0',
    description: 'A box.',
    author: 'Someone',
    license: 'MIT',
    main: 'main.ts',
  },
  code: 'export const commands = {};\n',
});

describe('pluginCall', () => {
  it('passes the whitelisted methods through', async () => {
    const store = createPluginStore(memoryFiles());
    expect(await pluginCall(store, 'install', [bytes])).toMatchObject({ id: 'tiny' });
    expect(await pluginCall(store, 'list', [])).toMatchObject([{ id: 'tiny', enabled: true }]);
    expect(await pluginCall(store, 'setEnabled', ['tiny', false])).toMatchObject({
      enabled: false,
    });
    expect(await pluginCall(store, 'bytes', ['tiny'])).toEqual(bytes);
    expect(await pluginCall(store, 'read', ['tiny'])).toMatchObject({ manifest: { id: 'tiny' } });
    expect(await pluginCall(store, 'remove', ['tiny'])).toBeUndefined();
  });

  it('refuses another method and wrong arguments, as error data', async () => {
    const store = createPluginStore(memoryFiles());
    expect(await pluginCall(store, 'eval' as never, [])).toEqual({
      error: { name: 'Error', message: 'Unknown plugin method: eval' },
    });
    expect(await pluginCall(store, 'install', ['not bytes'])).toMatchObject({
      error: { name: 'TypeError', message: 'A plugin file must be bytes.' },
    });
    expect(await pluginCall(store, 'setEnabled', ['tiny', 'yes'])).toMatchObject({
      error: { name: 'TypeError' },
    });
    expect(await pluginCall(store, 'read', [{ id: 'tiny' }])).toMatchObject({
      error: { name: 'TypeError', message: 'A plugin ID must be a string.' },
    });
  });

  it("returns a store's refusal with its class name and words", async () => {
    const store = createPluginStore(memoryFiles());
    await pluginCall(store, 'install', [bytes]);
    expect(await pluginCall(store, 'install', [bytes])).toEqual({
      error: {
        name: 'PluginStoreError',
        message: 'Tiny 1.0.0 is already installed; this file is the same version, 1.0.0.',
      },
    });
    expect(await pluginCall(store, 'install', [new Uint8Array([1])])).toMatchObject({
      error: { name: 'PluginFileError' },
    });
  });
});
