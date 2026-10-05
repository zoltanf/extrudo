/**
 * The composite shapes the drawing tools make (P1-04, P1-05): the outline of
 * a rectangle, a slot or a regular polygon with the constraints that hold it
 * together. Pure geometry over an edit, so the Rectangle tool and
 * `@extrudo/api`'s `k.rectangle(…)` build the same thing (ADR-0068 §5).
 *
 * What each shape keeps, in the tool's own words:
 *
 * - **Rectangle**: four lines joined at their corners, horizontal and vertical
 *   (`aligned`) or perpendicular and parallel (`perpendicular`, the 3-point
 *   mode); the centre mode adds two construction diagonals and the centre
 *   point in the middle of one.
 * - **Slot**: two lines and two half circles, joined and tangent all round with
 *   equal radii, plus a construction centreline that holds the arc centres
 *   (`centers`) or, in the overall mode, the slot's ends (`ends`).
 * - **Polygon**: `n` equal lines joined at the corners, every corner on a
 *   construction circle; the circumscribed mode adds the circle across the
 *   flats, concentric with the first and tangent to its edge.
 *
 * The tools add what only they know on top: the constraints a clicked point
 * keeps (`place`) and the dimensions a typed value makes.
 */
import type { SketchConstraint, SketchEntityId, Vec2 } from '@extrudo/core';
import {
  type ArcPoints,
  addArc,
  addCircle,
  addLine,
  type BuildIds,
  constrain,
  type SketchAdd,
} from './add';

/** A line as `addLine` returns it. */
export interface AddedLine {
  id: SketchEntityId;
  start: SketchEntityId;
  end: SketchEntityId;
}

/** An arc as `addArc` returns it. */
export interface AddedArc {
  id: SketchEntityId;
  center: SketchEntityId;
  first: SketchEntityId;
  last: SketchEntityId;
}

// Rectangle ----------------------------------------------------------------------

/**
 * How a rectangle's edges are tied down: `aligned` is horizontal and vertical
 * (the 2-point tool), `perpendicular` is perpendicular and parallel (the
 * 3-point one), and `centre` is `aligned` with construction diagonals.
 */
export type RectangleMode = 'aligned' | 'perpendicular' | 'centre';

export interface RectangleResult {
  /** The four edges in drawing order, corner to corner. */
  edges: [AddedLine, AddedLine, AddedLine, AddedLine];
  /** The centre point of a `centre` rectangle. */
  center?: SketchEntityId;
  /** The two construction diagonals of a `centre` rectangle. */
  diagonals?: [AddedLine, AddedLine];
}

/**
 * The four lines of a rectangle, joined at their corners (the corners are
 * drawn in order, each edge's end meeting the next one's start) and tied down
 * as `mode` says. A `centre` rectangle takes the centre point too, and holds
 * it in the middle of its first diagonal.
 */
export function rectangleEdit(
  edit: SketchAdd,
  ids: BuildIds,
  corners: readonly [Vec2, Vec2, Vec2, Vec2],
  mode: RectangleMode,
  center?: Vec2,
): RectangleResult {
  const edges = [0, 1, 2, 3].map((i) =>
    addLine(edit, ids, corners[i] as Vec2, corners[(i + 1) % 4] as Vec2),
  ) as [AddedLine, AddedLine, AddedLine, AddedLine];
  const required: SketchConstraint[] = [];
  for (let i = 0; i < 4; i++) {
    const here = edges[i] as AddedLine;
    const next = edges[(i + 1) % 4] as AddedLine;
    required.push({ type: 'coincident', a: here.end, b: next.start });
  }
  if (mode === 'perpendicular') {
    required.push(
      { type: 'perpendicular', a: (edges[0] as AddedLine).id, b: (edges[1] as AddedLine).id },
      { type: 'parallel', a: (edges[0] as AddedLine).id, b: (edges[2] as AddedLine).id },
      { type: 'parallel', a: (edges[1] as AddedLine).id, b: (edges[3] as AddedLine).id },
    );
  } else {
    required.push(
      { type: 'horizontal', a: (edges[0] as AddedLine).id },
      { type: 'vertical', a: (edges[1] as AddedLine).id },
      { type: 'horizontal', a: (edges[2] as AddedLine).id },
      { type: 'vertical', a: (edges[3] as AddedLine).id },
    );
  }
  constrain(edit, ids, required, false);

  if (mode !== 'centre') return { edges };
  // Two construction diagonals; the centre point sits in the middle of one.
  const construction: BuildIds = { ...ids, construction: () => true };
  const ac = addLine(edit, construction, corners[0], corners[2]);
  const bd = addLine(edit, construction, corners[1], corners[3]);
  const middle = corners.reduce<Vec2>((a, b) => [a[0] + b[0] / 4, a[1] + b[1] / 4], [0, 0]);
  const point = addCenterPoint(edit, ids, center ?? middle);
  constrain(
    edit,
    ids,
    [
      { type: 'coincident', a: ac.start, b: (edges[0] as AddedLine).start },
      { type: 'coincident', a: ac.end, b: (edges[2] as AddedLine).start },
      { type: 'coincident', a: bd.start, b: (edges[1] as AddedLine).start },
      { type: 'coincident', a: bd.end, b: (edges[3] as AddedLine).start },
      { type: 'midpoint', point, of: ac.id },
    ],
    false,
  );
  return { edges, center: point, diagonals: [ac, bd] };
}

function addCenterPoint(edit: SketchAdd, ids: BuildIds, at: Vec2): SketchEntityId {
  const id = ids.newId() as SketchEntityId;
  edit.entities[id] = { type: 'point', x: at[0], y: at[1] };
  return id;
}

// Slot ---------------------------------------------------------------------------

/** A slot's outline: the two arc centres, the unit axis between them and the radius. */
export interface SlotShape {
  c1: Vec2;
  c2: Vec2;
  u: Vec2;
  radius: number;
  /** The centreline: between the centres (`centers`) or the slot's ends (`ends`). */
  axis: readonly [Vec2, Vec2];
}

export interface SlotResult {
  /** The two straight sides and the two half circles, running counter-clockwise. */
  outline: { lineA: AddedLine; arc2: AddedArc; lineB: AddedLine; arc1: AddedArc };
  /** The construction centreline. */
  centerline: AddedLine;
}

/** How a slot's centreline holds it: on the arc centres, or through its ends. */
export type SlotMode = 'centers' | 'ends';

/**
 * A slot: two lines and two half circles round the four sides, tangent all
 * round with equal radii (5 degrees of freedom: both centres and the width),
 * plus the construction centreline that holds them.
 */
export function slotEdit(
  edit: SketchAdd,
  ids: BuildIds,
  shape: SlotShape,
  mode: SlotMode = 'centers',
): SlotResult {
  const o = slotOutline(shape);
  const lineA = addLine(edit, ids, o.a[0], o.a[1]);
  const arc2 = addArc(edit, ids, o.arc2);
  const lineB = addLine(edit, ids, o.b[0], o.b[1]);
  const arc1 = addArc(edit, ids, o.arc1);
  const construction: BuildIds = { ...ids, construction: () => true };
  const centerline = addLine(edit, construction, shape.axis[0], shape.axis[1]);

  // Round the outline: each curve runs on from the one before, the same way.
  const required: SketchConstraint[] = [
    { type: 'coincident', a: lineA.end, b: arc2.first },
    { type: 'coincident', a: arc2.last, b: lineB.start },
    { type: 'coincident', a: lineB.end, b: arc1.first },
    { type: 'coincident', a: arc1.last, b: lineA.start },
    { type: 'tangent', a: lineA.id, b: arc2.id, reversed: false },
    { type: 'tangent', a: arc2.id, b: lineB.id, reversed: false },
    { type: 'tangent', a: lineB.id, b: arc1.id, reversed: false },
    { type: 'tangent', a: arc1.id, b: lineA.id, reversed: false },
    { type: 'equal', a: arc1.id, b: arc2.id },
  ];
  if (mode === 'centers') {
    required.push(
      { type: 'coincident', a: centerline.start, b: arc1.center },
      { type: 'coincident', a: centerline.end, b: arc2.center },
    );
  } else {
    required.push(
      { type: 'pointOnCurve', point: arc1.center, curve: centerline.id },
      { type: 'pointOnCurve', point: arc2.center, curve: centerline.id },
      { type: 'pointOnCurve', point: centerline.start, curve: arc1.id },
      { type: 'pointOnCurve', point: centerline.end, curve: arc2.id },
    );
  }
  constrain(edit, ids, required, false);
  return { outline: { lineA, arc2, lineB, arc1 }, centerline };
}

/**
 * The slot's four curves, running counter-clockwise: line A along the axis on
 * its right, the half circle round the second centre, line B back, the half
 * circle round the first.
 */
export function slotOutline({ c1, c2, u, radius: r }: SlotShape): {
  a: readonly [Vec2, Vec2];
  b: readonly [Vec2, Vec2];
  arc1: ArcPoints;
  arc2: ArcPoints;
} {
  const n: Vec2 = [-u[1], u[0]];
  const off = (c: Vec2, k: number): Vec2 => [c[0] + n[0] * r * k, c[1] + n[1] * r * k];
  const down = Math.atan2(-n[1], -n[0]);
  const half = (center: Vec2, from: number): ArcPoints => ({
    center,
    radius: r,
    from,
    sweep: Math.PI,
    reversed: false,
  });
  return {
    a: [off(c1, -1), off(c2, -1)],
    arc2: half(c2, down),
    b: [off(c2, 1), off(c1, 1)],
    arc1: half(c1, down + Math.PI),
  };
}

/**
 * The slot's shape from where its ends are and how wide it is: `overall`
 * puts the centres a radius in from the ends (and refuses a slot wider than
 * its ends are apart), otherwise the two points are the centres themselves.
 */
export function slotShape(
  a: Vec2,
  b: Vec2,
  radius: number,
  overall = false,
): SlotShape | undefined {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (len === 0 || radius < 1e-9) return undefined;
  const u: Vec2 = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
  if (!overall) return { c1: a, c2: b, u, radius, axis: [a, b] };
  // Overall: the centres sit a radius in from the ends, and must not cross.
  if (2 * radius >= len - 1e-9) return undefined;
  return {
    c1: [a[0] + u[0] * radius, a[1] + u[1] * radius],
    c2: [b[0] - u[0] * radius, b[1] - u[1] * radius],
    u,
    radius,
    axis: [a, b],
  };
}

// Polygon -----------------------------------------------------------------------

/** A regular polygon: its corners in order, its centre and the circle through them. */
export interface PolygonShape {
  corners: Vec2[];
  center: Vec2;
  /** Circumradius. */
  radius: number;
  /** Distance from the centre to each edge. */
  apothem: number;
}

export interface PolygonResult {
  /** The `n` edges in order. */
  edges: AddedLine[];
  /** The construction circle through the corners. */
  circle: { id: SketchEntityId; center: SketchEntityId };
  /** The circle across the flats, for a circumscribed polygon. */
  flats?: { id: SketchEntityId; center: SketchEntityId };
}

/** How a polygon is placed: on its circumcircle or across its flats. */
export type PolygonMode = 'inscribed' | 'circumscribed';

/** The regular `n`-gon around `center` with its first corner at `angle` (radians). */
export function polygonAround(
  center: Vec2,
  radius: number,
  angle: number,
  sides: number,
): PolygonShape {
  const corners = Array.from({ length: sides }, (_, k): Vec2 => {
    const t = angle + (2 * Math.PI * k) / sides;
    return [center[0] + radius * Math.cos(t), center[1] + radius * Math.sin(t)];
  });
  return { corners, center, radius, apothem: radius * Math.cos(Math.PI / sides) };
}

/**
 * A regular polygon: `n` lines joined at the corners and all equal, the
 * corners on a construction circle (4 degrees of freedom: position, size,
 * rotation). A `circumscribed` one adds the circle across the flats,
 * concentric with the first and tangent to its first edge.
 */
export function polygonEdit(
  edit: SketchAdd,
  ids: BuildIds,
  shape: PolygonShape,
  mode: PolygonMode = 'inscribed',
): PolygonResult {
  const construction: BuildIds = { ...ids, construction: () => true };
  const n = shape.corners.length;
  const corner = (i: number) => shape.corners[((i % n) + n) % n] as Vec2;
  const edges = shape.corners.map((_, i) => addLine(edit, ids, corner(i), corner(i + 1)));
  const edge = (i: number) => edges[((i % n) + n) % n] as AddedLine;
  const circle = addCircle(edit, construction, shape.center, shape.radius);

  const required: SketchConstraint[] = [];
  for (let i = 0; i < n; i++) {
    required.push(
      { type: 'coincident', a: edge(i).end, b: edge(i + 1).start },
      { type: 'pointOnCurve', point: edge(i).start, curve: circle.id },
    );
    if (i > 0) required.push({ type: 'equal', a: edge(0).id, b: edge(i).id });
  }
  let flats: { id: SketchEntityId; center: SketchEntityId } | undefined;
  if (mode === 'circumscribed') {
    const across = addCircle(edit, construction, shape.center, shape.apothem);
    flats = across;
    required.push(
      { type: 'concentric', a: circle.id, b: across.id },
      { type: 'tangent', a: across.id, b: edge(0).id },
    );
  }
  constrain(edit, ids, required, false);
  return { edges, circle, ...(flats ? { flats } : {}) };
}

/** The polygon of `sides` sides on one edge, on the side of `point`: the tool's edge mode. */
export function polygonOnEdge(
  a: Vec2,
  b: Vec2,
  point: Vec2,
  sides: number,
): PolygonShape | undefined {
  const e: Vec2 = [b[0] - a[0], b[1] - a[1]];
  const s = Math.hypot(e[0], e[1]);
  if (s === 0 || sides < 3) return undefined;
  let normal: Vec2 = [-e[1] / s, e[0] / s];
  const side = (point[0] - a[0]) * normal[0] + (point[1] - a[1]) * normal[1];
  if (side < 0) normal = [-normal[0], -normal[1]];
  const apothem = s / 2 / Math.tan(Math.PI / sides);
  const center: Vec2 = [
    (a[0] + b[0]) / 2 + normal[0] * apothem,
    (a[1] + b[1]) / 2 + normal[1] * apothem,
  ];
  const radius = s / 2 / Math.sin(Math.PI / sides);
  // Corners from `a` round through `b`: the turn from a to b around the center.
  const angle = Math.atan2(a[1] - center[1], a[0] - center[0]);
  const turn = Math.sign((a[0] - center[0]) * e[1] - (a[1] - center[1]) * e[0]) || 1;
  const corners = Array.from({ length: sides }, (_, k): Vec2 => {
    const t = angle + (turn * 2 * Math.PI * k) / sides;
    return [center[0] + radius * Math.cos(t), center[1] + radius * Math.sin(t)];
  });
  return { corners, center, radius, apothem };
}
