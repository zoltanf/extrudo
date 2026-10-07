// Running a plugin command (P6-03 slice 2, ADR-0077 §5): the features the
// worker gives back go in at the timeline marker as one undo step, re-minted.
import {
  createDocument,
  createDocumentStore,
  type Feature,
  type FeatureId,
  insertFeature,
} from '@extrudo/core';
import type { PluginCommandResult } from '@extrudo/kernel';
import { createPluginStore, memoryFiles, readPluginFile } from '@extrudo/storage';
import { describe, expect, it, vi } from 'vitest';
import type { PluginEntry } from './plugins';
import {
  insertCommandFeatures,
  type PluginCommand,
  type PluginCommandKernel,
  pluginCommands,
  runPluginCommand,
} from './runCommand';
import { pluginBytes } from './testing';

const feature = (id: string, type: string, name: string, inputs: Feature['inputs'] = {}) =>
  ({ id, type, name, suppressed: false, inputs }) as Feature;

/** Two features of a command, the second cutting the first's profile. */
const made = (): Feature[] => [
  feature('cmd.f1', 'sketch', 'Three holes › Sketch1', {
    plane: { kind: 'ref', refs: [{ kind: 'plane', id: 'origin:xy' }] },
  }),
  feature('cmd.f2', 'extrude', 'Three holes › Extrude1', {
    profiles: { kind: 'ref', refs: [{ kind: 'profile', id: 'cmd.f1/r1' }] },
    face: { kind: 'ref', refs: [{ kind: 'face', id: 'extrude:cmd.f2:cap:end' }] },
  }),
];

function design() {
  const store = createDocumentStore(createDocument({ name: 'D', now: '2026-10-07T00:00:00Z' }));
  for (const [id, type, name] of [
    ['A', 'sketch', 'Sketch1'],
    ['B', 'extrude', 'Extrude1'],
    ['C', 'fillet', 'Fillet1'],
  ] as const) {
    store.getState().dispatch(insertFeature({ feature: feature(id, type, name) }));
  }
  return store;
}

const counter = () => {
  let n = 0;
  return () => `new${++n}` as FeatureId;
};

describe('insertCommandFeatures', () => {
  it('inserts at the marker, in order, re-minted, as one named undo step', () => {
    const store = design();
    // Rolled back to after Extrude1: the features land before Fillet1.
    store.setState({ doc: { ...store.getState().doc, timelineMarker: 2 } });
    const outcome = insertCommandFeatures(store, made(), 'Name plate: Three holes', counter());
    expect(outcome).toEqual({
      ok: true,
      message: 'Name plate: Three holes: added 2 features.',
      ids: ['new1', 'new2'],
    });
    const { doc } = store.getState();
    expect(doc.features.map((f) => [f.id, f.name])).toEqual([
      ['A', 'Sketch1'],
      ['B', 'Extrude1'],
      ['new1', 'Sketch2'],
      ['new2', 'Extrude2'],
      ['C', 'Fillet1'],
    ]);
    expect(doc.timelineMarker).toBe(4);
    expect(doc.features[3]?.inputs.profiles).toEqual({
      kind: 'ref',
      refs: [{ kind: 'profile', id: 'new1/r1' }],
    });
    expect(doc.features[3]?.inputs.face).toEqual({
      kind: 'ref',
      refs: [{ kind: 'face', id: 'extrude:new2:cap:end' }],
    });
    expect(store.getState().undoLabel).toBe('Name plate: Three holes');
    store.getState().undo();
    expect(store.getState().doc.features.map((f) => f.id)).toEqual(['A', 'B', 'C']);
    expect(store.getState().doc.timelineMarker).toBe(2);
  });

  it('says a command that added nothing, and changes nothing', () => {
    const store = design();
    const before = store.getState().doc;
    expect(insertCommandFeatures(store, [], 'Tiny: Box')).toEqual({
      ok: true,
      message: 'Tiny: Box added nothing.',
      ids: [],
    });
    expect(store.getState().doc).toBe(before);
  });
});

describe('runPluginCommand', () => {
  const entry = async (): Promise<PluginEntry> => {
    const plugins = createPluginStore(memoryFiles());
    const plugin = await plugins.install(pluginBytes());
    return { plugin, file: readPluginFile(pluginBytes()) };
  };

  it("lists an enabled plugin's commands, namespaced, under the plugin's name", async () => {
    const tiny = await entry();
    expect(pluginCommands([tiny])).toEqual([
      expect.objectContaining({
        id: 'plugin:tiny:box',
        label: 'Small box',
        hint: 'A 1 mm cube',
        group: 'Plugins › Tiny',
        command: 'box',
      }),
    ]);
    expect(pluginCommands([{ ...tiny, plugin: { ...tiny.plugin, enabled: false } }])).toEqual([]);
  });

  it('asks the kernel with the selection and the bytes on demand, then inserts', async () => {
    const [command] = pluginCommands([await entry()]) as [PluginCommand];
    const store = design();
    const bytes = vi.fn(async () => new Uint8Array([1]));
    const kernel: PluginCommandKernel = {
      runPluginCommand: vi.fn(async (request): Promise<PluginCommandResult> => {
        await request.bytes();
        return { ok: true, features: made(), log: [] };
      }),
    };
    const selection = [{ kind: 'body' as const, id: 'B:0' }];
    const outcome = await runPluginCommand({
      command,
      kernel,
      plugins: { bytes },
      store,
      selection,
      ids: counter(),
    });
    expect(outcome).toMatchObject({ ok: true, message: 'Tiny: Small box: added 2 features.' });
    expect(kernel.runPluginCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        plugin: { id: 'tiny', name: 'Tiny', version: '1.0.0' },
        commandId: 'box',
        selection,
      }),
    );
    expect(bytes).toHaveBeenCalledWith('tiny');
    expect(store.getState().doc.features).toHaveLength(5);
  });

  it("words a failure with the plugin's name, and inserts nothing", async () => {
    const [command] = pluginCommands([await entry()]) as [PluginCommand];
    const store = design();
    const failing = (message: string): PluginCommandKernel => ({
      runPluginCommand: async () => ({ ok: false, error: { message, line: 3 }, log: [] }),
    });
    const run = (message: string) =>
      runPluginCommand({
        command,
        kernel: failing(message),
        plugins: { bytes: async () => new Uint8Array() },
        store,
        selection: [],
      });
    expect(await run('Tiny 1.0.0, main.ts line 3: boom')).toEqual({
      ok: false,
      message: 'Tiny 1.0.0, main.ts line 3: boom',
    });
    expect(await run("Scripts and plugins can't run here.")).toEqual({
      ok: false,
      message: "Tiny: Scripts and plugins can't run here.",
    });
    expect(store.getState().doc.features).toHaveLength(3);
  });
});
