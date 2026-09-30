import { describe, expect, it, vi } from 'vitest';
import { memoryPreferences } from '../platform/preferences';
import { type AppCommand, buildCommands, type CommandContext } from '../shell/commands';
import { createViewportStore } from '../viewport/store';
import { isRepeatable, MODEL_SLOTS, resolveSlots, SKETCH_SLOTS } from './marking';

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

const slot = (specs: typeof MODEL_SLOTS, command: string) =>
  specs.findIndex((s) => s.command === command);

describe('the slot tables', () => {
  it('have eight wedges each, no command twice', () => {
    for (const table of [MODEL_SLOTS, SKETCH_SLOTS]) {
      expect(table).toHaveLength(8);
      expect(new Set(table.map((s) => s.command)).size).toBe(8);
    }
  });

  it('hold the eight commands of the UI spec in the model', () => {
    expect(MODEL_SLOTS.map((s) => s.command).sort()).toEqual(
      ['repeatLast', 'delete', 'pressPull', 'undo', 'sketch', 'extrude', 'fillet', 'move'].sort(),
    );
  });

  it('keep Undo in the same wedge in both modes', () => {
    expect(slot(SKETCH_SLOTS, 'undo')).toBe(slot(MODEL_SLOTS, 'undo'));
  });

  it('name real commands: every ID is a tool, a keymap command or one the menu adds', () => {
    const offered = new Set([
      ...buildCommands(context('model', { repeat: { id: 'extrude' } })).map((c) => c.id),
      ...buildCommands(context('sketch', { repeat: { id: 'line' } })).map((c) => c.id),
    ]);
    for (const s of [...MODEL_SLOTS, ...SKETCH_SLOTS]) {
      expect(offered.has(s.command) || s.command === 'delete').toBe(true);
      expect(s.comesWith).toBeUndefined();
    }
  });
});

describe('resolveSlots', () => {
  const model = (over: Partial<CommandContext> = {}) =>
    resolveSlots(MODEL_SLOTS, buildCommands(context('model', over)));

  it('lights the wedges whose commands are offered', () => {
    const slots = model({ repeat: { id: 'extrude' }, remove: vi.fn() });
    const by = (id: string) => slots[slot(MODEL_SLOTS, id)];
    expect(by('sketch')).toMatchObject({ disabled: false, label: 'Sketch' });
    expect(by('extrude')).toMatchObject({ disabled: false, label: 'Extrude' });
    expect(by('undo')?.disabled).toBe(false);
    expect(by('move')).toMatchObject({ disabled: false, label: 'Move' });
    expect(by('delete')?.disabled).toBe(false);
    expect(by('repeatLast')).toMatchObject({ disabled: false, label: 'Repeat Extrude' });
  });

  it('runs the command itself, nothing of its own', () => {
    const undo = vi.fn();
    const slots = model({ undo });
    slots[slot(MODEL_SLOTS, 'undo')]?.command?.run();
    expect(undo).toHaveBeenCalledOnce();
  });

  it('dims a wedge with no command here, and says why', () => {
    const slots = model();
    const by = (id: string) => slots[slot(MODEL_SLOTS, id)];
    expect(by('delete')).toMatchObject({ disabled: true, hint: 'Select something to delete.' });
    expect(by('repeatLast')).toMatchObject({ disabled: true, label: 'Repeat last' });
    // A command that is not built yet says which task brings it.
    const later = resolveSlots([{ command: 'later', label: 'Later', comesWith: 'P9-99' }], []);
    expect(later[0]).toMatchObject({ disabled: true, hint: 'Arrives with P9-99.' });
  });

  it('lights Press Pull: it is a command of the Solid tab (P3-08)', () => {
    const slots = model();
    expect(slots[slot(MODEL_SLOTS, 'pressPull')]).toMatchObject({
      disabled: false,
      label: 'Press Pull',
    });
    expect(slots[slot(MODEL_SLOTS, 'pressPull')]?.command?.keys).toEqual(['Q']);
  });

  it('dims a command that is offered but not built yet, with its own hint', () => {
    const slots = model();
    const fillet = slots[slot(MODEL_SLOTS, 'fillet')];
    // Until P3-01 lands the fillet command says so; after it, this wedge is lit.
    expect(fillet?.command).toBeDefined();
    expect(fillet?.disabled).toBe(fillet?.command?.unavailable !== undefined);
  });

  it('lights a wedge the day its command joins the list, with no change to the table', () => {
    const table = [{ command: 'soon', label: 'Soon' }];
    expect(resolveSlots(table, buildCommands(context('model')))[0]?.disabled).toBe(true);
    const extra: AppCommand = {
      id: 'soon',
      label: 'Soon',
      group: 'Modify',
      keys: [],
      run: vi.fn(),
    };
    expect(resolveSlots(table, [...buildCommands(context('model')), extra])[0]).toMatchObject({
      disabled: false,
      command: extra,
    });
  });

  it('offers the sketch tools in a sketch, and leaves Sketch out of it', () => {
    const slots = resolveSlots(SKETCH_SLOTS, buildCommands(context('sketch')));
    expect(slots.every((s) => !s.disabled || s.spec.command === 'repeatLast')).toBe(true);
    const inModel = resolveSlots(SKETCH_SLOTS, buildCommands(context('model')));
    expect(inModel[slot(SKETCH_SLOTS, 'line')]?.disabled).toBe(true);
  });
});

describe('Repeat last', () => {
  it('runs the last tool again, named after it', () => {
    const runTool = vi.fn();
    const commands = buildCommands(context('model', { runTool, repeat: { id: 'extrude' } }));
    const repeat = commands.find((c) => c.id === 'repeatLast');
    expect(repeat?.label).toBe('Repeat Extrude');
    repeat?.run();
    expect(runTool).toHaveBeenCalledWith('extrude');
  });

  it('uses the short label of a tool with a long name', () => {
    const commands = buildCommands(context('sketch', { repeat: { id: 'circle' } }));
    expect(commands.find((c) => c.id === 'repeatLast')?.label).toBe('Repeat Circle');
  });

  it('is not offered before anything ran, or when the tool is not offered in this mode', () => {
    expect(buildCommands(context('model')).some((c) => c.id === 'repeatLast')).toBe(false);
    // A sketch tool remembered in a sketch is no use in the model.
    const model = buildCommands(context('model', { repeat: { id: 'line' } }));
    expect(model.some((c) => c.id === 'repeatLast')).toBe(false);
  });

  it('is not offered for a tool that is not built yet', () => {
    const commands = buildCommands(context('model', { repeat: { id: 'fillet' } }));
    const fillet = commands.find((c) => c.id === 'fillet');
    expect(commands.some((c) => c.id === 'repeatLast')).toBe(fillet?.unavailable === undefined);
  });

  it('counts tools that start something, not edits, views or dialogs', () => {
    for (const id of ['line', 'rectangle', 'extrude', 'fillet', 'dimension', 'trim', 'box']) {
      expect(isRepeatable(id)).toBe(true);
    }
    for (const id of ['finishSketch', 'parameters', 'export', 'sketch', 'measure', 'section']) {
      expect(isRepeatable(id)).toBe(false);
    }
  });
});
