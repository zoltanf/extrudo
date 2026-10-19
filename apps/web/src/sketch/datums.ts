/**
 * The origin point and axes as picks for the constraint and dimension tools
 * (ADR-0093 §3): the datum under the pointer, in sketch coordinates, as a
 * `ModelSnap` the tool measures against and the host projects
 * (`addProjection`). Pure: the frame, the cursor, the pick reach and the
 * browser's eyes come in.
 *
 * An axis is offered as the kernel projects it (`projectAxis`): a point where
 * it runs along the sketch normal, else a `DATUM_SPAN` line centred on the
 * projection of its origin. The pointer is measured against the whole line,
 * as the view draws the axes far beyond the span.
 */
import {
  DATUM_SPAN,
  ORIGIN_AXES,
  originAxisRef,
  originPointRef,
  type SketchFrame,
  type Vec2,
  worldToSketch,
} from '@extrudo/core';
import type { ModelSnap } from '@extrudo/sketch/inference';
import type { OriginItem } from '../viewport/store';

/** |cos| of the angle between an axis and the normal at or above this: the axis is a point. */
const PARALLEL = 1 - 1e-9;

/**
 * The datums within `tolerance` (mm) of `cursor`, the nearest of each kind:
 * a `point` (the origin, an axis seen end-on) and an `axis`. Hidden datums
 * (`shown`, the browser's eyes) are never offered.
 */
export function datumSnapsAt(
  frame: SketchFrame,
  cursor: Vec2,
  tolerance: number,
  shown: Readonly<Record<OriginItem, boolean>>,
): { point?: ModelSnap; axis?: ModelSnap } {
  const points: { snap: ModelSnap; distance: number }[] = [];
  const lines: { snap: ModelSnap; distance: number }[] = [];
  const near = (p: Vec2) => Math.hypot(p[0] - cursor[0], p[1] - cursor[1]);
  if (shown.point) {
    const at = worldToSketch(frame, [0, 0, 0]);
    points.push({
      snap: { ref: originPointRef(), point: at, kind: 'point', straight: true },
      distance: near(at),
    });
  }
  for (const axis of ORIGIN_AXES) {
    if (!shown[axis.id.slice('origin:'.length) as OriginItem]) continue;
    const ref = originAxisRef(axis.id);
    const c = worldToSketch(frame, axis.origin);
    const d = axis.direction;
    const n = frame.normal;
    if (Math.abs(d[0] * n[0] + d[1] * n[1] + d[2] * n[2]) >= PARALLEL) {
      points.push({ snap: { ref, point: c, kind: 'point', straight: true }, distance: near(c) });
      continue;
    }
    const e = worldToSketch(frame, [
      axis.origin[0] + d[0],
      axis.origin[1] + d[1],
      axis.origin[2] + d[2],
    ]);
    const length = Math.hypot(e[0] - c[0], e[1] - c[1]);
    const u: Vec2 = [(e[0] - c[0]) / length, (e[1] - c[1]) / length];
    const t = (cursor[0] - c[0]) * u[0] + (cursor[1] - c[1]) * u[1];
    const foot: Vec2 = [c[0] + t * u[0], c[1] + t * u[1]];
    const h = DATUM_SPAN / 2;
    const line: [Vec2, Vec2] = [
      [c[0] - h * u[0], c[1] - h * u[1]],
      [c[0] + h * u[0], c[1] + h * u[1]],
    ];
    lines.push({
      snap: { ref, point: foot, kind: 'axis', straight: true, line },
      distance: near(foot),
    });
  }
  const nearest = (list: { snap: ModelSnap; distance: number }[]) =>
    list.filter((c) => c.distance <= tolerance).sort((a, b) => a.distance - b.distance)[0]?.snap;
  const point = nearest(points);
  const axis = nearest(lines);
  return { ...(point && { point }), ...(axis && { axis }) };
}
