/**
 * Building blocks for the drawing tools (P1-04, ADR-0013): add points and
 * curves to an edit, and the constraints that tie a placed point to what it
 * snapped to.
 */
import type { SketchData, SketchEntityId, Vec2 } from '@extrudo/core';
import {
  type AnchorEntities,
  type ArcShape,
  alignmentConstraints,
  type Inference,
  type Snap,
  snapConstraints,
} from '@extrudo/sketch/inference';
import { constrain, type SketchEdit, type ToolContext } from './tool';

export function addPoint(edit: SketchEdit, context: ToolContext, p: Vec2): SketchEntityId {
  const id = context.newId() as SketchEntityId;
  edit.entities[id] = { type: 'point', x: p[0], y: p[1] };
  return id;
}

export function addLine(edit: SketchEdit, context: ToolContext, a: Vec2, b: Vec2) {
  const start = addPoint(edit, context, a);
  const end = addPoint(edit, context, b);
  const id = context.newId() as SketchEntityId;
  edit.entities[id] = { type: 'line', start, end, construction: context.construction() };
  return { id, start, end };
}

export function addCircle(edit: SketchEdit, context: ToolContext, center: Vec2, radius: number) {
  const c = addPoint(edit, context, center);
  const id = context.newId() as SketchEntityId;
  edit.entities[id] = { type: 'circle', center: c, radius, construction: context.construction() };
  return { id, center: c };
}

/**
 * Adds an arc. `first` and `last` are the points in the order the user drew
 * them; for a clockwise arc they are the stored end and start.
 */
export function addArc(edit: SketchEdit, context: ToolContext, arc: ArcShape) {
  const polar = (a: number): Vec2 => [
    arc.center[0] + arc.radius * Math.cos(a),
    arc.center[1] + arc.radius * Math.sin(a),
  ];
  const center = addPoint(edit, context, arc.center);
  const start = addPoint(edit, context, polar(arc.from));
  const end = addPoint(edit, context, polar(arc.from + arc.sweep));
  const id = context.newId() as SketchEntityId;
  edit.entities[id] = { type: 'arc', center, start, end, construction: context.construction() };
  return {
    id,
    center,
    first: arc.reversed ? end : start,
    last: arc.reversed ? start : end,
  };
}

/** Inferred constraints for a point placed where the pointer snapped and aligned. */
export function place(
  edit: SketchEdit,
  context: ToolContext,
  pointer: Inference | undefined,
  point: SketchEntityId,
  anchor: AnchorEntities = {},
): void {
  if (!pointer) return;
  constrain(edit, context, snapConstraints(pointer.snap, point), true);
  constrain(edit, context, alignmentConstraints(pointer.alignments, point, anchor), true);
}

/**
 * A point snapped onto the rim of a new circle or arc: the snapped sketch
 * point goes on the curve (the new curve has no point of its own there).
 */
export function throughPoint(
  edit: SketchEdit,
  context: ToolContext,
  snap: Snap | undefined,
  curve: SketchEntityId,
): void {
  if (!snap || !['endpoint', 'center', 'point'].includes(snap.kind)) return;
  const point = snap.ids[0];
  if (point) {
    constrain(
      edit,
      context,
      [{ type: 'pointOnCurve', point: point as SketchEntityId, curve }],
      true,
    );
  }
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
  edit: SketchEdit,
  context: ToolContext,
  from: Pick<CurveEnd, 'curve' | 'isEnd'>,
  joint: SketchEntityId,
  arc: { id: SketchEntityId; first: SketchEntityId },
  shape: ArcShape,
): void {
  // The existing curve runs along `outward` at its end and against it at its
  // start; the arc runs along it unless it was drawn clockwise.
  const reversed = from.isEnd ? shape.reversed : !shape.reversed;
  constrain(
    edit,
    context,
    [
      { type: 'coincident', a: arc.first, b: joint },
      { type: 'tangent', a: from.curve, b: arc.id, reversed },
    ],
    false,
  );
}

/** The direction of travel at the end of an arc drawn from `first` to `last`. */
export function arcEndDirection(shape: ArcShape): Vec2 {
  const angle = shape.reversed ? shape.from : shape.from + shape.sweep;
  const ccw: Vec2 = [-Math.sin(angle), Math.cos(angle)];
  return shape.reversed ? [-ccw[0], -ccw[1]] : ccw;
}
