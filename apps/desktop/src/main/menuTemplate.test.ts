import type { MenuItemConstructorOptions } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import {
  buildMenuTemplate,
  CHECK_FOR_UPDATES_LABEL,
  type MenuHandlers,
  type MenuTemplateOptions,
  QUIT_ID,
  SAVE_AS_ID,
} from './menuTemplate';

const handlers = (): MenuHandlers => ({
  run: vi.fn(),
  open: vi.fn(),
  openRecent: vi.fn(),
  clearRecent: vi.fn(),
  saveAs: vi.fn(),
  quit: vi.fn(),
  checkForUpdates: vi.fn(),
});

const options = (over: Partial<MenuTemplateOptions> = {}): MenuTemplateOptions => ({
  recent: [],
  handlers: handlers(),
  platform: 'linux',
  menuListening: true,
  ...over,
});

const click = (item: MenuItemConstructorOptions) => (item.click as () => void)();

const submenu = (item: MenuItemConstructorOptions | undefined) =>
  (item?.submenu ?? []) as MenuItemConstructorOptions[];

describe('buildMenuTemplate (P6-01 slice 2)', () => {
  const model = [
    {
      label: 'File',
      items: [{ id: 'exportProject', label: 'Export .extrudo' }],
    },
    {
      label: 'Edit',
      items: [{ id: 'undo', label: 'Undo', accelerator: 'CmdOrCtrl+Z' }],
    },
  ];
  const recent = [
    { path: '/tmp/a.extrudo', name: 'a.extrudo' },
    { path: '/tmp/b.extrudo', name: 'b.extrudo' },
  ];

  it('adds the desktop File entries around the model file commands', () => {
    const template = buildMenuTemplate(model, options({ recent }));
    const file = submenu(template.find((m) => m.label === 'File'));
    const labels = file.map((entry) => entry.label ?? entry.type);
    expect(labels).toEqual([
      'Open…',
      'Open Recent',
      'separator',
      'Export .extrudo',
      'separator',
      'Save As…',
      'separator',
      'Quit',
    ]);
    const recentMenu = submenu(file.find((entry) => entry.label === 'Open Recent'));
    expect(recentMenu.map((entry) => entry.label ?? entry.type)).toEqual([
      'a.extrudo',
      'b.extrudo',
      'separator',
      'Clear Recent',
    ]);
  });

  it('wires each click to its handler and tells Electron not to register the key', () => {
    const spy = handlers();
    const template = buildMenuTemplate(model, options({ recent, handlers: spy }));
    const file = submenu(template.find((m) => m.label === 'File'));
    click(file.find((entry) => entry.label === 'Open…') as MenuItemConstructorOptions);
    click(file.find((entry) => entry.label === 'Save As…') as MenuItemConstructorOptions);
    click(file.find((entry) => entry.label === 'Quit') as MenuItemConstructorOptions);
    expect(spy.open).toHaveBeenCalledOnce();
    expect(spy.saveAs).toHaveBeenCalledOnce();
    expect(spy.quit).toHaveBeenCalledOnce();
    expect(SAVE_AS_ID).toBe('desktop:saveAs');
    expect(QUIT_ID).toBe('desktop:quit');

    const recentMenu = submenu(file.find((entry) => entry.label === 'Open Recent'));
    click(recentMenu[0] as MenuItemConstructorOptions);
    click(recentMenu[recentMenu.length - 1] as MenuItemConstructorOptions);
    expect(spy.openRecent).toHaveBeenCalledWith('/tmp/a.extrudo');
    expect(spy.clearRecent).toHaveBeenCalledOnce();

    const edit = submenu(template.find((m) => m.label === 'Edit'));
    const undo = edit[0] as MenuItemConstructorOptions;
    expect(undo.accelerator).toBe('CmdOrCtrl+Z');
    expect(undo.registerAccelerator).toBe(false);
    click(undo);
    expect(spy.run).toHaveBeenCalledWith('undo');
  });

  it('shows a disabled command as a disabled item', () => {
    const disabled = [
      { label: 'Solid', items: [{ id: 'export', label: 'Export', enabled: false }] },
    ];
    const template = buildMenuTemplate(disabled, options());
    const solid = submenu(template.find((m) => m.label === 'Solid'));
    expect(solid[0]?.enabled).toBe(false);
  });

  it('disables Save As… with no document open (finding 4)', () => {
    const noDocument = buildMenuTemplate(model, options({ menuListening: false }));
    const file = submenu(noDocument.find((m) => m.label === 'File'));
    const saveAs = file.find((entry) => entry.label === 'Save As…');
    expect(saveAs?.enabled).toBe(false);
  });

  it('builds the macOS app menu item by item, no role appMenu (finding 4)', () => {
    const spy = handlers();
    const mac = buildMenuTemplate(model, options({ handlers: spy, platform: 'darwin' }));
    expect(mac[0]?.role).toBeUndefined();
    expect(mac[0]?.label).toBe('Extrudo');
    const app = submenu(mac[0]);
    expect(app.map((entry) => entry.role ?? entry.label ?? entry.type)).toEqual([
      'about',
      'separator',
      'services',
      'separator',
      'hide',
      'hideOthers',
      'unhide',
      'separator',
      'Quit Extrudo',
    ]);
    // The app menu's Quit goes through the save-then-quit handler.
    const quit = app.at(-1) as MenuItemConstructorOptions;
    expect(quit.role).toBeUndefined();
    click(quit);
    expect(spy.quit).toHaveBeenCalledOnce();
    // File has no second Quit on macOS.
    const file = submenu(mac.find((m) => m.label === 'File'));
    expect(file.some((entry) => entry.label === 'Quit')).toBe(false);

    const bare = buildMenuTemplate([], options({ platform: 'darwin' }));
    const bareFile = submenu(bare.find((m) => m.label === 'File'));
    expect(bareFile.map((entry) => entry.label ?? entry.type)).toEqual([
      'Open…',
      'Open Recent',
      'separator',
      'Save As…',
    ]);
  });

  it('falls back to a bare File menu on the home screen', () => {
    const bare = buildMenuTemplate([], options());
    const file = submenu(bare.find((m) => m.label === 'File'));
    expect(file.map((entry) => entry.label ?? entry.type)).toEqual([
      'Open…',
      'Open Recent',
      'separator',
      'Save As…',
      'separator',
      'Quit',
    ]);
  });

  it('only accepts the model Window roles and disables any other role (finding 2)', () => {
    const windowMenu = [
      {
        label: 'Window',
        items: [
          { role: 'minimize', label: 'Minimize' },
          { role: 'zoom', label: 'Zoom' },
          { role: 'front', label: 'Bring All to Front' },
        ],
      },
    ];
    const built = buildMenuTemplate(windowMenu, options());
    const items = submenu(built.find((m) => m.label === 'Window'));
    expect(items.map((entry) => entry.role)).toEqual(['minimize', 'zoom', 'front']);
    // A role item never registers its own default accelerator.
    for (const entry of items) expect(entry.registerAccelerator).toBe(false);

    const dangerous = [
      {
        label: 'File',
        items: [
          { role: 'quit', label: 'Save Version…' },
          { role: 'toggleDevTools', label: 'Export' },
        ],
      },
    ];
    const spy = handlers();
    const template = buildMenuTemplate(dangerous, options({ handlers: spy }));
    const file = submenu(template.find((m) => m.label === 'File'));
    const quitLike = file.find((entry) => entry.label === 'Save Version…');
    // Dropped role: a plain disabled label, no action, no role.
    expect(quitLike?.role).toBeUndefined();
    expect(quitLike?.enabled).toBe(false);
    expect(quitLike?.registerAccelerator).toBe(false);
    expect(file.find((entry) => entry.label === 'Export')?.enabled).toBe(false);
    if (quitLike?.click) click(quitLike);
    const exportItem = file.find((entry) => entry.label === 'Export');
    if (exportItem?.click) click(exportItem);
    expect(spy.run).not.toHaveBeenCalled();
  });

  it('adds Help › Check for Updates… after the model Help items (P6-01 slice 4)', () => {
    const spy = handlers();
    const withHelp = [...model, { label: 'Help', items: [{ id: 'tutorial', label: 'Tutorial' }] }];
    const template = buildMenuTemplate(withHelp, options({ handlers: spy, updates: true }));
    const help = submenu(template.find((m) => m.label === 'Help'));
    expect(help.map((entry) => entry.label ?? entry.type)).toEqual([
      'Tutorial',
      'separator',
      CHECK_FOR_UPDATES_LABEL,
    ]);
    const check = help.at(-1) as MenuItemConstructorOptions;
    expect(check.enabled).toBe(true);
    click(check);
    expect(spy.checkForUpdates).toHaveBeenCalledOnce();
    expect(spy.run).not.toHaveBeenCalled();
  });

  it('disables Check for Updates… where the updater does not run, and has it on the home screen', () => {
    const template = buildMenuTemplate([], options({ menuListening: false }));
    const help = submenu(template.find((m) => m.label === 'Help'));
    expect(help.map((entry) => entry.label)).toEqual([CHECK_FOR_UPDATES_LABEL]);
    expect(help[0]?.enabled).toBe(false);
  });
});
