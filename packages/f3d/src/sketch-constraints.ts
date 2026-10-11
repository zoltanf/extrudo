/**
 * The file's sketch constraints and dimensions as Extrudo's (ADR-0015,
 * ADR-0016), so an imported sketch stays drivable. The rule is that imported
 * geometry never moves: a constraint or dimension goes in only when the
 * geometry already satisfies it where the file put it, and the sketch is then
 * solved; whatever the solver calls redundant or conflicting, or anything
 * that would still move a point, is taken out again and counted. Nothing is
 * forced.
 *
 * Vetting needs the solver (planegcs), which the importer does not load: the
 * caller passes a `SketchSolver` in the import options; without one no
 * constraint or dimension is imported.
 */
import type { SketchBuilder } from '@extrudo/api';
import {
  evaluateExpression,
  isReservedName,
  type Quantity,
  type SketchArc,
  type SketchCircle,
  type SketchData,
  type SketchLine,
  type SketchPoint,
} from '@extrudo/core';
// Types only from the main entry: its solver loads planegcs, which the caller owns.
import type { DimensionValues, SketchSolver } from '@extrudo/sketch';
import { tangentReversed } from '@extrudo/sketch/inference';
import type { SketchDimensionRecord, SketchRelation } from './decode/constraints';
import type { ParameterValue } from './decode/parameters';
import type { F3dSketch } from './model';

type Vec2 = [number, number];

/** Why a constraint or dimension of the file was left out. */
export type LeftOut =
  /** It names geometry the import did not draw (projected or text-box curves, the origin). */
  | 'geometry'
  /** Extrudo has no constraint or dimension like it. */
  | 'unsupported'
  /** The geometry where the file put it does not satisfy it (a stale value, a driven dimension). */
  | 'mismatch'
  /** The solver calls it redundant or conflicting with the rest. */
  | 'overconstrains'
  /** The sketch would move with it. */
  | 'moves'
  /** Past the first {@link MAX_CANDIDATES} of a sketch. */
  | 'limit'
  /** The solver failed on the sketch, so none of its constraints could be checked. */
  | 'failed';

/** At most this many constraints and dimensions of one sketch are vetted (the samples have up to 213). */
export const MAX_CANDIDATES = 1000;

export interface ConstraintTally {
  constraints: number;
  dimensions: number;
  /** Left out, by why (constraints and dimensions together). */
  leftOut: Partial<Record<LeftOut, number>>;
  /** The largest point displacement solving any imported sketch caused, mm. */
  maxDisplacement: number;
  /** Left out, by why and what (`mismatch:tangent`, `geometry:linear`). */
  byKind: Record<string, number>;
}

/** What the importer keeps across sketches. */
export interface ConstraintContext {
  solver: SketchSolver;
  /**
   * Parameter values an expression may use, by name (base units: mm, deg):
   * the user parameters, then each dimension as it is imported.
   */
  values: Map<string, Quantity>;
  /** Every parameter name taken in the design, imported dimensions included. */
  taken: Set<string>;
  tally: ConstraintTally;
  /** A model parameter name for a dimension of Extrudo's own (none the file uses). */
  freeName: () => string;
}

/** How the drawn sketch relates to the file's records. */
export interface DrawnSketch {
  /** f3d point record → the Extrudo points standing for it (the first one is used). */
  points: ReadonlyMap<number, readonly string[]>;
  /** f3d curve record → its Extrudo entity. */
  curves: ReadonlyMap<number, string>;
  /** f3d sketch (u, v) in cm → Extrudo plane (x, y) in mm. */
  map: (u: number, v: number) => Vec2;
}

/** How near geometry must already be to what a constraint or dimension says (mm). */
const TOLERANCE = 1e-6;
/** The same for directions (sine or cosine of the angle off). */
const ANGULAR = 1e-9;
/** A point solving may move without it counting (mm). */
const MOVE = 1e-6;

export function newTally(): ConstraintTally {
  return { constraints: 0, dimensions: 0, leftOut: {}, maxDisplacement: 0, byKind: {} };
}

/** A parameter's evaluated value in Extrudo's base units, when its unit is one Extrudo knows. */
export function quantityOf(p: ParameterValue): Quantity | undefined {
  if (['mm', 'cm', 'm', 'in', 'ft'].includes(p.unit))
    return { value: p.value * 10, dim: { length: 1, angle: 0 } };
  if (p.unit === 'deg' || p.unit === 'rad')
    return { value: (p.value * 180) / Math.PI, dim: { length: 0, angle: 1 } };
  if (p.unit === '') return { value: p.value, dim: { length: 0, angle: 0 } };
  return undefined;
}

interface Candidate {
  kind: 'constraint' | 'dimension';
  /** What it is, for the tally: the relation's or the dimension's kind. */
  what: string;
  /** Adds it to the sketch; returns its ID. */
  add: () => string;
  id?: string;
  /** A dimension's value for the solver (mm or deg) and its parameter. */
  value?: number;
  name?: string;
  quantity?: Quantity;
  /** The expression stored, and the plain value to fall back to. */
  expr?: string;
  numeric?: string;
}

/**
 * Adds the file's constraints and dimensions of one sketch to the builder `k`,
 * which already holds its geometry and the coincident constraints that join
 * shared points. Returns a note for the report when some were left out.
 */
export function addSketchConstraints(
  k: SketchBuilder,
  sketch: F3dSketch,
  drawn: DrawnSketch,
  ctx: ConstraintContext,
  label: string,
): string | undefined {
  const relations = sketch.relations ?? [];
  const dimensions = sketch.dimensions ?? [];
  if (relations.length === 0 && dimensions.length === 0) return undefined;
  const left: Partial<Record<LeftOut, number>> = {};
  const counted: string[] = [];
  const leave = (why: LeftOut, what: string) => {
    left[why] = (left[why] ?? 0) + 1;
    const key = `${why}:${what}`;
    ctx.tally.byKind[key] = (ctx.tally.byKind[key] ?? 0) + 1;
    counted.push(key);
  };
  const candidates: Candidate[] = [];
  const geo = new Geometry(k.data);
  // What the sketch held before, to put back if the solver fails.
  const before = {
    constraints: { ...k.data.constraints },
    dimensions: { ...k.data.dimensions },
  };
  const claimed: string[] = [];
  try {
    vetAll();
  } catch {
    for (const key of Object.keys(k.data.constraints))
      if (!(key in before.constraints)) delete (k.data.constraints as Record<string, unknown>)[key];
    for (const key of Object.keys(k.data.dimensions))
      if (!(key in before.dimensions)) delete (k.data.dimensions as Record<string, unknown>)[key];
    for (const name of claimed) {
      ctx.values.delete(name);
      ctx.taken.delete(name);
    }
    for (const c of candidates) c.id = undefined;
    // All of them count as unchecked instead.
    for (const key of counted.splice(0)) ctx.tally.byKind[key] = (ctx.tally.byKind[key] ?? 1) - 1;
    for (const why of Object.keys(left) as LeftOut[]) delete left[why];
    for (let i = 0; i < relations.length + dimensions.length; i++) leave('failed', 'sketch');
  }
  return finish();

  function vetAll(): void {
    let budget = MAX_CANDIDATES;
    for (const r of relations) {
      if (budget-- <= 0) {
        leave('limit', r.kind ?? `0x${r.mask.toString(16)}`);
        continue;
      }
      const c = relationCandidate(k, r, drawn, geo);
      if (typeof c === 'string') leave(c, r.kind ?? `0x${r.mask.toString(16)}`);
      else candidates.push(c);
    }
    // Dimensions in an order where one an expression names comes first.
    const pending = [...dimensions].sort((a, b) => a.parameter.number - b.parameter.number);
    const named = new Set(pending.map((d) => d.parameter.name));
    for (let pass = 0; pending.length > 0 && pass < 2; pass++) {
      for (let i = 0; i < pending.length; ) {
        const d = pending[i] as SketchDimensionRecord;
        const deps = namesIn(d.parameter.expression);
        const waits = pass === 0 && deps.some((n) => named.has(n) && !ctx.values.has(n));
        if (waits) {
          i++;
          continue;
        }
        pending.splice(i, 1);
        if (budget-- <= 0) {
          leave('limit', d.kind);
          continue;
        }
        const c = dimensionCandidate(k, d, drawn, geo, ctx);
        if (typeof c === 'string') {
          leave(c, d.kind);
          continue;
        }
        candidates.push(c);
        // Later dimensions may name this one already (it is vetted below), and
        // none may take its name.
        if (c.name) {
          claimed.push(c.name);
          ctx.taken.add(c.name);
          if (c.quantity) ctx.values.set(c.name, c.quantity);
        }
      }
    }

    vet(k, candidates, ctx, leave);
  }

  function finish(): string | undefined {
    // An expression naming a dimension that was left out takes its value instead.
    const dropped = new Set(
      candidates.filter((c) => c.id === undefined && c.name).map((c) => c.name as string),
    );
    if (dropped.size > 0)
      for (const c of candidates) {
        if (c.id === undefined || c.expr === undefined || c.numeric === undefined) continue;
        if (!namesIn(c.expr).some((n) => dropped.has(n))) continue;
        const stored = (k.data.dimensions as Record<string, { expr: string }>)[c.id];
        if (stored) stored.expr = c.numeric;
      }

    for (const c of candidates) {
      if (c.id === undefined) {
        if (c.name) {
          ctx.values.delete(c.name);
          ctx.taken.delete(c.name);
        }
        continue;
      }
      if (c.kind === 'constraint') ctx.tally.constraints++;
      else {
        ctx.tally.dimensions++;
        if (c.name) ctx.taken.add(c.name);
      }
    }
    for (const [why, n] of Object.entries(left) as [LeftOut, number][])
      ctx.tally.leftOut[why] = (ctx.tally.leftOut[why] ?? 0) + n;
    const total = Object.values(left).reduce((a, b) => a + (b ?? 0), 0);
    if (total === 0) return undefined;
    const words: Record<LeftOut, string> = {
      geometry: 'name geometry not imported',
      unsupported: 'have no Extrudo counterpart',
      mismatch: "don't match the geometry",
      overconstrains: 'over-constrain the sketch',
      moves: 'would move geometry',
      limit: `are past the first ${MAX_CANDIDATES} of a sketch`,
      failed: 'could not be checked (the solver failed on this sketch)',
    };
    const why = (Object.entries(left) as [LeftOut, number][])
      .map(([w, n]) => `${n} ${words[w]}`)
      .join(', ');
    return `${label}: ${total} of ${relations.length + dimensions.length} constraints and dimensions left out (${why}).`;
  }
}

/**
 * Adds the candidates and solves; takes out what the solver names redundant
 * or conflicting, one at a time (the latest first), until the sketch solves
 * as cleanly as it did without them; then, while solving still moves a point,
 * the latest candidate in a component that moved. Trouble the sketch had
 * before (its own coincident joins) is not held against the candidates.
 */
function vet(
  k: SketchBuilder,
  candidates: Candidate[],
  ctx: ConstraintContext,
  leave: (why: LeftOut, what: string) => void,
): void {
  const values: Record<string, number> = {};
  const before = ctx.solver.solve(k.data, {});
  const already = new Set([...before.conflicting, ...before.redundant]);
  const failing = new Set(before.components.filter((r) => !r.ok).flatMap((r) => r.entities));
  for (const c of candidates) {
    try {
      c.id = c.add();
      if (c.value !== undefined) values[c.id] = c.value;
    } catch {
      leave('unsupported', c.what);
    }
  }
  // A tangent keeps the side its curves meet on, read once every point that
  // makes the joint (a point on the circle, say) is in.
  for (const c of candidates) {
    const t = c.id === undefined ? undefined : k.data.constraints[c.id as never];
    if (t?.type !== 'tangent') continue;
    const reversed = tangentReversed(
      { ...k.data, constraints: withoutKey(k.data.constraints, c.id as string) },
      t.a,
      t.b,
    );
    if (reversed === undefined) delete (t as { reversed?: boolean }).reversed;
    else (t as { reversed?: boolean }).reversed = reversed;
  }
  const remove = (c: Candidate) => {
    const id = c.id as string;
    delete (k.data.constraints as Record<string, unknown>)[id];
    delete (k.data.dimensions as Record<string, unknown>)[id];
    delete values[id];
    c.id = undefined;
  };
  const latest = (test: (c: Candidate) => boolean) =>
    [...candidates].reverse().find((c) => c.id !== undefined && test(c));
  for (;;) {
    const result = ctx.solver.solve(k.data, values as DimensionValues);
    const bad = new Set(
      [...result.conflicting, ...result.redundant].filter((id) => !already.has(id)),
    );
    // Components in new trouble: a named constraint, or a failed solve that didn't fail before.
    const trouble = new Set(
      result.components
        .filter(
          (r) =>
            [...r.conflicting, ...r.redundant].some((id) => bad.has(id)) ||
            (!r.ok && !r.entities.some((e) => failing.has(e))),
        )
        .flatMap((r) => r.entities),
    );
    const pick =
      latest((c) => bad.has(c.id as string)) ??
      latest((c) => refsOf(k.data, c.id as string).some((e) => trouble.has(e)));
    if (pick) {
      remove(pick);
      leave('overconstrains', pick.what);
      continue;
    }
    // Solving moves something: the latest candidate in a component that moved goes.
    const moved = movedPoints(k.data, result.solution.points);
    if (moved.size > 0) {
      const moving = new Set(
        result.components
          .filter((r) => r.entities.some((e) => moved.has(e)))
          .flatMap((r) => r.entities),
      );
      const culprit = latest((c) => refsOf(k.data, c.id as string).some((e) => moving.has(e)));
      if (culprit) {
        remove(culprit);
        leave('moves', culprit.what);
        continue;
      }
    }
    ctx.tally.maxDisplacement = Math.max(
      ctx.tally.maxDisplacement,
      displacement(k.data, result.solution.points),
    );
    return;
  }
}

function withoutKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  const { [key]: _, ...rest } = record;
  return rest;
}

/** The entities a constraint or dimension refers to. */
function refsOf(data: SketchData, id: string): string[] {
  const c = (data.constraints as Record<string, Record<string, unknown>>)[id];
  const d = (data.dimensions as Record<string, Record<string, unknown>>)[id];
  const o = c ?? d ?? {};
  return ['a', 'b', 'point', 'curve', 'of', 'entity', 'axis']
    .map((key) => o[key])
    .filter((v): v is string => typeof v === 'string');
}

/** The points a solve moved further than {@link MOVE}. */
function movedPoints(
  data: SketchData,
  points: Readonly<Record<string, { x: number; y: number }>>,
): Set<string> {
  const out = new Set<string>();
  for (const [id, p] of Object.entries(points)) {
    const e = (data.entities as Record<string, { type: string; x?: number; y?: number }>)[id];
    if (e?.type === 'point' && Math.hypot(p.x - (e.x as number), p.y - (e.y as number)) > MOVE)
      out.add(id);
  }
  return out;
}

/** The largest distance a solve moved any point of the sketch (mm). */
export function displacement(
  data: SketchData,
  points: Readonly<Record<string, { x: number; y: number }>>,
): number {
  let max = 0;
  for (const [id, p] of Object.entries(points)) {
    const e = (data.entities as Record<string, { type: string; x?: number; y?: number }>)[id];
    if (e?.type !== 'point') continue;
    max = Math.max(max, Math.hypot(p.x - (e.x as number), p.y - (e.y as number)));
  }
  return max;
}

/** Reads the sketch's geometry as the solver will see it. */
class Geometry {
  readonly #data: SketchData;
  constructor(data: SketchData) {
    this.#data = data;
  }
  entity(id: string) {
    return (this.#data.entities as Record<string, { type: string } | undefined>)[id];
  }
  point(id: string): Vec2 {
    const p = this.entity(id) as SketchPoint;
    return [p.x, p.y];
  }
  line(id: string): [Vec2, Vec2] {
    const l = this.entity(id) as SketchLine;
    return [this.point(l.start), this.point(l.end)];
  }
  center(id: string): Vec2 {
    return this.point((this.entity(id) as SketchCircle | SketchArc).center);
  }
  radius(id: string): number {
    const e = this.entity(id) as SketchCircle | SketchArc;
    if (e.type === 'circle') return e.radius;
    return dist(this.point(e.center), this.point(e.start));
  }
}

const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];
const len = (v: Vec2) => Math.hypot(v[0], v[1]);
const dist = (a: Vec2, b: Vec2) => len(sub(a, b));
const cross = (a: Vec2, b: Vec2) => a[0] * b[1] - a[1] * b[0];
const dot = (a: Vec2, b: Vec2) => a[0] * b[0] + a[1] * b[1];
/** The distance from `p` to the infinite line through `a` and `b`. */
const toLine = (p: Vec2, [a, b]: [Vec2, Vec2]) =>
  Math.abs(cross(sub(b, a), sub(p, a))) / dist(a, b);
const sine = (u: Vec2, v: Vec2) => Math.abs(cross(u, v)) / (len(u) * len(v));
const cosine = (u: Vec2, v: Vec2) => Math.abs(dot(u, v)) / (len(u) * len(v));

const isCircular = (t?: string) => t === 'circle' || t === 'arc';

/** The Extrudo entity of a locus: a point's first Extrudo point, or a curve's entity. */
function entityOf(drawn: DrawnSketch, record: number): string | undefined {
  return drawn.points.get(record)?.[0] ?? drawn.curves.get(record);
}

function relationCandidate(
  k: SketchBuilder,
  r: SketchRelation,
  drawn: DrawnSketch,
  geo: Geometry,
): Candidate | LeftOut {
  if (!r.kind) return 'unsupported';
  const ids = r.loci.map((l) => entityOf(drawn, l.id));
  if (ids.some((id) => id === undefined)) return 'geometry';
  const e = ids as string[];
  const types = e.map((id) => geo.entity(id)?.type);
  const of = (t: string) => e.filter((_, i) => types[i] === t);
  const make = (add: () => string): Candidate => ({
    kind: 'constraint',
    what: r.kind as string,
    add,
  });
  switch (r.kind) {
    case 'coincident': {
      if (e.length !== 2) return 'unsupported';
      const [a, b] = e as [string, string];
      if (types[0] === 'point' && types[1] === 'point') {
        if (a === b) return 'unsupported';
        return dist(geo.point(a), geo.point(b)) <= TOLERANCE
          ? make(() => k.coincident(a, b))
          : 'mismatch';
      }
      const point = types[0] === 'point' ? a : b;
      const curve = point === a ? b : a;
      const kind = geo.entity(curve)?.type;
      if (kind === 'line')
        return toLine(geo.point(point), geo.line(curve)) <= TOLERANCE
          ? make(() => k.pointOnCurve(point, curve))
          : 'mismatch';
      if (isCircular(kind))
        return Math.abs(dist(geo.point(point), geo.center(curve)) - geo.radius(curve)) <= TOLERANCE
          ? make(() => k.pointOnCurve(point, curve))
          : 'mismatch';
      return 'unsupported';
    }
    case 'horizontal':
    case 'vertical': {
      // The plane map may turn the file's axes: the geometry says which this is in Extrudo.
      if (e.length !== 1 || types[0] !== 'line') return 'unsupported';
      const [a, b] = geo.line(e[0] as string);
      if (Math.abs(a[1] - b[1]) <= TOLERANCE) return make(() => k.horizontal(e[0] as string));
      if (Math.abs(a[0] - b[0]) <= TOLERANCE) return make(() => k.vertical(e[0] as string));
      return 'mismatch';
    }
    case 'parallel':
    case 'perpendicular':
    case 'collinear': {
      if (e.length !== 2 || of('line').length !== 2) return 'unsupported';
      const [a, b] = e as [string, string];
      const la = geo.line(a);
      const lb = geo.line(b);
      const u = sub(la[1], la[0]);
      const v = sub(lb[1], lb[0]);
      const ok =
        r.kind === 'perpendicular'
          ? cosine(u, v) <= ANGULAR
          : r.kind === 'parallel'
            ? sine(u, v) <= ANGULAR
            : toLine(lb[0], la) <= TOLERANCE && toLine(lb[1], la) <= TOLERANCE;
      if (!ok) return 'mismatch';
      return make(() => k[r.kind as 'parallel'](a, b));
    }
    case 'concentric': {
      if (e.length !== 2 || !types.every(isCircular)) return 'unsupported';
      const [a, b] = e as [string, string];
      return dist(geo.center(a), geo.center(b)) <= TOLERANCE
        ? make(() => k.concentric(a, b))
        : 'mismatch';
    }
    case 'equal': {
      if (e.length !== 2) return 'unsupported';
      const [a, b] = e as [string, string];
      if (types.every((t) => t === 'line')) {
        const [la, lb] = [geo.line(a), geo.line(b)];
        return Math.abs(dist(...la) - dist(...lb)) <= TOLERANCE
          ? make(() => k.equal(a, b))
          : 'mismatch';
      }
      if (types.every(isCircular))
        return Math.abs(geo.radius(a) - geo.radius(b)) <= TOLERANCE
          ? make(() => k.equal(a, b))
          : 'mismatch';
      return 'unsupported';
    }
    case 'midpoint': {
      const [point] = of('point');
      const [curve] = [...of('line'), ...of('arc')];
      if (e.length !== 2 || point === undefined || curve === undefined) return 'unsupported';
      let m: Vec2;
      if (geo.entity(curve)?.type === 'line') {
        const [a, b] = geo.line(curve);
        m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      } else {
        // An arc runs counter-clockwise from its start to its end.
        const arc = geo.entity(curve) as SketchArc;
        const c = geo.center(curve);
        const [s0, s1] = [sub(geo.point(arc.start), c), sub(geo.point(arc.end), c)];
        const from = Math.atan2(s0[1], s0[0]);
        let sweep = Math.atan2(s1[1], s1[0]) - from;
        while (sweep <= 0) sweep += 2 * Math.PI;
        const r = geo.radius(curve);
        m = [c[0] + r * Math.cos(from + sweep / 2), c[1] + r * Math.sin(from + sweep / 2)];
      }
      return dist(geo.point(point), m) <= TOLERANCE
        ? make(() => k.midpoint(point, curve))
        : 'mismatch';
    }
    case 'tangent': {
      if (e.length !== 2) return 'unsupported';
      const [a, b] = e as [string, string];
      const [ta, tb] = types;
      let ok: boolean;
      if (isCircular(ta) && isCircular(tb)) {
        const d = dist(geo.center(a), geo.center(b));
        const [ra, rb] = [geo.radius(a), geo.radius(b)];
        ok = Math.abs(d - ra - rb) <= TOLERANCE || Math.abs(d - Math.abs(ra - rb)) <= TOLERANCE;
      } else if (ta === 'line' && isCircular(tb)) {
        ok = Math.abs(toLine(geo.center(b), geo.line(a)) - geo.radius(b)) <= TOLERANCE;
      } else if (isCircular(ta) && tb === 'line') {
        ok = Math.abs(toLine(geo.center(a), geo.line(b)) - geo.radius(a)) <= TOLERANCE;
      } else return 'unsupported';
      if (!ok) return 'mismatch';
      return make(() => k.tangent(a, b));
    }
    case 'symmetric': {
      if (e.length !== 3) return 'unsupported';
      // The axis is a line the other two mirror onto each other across.
      const lines = e.filter((_, i) => types[i] === 'line');
      for (const axis of lines) {
        const [p, q] = e.filter((id) => id !== axis) as [string, string];
        const [tp, tq] = [geo.entity(p)?.type, geo.entity(q)?.type];
        if (tp !== tq) continue;
        const [o, f] = geo.line(axis);
        const u = sub(f, o);
        const mirror = (x: Vec2): Vec2 => {
          const t = dot(sub(x, o), u) / dot(u, u);
          return [2 * (o[0] + t * u[0]) - x[0], 2 * (o[1] + t * u[1]) - x[1]];
        };
        const same = (x: Vec2, y: Vec2) => dist(x, y) <= TOLERANCE;
        let ok = false;
        if (tp === 'point') ok = same(mirror(geo.point(p)), geo.point(q));
        else if (tp === 'line') {
          const [ps, pe] = geo.line(p).map(mirror) as [Vec2, Vec2];
          const [qs, qe] = geo.line(q);
          ok = (same(ps, qs) && same(pe, qe)) || (same(ps, qe) && same(pe, qs));
        } else if (tp === 'circle')
          ok =
            same(mirror(geo.center(p)), geo.center(q)) &&
            Math.abs(geo.radius(p) - geo.radius(q)) <= TOLERANCE;
        else if (tp === 'arc') {
          // Extrudo's mirrored arc runs the other way: a's start is b's end's image.
          const [ap, aq] = [geo.entity(p) as SketchArc, geo.entity(q) as SketchArc];
          ok =
            same(mirror(geo.point(ap.start)), geo.point(aq.end)) &&
            same(mirror(geo.point(ap.end)), geo.point(aq.start));
        } else continue;
        if (ok) return make(() => k.symmetric(p, q, axis));
      }
      return lines.length === 0 ? 'unsupported' : 'mismatch';
    }
  }
  return 'unsupported';
}

/** The parameter names an expression uses (unit names included; the caller filters). */
function namesIn(expression: string): string[] {
  return expression.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [];
}

const UNITS = new Set(['mm', 'cm', 'm', 'in', 'ft', 'deg', 'rad', 'um', 'mil']);

/**
 * A dimension's value as Extrudo stores it: the file's expression when every
 * name in it is a parameter Extrudo has and it evaluates to the file's value,
 * the value otherwise.
 */
function dimensionExpression(
  p: ParameterValue,
  want: Quantity,
  kind: 'length' | 'angle',
  ctx: ConstraintContext,
): { expr: string; numeric: string } {
  const v = Number(want.value.toPrecision(12));
  const numeric = kind === 'angle' ? `${v} deg` : `${v} mm`;
  const names = namesIn(p.expression).filter((n) => !UNITS.has(n));
  if (names.every((n) => ctx.values.has(n))) {
    const got = evaluateExpression(p.expression, { values: ctx.values, kind });
    if (got.ok && Math.abs(got.value - want.value) <= 1e-9 * (1 + Math.abs(want.value)))
      return { expr: p.expression, numeric };
  }
  return { expr: numeric, numeric };
}

function dimensionCandidate(
  k: SketchBuilder,
  d: SketchDimensionRecord,
  drawn: DrawnSketch,
  geo: Geometry,
  ctx: ConstraintContext,
): Candidate | LeftOut {
  const p = d.parameter;
  const want = quantityOf(p);
  if (!want) return 'unsupported';
  const ids = d.loci.map((l) => entityOf(drawn, l.id));
  if (ids.length === 0 || ids.some((id) => id === undefined)) return 'geometry';
  const e = ids as string[];
  const types = e.map((id) => geo.entity(id)?.type);
  const value = want.value;
  const near = (measured: number) => Math.abs(measured - value) <= TOLERANCE;
  // The file's name where Extrudo can take it; else one of Extrudo's own, so
  // no dimension is left for the design to name (its names could clash).
  const own =
    p.name.length <= 64 &&
    /^[A-Za-z_][A-Za-z0-9_]*$/.test(p.name) &&
    !isReservedName(p.name) &&
    !ctx.taken.has(p.name);
  const name = own ? p.name : undefined;
  const candidate = (
    kind: 'length' | 'angle',
    add: (expr: string, options: { name?: string }) => string,
  ): Candidate => {
    const { expr, numeric } = dimensionExpression(p, want, kind, ctx);
    return {
      kind: 'dimension',
      what: d.kind,
      // Added once; one Extrudo names itself only when the file's can't be taken.
      add: () => add(expr, { name: name ?? ctx.freeName() }),
      expr,
      numeric,
      value,
      ...(name ? { name, quantity: want } : {}),
    };
  };
  switch (d.kind) {
    case 'diameter':
      if (e.length !== 1 || types[0] !== 'circle') return 'unsupported';
      if (!near(2 * geo.radius(e[0] as string))) return 'mismatch';
      return candidate('length', (expr, o) => k.diameter(e[0] as string, expr, o).id);
    case 'radius':
      if (e.length !== 1 || !isCircular(types[0])) return 'unsupported';
      if (!near(geo.radius(e[0] as string))) return 'mismatch';
      return candidate('length', (expr, o) => k.radius(e[0] as string, expr, o).id);
    case 'angle': {
      if (e.length !== 2 || !types.every((t) => t === 'line')) return 'unsupported';
      const [a, b] = e as [string, string];
      const [la, lb] = [geo.line(a), geo.line(b)];
      const u = sub(la[1], la[0]);
      const v = sub(lb[1], lb[0]);
      const angle =
        (Math.acos(Math.max(-1, Math.min(1, dot(u, v) / (len(u) * len(v))))) * 180) / Math.PI;
      const supplement = Math.abs(angle - value) > 1e-7 && Math.abs(180 - angle - value) <= 1e-7;
      if (!supplement && Math.abs(angle - value) > 1e-7) return 'mismatch';
      return candidate(
        'angle',
        (expr, o) => k.angle(a, b, expr, supplement ? { ...o, supplement } : o).id,
      );
    }
    case 'linear': {
      if (e.length === 1 && types[0] === 'line') {
        const [a, b] = geo.line(e[0] as string);
        const o = linearOrientation(d, drawn);
        if (o === undefined) return 'unsupported';
        const measured =
          o === 'aligned' ? dist(a, b) : Math.abs(o === 'horizontal' ? a[0] - b[0] : a[1] - b[1]);
        if (!near(measured)) return 'mismatch';
        return candidate(
          'length',
          (expr, opts) => k.distance(e[0] as string, expr, { ...opts, orientation: o }).id,
        );
      }
      if (e.length !== 2) return 'unsupported';
      const [a, b] = e as [string, string];
      const [ta, tb] = types;
      if (ta === 'point' && tb === 'point') {
        const o = linearOrientation(d, drawn);
        if (o === undefined) return 'unsupported';
        const [pa, pb] = [geo.point(a), geo.point(b)];
        const measured =
          o === 'aligned'
            ? dist(pa, pb)
            : Math.abs(o === 'horizontal' ? pa[0] - pb[0] : pa[1] - pb[1]);
        if (!near(measured)) return 'mismatch';
        return candidate(
          'length',
          (expr, opts) => k.distance([a, b], expr, { ...opts, orientation: o }).id,
        );
      }
      if (ta === 'line' && tb === 'line') {
        const [la, lb] = [geo.line(a), geo.line(b)];
        if (sine(sub(la[1], la[0]), sub(lb[1], lb[0])) > ANGULAR) return 'mismatch';
        if (!near(toLine(lb[0], la))) return 'mismatch';
        return candidate('length', (expr, opts) => k.distance([a, b], expr, opts).id);
      }
      if ((ta === 'point' && tb === 'line') || (ta === 'line' && tb === 'point')) {
        const [point, line] = ta === 'point' ? [a, b] : [b, a];
        if (!near(toLine(geo.point(point), geo.line(line)))) return 'mismatch';
        return candidate('length', (expr, opts) => k.distance([point, line], expr, opts).id);
      }
      return 'unsupported';
    }
  }
  return 'unsupported';
}

/**
 * A linear dimension's direction in Extrudo's plane: the file's sketch axes
 * may land on the plane's other axis (or off both, where a horizontal or
 * vertical dimension has no counterpart).
 */
function linearOrientation(
  d: SketchDimensionRecord,
  drawn: DrawnSketch,
): 'aligned' | 'horizontal' | 'vertical' | undefined {
  const o = d.orientation;
  if (o === undefined || o === 'aligned') return o;
  const origin = drawn.map(0, 0);
  const axis = sub(o === 'horizontal' ? drawn.map(1, 0) : drawn.map(0, 1), origin);
  if (Math.abs(axis[1]) <= ANGULAR * len(axis)) return 'horizontal';
  if (Math.abs(axis[0]) <= ANGULAR * len(axis)) return 'vertical';
  return undefined;
}
