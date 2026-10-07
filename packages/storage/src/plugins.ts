/**
 * Installed plugins (P6-03 slice 2, ADR-0077 §4): the person's own plugins,
 * beside their projects and never inside a design. Each is its file as it was
 * picked, under `plugins/<id>/plugin.extrudo-plugin`, and one index,
 * `plugins/index.json` (`{ next, plugins: [...] }`), says which are there, at
 * which version, whether they are enabled and the bytes' SHA-256.
 *
 * The same `FileStore` the projects use holds the files: OPFS on the web, the
 * real file system on the desktop. The index is written whole through a
 * `PluginIndexFile`: over a `FileStore` on the web (OPFS swaps a file in on
 * `close()`, so a write is atomic), through a temp file and a rename on the
 * desktop (`@extrudo/storage/node`'s `nodePluginIndex`). The file goes before
 * the index on install and after it on remove, so the index never names bytes
 * that aren't there.
 *
 * Installing reads the file with `readPluginFile`: the manifest is the check,
 * and a file it refuses is refused here with its words.
 */
import { compareSemver, PLUGIN_ID } from '@extrudo/core';
import type { FileStore } from './files';
import { type PluginFile, readPluginFile } from './plugin-file';
import { sha256Hex } from './sha256';

/** What the store keeps about an installed plugin. */
export interface InstalledPlugin {
  /** The manifest's `id`. */
  id: string;
  name: string;
  version: string;
  /** Disabled plugins offer nothing (ADR-0077 §4). */
  enabled: boolean;
  /** When it was installed (or last upgraded), as an ISO time. */
  installedAt: string;
  /** The SHA-256 of the file's bytes, lower case hex. */
  sha256: string;
}

/** The person's plugins, wherever the platform keeps them. */
export interface PluginStore {
  /** Every installed plugin, in the order they were first installed. */
  list(): Promise<InstalledPlugin[]>;
  /**
   * Installs a plugin file: an upgrade replaces an older version (keeping
   * whether it was enabled), a new plugin starts enabled. Throws
   * `PluginFileError` or core's `PluginManifestError` for a file
   * `readPluginFile` refuses, and `PluginStoreError` when the same or a newer
   * version is already installed.
   */
  install(bytes: Uint8Array): Promise<InstalledPlugin>;
  /** Uninstalls a plugin; one that isn't installed is fine. */
  remove(id: string): Promise<void>;
  setEnabled(id: string, enabled: boolean): Promise<InstalledPlugin>;
  /** The file's bytes. Throws `PluginStoreError` when it isn't installed or is damaged. */
  bytes(id: string): Promise<Uint8Array>;
  /** The file, read: manifest, code, README and license. */
  read(id: string): Promise<PluginFile>;
}

/** A store refusal, in the user's words. */
export class PluginStoreError extends Error {
  override readonly name = 'PluginStoreError';
}

/** Where the index is kept, as one text written whole. */
export interface PluginIndexFile {
  read(): Promise<string | undefined>;
  write(text: string): Promise<void>;
}

/** The plugins' folder within the platform's `FileStore`. */
export const PLUGINS_DIR = 'plugins';

/** Where an installed plugin's file is. */
export const pluginPath = (id: string) => `${PLUGINS_DIR}/${id}/plugin.extrudo-plugin`;

/** The index as a file in a `FileStore` (`plugins/index.json`). */
export function fileStoreIndex(
  files: FileStore,
  path = `${PLUGINS_DIR}/index.json`,
): PluginIndexFile {
  return {
    async read() {
      const bytes = await files.read(path);
      return bytes && new TextDecoder().decode(bytes);
    },
    write: (text) => files.write(path, new TextEncoder().encode(text)),
  };
}

interface IndexData {
  /** How many installs there have been: an upgrade counts too. */
  next: number;
  plugins: InstalledPlugin[];
}

export interface PluginStoreOptions {
  /** Clock, for tests. */
  now?: () => Date;
}

export function createPluginStore(
  files: FileStore,
  index: PluginIndexFile = fileStoreIndex(files),
  options: PluginStoreOptions = {},
): PluginStore {
  const now = options.now ?? (() => new Date());
  // One read-modify-write of the index at a time within this store.
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(task: () => Promise<T>): Promise<T> => {
    const run = queue.then(task, task);
    queue = run.catch(() => undefined);
    return run;
  };

  const load = async (): Promise<IndexData> => {
    const text = await index.read();
    if (text === undefined) return { next: 1, plugins: [] };
    try {
      const data = JSON.parse(text) as Partial<IndexData>;
      const plugins = Array.isArray(data.plugins) ? data.plugins.filter(isInstalled) : [];
      return { next: typeof data.next === 'number' ? data.next : plugins.length + 1, plugins };
    } catch {
      return { next: 1, plugins: [] };
    }
  };
  const save = (data: IndexData) => index.write(`${JSON.stringify(data, null, 2)}\n`);

  const find = async (id: string): Promise<InstalledPlugin> => {
    const found = PLUGIN_ID.test(id) ? (await load()).plugins.find((p) => p.id === id) : undefined;
    if (!found) throw new PluginStoreError(`The plugin "${id}" isn't installed.`);
    return found;
  };
  const bytesOf = async (id: string): Promise<Uint8Array> => {
    const plugin = await find(id);
    const bytes = await files.read(pluginPath(id));
    if (!bytes || sha256Hex(bytes) !== plugin.sha256) {
      throw new PluginStoreError(
        `The plugin ${plugin.name} ${plugin.version} is damaged: install it again.`,
      );
    }
    return bytes;
  };

  return {
    list: async () => (await load()).plugins.map((plugin) => ({ ...plugin })),
    install: (bytes) =>
      serial(async () => {
        const file = readPluginFile(bytes);
        const { id, name, version } = file.manifest;
        const data = await load();
        const old = data.plugins.find((p) => p.id === id);
        if (old) {
          const order = compareSemver(old.version, version);
          if (order === 0) {
            throw new PluginStoreError(
              `${old.name} ${old.version} is already installed; this file is the same version, ${version}.`,
            );
          }
          if (order > 0) {
            throw new PluginStoreError(
              `${old.name} ${old.version} is installed, which is newer than this file's ${version}.`,
            );
          }
        }
        const plugin: InstalledPlugin = {
          id,
          name,
          version,
          enabled: old?.enabled ?? true,
          installedAt: now().toISOString(),
          sha256: sha256Hex(bytes),
        };
        await files.write(pluginPath(id), bytes);
        await save({
          next: data.next + 1,
          plugins: old
            ? data.plugins.map((p) => (p.id === id ? plugin : p))
            : [...data.plugins, plugin],
        });
        return { ...plugin };
      }),
    remove: (id) =>
      serial(async () => {
        if (!PLUGIN_ID.test(id)) return;
        const data = await load();
        if (data.plugins.some((p) => p.id === id)) {
          await save({ ...data, plugins: data.plugins.filter((p) => p.id !== id) });
        }
        await files.remove(`${PLUGINS_DIR}/${id}`);
      }),
    setEnabled: (id, enabled) =>
      serial(async () => {
        const plugin = { ...(await find(id)), enabled };
        const data = await load();
        await save({ ...data, plugins: data.plugins.map((p) => (p.id === id ? plugin : p)) });
        return { ...plugin };
      }),
    bytes: bytesOf,
    read: async (id) => readPluginFile(await bytesOf(id)),
  };
}

function isInstalled(value: unknown): value is InstalledPlugin {
  const p = value as Partial<InstalledPlugin> | null;
  return (
    typeof p === 'object' &&
    p !== null &&
    typeof p.id === 'string' &&
    PLUGIN_ID.test(p.id) &&
    typeof p.name === 'string' &&
    typeof p.version === 'string' &&
    typeof p.enabled === 'boolean' &&
    typeof p.sha256 === 'string'
  );
}
