/**
 * Picking sketch entities under the cursor (P1-06): the constraint tools
 * pick the points and curves they constrain. Pure, sketch mm.
 */
import {
  curvePolyline,
  type SketchData,
  type SketchEntity,
  type SketchEntityId,
  type Vec2,
} from '@extrudo/core';
import { dist, dot, lerp, sub } from './geometry';

/** Which entities a pick may return. */
export type PickFilter = (entity: SketchEntity, id: SketchEntityId) => boolean;

/**
 * The entity under `cursor`: the nearest accepted point within `tolerance`
 * (mm), or else the nearest accepted curve within it. Points come first, as
 * they sit on the curves they end. Undefined if nothing is close enough.
 */
export function pickEntity(
  sketch: SketchData,
  cursor: Vec2,
  tolerance: number,
  accept: PickFilter = () => true,
): SketchEntityId | undefined {
  let point: { id: SketchEntityId; d: number } | undefined;
  let curve: { id: SketchEntityId; d: number } | undefined;
  for (const [key, entity] of Object.entries(sketch.entities)) {
    const id = key as SketchEntityId;
    if (!accept(entity, id)) continue;
    if (entity.type === 'point') {
      const d = dist(cursor, [entity.x, entity.y]);
      if (d <= tolerance && (!point || d < point.d)) point = { id, d };
      continue;
    }
    const line = curvePolyline(sketch, entity);
    if (!line) continue;
    const d = polylineDistance(line, cursor);
    if (d <= tolerance && (!curve || d < curve.d)) curve = { id, d };
  }
  return (point ?? curve)?.id;
}

/** The distance from `p` to the nearest segment of a polyline. */
export function polylineDistance(line: readonly Vec2[], p: Vec2): number {
  let best = Infinity;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1] as Vec2;
    const b = line[i] as Vec2;
    const d = sub(b, a);
    const len2 = dot(d, d);
    const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, dot(sub(p, a), d) / len2));
    best = Math.min(best, dist(p, lerp(a, b, t)));
  }
  return best;
}
