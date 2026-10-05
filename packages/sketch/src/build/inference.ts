/**
 * Where a placed point keeps what it snapped to: the inferred constraints a
 * drawing tool adds beside a point (ADR-0012, P1-02), and the small geometry
 * the tools share (a tangent arc's join, an edge drawn to a typed length).
 *
 * Pure, and about inference rather than stored data, so `@extrudo/api` leaves
 * these alone (it has no pointer to infer from) and the app's tools import them
 * from here.
 */
import type { ConstraintId, SketchData, SketchEntityId, Vec2 } from '@extrudo/core';
import {
  type AnchorEntities,
  type ArcShape,
  alignmentConstraints,
  type Inference,
  type Snap,
  snapConstraints,
} from '../inference';
import { type ArcPoints, type BuildIds, constrain, type SketchAdd } from './add';

const DEG = Math.PI / 180;

/**
 * A value typed into the heads-up box (P1-04): the expression and its value in
 * base units (mm, degrees).
 */
export interface Typed {
  expr: string;
  value: number;
}

/**
 * A point snapped onto the rim of a new circle or arc: the snapped sketch
 * point goes on the curve (the new curve has no point of its own there).
 */
export function throughPoint(
  edit: SketchAdd,
  ids: BuildIds,
  snap: Snap | undefined,
  curve: SketchEntityId,
): ConstraintId[] {
  if (!snap || !['endpoint', 'center', 'point'].includes(snap.kind)) return [];
  const point = snap.ids[0];
  if (!point) return [];
  return constrain(
    edit,
    ids,
    [{ type: 'pointOnCurve', point: point as SketchEntityId, curve }],
    true,
  );
}

/** Where a curve ends at a point: the way out of it there, for a tangent continuation. */
export interface CurveEnd {
  curve: SketchEntityId;
  point: Vec2;
  /** Unit direction leaving the curve at the point. */
  outward: Vec2;
  /** Whether the point is the curve's stored end (else its start). */
  isEnd: boolean;
}

/** The line or arc that `point` is an endpoint of, with its direction there. */
export function curveEnd(sketch: SketchData, point: SketchEntityId): CurveEnd | undefined {
  const at = (id: SketchEntityId): Vec2 | undefined => {
    const p = sketch.entities[id];
    return p?.type === 'point' ? [p.x, p.y] : undefined;
  };
  for (const [key, e] of Object.entries(sketch.entities)) {
    const curve = key as SketchEntityId;
    if (e.type === 'line' && (e.start === point || e.end === point)) {
      const a = at(e.start);
      const b = at(e.end);
      if (!a || !b) return undefined;
      const isEnd = e.end === point;
      const d: Vec2 = isEnd ? [b[0] - a[0], b[1] - a[1]] : [a[0] - b[0], a[1] - b[1]];
      const len = Math.hypot(d[0], d[1]);
      if (len === 0) return undefined;
      return { curve, point: isEnd ? b : a, outward: [d[0] / len, d[1] / len], isEnd };
    }
    if (e.type === 'arc' && (e.start === point || e.end === point)) {
      const c = at(e.center);
      const p = at(point);
      if (!c || !p) return undefined;
      const isEnd = e.end === point;
      const r = Math.hypot(p[0] - c[0], p[1] - c[1]);
      if (r === 0) return undefined;
      // Counter-clockwise tangent; at the start, leaving the arc means going the other way.
      const ccw: Vec2 = [-(p[1] - c[1]) / r, (p[0] - c[0]) / r];
      return { curve, point: p, outward: isEnd ? ccw : [-ccw[0], -ccw[1]], isEnd };
    }
  }
  return undefined;
}

/**
 * Joins a new arc drawn from a curve's end (its `first` point) to that end:
 * coincident, and tangent with the side stored (`reversed`, see the schema).
 */
export function tangentJoin(
  edit: SketchAdd,
  ids: BuildIds,
  from: Pick<CurveEnd, 'curve' | 'isEnd'>,
  joint: SketchEntityId,
  arc: { id: SketchEntityId; first: SketchEntityId },
  shape: ArcPoints,
): void {
  // The existing curve runs along `outward` at its end and against it at its
  // start; the arc runs along it unless it was drawn clockwise.
  const reversed = from.isEnd ? Boolean(shape.reversed) : !shape.reversed;
  constrain(
    edit,
    ids,
    [
      { type: 'coincident', a: arc.first, b: joint },
      { type: 'tangent', a: from.curve, b: arc.id, reversed },
    ],
    false,
  );
}

/** Inferred constraints for a point placed where the pointer snapped and aligned. */
export function place(
  edit: SketchAdd,
  ids: BuildIds,
  pointer: Inference | undefined,
  point: SketchEntityId,
  anchor: AnchorEntities = {},
): void {
  if (!pointer) return;
  constrain(edit, ids, snapConstraints(pointer.snap, point), true);
  constrain(edit, ids, alignmentConstraints(pointer.alignments, point, anchor), true);
}

/** The direction of travel at the end of an arc drawn from `first` to `last`. */
export function arcEndDirection(shape: ArcShape | ArcPoints): Vec2 {
  const angle = shape.reversed ? shape.from : shape.from + shape.sweep;
  const ccw: Vec2 = [-Math.sin(angle), Math.cos(angle)];
  return shape.reversed ? [-ccw[0], -ccw[1]] : ccw;
}

/**
 * The end of an edge drawn from `start`: the pointer, or where a typed length
 * and angle put it (toward the cursor when only one of them is typed).
 */
export function typedEnd(
  start: Vec2,
  pointer: Inference,
  length: Typed | undefined,
  angle: Typed | undefined,
): Inference {
  if (!length && !angle) return pointer;
  const dx = pointer.cursor[0] - start[0];
  const dy = pointer.cursor[1] - start[1];
  const len = Math.hypot(dx, dy);
  const dir: Vec2 = angle
    ? [Math.cos(angle.value * DEG), Math.sin(angle.value * DEG)]
    : len > 0
      ? [dx / len, dy / len]
      : [1, 0];
  const l = length?.value ?? Math.max(0, dx * dir[0] + dy * dir[1]);
  const point: Vec2 = [start[0] + dir[0] * l, start[1] + dir[1] * l];
  return { point, cursor: point, snap: undefined, alignments: [] };
}

/** A typed angle that is a multiple of 90° puts an edge along an axis. */
export function axisOf(angle: Typed | undefined): 'horizontal' | 'vertical' | undefined {
  if (!angle) return undefined;
  const quarters = angle.value / 90;
  const k = Math.round(quarters);
  if (Math.abs(quarters - k) > 1e-9) return undefined;
  return k % 2 === 0 ? 'horizontal' : 'vertical';
}
