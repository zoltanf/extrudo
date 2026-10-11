/**
 * Mouse and trackpad mapping for the viewport (UI spec §3.1, FR-VP-01).
 * Pure functions from an input event's buttons and modifiers to a navigation
 * action, one table per preset.
 */

export type NavAction = 'orbit' | 'pan' | 'zoom';
export type NavPreset = 'spindle' | 'crank' | 'glide' | 'blender' | 'trackpad';

/**
 * The presets in menu order; the first is the default (`DEFAULT_SETTINGS.preset`). The first
 * three are named after a workshop motion that says what the drag does (the owner's UI review 3,
 * R3-04): no preset is named after another CAD product; Blender keeps its name by the owner's
 * choice. `summary` is the one line the Settings menu shows under the preset and the Settings
 * dialog under its field: what orbits, pans and zooms, and what Shift does.
 */
export const NAV_PRESETS: readonly { value: NavPreset; label: string; summary: string }[] = [
  {
    value: 'spindle',
    label: 'Spindle',
    summary: 'Middle-drag orbits, right-drag pans; Shift swaps them. The wheel zooms.',
  },
  {
    value: 'crank',
    label: 'Crank',
    summary: 'Right-drag orbits, middle-drag pans; Shift swaps them. The wheel zooms.',
  },
  {
    value: 'glide',
    label: 'Glide',
    summary: 'Middle-drag pans, Shift+middle-drag orbits. The wheel zooms.',
  },
  {
    value: 'blender',
    label: 'Blender',
    summary: 'Middle-drag orbits, Shift+middle-drag pans, Ctrl+middle-drag zooms. The wheel zooms.',
  },
  {
    value: 'trackpad',
    label: 'Trackpad',
    summary: 'Two-finger scroll pans, pinch zooms, Alt+drag orbits (with Shift, pans).',
  },
];

/**
 * The values presets were stored under before R3-04, read as their new names by the
 * preference reader (`loadSettings`): never a document change.
 */
export const RENAMED_PRESETS: Readonly<Record<string, NavPreset>> = {
  extrudo: 'spindle',
  onshape: 'crank',
  'shift-orbit': 'glide',
};

/** The parts of a pointer event the mapping looks at. */
export interface PointerInput {
  /** 0 left, 1 middle, 2 right (`PointerEvent.button`). */
  button: number;
  shiftKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

/**
 * What a drag starting with this button and these modifiers does, or
 * `undefined` if it isn't a navigation drag (a left-drag selects). While a
 * nav-bar tool (orbit, pan, zoom) is on, a left-drag does that instead.
 */
export function dragAction(
  preset: NavPreset,
  input: PointerInput,
  tool?: NavAction,
): NavAction | undefined {
  const { button, shiftKey, ctrlKey, altKey, metaKey } = input;
  if (button === 0 && tool) return tool;
  // Shift + a left-click stays add-to-selection in every preset: only the middle and right
  // buttons navigate (or the left one with a nav-bar tool, or Alt on a trackpad).
  switch (preset) {
    case 'spindle':
      // The middle button orbits, the right one pans; Shift swaps them (R3-04). Ctrl/⌘ +
      // middle pans as before.
      if (button === 1) return ctrlKey || metaKey || shiftKey ? 'pan' : 'orbit';
      if (button === 2) return shiftKey ? 'orbit' : 'pan';
      return undefined;
    case 'crank':
      // Spindle's buttons the other way round, with the same Shift swap.
      if (button === 2) return ctrlKey || metaKey || shiftKey ? 'pan' : 'orbit';
      if (button === 1) return shiftKey ? 'orbit' : 'pan';
      return undefined;
    case 'glide':
      if (button === 1) return shiftKey ? 'orbit' : 'pan';
      return undefined;
    case 'blender':
      if (button === 1) return shiftKey ? 'pan' : ctrlKey ? 'zoom' : 'orbit';
      return undefined;
    case 'trackpad':
      if (button === 0 && altKey) return shiftKey ? 'pan' : 'orbit';
      if (button === 1) return shiftKey ? 'orbit' : 'pan';
      return undefined;
  }
}

/** The parts of a wheel event the mapping looks at. */
export interface WheelInput {
  deltaX: number;
  deltaY: number;
  /** 0 pixels, 1 lines, 2 pages (`WheelEvent.deltaMode`). */
  deltaMode: number;
  /** Browsers report a trackpad pinch as a wheel event with Ctrl held. */
  ctrlKey: boolean;
}

export type WheelResult =
  | { action: 'zoom'; factor: number }
  | { action: 'pan'; dx: number; dy: number };

const LINE = 16;
const PAGE = 400;

/**
 * What a wheel event does. The wheel zooms (towards the cursor) in every
 * preset; with the trackpad preset a two-finger scroll pans and a pinch
 * zooms. Scrolling down (positive delta) zooms out.
 */
export function wheelAction(preset: NavPreset, input: WheelInput): WheelResult {
  const unit = input.deltaMode === 1 ? LINE : input.deltaMode === 2 ? PAGE : 1;
  const dx = input.deltaX * unit;
  const dy = input.deltaY * unit;
  if (preset === 'trackpad' && !input.ctrlKey) return { action: 'pan', dx: -dx, dy: -dy };
  // A pinch sends small deltas, so it gets more zoom per pixel.
  const rate = input.ctrlKey ? 0.01 : 0.0015;
  return { action: 'zoom', factor: Math.exp(dy * rate) };
}

/** Orbit speed: radians per pixel of drag. */
export const ORBIT_RATE = Math.PI / 400;

/** Zoom factor for a vertical drag of `dy` pixels (down zooms out). */
export function dragZoomFactor(dy: number): number {
  return Math.exp(dy * 0.005);
}
