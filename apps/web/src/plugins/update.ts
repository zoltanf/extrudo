/**
 * "Update to <version>" (P6-03 slice 3, ADR-0077 §6): a design carries its own
 * copy of every plugin it uses, and keeps working with it. When the person has
 * installed a newer version, this points every feature of that plugin at the
 * installed file, as one undo step: the new file's attachment record, then each
 * feature's `plugin` input. The old attachments stay until the next version
 * save's collection (ADR-0061 §4), which keeps undo and old versions whole.
 */
import {
  type AttachmentId,
  addAttachment,
  CommandError,
  type DocumentStore,
  pluginFileOf,
  updateFeatureInputs,
} from '@extrudo/core';
import { type ProjectStore, readPluginFile } from '@extrudo/storage';
import { attachmentBytes } from '../sketch/fonts';
import { type PluginIdentity, storePluginAttachment } from './featureSpecs';

export interface PluginUpdateOutcome {
  ok: boolean;
  message: string;
  /** How many features now name the installed file. */
  updated: number;
}

export async function updatePluginInDesign(deps: {
  /** The installed plugin (its ID is what the design's copies are matched by). */
  plugin: PluginIdentity;
  /** The installed file's bytes. */
  bytes: Uint8Array;
  store: DocumentStore;
  projects: Pick<ProjectStore, 'writeAttachment'>;
  read?: (id: AttachmentId) => Promise<ArrayBuffer | Uint8Array | undefined>;
}): Promise<PluginUpdateOutcome> {
  const { plugin, store } = deps;
  const read = deps.read ?? attachmentBytes;
  const label = `Update ${plugin.name} to ${plugin.version}`;
  const doc = store.getState().doc;
  // The features whose copy is of this plugin (by the manifest's id) and not already this file.
  const target = await storePluginAttachment({
    plugin,
    bytes: deps.bytes,
    doc,
    projects: deps.projects,
  });
  const owners = new Map<AttachmentId, boolean>();
  for (const feature of doc.features) {
    const id = pluginFileOf(feature);
    if (!id || id === target.id || owners.has(id)) continue;
    const data = await read(id);
    let mine = false;
    if (data) {
      try {
        mine =
          readPluginFile(data instanceof Uint8Array ? data : new Uint8Array(data)).manifest.id ===
          plugin.id;
      } catch {
        // An unreadable copy is left as it is; the feature reports it.
      }
    }
    owners.set(id, mine);
  }
  const features = doc.features.filter((feature) => {
    const id = pluginFileOf(feature);
    return id !== undefined && id !== target.id && owners.get(id) === true;
  });
  if (features.length === 0) {
    return {
      ok: true,
      message: `${plugin.name} is already ${plugin.version} in this design.`,
      updated: 0,
    };
  }
  store.getState().beginTransaction(label);
  try {
    if (!store.getState().doc.attachments?.[target.id]) {
      store.getState().dispatch(addAttachment({ id: target.id, attachment: target.attachment }));
    }
    for (const feature of features) {
      store.getState().dispatch(
        updateFeatureInputs({
          id: feature.id,
          inputs: { plugin: { kind: 'file', id: target.id } },
        }),
      );
    }
    store.getState().commitTransaction();
  } catch (error) {
    store.getState().cancelTransaction();
    if (error instanceof CommandError) return { ok: false, message: error.message, updated: 0 };
    throw error;
  }
  const n = features.length;
  return {
    ok: true,
    message: `Updated ${n === 1 ? '1 feature' : `${n} features`} to ${plugin.name} ${plugin.version}.`,
    updated: n,
  };
}
