/**
 * Validation for the menu model the renderer sends over `menu:set` (P6-01
 * slice 2, finding 2). The renderer is the untrusted side — a malicious
 * `.extrudo` can run script — so a malformed model must never reach
 * `Menu.buildFromTemplate`: `ipcMain.on` has no `try/catch`, an in-flight throw
 * would be unhandled in main. `isMenuModel` is pure and Electron-free, so the
 * main process ignores a bad model with one warning rather than trusting it.
 *
 * The shape is depth 2: an array of menus, each with a string label and an
 * array of items; an item is a separator, or a label, an optional string id,
 * an optional role, a boolean `enabled` and an optional string accelerator in
 * Electron's grammar.
 */
import type { MenuModel } from '@extrudo/web/menu-model';

const MODIFIERS = new Set(['CmdOrCtrl', 'Cmd', 'Ctrl', 'Alt', 'AltGr', 'Shift', 'Super']);
const NAMED_KEYS = new Set([
  'Delete',
  'Backspace',
  'Return',
  'Enter',
  'Escape',
  'Space',
  'Tab',
  'Up',
  'Down',
  'Left',
  'Right',
  'Home',
  'End',
  'PageUp',
  'PageDown',
]);

/** Whether a string is an accelerator Electron's grammar accepts. */
export function isElectronAccelerator(value: string): boolean {
  const parts = value.split('+');
  const key = parts.pop();
  if (!key) return false;
  const keyOk =
    /^[A-Za-z0-9,./;'[\]\\=`-]$/.test(key) ||
    /^F([1-9]|1[0-9]|2[0-4])$/.test(key) ||
    NAMED_KEYS.has(key);
  return keyOk && parts.every((part) => MODIFIERS.has(part));
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function isEntry(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (value.separator === true) return true;
  if (typeof value.label !== 'string') return false;
  if (value.id !== undefined && typeof value.id !== 'string') return false;
  if (value.role !== undefined && typeof value.role !== 'string') return false;
  if (value.enabled !== undefined && typeof value.enabled !== 'boolean') return false;
  if (value.accelerator !== undefined) {
    if (typeof value.accelerator !== 'string') return false;
    if (!isElectronAccelerator(value.accelerator)) return false;
  }
  return true;
}

function isMenu(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (typeof value.label !== 'string') return false;
  return Array.isArray(value.items) && value.items.every(isEntry);
}

/** Whether an unknown value is a menu model the desktop menu can build. */
export function isMenuModel(value: unknown): value is MenuModel[] {
  return Array.isArray(value) && value.every(isMenu);
}
