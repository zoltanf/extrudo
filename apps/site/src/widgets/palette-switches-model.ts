/**
 * The `palette-switches` widget, the pure part (ADR-0116 §1): a plate sketch with a
 * hole and the sketch palette's display switches. State in, the stage's SVG out;
 * no DOM. The build draws the starting state (`index.ts`), `palette-switches.ts`
 * redraws it as a switch flips.
 */
import type { Switch } from './controls';
import { el } from './svg';

/** The switches, in the palette's order; all on at the start. */
export const LAYERS = ['points', 'dimensions', 'constraints', 'profiles', 'grid'] as const;
export type Layer = (typeof LAYERS)[number];
export type PaletteState = Readonly<Record<Layer, boolean>>;

export const START: PaletteState = {
  points: true,
  dimensions: true,
  constraints: true,
  profiles: true,
  grid: true,
};

export const VIEW_BOX = '0 0 420 240';
export const LABEL =
  'A plate sketch with a hole, showing its points, dimensions, constraint glyphs, profile shading and the sketch grid';

/** The rows, with the palette's own labels and icons in a 16 × 16 box. */
export const SWITCHES: readonly Omit<Switch, 'checked'>[] = [
  {
    key: 'points',
    label: 'Show points',
    icon: '<circle cx="4" cy="4" r="1.5"/><circle cx="12" cy="12" r="1.5"/>',
  },
  { key: 'dimensions', label: 'Show dimensions', icon: '<path d="M2 12h12M2 10v4M14 10v4"/>' },
  { key: 'constraints', label: 'Show constraints', icon: '<path d="M3 8h10M3 5v6"/>' },
  {
    key: 'profiles',
    label: 'Show profiles',
    icon: '<rect class="widget-icon-fill" x="2" y="3" width="12" height="10" rx="1"/>',
  },
  {
    key: 'grid',
    label: 'Sketch grid',
    icon: '<path d="M2 2h12v12H2zM6 2v12M10 2v12M2 6h12M2 10h12"/>',
  },
];

const W = 420;
const H = 240;
/** The plate and its hole, in stage units. */
const PLATE = { x: 100, y: 50, w: 220, h: 130 };
const HOLE = { x: 250, y: 115, r: 30 };

/** The stage's inner markup for a state, drawn back to front. */
export function paletteMarkup(state: PaletteState): string {
  const out: string[] = [];
  const { x, y, w, h } = PLATE;
  const { x: cx, y: cy, r } = HOLE;

  if (state.grid) {
    for (let gx = 20; gx < W; gx += 20) out.push(gridLine(gx, 0, gx, H, gx % 100 === 0));
    for (let gy = 20; gy < H; gy += 20) out.push(gridLine(0, gy, W, gy, gy % 100 === 0));
  }

  if (state.profiles) {
    // Two profiles: the plate with the hole cut out, and the hole as a region of its own.
    const circle = `M${cx + r} ${cy}a${r} ${r} 0 1 0 ${-2 * r} 0a${r} ${r} 0 1 0 ${2 * r} 0z`;
    out.push(
      el('path', {
        class: 'sk-profile',
        d: `M${x} ${y}h${w}v${h}h${-w}z ${circle}`,
        'fill-rule': 'evenodd',
      }),
      el('circle', { class: 'sk-profile', cx, cy, r }),
    );
  }

  out.push(
    el('rect', { class: 'sk-free', x, y, width: w, height: h, 'stroke-width': 2.2 }),
    el('circle', { class: 'sk-free', cx, cy, r, 'stroke-width': 2.2 }),
  );

  if (state.dimensions) {
    const value = (tx: number, ty: number, text: string) =>
      el(
        'text',
        {
          class: 'sk-dim-text',
          x: tx,
          y: ty,
          'text-anchor': 'middle',
          'font-size': 12,
          'font-weight': 600,
        },
        { text },
      );
    const line = (x1: number, y1: number, x2: number, y2: number) =>
      el('line', { class: 'sk-dim', x1, y1, x2, y2 });
    out.push(
      line(x, y + h + 26, x + w, y + h + 26),
      value(x + w / 2, y + h + 22, '60'),
      line(x - 26, y, x - 26, y + h),
      value(x - 40, y + h / 2 + 4, '35'),
      line(cx - r * 0.7, cy + r * 0.7, cx - r * 1.6, cy + r * 1.6),
      value(cx - r * 1.9, cy + r * 1.9 + 8, '⌀16'),
    );
  }

  if (state.constraints) {
    const glyph = (gx: number, gy: number, mark: string) =>
      el('rect', { class: 'sk-glyph', x: gx - 8, y: gy - 8, width: 16, height: 16, rx: 3 }) +
      el(
        'text',
        { class: 'sk-glyph-text', x: gx, y: gy + 4, 'text-anchor': 'middle', 'font-size': 10 },
        { text: mark },
      );
    out.push(
      glyph(x + w / 2, y - 13, 'H'),
      glyph(x + w / 2 + 30, y + h - 13, 'H'),
      glyph(x + 13, y + h / 2, 'V'),
      glyph(x + w - 13, y + h / 2 - 30, 'V'),
    );
  }

  if (state.points) {
    const corners: [number, number][] = [
      [x, y],
      [x + w, y],
      [x, y + h],
      [x + w, y + h],
      [cx, cy],
    ];
    for (const [px, py] of corners) {
      out.push(el('circle', { class: 'sk-point', cx: px, cy: py, r: 3.5, 'stroke-width': 1.6 }));
    }
  }

  return out.join('');
}

function gridLine(x1: number, y1: number, x2: number, y2: number, major: boolean): string {
  return el('line', {
    class: 'widget-grid',
    x1,
    y1,
    x2,
    y2,
    'stroke-width': major ? 1 : 0.5,
  });
}
