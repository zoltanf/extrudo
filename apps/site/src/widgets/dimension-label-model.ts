/**
 * The `dimension-label` widget, the pure part (ADR-0116 §1): two points and a
 * dimension label. Where the label sits decides what the dimension measures, as
 * it does in the Dimension tool. State (the label's position) in, the stage's SVG
 * and the result line out; no DOM.
 */
import { el, escapeText } from './svg';

export type Point = readonly [number, number];
export type Kind = 'horizontal' | 'vertical' | 'aligned';

export const VIEW_BOX = '0 0 520 260';
export const LABEL =
  'Two points and a dimension label you can drag; above or below gives the horizontal distance, beside gives the vertical, between gives the aligned length';
export const HANDLE_LABEL = 'Dimension label, drag or use arrow keys';

const W = 520;
const H = 260;
export const A: Point = [180, 170];
export const B: Point = [340, 90];
export const START: Point = [260, 210];
/** Millimetres per stage unit. */
export const MM = 0.25;
/** The arrow-key step, in stage units. */
export const STEP = 12;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** The label stays inside the stage, with room for its own box. */
export function clampLabel(x: number, y: number): Point {
  return [clamp(x, 30, 490), clamp(y, 16, 244)];
}

export function moveLabel(label: Point, dx: number, dy: number): Point {
  return clampLabel(label[0] + dx, label[1] + dy);
}

/**
 * Between the points' columns and rows → aligned; within one band only → the
 * measure across that band's axis; outside both → whichever way it is further out.
 */
export function kindAt([lx, ly]: Point): Kind {
  const minX = Math.min(A[0], B[0]);
  const maxX = Math.max(A[0], B[0]);
  const minY = Math.min(A[1], B[1]);
  const maxY = Math.max(A[1], B[1]);
  const insideX = lx > minX && lx < maxX;
  const insideY = ly > minY && ly < maxY;
  if (insideX && insideY) return 'aligned';
  if (insideX) return 'horizontal';
  if (insideY) return 'vertical';
  const farX = Math.abs(lx - (minX + maxX) / 2) / (maxX - minX);
  const farY = Math.abs(ly - (minY + maxY) / 2) / (maxY - minY);
  return farX > farY ? 'vertical' : 'horizontal';
}

/** The measured value in millimetres for a kind. */
export function measureOf(kind: Kind): number {
  const dx = Math.abs(B[0] - A[0]);
  const dy = Math.abs(B[1] - A[1]);
  return (kind === 'horizontal' ? dx : kind === 'vertical' ? dy : Math.hypot(dx, dy)) * MM;
}

const KINDS: Record<Kind, { word: string; rest: string }> = {
  horizontal: { word: 'Horizontal', rest: ': label above or below the points measures across, ' },
  vertical: { word: 'Vertical', rest: ': label beside the points measures up and down, ' },
  aligned: { word: 'Aligned', rest: ': label between the points measures the straight distance, ' },
};

/** The result line: the kind word (shown bold), then the rest and the value. */
export function result(label: Point): { kind: Kind; word: string; rest: string; text: string } {
  const kind = kindAt(label);
  const { word, rest } = KINDS[kind];
  const tail = `${rest}${measureOf(kind).toFixed(1)} mm.`;
  return { kind, word, rest: tail, text: `${word}${tail}` };
}

/** The result as markup for the build: the kind word in a `<strong>`. */
export function resultMarkup(label: Point): string {
  const { word, rest } = result(label);
  return `<strong>${escapeText(word)}</strong>${escapeText(rest)}`;
}

/** `aria-valuetext` of the label: what it measures now. */
export function valueText(label: Point): string {
  const { kind } = result(label);
  return `${KINDS[kind].word}, ${measureOf(kind).toFixed(1)} mm`;
}

/**
 * The stage's inner markup. `live` adds the label's slider semantics; the build
 * draws the still picture without them.
 */
export function labelMarkup(label: Point, live: boolean): string {
  const [lx, ly] = label;
  const kind = kindAt(label);
  const minX = Math.min(A[0], B[0]);
  const maxX = Math.max(A[0], B[0]);
  const minY = Math.min(A[1], B[1]);
  const maxY = Math.max(A[1], B[1]);
  const out: string[] = [];

  // The two bands, the one the label is in a little stronger.
  out.push(
    el('rect', {
      class: kind === 'horizontal' ? 'sk-region sk-region-on' : 'sk-region',
      x: minX,
      y: 0,
      width: maxX - minX,
      height: H,
    }),
    el('rect', {
      class: kind === 'vertical' ? 'sk-region sk-region-on' : 'sk-region',
      x: 0,
      y: minY,
      width: W,
      height: maxY - minY,
    }),
    el('line', {
      class: 'sk-construction',
      x1: A[0],
      y1: A[1],
      x2: B[0],
      y2: B[1],
      'stroke-width': 1.4,
    }),
  );

  const extension = (x1: number, y1: number, x2: number, y2: number) =>
    el('line', { class: 'sk-dim', x1, y1, x2, y2, 'stroke-width': 0.8 });
  let from: Point;
  let to: Point;
  if (kind === 'horizontal') {
    from = [A[0], ly];
    to = [B[0], ly];
  } else if (kind === 'vertical') {
    from = [lx, A[1]];
    to = [lx, B[1]];
  } else {
    const len = Math.hypot(B[0] - A[0], B[1] - A[1]);
    const nx = -(B[1] - A[1]) / len;
    const ny = (B[0] - A[0]) / len;
    const off = (lx - A[0]) * nx + (ly - A[1]) * ny;
    from = [A[0] + nx * off, A[1] + ny * off];
    to = [B[0] + nx * off, B[1] + ny * off];
  }
  out.push(
    extension(A[0], A[1], from[0], from[1]),
    extension(B[0], B[1], to[0], to[1]),
    el('line', {
      class: 'sk-dim-line',
      x1: from[0],
      y1: from[1],
      x2: to[0],
      y2: to[1],
      'stroke-width': 1.3,
    }),
  );
  for (const [px, py] of [A, B]) {
    out.push(el('circle', { class: 'sk-point', cx: px, cy: py, r: 4.5, 'stroke-width': 2 }));
  }

  const attributes: Record<string, string | number> = { class: 'sk-handle-group' };
  if (live) {
    Object.assign(attributes, {
      tabindex: 0,
      role: 'slider',
      'aria-label': HANDLE_LABEL,
      'aria-valuenow': Math.round(measureOf(kind)),
      'aria-valuetext': valueText(label),
    });
  }
  out.push(
    el('g', attributes, {
      body:
        el('rect', {
          class: 'sk-label',
          x: lx - 26,
          y: ly - 13,
          width: 52,
          height: 24,
          rx: 5,
          'stroke-width': 1.5,
        }) +
        el(
          'text',
          {
            class: 'sk-dim-text',
            x: lx,
            y: ly + 4,
            'text-anchor': 'middle',
            'font-size': 12,
            'font-weight': 600,
          },
          { text: measureOf(kind).toFixed(1) },
        ),
    }),
  );
  return out.join('');
}
