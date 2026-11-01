/**
 * The `trim` widget, the pure part (ADR-0116 §1): a line through a circle, cut at
 * the two crossings into five pieces. Pointing at a piece marks it up to the
 * nearest crossings; clicking removes it. State (the pieces already trimmed) in,
 * the stage's SVG and the result line out; no DOM.
 */
import { el } from './svg';

export const VIEW_BOX = '0 0 420 220';
export const LABEL =
  'A line through a circle; click a piece to trim it back to the nearest crossings';

const CX = 230;
const CY = 110;
const R = 62;
const LY = 92;
const HALF = Math.sqrt(R * R - (LY - CY) ** 2);
/** The two crossings of the line and the circle. */
const X1 = CX - HALF;
const X2 = CX + HALF;

export interface Piece {
  id: string;
  d: string;
  name: string;
}

export const PIECES: readonly Piece[] = [
  { id: 'l1', d: `M40 ${LY}H${X1}`, name: 'the line left of the circle' },
  { id: 'l2', d: `M${X1} ${LY}H${X2}`, name: 'the line inside the circle' },
  { id: 'l3', d: `M${X2} ${LY}H390`, name: 'the line right of the circle' },
  { id: 'a1', d: `M${X1} ${LY}A${R} ${R} 0 0 1 ${X2} ${LY}`, name: 'the circle above the line' },
  { id: 'a2', d: `M${X1} ${LY}A${R} ${R} 0 1 0 ${X2} ${LY}`, name: 'the circle below the line' },
];

/** The pieces already trimmed, by id. */
export type Gone = readonly string[];

export const START: Gone = [];

/** The state after trimming `id` (an unknown id, or one already gone, changes nothing). */
export function trimPiece(gone: Gone, id: string): Gone {
  return PIECES.some((piece) => piece.id === id) && !gone.includes(id) ? [...gone, id] : gone;
}

export function pieceName(id: string): string {
  return PIECES.find((piece) => piece.id === id)?.name ?? '';
}

/** The result line after a trim; empty at the start and after Reset. */
export function result(id: string | undefined): string {
  return id === undefined ? '' : `Trimmed ${pieceName(id)}.`;
}

/** The class a piece's visible curve has, and the one it has while pointed at. */
export const PIECE_CLASS = 'sk-free';
export const HOVER_CLASS = 'sk-hover';

/**
 * The stage's inner markup. `live` adds the wide invisible hit path over each
 * piece, which is the button; the build draws the still picture without them.
 */
export function trimMarkup(gone: Gone, live: boolean): string {
  const out: string[] = [];
  for (const piece of PIECES) {
    if (gone.includes(piece.id)) continue;
    out.push(
      el('path', {
        class: PIECE_CLASS,
        d: piece.d,
        'data-vis': piece.id,
        'stroke-width': 2.4,
        'stroke-linecap': 'round',
      }),
    );
    if (live) {
      out.push(
        el('path', {
          class: 'widget-hit',
          d: piece.d,
          'data-piece': piece.id,
          'stroke-width': 16,
          tabindex: 0,
          role: 'button',
          'aria-label': `Trim ${piece.name}`,
        }),
      );
    }
  }
  for (const x of [X1, X2]) {
    out.push(
      el('circle', {
        class: 'sk-point sk-point-muted',
        cx: x,
        cy: LY,
        r: 3.5,
        'stroke-width': 1.5,
      }),
    );
  }
  return out.join('');
}
