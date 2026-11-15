/**
 * Which segments of a sketch may meet: grids over their boxes, so the
 * search for crossings looks at the pairs that are near instead of every
 * pair (ADR-0020's amendments of 2026-11-10 and 2026-11-15).
 */

/** A box spans at most this many cells of its level's grid along each axis (one more after rounding). */
const MAX_SPAN = 4;

/**
 * The pair search's work: every cell a box is put in or looked up in, and
 * every box looked at there (and each level a box looks in), added to
 * `tests`. With a `limit`, the search calls `refuse` (which throws) as soon
 * as `tests` passes it, before the work or the memory it stands for.
 */
export interface PairSearchStats {
  tests: number;
}

/** Past `limit` tests, `refuse` throws; without it the search only counts. */
export interface PairSearchBudget {
  limit: number;
  refuse: () => never;
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

/** The finest level a box goes to: its cells are `base / 2^64`. */
const FINEST = -64;

/** A grid has at most 2^50 cells a side, so its cell numbers stay exact integers. */
const MAX_CELLS_LOG2 = 50;

/**
 * A box's level `(a, b)` for a base side: along each axis the fewest
 * doublings of the base side (0 or more) after which the box spans at most
 * `MAX_SPAN` cells. A box whose larger side is an eighth of that or less
 * goes to a finer level instead, the same along both axes (the base side
 * halved until it spans at most `MAX_SPAN` cells of it, down to `FINEST`):
 * small boxes never share a coarse cell. No level is finer than one of
 * 2^`MAX_CELLS_LOG2` cells over `extent` (the larger side of all the
 * boxes). A NaN side is level 0, or that finest.
 */
function levelsOf(base: number, extent: number): (w: number, h: number) => [number, number] {
  const fit = (MAX_SPAN - 1) * base;
  const finest =
    extent > 0 ? Math.max(FINEST, Math.ceil(Math.log2(extent / base)) - MAX_CELLS_LOG2) : 0;
  const up = (side: number) => {
    let k = side > fit ? Math.ceil(Math.log2(side / fit)) : 0;
    while (side > fit * 2 ** k) k++;
    while (k > 0 && side <= fit * 2 ** (k - 1)) k--;
    return k;
  };
  const down = (side: number) => {
    let k = side > 0 ? Math.max(FINEST, Math.ceil(Math.log2(side / fit))) : FINEST;
    while (k < 0 && side > fit * 2 ** k) k++;
    while (k > FINEST && side <= fit * 2 ** (k - 1)) k--;
    return k;
  };
  return (w, h) => {
    const m = Math.max(w, h);
    if (m <= fit / 8) {
      const k = Math.max(finest, down(m));
      return [k, k];
    }
    return [Math.max(finest, up(w)), Math.max(finest, up(h))];
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
  /**
   * Boxes of this width (`a`) but lower (`b` smaller), kept here too for the
   * narrower boxes of this height to find (they span few cells of it).
   */
  lower: Cells | undefined;
}

/**
 * The pairs `[i, j]`, `i < j`, of boxes that are not apart (`x0, y0, x1, y1`
 * per box, four numbers each; boxes that touch meet), each pair once, in the
 * order a test of every pair visits them: `i` ascending, then `j` ascending.
 *
 * Grids of levels (`levelsOf`): the base side is the median of the boxes'
 * larger sides; a box's level is `(a, b)`, doublings of the base side along
 * x and along y, or for a small box halvings along both. Most boxes are at
 * level (0, 0) whatever the sketch's extent; boxes much longer than most
 * (long lines among a spline's short segments, a hatch of long lines) and
 * much smaller meet only the boxes near them:
 *
 * - boxes of one level, in its grid;
 * - a box and one of a level wider and taller (or equal in one axis), in
 *   the wider one's grid, where the other spans fewer cells;
 * - a box (a, b) and one wider in x only but lower in y, (a', b') with
 *   a' > a, b' < b: in the grid (a', b), where the second is kept too.
 *
 * Every cell a box is put in or looked up in, every box looked at there and
 * every level a box looks in counts in `stats.tests`, checked against the
 * `budget` as it counts. The boxes must be finite (check before; a NaN box
 * is never yielded).
 */
export function* nearPairsWithin(
  boxes: Float64Array,
  stats: PairSearchStats = { tests: 0 },
  budget?: PairSearchBudget,
): Generator<[number, number]> {
  const n = boxes.length / 4;
  if (n < 2) return;
  const limit = budget?.limit ?? Number.POSITIVE_INFINITY;
  const charge = (k: number) => {
    stats.tests += k;
    if (stats.tests > limit) (budget as PairSearchBudget).refuse();
  };
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
  const apart = (i: number, j: number) =>
    (boxes[4 * i] as number) > (boxes[4 * j + 2] as number) ||
    (boxes[4 * j] as number) > (boxes[4 * i + 2] as number) ||
    (boxes[4 * i + 1] as number) > (boxes[4 * j + 3] as number) ||
    (boxes[4 * j + 1] as number) > (boxes[4 * i + 3] as number);
  if (!Number.isFinite(ex1 - ex0) || !Number.isFinite(ey1 - ey0)) {
    // Boxes beyond half the doubles' range: no grid fits them. Unreachable
    // from detection, which refuses curves past `MAX_PROFILE_COORDINATE`.
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++) {
        charge(1);
        if (!apart(i, j)) yield [i, j];
      }
    return;
  }
  sides.sort();
  const base = (sides[n >> 1] as number) || 1;
  const levelFor = levelsOf(base, Math.max(ex1 - ex0, ey1 - ey0));

  // Monotone in v: boxes that meet share a cell of every grid.
  const cell = (v: number, o: number, size: number) => Math.floor((v - o) / size);
  const levels = new Map<number, Level>();
  const levelAt = (a: number, b: number) => {
    const key = a * 4096 + b;
    let level = levels.get(key);
    if (!level) {
      const w = base * 2 ** a;
      const h = base * 2 ** b;
      const cols = cell(ex1, ex0, w) + 1;
      const rows = cell(ey1, ey0, h) + 1;
      level = { a, b, w, h, own: new Cells(cols, rows), lower: undefined };
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
  /** The cells of a span, charged before they are made or looked up. */
  const cellsOf = (out: number[]) => {
    const k =
      ((out[2] as number) - (out[0] as number) + 1) * ((out[3] as number) - (out[1] as number) + 1);
    charge(k);
  };
  const s = [0, 0, 0, 0];

  const levelOf: Level[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const [a, b] = levelFor(
      (boxes[4 * i + 2] as number) - (boxes[4 * i] as number),
      (boxes[4 * i + 3] as number) - (boxes[4 * i + 1] as number),
    );
    const level = levelAt(a, b);
    levelOf[i] = level;
    span(i, level, s);
    cellsOf(s);
    for (let cy = s[1] as number; cy <= (s[3] as number); cy++)
      for (let cx = s[0] as number; cx <= (s[2] as number); cx++) level.own.add(cx, cy, i);
  }

  const seen = new Int32Array(n).fill(-1);
  const across: (number[] | undefined)[] = new Array(n);
  if (levels.size > 1) {
    // For each width (`a`), the heights (`b`) of the narrower levels: the
    // levels a box of that width is kept in too, where it is higher.
    const all = [...levels.values()];
    const heights = new Map<number, number[]>();
    for (const l of all)
      if (!heights.has(l.a)) {
        charge(all.length);
        heights.set(
          l.a,
          [...new Set(all.filter((m) => m.a < l.a).map((m) => m.b))].sort((p, q) => p - q),
        );
      }
    // Counted for all boxes first, so a sketch past the budget is refused
    // before any of them is kept again.
    const keepLower = (i: number, insert: boolean) => {
      const own = levelOf[i] as Level;
      for (const b of heights.get(own.a) as number[]) {
        if (b <= own.b) continue;
        const up = levelAt(own.a, b);
        span(i, up, s);
        cellsOf(s);
        if (!insert) continue;
        if (!up.lower) up.lower = new Cells(cell(ex1, ex0, up.w) + 1, cell(ey1, ey0, up.h) + 1);
        for (let cy = s[1] as number; cy <= (s[3] as number); cy++)
          for (let cx = s[0] as number; cx <= (s[2] as number); cx++) up.lower.add(cx, cy, i);
      }
    };
    const counted = stats.tests;
    for (let i = 0; i < n; i++) keepLower(i, false);
    // Kept as counted: the same work again, charged once.
    stats.tests = counted;
    for (let i = 0; i < n; i++) keepLower(i, true);
    // For each level, the levels its boxes look in: wider and taller ones
    // (their own boxes), and the wider ones of its own height (the lower
    // boxes kept there).
    const every = [...levels.values()];
    const looks = new Map<Level, { l: Level; wider: boolean; lower: boolean }[]>();
    const looksOf = (own: Level) => {
      let list = looks.get(own);
      if (!list) {
        charge(every.length);
        list = [];
        for (const l of every) {
          const wider = l.a >= own.a && l.b >= own.b && l !== own;
          const lower = l.a > own.a && l.b === own.b && l.lower !== undefined;
          if (wider || lower) list.push({ l, wider, lower });
        }
        looks.set(own, list);
      }
      return list;
    };
    // Pairs across levels, kept by the lower index of the two.
    const keep = (i: number, list: number[] | undefined) => {
      if (!list) return;
      charge(list.length);
      for (const j of list) {
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
    for (let i = 0; i < n; i++) {
      for (const { l, wider, lower } of looksOf(levelOf[i] as Level)) {
        span(i, l, s);
        cellsOf(s);
        for (let cy = s[1] as number; cy <= (s[3] as number); cy++)
          for (let cx = s[0] as number; cx <= (s[2] as number); cx++) {
            if (wider) keep(i, l.own.get(cx, cy));
            if (lower) keep(i, l.lower?.get(cx, cy));
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
    cellsOf(s);
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
        charge(list.length - lo);
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
    const levelFor = levelsOf(base, Math.max(ex1 - ex0, ey1 - ey0));
    const byKey = new Map<number, { w: number; h: number; cells: Cells }>();
    for (const i of finite) {
      const [a, b] = levelFor(
        (boxes[4 * i + 2] as number) - (boxes[4 * i] as number),
        (boxes[4 * i + 3] as number) - (boxes[4 * i + 1] as number),
      );
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

  /** The boxes holding `p`, ascending; `stats.tests` counts the levels and the boxes looked at. */
  at(p: readonly [number, number], stats?: PairSearchStats): number[] {
    const boxes = this.#boxes;
    if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) {
      if (stats) stats.tests += boxes.length / 4;
      return Array.from({ length: boxes.length / 4 }, (_, i) => i);
    }
    const out = [...this.#always];
    if (stats) stats.tests += this.#levels.length;
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
