/**
 * Snapping on the sheet (P6-24 S4, plan §4.2 "Snap"): a dragged or placed item snaps to the
 * other items' and views' edges and centres, and a dimension to **rows** an even 10 mm apart
 * from the other dimensions of its direction (stacked dimension lines, or one row), with
 * dashed guides where it snapped, as a sketch shows them. One switch (the floating bar's
 * Snap) turns it off. Pure: the canvas and the workspace call it with the targets' boxes
 * (`targetBoxes`) and the dimensions' rows (`dimensionRows`).
 *
 * Each axis snaps on its own, to the nearest candidate within the tolerance (5 px on screen):
 * the moved box's left, middle or right against another box's left, middle or right (top,
 * middle, bottom likewise); a dimension's own row against another's plus a whole number of
 * 10 mm steps. Arrow-key nudges never snap.
 */
import type { DisplayList, DisplayText } from '@extrudo/io';
import type { SheetBox, SheetTarget } from './selection';

/** Between stacked dimension lines, mm (plan §4.2). */
export const ROW_STEP = 10;
/** How many rows either side of a dimension are offered. */
const ROWS = 4;

/**
 * A dimension's row: the line its text runs along (`y` of a level text, `x` of an upright
 * one), sheet mm. Its dimension line is parallel to it at a fixed distance, so rows 10 mm
 * apart are dimension lines 10 mm apart.
 */
export interface SnapRow {
  axis: 'x' | 'y';
  at: number;
}

/** A dashed guide where something snapped, sheet mm. */
export interface SnapGuide {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface SnapResult {
  dx: number;
  dy: number;
  guides: SnapGuide[];
}

/** The rows of the dimensions in `list`: each dimension's first text run, level or upright. */
export function dimensionRows(
  list: DisplayList | undefined,
  dimensions: ReadonlySet<SheetTarget>,
): Map<SheetTarget, SnapRow> {
  const out = new Map<SheetTarget, SnapRow>();
  for (const item of list?.items ?? []) {
    if (item.type !== 'text' || !item.key || out.has(item.key) || !dimensions.has(item.key)) {
      continue;
    }
    const row = rowOf(item);
    if (row) out.set(item.key, row);
  }
  return out;
}

/** A text run's row: level or upright; none at a slant. */
export function rowOf(text: DisplayText): SnapRow | undefined {
  const a = ((((text.angle ?? 0) % Math.PI) + Math.PI) % Math.PI) / Math.PI;
  if (a < 0.01 || a > 0.99) return { axis: 'y', at: text.at[1] };
  if (Math.abs(a - 0.5) < 0.01) return { axis: 'x', at: text.at[0] };
  return undefined;
}

const union = (boxes: readonly SheetBox[]): SheetBox | undefined =>
  boxes.length === 0
    ? undefined
    : boxes.reduce((a, b) => ({
        minX: Math.min(a.minX, b.minX),
        minY: Math.min(a.minY, b.minY),
        maxX: Math.max(a.maxX, b.maxX),
        maxY: Math.max(a.maxY, b.maxY),
      }));

interface Best {
  shift: number;
  guide: (moved: SheetBox) => SnapGuide;
}

/**
 * Where a move of `moving` (the moved targets' boxes) by (`dx`, `dy`) mm lands with snapping:
 * the move corrected on each axis to the nearest edge, middle or row within `tol` mm, and the
 * guides to draw. `others` are the boxes it may snap to (not the moved ones); `row` is the
 * moved dimension's row, `rows` the other dimensions'.
 */
export function snapMove(
  moving: readonly SheetBox[],
  others: readonly SheetBox[],
  dx: number,
  dy: number,
  tol: number,
  row?: SnapRow,
  rows: readonly SnapRow[] = [],
): SnapResult {
  const box = union(moving);
  if (!box) return { dx, dy, guides: [] };
  const moved: SheetBox = {
    minX: box.minX + dx,
    minY: box.minY + dy,
    maxX: box.maxX + dx,
    maxY: box.maxY + dy,
  };
  const axis = (a: 'x' | 'y'): Best | undefined => {
    const [lo, hi] = a === 'x' ? (['minX', 'maxX'] as const) : (['minY', 'maxY'] as const);
    const own = [moved[lo], (moved[lo] + moved[hi]) / 2, moved[hi]];
    let best: Best | undefined;
    let away = tol;
    const offer = (shift: number, guide: Best['guide']) => {
      if (Math.abs(shift) <= away + 1e-9 && (!best || Math.abs(shift) < Math.abs(best.shift))) {
        best = { shift, guide };
        away = Math.abs(shift);
      }
    };
    for (const other of others) {
      const theirs = [other[lo], (other[lo] + other[hi]) / 2, other[hi]];
      for (const mine of own) {
        for (const at of theirs) {
          offer(at - mine, (m) =>
            a === 'x'
              ? {
                  x1: at,
                  y1: Math.min(m.minY, other.minY),
                  x2: at,
                  y2: Math.max(m.maxY, other.maxY),
                }
              : {
                  x1: Math.min(m.minX, other.minX),
                  y1: at,
                  x2: Math.max(m.maxX, other.maxX),
                  y2: at,
                },
          );
        }
      }
    }
    // A dimension's row: another's of the same direction, or 10, 20 … mm from it.
    if (row && row.axis === a) {
      const mine = row.at + (a === 'x' ? dx : dy);
      for (const theirs of rows) {
        if (theirs.axis !== a) continue;
        for (let n = -ROWS; n <= ROWS; n++) {
          const at = theirs.at + n * ROW_STEP;
          offer(at - mine, (m) =>
            a === 'x'
              ? { x1: at, y1: m.minY, x2: at, y2: m.maxY }
              : { x1: m.minX, y1: at, x2: m.maxX, y2: at },
          );
        }
      }
    }
    return best;
  };
  const bx = axis('x');
  const by = axis('y');
  const out = { dx: dx + (bx?.shift ?? 0), dy: dy + (by?.shift ?? 0) };
  const final: SheetBox = {
    minX: box.minX + out.dx,
    minY: box.minY + out.dy,
    maxX: box.maxX + out.dx,
    maxY: box.maxY + out.dy,
  };
  const guides = [bx, by].flatMap((b) => (b ? [b.guide(final)] : []));
  return { ...out, guides };
}

/** A placed point snapped like a box of no size (a text's or a sticky note's corner). */
export function snapPoint(
  point: readonly [number, number],
  others: readonly SheetBox[],
  tol: number,
  row?: SnapRow,
  rows?: readonly SnapRow[],
): { point: [number, number]; guides: SnapGuide[] } {
  const box = { minX: point[0], minY: point[1], maxX: point[0], maxY: point[1] };
  const r = snapMove([box], others, 0, 0, tol, row, rows);
  return { point: [point[0] + r.dx, point[1] + r.dy], guides: r.guides };
}

/** The boxes a move of `moving` may snap to: every other target's but the paper's frame. */
export function snapTargets(
  boxes: ReadonlyMap<SheetTarget, SheetBox>,
  moving: ReadonlySet<SheetTarget>,
): SheetBox[] {
  return [...boxes].filter(([t]) => !moving.has(t)).map(([, b]) => b);
}

/** The guides as one SVG path's data. */
export function guidePath(guides: readonly SnapGuide[]): string {
  return guides.map((g) => `M${g.x1} ${g.y1}L${g.x2} ${g.y2}`).join('');
}
