/**
 * The desktop bridge's one contract (P6-01, ADR-0075 §1): every channel the
 * renderer may reach, and the `ProjectStore` method names it may call. Main,
 * preload and the renderer all import this file, so a privileged call is one
 * named channel here and a handler behind it — the renderer never touches
 * `ipcRenderer` and never passes a free-form command.
 *
 * Byte payloads cross `ipcRenderer.invoke` as `Uint8Array` (structured clone);
 * the renderer rebuilds Blobs (the store's own interface uses them). The rescue
 * copy is the one synchronous call (`sendSync`): it must be written while the
 * page is going away, when an async write would not finish.
 */
export const CHANNELS = {
  prefsRead: 'extrudo:prefs:read',
  prefsWrite: 'extrudo:prefs:write',
  storeCall: 'extrudo:store:call',
  fileDownload: 'extrudo:file:download',
  filePick: 'extrudo:file:pick',
  storagePersistence: 'extrudo:storage:persistence',
  storageRequest: 'extrudo:storage:request',
  rescuePut: 'extrudo:rescue:put',
  rescueClear: 'extrudo:rescue:clear',
  rescueList: 'extrudo:rescue:list',
  foldersLink: 'extrudo:folders:link',
  foldersCurrent: 'extrudo:folders:current',
  foldersUnlink: 'extrudo:folders:unlink',
  folderPermission: 'extrudo:folders:permission',
  folderRequest: 'extrudo:folders:request',
  folderList: 'extrudo:folders:list',
  folderRead: 'extrudo:folders:read',
  folderWrite: 'extrudo:folders:write',
} as const;

export type Channel = (typeof CHANNELS)[keyof typeof CHANNELS];

/** Every `ProjectStore` method the renderer's proxy may invoke. */
export const STORE_METHODS = [
  'list',
  'get',
  'load',
  'save',
  'link',
  'archiveBytes',
  'writeAttachment',
  'readAttachment',
  'collectAttachments',
  'saveVersion',
  'versions',
  'loadVersion',
  'deleteVersions',
  'rename',
  'duplicate',
  'trash',
  'restore',
  'purge',
  'thumbnail',
  'setThumbnail',
  'exportFile',
  'importFile',
] as const;

export type StoreMethod = (typeof STORE_METHODS)[number];

export const isStoreMethod = (method: unknown): method is StoreMethod =>
  typeof method === 'string' && (STORE_METHODS as readonly string[]).includes(method);

export type Persistence = 'persistent' | 'best-effort' | 'unsupported';
export type FolderPermission = 'granted' | 'prompt' | 'denied';

/** A file the native open dialog returned: its name and bytes. */
export interface PickedFile {
  name: string;
  bytes: Uint8Array;
}

/** One `.extrudo` file in the linked folder. */
export interface FolderEntry {
  name: string;
  modified: number;
  size: number;
}

/** A store call's answer when the method can report leniency notices (`load`, `importFile`). */
export interface Noticed<T> {
  value: T;
  notices: string[];
}

/**
 * The API `contextBridge.exposeInMainWorld('extrudo', …)` publishes. The
 * renderer's `desktopPlatform()` is written against exactly this.
 */
export interface ExtrudoApi {
  readonly prefs: {
    /** The whole preference map, read once through `invoke` at boot. */
    read(): Promise<Record<string, unknown>>;
    write(key: string, value: unknown): void;
  };
  readonly store: {
    call(method: StoreMethod, args: unknown[]): Promise<unknown>;
  };
  readonly files: {
    download(bytes: Uint8Array, name: string): Promise<void>;
    pick(accept: string): Promise<PickedFile | undefined>;
  };
  readonly storage: {
    persistence(): Promise<Persistence>;
    requestPersistence(): Promise<Persistence>;
  };
  readonly rescue: {
    /** Keeps the raw document JSON before returning; false if the file couldn't be written. */
    put(id: string, raw: string): boolean;
    clear(id: string): void;
    /** Every copy left behind, as raw JSON, read at startup. */
    list(): { id: string; raw: string }[];
  };
  readonly folders: {
    link(): Promise<{ name: string } | undefined>;
    current(): Promise<{ name: string } | undefined>;
    unlink(): Promise<void>;
    permission(): Promise<FolderPermission>;
    request(): Promise<boolean>;
    list(): Promise<FolderEntry[]>;
    read(name: string): Promise<{ bytes: Uint8Array; modified: number }>;
    write(name: string, bytes: Uint8Array): Promise<{ modified: number }>;
  };
}
