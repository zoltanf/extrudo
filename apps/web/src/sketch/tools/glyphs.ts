/**
 * Where constraint glyphs go (P1-06, FR-SK-07, UI spec §4). Pure, so the
 * placement is unit-tested; `ConstraintGlyphs.tsx` draws the result.
 *
 * 1. `glyphAnchors` gives each constraint one glyph per constrained entity,
 *    at a spot on that entity: a point itself, a line's middle, an arc's
 *    middle, a circle or an ellipse at 45°, a spline's middle. A coincidence
 *    and a point on a curve show once, at the point; a tangent between
 *    curves that are joined shows once, at the joint; a symmetry shows on its
 *    two entities, not the axis.
 * 2. `layoutGlyphs` projects the anchors to the screen and moves each glyph
 *    off its entity: along the outward normal for curves (the upper side of a
 *    line), up and right for points. Glyphs on the same spot line up in a
 *    row across that direction, in constraint order.
 */
import {
  type ConstraintId,
  curvePolyline,
  type SketchConstraint,
  type SketchConstraintType,
  type SketchData,
  type SketchEntityId,
  type Vec2,
} from '@extrudo/core';

export interface GlyphAnchor {
  constraint: ConstraintId;
  type: SketchConstraintType;
  /** The entity the glyph sits on. */
  entity: SketchEntityId;
  /** Where on it, sketch mm. */
  at: Vec2;
  /** Which way the glyph moves off a curve (unit, sketch space); none for points. */
  normal?: Vec2;
}

export interface PlacedGlyph {
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

export function glyphAnchors(sketch: SketchData): GlyphAnchor[] {
  const out: GlyphAnchor[] = [];
  for (const [key, c] of Object.entries(sketch.constraints)) {
    const constraint = key as ConstraintId;
    for (const entity of glyphEntities(sketch, c)) {
      const spot = spotOn(sketch, entity);
      if (spot) out.push({ constraint, type: c.type, entity, ...spot });
    }
  }
  return out;
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
): PlacedGlyph[] {
  interface Row {
    origin: readonly [number, number];
    /** Screen direction off the entity (unit). */
    out: readonly [number, number];
    glyphs: GlyphAnchor[];
  }
  const rows = new Map<string, Row>();
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
    // Points on the same spot share a row whichever point entity they name.
    const key = anchor.normal
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
        x: cx + along[0] * s,
        y: cy + along[1] * s,
      });
    });
  }
  return placed;
}
