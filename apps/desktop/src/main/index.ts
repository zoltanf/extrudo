/**
 * The Electron main process (P6-01, ADR-0075 §1). It owns everything
 * privileged: the `userData` directory the Node store, preferences, rescue
 * copies and linked folder live in; the `app://` renderer protocol and the
 * content policy; the native dialogs; and the one window. The renderer reaches
 * it only through `ipc.ts`.
 *
 * One instance owns the directory: a second launch focuses the first and quits
 * (`app.requestSingleInstanceLock`), so the store's per-process lock is enough.
 */
import { join } from 'node:path';
import { createNodeProjectStore } from '@extrudo/storage/node';
import { app, BrowserWindow, session } from 'electron';
import { createDialogFiles } from './dialogs';
import { createFolders } from './folders';
import { HEADERS } from './headers';
import { registerIpcHandlers } from './ipc';
import { isAllowedNavigation } from './navigation';
import { createPreferencesFile } from './preferences';
import { APP_URL, handleAppProtocol, registerAppScheme } from './protocol';
import { createRescueFile } from './rescue';

// Before `app.whenReady()`: a privileged scheme cannot be registered later.
registerAppScheme();

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  main();
}

function main(): void {
  const userData = app.getPath('userData');
  const store = createNodeProjectStore(join(userData, 'projects'), {
    appVersion: app.getVersion(),
  });
  const preferences = createPreferencesFile(join(userData, 'preferences.json'));
  const rescue = createRescueFile(join(userData, 'rescue.json'));
  const folders = createFolders(join(userData, 'linked-folder.json'));

  let window: BrowserWindow | null = null;
  const getWindow = () => window;

  app.on('second-instance', () => {
    if (!window) return;
    if (window.isMinimized()) window.restore();
    window.focus();
  });

  app.whenReady().then(() => {
    // `app://` serves the packaged build; the policy rides on its responses
    // (protocol.ts). This hook stays as belt and braces for any response that
    // didn't come through `protocol.handle`.
    handleAppProtocol(join(__dirname, '../renderer'));
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      const responseHeaders = details.responseHeaders ?? {};
      if (details.url.startsWith('app://')) {
        for (const [name, value] of Object.entries(HEADERS)) responseHeaders[name] = [value];
      }
      callback({ responseHeaders });
    });
    // Nothing in the app needs a camera, a microphone, a location or a device:
    // deny every permission request rather than leave the default.
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) =>
      callback(false),
    );

    registerIpcHandlers({
      preferences,
      store,
      files: createDialogFiles(getWindow),
      rescue,
      folders,
      getWindow,
    });
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('before-quit', () => {
    preferences.flush();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  function createWindow(): void {
    window = new BrowserWindow({
      width: 1440,
      height: 900,
      minWidth: 960,
      minHeight: 600,
      backgroundColor: '#1B1F27',
      show: false,
      webPreferences: {
        preload: join(__dirname, '../preload/index.cjs'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
      },
    });
    window.on('ready-to-show', () => window?.show());
    window.on('closed', () => {
      window = null;
    });

    // A compromised renderer must not turn this window into a browser: no
    // top-level navigation off `app://` (or the dev server's origin), no new
    // windows, and no webview (P6-01's review). The preload runs in every
    // document, so this is what keeps the bridge out of an attacker's page.
    window.webContents.on('will-navigate', (event, url) => {
      if (!isAllowedNavigation(url, process.env.ELECTRON_RENDERER_URL)) event.preventDefault();
    });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-attach-webview', (event) => event.preventDefault());

    const devUrl = process.env.ELECTRON_RENDERER_URL;
    if (devUrl) void window.loadURL(devUrl);
    else void window.loadURL(APP_URL);
  }
}
