/**
 * Copies and transforms of picked sketch geometry (P1-10, FR-SK-10): copy,
 * mirror, rectangular and circular patterns, and scale. Move goes through
 * the solver's drag instead (the tool host), so it keeps the constraints.
 *
 * A copy brings the constraints among the copied entities with it, and
 * their dimensions: a pattern's copies take the original's parameter
 * (`d3`) as their expression, so one value sizes them all; a plain copy
 * takes the same expression. What a rotation doesn't keep (horizontal,
 * vertical, fix, horizontal and vertical distances) stays behind. Copies
 * are placed, not tied to the original's position (ADR-0019).
 *
 * Mirror adds a symmetry constraint for every mirrored curve and point, so
 * the copy follows the original.
 */
import {
  constraintRefs,
  curvePolyline,
  type DimensionId,
  dimensionRefs,
  entityPoints,
  type SketchConstraint,
  type SketchData,
  type SketchDimension,
  type SketchEntity,
  type SketchEntityId,
  type Vec2,
} from '@extrudo/core';
import { dist, dot, sub } from '../inference/geometry';
import { ChangeBuilder, ModifyError, type ModifyResult, pointOf } from './change';

/**
 * The entities a pick of `ids` stands for: the picked curves, and picked
 * points that aren't a picked curve's own. Missing IDs are left out.
 */
export function objectsOf(data: SketchData, ids: readonly SketchEntityId[]): SketchEntityId[] {
  const curves = ids.filter((id) => {
    const e = data.entities[id];
    return e !== undefined && e.type !== 'point';
  });
  const owned = new Set(curves.flatMap((id) => entityPoints(data.entities[id] as SketchEntity)));
  const points = ids.filter((id) => data.entities[id]?.type === 'point' && !owned.has(id));
  return [...new Set([...curves, ...points])];
}

/** Every entity the objects consist of: the curves, their points, and the loose points. */
function members(data: SketchData, objects: readonly SketchEntityId[]): Set<SketchEntityId> {
  const out = new Set<SketchEntityId>();
  for (const id of objects) {
    const e = data.entities[id];
    if (!e) continue;
    out.add(id);
    for (const p of entityPoints(e)) out.add(p);
  }
  return out;
}

/** A rigid motion or a uniform scale: where a position goes. */
export interface Placement {
  map(p: Vec2): Vec2;
  /** Turns directions (not a translation). */
  rotates: boolean;
}

export const translation = (by: Vec2): Placement => ({
  map: (p) => [p[0] + by[0], p[1] + by[1]],
  rotates: false,
});

export const rotation = (center: Vec2, angle: number): Placement => {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    map: (p) => {
      const x = p[0] - center[0];
      const y = p[1] - center[1];
      return [center[0] + x * cos - y * sin, center[1] + x * sin + y * cos];
    },
    rotates: Math.abs(sin) > 1e-12 || cos < 0,
  };
};

/** The objects' polylines, placed (a preview). Loose points come back as one-point lines. */
export function placedPolylines(
  data: SketchData,
  objects: readonly SketchEntityId[],
  map: (p: Vec2) => Vec2,
  radius: (r: number) => number = (r) => r,
): Vec2[][] {
  const moved = placedData(data, objects, map, radius);
  return objects.flatMap((id) => {
    const e = moved.entities[id];
    if (!e) return [];
    if (e.type === 'point') return [[[e.x, e.y] as Vec2]];
    const line = curvePolyline(moved, e);
    return line ? [line] : [];
  });
}

/** The sketch with the objects' points moved by `map` (and circles' radii by `radius`). */
function placedData(
  data: SketchData,
  objects: readonly SketchEntityId[],
  map: (p: Vec2) => Vec2,
  radius: (r: number) => number,
): SketchData {
  const entities = { ...data.entities };
  for (const id of members(data, objects)) {
    const e = entities[id];
    if (e?.type === 'point') {
      const [x, y] = map([e.x, e.y]);
      entities[id] = { type: 'point', x, y };
    } else if (e?.type === 'circle') entities[id] = { ...e, radius: radius(e.radius) };
  }
  return { ...data, entities };
}

export interface CopyOptions {
  /** Copied driving dimensions take the original's parameter (patterns), not its expression. */
  link?: boolean;
}

/**
 * Copies the objects to where `placement` puts them, with the constraints
 * and dimensions among them. Returns the change and the copies' IDs by
 * original.
 */
export function copyObjects(
  b: ChangeBuilder,
  objects: readonly SketchEntityId[],
  placement: Placement,
  options: CopyOptions = {},
): Map<SketchEntityId, SketchEntityId> {
  const { data } = b;
  const set = members(data, objects);
  const ids = new Map<SketchEntityId, SketchEntityId>();
  const id = (old: SketchEntityId) => {
    let n = ids.get(old);
    if (!n) {
      n = b.newId() as SketchEntityId;
      ids.set(old, n);
    }
    return n;
  };
  for (const old of set) {
    const e = data.entities[old] as SketchEntity;
    const copy = copyEntity(e, id);
    if (copy.type === 'point') {
      const [x, y] = placement.map([copy.x, copy.y]);
      b.entities[id(old)] = { type: 'point', x, y };
    } else b.entities[id(old)] = copy;
  }
  const inside = (refs: SketchEntityId[]) => refs.every((r) => set.has(r));
  for (const c of Object.values(data.constraints)) {
    if (!inside(constraintRefs(c))) continue;
    if (placement.rotates && (c.type === 'horizontal' || c.type === 'vertical' || c.type === 'fix'))
      continue;
    b.constrain(mapConstraint(c, id));
  }
  for (const d of Object.values(data.dimensions)) {
    if (!inside(dimensionRefs(d))) continue;
    if (placement.rotates && d.type === 'distance' && d.orientation !== 'aligned') continue;
    const { paramName, label, ...rest } = d;
    const expr = options.link && !d.driven && paramName !== undefined ? paramName : d.expr;
    const copy = mapDimension({ ...rest, expr } as SketchDimension, id);
    b.dimension(!placement.rotates && label ? { ...copy, label } : copy);
  }
  return ids;
}

function copyEntity(e: SketchEntity, id: (old: SketchEntityId) => SketchEntityId): SketchEntity {
  switch (e.type) {
    case 'point':
      return { ...e };
    case 'line':
      return { ...e, start: id(e.start), end: id(e.end) };
    case 'circle':
      return { ...e, center: id(e.center) };
    case 'arc':
      return { ...e, center: id(e.center), start: id(e.start), end: id(e.end) };
    case 'ellipse':
      return { ...e, center: id(e.center), major: id(e.major), minor: id(e.minor) };
    case 'spline':
      return { ...e, points: e.points.map(id) };
  }
}

function mapConstraint(
  c: SketchConstraint,
  f: (id: SketchEntityId) => SketchEntityId,
): SketchConstraint {
  switch (c.type) {
    case 'pointOnCurve':
      return { ...c, point: f(c.point), curve: f(c.curve) };
    case 'midpoint':
      return { ...c, point: f(c.point), of: f(c.of) };
    case 'fix':
      return { ...c, entity: f(c.entity) };
    case 'symmetric':
      return { ...c, a: f(c.a), b: f(c.b), axis: f(c.axis) };
    case 'horizontal':
    case 'vertical':
      return c.b === undefined ? { ...c, a: f(c.a) } : { ...c, a: f(c.a), b: f(c.b) };
    default:
      return { ...c, a: f(c.a), b: f(c.b) };
  }
}

function mapDimension(
  d: SketchDimension,
  f: (id: SketchEntityId) => SketchEntityId,
): SketchDimension {
  switch (d.type) {
    case 'distance':
      return d.b === undefined ? { ...d, a: f(d.a) } : { ...d, a: f(d.a), b: f(d.b) };
    case 'angle':
      return { ...d, a: f(d.a), b: f(d.b) };
    default:
      return { ...d, curve: f(d.curve) };
  }
}

function checkObjects(objects: readonly SketchEntityId[]): void {
  if (objects.length === 0) throw new ModifyError('Pick something first.');
}

/** Copies the objects, moved by `by`. */
export function copy(
  data: SketchData,
  objects: readonly SketchEntityId[],
  by: Vec2,
  newId: () => string,
): ModifyResult {
  checkObjects(objects);
  const b = new ChangeBuilder(data, newId);
  copyObjects(b, objects, translation(by));
  return b.result();
}

/**
 * A rectangular pattern: `columns` × `rows` instances (the original is the
 * first), `spacing` apart along the sketch's X and Y.
 */
export function rectangularPattern(
  data: SketchData,
  objects: readonly SketchEntityId[],
  columns: number,
  rows: number,
  spacing: Vec2,
  newId: () => string,
): ModifyResult {
  checkObjects(objects);
  if (columns * rows < 2) throw new ModifyError('A pattern needs at least two instances.');
  const b = new ChangeBuilder(data, newId);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < columns; i++) {
      if (i === 0 && j === 0) continue;
      copyObjects(b, objects, translation([i * spacing[0], j * spacing[1]]), { link: true });
    }
  }
  return b.result();
}

/** Where a rectangular pattern's instances go: their offsets from the original. */
export function rectangularOffsets(columns: number, rows: number, spacing: Vec2): Vec2[] {
  const out: Vec2[] = [];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < columns; i++) {
      if (i !== 0 || j !== 0) out.push([i * spacing[0], j * spacing[1]]);
    }
  }
  return out;
}

/**
 * The angles of a circular pattern's copies: `count` instances over
 * `total` radians. A full turn spaces them evenly with none on top of the
 * original; a part turn puts the last one at the end.
 */
export function circularAngles(count: number, total: number): number[] {
  const full = Math.abs(Math.abs(total) - 2 * Math.PI) < 1e-9;
  const step = full ? total / count : total / Math.max(1, count - 1);
  return Array.from({ length: Math.max(0, count - 1) }, (_, k) => (k + 1) * step);
}

/** A circular pattern: `count` instances around `center` over `total` radians. */
export function circularPattern(
  data: SketchData,
  objects: readonly SketchEntityId[],
  center: Vec2,
  count: number,
  total: number,
  newId: () => string,
): ModifyResult {
  checkObjects(objects);
  if (count < 2) throw new ModifyError('A pattern needs at least two instances.');
  const b = new ChangeBuilder(data, newId);
  for (const angle of circularAngles(count, total)) {
    copyObjects(b, objects, rotation(center, angle), { link: true });
  }
  return b.result();
}

// Mirror ------------------------------------------------------------------------

/** The mirror image of `p` in the line through `a` and `b`. */
export function reflect(a: Vec2, b: Vec2, p: Vec2): Vec2 {
  const d = sub(b, a);
  const t = dot(sub(p, a), d) / dot(d, d);
  const foot: Vec2 = [a[0] + d[0] * t, a[1] + d[1] * t];
  return [2 * foot[0] - p[0], 2 * foot[1] - p[1]];
}

/** The mirror line's ends, or undefined if `axis` isn't a line. */
export function axisOf(data: SketchData, axis: SketchEntityId): [Vec2, Vec2] | undefined {
  const line = data.entities[axis];
  if (line?.type !== 'line') return undefined;
  const a = pointOf(data, line.start);
  const b = pointOf(data, line.end);
  return a && b && dist(a, b) > 0 ? [a, b] : undefined;
}

/**
 * Mirrors the objects in the line `axis`. Each copy is held symmetric to
 * its original: lines, circles and arcs as a whole, splines and loose
 * points point by point, ellipses by their center and major axis. A point
 * on the mirror line gets a copy joined to it, and is held on the line
 * (`auto`: kept only if it isn't there already).
 */
export function mirror(
  data: SketchData,
  objects: readonly SketchEntityId[],
  axis: SketchEntityId,
  newId: () => string,
): ModifyResult {
  const ends = axisOf(data, axis);
  if (!ends) throw new ModifyError('Pick a line to mirror about.');
  const picked = objects.filter((id) => id !== axis);
  checkObjects(picked);
  const [a0, a1] = ends;
  const b = new ChangeBuilder(data, newId);
  const ids = new Map<SketchEntityId, SketchEntityId>();
  const id = (old: SketchEntityId) => {
    let n = ids.get(old);
    if (!n) {
      n = b.newId() as SketchEntityId;
      ids.set(old, n);
    }
    return n;
  };
  const onAxis = (p: SketchEntityId) => {
    const q = pointOf(data, p);
    return q !== undefined && dist(q, reflect(a0, a1, q)) < 1e-6;
  };
  /** Holds a point's copy: joined to it on the axis, else symmetric. */
  const pair = (p: SketchEntityId) => {
    if (onAxis(p)) {
      b.constrain({ type: 'coincident', a: p, b: id(p) });
      b.auto.push(b.constrain({ type: 'pointOnCurve', point: p, curve: axis }));
    } else b.constrain({ type: 'symmetric', a: p, b: id(p), axis });
  };

  for (const old of members(data, picked)) {
    const e = data.entities[old] as SketchEntity;
    let copy = copyEntity(e, id);
    if (copy.type === 'point') {
      const [x, y] = reflect(a0, a1, [copy.x, copy.y]);
      copy = { type: 'point', x, y };
    }
    // A mirrored arc turns the other way round: swap its ends.
    if (copy.type === 'arc') copy = { ...copy, start: copy.end, end: copy.start };
    b.entities[id(old)] = copy;
  }
  for (const old of picked) {
    const e = data.entities[old] as SketchEntity;
    switch (e.type) {
      case 'point':
        pair(old);
        break;
      case 'line':
        if (onAxis(e.start) || onAxis(e.end)) {
          pair(e.start);
          pair(e.end);
        } else b.constrain({ type: 'symmetric', a: old, b: id(old), axis });
        break;
      case 'circle':
        b.constrain({ type: 'symmetric', a: old, b: id(old), axis });
        break;
      case 'arc':
        if (onAxis(e.start) || onAxis(e.end)) {
          // Symmetric centers and ends would fix the radius twice; ends and equal radii don't.
          pair(e.start);
          pair(e.end);
          b.constrain({ type: 'equal', a: old, b: id(old) });
        } else b.constrain({ type: 'symmetric', a: old, b: id(old), axis });
        break;
      case 'ellipse':
        pair(e.center);
        pair(e.major);
        break;
      case 'spline':
        for (const p of e.points) pair(p);
        break;
    }
  }
  return b.result();
}

// Scale -------------------------------------------------------------------------

/**
 * Scales the objects about `base` by `factor`. Points and radii move; the
 * lengths and radii of dimensions wholly on the objects scale with them
 * (a plain number is multiplied, anything else wrapped: "(d3) * 2"), angles
 * don't. Fixed geometry that would move or grow refuses the scale; `moved`
 * lists the points the solve must leave where they are: something else
 * holding them (a dimension to outside geometry) means it can't happen.
 */
export function scale(
  data: SketchData,
  objects: readonly SketchEntityId[],
  base: Vec2,
  factor: number,
  newId: () => string,
): { result: ModifyResult; moved: SketchEntityId[] } {
  checkObjects(objects);
  if (!(factor > 0)) throw new ModifyError('The scale must be more than zero.');
  const b = new ChangeBuilder(data, newId);
  const set = members(data, objects);
  const moved: SketchEntityId[] = [];
  for (const id of set) {
    const e = data.entities[id];
    if (e?.type === 'point') {
      const to: Vec2 = [base[0] + (e.x - base[0]) * factor, base[1] + (e.y - base[1]) * factor];
      b.move(id, to);
      if (dist(to, [e.x, e.y]) > 1e-9) moved.push(id);
    } else if (e?.type === 'circle') b.set(id, { ...e, radius: e.radius * factor });
  }
  // A fix holds whatever position it finds, so the solve can't catch it: refuse here.
  for (const c of Object.values(data.constraints)) {
    if (c.type !== 'fix') continue;
    const e = data.entities[c.entity];
    const points = e?.type === 'point' ? [c.entity] : e ? entityPoints(e) : [];
    const resized = e?.type === 'circle' && set.has(c.entity) && factor !== 1;
    if (resized || points.some((p) => moved.includes(p))) {
      throw new ModifyError("Fixed geometry can't be scaled; unfix it first.");
    }
  }
  const exprs: Record<DimensionId, string> = {};
  for (const [key, d] of Object.entries(data.dimensions)) {
    if (d.driven || d.type === 'angle') continue;
    if (!dimensionRefs(d).every((r) => set.has(r))) continue;
    exprs[key as DimensionId] = scaleExpression(d.expr, factor);
  }
  return { result: { ...b.result(), exprs }, moved };
}

const PLAIN = /^\s*(-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*([a-z]*)\s*$/i;

/** An expression times `factor`: "20 mm" → "40 mm", "d3 + 1" → "(d3 + 1) * 2". */
export function scaleExpression(expr: string, factor: number): string {
  const plain = PLAIN.exec(expr);
  if (plain) {
    const value = Number(plain[1]) * factor;
    const text = String(Number(value.toPrecision(12)));
    return plain[2] ? `${text} ${plain[2]}` : text;
  }
  return `(${expr.trim()}) * ${Number(factor.toPrecision(12))}`;
}
