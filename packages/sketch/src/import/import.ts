/**
 * Drawings into sketches (P4-06, FR-SK-14, ADR-0066 §1): an `@extrudo/io`
 * drawing (what `readSvg` and `readDxf` give) as a `SketchChange` for
 * `modifySketch`, so an imported drawing lands in the sketch as ordinary
 * editable curves in one undo step. Pure, in its own entry like `/export`: the
 * app imports `@extrudo/sketch/import`.
 *
 * The mapping is the ADR's table: lines are lines, a whole turn is a circle and
 * a whole ellipse an ellipse entity, and everything else (an elliptical arc, a
 * Bézier) is a control-point spline of four poles — which since P4-05
 * (`controlSpline`) is exactly one cubic Bézier. Nothing is flattened.
 *
 * **Fixed by default.** Every new curve gets a `fix` constraint, and the solver
 * treats fixed geometry as constants (ADR-0011), so a 3,000-curve logo costs
 * the solver nothing and no coincident constraints are made: profile detection
 * joins ends within 0.1 µm by geometry (ADR-0020). With `fixed` off, ends that
 * coincide within a micron get coincident constraints instead, each point
 * keeping one owner (ADR-0010).
 */
import type {
  ConstraintId,
  SketchChange,
  SketchConstraint,
  SketchData,
  SketchEntity,
  SketchEntityId,
  Vec2,
} from '@extrudo/core';
import { type Drawing, drawingBounds, type Point, type Segment, UNIT_MM } from '@extrudo/io';

export { drawingBounds, UNIT_MM };

/** The most curves an import may bring in (ADR-0066 §1). */
export const MAX_IMPORT_CURVES = 5000;
/** How close two ends have to be for a coincident constraint (mm). */
export const COINCIDENT_TOLERANCE = 1e-6;
/** How close two curves have to be to count as the same one (mm). */
export const DUPLICATE_TOLERANCE = 1e-9;
/** The most of an ellipse one Bézier piece covers, in radians (ADR-0066 §1). */
export const ELLIPSE_PIECE = Math.PI / 4;

/** Thrown for a drawing too big to import, with the message for the panel. */
export class ImportLimitError extends Error {
  override readonly name = 'ImportLimitError';
}

export interface ImportOptions {
  /** Millimetres per drawing unit (the panel's Scale). */
  scale: number;
  /** Where the drawing's origin goes, in sketch mm. */
  offset: Vec2;
  /** Fix every new curve, so the solver treats them as constants (the default). */
  fixed: boolean;
  /**
   * Where new IDs come from. The caller passes its own (`newId` in the app), so
   * the same drawing gives the same change every time (ADR-0003).
   */
  ids?: () => string;
}

/** The end of a curve, as the joint another curve's end may share. */
interface Joint {
  at: Vec2;
  curve: SketchEntityId;
}

/** Every segment a drawing brings in, in file order, with the point each starts at. */
function segmentsOf(drawing: Drawing): { from: Point; segment: Segment }[] {
  const out: { from: Point; segment: Segment }[] = [];
  for (const shape of drawing.shapes) {
    for (const contour of shape.contours) {
      let from = contour.start;
      for (const segment of contour.segments) {
        out.push({ from, segment });
        from = segment.to;
      }
      // A closed contour's closing segment is part of the shape even where the
      // file left it out (a polyline marked closed, a path that ends with `Z`).
      if (contour.closed && !same(from, contour.start)) {
        out.push({ from, segment: { type: 'line', to: contour.start } });
      }
    }
  }
  return out;
}

/**
 * How many curves a drawing brings in, before zero-length lines and duplicates
 * are left out: what a panel shows, and what the limit counts.
 */
export function drawingCurves(drawing: Drawing): number {
  return segmentsOf(drawing).length;
}

/** The message the curve limit gets, for a panel that counts before committing. */
export function importLimitMessage(count: number): string {
  const number = (n: number) => n.toLocaleString('en-US');
  return `This drawing has ${number(count)} curves; Extrudo imports up to ${number(MAX_IMPORT_CURVES)}.`;
}

/**
 * A drawing as a change to a sketch: new entities, new constraints (the `fix` of
 * each curve, or the coincident joints) and nothing else, ready for
 * `modifySketch({ ...change, feature, label })`. Every curve gets its own points,
 * as ADR-0010 wants; a zero-length line and an exact duplicate of a curve
 * already added are left out. The sketch itself is not read: an import adds to
 * it whatever is in the drawing.
 */
export function drawingToSketch(
  drawing: Drawing,
  _sketch: SketchData,
  options: ImportOptions,
): SketchChange {
  const newId = options.ids ?? counter();
  const scale = Number.isFinite(options.scale) && options.scale !== 0 ? options.scale : 1;
  const offset = options.offset ?? [0, 0];
  const at = (p: Point): Vec2 => [p[0] * scale + offset[0], p[1] * scale + offset[1]];

  const segments = segmentsOf(drawing);
  if (segments.length > MAX_IMPORT_CURVES)
    throw new ImportLimitError(importLimitMessage(segments.length));

  const entities: Record<SketchEntityId, SketchEntity> = {};
  const constraints: Record<ConstraintId, SketchConstraint> = {};
  const joints: Joint[] = [];
  const seen = new Set<string>();
  const add = (entity: SketchEntity): SketchEntityId => {
    const id = newId() as SketchEntityId;
    entities[id] = entity;
    return id;
  };
  const point = (p: Vec2): SketchEntityId => add({ type: 'point', x: p[0], y: p[1] });
  const joint = (p: Vec2, curve: SketchEntityId) => joints.push({ at: p, curve });
  const fresh = (key: string) => {
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  };

  for (const { from, segment } of segments) {
    const start = at(from);
    switch (segment.type) {
      case 'line': {
        const end = at(segment.to);
        // A line drawn the other way round is the same curve, so the key is
        // written with its ends in order.
        const [a, b] = [key(start), key(end)].sort();
        if (near(start, end) || !fresh(`line ${a} ${b}`)) break;
        const id = add({ type: 'line', start: point(start), end: point(end), construction: false });
        joint(start, id);
        joint(end, id);
        break;
      }
      case 'arc': {
        const centre = at(segment.center);
        const end = at(segment.to);
        const radius = Math.hypot(start[0] - centre[0], start[1] - centre[1]);
        if (radius <= DUPLICATE_TOLERANCE) break;
        if (!fresh(`arc ${key(centre)} ${key(start)} ${segment.sweep > 0}`)) break;
        if (whole(segment.sweep)) {
          const id = add({ type: 'circle', center: point(centre), radius, construction: false });
          joint(centre, id);
          break;
        }
        // A sketch arc runs counter-clockwise from start to end, so a clockwise
        // arc's ends swap.
        const [first, last] = segment.sweep > 0 ? [start, end] : [end, start];
        const id = add({
          type: 'arc',
          center: point(centre),
          start: point(first),
          end: point(last),
          construction: false,
        });
        joint(first, id);
        joint(last, id);
        break;
      }
      case 'ellipse': {
        const centre = at(segment.center);
        const shape = {
          center: segment.center,
          rx: segment.rx,
          ry: segment.ry,
          rotation: segment.rotation,
        };
        if (whole(segment.sweep)) {
          if (!fresh(`ellipse ${ellipseKey(shape)}`)) break;
          const id = add({
            type: 'ellipse',
            center: point(centre),
            major: point(at(ellipsePoint(shape, 0))),
            minor: point(at(ellipsePoint(shape, Math.PI / 2))),
            construction: false,
          });
          joint(centre, id);
          break;
        }
        // A piece of an ellipse is a curve of its own, so it comes in as the
        // control-point splines that are exactly its cubic Bézier pieces.
        const t0 = parameterOf(shape, from);
        if (!fresh(`ellipse ${ellipseKey(shape)} ${t0.toFixed(9)} ${segment.sweep.toFixed(9)}`))
          break;
        let previousEnd: Vec2 | undefined;
        for (const poles of ellipsePieces(shape, t0, segment.sweep)) {
          const mapped = poles.map(at);
          const id = add({
            type: 'spline',
            points: mapped.map(point),
            mode: 'control',
            construction: false,
          });
          if (previousEnd) joint(previousEnd, id);
          previousEnd = mapped[3] as Vec2;
          joint(previousEnd, id);
        }
        break;
      }
      case 'quadratic':
      case 'cubic': {
        // A quadratic is the same curve as its degree-elevated cubic, and since
        // P4-05 a four-pole control spline is exactly one Bézier.
        const poles: Vec2[] =
          segment.type === 'cubic'
            ? [start, at(segment.c1), at(segment.c2), at(segment.to)]
            : [start, at(segment.control), at(segment.to)];
        if (!fresh(`spline ${poles.map(key).join(' ')}`)) break;
        if (poles.length === 2 && near(poles[0] as Vec2, poles[1] as Vec2)) break;
        const id = add({
          type: 'spline',
          points: poles.map(point),
          mode: 'control',
          construction: false,
        });
        joint(poles[0] as Vec2, id);
        joint(poles[poles.length - 1] as Vec2, id);
        break;
      }
    }
  }

  if (options.fixed) {
    // One `fix` per curve: the solver reads it as every point of the curve and
    // as the curve's own parameters (a circle's radius), so nothing is solved.
    for (const [id, entity] of Object.entries(entities)) {
      if (entity.type === 'point') continue;
      constraints[newId() as ConstraintId] = { type: 'fix', entity: id as SketchEntityId };
    }
  } else {
    // Ends that meet within a micron get a coincident constraint. The first
    // point there is the one kept and the second is joined to it.
    for (let i = 0; i < joints.length; i++) {
      const first = joints[i] as Joint;
      const owner = endOf(entities, first.curve, first.at);
      if (!owner) continue;
      for (let j = i + 1; j < joints.length; j++) {
        const other = joints[j] as Joint;
        if (!near(first.at, other.at)) continue;
        const partner = endOf(entities, other.curve, other.at);
        if (!partner || partner === owner) continue;
        constraints[newId() as ConstraintId] = { type: 'coincident', a: owner, b: partner };
        break;
      }
    }
  }

  return { entities, constraints, dimensions: {} };
}

/** Whether a segment's sweep is a whole turn, which a circle or ellipse is. */
function whole(sweep: number): boolean {
  return Math.abs(Math.abs(sweep) - Math.PI * 2) <= 1e-9;
}

const near = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= DUPLICATE_TOLERANCE;
const same = (a: Point, b: Point) => near([a[0], a[1]], [b[0], b[1]]);
/** A position as text, for the key that finds a duplicate curve. */
const key = (p: readonly number[]) => p.map((v) => v.toFixed(9)).join(',');
/** An ellipse's shape as text, for the key that finds a duplicate curve. */
const ellipseKey = (e: { center: Point; rx: number; ry: number; rotation: number }) =>
  `${key(e.center)} ${e.rx.toFixed(9)} ${e.ry.toFixed(9)} ${e.rotation.toFixed(9)}`;

/** Counts new IDs, for a caller that brings none. */
function counter(): () => string {
  let n = 0;
  return () => `i${n++}`;
}

/** The point of an ellipse at its parameter `t` (in the drawing's own units). */
function ellipsePoint(
  e: { center: Point; rx: number; ry: number; rotation: number },
  t: number,
): Point {
  const cos = Math.cos(e.rotation);
  const sin = Math.sin(e.rotation);
  const x = e.rx * Math.cos(t);
  const y = e.ry * Math.sin(t);
  return [e.center[0] + x * cos - y * sin, e.center[1] + x * sin + y * cos];
}

/** The parameter `p` has on an ellipse (the angle it has on the unit circle). */
function parameterOf(
  e: { center: Point; rx: number; ry: number; rotation: number },
  p: Point,
): number {
  const dx = p[0] - e.center[0];
  const dy = p[1] - e.center[1];
  const cos = Math.cos(e.rotation);
  const sin = Math.sin(e.rotation);
  return Math.atan2((-dx * sin + dy * cos) / e.ry, (dx * cos + dy * sin) / e.rx);
}

/**
 * An arc of an ellipse as cubic Bézier pieces, one per `ELLIPSE_PIECE` radians
 * of parameter at most, running from `t0` through `sweep` (counter-clockwise
 * positive). Each piece is the standard four-pole approximation of a circular
 * arc, put through the ellipse's own map, so it stays about a millionth of the
 * major radius from the curve — inside the 1e-5 the ADR asks for.
 */
export function ellipsePieces(
  e: { center: Point; rx: number; ry: number; rotation: number },
  t0: number,
  sweep: number,
): Vec2[][] {
  const count = Math.max(1, Math.ceil(Math.abs(sweep) / ELLIPSE_PIECE - 1e-9));
  const out: Vec2[][] = [];
  for (let i = 0; i < count; i++) {
    out.push(ellipsePiece(e, t0 + (sweep * i) / count, t0 + (sweep * (i + 1)) / count));
  }
  return out;
}

/** One piece: the four poles of the circular arc between two parameters. */
function ellipsePiece(
  e: { center: Point; rx: number; ry: number; rotation: number },
  from: number,
  to: number,
): Vec2[] {
  // The poles of the unit circle's arc from `from` to `to`: its ends, and a
  // third of the way along each end's tangent (tan of a quarter of the turn).
  const k = (4 / 3) * Math.tan((to - from) / 4);
  const at = (t: number): Vec2 => [Math.cos(t), Math.sin(t)];
  const tangent = (t: number): Vec2 => [-Math.sin(t), Math.cos(t)];
  const [p0, p1] = [at(from), tangent(from)];
  const [p3, p2] = [at(to), tangent(to)];
  const unit: Vec2[] = [
    p0,
    [p0[0] + k * p1[0], p0[1] + k * p1[1]],
    [p3[0] - k * p2[0], p3[1] - k * p2[1]],
    p3,
  ];
  // The ellipse is that circle under its own map, which sends poles to poles.
  return unit.map(([x, y]) => {
    const px = e.rx * x;
    const py = e.ry * y;
    return [
      e.center[0] + px * Math.cos(e.rotation) - py * Math.sin(e.rotation),
      e.center[1] + px * Math.sin(e.rotation) + py * Math.cos(e.rotation),
    ];
  });
}

/** The point of a curve that stands at `at`, when the curve has an end there. */
function endOf(
  entities: Record<SketchEntityId, SketchEntity>,
  curve: SketchEntityId,
  at: Vec2,
): SketchEntityId | undefined {
  const entity = entities[curve];
  const near_ = (id: SketchEntityId | undefined) => {
    if (!id) return undefined;
    const p = entities[id];
    if (p?.type !== 'point') return undefined;
    return Math.hypot(p.x - at[0], p.y - at[1]) <= COINCIDENT_TOLERANCE ? id : undefined;
  };
  switch (entity?.type) {
    case 'line':
      return near_(entity.start) ?? near_(entity.end);
    case 'arc':
      return near_(entity.start) ?? near_(entity.end);
    case 'spline':
      return near_(entity.points[0]) ?? near_(entity.points[entity.points.length - 1]);
    default:
      // A circle and an ellipse have no ends: they join only concentrically,
      // which an import doesn't need (its curves are all at their file places).
      return undefined;
  }
}
