/**
 * The native application menu, built from the command registry (P6-01 slice 2,
 * ADR-0075). This is the pure half: `buildCommands` (ADR-0023) already lists
 * every command the current mode offers with its group and its keys, so the
 * menu is a projection of that list, not a second table of its own. The
 * Electron main process turns the model into a real menu and sends the clicked
 * id back; the renderer runs the command the same way the palette does.
 *
 * Keys stay the renderer's: an item shows its accelerator but Electron is told
 * not to register it (`registerAccelerator: false`), so the web's own keydown
 * handling keeps working and nothing fires twice.
 */
import { DEFAULT_KEYMAP } from '../commands/keymap';
import type { AppCommand } from './commands';
import { visibleTabs } from './tools';

/**
 * The desktop-only command ids main sends back to the renderer (P6-01 slice 2,
 * finding 6). Defined once here and imported by main and the shell, so a
 * rename can't leave one side silently doing nothing.
 */
export const SAVE_AS_ID = 'desktop:saveAs';
export const QUIT_ID = 'desktop:quit';

export interface MenuItemModel {
  /** A command id, or a synthetic desktop id (main maps those to its own work). */
  id?: string;
  /** An Electron role (the macOS Window menu); no id. */
  role?: string;
  label: string;
  accelerator?: string;
  enabled?: boolean;
}

export interface MenuSeparatorModel {
  separator: true;
}

export type MenuEntryModel = MenuItemModel | MenuSeparatorModel;

export interface MenuModel {
  label: string;
  items: MenuEntryModel[];
}

export interface MenuModelOptions {
  /** Whether to add the macOS Window menu (standard roles). */
  mac?: boolean;
}

/**
 * The menu a command belongs to: the leading segment of its group ("Solid › Create" →
 * "Solid"). The Home tab's commands (ADR-0079) are the native File menu, where a desktop
 * app keeps a design's files.
 */
function topMenu(group: string): string {
  const index = group.indexOf(' › ');
  const top = index === -1 ? group : group.slice(0, index);
  return top === HOME_TAB ? 'File' : top;
}

const HOME_TAB = 'Home';

/** The sub-group inside a tab menu ("Solid › Create" → "Create"), for separators. */
function subGroup(group: string): string | undefined {
  const index = group.indexOf(' › ');
  return index === -1 ? undefined : group.slice(index + 3);
}

/**
 * Electron's accelerator for a `Shortcut.keys` string ("Mod+K" → "CmdOrCtrl+K",
 * "Shift+2" → "Shift+2", "Delete" → "Delete"). The keymap uses Mod, Shift and
 * plain keys only, so this maps the modifiers and passes the key through.
 */
export function toAccelerator(keys: string): string {
  const parts = keys.split('+');
  const key = parts.pop() ?? '';
  const modifiers = parts.map((part) => (part === 'Mod' ? 'CmdOrCtrl' : part));
  return [...modifiers, key].join('+');
}

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

/** Whether a keymap form is one Electron's accelerator grammar accepts. */
export function isElectronAccelerator(value: string): boolean {
  const parts = value.split('+');
  const key = parts.pop();
  if (!key) return false;
  const keyOk =
    /^[A-Za-z0-9]$/.test(key) || /^F([1-9]|1[0-9]|2[0-4])$/.test(key) || NAMED_KEYS.has(key);
  return keyOk && parts.every((part) => MODIFIERS.has(part));
}

/** Every accelerator the real keymap produces, for the test that walks it. */
export function keymapAccelerators(): string[] {
  return Object.values(DEFAULT_KEYMAP).flat().map(toAccelerator);
}

const toItem = (command: AppCommand): MenuItemModel => {
  const accelerator = command.keys[0];
  return {
    id: command.id,
    label: command.label,
    ...(accelerator && { accelerator: toAccelerator(accelerator) }),
    ...(command.unavailable && { enabled: false }),
  };
};

/**
 * The menus for the current mode. File (the Home tab), Edit, View (with Panels and
 * Theme folded in), a menu per other visible tab (Solid, Modify, Construct, Inspect or
 * Sketch, 3D Print) and Help,
 * with the macOS Window menu before Help. Commands a mode hides are absent, and
 * an unavailable command is a disabled item.
 */
export function menuModel(
  commands: readonly AppCommand[],
  mode: 'model' | 'sketch',
  options: MenuModelOptions = {},
): MenuModel[] {
  const groups = new Map<string, AppCommand[]>();
  for (const command of commands) {
    const menu = topMenu(command.group);
    const list = groups.get(menu);
    if (list) list.push(command);
    else groups.set(menu, [command]);
  }

  const tabOrder = visibleTabs(mode)
    .map((tab) => tab.label)
    .filter((label) => label !== HOME_TAB);
  const order = ['File', 'Edit', 'View', ...tabOrder, ...(options.mac ? ['Window'] : []), 'Help'];

  const menus: MenuModel[] = [];
  for (const label of order) {
    if (label === 'View') {
      // Panels and Theme are their own command groups but belong under View.
      const items = [
        ...entries(groups.get('View') ?? []),
        ...separated(groups.get('Panels')),
        ...separated(groups.get('Theme')),
      ];
      menus.push({ label, items: trimSeparators(items) });
      continue;
    }
    if (label === 'Window') {
      menus.push({ label, items: windowMenu() });
      continue;
    }
    menus.push({ label, items: entries(groups.get(label) ?? []) });
  }
  return menus.filter((menu) => menu.items.length > 0);
}

/** A menu's commands, with a separator between sub-groups ("Create", "Modify"). */
function entries(commands: readonly AppCommand[]): MenuEntryModel[] {
  const items: MenuEntryModel[] = [];
  let last: string | undefined;
  for (const command of commands) {
    const sub = subGroup(command.group);
    if (last !== undefined && sub !== last) items.push({ separator: true });
    last = sub;
    items.push(toItem(command));
  }
  return items;
}

/** A block (Panels, Theme) preceded by a separator, when it has anything. */
function separated(commands: readonly AppCommand[] | undefined): MenuEntryModel[] {
  if (!commands || commands.length === 0) return [];
  return [{ separator: true }, ...entries(commands)];
}

function windowMenu(): MenuEntryModel[] {
  return [
    { role: 'minimize', label: 'Minimize' },
    { role: 'zoom', label: 'Zoom' },
    { separator: true },
    { role: 'front', label: 'Bring All to Front' },
  ];
}

/** Drops leading, trailing and doubled separators (a folded menu can leave gaps). */
function trimSeparators(items: MenuEntryModel[]): MenuEntryModel[] {
  const out: MenuEntryModel[] = [];
  for (const item of items) {
    const separator = (item as MenuSeparatorModel).separator === true;
    if (separator) {
      const previous = out[out.length - 1];
      if (out.length === 0 || (previous as MenuSeparatorModel | undefined)?.separator === true) {
        continue;
      }
    }
    out.push(item);
  }
  while ((out[out.length - 1] as MenuSeparatorModel | undefined)?.separator === true) out.pop();
  return out;
}
