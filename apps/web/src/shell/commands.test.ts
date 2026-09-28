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
    timeline: { collapsed: false, toggle: vi.fn() },
    file: { newDesign: vi.fn(), home: vi.fn(), exportFile: vi.fn(), importFile: vi.fn() },
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

  it('starts tools through the context', () => {
    const ctx = context('sketch');
    byId(ctx).get('line')?.run();
    expect(ctx.runTool).toHaveBeenCalledWith('line');
  });

  it('says when a tool arrives instead of running it', () => {
    const ctx = context('model');
    const shell = byId(ctx).get('shell');
    expect(shell?.unavailable).toBe('Arrives with P3-03.');
    shell?.run();
    expect(ctx.runTool).not.toHaveBeenCalled();
    expect(ctx.notify).toHaveBeenCalledWith('info', 'Shell arrives with P3-03.');
  });

  it('runs a tool a registered feature dialog makes ready (P2-05)', () => {
    const ctx = context('model', { ready: new Set(['shell']) });
    const shell = byId(ctx).get('shell');
    expect(shell?.unavailable).toBeUndefined();
    shell?.run();
    expect(ctx.runTool).toHaveBeenCalledWith('shell');
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
    expect(commands.get('toggleTimeline')?.label).toBe('Hide Timeline');
    expect(commands.has('theme-dark')).toBe(false);
    expect(commands.has('theme-light')).toBe(true);
  });

  it('lists each command once', () => {
    for (const mode of ['model', 'sketch'] as const) {
      const ids = buildCommands(context(mode)).map((c) => c.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});
