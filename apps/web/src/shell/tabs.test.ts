import { describe, expect, it, vi } from 'vitest';
import { memoryPreferences } from '../platform/preferences';
import { createViewportStore } from '../viewport/store';
import { buildCommands, type CommandContext } from './commands';
import { menuModel } from './menuModel';
import { defaultTab, FILE_COMMANDS, TABS, TOOLS, tabOfTool, visibleTabs } from './tools';

const labels = (mode: 'model' | 'sketch') => visibleTabs(mode).map((t) => t.label);

describe('visibleTabs (ADR-0079 §2)', () => {
  it('shows Home, Solid, Modify, Construct, Inspect and 3D Print in the model', () => {
    expect(labels('model')).toEqual([
      'Home',
      'Solid',
      'Modify',
      'Construct',
      'Inspect',
      '3D Print',
    ]);
  });

  it('replaces the model tabs with Sketch while a sketch is open', () => {
    expect(labels('sketch')).toEqual(['Home', 'Sketch', '3D Print']);
  });

  it('opens on Solid in the model and Sketch in a sketch', () => {
    expect(defaultTab('model')).toBe('solid');
    expect(defaultTab('sketch')).toBe('sketch');
    for (const mode of ['model', 'sketch'] as const) {
      expect(visibleTabs(mode).some((t) => t.id === defaultTab(mode))).toBe(true);
    }
  });

  it('has no Insert tab: its tools are in Home › Files', () => {
    expect(TABS.some((t) => t.label === 'Insert')).toBe(false);
    const files = TABS.find((t) => t.id === 'home')?.groups.find((g) => g.label === 'Files');
    expect(files?.tools).toEqual(expect.arrayContaining(['importBody', 'importDrawing', 'canvas']));
  });

  it('puts every Home file command in the Home tab, with a file icon', () => {
    const home = TABS.find((t) => t.id === 'home');
    const ids = home?.groups.flatMap((g) => [...g.tools, ...(g.more ?? [])]) ?? [];
    for (const id of Object.keys(FILE_COMMANDS)) {
      expect(ids).toContain(id);
      expect(TOOLS[id as keyof typeof TOOLS].category).toBe('file');
    }
  });

  it('finds the tab that holds a tool', () => {
    expect(tabOfTool('fillet', 'model')).toBe('modify');
    expect(tabOfTool('offsetPlane', 'model')).toBe('construct');
    expect(tabOfTool('measure', 'model')).toBe('inspect');
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
    const file = menus[0]?.items.flatMap((i) => ('id' in i && i.id ? [i.id] : [])) ?? [];
    expect(file).toEqual(
      expect.arrayContaining(['newDesign', 'saveVersion', 'exportProject', 'plugins']),
    );
  });
});
