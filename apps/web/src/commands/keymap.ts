/**
 * The default keymap (UI spec §5): Fusion 360's keys where Fusion has them.
 * This is the one table of command keys (ADR-0023). The toolbar, menus, the
 * command palette and the shortcut handler all read it, so a settings page
 * can remap them later by layering overrides on top. Keys are written like
 * `Shortcut.keys`: "Mod+K", "Shift+2", "F6", "L".
 *
 * A key may belong to two commands that are never offered together: F is
 * Sketch Fillet in a sketch and Fillet on the model.
 */
export const DEFAULT_KEYMAP: Readonly<Record<string, readonly string[]>> = {
  // Search (P1-14)
  commandPalette: ['Mod+K'],
  toolbox: ['S'],
  // Edit
  undo: ['Mod+Z'],
  redo: ['Mod+Y', 'Mod+Shift+Z'],
  delete: ['Delete', 'Backspace'],
  // Sketch
  line: ['L'],
  rectangle: ['R'],
  circle: ['C'],
  arc: ['A'],
  dimension: ['D'],
  trim: ['T'],
  sketchOffset: ['O'],
  sketchFillet: ['F'],
  sketchMove: ['M'],
  project: ['P'],
  construction: ['X'],
  // Solid (these tools arrive in Phases 2 and 3)
  extrude: ['E'],
  fillet: ['F'],
  hole: ['H'],
  measure: ['I'],
  // View: F6 is Fusion's; Shift+1…7 are ours.
  fit: ['F6'],
  viewHome: ['Shift+1'],
  viewTop: ['Shift+2'],
  viewBottom: ['Shift+3'],
  viewFront: ['Shift+4'],
  viewBack: ['Shift+5'],
  viewLeft: ['Shift+6'],
  viewRight: ['Shift+7'],
};

const NONE: readonly string[] = [];

/** A command's keys, first the one to show in tooltips and menus. */
export function keysFor(id: string): readonly string[] {
  return DEFAULT_KEYMAP[id] ?? NONE;
}
