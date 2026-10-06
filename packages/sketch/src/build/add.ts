/**
 * Adding to a sketch: the pure builders behind the drawing tools (P1-04,
 * ADR-0013) and the API's `SketchBuilder` (ADR-0068 §5).
 *
 * A tool works in an *edit* — the three maps a `SketchChange` carries — and
 * writes new entities, constraints and dimensions into it with an ID factory
 * and the construction flag. Nothing here knows about a pointer, a stores or
 * the DOM: the same functions make what the Rectangle tool makes when the
 * user clicks two corners, and what `d.sketch(d.origin.xy, k => …)` makes
 * when a script says `k.rectangle([0, 0], [40, 20])`.
 */
import type {
  ConstraintId,
  DimensionId,
  SketchConstraint,
  SketchDimension,
  SketchEntity,
  SketchEntityId,
  Vec2,
} from '@extrudo/core';

/**
 * The three maps a change to a sketch's content carries. The app's
 * `SketchEdit` (ADR-0012) is one of these with `auto` and the modify tools'
 * extra fields, and a plain object of these three is all a caller needs.
 */
export interface SketchAdd {
  entities: Record<SketchEntityId, SketchEntity>;
  constraints: Record<ConstraintId, SketchConstraint>;
  dimensions: Record<DimensionId, SketchDimension>;
  /**
   * Inferred constraint IDs, which the app's host test-solves in order and
   * drops the redundant ones (ADR-0012). The API marks nothing: it stores
   * what it is given.
   */
  auto?: string[];
}

/**
 * What an ID is for inside a sketch. The app's counter doesn't care (it is one
 * sequence of UUIDs); the API's does, so a sketch reads `s1`, `c1`, `d1`.
 */
export type SketchIdKind = 'entity' | 'constraint' | 'dimension';

/**
 * What the builders need from a tool context: an ID factory and whether new
 * curves are construction geometry. The app's `ToolContext` is one, so its
 * tools pass it unchanged; the API passes a two-line object.
 */
export interface BuildIds {
  /** A new ID, of the kind the caller needs (an entity unless it says otherwise). */
  newId(kind?: SketchIdKind): string;
  construction(): boolean;
}

/** An empty edit to write into. */
export function emptyAdd(): SketchAdd {
  return { entities: {}, constraints: {}, dimensions: {}, auto: [] };
}

/**
 * Adds a point. Every curve's own points, and a point drawn on its own.
 * Returns its ID.
 */
export function addPoint(edit: SketchAdd, ids: BuildIds, p: Vec2): SketchEntityId {
  const id = ids.newId() as SketchEntityId;
  edit.entities[id] = { type: 'point', x: p[0], y: p[1] };
  return id;
}

/** A line with its own two points; `start` and `end` come back for the join. */
export function addLine(edit: SketchAdd, ids: BuildIds, a: Vec2, b: Vec2) {
  const start = addPoint(edit, ids, a);
  const end = addPoint(edit, ids, b);
  const id = ids.newId() as SketchEntityId;
  edit.entities[id] = { type: 'line', start, end, construction: ids.construction() };
  return { id, start, end };
}

/** A circle of `radius` about `center`; the center's ID comes back. */
export function addCircle(edit: SketchAdd, ids: BuildIds, center: Vec2, radius: number) {
  const c = addPoint(edit, ids, center);
  const id = ids.newId() as SketchEntityId;
  edit.entities[id] = { type: 'circle', center: c, radius, construction: ids.construction() };
  return { id, center: c };
}

/**
 * An arc. `first` and `last` are the points in the order the user drew them;
 * for a clockwise arc they are the stored end and start.
 */
export function addArc(edit: SketchAdd, ids: BuildIds, arc: ArcPoints) {
  const polar = (a: number): Vec2 => [
    arc.center[0] + arc.radius * Math.cos(a),
    arc.center[1] + arc.radius * Math.sin(a),
  ];
  const center = addPoint(edit, ids, arc.center);
  const start = addPoint(edit, ids, polar(arc.from));
  const end = addPoint(edit, ids, polar(arc.from + arc.sweep));
  const id = ids.newId() as SketchEntityId;
  edit.entities[id] = { type: 'arc', center, start, end, construction: ids.construction() };
  return {
    id,
    center,
    first: arc.reversed ? end : start,
    last: arc.reversed ? start : end,
  };
}

/** An arc's shape: the center, the radius, where it starts and how far it sweeps (radians). */
export interface ArcPoints {
  center: Vec2;
  radius: number;
  from: number;
  sweep: number;
  /** Whether the user drew it clockwise (then the stored end is the first point). */
  reversed?: boolean;
}

/** An ellipse from its three points (ADR-0014): center, major end, minor end. */
export function addEllipse(
  edit: SketchAdd,
  ids: BuildIds,
  center: Vec2,
  major: Vec2,
  minor: Vec2,
): { id: SketchEntityId; center: SketchEntityId; major: SketchEntityId; minor: SketchEntityId } {
  const c = addPoint(edit, ids, center);
  const ma = addPoint(edit, ids, major);
  const mi = addPoint(edit, ids, minor);
  const id = ids.newId() as SketchEntityId;
  edit.entities[id] = {
    type: 'ellipse',
    center: c,
    major: ma,
    minor: mi,
    construction: ids.construction(),
  };
  return { id, center: c, major: ma, minor: mi };
}

/**
 * A spline over its points (ADR-0014, ADR-0063): `mode` and `rho` are the
 * conic's; `shape` carries a closed loop or a control spline's own knots
 * (ADR-0063's P4-12 amendment).
 */
export function addSpline(
  edit: SketchAdd,
  ids: BuildIds,
  points: readonly Vec2[],
  mode?: 'fit' | 'control' | 'conic',
  rho?: number,
  shape: { closed?: boolean; knots?: readonly number[] } = {},
): { id: SketchEntityId; points: SketchEntityId[] } {
  const refs = points.map((p) => addPoint(edit, ids, p));
  const id = ids.newId() as SketchEntityId;
  edit.entities[id] = {
    type: 'spline',
    points: refs,
    ...(mode ? { mode } : {}),
    ...(rho === undefined ? {} : { rho }),
    ...(shape.knots ? { knots: [...shape.knots] } : {}),
    ...(shape.closed ? { closed: true } : {}),
    construction: ids.construction(),
  };
  return { id, points: refs };
}

/** What a text needs besides its two points (ADR-0058): the string, font and alignment. */
export interface TextContent {
  text: string;
  /** A bundled font (`family-style@n`) or `attachment:<id>` (ADR-0061). */
  font: string;
  align?: 'left' | 'center' | 'right';
}

/** A text entity, sized and turned by its two points: `anchor` on the baseline, `top` its height up. */
export function addText(
  edit: SketchAdd,
  ids: BuildIds,
  anchor: Vec2,
  top: Vec2,
  content: TextContent,
): { id: SketchEntityId; anchor: SketchEntityId; top: SketchEntityId } {
  const a = addPoint(edit, ids, anchor);
  const t = addPoint(edit, ids, top);
  const id = ids.newId() as SketchEntityId;
  edit.entities[id] = {
    type: 'text',
    anchor: a,
    top: t,
    text: content.text,
    font: content.font,
    align: content.align ?? 'left',
    construction: ids.construction(),
  };
  return { id, anchor: a, top: t };
}

/** An entity of any type the caller already built the record for. */
export function addEntity(
  edit: SketchAdd,
  ids: BuildIds,
  entity: SketchEntity,
  id = ids.newId() as SketchEntityId,
): SketchEntityId {
  edit.entities[id] = entity;
  return id;
}

/**
 * Adds constraints, and marks them as inferred when the edit collects them
 * (`auto`, which the app's host test-solves). Returns their IDs in order, so a
 * caller can mark, list or check them.
 */
export function constrain(
  edit: SketchAdd,
  ids: BuildIds,
  constraints: readonly SketchConstraint[],
  auto = false,
): ConstraintId[] {
  const made: ConstraintId[] = [];
  for (const c of constraints) {
    const id = ids.newId('constraint') as ConstraintId;
    edit.constraints[id] = c;
    made.push(id);
  }
  if (auto && edit.auto) edit.auto.push(...made);
  return made;
}

/** One constraint, for a call that makes only one. */
export function constrainOne(
  edit: SketchAdd,
  ids: BuildIds,
  constraint: SketchConstraint,
  auto = false,
): ConstraintId {
  const [id] = constrain(edit, ids, [constraint], auto);
  return id as ConstraintId;
}

/** A driving or driven dimension (ADR-0016). `expr` is an expression, as every value is. */
export function addDimension(
  edit: SketchAdd,
  ids: BuildIds,
  dimension: Omit<SketchDimension, 'expr' | 'driven'> & {
    expr?: string;
    driven?: boolean;
    paramName?: string;
  },
): DimensionId {
  const id = ids.newId('dimension') as DimensionId;
  const { expr = '', driven = false, ...rest } = dimension;
  edit.dimensions[id] = { ...rest, expr, driven } as SketchDimension;
  return id;
}
