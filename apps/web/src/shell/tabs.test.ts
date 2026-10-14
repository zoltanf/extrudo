import { describe, expect, it, vi } from 'vitest';
import { memoryPreferences } from '../platform/preferences';
import { createViewportStore } from '../viewport/store';
import { buildCommands, type CommandContext } from './commands';
import { menuModel } from './menuModel';
import { defaultTab, FILE_COMMANDS, TABS, TOOLS, tabOfTool, visibleTabs } from './tools';

const labels = (mode: 'model' | 'sketch') => visibleTabs(mode).map((t) => t.label);

describe('visibleTabs (ADR-0079 §2)', () => {
  it('shows Home, Solid, Modify, Construct and 3D Print in the model (R3-10: no Inspect tab)', () => {
    expect(labels('model')).toEqual(['Home', 'Solid', 'Modify', 'Construct', '3D Print']);
    const construct = TABS.find((t) => t.id === 'construct');
    expect(construct?.groups.map((g) => g.label)).toEqual(['Planes', 'Axes', 'Points', 'Inspect']);
    expect(construct?.groups.at(-1)?.tools).toEqual(['measure', 'section']);
  });

  it('replaces the model tabs with Sketch while a sketch is open, 3D Print too (R3-11)', () => {
    expect(labels('sketch')).toEqual(['Home', 'Sketch']);
    expect(tabOfTool('printInfo', 'sketch')).toBeUndefined();
    expect(tabOfTool('exportSketch', 'sketch')).toBe('sketch');
  });

  it('opens on Solid in the model and Sketch in a sketch', () => {
    expect(defaultTab('model')).toBe('solid');
    expect(defaultTab('sketch')).toBe('sketch');
    for (const mode of ['model', 'sketch'] as const) {
      expect(visibleTabs(mode).some((t) => t.id === defaultTab(mode))).toBe(true);
    }
  });

  it('has no Insert tab, and Home has Import and Export groups instead of Files (R3-09)', () => {
    expect(TABS.some((t) => t.label === 'Insert')).toBe(false);
    const home = TABS.find((t) => t.id === 'home');
    expect(home?.groups.map((g) => g.label)).toEqual([
      'Design',
      'Versions',
      'Import',
      'Export',
      'Parameters',
    ]);
    const group = (label: string) => home?.groups.find((g) => g.label === label)?.tools;
    expect(group('Import')).toEqual(['importProject', 'importBody', 'importDrawing', 'canvas']);
    expect(group('Export')).toEqual([
      'exportProject',
      'export',
      'exportScript',
      'saveToLinkedFolder',
    ]);
  });

  it('puts every Home file command in the Home tab, with a file icon; Plugins in the app menu', () => {
    const home = TABS.find((t) => t.id === 'home');
    const ids = home?.groups.flatMap((g) => [...g.tools, ...(g.more ?? [])]) ?? [];
    for (const id of Object.keys(FILE_COMMANDS)) {
      expect(TOOLS[id as keyof typeof TOOLS].category).toBe('file');
      // R3-12: Plugins is an item of the app menu and a Ctrl+K command, not a tile.
      if (id === 'plugins') expect(ids).not.toContain(id);
      else expect(ids).toContain(id);
    }
    expect(TABS.some((t) => t.groups.some((g) => g.label === 'Extend'))).toBe(false);
  });

  it('finds the tab that holds a tool', () => {
    expect(tabOfTool('fillet', 'model')).toBe('modify');
    expect(tabOfTool('offsetPlane', 'model')).toBe('construct');
    expect(tabOfTool('measure', 'model')).toBe('construct');
    expect(tabOfTool('section', 'model')).toBe('construct');
    expect(tabOfTool('planeAlongPath', 'model')).toBe('construct');
    expect(tabOfTool('parameters', 'sketch')).toBe('home');
    expect(tabOfTool('line', 'sketch')).toBe('sketch');
    expect(tabOfTool('fillet', 'sketch')).toBeUndefined();
  });
});

describe('the desktop menu (ADR-0075 slice 2) after ADR-0079', () => {
  const context = (mode: 'model' | 'sketch'): CommandContext => ({
    mode,
    runTool: vi.fn(),
    notify: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    viewport: createViewportStore({ preferences: memoryPreferences(), reducedMotion: () => true }),
    browser: { collapsed: false, toggle: vi.fn() },
    file: {
      newDesign: vi.fn(),
      home: vi.fn(),
      exportFile: vi.fn(),
      importFile: vi.fn(),
      saveVersion: vi.fn(),
      versionHistory: vi.fn(),
      exportScript: vi.fn(),
      saveToLinkedFolder: vi.fn(),
      plugins: vi.fn(),
    },
    theme: { choice: 'dark', set: vi.fn() },
  });

  it.each(['model', 'sketch'] as const)('still lists every %s command, Home as File', (mode) => {
    const commands = buildCommands(context(mode));
    const menus = menuModel(commands, mode);
    const listed = new Set(
      menus.flatMap((m) => m.items.flatMap((i) => ('id' in i && i.id ? [i.id] : []))),
    );
    expect(commands.map((c) => c.id).filter((id) => !listed.has(id))).toEqual([]);
    expect(menus[0]?.label).toBe('File');
    expect(menus.map((m) => m.label)).not.toContain('Home');
    const ids = (label: string) =>
      menus
        .find((m) => m.label === label)
        ?.items.flatMap((i) => ('id' in i && i.id ? [i.id] : [])) ?? [];
    expect(ids('File')).toEqual(
      expect.arrayContaining(['newDesign', 'saveVersion', 'exportProject']),
    );
    // Plugins… is beside Settings… (R3-12): in View's Panels, which the macOS template moves
    // into the app menu.
    expect(ids('File')).not.toContain('plugins');
    expect(ids('View')).toContain('plugins');
  });
});
