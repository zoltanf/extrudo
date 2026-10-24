/**
 * Where constraint glyphs go (P1-06, FR-SK-07, UI spec §4). Pure, so the
 * placement is unit-tested; `ConstraintGlyphs.tsx` draws the result.
 *
 * 1. `glyphAnchors` gives each constraint one glyph per constrained entity,
 *    at a spot on that entity: a point itself, a line's middle, an arc's
 *    middle, a circle or an ellipse at 45°, a spline's middle. A coincidence
 *    and a point on a curve show once, at the point; a tangent between
 *    curves that are joined shows once, at the joint; a symmetry shows on its
 *    two entities, not the axis; a horizontal or vertical between two points
 *    shows once, halfway between them, with its own icon (ADR-0094), or
 *    beside the free point when the other is fixed (projected or Fix).
 * 2. `layoutGlyphs` projects the anchors to the screen and moves each glyph
 *    off its entity: along the outward normal for curves (the upper side of a
 *    line), up and right for points. A point-pair glyph moves off the line
 *    between its points, to the side of its normal (up, or right for a
 *    vertical pair) unless a curve is in the way. Glyphs on the same spot
 *    line up in a row across that direction, in constraint order.
 */
import {
  CONSTRAINT_LABELS,
  type ConstraintId,
  curvePolyline,
  entityPoints,
  isDatumLine,
  projectedEntities,
  type SketchConstraint,
  type SketchConstraintType,
  type SketchData,
  type SketchEntityId,
  type Vec2,
} from '@extrudo/core';
import type { IconName } from '../../design-system';

/** What a glyph shows: the icon and the label of its constraint. */
export interface GlyphFace {
  icon: IconName;
  /** "Horizontal", or "Horizontal (points)" for a pair of points. */
  label: string;
}

export interface GlyphAnchor extends GlyphFace {
  constraint: ConstraintId;
  type: SketchConstraintType;
  /** The entity the glyph sits on. */
  entity: SketchEntityId;
  /** Where on it, sketch mm. */
  at: Vec2;
  /** Which way the glyph moves off a curve (unit, sketch space); none for points. */
  normal?: Vec2;
  /** A Horizontal/Vertical between two points: steps to the clearer side of the line between them. */
  pair?: true;
}

export interface PlacedGlyph extends GlyphFace {
  constraint: ConstraintId;
  type: SketchConstraintType;
  /** The glyph's center, screen pixels. */
  x: number;
  y: number;
}

/** Glyph size and the gap between glyphs in a row, px. */
export const GLYPH_SIZE = 18;
const GAP = 2;
/** How far a glyph's center sits from its curve, px. */
const OFFSET = 14;
/** A pair glyph keeps its side while this far (px) from every curve. */
const CLEAR = GLYPH_SIZE / 2 + 2;

/** The icon of each constraint type; a point on a curve is a coincidence. */
const ICONS: Record<SketchConstraintType, IconName> = {
  coincident: 'coincident',
  pointOnCurve: 'coincident',
  collinear: 'collinear',
  concentric: 'concentric',
  midpoint: 'midpoint',
  fix: 'fix',
  parallel: 'parallel',
  perpendicular: 'perpendicular',
  horizontal: 'horizontal',
  vertical: 'vertical',
  tangent: 'tangent',
  smooth: 'smooth',
  equal: 'equal',
  symmetric: 'symmetric',
};

/** A horizontal or vertical that ties two points rather than holding a line. */
function isPointPair(
  c: SketchConstraint,
): c is SketchConstraint & { type: 'horizontal' | 'vertical'; b: SketchEntityId } {
  return (c.type === 'horizontal' || c.type === 'vertical') && c.b !== undefined;
}

/** The icon and label a constraint's glyph shows. */
export function glyphFace(c: SketchConstraint): GlyphFace {
  if (isPointPair(c)) {
    return {
      icon: c.type === 'horizontal' ? 'horizontal-points' : 'vertical-points',
      label: `${CONSTRAINT_LABELS[c.type]} (points)`,
    };
  }
  return { icon: ICONS[c.type], label: CONSTRAINT_LABELS[c.type] };
}

export function glyphAnchors(sketch: SketchData): GlyphAnchor[] {
  const out: GlyphAnchor[] = [];
  const fixed = fixedPoints(sketch);
  for (const [key, c] of Object.entries(sketch.constraints)) {
    const constraint = key as ConstraintId;
    const face = glyphFace(c);
    if (isPointPair(c)) {
      const a = pointAt(sketch, c.a);
      const b = pointAt(sketch, c.b);
      // One end fixed (often far away, on the model's outline): beside the point that moves.
      const fixedA = fixed.has(c.a);
      if (a && b && fixedA !== fixed.has(c.b)) {
        const [entity, at] = fixedA ? [c.b, b] : [c.a, a];
        out.push({ constraint, type: c.type, ...face, entity, at });
        continue;
      }
      // Otherwise once, halfway between the two points: the tie is between them, not on either.
      if (a && b) {
        // Up for a level pair, right for a plumb one (perpendicular to b - a).
        let normal = unit([a[1] - b[1], b[0] - a[0]]);
        if (normal && (normal[1] < -1e-9 || (Math.abs(normal[1]) <= 1e-9 && normal[0] < 0))) {
          normal = [-normal[0], -normal[1]];
        }
        out.push({
          constraint,
          type: c.type,
          ...face,
          entity: c.a,
          at: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2],
          ...(normal && { normal, pair: true as const }),
        });
      }
      continue;
    }
    for (const entity of glyphEntities(sketch, c)) {
      const spot = spotOn(sketch, entity);
      if (spot) out.push({ constraint, type: c.type, ...face, entity, ...spot });
    }
  }
  return out;
}

/** The sketch's drawn curves as polylines (sketch mm): what a point-pair glyph keeps clear of. */
export function glyphCurves(sketch: SketchData): Vec2[][] {
  const curves: Vec2[][] = [];
  for (const [id, entity] of Object.entries(sketch.entities)) {
    if (entity.type === 'point' || isDatumLine(sketch, id as SketchEntityId)) continue;
    const line = curvePolyline(sketch, entity);
    if (line && line.length >= 2) curves.push([...line]);
  }
  return curves;
}

/** Points that can't move: projected ones and those a Fix holds (on the point or its curve). */
function fixedPoints(sketch: SketchData): Set<SketchEntityId> {
  const out = new Set(projectedEntities(sketch));
  for (const c of Object.values(sketch.constraints)) {
    if (c.type !== 'fix') continue;
    const e = sketch.entities[c.entity];
    out.add(c.entity);
    if (e) for (const p of entityPoints(e)) out.add(p);
  }
  return out;
}

function pointAt(sketch: SketchData, id: SketchEntityId): Vec2 | undefined {
  const p = sketch.entities[id];
  return p?.type === 'point' ? [p.x, p.y] : undefined;
}

/** The entities that carry a constraint's glyphs. */
function glyphEntities(sketch: SketchData, c: SketchConstraint): SketchEntityId[] {
  switch (c.type) {
    case 'coincident':
      return [c.a];
    case 'pointOnCurve':
    case 'midpoint':
      return [c.point];
    case 'fix':
      return [c.entity];
    case 'horizontal':
    case 'vertical':
      return c.b === undefined ? [c.a] : [c.a, c.b];
    case 'tangent':
    case 'smooth': {
      const joint = sharedEnd(sketch, c.a, c.b);
      return joint ? [joint] : [c.a, c.b];
    }
    default:
      // Pairs, and a symmetry's two entities (not its axis).
      return [c.a, c.b];
  }
}

/** An end point of `a` that lies on an end point of `b` (where two curves are joined). */
function sharedEnd(sketch: SketchData, a: SketchEntityId, b: SketchEntityId) {
  const ends = (id: SketchEntityId): SketchEntityId[] => {
    const e = sketch.entities[id];
    return e?.type === 'line' || e?.type === 'arc' ? [e.start, e.end] : [];
  };
  const at = (id: SketchEntityId): Vec2 | undefined => {
    const p = sketch.entities[id];
    return p?.type === 'point' ? [p.x, p.y] : undefined;
  };
  for (const p of ends(a)) {
    const pa = at(p);
    for (const q of ends(b)) {
      const pb = at(q);
      if (pa && pb && Math.hypot(pa[0] - pb[0], pa[1] - pb[1]) < 1e-6) return p;
    }
  }
  return undefined;
}

/** A glyph's spot on an entity, and which way is out. */
function spotOn(sketch: SketchData, id: SketchEntityId): { at: Vec2; normal?: Vec2 } | undefined {
  const entity = sketch.entities[id];
  if (!entity) return undefined;
  if (entity.type === 'point') return { at: [entity.x, entity.y] };
  const line = curvePolyline(sketch, entity);
  if (!line || line.length < 2) return undefined;
  const center = (ref: SketchEntityId): Vec2 | undefined => {
    const p = sketch.entities[ref];
    return p?.type === 'point' ? [p.x, p.y] : undefined;
  };
  switch (entity.type) {
    case 'circle':
    case 'ellipse': {
      // An eighth of the way round from the start: 45° on a circle.
      const at = line[Math.round((line.length - 1) / 8)] as Vec2;
      const c = center(entity.center);
      return { at, normal: c && unit([at[0] - c[0], at[1] - c[1]]) };
    }
    case 'arc': {
      const at = line[Math.floor(line.length / 2)] as Vec2;
      const c = center(entity.center);
      return { at, normal: c && unit([at[0] - c[0], at[1] - c[1]]) };
    }
    default: {
      // Lines and splines: the middle, on the upper side (or the left of a vertical line).
      const mid = middle(line);
      let n = unit([-mid.dir[1], mid.dir[0]]);
      if (n && (n[1] < -1e-9 || (Math.abs(n[1]) <= 1e-9 && n[0] > 0))) n = [-n[0], -n[1]];
      return { at: mid.at, normal: n };
    }
  }
}

/** The point halfway along a polyline, and the direction there. */
function middle(line: readonly Vec2[]): { at: Vec2; dir: Vec2 } {
  const lengths = line.slice(1).map((p, i) => dist(p, line[i] as Vec2));
  let half = lengths.reduce((a, b) => a + b, 0) / 2;
  for (let i = 0; i < lengths.length; i++) {
    const a = line[i] as Vec2;
    const b = line[i + 1] as Vec2;
    const len = lengths[i] as number;
    if (half <= len || i === lengths.length - 1) {
      const t = len === 0 ? 0 : Math.min(1, half / len);
      return {
        at: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t],
        dir: [b[0] - a[0], b[1] - a[1]],
      };
    }
    half -= len;
  }
  return { at: line[0] as Vec2, dir: [1, 0] };
}

/** Screen distance from `p` to the nearest of the polylines. */
function distanceToCurves(p: readonly [number, number], lines: readonly (readonly Vec2[])[]) {
  let best = Number.POSITIVE_INFINITY;
  for (const line of lines) {
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1] as Vec2;
      const b = line[i] as Vec2;
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const len2 = dx * dx + dy * dy;
      const t =
        len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
      best = Math.min(best, Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy));
    }
  }
  return best;
}

/** The polylines in screen pixels: points that don't project are left out. */
function projectCurves(
  curves: readonly (readonly Vec2[])[],
  project: (p: Vec2) => readonly [number, number] | undefined,
): Vec2[][] {
  const out: Vec2[][] = [];
  for (const line of curves) {
    const screen: Vec2[] = [];
    for (const p of line) {
      const s = project(p);
      if (s) screen.push([s[0], s[1]]);
    }
    out.push(screen);
  }
  return out;
}

const dist = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1]);

function unit(v: Vec2): Vec2 | undefined {
  const len = Math.hypot(v[0], v[1]);
  return len > 1e-12 ? [v[0] / len, v[1] / len] : undefined;
}

/**
 * Glyph centers on screen. `project` maps sketch mm to screen pixels (y
 * down); anchors that don't project (behind the camera) are left out.
 */
export function layoutGlyphs(
  anchors: readonly GlyphAnchor[],
  project: (p: Vec2) => readonly [number, number] | undefined,
  curves?: readonly (readonly Vec2[])[],
): PlacedGlyph[] {
  interface Row {
    origin: readonly [number, number];
    /** Screen direction off the entity (unit). */
    out: readonly [number, number];
    glyphs: GlyphAnchor[];
  }
  const rows = new Map<string, Row>();
  let screenCurves: Vec2[][] | undefined;
  for (const anchor of anchors) {
    const origin = project(anchor.at);
    if (!origin) continue;
    let out: readonly [number, number] = [Math.SQRT1_2, -Math.SQRT1_2];
    if (anchor.normal) {
      // A small step along the normal, projected, gives its direction on screen.
      const step = project([
        anchor.at[0] + anchor.normal[0] * 1e-3,
        anchor.at[1] + anchor.normal[1] * 1e-3,
      ]);
      const d = step && ([step[0] - origin[0], step[1] - origin[1]] as const);
      const len = d ? Math.hypot(d[0], d[1]) : 0;
      if (d && len > 1e-9) out = [d[0] / len, d[1] / len];
    }
    if (anchor.pair && curves?.length) {
      // Keep the normal's side unless a curve is too close there and the other side is clearer.
      if (screenCurves === undefined) screenCurves = projectCurves(curves, project);
      const lines = screenCurves;
      const side = (k: number) =>
        distanceToCurves([origin[0] + k * out[0] * OFFSET, origin[1] + k * out[1] * OFFSET], lines);
      const plus = side(1);
      if (plus < CLEAR && side(-1) > plus) out = [-out[0], -out[1]];
    }
    // Points on the same spot share a row whichever point entity they name.
    const key = anchor.pair
      ? `m:${Math.round(origin[0])},${Math.round(origin[1])}`
      : anchor.normal
        ? `e:${anchor.entity}`
        : `p:${Math.round(origin[0])},${Math.round(origin[1])}`;
    const row = rows.get(key);
    if (row) row.glyphs.push(anchor);
    else rows.set(key, { origin, out, glyphs: [anchor] });
  }

  const placed: PlacedGlyph[] = [];
  const pitch = GLYPH_SIZE + GAP;
  for (const { origin, out, glyphs } of rows.values()) {
    const point = glyphs[0]?.normal === undefined;
    // Beside a point: a row to the right, starting up and right of it. On a
    // curve: a row across the offset direction (rightwards where possible), centered.
    let along: readonly [number, number] = point ? [1, 0] : [-out[1], out[0]];
    if (along[0] < -1e-9 || (Math.abs(along[0]) <= 1e-9 && along[1] < 0)) {
      along = [-along[0], -along[1]];
    }
    const first = point ? 0 : -((glyphs.length - 1) * pitch) / 2;
    const cx = origin[0] + out[0] * OFFSET;
    const cy = origin[1] + out[1] * OFFSET;
    glyphs.forEach((g, i) => {
      const s = first + i * pitch;
      placed.push({
        constraint: g.constraint,
        type: g.type,
        icon: g.icon,
        label: g.label,
        x: cx + along[0] * s,
        y: cy + along[1] * s,
      });
    });
  }
  return placed;
}
