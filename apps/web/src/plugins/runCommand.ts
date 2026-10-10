/**
 * Plugin commands (P6-03 slice 2, ADR-0077 §5): the enabled plugins' commands
 * as the shell offers them, and running one. The handler runs in the kernel
 * worker's sandbox (`Recomputer.runPluginCommand`, the plugin's bytes sent once
 * per kernel); its features come back and are inserted **at the timeline marker
 * in one transaction**, named "<plugin name>: <command label>" — re-minted
 * first (`remintFeatures`: fresh IDs through `newId()`, the app's names, every
 * reference among them rewritten), so they are ordinary features with no tie to
 * the plugin. Nothing of a plugin runs on the UI thread.
 */
import {
  CommandError,
  type DocumentStore,
  type Feature,
  type FeatureId,
  type GeomRef,
  insertFeature,
  newId,
  pluginCommandId,
  remintFeatures,
  type SessionStore,
} from '@extrudo/core';
import type { PluginCommandResult } from '@extrudo/kernel';
import type { InstalledPlugin, PluginStore } from '@extrudo/storage';
import { withActiveComponent } from '../components/active';
import { enabledPlugins, type PluginEntry } from './plugins';

/** A plugin command as the shell lists it: `plugin:<plugin>:<command>`, group "Plugins › <name>". */
export interface PluginCommand {
  id: string;
  label: string;
  hint?: string;
  group: string;
  plugin: InstalledPlugin;
  /** The manifest's command `id`. */
  command: string;
}

/** The commands of the enabled plugins, in install and manifest order. */
export function pluginCommands(installed: readonly PluginEntry[] | undefined): PluginCommand[] {
  return enabledPlugins(installed).flatMap(({ plugin, file }) =>
    (file?.manifest.commands ?? []).map((command) => ({
      id: pluginCommandId(plugin.id, command.id),
      label: command.label,
      ...(command.hint !== undefined && { hint: command.hint }),
      group: `Plugins › ${plugin.name}`,
      plugin,
      command: command.id,
    })),
  );
}

/** The kernel's side: the project's `Recomputer`. */
export interface PluginCommandKernel {
  runPluginCommand(request: {
    plugin: { id: string; name: string; version: string };
    bytes(): Promise<Uint8Array>;
    commandId: string;
    selection: readonly GeomRef[];
  }): Promise<PluginCommandResult>;
}

export type PluginCommandOutcome =
  | { ok: true; message: string; ids: FeatureId[] }
  | { ok: false; message: string };

/** Runs a plugin command and inserts what it made; a failure is the outcome's message. */
export async function runPluginCommand({
  command,
  kernel,
  plugins,
  store,
  session,
  selection,
  ids,
}: {
  command: PluginCommand;
  kernel: PluginCommandKernel;
  plugins: Pick<PluginStore, 'bytes'>;
  store: DocumentStore;
  /** The active component stamps what the command makes (P6-05 S4). */
  session?: SessionStore;
  selection: readonly GeomRef[];
  /** New feature IDs, for tests; `newId()` otherwise. */
  ids?: () => FeatureId;
}): Promise<PluginCommandOutcome> {
  const { plugin } = command;
  const result = await kernel.runPluginCommand({
    plugin: { id: plugin.id, name: plugin.name, version: plugin.version },
    bytes: () => plugins.bytes(plugin.id),
    commandId: command.command,
    selection,
  });
  if (!result.ok) {
    const { message } = result.error;
    // The kernel's words name the plugin and the line in main.ts when it ran; say whose it is otherwise.
    return {
      ok: false,
      message: message.startsWith(plugin.name) ? message : `${plugin.name}: ${message}`,
    };
  }
  return insertCommandFeatures(
    store,
    result.features,
    `${plugin.name}: ${command.label}`,
    ids,
    session,
  );
}

/**
 * Inserts a command's features at the timeline marker, in their order, as one
 * undo step named `label`. A refused insert leaves the design as it was.
 */
export function insertCommandFeatures(
  store: DocumentStore,
  features: readonly Feature[],
  label: string,
  ids: () => FeatureId = () => newId<FeatureId>(),
  session?: SessionStore,
): PluginCommandOutcome {
  if (features.length === 0) return { ok: true, message: `${label} added nothing.`, ids: [] };
  const { doc } = store.getState();
  const fresh = features.map(() => ids());
  const reminted = remintFeatures(features, doc, fresh).map((f) =>
    session ? withActiveComponent(f, session) : f,
  );
  store.getState().beginTransaction(label);
  try {
    // Each lands at the marker, which moves past it, so they keep their order.
    for (const feature of reminted) store.getState().dispatch(insertFeature({ feature }));
    store.getState().commitTransaction();
  } catch (error) {
    store.getState().cancelTransaction();
    if (error instanceof CommandError) return { ok: false, message: error.message };
    throw error;
  }
  const count = reminted.length;
  return {
    ok: true,
    message: `${label}: added ${count === 1 ? reminted[0]?.name : `${count} features`}.`,
    ids: fresh,
  };
}
