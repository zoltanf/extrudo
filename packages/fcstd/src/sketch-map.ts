/**
 * Draws one decoded FreeCAD sketch into a `SketchBuilder` (ADR-0144 decision
 * 8, S4): its geometry through the placement's 2D map, then its constraints
 * and dimensions as Extrudo's, vetted the way the f3d importer vets them
 * (ADR-0083). Imported geometry never moves: a constraint or dimension goes
 * in only when the drawn geometry already satisfies it, the sketch is then
 * solved, and whatever the solver calls redundant or conflicting, or that
 * would still move a point, comes out again and is counted. Without a solver
 * no constraint goes in.
 *
 * Every FreeCAD constraint gets exactly one outcome: `mapped`, or one
 * {@link LeftOut} reason. One FreeCAD constraint may stand for two of
 * Extrudo's (an end-to-end tangent is a coincident and a tangent); they go
 * in and come out together.
 *
 * References to the sketch's origin and its two axes become fixed
 * construction geometry the importer draws (decision 8), only when a kept
 * constraint uses them.
 */
import type { SketchBuilder } from '@extrudo/api';
import { isReservedName, type SketchData } from '@extrudo/core';
// Types only from the main entry: its solver loads planegcs, which the caller owns.
import type { DimensionValues, SketchSolver } from '@extrudo/sketch';
import { tangentReversed } from '@extrudo/sketch/inference';
import {
  type DecodedSketch,
  type FcConstraint,
  type FcGeometry,
  GEO_UNDEF,
  H_AXIS,
  V_AXIS,
  type Vec2,
} from './sketch-decode';
import type { SketchPlacement } from './sketch-place';

/** Why a FreeCAD constraint was left out. A small closed set, for the report. */
export type LeftOut =
  /** The record couldn't be read. */
  | 'unreadable'
  /** It names external (projected) geometry, which S9 brings in. */
  | 'external'
  /** It names geometry that wasn't drawn (an ellipse, an unreadable record) or that doesn't exist. */
  | 'geometry'
  /** It ties a B-spline's or a conic's helper geometry, which Extrudo's curve has built in. */
  | 'internal'
  /** Extrudo has no constraint or dimension like it. */
  | 'unsupported'
  /** FreeCAD's solver ignores it too (`IsActive` off). */
  | 'inactive'
  /** The drawn geometry does not satisfy it. */
  | 'mismatch'
  /** The solver calls it redundant or conflicting with the rest. */
  | 'overconstrains'
  /** The sketch would move with it. */
  | 'moves'
  /** Past the first {@link MAX_CANDIDATES} of a sketch. */
  | 'limit'
  /** The solver failed on the sketch, so none of its constraints could be checked. */
  | 'failed'
  /** No solver was given, so nothing could be checked. */
  | 'unchecked';

export type ConstraintOutcome = 'mapped' | LeftOut;

/** At most this many constraints of one sketch are vetted (the library's sketches have up to 71). */
export const MAX_CANDIDATES = 1000;
/** At most this many solve rounds per sketch; after them everything still in trouble comes out at once. */
export const MAX_VET_ROUNDS = 64;

/** A moving component with at most this many suspects has each tried out alone. */
const MAX_TRIALS = 24;
/** At most this many trial solves per sketch. */
const TRIAL_BUDGET = 256;
/** How near geometry must already be to what a constraint says (mm). */
const TOLERANCE = 1e-6;
/** The same for directions (sine or cosine of the angle off). */
const ANGULAR = 1e-9;
/** The same for an angle dimension (degrees). */
const DEGREES = 1e-7;
/** How far solving may move a point, or change a radius, without it counting (mm). */
const MOVE = 1e-6;
/** A value this small is zero (a distance of 0 is a coincidence). */
const ZERO = 1e-9;
/** The length of a drawn sketch axis (mm). */
const AXIS_LENGTH = 10;

/** FreeCAD constraint type names, for the counts. */
export const CONSTRAINT_TYPES: Readonly<Record<number, string>> = {
  0: 'None',
  1: 'Coincident',
  2: 'Horizontal',
  3: 'Vertical',
  4: 'Parallel',
  5: 'Tangent',
  6: 'Distance',
  7: 'DistanceX',
  8: 'DistanceY',
  9: 'Angle',
  10: 'Perpendicular',
  11: 'Radius',
  12: 'Equal',
  13: 'PointOnObject',
  14: 'Symmetric',
  15: 'InternalAlignment',
  16: 'SnellsLaw',
  17: 'Block',
  18: 'Diameter',
  19: 'Weight',
  20: 'Group',
  21: 'Text',
};
export const typeName = (type: number) => CONSTRAINT_TYPES[type] ?? `Type${type}`;

/** An entity of the sketch being built, as the checks read it. */
interface Ent {
  type: string;
  x?: number;
  y?: number;
  radius?: number;
  construction?: boolean;
  start?: string;
  end?: string;
  center?: string;
}

type Kind = 'line' | 'circle' | 'arc' | 'point' | 'spline';

/** What one FreeCAD curve became. */
interface Drawn {
  kind: Kind;
  /** The Extrudo entity (for a point, the point). */
  id: string;
  /** FreeCAD point positions (1 start, 2 end, 3 centre) → Extrudo points. */
  pos: Partial<Record<number, string>>;
}

export interface SketchMapResult {
  /** Curves drawn, by Extrudo kind, and `construction` for how many of them are. */
  readonly drawn: Record<string, number>;
  /** FreeCAD curves left out, by why (`ellipse`, `internal`, `unreadable`, `bspline`, `degenerate` …). */
  readonly geometryLeftOut: Record<string, number>;
  /** One outcome per FreeCAD constraint, in the file's order. */
  readonly constraints: readonly ConstraintOutcome[];
  /** The Extrudo constraint and dimension IDs of each mapped FreeCAD constraint. */
  readonly ids: readonly (readonly string[] | undefined)[];
  /** The Extrudo dimension each mapped FreeCAD constraint became, when it became one. */
  readonly dimensions: readonly (string | undefined)[];
  /** The largest displacement (points, radii) the final solve caused, mm. */
  readonly maxDisplacement: number;
  /** Degrees of freedom left after the final solve; `undefined` without a solve. */
  readonly dof?: number;
  /** The Extrudo line each FreeCAD line became, by geometry index (`undefined` for anything else). */
  readonly lines: readonly (string | undefined)[];
  /** The sketch axes drawn as fixed construction lines and kept (`SketchMapOptions.axes`, or a kept constraint's). */
  readonly axes: { readonly h?: string; readonly v?: string };
  /** The Extrudo point at each FreeCAD circle's or arc's centre, or each point (S7: a hole's centres), by geometry index. */
  readonly centres: readonly (string | undefined)[];
}

export interface SketchMapOptions {
  /** Vets the constraints; without one none is imported. */
  readonly solver?: SketchSolver;
  /** Parameter names already taken in the design; a FreeCAD name kept for a dimension is added. */
  readonly taken: Set<string>;
  /**
   * Sketch axes to draw as fixed construction lines and keep whether or not
   * a constraint names them (a revolve's axis, S5; decision 8).
   */
  readonly axes?: readonly ('h' | 'v')[];
}

class Leave extends Error {
  constructor(readonly reason: LeftOut) {
    super(reason);
  }
}
const leave = (reason: LeftOut): never => {
  throw new Leave(reason);
};

interface Item {
  /** Adds it to the sketch; returns its ID. */
  add: () => string;
  /** A driving dimension's value for the solver (mm or deg). */
  value?: number;
  /** It is a dimension (it holds the constraint's value). */
  dimension?: boolean;
}

interface Candidate {
  index: number;
  items: Item[];
  /** The IDs its items got; empty once it is taken out. */
  ids: string[];
  /** A parameter name it claimed. */
  name?: string;
  /** The ID of the dimension among its items. */
  dimension?: string;
}

const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];
const len = (v: Vec2) => Math.hypot(v[0], v[1]);
const dist = (a: Vec2, b: Vec2) => len(sub(a, b));
const cross = (a: Vec2, b: Vec2) => a[0] * b[1] - a[1] * b[0];
const dotv = (a: Vec2, b: Vec2) => a[0] * b[0] + a[1] * b[1];
const toLine = (p: Vec2, [a, b]: [Vec2, Vec2]) =>
  Math.abs(cross(sub(b, a), sub(p, a))) / dist(a, b);
const sine = (u: Vec2, v: Vec2) => Math.abs(cross(u, v)) / (len(u) * len(v));
const cosine = (u: Vec2, v: Vec2) => Math.abs(dotv(u, v)) / (len(u) * len(v));
const round = (k: Kind) => k === 'circle' || k === 'arc';
/** A number for an expression: 15 significant digits. */
const literal = (v: number) => `${Number(v.toPrecision(15))}`;

/** A FreeCAD arc's ends, counter-clockwise in the sketch plane (point positions 1 and 2). */
export function arcEnds(g: Extract<FcGeometry, { kind: 'arc' }>): { start: Vec2; end: Vec2 } {
  const a = g.angleXU;
  // A conic's frame: X turned by AngleXU about the normal; a downward normal reverses X.
  const X: Vec2 = g.reversed ? [-Math.cos(a), Math.sin(a)] : [Math.cos(a), Math.sin(a)];
  const Y: Vec2 = g.reversed ? [Math.sin(a), Math.cos(a)] : [-Math.sin(a), Math.cos(a)];
  const at = (t: number): Vec2 => [
    g.center[0] + g.radius * (Math.cos(t) * X[0] + Math.sin(t) * Y[0]),
    g.center[1] + g.radius * (Math.cos(t) * X[1] + Math.sin(t) * Y[1]),
  ];
  const s = at(g.startAngle);
  const e = at(g.endAngle);
  return g.reversed ? { start: e, end: s } : { start: s, end: e };
}

/** A B-spline Extrudo's control spline holds exactly: its full knot vector from 0 to 1, or why not. */
function splineKnots(g: Extract<FcGeometry, { kind: 'bspline' }>): number[] | string {
  const p = g.degree;
  const n = g.poles.length;
  if (g.periodic) return 'periodic-bspline';
  if (g.weights.some((w) => Math.abs(w - 1) > 1e-12)) return 'rational-bspline';
  if (p > 5 || n < p + 1) return 'bspline-degree';
  const m = g.multiplicities;
  if (m.length < 2 || m.length !== g.knots.length) return 'bspline-knots';
  for (let i = 0; i < m.length; i++) {
    const mi = m[i] as number;
    const end = i === 0 || i === m.length - 1;
    if (end ? mi !== p + 1 : mi < 1 || mi > p) return 'bspline-knots';
    if (i > 0 && !((g.knots[i] as number) > (g.knots[i - 1] as number))) return 'bspline-knots';
  }
  if (m.reduce((a, b) => a + b, 0) !== n + p + 1) return 'bspline-knots';
  const k0 = g.knots[0] as number;
  const span = (g.knots.at(-1) as number) - k0;
  if (!Number.isFinite(span)) return 'bspline-knots';
  const out: number[] = [];
  let last = -1;
  for (let i = 0; i < g.knots.length; i++) {
    const t = i === 0 ? 0 : i === g.knots.length - 1 ? 1 : ((g.knots[i] as number) - k0) / span;
    // Knots far apart in size can land on each other once scaled to 0–1.
    if (!(t > last && t <= 1)) return 'bspline-knots';
    last = t;
    for (let r = 0; r < (m[i] as number); r++) out.push(t);
  }
  return out;
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

/** What the sketch's own constraints are, to spot one FreeCAD stated twice. */
function constraintKey(data: SketchData, id: string): string | undefined {
  const c = (data.constraints as Record<string, Record<string, unknown>>)[id];
  if (!c) return undefined;
  const { reversed: _, ...rest } = c;
  const pairs = ['coincident', 'parallel', 'perpendicular', 'equal', 'collinear', 'concentric'];
  if (pairs.includes(c.type as string) && (c.a as string) > (c.b as string))
    return JSON.stringify({ ...rest, a: c.b, b: c.a });
  if ((c.type === 'horizontal' || c.type === 'vertical') && c.b !== undefined) {
    const [a, b] = [c.a as string, c.b as string].sort();
    return JSON.stringify({ ...rest, a, b });
  }
  return JSON.stringify(rest);
}

/**
 * Draws `sketch` into `k` through `placement`, then adds and vets its
 * constraints. Linear in the sketch's size; the vetting is bounded by
 * {@link MAX_CANDIDATES} and {@link MAX_VET_ROUNDS}.
 */
export function mapSketch(
  k: SketchBuilder,
  sketch: DecodedSketch,
  placement: SketchPlacement,
  options: SketchMapOptions,
): SketchMapResult {
  const entities = k.data.entities as unknown as Record<string, Ent | undefined>;
  const m = (p: Vec2): Vec2 => placement.map(p[0], p[1]);
  const count = (r: Record<string, number>, key: string) => {
    r[key] = (r[key] ?? 0) + 1;
  };
  const drawnCount: Record<string, number> = {};
  const geometryLeftOut: Record<string, number> = {};
  const drawn: (Drawn | undefined)[] = [];
  /** Why a curve wasn't drawn: `internal` or `geometry`. */
  const missing: LeftOut[] = [];

  // Geometry ------------------------------------------------------------------
  for (let i = 0; i < sketch.geometry.length; i++) {
    const g = sketch.geometry[i];
    const skip = (why: string, reason: LeftOut = 'geometry') => {
      count(geometryLeftOut, why);
      missing[i] = reason;
    };
    if (!g) {
      skip('unreadable');
      continue;
    }
    if (g.internal !== 0) {
      skip('internal', 'internal');
      continue;
    }
    let d: Drawn | undefined;
    switch (g.kind) {
      case 'line': {
        const [a, b] = [m(g.start), m(g.end)];
        if (dist(a, b) < 1e-9) {
          skip('degenerate');
          continue;
        }
        const h = k.line(a, b);
        d = { kind: 'line', id: h.id, pos: { 1: h.start.id, 2: h.end.id } };
        break;
      }
      case 'circle': {
        const h = k.circle(m(g.center), g.radius);
        d = { kind: 'circle', id: h.id, pos: { 3: h.center.id } };
        break;
      }
      case 'arc': {
        const { start, end } = arcEnds(g);
        const [ms, me, mc] = [m(start), m(end), m(g.center)];
        // Counter-clockwise in FreeCAD's frame is clockwise in a mirrored one;
        // Extrudo's arc runs counter-clockwise from its stored start.
        const h = placement.mirrored ? k.arcCentered(mc, me, ms) : k.arcCentered(mc, ms, me);
        const at = (id: string): Vec2 => [entities[id]?.x as number, entities[id]?.y as number];
        const first = dist(at(h.start.id), ms) <= dist(at(h.end.id), ms) ? h.start : h.end;
        const last = first === h.start ? h.end : h.start;
        d = { kind: 'arc', id: h.id, pos: { 1: first.id, 2: last.id, 3: h.center.id } };
        break;
      }
      case 'point': {
        const h = k.point(m(g.at));
        d = { kind: 'point', id: h.id, pos: { 1: h.id } };
        break;
      }
      case 'bspline': {
        const knots = splineKnots(g);
        if (typeof knots === 'string') {
          skip(knots);
          continue;
        }
        const h = k.splineControl(g.poles.map(m), { degree: g.degree, knots });
        const ends = [h.points[0], h.points.at(-1)];
        d = {
          kind: 'spline',
          id: h.id,
          pos: { ...(ends[0] ? { 1: ends[0].id } : {}), ...(ends[1] ? { 2: ends[1].id } : {}) },
        };
        break;
      }
      case 'ellipse':
      case 'arcOfEllipse': {
        skip(g.kind);
        continue;
      }
      default: {
        skip(`other:${g.type}`);
        continue;
      }
    }
    if (g.construction && d.kind !== 'point') {
      const e = entities[d.id];
      if (e && 'construction' in e) e.construction = true;
    }
    drawn[i] = d;
    count(drawnCount, d.kind);
    if (g.construction) count(drawnCount, 'construction');
  }

  // The sketch's origin and axes, drawn when a candidate names them; taken out again when none stays.
  const datums: { root?: string; h?: string; v?: string } = {};
  const datumParts = new Map<string, string[]>();
  const root = (): string => {
    if (!datums.root) {
      const p = k.point(m([0, 0]));
      datumParts.set(p.id, [p.id, k.fix(p)]);
      datums.root = p.id;
    }
    return datums.root;
  };
  const axis = (which: 'h' | 'v'): string => {
    let id = datums[which];
    if (!id) {
      const l = k.line(m([0, 0]), m(which === 'h' ? [AXIS_LENGTH, 0] : [0, AXIS_LENGTH]));
      const e = entities[l.id];
      if (e) e.construction = true;
      datumParts.set(l.id, [l.id, l.start.id, l.end.id, k.fix(l)]);
      id = l.id;
      datums[which] = id;
    }
    return id;
  };

  for (const which of options.axes ?? []) axis(which);

  // Reading the drawn geometry -------------------------------------------------
  const pointAt = (id: string): Vec2 => [entities[id]?.x as number, entities[id]?.y as number];
  const lineAt = (id: string): [Vec2, Vec2] => {
    const l = entities[id] as { start: string; end: string };
    return [pointAt(l.start), pointAt(l.end)];
  };
  const centerOf = (id: string): Vec2 => pointAt((entities[id] as Ent & { center: string }).center);
  const radiusOf = (id: string): number => {
    const e = entities[id] as { type: string; radius?: number; center: string; start?: string };
    return e.type === 'circle'
      ? (e.radius as number)
      : dist(pointAt(e.center), pointAt(e.start as string));
  };
  const near = (a: number, b: number) => Math.abs(a - b) <= TOLERANCE;
  const check = (ok: boolean) => {
    if (!ok) leave('mismatch');
  };

  // References ---------------------------------------------------------------------
  const drawnAt = (g: number): Drawn => {
    if (g === GEO_UNDEF) return leave('unsupported');
    if (g <= -3) return leave('external');
    if (g >= sketch.geometry.length) return leave('geometry');
    const d = drawn[g];
    if (!d) return leave(missing[g] ?? 'geometry');
    return d;
  };
  /** A point: a geometry index and a point position. */
  const point = (g: number, pos: number): string => {
    if (g === H_AXIS && pos === 1) return root();
    if (g === H_AXIS || g === V_AXIS) return leave('unsupported');
    return drawnAt(g).pos[pos] ?? leave('unsupported');
  };
  /** A curve: a geometry index with point position 0 (the axes are drawn lines). */
  const curve = (g: number): { id: string; kind: Kind } => {
    if (g === H_AXIS) return { id: axis('h'), kind: 'line' };
    if (g === V_AXIS) return { id: axis('v'), kind: 'line' };
    return drawnAt(g);
  };
  /** FreeCAD's sketch x or y axis as Extrudo's horizontal or vertical. */
  const orient = (fc: 'x' | 'y'): 'horizontal' | 'vertical' => {
    if (placement.axes === 'rotated') return leave('unsupported');
    return (fc === 'x') !== (placement.axes === 'swap') ? 'horizontal' : 'vertical';
  };
  const along = (o: 'horizontal' | 'vertical', a: Vec2, b: Vec2) =>
    Math.abs(o === 'horizontal' ? b[0] - a[0] : b[1] - a[1]);
  const isTangent = (a: { id: string; kind: Kind }, b: { id: string; kind: Kind }) => {
    if (a.kind === 'line' && round(b.kind))
      return near(toLine(centerOf(b.id), lineAt(a.id)), radiusOf(b.id));
    if (round(a.kind) && b.kind === 'line')
      return near(toLine(centerOf(a.id), lineAt(b.id)), radiusOf(a.id));
    const d = dist(centerOf(a.id), centerOf(b.id));
    const [ra, rb] = [radiusOf(a.id), radiusOf(b.id)];
    return near(d, ra + rb) || near(d, Math.abs(ra - rb));
  };
  const onCurve = (p: string, c: { id: string; kind: Kind }) =>
    c.kind === 'line'
      ? near(toLine(pointAt(p), lineAt(c.id)), 0)
      : near(dist(pointAt(p), centerOf(c.id)), radiusOf(c.id));

  // Constraints ------------------------------------------------------------------
  const constraintOutcomes: ConstraintOutcome[] = [];
  const candidates: Candidate[] = [];
  const values: Record<string, number> = {};
  let name: string | undefined;

  /** The items for one FreeCAD constraint; throws `Leave`. */
  const itemsOf = (c: FcConstraint): Item[] => {
    name = undefined;
    const driven = !c.driving;
    const dimension = (add: (expr: string, o: { driven: boolean; name?: string }) => string) => {
      return (v: number, unit: 'mm' | 'deg'): Item => {
        const own =
          !driven &&
          c.name.length > 0 &&
          c.name.length <= 64 &&
          /^[A-Za-z_][A-Za-z0-9_]*$/.test(c.name) &&
          !isReservedName(c.name) &&
          !options.taken.has(c.name);
        if (own) name = c.name;
        const label = own ? c.name : undefined;
        return {
          add: () => add(`${literal(v)} ${unit}`, { driven, ...(label ? { name: label } : {}) }),
          dimension: true,
          ...(driven ? {} : { value: v }),
        };
      };
    };
    const one = (add: () => string): Item => ({ add });
    const { first, second, third, firstPos: fp, secondPos: sp, thirdPos: tp } = c;
    switch (c.type) {
      case 1: {
        const [p, q] = [point(first, fp), point(second, sp)];
        if (p === q) return leave('unsupported');
        check(dist(pointAt(p), pointAt(q)) <= TOLERANCE);
        return [one(() => k.coincident(p, q))];
      }
      case 2:
      case 3: {
        if (second === GEO_UNDEF) {
          if (fp !== 0) return leave('unsupported');
          const l = curve(first);
          if (l.kind !== 'line') return leave('unsupported');
          if (placement.axes === 'rotated') {
            // FreeCAD's axes are off the plane's: level with the drawn sketch axis instead.
            const ax = axis(c.type === 2 ? 'h' : 'v');
            if (ax === l.id) return leave('overconstrains');
            const [la, lb] = [lineAt(l.id), lineAt(ax)];
            check(sine(sub(la[1], la[0]), sub(lb[1], lb[0])) <= ANGULAR);
            return [one(() => k.parallel(l.id, ax))];
          }
          const o = orient(c.type === 2 ? 'x' : 'y');
          check(
            along(o === 'horizontal' ? 'vertical' : 'horizontal', ...lineAt(l.id)) <= TOLERANCE,
          );
          return [one(() => (o === 'horizontal' ? k.horizontal(l.id) : k.vertical(l.id)))];
        }
        const o = orient(c.type === 2 ? 'x' : 'y');
        const [p, q] = [point(first, fp), point(second, sp)];
        if (p === q) return leave('unsupported');
        check(
          along(o === 'horizontal' ? 'vertical' : 'horizontal', pointAt(p), pointAt(q)) <=
            TOLERANCE,
        );
        return [one(() => (o === 'horizontal' ? k.horizontal(p, q) : k.vertical(p, q)))];
      }
      case 4: {
        const [a, b] = [curve(first), curve(second)];
        if (a.kind !== 'line' || b.kind !== 'line' || a.id === b.id) return leave('unsupported');
        const [la, lb] = [lineAt(a.id), lineAt(b.id)];
        check(sine(sub(la[1], la[0]), sub(lb[1], lb[0])) <= ANGULAR);
        return [one(() => k.parallel(a.id, b.id))];
      }
      case 5: {
        if (third !== GEO_UNDEF) return leave('unsupported');
        const [a, b] = [curve(first), curve(second)];
        if (a.id === b.id) return leave('unsupported');
        const lines = a.kind === 'line' && b.kind === 'line';
        if (
          !lines &&
          !((a.kind === 'line' || round(a.kind)) && (b.kind === 'line' || round(b.kind)))
        )
          return leave('unsupported');
        const items: Item[] = [];
        if (fp !== 0 && sp !== 0) {
          const [p, q] = [point(first, fp), point(second, sp)];
          check(dist(pointAt(p), pointAt(q)) <= TOLERANCE);
          items.push(one(() => k.coincident(p, q)));
        } else if (fp !== 0 || sp !== 0) {
          const [p, on] = fp !== 0 ? [point(first, fp), b] : [point(second, sp), a];
          check(onCurve(p, on));
          items.push(one(() => k.pointOnCurve(p, on.id)));
        }
        if (lines) {
          const la = lineAt(a.id);
          const lb = lineAt(b.id);
          check(near(toLine(lb[0], la), 0) && near(toLine(lb[1], la), 0));
          items.push(one(() => k.collinear(a.id, b.id)));
        } else {
          check(isTangent(a, b));
          items.push(one(() => k.tangent(a.id, b.id)));
        }
        return items;
      }
      case 6: {
        if (third !== GEO_UNDEF) return leave('unsupported');
        if (c.value < 0) return leave('mismatch');
        const length = (target: string | [string, string]) =>
          dimension((expr, o) => k.distance(target, expr, o).id)(c.value, 'mm');
        if (second === GEO_UNDEF) {
          if (fp !== 0) return leave('unsupported');
          const l = curve(first);
          if (l.kind !== 'line') return leave('unsupported');
          check(near(dist(...lineAt(l.id)), c.value));
          return [length(l.id)];
        }
        if (fp !== 0 && sp !== 0) {
          const [p, q] = [point(first, fp), point(second, sp)];
          if (p === q) return leave('unsupported');
          check(near(dist(pointAt(p), pointAt(q)), c.value));
          if (c.value <= ZERO) return [one(() => k.coincident(p, q))];
          return [length([p, q])];
        }
        if (fp !== 0 && sp === 0) {
          const p = point(first, fp);
          const l = curve(second);
          if (l.kind !== 'line') return leave('unsupported');
          check(near(toLine(pointAt(p), lineAt(l.id)), c.value));
          if (c.value <= ZERO) return [one(() => k.pointOnCurve(p, l.id))];
          return [length([p, l.id])];
        }
        return leave('unsupported');
      }
      case 7:
      case 8: {
        const o = orient(c.type === 7 ? 'x' : 'y');
        const v = Math.abs(c.value);
        const square = o === 'horizontal' ? 'vertical' : 'horizontal';
        let target: string | [string, string];
        let measured: number;
        if (second === GEO_UNDEF && fp === 0) {
          const l = curve(first);
          if (l.kind !== 'line') return leave('unsupported');
          measured = along(o, ...lineAt(l.id));
          target = l.id;
        } else {
          if (second !== GEO_UNDEF && sp === 0) return leave('unsupported');
          const [p, q] =
            second === GEO_UNDEF
              ? [root(), point(first, fp)]
              : [point(first, fp), point(second, sp)];
          if (p === q) return leave('unsupported');
          measured = along(o, pointAt(p), pointAt(q));
          target = [p, q];
        }
        check(near(measured, v));
        if (v <= ZERO) {
          const t = target;
          return [one(() => (typeof t === 'string' ? k[square](t) : k[square](t[0], t[1])))];
        }
        const t = target;
        return [
          dimension((expr, opts) => k.distance(t, expr, { ...opts, orientation: o }).id)(v, 'mm'),
        ];
      }
      case 9: {
        if (third !== GEO_UNDEF) return leave('unsupported');
        let a: { id: string; kind: Kind };
        let b: { id: string; kind: Kind };
        let reversals = 0;
        if (second === GEO_UNDEF) {
          if (fp !== 0) return leave('unsupported');
          b = curve(first);
          if (b.kind !== 'line') return leave('unsupported');
          a = { id: axis('h'), kind: 'line' };
        } else {
          a = curve(first);
          b = curve(second);
          if (fp === 2) reversals++;
          if (sp === 2) reversals++;
        }
        if (a.kind !== 'line' || b.kind !== 'line' || a.id === b.id) return leave('unsupported');
        // FreeCAD's angle between the two directions, 0..180°; Extrudo's lines run start → end,
        // so a direction taken from a line's end makes the angle its supplement.
        const deg = (Math.acos(Math.max(-1, Math.min(1, Math.cos(c.value)))) * 180) / Math.PI;
        const [la, lb] = [lineAt(a.id), lineAt(b.id)];
        const [u, w] = [sub(la[1], la[0]), sub(lb[1], lb[0])];
        const measured =
          (Math.acos(Math.max(-1, Math.min(1, dotv(u, w) / (len(u) * len(w))))) * 180) / Math.PI;
        const supplement = reversals % 2 === 1;
        check(Math.abs(measured - (supplement ? 180 - deg : deg)) <= DEGREES);
        if (deg <= DEGREES || deg >= 180 - DEGREES) return [one(() => k.parallel(a.id, b.id))];
        const [ai, bi] = [a.id, b.id];
        return [
          dimension(
            (expr, o) =>
              k.angle(ai, bi, expr, { ...o, ...(supplement ? { supplement: true } : {}) }).id,
          )(deg, 'deg'),
        ];
      }
      case 10: {
        if (third !== GEO_UNDEF) return leave('unsupported');
        if ((fp === 0) !== (sp === 0)) return leave('unsupported');
        const [a, b] = [curve(first), curve(second)];
        if (a.id === b.id) return leave('unsupported');
        const items: Item[] = [];
        if (fp !== 0) {
          const [p, q] = [point(first, fp), point(second, sp)];
          check(dist(pointAt(p), pointAt(q)) <= TOLERANCE);
          items.push(one(() => k.coincident(p, q)));
        }
        if (a.kind === 'line' && b.kind === 'line') {
          const [la, lb] = [lineAt(a.id), lineAt(b.id)];
          check(cosine(sub(la[1], la[0]), sub(lb[1], lb[0])) <= ANGULAR);
          items.push(one(() => k.perpendicular(a.id, b.id)));
          return items;
        }
        // A line square to a circle runs through its centre.
        const [l, r] = a.kind === 'line' ? [a, b] : [b, a];
        if (l.kind !== 'line' || !round(r.kind)) return leave('unsupported');
        const center = (entities[r.id] as Ent & { center: string }).center;
        check(near(toLine(pointAt(center), lineAt(l.id)), 0));
        items.push(one(() => k.pointOnCurve(center, l.id)));
        return items;
      }
      case 11:
      case 18: {
        if (c.value <= 0) return leave('mismatch');
        const a = curve(first);
        if (!round(a.kind)) return leave('unsupported');
        const r = radiusOf(a.id);
        if (c.type === 18 && a.kind === 'circle') {
          check(near(2 * r, c.value));
          return [dimension((expr, o) => k.diameter(a.id, expr, o).id)(c.value, 'mm')];
        }
        const want = c.type === 18 ? c.value / 2 : c.value;
        check(near(r, want));
        return [dimension((expr, o) => k.radius(a.id, expr, o).id)(want, 'mm')];
      }
      case 12: {
        const [a, b] = [curve(first), curve(second)];
        if (a.id === b.id) return leave('unsupported');
        if (a.kind === 'line' && b.kind === 'line')
          check(near(dist(...lineAt(a.id)), dist(...lineAt(b.id))));
        else if (round(a.kind) && round(b.kind)) check(near(radiusOf(a.id), radiusOf(b.id)));
        else return leave('unsupported');
        return [one(() => k.equal(a.id, b.id))];
      }
      case 13: {
        if (sp !== 0) return leave('unsupported');
        const p = point(first, fp);
        const on = curve(second);
        if (on.kind !== 'line' && !round(on.kind)) return leave('unsupported');
        check(onCurve(p, on));
        return [one(() => k.pointOnCurve(p, on.id))];
      }
      case 14: {
        const [p, q] = [point(first, fp), point(second, sp)];
        if (p === q) return leave('unsupported');
        if (tp === 0) {
          const l = curve(third);
          if (l.kind !== 'line') return leave('unsupported');
          const [o, f] = lineAt(l.id);
          const u = sub(f, o);
          const x = pointAt(p);
          const t = dotv(sub(x, o), u) / dotv(u, u);
          const image: Vec2 = [2 * (o[0] + t * u[0]) - x[0], 2 * (o[1] + t * u[1]) - x[1]];
          check(dist(image, pointAt(q)) <= TOLERANCE);
          return [one(() => k.symmetric(p, q, l.id))];
        }
        // About a point: Extrudo has it only as a line's midpoint.
        const mid = point(third, tp);
        const l = first === second && first >= 0 ? drawn[first] : undefined;
        if (l?.kind !== 'line' || fp === sp) return leave('unsupported');
        const [a, b] = lineAt(l.id);
        check(dist(pointAt(mid), [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]) <= TOLERANCE);
        return [one(() => k.midpoint(mid, l.id))];
      }
      case 15:
      case 19:
        return leave('internal');
      case 17: {
        const a = curve(first);
        return [one(() => k.fix(a.id))];
      }
      default:
        return leave('unsupported');
    }
  };

  sketch.constraints.forEach((c, index) => {
    if (!c) {
      constraintOutcomes[index] = 'unreadable';
      return;
    }
    if (!c.active) {
      constraintOutcomes[index] = 'inactive';
      return;
    }
    try {
      const items = itemsOf(c);
      if (candidates.length >= MAX_CANDIDATES) {
        constraintOutcomes[index] = 'limit';
        return;
      }
      if (!options.solver) {
        constraintOutcomes[index] = 'unchecked';
        return;
      }
      const candidate: Candidate = { index, items, ids: [] };
      if (name) {
        candidate.name = name;
        options.taken.add(name);
      }
      candidates.push(candidate);
      constraintOutcomes[index] = 'mapped';
    } catch (error) {
      if (!(error instanceof Leave)) throw error;
      constraintOutcomes[index] = error.reason;
    }
  });

  let maxDisplacement = 0;
  let dof: number | undefined;
  if (options.solver && candidates.length > 0) {
    const solver = options.solver;
    const take = (c: Candidate, why: LeftOut) => {
      for (const id of c.ids) {
        delete (k.data.constraints as Record<string, unknown>)[id];
        delete (k.data.dimensions as Record<string, unknown>)[id];
        delete values[id];
      }
      c.ids = [];
      constraintOutcomes[c.index] = why;
      if (c.name) options.taken.delete(c.name);
    };
    try {
      const result = vet(k, candidates, values, solver, take);
      maxDisplacement = result.displacement;
      dof = result.dof;
    } catch {
      for (const c of candidates) if (constraintOutcomes[c.index] === 'mapped') take(c, 'failed');
      for (const c of candidates) constraintOutcomes[c.index] = 'failed';
    }
  }

  const byIndex = new Map(candidates.map((c) => [c.index, c]));
  // Datums no kept constraint names come out again.
  const used = new Set<string>(
    (options.axes ?? []).map((which) => datums[which]).filter((id) => id !== undefined),
  );
  for (const c of candidates)
    for (const id of c.ids) for (const e of refsOf(k.data, id)) used.add(e);
  for (const [id, parts] of datumParts) {
    if (used.has(id)) continue;
    for (const part of parts) {
      delete (k.data.entities as Record<string, unknown>)[part];
      delete (k.data.constraints as Record<string, unknown>)[part];
    }
  }

  return {
    drawn: drawnCount,
    geometryLeftOut,
    constraints: sketch.constraints.map((_, i) => constraintOutcomes[i] ?? 'unreadable'),
    ids: sketch.constraints.map((_, i) => {
      const c = byIndex.get(i);
      return c && c.ids.length > 0 ? c.ids : undefined;
    }),
    dimensions: sketch.constraints.map((_, i) => {
      const c = byIndex.get(i);
      return c && c.ids.length > 0 ? c.dimension : undefined;
    }),
    maxDisplacement,
    ...(dof !== undefined ? { dof } : {}),
    lines: sketch.geometry.map((_, i) => {
      const d = drawn[i];
      return d?.kind === 'line' ? d.id : undefined;
    }),
    axes: {
      ...(datums.h && used.has(datums.h) ? { h: datums.h } : {}),
      ...(datums.v && used.has(datums.v) ? { v: datums.v } : {}),
    },
    centres: sketch.geometry.map((_, i) => {
      const d = drawn[i];
      return d?.kind === 'circle' || d?.kind === 'arc'
        ? d.pos[3]
        : d?.kind === 'point'
          ? d.id
          : undefined;
    }),
  };
}

/**
 * Adds the candidates and solves; takes out what the solver names redundant
 * or conflicting, the latest first, one per component and round, until the
 * sketch solves as cleanly as it did without them; then, while solving still
 * moves a point, the latest candidate in each component that moved. After
 * {@link MAX_VET_ROUNDS} rounds everything still in trouble comes out at once.
 */
function vet(
  k: SketchBuilder,
  candidates: Candidate[],
  values: Record<string, number>,
  solver: SketchSolver,
  take: (c: Candidate, why: LeftOut) => void,
): { displacement: number; dof: number } {
  const data = () => k.data;
  const before = solver.solve(data(), {});
  const already = new Set([...before.conflicting, ...before.redundant]);
  const failing = new Set(before.components.filter((r) => !r.ok).flatMap((r) => r.entities));
  const keys = new Set<string>();
  for (const c of candidates) {
    let refused = false;
    for (const item of c.items) {
      try {
        const id = item.add();
        c.ids.push(id);
        if (item.dimension) c.dimension = id;
        if (item.value !== undefined) values[id] = item.value;
      } catch {
        refused = true;
      }
    }
    if (refused) {
      take(c, 'unsupported');
      continue;
    }
    // The same constraint stated twice: the second is redundant without asking the solver.
    const own = c.ids.map((id) => constraintKey(data(), id));
    if (own.some((key) => key !== undefined && keys.has(key))) {
      take(c, 'overconstrains');
      continue;
    }
    for (const key of own) if (key !== undefined) keys.add(key);
  }
  // A tangent keeps the side its curves meet on, read once every joint is in.
  for (const c of candidates)
    for (const id of c.ids) {
      const t = (data().constraints as Record<string, { type: string; a: string; b: string }>)[id];
      if (t?.type !== 'tangent') continue;
      const { [id]: _, ...others } = data().constraints as Record<string, unknown>;
      const reversed = tangentReversed(
        { ...data(), constraints: others as SketchData['constraints'] },
        t.a,
        t.b,
      );
      if (reversed === undefined) delete (t as { reversed?: boolean }).reversed;
      else (t as { reversed?: boolean }).reversed = reversed;
    }

  const live = () => candidates.filter((c) => c.ids.length > 0);
  let trials = 0;
  /** Runs `f` with `c`'s items out of the sketch, then puts them back. */
  const withoutCandidate = <T>(c: Candidate, f: () => T): T => {
    const constraints = data().constraints as Record<string, unknown>;
    const dimensions = data().dimensions as Record<string, unknown>;
    const kept = c.ids.map((id) => [id, constraints[id], dimensions[id], values[id]] as const);
    for (const id of c.ids) {
      delete constraints[id];
      delete dimensions[id];
      delete values[id];
    }
    try {
      return f();
    } finally {
      for (const [id, constraint, dimension, value] of kept) {
        if (constraint !== undefined) constraints[id] = constraint;
        if (dimension !== undefined) dimensions[id] = dimension;
        if (value !== undefined) values[id] = value;
      }
    }
  };
  for (let round = 0; ; round++) {
    const result = solver.solve(data(), values as DimensionValues);
    const bad = new Set(
      [...result.conflicting, ...result.redundant].filter((id) => !already.has(id)),
    );
    const troubled = result.components.filter(
      (r) =>
        [...r.conflicting, ...r.redundant].some((id) => bad.has(id)) ||
        (!r.ok && !r.entities.some((e) => failing.has(e))),
    );
    const moved = movedEntities(data(), result.solution);
    const moving =
      troubled.length > 0
        ? []
        : result.components.filter((r) => r.entities.some((e) => moved.has(e)));
    const groups = troubled.length > 0 ? troubled : moving;
    const why: LeftOut = troubled.length > 0 ? 'overconstrains' : 'moves';
    if (groups.length === 0) {
      return { displacement: displacement(data(), result.solution), dof: result.dof };
    }
    const component = new Map<string, number>();
    groups.forEach((r, i) => {
      for (const e of r.entities) component.set(e, i);
    });
    const touches = (c: Candidate) => {
      const out = new Set<number>();
      for (const id of c.ids)
        for (const e of refsOf(data(), id)) {
          const i = component.get(e);
          if (i !== undefined) out.add(i);
        }
      return out;
    };
    const latest = [...live()].reverse();
    if (round >= MAX_VET_ROUNDS) {
      // Out of rounds: everything in trouble comes out at once.
      const all = latest.filter((c) => c.ids.some((id) => bad.has(id)) || touches(c).size > 0);
      if (all.length === 0)
        return { displacement: displacement(data(), result.solution), dof: result.dof };
      for (const c of all) take(c, why);
      continue;
    }
    const picked = new Map<number, Candidate>();
    if (why === 'overconstrains')
      for (const c of latest) {
        if (!c.ids.some((id) => bad.has(id))) continue;
        for (const i of touches(c)) if (!picked.has(i)) picked.set(i, c);
        if (touches(c).size === 0 && !picked.has(-1)) picked.set(-1, c);
      }
    else {
      // A candidate on what moved (a moved point, or a curve of one) before one only in its component.
      const owners = new Map<string, string>();
      for (const [id, e] of Object.entries(data().entities as Record<string, Ent>))
        for (const key of ['start', 'end', 'center'] as const) {
          const p = e[key];
          if (typeof p === 'string') owners.set(p, id);
        }
      const hit = new Set(moved);
      for (const e of moved) {
        const o = owners.get(e);
        if (o) hit.add(o);
      }
      const suspects = latest.filter((c) =>
        c.ids.some((id) => refsOf(data(), id).some((e) => hit.has(e))),
      );
      // Few enough to try: the one without which the sketch moves least goes (the latest of equals).
      if (suspects.length <= MAX_TRIALS && trials + suspects.length <= TRIAL_BUDGET) {
        const best = new Map<number, { c: Candidate; moved: number }>();
        for (const c of suspects) {
          trials++;
          const off = withoutCandidate(c, () => {
            const r = solver.solve(data(), values as DimensionValues);
            return r.ok ? displacement(data(), r.solution) : Number.POSITIVE_INFINITY;
          });
          for (const i of touches(c)) {
            const b = best.get(i);
            if (!b || off < b.moved - MOVE) best.set(i, { c, moved: off });
          }
        }
        for (const [i, b] of best) picked.set(i, b.c);
      } else
        for (const c of suspects) for (const i of touches(c)) if (!picked.has(i)) picked.set(i, c);
    }
    for (const c of latest) for (const i of touches(c)) if (!picked.has(i)) picked.set(i, c);
    const out = new Set(picked.values());
    // Trouble no candidate is part of: nothing more to take out.
    if (out.size === 0)
      return { displacement: displacement(data(), result.solution), dof: result.dof };
    for (const c of out) take(c, why);
  }
}

/** Points and circles a solve moved, or resized, further than {@link MOVE}. */
function movedEntities(
  data: SketchData,
  solution: { points: Record<string, { x: number; y: number }>; radii: Record<string, number> },
): Set<string> {
  const out = new Set<string>();
  const entities = data.entities as Record<
    string,
    { type: string; x?: number; y?: number; radius?: number }
  >;
  for (const [id, p] of Object.entries(solution.points)) {
    const e = entities[id];
    if (e?.type === 'point' && Math.hypot(p.x - (e.x as number), p.y - (e.y as number)) > MOVE)
      out.add(id);
  }
  for (const [id, r] of Object.entries(solution.radii)) {
    const e = entities[id];
    if (e?.type === 'circle' && Math.abs(r - (e.radius as number)) > MOVE) out.add(id);
  }
  return out;
}

/** The largest distance a solve moved any point, or changed any circle's radius (mm). */
function displacement(
  data: SketchData,
  solution: { points: Record<string, { x: number; y: number }>; radii: Record<string, number> },
): number {
  let max = 0;
  const entities = data.entities as Record<
    string,
    { type: string; x?: number; y?: number; radius?: number }
  >;
  for (const [id, p] of Object.entries(solution.points)) {
    const e = entities[id];
    if (e?.type === 'point')
      max = Math.max(max, Math.hypot(p.x - (e.x as number), p.y - (e.y as number)));
  }
  for (const [id, r] of Object.entries(solution.radii)) {
    const e = entities[id];
    if (e?.type === 'circle') max = Math.max(max, Math.abs(r - (e.radius as number)));
  }
  return max;
}
