import { describe, expect, it, vi } from 'vitest';
import type { AppCommand } from './commands';
import {
  isElectronAccelerator,
  keymapAccelerators,
  type MenuSeparatorModel,
  menuModel,
  toAccelerator,
} from './menuModel';

const command = (
  id: string,
  label: string,
  group: string,
  keys: string[] = [],
  extra: Partial<AppCommand> = {},
): AppCommand => ({ id, label, group, keys, run: vi.fn(), ...extra });

const separator = { separator: true } satisfies MenuSeparatorModel;

describe('toAccelerator (P6-01 slice 2)', () => {
  it('maps Mod to CmdOrCtrl and passes the key through', () => {
    expect(toAccelerator('Mod+K')).toBe('CmdOrCtrl+K');
    expect(toAccelerator('Mod+Shift+Z')).toBe('CmdOrCtrl+Shift+Z');
    expect(toAccelerator('Shift+2')).toBe('Shift+2');
    expect(toAccelerator('F6')).toBe('F6');
    expect(toAccelerator('Delete')).toBe('Delete');
    expect(toAccelerator('L')).toBe('L');
  });

  it('turns every key the real keymap declares into a valid accelerator', () => {
    const accelerators = keymapAccelerators();
    expect(accelerators.length).toBeGreaterThan(20);
    for (const accelerator of accelerators) {
      expect(accelerator).not.toContain('Mod');
      expect(isElectronAccelerator(accelerator), accelerator).toBe(true);
    }
  });

  it('rejects malformed accelerators', () => {
    expect(isElectronAccelerator('Mod+K')).toBe(false);
    expect(isElectronAccelerator('CmdOrCtrl+')).toBe(false);
    expect(isElectronAccelerator('CmdOrCtrl+Escape')).toBe(true);
    expect(isElectronAccelerator('CmdOrCtrl+What')).toBe(false);
  });
});

describe('menuModel (P6-01 slice 2)', () => {
  const commands: AppCommand[] = [
    command('extrude', 'Extrude', 'Solid › Create', ['E']),
    command('extrude2', 'Revolve', 'Solid › Create'),
    command('box', 'Box', 'Solid › Primitives', ['B']),
    command('fillet', 'Fillet', 'Modify › Modify', ['F']),
    command('importBody', 'Import', 'Home › Files'),
    command('export', 'Export', '3D Print › Output', [], { unavailable: 'Arrives later.' }),
    command('undo', 'Undo', 'Edit', ['Mod+Z']),
    command('redo', 'Redo', 'Edit', ['Mod+Y'], { unavailable: 'Nothing to redo.' }),
    command('fit', 'Fit', 'View', ['F6']),
    command('viewTop', 'Top View', 'View', ['Shift+2']),
    command('toggleBrowser', 'Hide Browser', 'Panels'),
    command('theme-light', 'Light Theme', 'Theme'),
    command('saveVersion', 'Save Version…', 'Home › Versions', ['Mod+S']),
    command('exportProject', 'Export .extrudo', 'Home › Files'),
    command('tutorial', 'Tutorial', 'Help'),
  ];

  it('groups commands into File, Edit, View, tabs and Help, in order', () => {
    const menus = menuModel(commands, 'model');
    expect(menus.map((m) => m.label)).toEqual([
      'File',
      'Edit',
      'View',
      'Solid',
      'Modify',
      '3D Print',
      'Help',
    ]);
  });

  it('makes the Home tab the native File menu (ADR-0079)', () => {
    const file = menuModel(commands, 'model').find((m) => m.label === 'File');
    expect(file?.items).toEqual([
      { id: 'importBody', label: 'Import' },
      { separator: true },
      { id: 'saveVersion', label: 'Save Version…', accelerator: 'CmdOrCtrl+S' },
      { separator: true },
      { id: 'exportProject', label: 'Export .extrudo' },
    ]);
    expect(menuModel(commands, 'model').some((m) => m.label === 'Home')).toBe(false);
  });

  it('folds Panels and Theme under View, separated from the view commands', () => {
    const view = menuModel(commands, 'model').find((m) => m.label === 'View');
    expect(view?.items.map((i) => ('label' in i ? i.label : '—'))).toEqual([
      'Fit',
      'Top View',
      '—',
      'Hide Browser',
      '—',
      'Light Theme',
    ]);
  });

  it('separates the sub-groups inside a tab menu and maps keys and unavailability', () => {
    const solid = menuModel(commands, 'model').find((m) => m.label === 'Solid');
    expect(solid?.items).toEqual([
      { id: 'extrude', label: 'Extrude', accelerator: 'E' },
      { id: 'extrude2', label: 'Revolve' },
      { separator: true },
      { id: 'box', label: 'Box', accelerator: 'B' },
    ]);
    // "Create" and "Primitives" are two sub-groups: a separator between them.
    expect(solid?.items[2]).toEqual({ separator: true });
    const print = menuModel(commands, 'model').find((m) => m.label === '3D Print');
    expect(print?.items).toEqual([{ id: 'export', label: 'Export', enabled: false }]);
    const edit = menuModel(commands, 'model').find((m) => m.label === 'Edit');
    expect(edit?.items).toEqual([
      { id: 'undo', label: 'Undo', accelerator: 'CmdOrCtrl+Z' },
      { id: 'redo', label: 'Redo', accelerator: 'CmdOrCtrl+Y', enabled: false },
    ]);
  });

  it('offers only the sketch tab in sketch mode, and the macOS Window menu', () => {
    const sketch = [
      command('line', 'Line', 'Sketch › Create', ['L']),
      command('finishSketch', 'Finish Sketch', 'Sketch › Finish'),
      command('undo', 'Undo', 'Edit', ['Mod+Z']),
    ];
    expect(menuModel(sketch, 'sketch').map((m) => m.label)).toEqual(['Edit', 'Sketch']);
    const withWindow = menuModel(sketch, 'sketch', { mac: true }).map((m) => m.label);
    expect(withWindow).toEqual(['Edit', 'Sketch', 'Window']);
    const window = menuModel(sketch, 'sketch', { mac: true }).find((m) => m.label === 'Window');
    expect(window?.items).toContainEqual({ role: 'minimize', label: 'Minimize' });
  });

  it('leaves out a menu with no commands and never starts or ends with a separator', () => {
    const menus = menuModel([command('undo', 'Undo', 'Edit', ['Mod+Z'])], 'model');
    expect(menus.map((m) => m.label)).toEqual(['Edit']);
    for (const menu of menus) {
      expect(menu.items[0]).not.toEqual(separator);
      expect(menu.items[menu.items.length - 1]).not.toEqual(separator);
    }
  });
});
