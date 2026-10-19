/**
 * Auto-constraints from inference (P1-02, FR-SK-05, ADR-0012): what a tool
 * adds when a point it places snapped or aligned. The tool layer test-solves
 * each one (`SketchSolver.check`) before it commits them, and drops those
 * that would conflict or be redundant.
 */
import type { SketchConstraint, SketchData, SketchEntityId } from '@extrudo/core';
import type { Alignment, Snap } from './inference';

const eid = (id: string) => id as SketchEntityId;

/**
 * The constraints that keep `point` where it snapped: coincident with a
 * point, on a curve, at a midpoint, on both curves of an intersection, or
 * fixed at the sketch origin. None for the grid.
 */
export function snapConstraints(snap: Snap | undefined, point: SketchEntityId): SketchConstraint[] {
  if (!snap) return [];
  const [a, b] = snap.ids;
  switch (snap.kind) {
    case 'endpoint':
    case 'center':
    case 'point':
      return a && a !== point ? [{ type: 'coincident', a: point, b: eid(a) }] : [];
    case 'midpoint':
      return a ? [{ type: 'midpoint', point, of: eid(a) }] : [];
    case 'onCurve':
      return a ? [{ type: 'pointOnCurve', point, curve: eid(a) }] : [];
    case 'intersection':
      return a && b
        ? [
            { type: 'pointOnCurve', point, curve: eid(a) },
            { type: 'pointOnCurve', point, curve: eid(b) },
          ]
        : [];
    // The origin isn't a sketch entity (projected geometry comes in P2): pin the point there.
    case 'origin':
      return [{ type: 'fix', entity: point }];
    case 'grid':
      return [];
  }
}

/** The axis an alignment guide runs along. */
export type Axis = 'horizontal' | 'vertical';

/** What the tool has at the point it places, for the alignments measured there. */
export interface AnchorEntities {
  /** The anchor's point entity, if it has one. */
  point?: SketchEntityId;
  /** A line from the anchor to the new point: its alignment becomes horizontal or vertical on the line. */
  line?: SketchEntityId;
  /**
   * New lines leaving the placed point along an axis (a rectangle's two edges
   * at a corner). An alignment with the end of an existing line along the
   * same axis then makes the two lines **collinear** instead of tying the two
   * points (ADR-0094); needs the `sketch` to look the source up in.
   */
  along?: Partial<Record<Axis, SketchEntityId>>;
}

/**
 * Horizontal and vertical constraints for alignments of `point`: on the new
 * line when aligned with the anchor it starts from; collinear between a new
 * line along the axis (`anchor.along`) and the existing line the source point
 * ends, when that line runs along the axis too; otherwise between the two
 * points.
 */
export function alignmentConstraints(
  alignments: readonly Alignment[],
  point: SketchEntityId,
  anchor: AnchorEntities = {},
  sketch?: SketchData,
): SketchConstraint[] {
  const out: SketchConstraint[] = [];
  for (const { axis, source } of alignments) {
    if (source.kind === 'anchor') {
      if (anchor.line) out.push({ type: axis, a: anchor.line });
      else if (anchor.point && anchor.point !== point) {
        out.push({ type: axis, a: point, b: anchor.point });
      }
    } else if (source.id !== point) {
      const line = anchor.along?.[axis];
      const other = line && sketch ? lineAlong(sketch, eid(source.id), axis) : undefined;
      if (line && other && other !== line) out.push({ type: 'collinear', a: line, b: other });
      else out.push({ type: axis, a: point, b: eid(source.id) });
    }
  }
  return out;
}

/**
 * A line of the sketch that ends at `point` (or at a point coincident with it:
 * a rectangle's corner is two points) and runs along `axis`. Geometry decides,
 * not constraints: a line drawn level counts as much as one held level.
 */
export function lineAlong(
  sketch: SketchData,
  point: SketchEntityId,
  axis: Axis,
): SketchEntityId | undefined {
  const ends = new Set<string>([point]);
  const joins = Object.values(sketch.constraints).filter((c) => c.type === 'coincident');
  for (let grew = true; grew; ) {
    grew = false;
    for (const c of joins) {
      if (c.type !== 'coincident') continue;
      const add = ends.has(c.a) ? c.b : ends.has(c.b) ? c.a : undefined;
      if (add && !ends.has(add)) {
        ends.add(add);
        grew = true;
      }
    }
  }
  const at = (id: SketchEntityId) => {
    const p = sketch.entities[id];
    return p?.type === 'point' ? p : undefined;
  };
  for (const [key, e] of Object.entries(sketch.entities)) {
    if (e.type !== 'line' || !(ends.has(e.start) || ends.has(e.end))) continue;
    const a = at(e.start);
    const b = at(e.end);
    if (!a || !b) continue;
    const dx = Math.abs(b.x - a.x);
    const dy = Math.abs(b.y - a.y);
    const across = axis === 'horizontal' ? dy : dx;
    const length = Math.hypot(dx, dy);
    if (length > 0 && across <= 1e-6 * Math.max(1, length)) return eid(key);
  }
  return undefined;
}
