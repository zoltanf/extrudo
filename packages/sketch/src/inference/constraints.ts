/**
 * Auto-constraints from inference (P1-02, FR-SK-05, ADR-0012): what a tool
 * adds when a point it places snapped or aligned. The tool layer test-solves
 * each one (`SketchSolver.check`) before it commits them, and drops those
 * that would conflict or be redundant.
 */
import type { SketchConstraint, SketchEntityId } from '@extrudo/core';
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

/** What the tool's anchor is in the sketch, for alignments measured from it. */
export interface AnchorEntities {
  /** The anchor's point entity, if it has one. */
  point?: SketchEntityId;
  /** A line from the anchor to the new point: its alignment becomes horizontal or vertical on the line. */
  line?: SketchEntityId;
}

/**
 * Horizontal and vertical constraints for alignments of `point`: on the new
 * line when aligned with the anchor it starts from, otherwise between the
 * two points.
 */
export function alignmentConstraints(
  alignments: readonly Alignment[],
  point: SketchEntityId,
  anchor: AnchorEntities = {},
): SketchConstraint[] {
  const out: SketchConstraint[] = [];
  for (const { axis, source } of alignments) {
    if (source.kind === 'anchor') {
      if (anchor.line) out.push({ type: axis, a: anchor.line });
      else if (anchor.point && anchor.point !== point) {
        out.push({ type: axis, a: point, b: anchor.point });
      }
    } else if (source.id !== point) {
      out.push({ type: axis, a: point, b: eid(source.id) });
    }
  }
  return out;
}
