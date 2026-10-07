// "Update to <version>" (P6-03 slice 3, ADR-0077 §6): every feature of an older copy of an
// installed plugin points at the installed file, with the file's record, in one undo step.
import {
  type AttachmentId,
  addAttachment,
  createDocument,
  createDocumentStore,
  type FeatureId,
  insertFeature,
  newId,
  PLUGIN_MEDIA_TYPE,
  pluginFeatureOf,
} from '@extrudo/core';
import { sha256Hex } from '@extrudo/storage';
import { describe, expect, it } from 'vitest';
import { pluginBytes } from './testing';
import { updatePluginInDesign } from './update';

const plugin = { id: 'tiny', name: 'Tiny', version: '1.2.0' };

function setup() {
  const old = pluginBytes('1.0.0');
  const oldId = newId<AttachmentId>();
  const store = createDocumentStore(createDocument({ name: 'D', now: '2026-10-07T00:00:00.000Z' }));
  store.getState().dispatch(
    addAttachment({
      id: oldId,
      attachment: {
        name: 'Tiny 1.0.0',
        fileName: 'tiny.extrudo-plugin',
        mediaType: PLUGIN_MEDIA_TYPE,
        sha256: sha256Hex(old),
        size: old.length,
      },
    }),
  );
  for (const n of [1, 2]) {
    store.getState().dispatch(
      insertFeature({
        feature: pluginFeatureOf(`p${n}` as FeatureId, `Peg${n}`, {
          plugin: oldId,
          handler: 'peg',
        }),
      }),
    );
  }
  const written: string[] = [];
  const projects = { writeAttachment: async (_doc: string, sha: string) => void written.push(sha) };
  const read = async (id: AttachmentId) => (id === oldId ? old : undefined);
  return { store, oldId, written, projects, read };
}

describe('updatePluginInDesign', () => {
  it('points both features at the installed file as one undo step', async () => {
    const t = setup();
    const bytes = pluginBytes('1.2.0');
    const before = t.store.getState().doc;
    const outcome = await updatePluginInDesign({
      plugin,
      bytes,
      store: t.store,
      projects: t.projects as never,
      read: t.read,
    });
    expect(outcome).toMatchObject({ ok: true, updated: 2 });
    expect(outcome.message).toBe('Updated 2 features to Tiny 1.2.0.');
    const doc = t.store.getState().doc;
    const ids = doc.features.map((f) =>
      f.inputs.plugin?.kind === 'file' ? f.inputs.plugin.id : '',
    );
    expect(ids[0]).toBe(ids[1]);
    expect(ids[0]).not.toBe(t.oldId);
    const fresh = doc.attachments?.[ids[0] as AttachmentId];
    expect(fresh).toMatchObject({ name: 'Tiny 1.2.0', sha256: sha256Hex(bytes) });
    // The old record stays for undo and old versions; the bytes were stored first.
    expect(doc.attachments?.[t.oldId]).toBeDefined();
    expect(t.written).toEqual([sha256Hex(bytes)]);
    // One undo step.
    t.store.getState().undo();
    expect(t.store.getState().doc).toEqual(before);
  });

  it('says so when the design already has the installed file, and changes nothing', async () => {
    const t = setup();
    const bytes = pluginBytes('1.2.0');
    await updatePluginInDesign({
      plugin,
      bytes,
      store: t.store,
      projects: t.projects as never,
      read: t.read,
    });
    const doc = t.store.getState().doc;
    const attachments = doc.attachments;
    const again = await updatePluginInDesign({
      plugin,
      bytes,
      store: t.store,
      projects: t.projects as never,
      read: async () => bytes,
    });
    expect(again).toMatchObject({ ok: true, updated: 0 });
    expect(t.store.getState().doc.attachments).toEqual(attachments);
  });
});
