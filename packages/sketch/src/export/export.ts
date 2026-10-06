/**
 * Sketch export (P1-13, FR-SK-15/16, ADR-0022): a sketch, or some of its
 * profiles, as an `@extrudo/io` drawing in sketch coordinates (mm, y up),
 * which `writeSvg`/`writeDxf` turn into files. Curves stay exact: lines,
 * circular arcs, the ellipse as an elliptical arc, and a fit-point spline as
 * the Bézier pieces of its B-spline (the curve the viewport draws).
 *
 * - `sketchDrawing`: every curve (points aren't drawn), one shape each, on
 *   the "Sketch" layer; construction geometry on a dashed "Construction"
 *   layer if asked for.
 * - `profileDrawing`: each profile as one filled shape, its outer loop and
 *   its holes as closed contours. Edges keep their curve's exact geometry
 *   between the loop's vertices (where profile detection cut the curves).
 */
import {
  type BSpline,
  ellipseShape,
  placeText,
  type SketchData,
  type SketchEntity,
  type SketchEntityId,
  splineCurve,
  type TextCurve,
  type Vec2,
} from '@extrudo/core';
import type { Contour, Drawing, Layer, Point, Segment } from '@extrudo/io';
import type { Profile, ProfileEdge, ProfileLoop } from '../profiles';
import { bezierPieces, bezierRange, splineParam } from './bezier';

const TAU = 2 * Math.PI;

export const SKETCH_LAYER: Layer = { name: 'Sketch', color: '#000000', aci: 7 };
export const CONSTRUCTION_LAYER: Layer = {
  name: 'Construction',
  color: '#8c8c8c',
  aci: 8,
  dashed: true,
};
export const PROFILE_LAYER: Layer = { name: 'Profiles', color: '#000000', aci: 7, fill: true };

export interface SketchDrawingOptions {
  /** The file's title (the sketch's name). */
  title?: string;
  /** Include construction geometry, on its own dashed layer. */
  construction?: boolean;
}

/** Every curve of a sketch, as a drawing. */
export function sketchDrawing(data: SketchData, options: SketchDrawingOptions = {}): Drawing {
  const shapes: Drawing['shapes'] = [];
  for (const [key, entity] of Object.entries(data.entities)) {
    if (entity.type === 'point') continue;
    if (entity.construction && !options.construction) continue;
    if (entity.type === 'text') {
      const layer = entity.construction ? CONSTRUCTION_LAYER.name : SKETCH_LAYER.name;
      for (const curve of placeText(data, key as SketchEntityId).curves) {
        const contour = textCurveContour(curve);
        if (contour) shapes.push({ layer, contours: [contour] });
      }
      continue;
    }
    const contour = curveContour(data, entity);
    if (contour) {
      shapes.push({
        layer: entity.construction ? CONSTRUCTION_LAYER.name : SKETCH_LAYER.name,
        contours: [contour],
      });
    }
  }
  return {
    ...(options.title && { title: options.title }),
    layers: options.construction ? [SKETCH_LAYER, CONSTRUCTION_LAYER] : [SKETCH_LAYER],
    shapes,
  };
}

/** Profiles of a sketch (from `detectProfiles`), each a filled region with its holes. */
export function profileDrawing(
  data: SketchData,
  profiles: readonly Profile[],
  options: { title?: string } = {},
): Drawing {
  return {
    ...(options.title && { title: options.title }),
    layers: [PROFILE_LAYER],
    shapes: profiles.map((profile) => ({
      layer: PROFILE_LAYER.name,
      contours: [profile.outer, ...profile.holes].map((loop) => loopContour(data, loop)),
    })),
  };
}

// Curves -----------------------------------------------------------------------

function pointOf(data: SketchData, id: SketchEntityId): Vec2 | undefined {
  const p = data.entities[id];
  return p?.type === 'point' ? [p.x, p.y] : undefined;
}

/** A whole curve as one contour, or `undefined` if its points are missing. */
function curveContour(data: SketchData, entity: SketchEntity): Contour | undefined {
  const at = (id: SketchEntityId) => pointOf(data, id);
  switch (entity.type) {
    case 'point':
      return undefined;
    case 'line': {
      const a = at(entity.start);
      const b = at(entity.end);
      return a && b ? { start: a, segments: [{ type: 'line', to: b }], closed: false } : undefined;
    }
    case 'circle': {
      const c = at(entity.center);
      if (!c) return undefined;
      const start: Point = [c[0] + entity.radius, c[1]];
      return { start, segments: [{ type: 'arc', center: c, sweep: TAU, to: start }], closed: true };
    }
    case 'arc': {
      const c = at(entity.center);
      const s = at(entity.start);
      const e = at(entity.end);
      if (!c || !s || !e) return undefined;
      let sweep =
        (Math.atan2(e[1] - c[1], e[0] - c[0]) - Math.atan2(s[1] - c[1], s[0] - c[0])) % TAU;
      if (sweep < 0) sweep += TAU;
      if (sweep <= 1e-12) sweep = TAU;
      return { start: s, segments: [{ type: 'arc', center: c, sweep, to: e }], closed: false };
    }
    case 'ellipse': {
      const c = at(entity.center);
      const major = at(entity.major);
      const minor = at(entity.minor);
      if (!c || !major || !minor) return undefined;
      const shape = ellipseShape(c, major, minor);
      const start: Point = [
        c[0] + shape.a * Math.cos(shape.rotation),
        c[1] + shape.a * Math.sin(shape.rotation),
      ];
      return {
        start,
        segments: [
          {
            type: 'ellipse',
            center: c,
            rx: shape.a,
            ry: shape.b,
            rotation: shape.rotation,
            sweep: TAU,
            to: start,
          },
        ],
        closed: true,
      };
    }
    case 'spline': {
      const points = entity.points.map(at);
      if (!points.every((p) => p !== undefined)) return undefined;
      // The entity's own mode (P4-05, ADR-0063): a conic exports as the cubic
      // that stays within a micron of it.
      const spline = splineCurve(entity, points as Vec2[]);
      const beziers = bezierRange(bezierPieces(spline), 0, 1);
      const start = beziers[0]?.[0];
      // A closed spline (P4-12) is written as the clamped curve that is exactly
      // its loop, ending on its first point.
      const closed = entity.closed === true && entity.mode !== 'conic' && points.length >= 3;
      return start && { start, segments: beziers.map(bezierSegment), closed };
    }
    case 'text':
      // A text is many curves: `sketchDrawing` expands it with `placeText`.
      return undefined;
  }
}

/** One placed curve of a text as an open contour: a line, or its Bézier. */
function textCurveContour(curve: TextCurve): Contour | undefined {
  if (curve.kind === 'line') {
    return { start: curve.a, segments: [{ type: 'line', to: curve.b }], closed: false };
  }
  // A single-span clamped B-spline's poles are the Bézier's control points.
  const [first, second, third, fourth] = curve.poles;
  if (!first || !second || !third) return undefined;
  const segment: Segment =
    curve.degree === 3 && fourth
      ? { type: 'cubic', c1: second, c2: third, to: fourth }
      : { type: 'quadratic', control: second, to: third };
  return { start: first, segments: [segment], closed: false };
}

/** One Bézier piece (its first point is the current point) as a segment. */
function bezierSegment(points: readonly Vec2[]): Segment {
  const to = points[points.length - 1] as Vec2;
  if (points.length === 4) {
    return { type: 'cubic', c1: points[1] as Vec2, c2: points[2] as Vec2, to };
  }
  if (points.length === 3) return { type: 'quadratic', control: points[1] as Vec2, to };
  return { type: 'line', to };
}

// Profiles ---------------------------------------------------------------------

/** A profile loop as a closed contour. */
function loopContour(data: SketchData, loop: ProfileLoop): Contour {
  const start = loop.edges[0]?.points[0] ?? loop.polygon[0] ?? [0, 0];
  const segments = loop.edges.flatMap((edge) => edgeSegments(data, edge));
  return { start, segments, closed: true };
}

/** Sum of the turns between neighbouring points around `center`: an edge's signed sweep. */
function sweepAround(points: readonly Vec2[], angle: (p: Vec2) => number): number {
  let sweep = 0;
  for (let i = 1; i < points.length; i++) {
    let d = angle(points[i] as Vec2) - angle(points[i - 1] as Vec2);
    if (d > Math.PI) d -= TAU;
    else if (d <= -Math.PI) d += TAU;
    sweep += d;
  }
  return sweep;
}

/**
 * One edge of a loop: the exact curve between the edge's first and last
 * points (which are the loop's vertices, so neighbouring edges meet).
 */
function edgeSegments(data: SketchData, edge: ProfileEdge): Segment[] {
  const points = edge.points;
  const end = points[points.length - 1] as Vec2;
  const sub = textCurveOf(data, edge.curve);
  if (sub) return textCurveSegments(data, sub, points, end);
  const entity = data.entities[edge.curve];
  const polyline = (): Segment[] => points.slice(1).map((to) => ({ type: 'line', to }));
  switch (entity?.type) {
    case 'line':
      return [{ type: 'line', to: end }];
    case 'circle':
    case 'arc': {
      const c = pointOf(data, entity.center);
      if (!c) return polyline();
      const sweep = sweepAround(points, (p) => Math.atan2(p[1] - c[1], p[0] - c[0]));
      return [{ type: 'arc', center: c, sweep, to: end }];
    }
    case 'ellipse': {
      const c = pointOf(data, entity.center);
      const major = pointOf(data, entity.major);
      const minor = pointOf(data, entity.minor);
      if (!c || !major || !minor) return polyline();
      const shape = ellipseShape(c, major, minor);
      const cos = Math.cos(shape.rotation);
      const sin = Math.sin(shape.rotation);
      const param = (p: Vec2) => {
        const dx = p[0] - c[0];
        const dy = p[1] - c[1];
        return Math.atan2((-dx * sin + dy * cos) / shape.b, (dx * cos + dy * sin) / shape.a);
      };
      const sweep = sweepAround(points, param);
      return [
        {
          type: 'ellipse',
          center: c,
          rx: shape.a,
          ry: shape.b,
          rotation: shape.rotation,
          sweep,
          to: end,
        },
      ];
    }
    case 'spline': {
      const poles = entity.points.map((id) => pointOf(data, id));
      if (!poles.every((p) => p !== undefined) || points.length < 2) return polyline();
      const spline = splineCurve(entity, poles as Vec2[]);
      const [from, to] = splineRange(spline, points);
      const beziers = bezierRange(bezierPieces(spline), from, to);
      const segments = beziers.map(bezierSegment);
      const last = segments[segments.length - 1];
      if (last) last.to = end;
      return segments;
    }
    default:
      return polyline();
  }
}

/**
 * The curve ID of a text's sub-curve: `<text entity ID>.<k>` (ADR-0058 §2).
 * Ordinary entity IDs have no `.digits` tail whose owner is a text.
 */
function textCurveOf(
  data: SketchData,
  curve: string,
): { id: SketchEntityId; index: number } | undefined {
  const dot = curve.lastIndexOf('.');
  if (dot <= 0 || !/^\d+$/.test(curve.slice(dot + 1))) return undefined;
  const id = curve.slice(0, dot) as SketchEntityId;
  return data.entities[id]?.type === 'text'
    ? { id, index: Number(curve.slice(dot + 1)) }
    : undefined;
}

/** A text sub-curve between an edge's first and last points: exact lines and Béziers. */
function textCurveSegments(
  data: SketchData,
  curve: { id: SketchEntityId; index: number },
  points: readonly Vec2[],
  end: Vec2,
): Segment[] {
  const polyline = (): Segment[] => points.slice(1).map((to) => ({ type: 'line', to }));
  if (points.length < 2) return polyline();
  const sub = placeText(data, curve.id).curves[curve.index];
  if (!sub) return polyline();
  if (sub.kind === 'line') return [{ type: 'line', to: end }];
  // A single-span clamped B-spline's poles are the Bézier's control points.
  const spline: BSpline = { degree: sub.degree, poles: sub.poles, knots: sub.knots };
  const [from, to] = splineRange(spline, points);
  const segments = bezierRange(bezierPieces(spline), from, to).map(bezierSegment);
  const last = segments[segments.length - 1];
  if (last) last.to = end;
  return segments;
}

/**
 * The spline parameters an edge runs between. Where the spline closes on
 * itself (its ends coincide), an end at the joint is 0 or 1, whichever is
 * on the side of the edge's next point.
 */
function splineRange(spline: BSpline, points: readonly Vec2[]): [number, number] {
  const n = points.length;
  const first = points[0] as Vec2;
  const last = points[n - 1] as Vec2;
  const from = splineParam(spline, first);
  const to = splineParam(spline, last);
  const s0 = spline.poles[0] as Vec2;
  const s1 = spline.poles[spline.poles.length - 1] as Vec2;
  if (Math.hypot(s0[0] - s1[0], s0[1] - s1[1]) > 1e-6) return [from, to];
  const atJoint = (u: number) => u < 1e-6 || u > 1 - 1e-6;
  const side = (next: Vec2) => (splineParam(spline, next) < 0.5 ? 0 : 1);
  return [
    atJoint(from) ? side(points[1] as Vec2) : from,
    atJoint(to) ? side(points[n - 2] as Vec2) : to,
  ];
}
