/**
 * Which segments of a sketch may meet: a grid over their boxes, so the
 * search for crossings looks at the pairs that are near instead of every
 * pair (ADR-0020's amendment of 2026-11-10).
 */

/** A box covering more cells than this is tested against every later box instead. */
const MAX_CELLS = 16;
/** A side of the grid at most (cells), so cell keys stay exact integers. */
const MAX_SIDE = 2 ** 20;

/**
 * The pairs `[i, j]`, `i < j`, of boxes that are not apart (`x0, y0, x1, y1`
 * per box, four numbers each; boxes that touch meet), each pair once, in the
 * order a test of every pair visits them: `i` ascending, then `j` ascending.
 *
 * The cell's side is the median of the boxes' larger sides, so a box covers
 * a few cells whatever the sketch's extent; the few boxes much larger than
 * that (a long line among a spline's short segments) are not in the grid
 * and are candidates of every other box. The boxes must be finite (check
 * before; a NaN box is never yielded).
 */
export function* nearPairsWithin(boxes: Float64Array): Generator<[number, number]> {
  const n = boxes.length / 4;
  if (n < 2) return;
  let ex0 = Number.POSITIVE_INFINITY;
  let ey0 = Number.POSITIVE_INFINITY;
  let ex1 = Number.NEGATIVE_INFINITY;
  let ey1 = Number.NEGATIVE_INFINITY;
  const sides = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const x0 = boxes[4 * i] as number;
    const y0 = boxes[4 * i + 1] as number;
    const x1 = boxes[4 * i + 2] as number;
    const y1 = boxes[4 * i + 3] as number;
    ex0 = Math.min(ex0, x0);
    ey0 = Math.min(ey0, y0);
    ex1 = Math.max(ex1, x1);
    ey1 = Math.max(ey1, y1);
    sides[i] = Math.max(x1 - x0, y1 - y0);
  }
  if (!(ex0 <= ex1 && ey0 <= ey1)) return;
  sides.sort();
  const size =
    Math.max(sides[n >> 1] as number, (ex1 - ex0) / MAX_SIDE, (ey1 - ey0) / MAX_SIDE) || 1;
  const cols = Math.floor((ex1 - ex0) / size) + 1;
  // Monotone in v: boxes that meet share a cell.
  const cell = (v: number, o: number) => Math.floor((v - o) / size);

  const cells = new Map<number, number[]>();
  const big: number[] = [];
  const isBig = new Uint8Array(n);
  const spans = new Int32Array(4 * n);
  for (let i = 0; i < n; i++) {
    const cx0 = cell(boxes[4 * i] as number, ex0);
    const cy0 = cell(boxes[4 * i + 1] as number, ey0);
    const cx1 = cell(boxes[4 * i + 2] as number, ex0);
    const cy1 = cell(boxes[4 * i + 3] as number, ey0);
    spans.set([cx0, cy0, cx1, cy1], 4 * i);
    if ((cx1 - cx0 + 1) * (cy1 - cy0 + 1) > MAX_CELLS) {
      big.push(i);
      isBig[i] = 1;
      continue;
    }
    for (let cy = cy0; cy <= cy1; cy++)
      for (let cx = cx0; cx <= cx1; cx++) {
        const k = cy * cols + cx;
        const list = cells.get(k);
        if (list) list.push(i);
        else cells.set(k, [i]);
      }
  }

  const apart = (i: number, j: number) =>
    (boxes[4 * i] as number) > (boxes[4 * j + 2] as number) ||
    (boxes[4 * j] as number) > (boxes[4 * i + 2] as number) ||
    (boxes[4 * i + 1] as number) > (boxes[4 * j + 3] as number) ||
    (boxes[4 * j + 1] as number) > (boxes[4 * i + 3] as number);
  const seen = new Int32Array(n).fill(-1);
  const found: number[] = [];
  let firstBig = 0;
  for (let i = 0; i < n; i++) {
    while (firstBig < big.length && (big[firstBig] as number) <= i) firstBig++;
    if (isBig[i]) {
      for (let j = i + 1; j < n; j++) if (!apart(i, j)) yield [i, j];
      continue;
    }
    found.length = 0;
    for (let cy = spans[4 * i + 1] as number; cy <= (spans[4 * i + 3] as number); cy++)
      for (let cx = spans[4 * i] as number; cx <= (spans[4 * i + 2] as number); cx++) {
        const list = cells.get(cy * cols + cx);
        if (!list) continue;
        // The list ascends: skip to the first box after i.
        let lo = 0;
        let hi = list.length;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          if ((list[mid] as number) <= i) lo = mid + 1;
          else hi = mid;
        }
        for (let k = lo; k < list.length; k++) {
          const j = list[k] as number;
          if (seen[j] === i) continue;
          seen[j] = i;
          if (!apart(i, j)) found.push(j);
        }
      }
    for (let b = firstBig; b < big.length; b++) {
      const j = big[b] as number;
      if (!apart(i, j)) found.push(j);
    }
    if (found.length > 1) found.sort((p, q) => p - q);
    for (const j of found) yield [i, j];
  }
}
