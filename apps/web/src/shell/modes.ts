/**
 * What each edit mode shows (ADR-0143's S1a amendment): one row per `EditMode`, so a new
 * mode is a row here (and its tabs and tools in `tools.ts`) instead of a branch in every
 * file that draws chrome. The keymap and marking-menu modes are the edit mode itself
 * (`KeymapMode`, `MarkingMode`); `label` names it in Settings.
 *
 * What a mode *does* (sketch tools, the palette, the sketch's transaction) stays with the
 * mode's own code (`sketch/mode.ts`); the session enters and leaves it with
 * `enterMode`/`exitMode` (`@extrudo/core`'s session store).
 */
import type { EditMode } from '@extrudo/core';
import { MODEL_SLOTS, SHEET_SLOTS, SKETCH_SLOTS, type SlotSpec } from '../commands/marking';
import type { TabId, ToolId } from './tools';

export interface ModeChrome {
  /** The mode's name in Settings: the Keyboard page's filter, the marking-menu editor's tab. */
  label: string;
  /** The toolbar tabs shown, drawn in `TABS` order (ADR-0079 §2). */
  tabs: ReadonlySet<TabId>;
  /** The tab the mode opens on, brought forward whenever the mode changes. */
  defaultTab: TabId;
  /** The marking menu's eight wedges, before the `marking.slots` overrides (ADR-0042). */
  markingSlots: readonly SlotSpec[];
  /** What Customize Marking Menu lists as "Repeat last" in this mode (no tool has run there). */
  repeatSample: ToolId;
  /** The Finish tile, drawn after the groups of `tab` (UI spec §2); the model has none. */
  finish?: { tool: ToolId; tab: TabId };
}

/** The modes in the order Settings lists them. */
export const EDIT_MODES: readonly EditMode[] = ['model', 'sketch', 'sheet'];

export const MODES: Readonly<Record<EditMode, ModeChrome>> = {
  model: {
    label: 'Model',
    tabs: new Set(['home', 'solid', 'modify', 'construct', 'print']),
    defaultTab: 'solid',
    markingSlots: MODEL_SLOTS,
    repeatSample: 'extrude',
  },
  // Home and its own tab: the others' tools work on bodies. Make went from sketch mode in
  // the owner's UI review 3 (R3-11), since the Sketch tab's Export covers what a sketch
  // exports.
  sketch: {
    label: 'Sketch',
    tabs: new Set(['home', 'sketch']),
    defaultTab: 'sketch',
    markingSlots: SKETCH_SLOTS,
    repeatSample: 'line',
    finish: { tool: 'finishSketch', tab: 'sketch' },
  },
  // The drawing (P6-24, ADR-0143): Home and its own tab, like a sketch. Its tools are in
  // `sheets/`; the sheet takes the view's place and the sheet tabs the timeline's.
  sheet: {
    label: 'Drawing',
    tabs: new Set(['home', 'sheet']),
    defaultTab: 'sheet',
    markingSlots: SHEET_SLOTS,
    repeatSample: 'newSheet',
    finish: { tool: 'finishDrawing', tab: 'sheet' },
  },
};

/** One value per mode (`commandBuilder` for each, an empty list each). */
export function perMode<T>(make: (mode: EditMode) => T): Record<EditMode, T> {
  return Object.fromEntries(EDIT_MODES.map((mode) => [mode, make(mode)])) as Record<EditMode, T>;
}
