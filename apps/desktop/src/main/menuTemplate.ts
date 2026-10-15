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
  options: { menuListening: boolean },
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
  // Quit lives in the macOS app menu (built below), so File has none.
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
 * The model's commands that macOS keeps in the application menu, after About: Settings…
 * (ADR-0082) and Plugins… (the owner's UI review 3, R3-12: Plugins left the Home tab, which
 * is the File menu, for the Settings menu). The renderer files both under View's Panels;
 * the template takes them out of there.
 */
export const APP_MENU_IDS: ReadonlySet<string> = new Set(['openSettings', 'plugins']);

/**
 * The `about` command's id (ADR-0085): the app menu's About Extrudo runs it in the
 * renderer, which opens its own dialog (a project page through its command, the
 * home screen through a `menu:run` listener). The model's own Help entry is left out.
 */
export const ABOUT_ID = 'about';

/**
 * The macOS application menu, item by item rather than `role: 'appMenu'`
 * (finding 4): Electron's app menu ships its own raw Quit, which would bypass
 * the renderer's save-then-quit. Ours routes through `handlers.quit()` like the
 * File menu's, and there is no second Quit for the same accelerator.
 */
function appMenu(
  handlers: MenuHandlers,
  own: readonly MenuItemConstructorOptions[] = [],
): MenuItemConstructorOptions {
  return {
    label: 'Extrudo',
    submenu: [
      { label: 'About Extrudo', click: () => handlers.run(ABOUT_ID) },
      { type: 'separator' },
      ...(own.length > 0 ? [...own, { type: 'separator' as const }] : []),
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

/** A menu without the items the app menu takes, and without the separators that leaves stray. */
function withoutAppItems(menu: MenuModel): MenuModel {
  const kept = menu.items.filter(
    (entry) => !('id' in entry && (APP_MENU_IDS.has(entry.id ?? '') || entry.id === ABOUT_ID)),
  );
  const items: MenuEntryModel[] = [];
  for (const entry of kept) {
    const separator = (entry as { separator?: true }).separator === true;
    const last = items[items.length - 1] as { separator?: true } | undefined;
    if (separator && (items.length === 0 || last?.separator === true)) continue;
    items.push(entry);
  }
  while ((items[items.length - 1] as { separator?: true } | undefined)?.separator === true)
    items.pop();
  return { label: menu.label, items };
}

/**
 * Whether this platform has an application menu at all (ADR-0075's 2026-10-09
 * amendment). macOS keeps its menu, which is the system menu bar. On Windows and
 * Linux there is none: every command is in the app's own top bar, and the five
 * things only the menu had (Open…, Open Recent, Save As…, Check for Updates…,
 * Quit) are commands there too. Main sets no menu and ignores `menu:set`.
 */
export const hasApplicationMenu = (platform: NodeJS.Platform): boolean => platform === 'darwin';

/**
 * The whole application menu: macOS only, empty elsewhere. The app menu comes
 * first. The File menu gains the desktop entries; every other menu is the
 * renderer's model unchanged.
 */
export function buildMenuTemplate(
  model: readonly MenuModel[],
  options: MenuTemplateOptions,
): MenuItemConstructorOptions[] {
  const { recent, handlers, platform, menuListening } = options;
  if (!hasApplicationMenu(platform)) return [];
  const desktop = desktopFileEntries(recent, handlers, { menuListening });
  // Settings… and Plugins… go to the app menu, in that order, wherever the model put them.
  const own = [...APP_MENU_IDS].flatMap((id) => {
    for (const menu of model) {
      const found = menu.items.find((entry) => 'id' in entry && entry.id === id);
      if (found) return [item(found, handlers)];
    }
    return [];
  });
  const template: MenuItemConstructorOptions[] = [appMenu(handlers, own)];

  let sawFile = false;
  let sawHelp = false;
  const updates = updatesEntry(handlers, options.updates === true);
  for (const source of model) {
    const menu = withoutAppItems(source);
    if (menu.items.length === 0) continue;
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
