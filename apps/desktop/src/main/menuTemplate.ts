/**
 * The Electron menu template, built from the renderer's `MenuModel` (P6-01
 * slice 2, ADR-0075 §2). Pure and Electron-free apart from the option types, so
 * a Node test can build a template with mocked handlers and click its items —
 * the only Electron calls are `Menu.buildFromTemplate` and
 * `Menu.setApplicationMenu`, in `index.ts`.
 *
 * Keys stay the renderer's: every accelerator is shown but
 * `registerAccelerator: false`, so the web's own keydown handling still runs
 * the command and nothing fires twice.
 */

import type { MenuEntryModel, MenuModel } from '@extrudo/web/menu-model';
import { QUIT_ID, SAVE_AS_ID } from '@extrudo/web/menu-model';
import type { MenuItemConstructorOptions } from 'electron';
import type { RecentEntry } from '../shared/ipc';

// The desktop-only command ids are defined once in `@extrudo/web/menu-model`
// (finding 6) and re-exported here for main and the tests.
export { QUIT_ID, SAVE_AS_ID };

/**
 * The only Electron roles the renderer's model may set (P6-01 slice 2, finding
 * 2). The model's own Window menu uses exactly these; anything else — `quit`,
 * `toggleDevTools` — is dropped, so a compromised renderer can't inject a role
 * with a built-in action (and default accelerator) behind a harmless label.
 */
const MODEL_ROLES = new Set(['minimize', 'zoom', 'front']);

export interface MenuHandlers {
  /** Runs a command id in the renderer (`menu:run`). */
  run(id: string): void;
  /** Opens a file the user chose in the native dialog. */
  open(): void;
  /** Opens a path from the Open Recent list. */
  openRecent(path: string): void;
  clearRecent(): void;
  /** "Save As…" runs in the renderer, which holds the document. */
  saveAs(): void;
  /** Asks the renderer to save everything, then quit. */
  quit(): void;
  /** Help › Check for Updates… (P6-01 slice 4): an update check in main. */
  checkForUpdates(): void;
}

export interface MenuTemplateOptions {
  recent: RecentEntry[];
  handlers: MenuHandlers;
  platform: NodeJS.Platform;
  /**
   * Whether a project page has registered its `menu:run` handler. With none,
   * Save As… is disabled and Quit quits directly (there is nothing to save).
   */
  menuListening: boolean;
  /**
   * Whether the updater runs (P6-01 slice 4): a packaged build without
   * `EXTRUDO_DISABLE_UPDATES`. Check for Updates… is disabled otherwise.
   */
  updates?: boolean;
}

/** Help's desktop-only entry (P6-01 slice 4), after the model's own Help items. */
export const CHECK_FOR_UPDATES_LABEL = 'Check for Updates…';

function updatesEntry(handlers: MenuHandlers, enabled: boolean): MenuItemConstructorOptions {
  return {
    label: CHECK_FOR_UPDATES_LABEL,
    enabled,
    click: () => handlers.checkForUpdates(),
  };
}

const item = (entry: MenuEntryModel, handlers: MenuHandlers): MenuItemConstructorOptions => {
  if ((entry as { separator?: true }).separator) return { type: 'separator' };
  const model = entry as Exclude<MenuEntryModel, { separator: true }>;
  const menuItem: MenuItemConstructorOptions = {};
  // Every model-derived item: the renderer keeps its own key handling (see the
  // file comment). Set even with no accelerator, so an allowed role's own
  // default accelerator is never registered behind our back (finding 2).
  menuItem.registerAccelerator = false;
  if (model.role) {
    if (!MODEL_ROLES.has(model.role)) {
      // A role the desktop doesn't allow: a plain disabled label, no action.
      menuItem.label = model.label;
      menuItem.enabled = false;
      return menuItem;
    }
    menuItem.role = model.role as MenuItemConstructorOptions['role'];
  }
  if (model.label) menuItem.label = model.label;
  if (model.id) menuItem.click = () => handlers.run(model.id as string);
  if (model.accelerator) menuItem.accelerator = model.accelerator;
  if (model.enabled === false) menuItem.enabled = false;
  return menuItem;
};

function openRecentMenu(
  recent: readonly RecentEntry[],
  handlers: MenuHandlers,
): MenuItemConstructorOptions {
  const submenu: MenuItemConstructorOptions[] = recent.map((entry) => ({
    label: entry.name,
    click: () => handlers.openRecent(entry.path),
  }));
  if (submenu.length > 0) submenu.push({ type: 'separator' });
  submenu.push({
    label: 'Clear Recent',
    enabled: recent.length > 0,
    click: () => handlers.clearRecent(),
  });
  return { label: 'Open Recent', submenu };
}

/** The desktop-only File entries: Open…, Open Recent, Save As…, Quit. */
function desktopFileEntries(
  recent: readonly RecentEntry[],
  handlers: MenuHandlers,
  options: { platform: NodeJS.Platform; menuListening: boolean },
): { open: MenuItemConstructorOptions[]; close: MenuItemConstructorOptions[] } {
  const close: MenuItemConstructorOptions[] = [
    { type: 'separator' },
    {
      label: 'Save As…',
      accelerator: 'CmdOrCtrl+Shift+S',
      // No document open (the home screen): nothing to save as.
      enabled: options.menuListening,
      click: () => handlers.saveAs(),
    },
  ];
  // On macOS Quit lives in the app menu (built below), so File has none.
  if (options.platform !== 'darwin') {
    close.push({ type: 'separator' });
    close.push({ label: 'Quit', accelerator: 'CmdOrCtrl+Q', click: () => handlers.quit() });
  }
  return {
    open: [
      { label: 'Open…', accelerator: 'CmdOrCtrl+O', click: () => handlers.open() },
      openRecentMenu(recent, handlers),
      { type: 'separator' },
    ],
    close,
  };
}

/**
 * The macOS application menu, item by item rather than `role: 'appMenu'`
 * (finding 4): Electron's app menu ships its own raw Quit, which would bypass
 * the renderer's save-then-quit. Ours routes through `handlers.quit()` like the
 * File menu's, and there is no second Quit for the same accelerator.
 */
function appMenu(handlers: MenuHandlers): MenuItemConstructorOptions {
  return {
    label: 'Extrudo',
    submenu: [
      { role: 'about' },
      { type: 'separator' },
      { role: 'services' },
      { type: 'separator' },
      { role: 'hide' },
      { role: 'hideOthers' },
      { role: 'unhide' },
      { type: 'separator' },
      { label: 'Quit Extrudo', accelerator: 'CmdOrCtrl+Q', click: () => handlers.quit() },
    ],
  };
}

/**
 * The whole application menu. On macOS the app menu comes first. The File menu
 * gains the desktop entries; every other menu is the renderer's model
 * unchanged.
 */
export function buildMenuTemplate(
  model: readonly MenuModel[],
  options: MenuTemplateOptions,
): MenuItemConstructorOptions[] {
  const { recent, handlers, platform, menuListening } = options;
  const desktop = desktopFileEntries(recent, handlers, { platform, menuListening });
  const template: MenuItemConstructorOptions[] = [];
  if (platform === 'darwin') template.push(appMenu(handlers));

  let sawFile = false;
  let sawHelp = false;
  const updates = updatesEntry(handlers, options.updates === true);
  for (const menu of model) {
    if (menu.label === 'Help') {
      sawHelp = true;
      const items = menu.items.map((entry) => item(entry, handlers));
      template.push({
        label: 'Help',
        submenu: [...items, ...(items.length > 0 ? [{ type: 'separator' as const }] : []), updates],
      });
      continue;
    }
    if (menu.label === 'File') {
      sawFile = true;
      template.push({
        label: 'File',
        submenu: [
          ...desktop.open,
          ...menu.items.map((entry) => item(entry, handlers)),
          ...desktop.close,
        ],
      });
      continue;
    }
    template.push({ label: menu.label, submenu: menu.items.map((entry) => item(entry, handlers)) });
  }
  if (!sawFile) {
    // The home screen before any project: still open and quit.
    template.push({ label: 'File', submenu: [...desktop.open, ...desktop.close.slice(1)] });
  }
  if (!sawHelp) template.push({ label: 'Help', submenu: [updates] });
  return template;
}
