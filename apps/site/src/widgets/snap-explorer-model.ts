/**
 * The `snap-explorer` widget, the pure part (ADR-0116 §1): a line being drawn from
 * a start point through a small sketch, snapping the way the app's inference does
 * (`packages/sketch/src/inference/inference.ts`, first match wins) and saying what
 * constraint the click would add (`constraints.ts`). State (the pointer and the two
 * switches) in, the stage's SVG and the result line out; no DOM.
 */
import type { Switch } from './controls';
import { el, escapeText } from './svg';

export const VIEW_BOX = '0 0 520 320';
export const LABEL =
  'A line being drawn from a start point through a rectangle, a circle, a slanted line and a lone point; move the pointer to see what it snaps to';
/** The pointer handle's name, for a reader that moves it with the arrow keys. */
export const HANDLE_LABEL = 'Pointer';

type Vec = readonly [number, number];

const W = 520;
const H = 320;
/** Snap distance and grid step, in stage units. */
const TOL = 11;
export const GRID = 20;

const CORNERS: readonly Vec[] = [
  [60, 70],
  [240, 70],
  [240, 190],
  [60, 190],
];
const CENTER: Vec = [375, 130];
const R = 55;
const SLANT: readonly [Vec, Vec] = [
  [285, 285],
  [470, 45],
];
const LONE: Vec = [430, 250];
const ORIGIN: Vec = [40, 300];
/** Where the line being drawn starts: the tool's anchor. */
export const ANCHOR: Vec = [130, 262];

interface Line {
  a: Vec;
  b: Vec;
  name: string;
}

const LINES: readonly Line[] = [
  { a: CORNERS[0] as Vec, b: CORNERS[1] as Vec, name: 'the top edge' },
  { a: CORNERS[1] as Vec, b: CORNERS[2] as Vec, name: 'the right edge' },
  { a: CORNERS[2] as Vec, b: CORNERS[3] as Vec, name: 'the bottom edge' },
  { a: CORNERS[3] as Vec, b: CORNERS[0] as Vec, name: 'the left edge' },
  { a: SLANT[0], b: SLANT[1], name: 'the slanted line' },
];
const CIRCLE_NAME = 'the circle';

/** A snap kind, as the app names them in `inference.ts`. */
export type SnapKind =
  | 'endpoint'
  | 'center'
  | 'point'
  | 'origin'
  | 'midpoint'
  | 'intersection'
  | 'onCurve';

interface Target {
  p: Vec;
  kind: SnapKind;
  of?: string;
}

const POINTS: readonly Target[] = [
  ...CORNERS.map((p): Target => ({ p, kind: 'endpoint' })),
  { p: SLANT[0], kind: 'endpoint' },
  { p: SLANT[1], kind: 'endpoint' },
  { p: CENTER, kind: 'center' },
  { p: LONE, kind: 'point' },
  { p: ORIGIN, kind: 'origin' },
];

const dist = (a: Vec, b: Vec) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Where the segment a–b meets the circle. */
function segmentCircle(a: Vec, b: Vec): Vec[] {
  const d = [b[0] - a[0], b[1] - a[1]] as const;
  const f = [a[0] - CENTER[0], a[1] - CENTER[1]] as const;
  const qa = d[0] ** 2 + d[1] ** 2;
  const qb = 2 * (f[0] * d[0] + f[1] * d[1]);
  const qc = f[0] ** 2 + f[1] ** 2 - R * R;
  const disc = qb * qb - 4 * qa * qc;
  if (disc < 0) return [];
  return [(-qb - Math.sqrt(disc)) / (2 * qa), (-qb + Math.sqrt(disc)) / (2 * qa)]
    .filter((t) => t >= 0 && t <= 1)
    .map((t): Vec => [a[0] + t * d[0], a[1] + t * d[1]]);
}

/** Midpoints of the lines (a full circle has none) and the slanted line's two crossings. */
const DERIVED: readonly Target[] = [
  ...LINES.map(
    (l): Target => ({
      p: [(l.a[0] + l.b[0]) / 2, (l.a[1] + l.b[1]) / 2],
      kind: 'midpoint',
      of: l.name,
    }),
  ),
  ...segmentCircle(SLANT[0], SLANT[1]).map(
    (p): Target => ({ p, kind: 'intersection', of: 'the slanted line and the circle' }),
  ),
];

function nearestOnSegment(p: Vec, a: Vec, b: Vec): Vec {
  const d = [b[0] - a[0], b[1] - a[1]] as const;
  const t = Math.max(
    0,
    Math.min(1, ((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1]) / (d[0] ** 2 + d[1] ** 2)),
  );
  return [a[0] + t * d[0], a[1] + t * d[1]];
}

function nearestOnCircle(p: Vec): Vec {
  const v = [p[0] - CENTER[0], p[1] - CENTER[1]] as const;
  const n = Math.hypot(v[0], v[1]) || 1;
  return [CENTER[0] + (v[0] / n) * R, CENTER[1] + (v[1] / n) * R];
}

type Axis = 'h' | 'v';

/** Where the level line `y = k` (h) or `x = k` (v) meets the curves. */
function guideHits(axis: Axis, k: number): { p: Vec; of: string }[] {
  const i = axis === 'h' ? 1 : 0;
  const j = axis === 'h' ? 0 : 1;
  const out: { p: Vec; of: string }[] = [];
  const at = (along: number, across: number): Vec =>
    axis === 'h' ? [across, along] : [along, across];
  for (const l of LINES) {
    if ((l.a[i] - k) * (l.b[i] - k) > 0 || l.a[i] === l.b[i]) continue;
    const t = (k - l.a[i]) / (l.b[i] - l.a[i]);
    out.push({ p: at(k, l.a[j] + t * (l.b[j] - l.a[j])), of: l.name });
  }
  const off = k - CENTER[i];
  if (Math.abs(off) <= R) {
    const s = Math.sqrt(R * R - off * off);
    for (const sign of [-1, 1]) out.push({ p: at(k, CENTER[j] + sign * s), of: CIRCLE_NAME });
  }
  return out;
}

interface Guide {
  axis: Axis;
  /** The point the guide runs from: the anchor or a sketch point. */
  from: Vec;
  anchor: boolean;
}

/** Alignment sources: the anchor first, then the sketch points, never the origin. */
const SOURCES: readonly { p: Vec; anchor: boolean }[] = [
  { p: ANCHOR, anchor: true },
  ...POINTS.filter((t) => t.kind !== 'origin').map((t) => ({ p: t.p, anchor: false })),
];

function bestGuide(cursor: Vec, axis: Axis): Guide | undefined {
  const i = axis === 'h' ? 1 : 0;
  let best: (Guide & { d: number }) | undefined;
  for (const s of SOURCES) {
    const d = Math.abs(cursor[i] - s.p[i]);
    if (d <= TOL && (!best || d < best.d)) best = { axis, from: s.p, anchor: s.anchor, d };
  }
  return best && { axis: best.axis, from: best.from, anchor: best.anchor };
}

export interface SnapState {
  /** Where the pointer is, in stage units. */
  cursor: Vec;
  /** `Ctrl` held: no snapping at all. */
  ctrl: boolean;
  /** The palette's Snap to grid. */
  grid: boolean;
}

/** Starts on the top-right corner of the rectangle: an end-point snap. */
export const START: SnapState = { cursor: [236, 74], ctrl: false, grid: true };

/** What the pointer snaps to, and what the click adds. */
export interface Snap {
  /** The point the line would end on. */
  p: Vec;
  /** The glyph the app draws at `p` (none for a grid snap, an alignment or no snap). */
  glyph?: SnapKind;
  /** The guides the app draws, from their source to `p`. */
  guides: readonly Guide[];
  /** The snap, as the readout names it. */
  name: string;
  /** The constraints the click adds. */
  adds: string;
  why: string;
}

const NAMES: Record<SnapKind, string> = {
  endpoint: 'End point',
  center: 'Centre',
  point: 'Point',
  origin: 'Origin',
  midpoint: 'Midpoint',
  intersection: 'Crossing',
  onCurve: 'On a curve',
};

const level = (axis: Axis) => (axis === 'h' ? 'Horizontal' : 'Vertical');
/** What an alignment adds: on the new line for the anchor, between two points otherwise. */
const alignAdds = (g: Guide) =>
  g.anchor ? `${level(g.axis)} on the new line` : `${level(g.axis)} between the two points`;

function nearest(targets: readonly Target[], cursor: Vec): Target | undefined {
  let best: Target | undefined;
  let bd = TOL;
  for (const t of targets) {
    const d = dist(cursor, t.p);
    if (d <= bd) {
      bd = d;
      best = t;
    }
  }
  return best;
}

/** The app's inference, for this sketch: the first rule that matches wins. */
export function infer(state: SnapState): Snap {
  const { cursor, grid } = state;
  const none = { guides: [] as Guide[] };
  if (state.ctrl) {
    return {
      ...none,
      p: cursor,
      name: 'Nothing (Ctrl)',
      adds: 'nothing',
      why: 'Ctrl turns snapping off.',
    };
  }

  // 1: a point.
  const point = nearest(POINTS, cursor);
  if (point) {
    return point.kind === 'origin'
      ? {
          ...none,
          p: point.p,
          glyph: 'origin',
          name: NAMES.origin,
          adds: 'fix',
          why: 'The origin is no sketch point, so the new end is fixed there.',
        }
      : {
          ...none,
          p: point.p,
          glyph: point.kind,
          name: NAMES[point.kind],
          adds: 'coincident',
          why: 'The new end and that point become one.',
        };
  }

  // 2: a crossing or a midpoint.
  const derived = nearest(DERIVED, cursor);
  if (derived) {
    return derived.kind === 'midpoint'
      ? {
          ...none,
          p: derived.p,
          glyph: 'midpoint',
          name: NAMES.midpoint,
          adds: 'midpoint',
          why: `The new end stays at the middle of ${derived.of}.`,
        }
      : {
          ...none,
          p: derived.p,
          glyph: 'intersection',
          name: NAMES.intersection,
          adds: 'point on curve, twice',
          why: `The new end is held on both curves: ${derived.of}.`,
        };
  }

  // 3: a level line through a point, where it crosses a curve.
  const h = bestGuide(cursor, 'h');
  const v = bestGuide(cursor, 'v');
  let crossing: { p: Vec; of: string; d: number; guide: Guide } | undefined;
  for (const guide of [h, v]) {
    if (!guide) continue;
    for (const hit of guideHits(guide.axis, guide.axis === 'h' ? guide.from[1] : guide.from[0])) {
      const d = dist(cursor, hit.p);
      if (d <= TOL && (!crossing || d < crossing.d)) crossing = { ...hit, d, guide };
    }
  }
  if (crossing) {
    return {
      p: crossing.p,
      glyph: 'onCurve',
      guides: [crossing.guide],
      name: `On ${crossing.of}, level`,
      adds: `point on curve and ${alignAdds(crossing.guide).toLowerCase()}`,
      why: 'The level line through a point meets a curve here.',
    };
  }

  // 4: on a curve.
  let on: { p: Vec; of: string; d: number } | undefined;
  for (const l of LINES) {
    const q = nearestOnSegment(cursor, l.a, l.b);
    const d = dist(cursor, q);
    if (d <= TOL && (!on || d < on.d)) on = { p: q, of: l.name, d };
  }
  const q = nearestOnCircle(cursor);
  if (dist(cursor, q) <= TOL && (!on || dist(cursor, q) < on.d)) {
    on = { p: q, of: CIRCLE_NAME, d: dist(cursor, q) };
  }
  if (on) {
    return {
      ...none,
      p: on.p,
      glyph: 'onCurve',
      name: `On ${on.of}`,
      adds: 'point on curve',
      why: 'The new end can slide along the curve, but not leave it.',
    };
  }

  // 5: level with the start or a point.
  if (h && v) {
    return {
      p: [v.from[0], h.from[1]],
      guides: [h, v],
      name: 'Level both ways',
      adds: `${alignAdds(h).toLowerCase()} and ${alignAdds(v).toLowerCase()}`,
      why: 'Two level lines cross here.',
    };
  }
  const guide = h ?? v;
  if (guide) {
    const p: [number, number] =
      guide.axis === 'h' ? [cursor[0], guide.from[1]] : [guide.from[0], cursor[1]];
    const free = guide.axis === 'h' ? 0 : 1;
    if (grid) p[free] = Math.round(p[free] / GRID) * GRID;
    return {
      p,
      guides: [guide],
      name: guide.anchor ? `${level(guide.axis)} from the start` : 'Level with a point',
      adds: alignAdds(guide).toLowerCase(),
      why: guide.anchor
        ? 'The new line is exactly level with its start.'
        : 'The new end is level with a point; one glyph sits halfway between them.',
    };
  }

  // 6: the grid; 7: the pointer as it is.
  if (grid) {
    return {
      ...none,
      p: [Math.round(cursor[0] / GRID) * GRID, Math.round(cursor[1] / GRID) * GRID],
      name: 'Grid',
      adds: 'nothing',
      why: 'A grid snap adds no constraint.',
    };
  }
  return {
    ...none,
    p: cursor,
    name: 'Nothing',
    adds: 'nothing',
    why: 'Nothing is near enough to snap to.',
  };
}

/** The result line: the snap (bold), then what the click adds and why. */
export function result(state: SnapState): { word: string; rest: string } {
  const snap = infer(state);
  return { word: snap.name, rest: `The click adds ${snap.adds}. ${snap.why}` };
}

/** The result as markup for the build: the snap in a `<strong>`, the rest on its own line. */
export function resultMarkup(state: SnapState): string {
  const { word, rest } = result(state);
  return `<strong>${escapeText(word)}</strong><br>${escapeText(rest)}`;
}

/** `aria-valuetext` of the pointer handle. */
export function valueText(state: SnapState): string {
  const snap = infer(state);
  return `${snap.name}; the click adds ${snap.adds}`;
}

/** The pointer after an arrow key: `step` units, kept on the stage. */
export function nudge(state: SnapState, dx: number, dy: number, step: number): SnapState {
  return moveTo(state, state.cursor[0] + dx * step, state.cursor[1] + dy * step);
}

/** The pointer at a stage point, kept on the stage. */
export function moveTo(state: SnapState, x: number, y: number): SnapState {
  return {
    ...state,
    cursor: [Math.max(0, Math.min(W, Math.round(x))), Math.max(0, Math.min(H, Math.round(y)))],
  };
}

export const SWITCH_KEYS = ['ctrl', 'grid'] as const;

export const SWITCHES: readonly Omit<Switch, 'checked'>[] = [
  {
    key: 'ctrl',
    label: 'Hold Ctrl',
    icon: '<rect x="1.5" y="4" width="13" height="8" rx="2"/><path d="M5 8h6"/>',
  },
  {
    key: 'grid',
    label: 'Snap to grid',
    icon: '<path d="M2 2h12v12H2zM6 2v12M10 2v12M2 6h12M2 10h12"/>',
  },
];

/** The app's snap glyph at `p` (`SketchOverlay.tsx`), one shape per kind. */
function glyphMarkup(kind: SnapKind, [x, y]: Vec): string {
  const s = 5;
  const stroke = { class: 'sk-accent', 'stroke-width': 1.5 };
  switch (kind) {
    case 'endpoint':
    case 'point':
    case 'origin':
      return el('rect', { ...stroke, x: x - s, y: y - s, width: 2 * s, height: 2 * s });
    case 'center':
      return (
        el('circle', { ...stroke, cx: x, cy: y, r: s + 1 }) +
        el('circle', { class: 'sk-snap-dot', cx: x, cy: y, r: 1.5 })
      );
    case 'midpoint':
      return el('path', {
        ...stroke,
        d: `M${x} ${y - s - 1}L${x + s + 1} ${y + s}L${x - s - 1} ${y + s}Z`,
      });
    case 'intersection':
      return el('path', {
        ...stroke,
        d: `M${x - s} ${y - s}L${x + s} ${y + s}M${x + s} ${y - s}L${x - s} ${y + s}`,
      });
    case 'onCurve':
      return el('circle', { ...stroke, cx: x, cy: y, r: s });
  }
}

/**
 * The stage's inner markup. `live` makes the pointer a focusable slider for the
 * arrow keys; the build draws the still picture without it.
 */
export function snapMarkup(state: SnapState, live: boolean): string {
  const snap = infer(state);
  const out: string[] = [];

  if (state.grid) {
    for (let x = GRID; x < W; x += GRID) {
      out.push(
        el('line', { class: 'widget-grid', x1: x, y1: 0, x2: x, y2: H, 'stroke-width': 0.5 }),
      );
    }
    for (let y = GRID; y < H; y += GRID) {
      out.push(
        el('line', { class: 'widget-grid', x1: 0, y1: y, x2: W, y2: y, 'stroke-width': 0.5 }),
      );
    }
  }

  // The origin's two axes, then the sketch.
  out.push(
    el('path', {
      class: 'sk-dim',
      d: `M${ORIGIN[0]} ${ORIGIN[1]}H${ORIGIN[0] + 50}M${ORIGIN[0]} ${ORIGIN[1]}V${ORIGIN[1] - 50}`,
    }),
    el('path', {
      class: 'sk-free',
      d: `M${CORNERS.map((p) => p.join(' ')).join('L')}Z`,
      'stroke-width': 2,
    }),
    el('circle', { class: 'sk-free', cx: CENTER[0], cy: CENTER[1], r: R, 'stroke-width': 2 }),
    el('path', {
      class: 'sk-free',
      d: `M${SLANT[0].join(' ')}L${SLANT[1].join(' ')}`,
      'stroke-width': 2,
    }),
  );
  for (const t of POINTS) {
    const muted = t.kind === 'origin' ? ' sk-point-muted' : '';
    out.push(
      el('circle', {
        class: `sk-point${muted}`,
        cx: t.p[0],
        cy: t.p[1],
        r: 3,
        'stroke-width': 1.5,
      }),
    );
  }

  for (const g of snap.guides) {
    out.push(
      el('line', { class: 'sk-guide', x1: g.from[0], y1: g.from[1], x2: snap.p[0], y2: snap.p[1] }),
    );
  }

  // The line being drawn, from the start to where the click would put its end.
  out.push(
    el('line', {
      class: 'sk-free',
      x1: ANCHOR[0],
      y1: ANCHOR[1],
      x2: snap.p[0],
      y2: snap.p[1],
      'stroke-width': 2,
    }),
    el('circle', { class: 'sk-point', cx: ANCHOR[0], cy: ANCHOR[1], r: 4, 'stroke-width': 2 }),
    el(
      'text',
      {
        class: 'sk-dim-text',
        x: ANCHOR[0],
        y: ANCHOR[1] + 22,
        'text-anchor': 'middle',
        'font-size': 12,
      },
      { text: 'start' },
    ),
  );
  if (snap.glyph) out.push(glyphMarkup(snap.glyph, snap.p));

  // The pointer: a small cross where it really is.
  const [cx, cy] = state.cursor;
  const attributes: Record<string, string | number> = { class: 'sk-handle-group' };
  if (live) {
    Object.assign(attributes, {
      tabindex: 0,
      role: 'slider',
      'aria-label': HANDLE_LABEL,
      'aria-valuenow': Math.round(cx),
      'aria-valuetext': valueText(state),
    });
  }
  out.push(
    el('g', attributes, {
      body:
        el('circle', { class: 'widget-hit', cx, cy, r: 10 }) +
        el('path', {
          class: 'sk-dim-line',
          d: `M${cx - 7} ${cy}H${cx + 7}M${cx} ${cy - 7}V${cy + 7}`,
          'stroke-width': 1.2,
        }),
    }),
  );
  return out.join('');
}
