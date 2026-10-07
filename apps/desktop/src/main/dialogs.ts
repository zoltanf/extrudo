/**
 * Native file dialogs (P6-01, ADR-0075 §3). The web build downloads through a
 * link and picks through a file input; here a download is a save dialog and a
 * pick is an open dialog, both on the main process. The accept string is the
 * web's `<input accept>` syntax (".svg,.dxf" or "application/zip"), turned into
 * dialog filters.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
import {
  type BrowserWindow,
  dialog,
  type OpenDialogOptions,
  type SaveDialogOptions,
} from 'electron';

export interface DialogFiles {
  download(bytes: Uint8Array, name: string): Promise<void>;
  pick(accept: string): Promise<{ name: string; bytes: Uint8Array } | undefined>;
}

const EXTENSION = /^\.[a-z0-9]+$/i;

function filtersOf(accept: string): { name: string; extensions: string[] }[] {
  const extensions = accept
    .split(',')
    .map((part) => part.trim())
    .filter((part) => EXTENSION.test(part))
    .map((part) => part.slice(1).toLowerCase());
  return extensions.length > 0 ? [{ name: 'Files', extensions }] : [];
}

export function createDialogFiles(getWindow: () => BrowserWindow | null): DialogFiles {
  return {
    async download(bytes, name) {
      const options: SaveDialogOptions = { defaultPath: basename(name) };
      const win = getWindow();
      const result = win
        ? await dialog.showSaveDialog(win, options)
        : await dialog.showSaveDialog(options);
      if (result.canceled || !result.filePath) return;
      await writeFile(result.filePath, bytes);
    },
    async pick(accept) {
      const options: OpenDialogOptions = { properties: ['openFile'], filters: filtersOf(accept) };
      const win = getWindow();
      const result = win
        ? await dialog.showOpenDialog(win, options)
        : await dialog.showOpenDialog(options);
      const path = result.filePaths[0];
      if (result.canceled || !path) return undefined;
      return { name: basename(path), bytes: new Uint8Array(await readFile(path)) };
    },
  };
}
