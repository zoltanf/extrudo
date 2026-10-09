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
import type { MenuModel } from '@extrudo/web/menu-model';
import type { SlicerFile, SlicerId } from '@extrudo/web/platform/slicer';

export const CHANNELS = {
  prefsRead: 'extrudo:prefs:read',
  prefsWrite: 'extrudo:prefs:write',
  storeCall: 'extrudo:store:call',
  // The installed plugins (P6-03 slice 2, ADR-0077 §4): one channel, a whitelist.
  pluginCall: 'extrudo:plugin:call',
  fileDownload: 'extrudo:file:download',
  filePick: 'extrudo:file:pick',
  fileSaveAs: 'extrudo:file:save-as',
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
  // Menus, the file association and recent files (P6-01 slice 2, ADR-0075 §2).
  menuSet: 'extrudo:menu:set',
  menuRun: 'extrudo:menu:run',
  menuReset: 'extrudo:menu:reset',
  menuListening: 'extrudo:menu:listening',
  fileOpenPath: 'extrudo:file:open-path',
  // Open File… and Open Recent as app commands (ADR-0075, 2026-10-09): main shows the
  // dialog / looks the entry up itself; the renderer never sends a path.
  fileOpenDialog: 'extrudo:file:open-dialog',
  recentNames: 'extrudo:recent:names',
  recentOpen: 'extrudo:recent:open',
  // Writing back to a file main itself handed out (P6-01 slice 2, finding 3).
  fileWritePath: 'extrudo:file:write-path',
  fileStatPath: 'extrudo:file:stat-path',
  fileReadPath: 'extrudo:file:read-path',
  recentList: 'extrudo:recent:list',
  recentClear: 'extrudo:recent:clear',
  recentRemove: 'extrudo:recent:remove',
  recentChanged: 'extrudo:recent:changed',
  appReady: 'extrudo:app:ready',
  appQuit: 'extrudo:app:quit',
  // Opening an export in a slicer (P6-02, ADR-0062's amendment).
  slicerList: 'extrudo:slicer:list',
  slicerOpen: 'extrudo:slicer:open',
  // Auto-update (P6-01 slice 4): main → renderer status, renderer → main asks.
  updateStatus: 'extrudo:update:status',
  updateCheck: 'extrudo:update:check',
  updateApply: 'extrudo:update:apply',
  updateRelease: 'extrudo:update:release',
  // The docs pages (P6-06 S9): a `docsPath` result, the URL main builds itself.
  docsOpen: 'extrudo:docs:open',
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
  'readModelCache',
  'writeModelCache',
  'thumbnail',
  'setThumbnail',
  'exportFile',
  'importFile',
] as const;

export type StoreMethod = (typeof STORE_METHODS)[number];

export const isStoreMethod = (method: unknown): method is StoreMethod =>
  typeof method === 'string' && (STORE_METHODS as readonly string[]).includes(method);

/**
 * Every `PluginStore` method the renderer may invoke (P6-03 slice 2), through
 * the one channel `plugin:call`. The store lives in main, under
 * `userData/plugins`.
 */
export const PLUGIN_METHODS = ['list', 'install', 'remove', 'setEnabled', 'bytes', 'read'] as const;

export type PluginMethod = (typeof PLUGIN_METHODS)[number];

export const isPluginMethod = (method: unknown): method is PluginMethod =>
  typeof method === 'string' && (PLUGIN_METHODS as readonly string[]).includes(method);

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

/** A recent file, as the native Open Recent submenu lists it (P6-01 slice 2). */
export interface RecentEntry {
  path: string;
  name: string;
}

/** A `.extrudo` file main read and hands to the renderer to import. */
export interface OpenedFile {
  path: string;
  name: string;
  bytes: Uint8Array;
  /** The file's mtime, ms since the epoch: what the project is linked to. */
  modified: number;
  /**
   * Set when main refused to read the file (over the size cap, or not a
   * `.extrudo`): the renderer says so instead of importing. `bytes` is empty.
   */
  error?: string;
}

/** Where "Save As…" wrote, and that file's mtime. */
export interface SavedFile {
  path: string;
  modified: number;
}

/** Where the updater is (P6-01 slice 4, ADR-0075's amendment). */
export type UpdateState =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'ready'
  | 'notify'
  | 'error';

/**
 * What main reports over `update:status`. `notify` is the state of the
 * platforms that don't update themselves (a deb, macOS until signing): the
 * version and its release page. `message` is an error's text, or "Extrudo is up
 * to date." after Help › Check for Updates….
 */
export interface UpdateStatus {
  state: UpdateState;
  version?: string;
  percent?: number;
  message?: string;
  url?: string;
  /** `info` for a manual check's neutral answer ("no published release yet"); success otherwise. */
  tone?: 'info';
  /** A manual check's error: shown, where an automatic one is history only. */
  manual?: boolean;
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
  readonly plugins: {
    call(method: PluginMethod, args: unknown[]): Promise<unknown>;
  };
  readonly files: {
    download(bytes: Uint8Array, name: string): Promise<void>;
    pick(accept: string): Promise<PickedFile | undefined>;
    /** "Save As…": a save dialog, the bytes written, and where (P6-01 slice 2). */
    saveAs(bytes: Uint8Array, name: string): Promise<SavedFile | undefined>;
    /** Open File…: main shows the native dialog and delivers the file like Open Recent does. */
    openDialog(): void;
  };
  readonly menus: {
    /** Replaces the application menu; main builds Open Recent from its own list. */
    set(model: MenuModel[]): void;
    /** Returns to a bare desktop menu (a project page unmounting). */
    reset(): void;
    /** Whether a project page has registered its `onRun` handler (a document is open). */
    listening(active: boolean): void;
    /** Registers the one handler for a clicked item; call `offRun` first to replace it. */
    onRun(handler: (id: string) => void): void;
    offRun(): void;
    /** Registers the one handler for a file the app was asked to open. */
    onOpenFile(handler: (file: OpenedFile) => void): void;
    offOpenFile(): void;
  };
  readonly recent: {
    list(): Promise<RecentEntry[]>;
    /** Only the file names, most recent first: what the Design menu lists (no paths). */
    names(): Promise<string[]>;
    /**
     * Opens entry `index` of main's own list; `name` must match it, or main ignores the call
     * (the list moved). The renderer never names a path.
     */
    open(index: number, name: string): void;
    clear(): Promise<void>;
    /** Drops a path main handed out: the renderer couldn't import it (corrupt). */
    remove(path: string): void;
    /** Main tells the renderer the list changed, so it can refresh the menu. */
    onChanged(handler: () => void): void;
    offChanged(): void;
  };
  readonly external: {
    /** Writes back to a path main issued this session; refuses any other. */
    write(path: string, bytes: Uint8Array): Promise<{ modified: number }>;
    stat(path: string): Promise<{ modified: number } | undefined>;
    read(path: string): Promise<{ bytes: Uint8Array; modified: number }>;
  };
  readonly app: {
    /** The renderer's menu/open-file handlers are registered; main may deliver. */
    ready(): void;
    /** Main quits; the renderer has saved everything first. */
    quit(): void;
  };
  readonly slicer: {
    /** The slicers main found installed (no paths: the renderer needs only which). */
    list(): Promise<{ id: SlicerId; path: string }[]>;
    /** Writes the file to a temp path and starts the slicer on it; true once it took it. */
    open(file: SlicerFile, id: SlicerId): Promise<boolean>;
  };
  readonly updates: {
    /** Registers the one handler for main's `update:status`. */
    onStatus(handler: (status: UpdateStatus) => void): void;
    offStatus(): void;
    /** Asks main to check now (Help › Check for Updates… does it in main). */
    check(): void;
    /** Installs a downloaded update; main refuses unless it is `ready`. */
    apply(): void;
    /** Opens the release page main itself built for a `notify` update. */
    openRelease(): void;
  };
  readonly storage: {
    persistence(): Promise<Persistence>;
    requestPersistence(): Promise<Persistence>;
  };
  readonly docs: {
    /**
     * Opens a docs page (P6-06 S9): `path` is a `docsPath` result; main
     * matches it against its own whitelist and builds the URL itself, so the
     * renderer can't make main open a page of its choosing.
     */
    open(path: string): void;
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
