/**
 * The plugin files the feature dialogs are about to write into a design
 * (P6-03 slice 3, ADR-0077 §6), by plugin ID: the attachment the feature will
 * name. Kept apart from `featureSpecs.ts` so the Recomputer's file hooks
 * (`features/import.ts`) can ask for a pending file's media type and name
 * without loading the dialog specs.
 */
import type { Attachment, AttachmentId } from '@extrudo/core';
import { createStore } from 'zustand/vanilla';

export interface PendingPlugin {
  id: AttachmentId;
  attachment: Attachment;
}

export const pendingPluginStore = createStore<{ pending: Record<string, PendingPlugin> }>()(() => ({
  pending: {},
}));

export const pendingFor = (plugin: string) => pendingPluginStore.getState().pending[plugin];

/** Forgets a plugin's pending file: its dialog was cancelled or committed. */
export function clearPendingPlugin(plugin: string): void {
  const { [plugin]: _, ...rest } = pendingPluginStore.getState().pending;
  pendingPluginStore.setState({ pending: rest });
}

/** A pending file by its attachment ID (the preview asks before the document has the record). */
export function pendingPluginById(id: AttachmentId): PendingPlugin | undefined {
  return Object.values(pendingPluginStore.getState().pending).find((p) => p.id === id);
}
