import {
  CIRCLE_SEGMENTS,
  curvePolyline,
  type SketchData,
  type SketchFrame,
  sketchToWorld,
} from '@extrudo/core';
import type { EntityStatus } from '@extrudo/sketch/inference';
import type { Bounds } from './store';

export type { EntityStatus };

/** A sketch to draw: its plane's frame, its content, and whether it is being edited. */
export interface SketchDrawing {
  id: string;
  frame: SketchFrame;
  data: SketchData;
  active: boolean;
  /** Constraint status by entity (P1-08), for the sketch being edited once the solver is in. */
  status?: Readonly<Record<string, EntityStatus>>;
}

export const STATUSES: readonly EntityStatus[] = ['free', 'fixed', 'conflict'];

export interface SketchSegments {
  /** Line-segment pairs (xyz xyz) of normal curves, by constraint status. */
  curves: Record<EntityStatus, Float32Array>;
  /** Line-segment pairs of construction curves (drawn dashed, whatever their status). */
  construction: Float32Array;
  /** One xyz per sketch point, by constraint status. */
  points: Record<EntityStatus, Float32Array>;
  bounds: Bounds | undefined;
}

export { CIRCLE_SEGMENTS };

/**
 * A sketch as world-space line segments and points (P1-01). Circles, arcs,
 * ellipses and splines become polylines (`curvePolyline`); an arc runs
 * counter-clockwise from its start to its end point, with the radius of its
 * start point. Curves and points are grouped by `status` (P1-08); without
 * one, everything is `free`.
 */
export function sketchSegments(
  data: SketchData,
  frame: SketchFrame,
  status?: Readonly<Record<string, EntityStatus>>,
): SketchSegments {
  const solid: Record<EntityStatus, number[]> = { free: [], fixed: [], conflict: [] };
  const construction: number[] = [];
  const points: Record<EntityStatus, number[]> = { free: [], fixed: [], conflict: [] };
  for (const [id, entity] of Object.entries(data.entities)) {
    const group = status?.[id] ?? 'free';
    if (entity.type === 'point') {
      points[group].push(...sketchToWorld(frame, [entity.x, entity.y]));
      continue;
    }
    const line = curvePolyline(data, entity);
    if (!line) continue;
    const out = entity.construction ? construction : solid[group];
    let prev = sketchToWorld(frame, line[0] as [number, number]);
    for (let i = 1; i < line.length; i++) {
      const next = sketchToWorld(frame, line[i] as [number, number]);
      out.push(...prev, ...next);
      prev = next;
    }
  }

  const floats = (lists: Record<EntityStatus, number[]>) =>
    Object.fromEntries(STATUSES.map((s) => [s, new Float32Array(lists[s])])) as Record<
      EntityStatus,
      Float32Array
    >;
  return {
    curves: floats(solid),
    construction: new Float32Array(construction),
    points: floats(points),
    bounds: boundsOfPositions([
      ...STATUSES.map((s) => solid[s]),
      construction,
      ...STATUSES.map((s) => points[s]),
    ]),
  };
}

/** The bounding sphere of xyz positions (at least 1 mm across), or `undefined` if there are none. */
export function boundsOfPositions(
  lists: readonly (readonly number[] | Float32Array)[],
): Bounds | undefined {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  let any = false;
  for (const list of lists) {
    for (let i = 0; i + 2 < list.length; i += 3) {
      any = true;
      for (let k = 0; k < 3; k++) {
        const v = list[i + k] as number;
        if (v < (min[k] as number)) min[k] = v;
        if (v > (max[k] as number)) max[k] = v;
      }
    }
  }
  if (!any) return undefined;
  const center = [0, 1, 2].map((k) => ((min[k] as number) + (max[k] as number)) / 2);
  const half = [0, 1, 2].map((k) => ((max[k] as number) - (min[k] as number)) / 2);
  const radius = Math.max(0.5, Math.hypot(...half));
  return { center: center as [number, number, number], radius };
}

/** The union of two bounding spheres. */
export function unionBounds(a: Bounds | undefined, b: Bounds | undefined): Bounds | undefined {
  if (!a) return b;
  if (!b) return a;
  const d = [0, 1, 2].map((k) => (b.center[k] as number) - (a.center[k] as number));
  const dist = Math.hypot(...d);
  if (dist + b.radius <= a.radius) return a;
  if (dist + a.radius <= b.radius) return b;
  const radius = (dist + a.radius + b.radius) / 2;
  const t = (radius - a.radius) / dist;
  const center = [0, 1, 2].map((k) => (a.center[k] as number) + (d[k] as number) * t);
  return { center: center as [number, number, number], radius };
}
