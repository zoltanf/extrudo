/**
 * The B-spline approximations a B-rep stream stores for its procedural curves
 * and surfaces (`intcurve-curve`, `spline-surface`; see `FORMAT.md`, "ASM
 * B-rep" → "Spline curves and surfaces").
 *
 * Such a record carries its definition in a subtype block, `{ <name> … }`, in
 * which the class names are inline values (`readAsm` keeps them as `name`
 * values inside brackets). A block can instead be a reference, `{ ref <n> }`:
 * the n-th subtype block written earlier in the same stream, counted in the
 * order the blocks open, nested ones included.
 *
 * - A curve block is `<x>_int_cur <version> 0 nubs|nurbs …`: the B-spline
 *   comes first.
 * - A surface block is the subtype's own data (which can hold whole curves and
 *   surfaces of its own, in nested blocks), then `0 nubs|nurbs …`: the
 *   surface's B-spline, at the block's own bracket depth.
 *
 * A B-spline is `nubs` (polynomial) or `nurbs` (rational, then a weight after
 * each point); its degree, form (0 open, 1 closed, 2 periodic) and knot count;
 * the knots as (value, multiplicity) pairs; then the control points. The end
 * knots carry multiplicity `degree` (STEP and most kernels want `degree + 1`),
 * so there are `Σ multiplicities − degree + 1` control points. A surface has
 * two degrees (and, for `nurbs`, a `u`/`v`/`both` name), two forms, two
 * singularity flags and two knot counts, then the u knots, the v knots and the
 * points with u running fastest.
 *
 * Every count is checked against the values left in the record before
 * anything is allocated, and every walk visits each value at most once.
 */
import type { AsmRecord, AsmValue } from './asm';

export type Point3 = [number, number, number];

/** A B-spline curve, in model space (cm), with STEP's knot convention. */
export interface AsmBSplineCurve {
  degree: number;
  /** Distinct knot values, increasing. */
  knots: number[];
  /** Their multiplicities; the ends carry `degree + 1`. */
  mults: number[];
  points: Point3[];
  /** One per point, when the curve is rational. */
  weights?: number[];
  /** The file's form says closed or periodic (the first and last points meet). */
  closed: boolean;
}

/** A B-spline surface, in model space (cm), with STEP's knot convention. */
export interface AsmBSplineSurface {
  uDegree: number;
  vDegree: number;
  uKnots: number[];
  uMults: number[];
  vKnots: number[];
  vMults: number[];
  /** `points[i][j]`: i along u, j along v. */
  points: Point3[][];
  /** `weights[i][j]`, when the surface is rational. */
  weights?: number[][];
  uClosed: boolean;
  vClosed: boolean;
}

/** Above this a kernel will not build the spline (OCCT's limit). */
const MAX_DEGREE = 25;

/** Where each subtype block opens, in stream order: `[record, value index]`. */
export type SubtypeTable = [number, number][];

const isName = (v: AsmValue | undefined, name?: string): boolean =>
  v?.t === 'name' && (name === undefined || v.v === name);

/**
 * Every subtype block's opening, in the order the stream writes them (a block
 * nested inside another counts after it). `{ ref n }` names entry n. One pass
 * over all values.
 */
export function subtypeTable(records: AsmRecord[]): SubtypeTable {
  const out: SubtypeTable = [];
  records.forEach((r, ri) => {
    const vs = r.values;
    for (let i = 0; i + 1 < vs.length; i++)
      if (vs[i]?.t === 'open' && isName(vs[i + 1]) && !isName(vs[i + 1], 'ref')) out.push([ri, i]);
  });
  return out;
}

/**
 * The subtype block a curve or surface record defines: `[values, index of its
 * open bracket]`, following one `ref` (a table entry is never a `ref`, so
 * there is no chain to follow).
 */
function blockOf(
  records: AsmRecord[],
  table: SubtypeTable,
  record: number,
): [AsmValue[], number] | undefined {
  const vs = records[record]?.values;
  if (!vs) return undefined;
  const at = vs.findIndex((v) => v.t === 'open');
  if (at < 0) return undefined;
  if (!isName(vs[at + 1], 'ref')) return [vs, at];
  const n = vs[at + 2];
  if (n?.t !== 'int' || n.v < 0 || n.v >= table.length) return undefined;
  const [ri, i] = table[n.v] as [number, number];
  const target = records[ri]?.values;
  return target ? [target, i] : undefined;
}

/** A cursor over one record's values; every read is bounded by the record. */
class Cursor {
  readonly vs: AsmValue[];
  i: number;
  constructor(vs: AsmValue[], i: number) {
    this.vs = vs;
    this.i = i;
  }
  get left(): number {
    return this.vs.length - this.i;
  }
  int(): number | undefined {
    const v = this.vs[this.i];
    if (v?.t !== 'int') return undefined;
    this.i++;
    return v.v;
  }
  dbl(): number | undefined {
    const v = this.vs[this.i];
    if (v?.t !== 'dbl' || !Number.isFinite(v.v)) return undefined;
    this.i++;
    return v.v;
  }
}

/** One direction's knots: `count` (value, multiplicity) pairs, end multiplicities raised to `degree + 1`. */
function knotsOf(
  c: Cursor,
  degree: number,
  count: number,
): { knots: number[]; mults: number[]; points: number } | undefined {
  if (!(count >= 2) || count * 2 > c.left) return undefined;
  const knots: number[] = [];
  const mults: number[] = [];
  let sum = 0;
  for (let k = 0; k < count; k++) {
    const value = c.dbl();
    const mult = c.int();
    if (value === undefined || mult === undefined) return undefined;
    if (mult < 1 || mult > degree + 1) return undefined;
    if (k > 0 && !(value > (knots[k - 1] as number))) return undefined;
    knots.push(value);
    mults.push(mult);
    sum += mult;
  }
  // The file writes the end knots `degree` times; STEP wants them `degree + 1` times.
  if (mults[0] !== degree || mults[count - 1] !== degree) return undefined;
  mults[0] = degree + 1;
  mults[count - 1] = degree + 1;
  const points = sum - degree + 1;
  if (points < degree + 1) return undefined;
  return { knots, mults, points };
}

/** `count` points of `dim` doubles each (x, y, z[, w]). */
function pointsOf(
  c: Cursor,
  count: number,
  dim: 3 | 4,
): { points: Point3[]; weights: number[] } | undefined {
  if (count * dim > c.left) return undefined;
  const points: Point3[] = [];
  const weights: number[] = [];
  for (let k = 0; k < count; k++) {
    const x = c.dbl();
    const y = c.dbl();
    const z = c.dbl();
    const w = dim === 4 ? c.dbl() : 1;
    if (x === undefined || y === undefined || z === undefined || w === undefined || !(w > 0))
      return undefined;
    points.push([x, y, z]);
    weights.push(w);
  }
  return { points, weights };
}

/** A B-spline curve whose `nubs`/`nurbs` name is at `vs[at]`. */
function curveAt(vs: AsmValue[], at: number): AsmBSplineCurve | undefined {
  const head = vs[at];
  if (head?.t !== 'name' || (head.v !== 'nubs' && head.v !== 'nurbs')) return undefined;
  const rational = head.v === 'nurbs';
  const c = new Cursor(vs, at + 1);
  const degree = c.int();
  const form = c.int();
  const count = c.int();
  if (degree === undefined || form === undefined || count === undefined) return undefined;
  if (degree < 1 || degree > MAX_DEGREE) return undefined;
  const k = knotsOf(c, degree, count);
  if (!k) return undefined;
  const p = pointsOf(c, k.points, rational ? 4 : 3);
  if (!p) return undefined;
  return {
    degree,
    knots: k.knots,
    mults: k.mults,
    points: p.points,
    ...(rational && p.weights.some((w) => Math.abs(w - 1) > 1e-12) ? { weights: p.weights } : {}),
    closed: form === 1 || form === 2,
  };
}

/** A B-spline surface whose `nubs`/`nurbs` name is at `vs[at]`. */
function surfaceAt(vs: AsmValue[], at: number): AsmBSplineSurface | undefined {
  const head = vs[at];
  if (head?.t !== 'name' || (head.v !== 'nubs' && head.v !== 'nurbs')) return undefined;
  const rational = head.v === 'nurbs';
  const c = new Cursor(vs, at + 1);
  const uDegree = c.int();
  const vDegree = c.int();
  // A rational surface names the directions it is rational in (u, v, both);
  // every point still carries a weight.
  if (rational) {
    if (!isName(vs[c.i])) return undefined;
    c.i++;
  }
  const uForm = c.int();
  const vForm = c.int();
  const uSingular = c.int();
  const vSingular = c.int();
  const nu = c.int();
  const nv = c.int();
  if (
    uDegree === undefined ||
    vDegree === undefined ||
    uForm === undefined ||
    vForm === undefined ||
    uSingular === undefined ||
    vSingular === undefined ||
    nu === undefined ||
    nv === undefined
  )
    return undefined;
  if (uDegree < 1 || uDegree > MAX_DEGREE || vDegree < 1 || vDegree > MAX_DEGREE) return undefined;
  const u = knotsOf(c, uDegree, nu);
  if (!u) return undefined;
  const v = knotsOf(c, vDegree, nv);
  if (!v) return undefined;
  // The product is checked against the values left before any allocation.
  if (u.points * v.points > c.left) return undefined;
  const p = pointsOf(c, u.points * v.points, rational ? 4 : 3);
  if (!p) return undefined;
  // The file runs u fastest: point (i, j) is at j * nu + i.
  const points: Point3[][] = [];
  const weights: number[][] = [];
  for (let i = 0; i < u.points; i++) {
    const row: Point3[] = [];
    const wrow: number[] = [];
    for (let j = 0; j < v.points; j++) {
      row.push(p.points[j * u.points + i] as Point3);
      wrow.push(p.weights[j * u.points + i] as number);
    }
    points.push(row);
    weights.push(wrow);
  }
  return {
    uDegree,
    vDegree,
    uKnots: u.knots,
    uMults: u.mults,
    vKnots: v.knots,
    vMults: v.mults,
    points,
    ...(rational && p.weights.some((w) => Math.abs(w - 1) > 1e-12) ? { weights } : {}),
    uClosed: uForm === 1 || uForm === 2,
    vClosed: vForm === 1 || vForm === 2,
  };
}

/**
 * The B-spline an `intcurve` record stores, or `undefined` when its block
 * holds none (a helix, or a curve saved without its approximation).
 */
export function asmSplineCurve(
  records: AsmRecord[],
  table: SubtypeTable,
  record: number,
): AsmBSplineCurve | undefined {
  const block = blockOf(records, table, record);
  if (!block) return undefined;
  const [vs, at] = block;
  // `{ <x>_int_cur <version> 0 nubs|nurbs …`: the approximation comes first.
  if (!isName(vs[at + 1]) || vs[at + 2]?.t !== 'int') return undefined;
  const flag = vs[at + 3];
  if (flag?.t !== 'int' || flag.v !== 0) return undefined;
  return curveAt(vs, at + 4);
}

/**
 * The B-spline a `spline-surface` record stores: the first `nubs`/`nurbs`
 * surface at the block's own depth that follows a 0 (the flag that says the
 * approximation is saved), or `undefined` when there is none.
 */
export function asmSplineSurface(
  records: AsmRecord[],
  table: SubtypeTable,
  record: number,
): AsmBSplineSurface | undefined {
  const block = blockOf(records, table, record);
  if (!block) return undefined;
  const [vs, at] = block;
  let depth = 0;
  for (let i = at; i < vs.length; i++) {
    const v = vs[i] as AsmValue;
    if (v.t === 'open') depth++;
    else if (v.t === 'close') {
      depth--;
      if (depth === 0) return undefined;
    } else if (depth === 1 && v.t === 'name' && (v.v === 'nubs' || v.v === 'nurbs')) {
      const flag = vs[i - 1];
      if (flag?.t !== 'int' || flag.v !== 0) continue;
      // A surface header is eight integers (a rational one names its rational
      // directions after the two degrees); a curve's is three, then a knot.
      // The first surface header decides, so the scan stays linear.
      const named = v.v === 'nurbs' && isName(vs[i + 3]) ? 1 : 0;
      let ints = 0;
      for (let k = i + 1; k <= i + 8 + named && k < vs.length; k++) {
        if (named && k === i + 3) continue;
        if (vs[k]?.t !== 'int') break;
        ints++;
      }
      if (ints === 8) return surfaceAt(vs, i);
    }
  }
  return undefined;
}

/** The record's own sense flag, before its block: true when it runs against its B-spline. */
export function asmSplineReversed(record: AsmRecord | undefined): boolean {
  const vs = record?.values ?? [];
  const at = vs.findIndex((v) => v.t === 'open');
  const flag = at > 0 ? vs[at - 1] : undefined;
  return flag?.t === 'bool' ? flag.v : false;
}

/** The point on a B-spline curve at parameter `t` (de Boor; rational when weighted). */
export function splinePoint(c: AsmBSplineCurve, t: number): Point3 {
  const p = c.degree;
  // The full knot vector.
  const U: number[] = [];
  c.knots.forEach((k, i) => {
    for (let m = 0; m < (c.mults[i] as number); m++) U.push(k);
  });
  const n = c.points.length;
  const lo = U[p] as number;
  const hi = U[n] as number;
  const x = Math.min(Math.max(t, lo), hi);
  let span = p;
  while (span < n - 1 && x >= (U[span + 1] as number)) span++;
  const d: [number, number, number, number][] = [];
  for (let j = 0; j <= p; j++) {
    const pt = c.points[span - p + j] as Point3;
    const w = c.weights?.[span - p + j] ?? 1;
    d.push([pt[0] * w, pt[1] * w, pt[2] * w, w]);
  }
  for (let r = 1; r <= p; r++)
    for (let j = p; j >= r; j--) {
      const i = span - p + j;
      const a0 = U[i] as number;
      const a1 = U[i + p - r + 1] as number;
      const a = a1 > a0 ? (x - a0) / (a1 - a0) : 0;
      const dj = d[j] as [number, number, number, number];
      const dk = d[j - 1] as [number, number, number, number];
      d[j] = [
        (1 - a) * dk[0] + a * dj[0],
        (1 - a) * dk[1] + a * dj[1],
        (1 - a) * dk[2] + a * dj[2],
        (1 - a) * dk[3] + a * dj[3],
      ];
    }
  const r = d[p] as [number, number, number, number];
  return [r[0] / r[3], r[1] / r[3], r[2] / r[3]];
}
