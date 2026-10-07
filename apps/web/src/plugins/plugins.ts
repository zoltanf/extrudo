/**
 * The installed plugins as the app sees them (P6-03 slice 2, ADR-0077 §4-§6):
 * session state over the platform's `PluginStore` — the list with each
 * plugin's file read (its manifest, README and license), refreshed after every
 * change — and the plugins a design carries that aren't installed ("Install
 * from this design"). The Plugins dialog draws it, and the shell builds the
 * plugin commands from the enabled ones' manifests.
 */
import {
  type AttachmentId,
  compareSemver,
  type ExtrudoDocument,
  type PluginManifest,
  pluginFileOf,
} from '@extrudo/core';
import {
  type InstalledPlugin,
  type PluginFile,
  type PluginStore,
  readPluginFile,
} from '@extrudo/storage';
import { createStore, type StoreApi } from 'zustand/vanilla';
import { describeError } from '../project/actions';

/** An installed plugin, with its file read (or why it couldn't be). */
export interface PluginEntry {
  plugin: InstalledPlugin;
  file?: PluginFile;
  error?: string;
}

/** A plugin a design carries as an attachment (ADR-0077 §4). */
export interface DesignPlugin {
  attachment: AttachmentId;
  manifest: PluginManifest;
  bytes: Uint8Array;
}

export interface PluginsState {
  /** The installed plugins, in install order; undefined until first read. */
  installed: PluginEntry[] | undefined;
  /** What the last change did, or why it was refused: the dialog's status line. */
  status: string;
  /** Whether the last change was refused. */
  refused: boolean;
  refresh(): Promise<void>;
  /** Installs a plugin file; false (with the reason in `status`) when it is refused. */
  install(bytes: Uint8Array, from?: string): Promise<boolean>;
  remove(id: string): Promise<void>;
  setEnabled(id: string, enabled: boolean): Promise<void>;
}

export type PluginsStore = StoreApi<PluginsState>;

export function createPluginsStore(store: PluginStore): PluginsStore {
  return createStore<PluginsState>()((set, get) => {
    const refresh = async () => {
      const list = await store.list();
      const installed = await Promise.all(
        list.map(async (plugin): Promise<PluginEntry> => {
          try {
            return { plugin, file: await store.read(plugin.id) };
          } catch (error) {
            return { plugin, error: describeError(error) };
          }
        }),
      );
      set({ installed });
    };
    const change = async (task: () => Promise<string>): Promise<boolean> => {
      try {
        const status = await task();
        await refresh();
        set({ status, refused: false });
        return true;
      } catch (error) {
        set({ status: describeError(error), refused: true });
        await refresh().catch(() => {});
        return false;
      }
    };
    return {
      installed: undefined,
      status: '',
      refused: false,
      refresh: () =>
        refresh().catch((error: unknown) => {
          set({ installed: get().installed ?? [], status: describeError(error), refused: true });
        }),
      install: (bytes, from) =>
        change(async () => {
          const plugin = await store.install(bytes);
          return `Installed ${plugin.name} ${plugin.version}${from ? ` ${from}` : ''}.`;
        }),
      remove: async (id) => {
        const name = nameOf(get().installed, id);
        await change(async () => {
          await store.remove(id);
          return `Removed ${name}.`;
        });
      },
      setEnabled: async (id, enabled) => {
        const name = nameOf(get().installed, id);
        // The checkbox follows the click at once; the refresh after the write (or a
        // refusal's) puts the stored state back either way.
        set({
          installed: get().installed?.map((entry) =>
            entry.plugin.id === id ? { ...entry, plugin: { ...entry.plugin, enabled } } : entry,
          ),
        });
        await change(async () => {
          await store.setEnabled(id, enabled);
          return `${enabled ? 'Enabled' : 'Disabled'} ${name}.`;
        });
      },
    };
  });
}

const nameOf = (installed: readonly PluginEntry[] | undefined, id: string) =>
  installed?.find((entry) => entry.plugin.id === id)?.plugin.name ?? id;

/** The enabled plugins whose files could be read: what offers commands. */
export function enabledPlugins(installed: readonly PluginEntry[] | undefined): PluginEntry[] {
  return (installed ?? []).filter((entry) => entry.plugin.enabled && entry.file);
}

/**
 * The plugins a design carries that aren't installed (ADR-0077 §4's "Install
 * from this design"): every `plugin` feature's attachment, read with
 * `readPluginFile` and compared by the manifest's id with what is installed.
 * One entry per plugin, its newest version when the design has several; a file
 * that can't be read is left out (the feature itself says why).
 */
export async function designPlugins(
  doc: ExtrudoDocument,
  installed: readonly InstalledPlugin[],
  read: (id: AttachmentId) => Promise<ArrayBuffer | Uint8Array | undefined>,
): Promise<DesignPlugin[]> {
  const ids = [...new Set(doc.features.map(pluginFileOf).filter((id): id is AttachmentId => !!id))];
  const have = new Set(installed.map((plugin) => plugin.id));
  const found = new Map<string, DesignPlugin>();
  for (const attachment of ids) {
    const data = await read(attachment);
    if (!data) continue;
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    let manifest: PluginManifest;
    try {
      manifest = readPluginFile(bytes).manifest;
    } catch {
      continue;
    }
    if (have.has(manifest.id)) continue;
    const other = found.get(manifest.id);
    if (other && compareSemver(other.manifest.version, manifest.version) >= 0) continue;
    found.set(manifest.id, { attachment, manifest, bytes });
  }
  return [...found.values()];
}
