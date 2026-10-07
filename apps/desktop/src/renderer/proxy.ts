/**
 * The `ProjectStore` proxy (P6-01, ADR-0075 §3): the renderer's view of the
 * store that lives in the main process, method by method. Most methods pass
 * their arguments and result straight through `ipcRenderer.invoke`; the four
 * that need marshalling do it here — `load`/`importFile` replay the notices
 * main collected, `thumbnail`/`exportFile` rebuild the Blob the interface
 * returns, and `setThumbnail` sends bytes. Written against the typed bridge, so
 * a fake bridge tests it without Electron.
 */
import type { ExtrudoDocument } from '@extrudo/core';
import type {
  InstalledPlugin,
  LinkedFile,
  PluginFile,
  PluginStore,
  ProjectId,
  ProjectStore,
  ProjectSummary,
  VersionSummary,
} from '@extrudo/storage';
import type { ExtrudoApi, Noticed, PluginMethod, StoreMethod } from '../shared/ipc';
import { unwrap } from './errors';

export function createStoreProxy(api: ExtrudoApi): ProjectStore {
  const call = async <T>(method: StoreMethod, ...args: unknown[]): Promise<T> => {
    // `store-call.ts` returns errors as data; rebuild them here so the store's
    // classes (and `describeError`'s wording) survive the bridge.
    const value = await api.store.call(method, args);
    return unwrap<T>(value as T);
  };

  return {
    list: () => call<ProjectSummary[]>('list'),
    get: (id: ProjectId) => call<ProjectSummary | undefined>('get', id),
    async load(id, options) {
      const { value, notices } = await call<Noticed<ExtrudoDocument>>('load', id);
      for (const message of notices) options?.onNotice?.(message);
      return value;
    },
    save: (doc: ExtrudoDocument) => call<ProjectSummary>('save', doc),
    link: (id: ProjectId, file: LinkedFile | undefined) => call<ProjectSummary>('link', id, file),
    archiveBytes: (id: ProjectId) => call<Uint8Array>('archiveBytes', id),
    writeAttachment: (id: ProjectId, sha256: string, bytes: Uint8Array) =>
      call<void>('writeAttachment', id, sha256, bytes),
    readAttachment: (id: ProjectId, sha256: string) =>
      call<Uint8Array | undefined>('readAttachment', id, sha256),
    collectAttachments: (id: ProjectId) => call<void>('collectAttachments', id),
    saveVersion: (doc: ExtrudoDocument, description: string) =>
      call<VersionSummary>('saveVersion', doc, description),
    versions: (id: ProjectId) => call<VersionSummary[]>('versions', id),
    loadVersion: (id: ProjectId, number: number) =>
      call<ExtrudoDocument>('loadVersion', id, number),
    deleteVersions: (id: ProjectId, numbers: readonly number[]) =>
      call<void>('deleteVersions', id, numbers),
    rename: (id: ProjectId, name: string) => call<ProjectSummary>('rename', id, name),
    duplicate: (id: ProjectId) => call<ProjectSummary>('duplicate', id),
    trash: (id: ProjectId) => call<void>('trash', id),
    restore: (id: ProjectId) => call<void>('restore', id),
    purge: (id: ProjectId) => call<void>('purge', id),
    async thumbnail(id) {
      const bytes = await call<Uint8Array | null>('thumbnail', id);
      return bytes ? new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'image/png' }) : null;
    },
    async setThumbnail(id, png: Blob) {
      await call<void>('setThumbnail', id, new Uint8Array(await png.arrayBuffer()));
    },
    async exportFile(id) {
      const bytes = await call<Uint8Array>('exportFile', id);
      return new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/zip' });
    },
    async importFile(file: Blob, options) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const { value, notices } = await call<Noticed<ProjectSummary>>('importFile', bytes);
      for (const message of notices) options?.onNotice?.(message);
      return value;
    },
  };
}

/**
 * The `PluginStore` proxy (P6-03 slice 2, ADR-0077 §4): the installed plugins
 * live in main (`userData/plugins`); every method crosses `plugin:call` with
 * plain arguments and answers (bytes are `Uint8Array`s, a read file plain
 * data), and a refusal comes back as its class (`unwrap`).
 */
export function createPluginProxy(api: ExtrudoApi): PluginStore {
  const call = async <T>(method: PluginMethod, ...args: unknown[]): Promise<T> =>
    unwrap<T>((await api.plugins.call(method, args)) as T);
  return {
    list: () => call<InstalledPlugin[]>('list'),
    install: (bytes: Uint8Array) => call<InstalledPlugin>('install', bytes),
    remove: (id: string) => call<void>('remove', id),
    setEnabled: (id: string, enabled: boolean) => call<InstalledPlugin>('setEnabled', id, enabled),
    bytes: (id: string) => call<Uint8Array>('bytes', id),
    read: (id: string) => call<PluginFile>('read', id),
  };
}
