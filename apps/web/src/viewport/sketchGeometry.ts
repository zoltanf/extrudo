import {
  CIRCLE_SEGMENTS,
  dimensionAnchor,
  entityPolylines,
  projectedEntities,
  type SketchData,
  type SketchEntityId,
  type SketchFrame,
  sketchToWorld,
  textPolylines,
} from '@extrudo/core';
import type { EntityStatus } from '@extrudo/sketch/inference';
import type { Profile } from '@extrudo/sketch/profiles';
import { ShapeUtils, Vector2 } from 'three';
import type { Vec3 } from './camera';
import type { Bounds } from './store';

export type { EntityStatus };

/** A sketch to draw: its plane's frame, its content, and whether it is being edited. */
export interface SketchDrawing {
  id: string;
  /** The feature's name, for "Select other…" rows. */
  name?: string;
  frame: SketchFrame;
  data: SketchData;
  active: boolean;
  /** The pointer is on the sketch's timeline chip or browser row (P1-12): draw it in the accent. */
  highlight?: boolean;
  /** Constraint status by entity (P1-08), for the sketch being edited once the solver is in. */
  status?: Readonly<Record<string, EntityStatus>>;
  /** Closed regions to shade (P1-11); none while "Show profiles" is off. */
  profiles?: readonly Profile[];
  /** The region under the pointer (its ID within the sketch). */
  hoverProfile?: string;
  /** Selected regions (IDs within the sketch). */
  selectedProfiles?: readonly string[];
  /** A curve under the pointer in model mode (P2-03): its entity ID. */
  hoverEntity?: string;
  /** Curves and points selected in model mode (entity IDs). */
  selectedEntities?: readonly string[];
  /**
   * Draw the sketch's points although it isn't being edited: a feature
   * dialog's field is picking sketch points (a hole's, P3-04).
   */
  showPoints?: boolean;
}

/** World positions (xyz each) of those of `ids` that are points of the sketch. */
export function pointPositions(
  data: SketchData,
  frame: SketchFrame,
  ids: readonly string[],
): Float32Array {
  const out: number[] = [];
  for (const id of ids) {
    const entity = data.entities[id as keyof SketchData['entities']];
    if (entity?.type === 'point') out.push(...sketchToWorld(frame, [entity.x, entity.y]));
  }
  return new Float32Array(out);
}

/**
 * Line-segment pairs of some of a sketch's curves (model-mode highlights,
 * P2-03), construction or not. Points and other curves are left out.
 */
export function curveSegments(
  data: SketchData,
  frame: SketchFrame,
  ids: readonly string[],
): Float32Array {
  const entities: SketchData['entities'] = {};
  for (const [id, entity] of Object.entries(data.entities)) {
    if (entity.type === 'point' || ids.includes(id)) {
      entities[id as keyof SketchData['entities']] = entity;
    }
  }
  const segments = sketchSegments({ ...data, entities }, frame);
  const parts = [
    ...STATUSES.map((s) => segments.curves[s]),
    segments.construction,
    segments.projected,
  ];
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export const STATUSES: readonly EntityStatus[] = ['free', 'fixed', 'conflict'];

export interface SketchSegments {
  /** Line-segment pairs (xyz xyz) of normal curves, by constraint status. */
  curves: Record<EntityStatus, Float32Array>;
  /** Line-segment pairs of construction curves (drawn dashed, whatever their status). */
  construction: Float32Array;
  /** Line-segment pairs of projected curves (P2-09, drawn in the construct colour). */
  projected: Float32Array;
  /** One xyz per sketch point, by constraint status. */
  points: Record<EntityStatus, Float32Array>;
  bounds: Bounds | undefined;
}

export { CIRCLE_SEGMENTS };

/**
 * A sketch as world-space line segments and points (P1-01). Circles, arcs,
 * ellipses and splines become polylines (`curvePolyline`); an arc runs
 * counter-clockwise from its start to its end point, with the radius of its
 * start point. A text (P4-03) draws one polyline per glyph curve, all of them
 * under the entity's own ID, so hovering, selecting and colouring it work like
 * any other curve. Curves and points are grouped by `status` (P1-08); without
 * one, everything is `free`.
 */
export function sketchSegments(
  data: SketchData,
  frame: SketchFrame,
  status?: Readonly<Record<string, EntityStatus>>,
): SketchSegments {
  const solid: Record<EntityStatus, number[]> = { free: [], fixed: [], conflict: [] };
  const construction: number[] = [];
  const projected: number[] = [];
  const isProjected = projectedEntities(data);
  const points: Record<EntityStatus, number[]> = { free: [], fixed: [], conflict: [] };
  for (const [id, entity] of Object.entries(data.entities)) {
    const group = status?.[id] ?? 'free';
    if (entity.type === 'point') {
      points[group].push(...sketchToWorld(frame, [entity.x, entity.y]));
      continue;
    }
    const out = entity.construction
      ? construction
      : isProjected.has(id as keyof SketchData['entities'])
        ? projected
        : solid[group];
    for (const line of entityPolylines(data, entity, id as SketchEntityId)) {
      if (line.length === 0) continue;
      let prev = sketchToWorld(frame, line[0] as [number, number]);
      for (let i = 1; i < line.length; i++) {
        const next = sketchToWorld(frame, line[i] as [number, number]);
        out.push(...prev, ...next);
        prev = next;
      }
    }
  }

  // Placed dimension labels count for "Fit" too, so a dimension set off from its
  // geometry stays in view (a label at its default spot sits a few pixels away).
  const labels: number[] = [];
  for (const d of Object.values(data.dimensions)) {
    const anchor = d.label && dimensionAnchor(data, d);
    if (anchor && d.label) {
      labels.push(...sketchToWorld(frame, [anchor[0] + d.label.x, anchor[1] + d.label.y]));
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
    projected: new Float32Array(projected),
    points: floats(points),
    bounds: boundsOfPositions([
      ...STATUSES.map((s) => solid[s]),
      construction,
      projected,
      ...STATUSES.map((s) => points[s]),
      labels,
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
  return {
    center: center as [number, number, number],
    radius,
    box: { min: min as [number, number, number], max: max as [number, number, number] },
  };
}

/** The union of two bounding spheres. */
export function unionBounds(a: Bounds | undefined, b: Bounds | undefined): Bounds | undefined {
  if (!a) return b;
  if (!b) return a;
  const sphere = unionSpheres(a, b);
  if (!a.box || !b.box) return sphere;
  const { box: p } = a;
  const { box: q } = b;
  const pick = (f: (x: number, y: number) => number, u: Vec3, v: Vec3): Vec3 => [
    f(u[0], v[0]),
    f(u[1], v[1]),
    f(u[2], v[2]),
  ];
  return {
    ...sphere,
    box: { min: pick(Math.min, p.min, q.min), max: pick(Math.max, p.max, q.max) },
  };
}

function unionSpheres(a: Bounds, b: Bounds): Bounds {
  const d = [0, 1, 2].map((k) => (b.center[k] as number) - (a.center[k] as number));
  const dist = Math.hypot(...d);
  if (dist + b.radius <= a.radius) return a;
  if (dist + a.radius <= b.radius) return b;
  const radius = (dist + a.radius + b.radius) / 2;
  const t = (radius - a.radius) / dist;
  const center = [0, 1, 2].map((k) => (a.center[k] as number) + (d[k] as number) * t);
  return { center: center as [number, number, number], radius };
}

export type ProfileShade = 'normal' | 'hover' | 'selected';
export const PROFILE_SHADES: readonly ProfileShade[] = ['normal', 'hover', 'selected'];

/**
 * Where each drawn text's ink lies, for tests (P4-03): "<id>:x=-3.2..4.1:y=0..10"
 * per text, in sketch mm to 0.001 — its anchor's alignment and its height are
 * read from it. A text whose font isn't in has no curves and is left out.
 */
export function textBoundsSummary(sketches: readonly SketchDrawing[]): string | undefined {
  const r = (v: number) => Math.round(v * 1000) / 1000 + 0;
  const span = (v: number[]) => `${r(Math.min(...v))}..${r(Math.max(...v))}`;
  const out: string[] = [];
  for (const { id, data } of sketches) {
    for (const [entity, text] of Object.entries(data.entities)) {
      if (text?.type !== 'text') continue;
      const xs: number[] = [];
      const ys: number[] = [];
      for (const polyline of textPolylines(data, entity as SketchEntityId).values()) {
        for (const [x, y] of polyline) {
          xs.push(x);
          ys.push(y);
        }
      }
      if (xs.length > 0) out.push(`${id}.${entity}:x=${span(xs)}:y=${span(ys)}`);
    }
  }
  return out.length > 0 ? out.join(' ') : undefined;
}

/**
 * Profiles as world-space triangles (P1-11): xyz per vertex, three
 * vertices per triangle, grouped by how each region is shaded. A selected
 * region under the pointer stays `selected`.
 */
export function profileTriangles(
  profiles: readonly Profile[],
  frame: SketchFrame,
  hover?: string,
  selected: readonly string[] = [],
): Record<ProfileShade, Float32Array> {
  const out: Record<ProfileShade, number[]> = { normal: [], hover: [], selected: [] };
  for (const profile of profiles) {
    const shade: ProfileShade = selected.includes(profile.id)
      ? 'selected'
      : profile.id === hover
        ? 'hover'
        : 'normal';
    const contour = profile.outer.polygon.map((p) => new Vector2(p[0], p[1]));
    const holes = profile.holes.map((h) => h.polygon.map((p) => new Vector2(p[0], p[1])));
    const all = [...contour, ...holes.flat()];
    const list = out[shade];
    for (const triangle of ShapeUtils.triangulateShape(contour, holes)) {
      for (const index of triangle) {
        const v = all[index] as Vector2;
        list.push(...sketchToWorld(frame, [v.x, v.y]));
      }
    }
  }
  return {
    normal: new Float32Array(out.normal),
    hover: new Float32Array(out.hover),
    selected: new Float32Array(out.selected),
  };
}
