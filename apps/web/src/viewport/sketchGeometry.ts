import {
  ellipsePoint,
  ellipseShape,
  fitSpline,
  type SketchData,
  type SketchEntityId,
  type SketchFrame,
  sketchToWorld,
  splinePolyline,
  type Vec2,
} from '@extrudo/core';
import type { Bounds } from './store';

/** A sketch to draw: its plane's frame, its content, and whether it is being edited. */
export interface SketchDrawing {
  id: string;
  frame: SketchFrame;
  data: SketchData;
  active: boolean;
}

export interface SketchSegments {
  /** Line-segment pairs (xyz xyz) of normal curves. */
  solid: Float32Array;
  /** Line-segment pairs of construction curves (drawn dashed). */
  construction: Float32Array;
  /** One xyz per sketch point. */
  points: Float32Array;
  bounds: Bounds | undefined;
}

/** Segments for a full circle; arcs use a share of these. */
export const CIRCLE_SEGMENTS = 96;

/**
 * A sketch as world-space line segments and points (P1-01). Circles, arcs,
 * ellipses and splines become polylines; an arc runs counter-clockwise from
 * its start to its end point, with the radius of its start point.
 */
export function sketchSegments(data: SketchData, frame: SketchFrame): SketchSegments {
  const solid: number[] = [];
  const construction: number[] = [];
  const points: number[] = [];
  const at = (id: SketchEntityId): Vec2 | undefined => {
    const p = data.entities[id];
    return p?.type === 'point' ? [p.x, p.y] : undefined;
  };
  const push = (out: number[], a: Vec2, b: Vec2) => {
    out.push(...sketchToWorld(frame, a), ...sketchToWorld(frame, b));
  };
  const polyline = (out: number[], center: Vec2, radius: number, from: number, sweep: number) => {
    const n = Math.max(2, Math.ceil((Math.abs(sweep) / (2 * Math.PI)) * CIRCLE_SEGMENTS));
    let prev: Vec2 = [center[0] + radius * Math.cos(from), center[1] + radius * Math.sin(from)];
    for (let i = 1; i <= n; i++) {
      const t = from + (sweep * i) / n;
      const next: Vec2 = [center[0] + radius * Math.cos(t), center[1] + radius * Math.sin(t)];
      push(out, prev, next);
      prev = next;
    }
  };

  for (const entity of Object.values(data.entities)) {
    if (entity.type === 'point') {
      points.push(...sketchToWorld(frame, [entity.x, entity.y]));
      continue;
    }
    const out = entity.construction ? construction : solid;
    if (entity.type === 'line') {
      const a = at(entity.start);
      const b = at(entity.end);
      if (a && b) push(out, a, b);
    } else if (entity.type === 'circle') {
      const c = at(entity.center);
      if (c) polyline(out, c, entity.radius, 0, 2 * Math.PI);
    } else if (entity.type === 'ellipse') {
      const c = at(entity.center);
      const major = at(entity.major);
      const minor = at(entity.minor);
      if (!c || !major || !minor) continue;
      const shape = ellipseShape(c, major, minor);
      for (let i = 0; i < CIRCLE_SEGMENTS; i++) {
        const t = (2 * Math.PI) / CIRCLE_SEGMENTS;
        push(out, ellipsePoint(shape, i * t), ellipsePoint(shape, (i + 1) * t));
      }
    } else if (entity.type === 'spline') {
      const fit = entity.points.map(at);
      if (fit.some((p) => !p)) continue;
      const line = splinePolyline(fitSpline(fit as Vec2[]));
      for (let i = 1; i < line.length; i++) push(out, line[i - 1] as Vec2, line[i] as Vec2);
    } else {
      const c = at(entity.center);
      const s = at(entity.start);
      const e = at(entity.end);
      if (!c || !s || !e) continue;
      const from = Math.atan2(s[1] - c[1], s[0] - c[0]);
      const to = Math.atan2(e[1] - c[1], e[0] - c[0]);
      let sweep = (to - from) % (2 * Math.PI);
      if (sweep <= 1e-12) sweep += 2 * Math.PI;
      polyline(out, c, Math.hypot(s[0] - c[0], s[1] - c[1]), from, sweep);
    }
  }

  return {
    solid: new Float32Array(solid),
    construction: new Float32Array(construction),
    points: new Float32Array(points),
    bounds: boundsOfPositions([solid, construction, points]),
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
