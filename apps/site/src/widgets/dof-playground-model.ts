/**
 * The `dof-playground` widget, the pure part (ADR-0116 §1): a rectangle with four
 * degrees of freedom and four switches that constrain it. State in, the stage's
 * SVG and the result line out; no DOM, no solver. The counting is the rectangle's
 * alone: width and height are one DOF each, the corner two, and a second height
 * dimension on a held height is a constraint too many.
 */
import type { Switch } from './controls';
import { el } from './svg';

export const SWITCH_KEYS = ['w', 'h', 'f', 'x'] as const;
export type SwitchKey = (typeof SWITCH_KEYS)[number];

/** The rectangle in stage units (y grows downwards); the bottom-left corner is the one "Fix corner" pins. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type DofState = Readonly<Record<SwitchKey, boolean>> & { readonly rect: Rect };

export const START_RECT: Rect = { x: 110, y: 70, w: 180, h: 120 };
export const START: DofState = { w: false, h: false, f: false, x: false, rect: START_RECT };

export const VIEW_BOX = '0 0 420 260';
export const LABEL =
  'A rectangle you can drag; its colours and the degrees-of-freedom counter follow the constraints switched on';
export const HANDLE_LABEL = 'Top-right corner, drag or use arrow keys';

/** Stage units per drawing unit, so a 180 px side reads as 40. */
export const UNIT = 4.5;

export const SWITCHES: readonly (Omit<Switch, 'checked'> & { key: SwitchKey })[] = [
  { key: 'w', label: 'Width dimension', icon: '<path d="M2 12h12M2 10v4M14 10v4"/>' },
  { key: 'h', label: 'Height dimension', icon: '<path d="M4 2v12M2 2h4M2 14h4"/>' },
  {
    key: 'f',
    label: 'Fix corner',
    icon: '<rect x="4" y="7" width="8" height="7" rx="1"/><path d="M6 7V5a2 2 0 0 1 4 0v2"/>',
  },
  { key: 'x', label: 'Second height', icon: '<path d="M12 2v12M10 2h4M10 14h4M4 2v12"/>' },
];

/** A second height on a held height: the same side measured twice. */
export function isConflict(s: DofState): boolean {
  return s.h && s.x;
}

export function dofLeft(s: DofState): number {
  const heightHeld = s.h || s.x;
  return Math.max(0, 4 - (s.w ? 1 : 0) - (heightHeld ? 1 : 0) - (s.f ? 2 : 0));
}

/** The corner moves only while something is free and nothing conflicts. */
export function canMove(s: DofState): boolean {
  return dofLeft(s) > 0 && !isConflict(s);
}

export type Tone = 'free' | 'ok' | 'bad';

export function result(s: DofState): { text: string; tone: Tone } {
  if (isConflict(s)) {
    return { text: 'Over-constrained: the red geometry has a constraint too many', tone: 'bad' };
  }
  const left = dofLeft(s);
  return left === 0
    ? { text: 'Fully constrained ✓', tone: 'ok' }
    : { text: `${left} DOF left`, tone: 'free' };
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** The top-right corner follows a stage point through whatever is still free. */
export function dragTo(s: DofState, px: number, py: number): DofState {
  if (!canMove(s)) return s;
  const r = { ...s.rect };
  const heightHeld = s.h || s.x;
  if (!s.w) r.w = clamp((s.f ? px : clamp(px, 120, 400)) - r.x, 40, 300);
  else if (!s.f) r.x = clamp(px - r.w, 20, 400 - r.w);
  if (!heightHeld) {
    const bottom = r.y + r.h;
    if (s.f) {
      r.y = clamp(py, 20, bottom - 30);
      r.h = bottom - r.y;
    } else {
      r.h = clamp(bottom - py, 30, 200);
      r.y = bottom - r.h;
    }
  } else if (!s.f) r.y = clamp(py, 20, 240 - r.h - 40);
  return { ...s, rect: r };
}

/** An arrow key moves the corner `units` drawing units (2, or 10 with Shift) from where it is. */
export function nudge(s: DofState, dx: number, dy: number, units: number): DofState {
  const { x, y, w } = s.rect;
  return dragTo(s, x + w + dx * units * UNIT, y + dy * units * UNIT);
}

/** `aria-valuetext` of the corner handle: the sides it sets, in drawing units. */
export function valueText(s: DofState): string {
  return `Width ${Math.round(s.rect.w / UNIT)}, height ${Math.round(s.rect.h / UNIT)}`;
}

/**
 * The stage's inner markup. `live` adds the handle's slider semantics; the build
 * draws the still picture without them.
 */
export function dofMarkup(s: DofState, live: boolean): string {
  const { x, y, w, h } = s.rect;
  const conflict = isConflict(s);
  const heldHeight = s.h || s.x;
  const out: string[] = [];

  const side = (x1: number, y1: number, x2: number, y2: number, fixed: boolean, red: boolean) =>
    el('line', {
      class: red ? 'sk-conflict' : fixed ? 'sk-fixed' : 'sk-free',
      x1,
      y1,
      x2,
      y2,
      'stroke-width': 2.4,
      'stroke-linecap': 'round',
    });
  out.push(
    side(x, y + h, x + w, y + h, s.f && s.w, false),
    side(x, y, x, y + h, s.f && heldHeight, conflict),
    side(x, y, x + w, y, s.f && s.w && heldHeight, false),
    side(x + w, y, x + w, y + h, s.f && s.w && heldHeight, conflict),
  );

  // The glyphs the rectangle tool leaves: sides level and plumb.
  const glyph = (gx: number, gy: number, mark: string) =>
    el('rect', { class: 'sk-glyph', x: gx - 8, y: gy - 8, width: 16, height: 16, rx: 3 }) +
    el(
      'text',
      { class: 'sk-glyph-text', x: gx, y: gy + 4, 'text-anchor': 'middle', 'font-size': 10 },
      { text: mark },
    );
  out.push(
    glyph(x + w / 2, y - 14, 'H'),
    glyph(x + w / 2, y + h + 14, 'H'),
    glyph(x - 14, y + h / 2, 'V'),
    glyph(x + w + 14, y + h / 2, 'V'),
  );

  const dimText = (tx: number, ty: number, text: string, red: boolean) =>
    el(
      'text',
      {
        class: red ? 'sk-dim-text sk-dim-conflict' : 'sk-dim-text',
        x: tx,
        y: ty,
        'text-anchor': 'middle',
        'font-size': 12,
        'font-weight': 600,
      },
      { text },
    );
  const widthValue = String(Math.round(w / UNIT));
  const heightValue = String(Math.round(h / UNIT));
  if (s.w) {
    const ly = y + h + 38;
    out.push(
      el('line', { class: 'sk-dim', x1: x, y1: ly, x2: x + w, y2: ly }),
      dimText(x + w / 2, ly - 5, widthValue, false),
    );
  }
  if (s.h) {
    const lx = x - 40;
    out.push(
      el('line', { class: 'sk-dim', x1: lx, y1: y, x2: lx, y2: y + h }),
      dimText(lx - 4, y + h / 2 + 4, heightValue, conflict),
    );
  }
  if (s.x) {
    const lx = x + w + 40;
    out.push(
      el('line', { class: 'sk-dim', x1: lx, y1: y, x2: lx, y2: y + h }),
      dimText(lx + 12, y + h / 2 + 4, heightValue, conflict),
    );
  }

  for (const [px, py] of [
    [x, y + h],
    [x + w, y + h],
    [x, y],
  ] as const) {
    out.push(el('circle', { class: 'sk-point', cx: px, cy: py, r: 3.5, 'stroke-width': 1.5 }));
  }
  if (s.f) {
    out.push(
      el('rect', {
        class: 'sk-fixed',
        x: x - 6,
        y: y + h - 6,
        width: 12,
        height: 12,
        'stroke-width': 1.5,
      }),
    );
  }

  // The drag handle on the top-right corner.
  const movable = canMove(s);
  const attributes: Record<string, string | number> = {
    class: movable ? 'sk-handle' : 'sk-handle sk-handle-locked',
    cx: x + w,
    cy: y,
    r: 8,
    'stroke-width': 2,
  };
  if (live) {
    Object.assign(attributes, {
      tabindex: 0,
      role: 'slider',
      'aria-label': HANDLE_LABEL,
      'aria-valuenow': Math.round(w / UNIT),
      'aria-valuetext': valueText(s),
      'aria-disabled': movable ? 'false' : 'true',
    });
  }
  out.push(el('circle', attributes));
  return out.join('');
}
