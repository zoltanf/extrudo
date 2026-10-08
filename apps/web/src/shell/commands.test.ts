import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_KEYMAP } from '../commands/keymap';
import { memoryPreferences } from '../platform/preferences';
import { createViewportStore } from '../viewport/store';
import { buildCommands, type CommandContext, commandShortcuts } from './commands';

function context(mode: 'model' | 'sketch', over: Partial<CommandContext> = {}): CommandContext {
  return {
    mode,
    runTool: vi.fn(),
    notify: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    ...(mode === 'sketch' && {
      remove: vi.fn(),
      construction: { on: false, toggle: vi.fn() },
      lookAtSketch: vi.fn(),
    }),
    viewport: createViewportStore({ preferences: memoryPreferences(), reducedMotion: () => true }),
    browser: { collapsed: false, toggle: vi.fn() },
    file: {
      newDesign: vi.fn(),
      home: vi.fn(),
      exportFile: vi.fn(),
      importFile: vi.fn(),
      saveVersion: vi.fn(),
      versionHistory: vi.fn(),
    },
    theme: { choice: 'dark', set: vi.fn() },
    ...over,
  };
}

const byId = (ctx: CommandContext) => new Map(buildCommands(ctx).map((c) => [c.id, c]));

describe('buildCommands', () => {
  it.each(['model', 'sketch'] as const)('gives no key to two commands in %s mode', (mode) => {
    const keys = commandShortcuts(buildCommands(context(mode))).map((s) => s.keys);
    expect(keys.filter((k, i) => keys.indexOf(k) !== i)).toEqual([]);
    expect(keys.length).toBeGreaterThan(10);
  });

  it('offers every command in the keymap in some mode', () => {
    const ids = new Set([
      ...buildCommands(context('model')).map((c) => c.id),
      ...buildCommands(context('sketch')).map((c) => c.id),
      // The shell opens these two itself.
      'commandPalette',
      'toolbox',
    ]);
    expect(Object.keys(DEFAULT_KEYMAP).filter((id) => !ids.has(id))).toEqual([]);
  });

  it('offers Record Macro, then only Stop Macro while recording (P5-05)', () => {
    const idle = byId(context('model'));
    expect(idle.get('recordMacro')?.group).toBe('Solid › Create');
    expect(idle.has('stopMacro')).toBe(false);
    const recording = byId(context('model', { macro: { recording: true } }));
    expect(recording.has('recordMacro')).toBe(false);
    expect(recording.get('stopMacro')?.group).toBe('Solid › Create');
    expect(byId(context('sketch')).has('recordMacro')).toBe(false);
  });

  it('offers Export Design as Script in the File group of the model (P5-05)', () => {
    const exportScript = vi.fn();
    const ctx = context('model');
    const commands = byId({ ...ctx, file: { ...ctx.file, exportScript } });
    commands.get('exportScript')?.run();
    expect(commands.get('exportScript')?.group).toBe('File');
    expect(exportScript).toHaveBeenCalled();
    expect(byId(ctx).has('exportScript')).toBe(false);
  });

  it("offers Plugins… in the File group, and the enabled plugins' commands in the model only (P6-03)", () => {
    const plugins = vi.fn();
    const ctx = context('model');
    const run = vi.fn();
    const command = {
      id: 'plugin:name-plate:three-holes',
      label: 'Three holes',
      hint: 'Cuts three holes',
      group: 'Plugins › Name plate',
      run,
    };
    const model = byId({ ...ctx, file: { ...ctx.file, plugins }, plugins: [command] });
    expect(model.get('plugins')).toMatchObject({ label: 'Plugins…', group: 'File', keys: [] });
    model.get('plugins')?.run();
    expect(plugins).toHaveBeenCalled();
    const offered = model.get('plugin:name-plate:three-holes');
    expect(offered).toMatchObject({
      label: 'Three holes',
      group: 'Plugins › Name plate',
      keys: [],
    });
    expect(offered?.keywords).toContain('Cuts three holes');
    offered?.run();
    expect(run).toHaveBeenCalled();
    // A plugin's commands are the model's: a sketch doesn't list them.
    const sketch = byId({ ...context('sketch'), plugins: [command] });
    expect(sketch.has('plugin:name-plate:three-holes')).toBe(false);
    expect(byId(ctx).has('plugins')).toBe(false);
  });

  it('offers Save Version on Ctrl+S and Version History in both modes (P2-14)', () => {
    for (const mode of ['model', 'sketch'] as const) {
      const commands = byId(context(mode));
      expect(commands.get('saveVersion')).toMatchObject({ group: 'File', keys: ['Mod+S'] });
      expect(commands.get('versionHistory')?.group).toBe('File');
    }
  });

  it('offers the Sketch tab in a sketch and the Solid tab outside one', () => {
    const model = byId(context('model'));
    const sketch = byId(context('sketch'));
    expect(model.has('line')).toBe(false);
    expect(model.get('sketch')?.group).toBe('Solid › Create');
    expect(sketch.has('sketch')).toBe(false);
    expect(sketch.get('rectangle3')).toMatchObject({ group: 'Sketch › Create', keys: [] });
    expect(sketch.get('line')?.keys).toEqual(['L']);
    // F is Fillet on the model, Sketch Fillet in a sketch.
    expect(model.get('fillet')?.keys).toEqual(['F']);
    expect(sketch.get('sketchFillet')?.keys).toEqual(['F']);
    expect(sketch.has('fillet')).toBe(false);
    // Parameters on both tabs, Finish Sketch in a sketch; Delete only where something can be deleted.
    expect(model.get('parameters')?.group).toBe('Solid › Modify');
    expect(sketch.get('parameters')?.group).toBe('Sketch › Modify');
    expect(sketch.has('finishSketch')).toBe(true);
    expect(model.has('delete')).toBe(false);
    expect(sketch.get('delete')?.keys).toEqual(['Delete', 'Backspace']);
  });

  it('offers the Customizer beside Parameters, with no key (P4-07)', () => {
    const model = byId(context('model'));
    expect(model.get('customizer')).toMatchObject({
      label: 'Customizer',
      group: 'Solid › Modify',
      keys: [],
    });
    expect(model.get('customizer')?.unavailable).toBeUndefined();
    // It works on the model only, so it isn't in the Sketch tab.
    expect(byId(context('sketch')).has('customizer')).toBe(false);
  });

  it('starts tools through the context', () => {
    const ctx = context('sketch');
    byId(ctx).get('line')?.run();
    expect(ctx.runTool).toHaveBeenCalledWith('line');
  });

  it('offers the Tolerance panel from the 3D Print tab, with no key (P4-08)', () => {
    const ctx = context('model');
    expect(byId(ctx).get('tolerance')).toMatchObject({
      label: 'Tolerance',
      group: '3D Print › Prepare',
      keys: [],
    });
    expect(byId(ctx).get('tolerance')?.unavailable).toBeUndefined();
    byId(ctx).get('tolerance')?.run();
    expect(ctx.runTool).toHaveBeenCalledWith('tolerance');
  });

  it('says when a tool arrives instead of running it (Send to Slicer on the web)', () => {
    const ctx = context('model');
    const slicer = byId(ctx).get('slicer');
    expect(slicer?.unavailable).toBe('Arrives with the desktop app.');
    slicer?.run();
    expect(ctx.runTool).not.toHaveBeenCalled();
    expect(ctx.notify).toHaveBeenCalledWith('info', 'Send to Slicer arrives with the desktop app.');
  });

  it('runs Send to Slicer where the platform can launch one (P6-02), and a ready tool in general (P2-05)', () => {
    const ctx = context('model', { ready: new Set(['slicer']) });
    const slicer = byId(ctx).get('slicer');
    expect(slicer?.unavailable).toBeUndefined();
    slicer?.run();
    expect(ctx.runTool).toHaveBeenCalledWith('slicer');
  });

  it('runs Revolve (P2-07)', () => {
    const ctx = context('model');
    const revolve = byId(ctx).get('revolve');
    expect(revolve?.unavailable).toBeUndefined();
    revolve?.run();
    expect(ctx.runTool).toHaveBeenCalledWith('revolve');
  });

  it('runs Extrude with E (P2-06)', () => {
    const ctx = context('model');
    const extrude = byId(ctx).get('extrude');
    expect(extrude?.unavailable).toBeUndefined();
    expect(extrude?.keys).toEqual(['E']);
    extrude?.run();
    expect(ctx.runTool).toHaveBeenCalledWith('extrude');
  });

  it("lists feature dialogs' own commands in model mode only", () => {
    const own = { id: 'debugPress', label: 'Press (test)', group: 'Debug', keys: [], run: vi.fn() };
    expect(byId(context('model', { dialogCommands: [own] })).get('debugPress')).toBe(own);
    expect(byId(context('sketch', { dialogCommands: [own] })).has('debugPress')).toBe(false);
  });

  it('turns the camera to the standard views', () => {
    const ctx = context('model');
    const lookFrom = vi.spyOn(ctx.viewport.getState(), 'lookFrom');
    byId(ctx).get('viewTop')?.run();
    expect(lookFrom).toHaveBeenCalledWith([0, 0, 1]);
    expect(byId(ctx).get('viewHome')?.keys).toEqual(['Shift+1']);
  });

  it('names panel toggles by what they do and leaves out the current theme', () => {
    const commands = byId(context('model', { browser: { collapsed: true, toggle: vi.fn() } }));
    expect(commands.get('toggleBrowser')?.label).toBe('Show Browser');
    expect(commands.has('toggleTimeline')).toBe(false);
    expect(commands.has('theme-dark')).toBe(false);
    expect(commands.has('theme-light')).toBe(true);
  });

  it('lists each command once', () => {
    for (const mode of ['model', 'sketch'] as const) {
      const ids = buildCommands(context(mode)).map((c) => c.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('offers Notification History where the toasts have one (P3-16), without a key clash', () => {
    const open = vi.fn();
    for (const mode of ['model', 'sketch'] as const) {
      expect(byId(context(mode)).has('notificationHistory')).toBe(false);
      const command = byId(context(mode, { notifications: { open } })).get('notificationHistory');
      expect(command).toMatchObject({ label: 'Notification History', group: 'Panels' });
      command?.run();
    }
    expect(open).toHaveBeenCalledTimes(2);
  });

  it('offers the Tutorial in Ctrl+K in both modes, found by its keywords (P3-12)', () => {
    const start = vi.fn();
    for (const mode of ['model', 'sketch'] as const) {
      expect(byId(context(mode)).has('tutorial')).toBe(false);
      const command = byId(context(mode, { tutorial: { start } })).get('tutorial');
      expect(command).toMatchObject({ label: 'Tutorial', group: 'Help', keys: [] });
      expect(command?.keywords).toContain('tour');
      command?.run();
    }
    expect(start).toHaveBeenCalledTimes(2);
  });

  it('offers Save to Linked Folder only where a folder is linked and the project is not (P4-09)', () => {
    // No folder linked (Firefox, Safari), or this project already is: no command.
    expect(byId(context('model')).has('saveToLinkedFolder')).toBe(false);
    const saveToLinkedFolder = vi.fn();
    const ctx = context('model', {
      file: { ...context('model').file, saveToLinkedFolder },
    });
    const command = byId(ctx).get('saveToLinkedFolder');
    expect(command).toMatchObject({ label: 'Save to Linked Folder', group: 'File', keys: [] });
    expect(command?.keywords).toContain('folder');
    command?.run();
    expect(saveToLinkedFolder).toHaveBeenCalledOnce();
  });
});
