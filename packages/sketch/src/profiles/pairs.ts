/**
 * Which segments of a sketch may meet: grids over their boxes, so the
 * search for crossings looks at the pairs that are near instead of every
 * pair (ADR-0020's amendments of 2026-11-10 and 2026-11-15).
 */

/** A box spans at most this many cells of its level's grid along each axis (one more after rounding). */
const MAX_SPAN = 4;

/** The pair search's work, for tests: how many pairs of boxes it compared. */
export interface PairSearchStats {
  tests: number;
}

/**
 * One grid's cells, keyed by column and row, each listing boxes in
 * ascending order. One number per cell while columns times rows stays an
 * exact integer, a map per column beyond: a cell is the same cell whatever
 * the sketch's extent.
 */
class Cells {
  readonly #flat: Map<number, number[]> | undefined;
  readonly #columns: Map<number, Map<number, number[]>> | undefined;
  readonly #cols: number;

  constructor(cols: number, rows: number) {
    this.#cols = cols;
    if (cols * rows <= Number.MAX_SAFE_INTEGER) this.#flat = new Map();
    else this.#columns = new Map();
  }

  add(cx: number, cy: number, i: number): void {
    if (this.#flat) {
      const k = cy * this.#cols + cx;
      const list = this.#flat.get(k);
      if (list) list.push(i);
      else this.#flat.set(k, [i]);
      return;
    }
    const columns = this.#columns as Map<number, Map<number, number[]>>;
    let column = columns.get(cx);
    if (!column) {
      column = new Map();
      columns.set(cx, column);
    }
    const list = column.get(cy);
    if (list) list.push(i);
    else column.set(cy, [i]);
  }

  get(cx: number, cy: number): number[] | undefined {
    return this.#flat ? this.#flat.get(cy * this.#cols + cx) : this.#columns?.get(cx)?.get(cy);
  }
}

/** The fewest doublings of `base` after which `side` spans at most `MAX_SPAN` cells (0 for a NaN). */
function doublingsOf(base: number): (side: number) => number {
  const fit = (MAX_SPAN - 1) * base;
  return (side) => {
    let k = side > fit ? Math.ceil(Math.log2(side / fit)) : 0;
    while (side > fit * 2 ** k) k++;
    while (k > 0 && side <= fit * 2 ** (k - 1)) k--;
    return k;
  };
}

/** A level's grid: cells `2^a` by `2^b` times the base side. */
interface Level {
  a: number;
  b: number;
  w: number;
  h: number;
  /** The boxes whose level this is. */
  own: Cells;
  /** Boxes of a narrower level (`a` smaller, same `b`), for the boxes here that are lower (`b` smaller) to find. */
  promoted: Cells | undefined;
}

/**
 * The pairs `[i, j]`, `i < j`, of boxes that are not apart (`x0, y0, x1, y1`
 * per box, four numbers each; boxes that touch meet), each pair once, in the
 * order a test of every pair visits them: `i` ascending, then `j` ascending.
 *
 * Grids of levels: the base side is the median of the boxes' larger sides;
 * a box's level is `(a, b)`, the fewest doublings of the base side along x
 * and along y after which it spans at most `MAX_SPAN` cells of each. Most
 * boxes are at level (0, 0) whatever the sketch's extent, and the boxes
 * much longer than most (long lines among a spline's short segments, a
 * hatch of long lines) meet only the boxes near them in their own grid:
 *
 * - boxes of one level, in its grid;
 * - a box and one of a level wider and taller (or equal in one axis), in
 *   the wider one's grid, where the other spans fewer cells;
 * - a box (a, b) and one wider in x only but lower in y, (a', b') with
 *   a' > a, b' < b: in the grid (a', b), where the first is kept too.
 *
 * The boxes must be finite (check before; a NaN box is never yielded).
 */
export function* nearPairsWithin(
  boxes: Float64Array,
  stats?: PairSearchStats,
): Generator<[number, number]> {
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
  const apart = (i: number, j: number) => {
    if (stats) stats.tests++;
    return (
      (boxes[4 * i] as number) > (boxes[4 * j + 2] as number) ||
      (boxes[4 * j] as number) > (boxes[4 * i + 2] as number) ||
      (boxes[4 * i + 1] as number) > (boxes[4 * j + 3] as number) ||
      (boxes[4 * j + 1] as number) > (boxes[4 * i + 3] as number)
    );
  };
  if (!Number.isFinite(ex1 - ex0) || !Number.isFinite(ey1 - ey0)) {
    // Boxes beyond half the doubles' range: no grid fits them. Unreachable
    // from detection, which refuses curves past `MAX_PROFILE_COORDINATE`.
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (!apart(i, j)) yield [i, j];
    return;
  }
  sides.sort();
  const base = (sides[n >> 1] as number) || 1;
  const doublings = doublingsOf(base);

  // Monotone in v: boxes that meet share a cell of every grid.
  const cell = (v: number, o: number, size: number) => Math.floor((v - o) / size);
  const levels = new Map<number, Level>();
  const levelKey = (a: number, b: number) => a * 4096 + b;
  const levelAt = (a: number, b: number) => {
    const key = levelKey(a, b);
    let level = levels.get(key);
    if (!level) {
      const w = base * 2 ** a;
      const h = base * 2 ** b;
      const cols = cell(ex1, ex0, w) + 1;
      const rows = cell(ey1, ey0, h) + 1;
      level = { a, b, w, h, own: new Cells(cols, rows), promoted: undefined };
      levels.set(key, level);
    }
    return level;
  };
  const span = (i: number, level: Level, out: number[]) => {
    out[0] = cell(boxes[4 * i] as number, ex0, level.w);
    out[1] = cell(boxes[4 * i + 1] as number, ey0, level.h);
    out[2] = cell(boxes[4 * i + 2] as number, ex0, level.w);
    out[3] = cell(boxes[4 * i + 3] as number, ey0, level.h);
  };
  const s = [0, 0, 0, 0];

  const levelOf: Level[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const level = levelAt(
      doublings((boxes[4 * i + 2] as number) - (boxes[4 * i] as number)),
      doublings((boxes[4 * i + 3] as number) - (boxes[4 * i + 1] as number)),
    );
    levelOf[i] = level;
    span(i, level, s);
    for (let cy = s[1] as number; cy <= (s[3] as number); cy++)
      for (let cx = s[0] as number; cx <= (s[2] as number); cx++) level.own.add(cx, cy, i);
  }

  const seen = new Int32Array(n).fill(-1);
  const across: (number[] | undefined)[] = new Array(n);
  if (levels.size > 1) {
    // The lowest level (`b`) of each width (`a`): who may look for boxes kept higher up.
    const lowest = new Map<number, number>();
    for (const l of levels.values()) lowest.set(l.a, Math.min(lowest.get(l.a) ?? l.b, l.b));
    for (let i = 0; i < n; i++) {
      const own = levelOf[i] as Level;
      for (const [a, b] of lowest)
        if (a > own.a && b < own.b) {
          const up = levelAt(a, own.b);
          if (!up.promoted)
            up.promoted = new Cells(cell(ex1, ex0, up.w) + 1, cell(ey1, ey0, up.h) + 1);
          span(i, up, s);
          for (let cy = s[1] as number; cy <= (s[3] as number); cy++)
            for (let cx = s[0] as number; cx <= (s[2] as number); cx++) up.promoted.add(cx, cy, i);
        }
    }
    // Pairs across levels, kept by the lower index of the two.
    const keep = (i: number, list: number[] | undefined) => {
      for (const j of list ?? []) {
        if (seen[j] === i) continue;
        seen[j] = i;
        if (apart(i, j)) continue;
        const lo = Math.min(i, j);
        const hi = Math.max(i, j);
        const pairs = across[lo];
        if (pairs) pairs.push(hi);
        else across[lo] = [hi];
      }
    };
    // With the levels only promoted boxes made.
    const all = [...levels.values()];
    for (let i = 0; i < n; i++) {
      const own = levelOf[i] as Level;
      for (const l of all) {
        const wider = l.a >= own.a && l.b >= own.b && l !== own;
        const higher = l.a === own.a && l.b > own.b && l.promoted !== undefined;
        if (!wider && !higher) continue;
        span(i, l, s);
        for (let cy = s[1] as number; cy <= (s[3] as number); cy++)
          for (let cx = s[0] as number; cx <= (s[2] as number); cx++) {
            if (wider) keep(i, l.own.get(cx, cy));
            if (higher) keep(i, l.promoted?.get(cx, cy));
          }
      }
    }
    seen.fill(-1);
  }

  const found: number[] = [];
  for (let i = 0; i < n; i++) {
    found.length = 0;
    const own = levelOf[i] as Level;
    span(i, own, s);
    for (let cy = s[1] as number; cy <= (s[3] as number); cy++)
      for (let cx = s[0] as number; cx <= (s[2] as number); cx++) {
        const list = own.own.get(cx, cy);
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
    const more = across[i];
    if (more) {
      for (const j of more) found.push(j);
      across[i] = undefined;
    }
    if (found.length > 1) found.sort((p, q) => p - q);
    for (const j of found) yield [i, j];
  }
}

/**
 * The boxes that hold a point (`x0, y0, x1, y1` per box, sides included), in
 * grids of levels like `nearPairsWithin`'s: a point looks in one cell of
 * each level. A box that isn't finite, or a point that isn't, is a
 * candidate always: the caller tests what it gets.
 */
export class BoxesAt {
  readonly #boxes: Float64Array;
  readonly #always: number[] = [];
  readonly #levels: { w: number; h: number; cells: Cells }[] = [];
  readonly #origin: [number, number] = [0, 0];

  constructor(boxes: Float64Array) {
    this.#boxes = boxes;
    const n = boxes.length / 4;
    const finite: number[] = [];
    let ex0 = Number.POSITIVE_INFINITY;
    let ey0 = Number.POSITIVE_INFINITY;
    let ex1 = Number.NEGATIVE_INFINITY;
    let ey1 = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < n; i++) {
      const x0 = boxes[4 * i] as number;
      const y0 = boxes[4 * i + 1] as number;
      const x1 = boxes[4 * i + 2] as number;
      const y1 = boxes[4 * i + 3] as number;
      if (![x0, y0, x1, y1].every(Number.isFinite) || !(x0 <= x1 && y0 <= y1)) {
        this.#always.push(i);
        continue;
      }
      finite.push(i);
      ex0 = Math.min(ex0, x0);
      ey0 = Math.min(ey0, y0);
      ex1 = Math.max(ex1, x1);
      ey1 = Math.max(ey1, y1);
    }
    if (finite.length === 0) return;
    if (!Number.isFinite(ex1 - ex0) || !Number.isFinite(ey1 - ey0)) {
      this.#always.push(...finite);
      this.#always.sort((a, b) => a - b);
      return;
    }
    this.#origin[0] = ex0;
    this.#origin[1] = ey0;
    const sides = Float64Array.from(finite, (i) =>
      Math.max(
        (boxes[4 * i + 2] as number) - (boxes[4 * i] as number),
        (boxes[4 * i + 3] as number) - (boxes[4 * i + 1] as number),
      ),
    ).sort();
    const base = (sides[sides.length >> 1] as number) || 1;
    const doublings = doublingsOf(base);
    const byKey = new Map<number, { w: number; h: number; cells: Cells }>();
    for (const i of finite) {
      const a = doublings((boxes[4 * i + 2] as number) - (boxes[4 * i] as number));
      const b = doublings((boxes[4 * i + 3] as number) - (boxes[4 * i + 1] as number));
      let level = byKey.get(a * 4096 + b);
      if (!level) {
        const w = base * 2 ** a;
        const h = base * 2 ** b;
        level = {
          w,
          h,
          cells: new Cells(Math.floor((ex1 - ex0) / w) + 1, Math.floor((ey1 - ey0) / h) + 1),
        };
        byKey.set(a * 4096 + b, level);
        this.#levels.push(level);
      }
      const cx0 = Math.floor(((boxes[4 * i] as number) - ex0) / level.w);
      const cy0 = Math.floor(((boxes[4 * i + 1] as number) - ey0) / level.h);
      const cx1 = Math.floor(((boxes[4 * i + 2] as number) - ex0) / level.w);
      const cy1 = Math.floor(((boxes[4 * i + 3] as number) - ey0) / level.h);
      for (let cy = cy0; cy <= cy1; cy++)
        for (let cx = cx0; cx <= cx1; cx++) level.cells.add(cx, cy, i);
    }
  }

  /** The boxes holding `p`, ascending; `stats.tests` counts the boxes looked at. */
  at(p: readonly [number, number], stats?: PairSearchStats): number[] {
    const boxes = this.#boxes;
    if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) {
      if (stats) stats.tests += boxes.length / 4;
      return Array.from({ length: boxes.length / 4 }, (_, i) => i);
    }
    const out = [...this.#always];
    for (const level of this.#levels) {
      const list = level.cells.get(
        Math.floor((p[0] - this.#origin[0]) / level.w),
        Math.floor((p[1] - this.#origin[1]) / level.h),
      );
      if (!list) continue;
      if (stats) stats.tests += list.length;
      for (const i of list)
        if (
          (boxes[4 * i] as number) <= p[0] &&
          p[0] <= (boxes[4 * i + 2] as number) &&
          (boxes[4 * i + 1] as number) <= p[1] &&
          p[1] <= (boxes[4 * i + 3] as number)
        )
          out.push(i);
    }
    if (this.#levels.length > 1 || this.#always.length > 0) out.sort((a, b) => a - b);
    return out;
  }
}
