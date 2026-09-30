/**
 * What the marking menu's ring holds (P3-11, FR-UX-03, ADR-0042): two tables
 * of eight command IDs, one for the model and one for sketch mode, and
 * `resolveSlots`, which matches them with the commands offered right now
 * (`buildCommands`). A slot never runs anything of its own: it runs the
 * command. A slot whose command isn't offered here (`sketch` inside a
 * sketch), or doesn't exist yet (Press Pull before P3-08),
 * stays in place, dimmed, so the ring keeps its layout; the day the
 * command appears in `buildCommands`, the slot lights up with no change here.
 */
import type { IconName, ToolCategory } from '../design-system';
import type { AppCommand } from '../shell/commands';

export interface SlotSpec {
  /** The command ID (a tool ID, or a keymap ID such as `undo`). */
  command: string;
  /** The wedge's label (short: a wedge is narrow). */
  label: string;
  /** Icon for the dimmed wedge; a command's own icon wins. */
  icon?: { name: IconName; category: ToolCategory };
  /** The task that brings the command, for the dimmed wedge's tooltip. */
  comesWith?: string;
}

/**
 * Eight wedges clockwise from the top: N, NE, E, SE, S, SW, W, NW. Making
 * things sits at the top right, editing (Undo, Repeat, Delete) at the left.
 */
export const MODEL_SLOTS: readonly SlotSpec[] = [
  { command: 'sketch', label: 'Sketch', icon: { name: 'create-sketch', category: 'sketch' } },
  { command: 'extrude', label: 'Extrude', icon: { name: 'extrude', category: 'create' } },
  { command: 'fillet', label: 'Fillet', icon: { name: 'fillet', category: 'modify' } },
  { command: 'move', label: 'Move', icon: { name: 'move', category: 'modify' } },
  {
    command: 'pressPull',
    label: 'Press Pull',
    icon: { name: 'extrude', category: 'create' },
    comesWith: 'P3-08',
  },
  { command: 'undo', label: 'Undo' },
  { command: 'repeatLast', label: 'Repeat last' },
  { command: 'delete', label: 'Delete' },
];

/** The same, while a sketch is open: the tools drawn most, then Undo and Finish Sketch. */
export const SKETCH_SLOTS: readonly SlotSpec[] = [
  { command: 'line', label: 'Line', icon: { name: 'line', category: 'sketch' } },
  { command: 'rectangle', label: 'Rectangle', icon: { name: 'rectangle', category: 'sketch' } },
  { command: 'circle', label: 'Circle', icon: { name: 'circle', category: 'sketch' } },
  {
    command: 'dimension',
    label: 'Dimension',
    icon: { name: 'sketch-dimension', category: 'sketch' },
  },
  { command: 'trim', label: 'Trim', icon: { name: 'trim', category: 'sketch' } },
  { command: 'undo', label: 'Undo' },
  { command: 'construction', label: 'Construction' },
  {
    command: 'finishSketch',
    label: 'Finish Sketch',
    icon: { name: 'finish-sketch', category: 'sketch' },
  },
];

export interface ResolvedSlot {
  spec: SlotSpec;
  /** The offered command, or `undefined` when there is none here. */
  command: AppCommand | undefined;
  label: string;
  /** Can't run: no such command here, or one that isn't built yet. */
  disabled: boolean;
  /** Why it is dimmed. */
  hint?: string;
}

/** Matches a slot table with the commands offered now, wedge by wedge. */
export function resolveSlots(
  specs: readonly SlotSpec[],
  commands: readonly AppCommand[],
): ResolvedSlot[] {
  const byId = new Map(commands.map((c) => [c.id, c]));
  return specs.map((spec) => {
    const command = byId.get(spec.command);
    if (command) {
      return {
        spec,
        command,
        // The table's own short name fits a wedge; only Repeat last names what it repeats.
        label: spec.command === 'repeatLast' ? command.label : spec.label,
        disabled: command.unavailable !== undefined,
        ...(command.unavailable !== undefined && { hint: command.unavailable }),
      };
    }
    const hint = spec.comesWith
      ? `Arrives with ${spec.comesWith}.`
      : spec.command === 'repeatLast'
        ? 'Nothing to repeat yet.'
        : spec.command === 'delete'
          ? 'Select something to delete.'
          : 'Not available here.';
    return { spec, command: undefined, label: spec.label, disabled: true, hint };
  });
}

/**
 * The commands "Repeat last" can repeat: the tools that start something,
 * the ones you'd want again (a sketch tool, Extrude, Fillet...). Undo, Redo
 * and Delete would be dangerous to repeat by accident, view and panel
 * commands aren't work, and leaving a sketch or opening a dialog such as
 * Parameters or Export isn't something to run twice.
 */
export const NOT_REPEATABLE: ReadonlySet<string> = new Set([
  'finishSketch',
  'parameters',
  'export',
  'exportSketch',
  'sketch',
  'measure',
]);

/** Whether running the tool `id` counts as "the last command" for Repeat last. */
export function isRepeatable(id: string): boolean {
  return !NOT_REPEATABLE.has(id);
}
