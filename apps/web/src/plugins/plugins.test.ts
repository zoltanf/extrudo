// The installed plugins as session state (P6-03 slice 2): refreshed after every
// change, refusals in the status line, and the plugins a design carries.
import {
  type AttachmentId,
  applyCommand,
  createDocument,
  type FeatureId,
  insertFeature,
  pluginFeatureOf,
} from '@extrudo/core';
import { createPluginStore, memoryFiles } from '@extrudo/storage';
import { describe, expect, it } from 'vitest';
import { createPluginsStore, designPlugins, enabledPlugins } from './plugins';
import { pluginBytes } from './testing';

const setup = () => {
  const store = createPluginStore(memoryFiles());
  return { store, plugins: createPluginsStore(store) };
};

describe('createPluginsStore', () => {
  it('installs, reads each file and refreshes the list', async () => {
    const { plugins } = setup();
    expect(plugins.getState().installed).toBeUndefined();
    await plugins.getState().refresh();
    expect(plugins.getState().installed).toEqual([]);
    expect(await plugins.getState().install(pluginBytes())).toBe(true);
    const [entry] = plugins.getState().installed ?? [];
    expect(entry?.plugin).toMatchObject({ id: 'tiny', version: '1.0.0', enabled: true });
    expect(entry?.file?.manifest.commands[0]?.label).toBe('Small box');
    expect(plugins.getState()).toMatchObject({ status: 'Installed Tiny 1.0.0.', refused: false });
    expect(enabledPlugins(plugins.getState().installed)).toHaveLength(1);
  });

  it('says why a file is refused, and changes nothing', async () => {
    const { plugins } = setup();
    await plugins.getState().install(pluginBytes());
    expect(await plugins.getState().install(pluginBytes())).toBe(false);
    expect(plugins.getState()).toMatchObject({
      status: 'Tiny 1.0.0 is already installed; this file is the same version, 1.0.0.',
      refused: true,
    });
    expect(await plugins.getState().install(new Uint8Array([1, 2]))).toBe(false);
    expect(plugins.getState().status).toBe("This isn't a plugin file: it isn't a zip archive.");
    expect(plugins.getState().installed).toHaveLength(1);
  });

  it('disables (no longer offered), enables and removes', async () => {
    const { plugins } = setup();
    await plugins.getState().install(pluginBytes());
    const disabling = plugins.getState().setEnabled('tiny', false);
    // The list follows at once, before the store has written it.
    expect(plugins.getState().installed?.[0]?.plugin.enabled).toBe(false);
    await disabling;
    expect(plugins.getState().status).toBe('Disabled Tiny.');
    expect(enabledPlugins(plugins.getState().installed)).toEqual([]);
    await plugins.getState().setEnabled('tiny', true);
    expect(enabledPlugins(plugins.getState().installed)).toHaveLength(1);
    await plugins.getState().remove('tiny');
    expect(plugins.getState()).toMatchObject({ installed: [], status: 'Removed Tiny.' });
  });
});

describe('designPlugins', () => {
  const docWith = (attachments: AttachmentId[]) => {
    let doc = createDocument({ name: 'D', now: '2026-10-07T00:00:00.000Z' });
    attachments.forEach((plugin, i) => {
      doc = applyCommand(
        doc,
        insertFeature({
          feature: pluginFeatureOf(`f${i}` as FeatureId, `Peg${i + 1}`, {
            plugin,
            handler: 'peg',
          }),
        }),
      ).doc;
    });
    return doc;
  };
  const a = 'a' as AttachmentId;
  const b = 'b' as AttachmentId;

  it("lists a design's plugin that isn't installed, its newest version once", async () => {
    const files = new Map([
      [a, pluginBytes('1.0.0')],
      [b, pluginBytes('1.2.0')],
    ]);
    const found = await designPlugins(docWith([a, b, a]), [], async (id) => files.get(id));
    expect(found.map((p) => [p.attachment, p.manifest.version])).toEqual([[b, '1.2.0']]);
    expect(found[0]?.bytes).toEqual(files.get(b));
  });

  it('leaves out one that is installed, a missing file and a damaged one', async () => {
    const { store } = setup();
    const installed = [await store.install(pluginBytes('0.1.0'))];
    const files = new Map([[a, pluginBytes('1.0.0')]]);
    expect(await designPlugins(docWith([a]), installed, async (id) => files.get(id))).toEqual([]);
    expect(await designPlugins(docWith([a]), [], async () => undefined)).toEqual([]);
    expect(await designPlugins(docWith([a]), [], async () => new Uint8Array([9]))).toEqual([]);
  });
});
