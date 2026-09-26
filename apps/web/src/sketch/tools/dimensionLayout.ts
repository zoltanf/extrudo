/**
 * How a sketch dimension is drawn (P1-07, FR-SK-08, UI spec §4). Pure, so it
 * is unit-tested; `DimensionLabels.tsx` and the Dimension tool's preview
 * draw the result.
 *
 * Everything is in sketch mm. The label sits at the dimension's anchor
 * (`dimensionAnchor`) plus its stored offset, or at a default spot `gap`
 * mm away. A linear dimension's line runs through the label, square to the
 * measured direction, with extension lines from the geometry; a radius or
 * a diameter runs from the center towards the label; an angle is an arc
 * around where the lines cross, through the label.
 */
import {
  CIRCLE_SEGMENTS,
  dimensionAnchor,
  distanceEnds,
  type LengthUnit,
  lineCrossing,
  lineEnds,
  radiusOf,
  type SketchData,
  type SketchDimension,
  UNITS,
  type Vec2,
} from '@extrudo/core';

export interface DimensionShape {
  /** Dimension and extension lines. */
  lines: (readonly [Vec2, Vec2])[];
  /** An angle's arc, as a polyline. */
  arcs: Vec2[][];
  /** Arrowheads: where the tip is and which way it points (unit vector). */
  arrows: { tip: Vec2; dir: Vec2 }[];
  /** The label's center. */
  label: Vec2;
}

/** How far extension lines reach past the dimension line, as a share of `gap`. */
const OVERSHOOT = 0.2;

/**
 * The shape of `d`, or undefined if its geometry is missing. `gap` (mm) is
 * the default distance of a label from its geometry: about 30 px on screen.
 */
export function dimensionShape(
  sketch: SketchData,
  d: SketchDimension,
  gap: number,
): DimensionShape | undefined {
  const anchor = dimensionAnchor(sketch, d);
  if (!anchor) return undefined;
  const label = (fallback: Vec2): Vec2 =>
    d.label ? [anchor[0] + d.label.x, anchor[1] + d.label.y] : fallback;
  switch (d.type) {
    case 'distance': {
      const ends = distanceEnds(sketch, d);
      if (!ends) return undefined;
      const [p, q] = ends;
      const u: Vec2 =
        d.orientation === 'horizontal'
          ? [1, 0]
          : d.orientation === 'vertical'
            ? [0, 1]
            : (unit(sub(q, p)) ?? [1, 0]);
      let n: Vec2 = [-u[1], u[0]];
      // By default the label goes above (or left of) the geometry, like constraint glyphs.
      if (n[1] < -1e-9 || (Math.abs(n[1]) <= 1e-9 && n[0] > 0)) n = [-n[0], -n[1]];
      const at = label(add(anchor, scale(n, gap)));
      return linear(p, q, u, n, at, gap);
    }
    case 'radius':
    case 'diameter': {
      const r = radiusOf(sketch, d.curve);
      if (r === undefined) return undefined;
      const at = label(add(anchor, scale([Math.SQRT1_2, Math.SQRT1_2], r + gap)));
      const dir = unit(sub(at, anchor)) ?? [Math.SQRT1_2, Math.SQRT1_2];
      const tip = add(anchor, scale(dir, r));
      const reach = Math.hypot(...sub(at, anchor));
      const far = reach > r ? at : tip;
      if (d.type === 'radius') {
        return {
          lines: [[anchor, far]],
          arcs: [],
          arrows: [{ tip, dir }],
          label: at,
        };
      }
      const back = sub(anchor, scale(dir, r));
      return {
        lines: [[back, far]],
        arcs: [],
        arrows: [
          { tip, dir },
          { tip: back, dir: scale(dir, -1) },
        ],
        label: at,
      };
    }
    case 'angle': {
      const a = lineEnds(sketch, d.a);
      const b = lineEnds(sketch, d.b);
      if (!a || !b) return undefined;
      const vertex = lineCrossing(a, b);
      const da = unit(sub(a[1], a[0]));
      const db = unit(sub(b[1], b[0]));
      if (!vertex || !da || !db) return { lines: [], arcs: [], arrows: [], label: label(anchor) };
      const sign = d.supplement ? -1 : 1;
      const bisector = unit(add(da, scale(db, sign))) ?? [-da[1], da[0]];
      const at = label(add(vertex, scale(bisector, gap * 2)));
      // Which of the two sectors with this angle the label is in: its side of line b.
      const [x] = inBasis(sub(at, vertex), da, db);
      const sa = x < 0 ? -1 : 1;
      const ra = scale(da, sa);
      const rb = scale(db, sa * sign);
      const radius = Math.max(Math.hypot(...sub(at, vertex)), 1e-9);
      const from = Math.atan2(ra[1], ra[0]);
      let sweep = Math.atan2(rb[1], rb[0]) - from;
      while (sweep > Math.PI) sweep -= 2 * Math.PI;
      while (sweep < -Math.PI) sweep += 2 * Math.PI;
      const steps = Math.max(2, Math.ceil((Math.abs(sweep) / (2 * Math.PI)) * CIRCLE_SEGMENTS));
      const arc: Vec2[] = [];
      for (let i = 0; i <= steps; i++) {
        const t = from + (sweep * i) / steps;
        arc.push([vertex[0] + radius * Math.cos(t), vertex[1] + radius * Math.sin(t)]);
      }
      const turn = Math.sign(sweep) || 1;
      const lines: (readonly [Vec2, Vec2])[] = [];
      for (const [ray, ends] of [
        [ra, a],
        [rb, b],
      ] as const) {
        const reach = Math.max(...ends.map((p) => dot(sub(p, vertex), ray)));
        if (reach < radius) {
          lines.push([
            add(vertex, scale(ray, Math.max(reach, 0))),
            add(vertex, scale(ray, radius + gap * OVERSHOOT)),
          ]);
        }
      }
      return {
        lines,
        arcs: [arc],
        arrows: [
          { tip: add(vertex, scale(ra, radius)), dir: scale([-ra[1], ra[0]], -turn) },
          { tip: add(vertex, scale(rb, radius)), dir: scale([-rb[1], rb[0]], turn) },
        ],
        label: at,
      };
    }
  }
}

/** A linear dimension between `p` and `q`, measured along `u`, its line through `at`. */
function linear(p: Vec2, q: Vec2, u: Vec2, n: Vec2, at: Vec2, gap: number): DimensionShape {
  const lines: (readonly [Vec2, Vec2])[] = [];
  const hp = dot(sub(at, p), n);
  const hq = dot(sub(at, q), n);
  const p2 = add(p, scale(n, hp));
  const q2 = add(q, scale(n, hq));
  const over = gap * OVERSHOOT;
  for (const [from, h, to] of [
    [p, hp, p2],
    [q, hq, q2],
  ] as const) {
    if (Math.abs(h) > 1e-9) lines.push([from, add(to, scale(n, Math.sign(h) * over))]);
  }
  // The dimension line, reaching out to the label when it sits beyond the ends.
  const t = (x: Vec2) => dot(sub(x, p2), u);
  const ts = [0, t(q2), t(at)];
  const lo = Math.min(...ts);
  const hi = Math.max(...ts);
  lines.push([add(p2, scale(u, lo)), add(p2, scale(u, hi))]);
  const inward = t(q2) >= 0 ? 1 : -1;
  return {
    lines,
    arcs: [],
    arrows:
      Math.abs(t(q2)) > 1e-9
        ? [
            { tip: p2, dir: scale(u, -inward) },
            { tip: q2, dir: scale(u, inward) },
          ]
        : [],
    label: at,
  };
}

/**
 * Where a label goes when placed at `cursor` (sketch mm), as the offset the
 * schema stores (from the anchor).
 */
export function labelOffset(
  sketch: SketchData,
  d: SketchDimension,
  cursor: Vec2,
): { x: number; y: number } | undefined {
  const anchor = dimensionAnchor(sketch, d);
  return anchor && { x: cursor[0] - anchor[0], y: cursor[1] - anchor[1] };
}

const PLAIN_NUMBER = /^\s*[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?\s*(mm|cm|m|in|ft|deg|°)?\s*$/i;

/**
 * A dimension's label text (UI spec §4): the value at the document
 * precision, lengths in the document unit without the unit, "R" before a
 * radius, "⌀" before a diameter, "°" after an angle; "fx: " when the value
 * comes from an expression, and parentheses around a driven dimension.
 */
export function dimensionText(
  d: SketchDimension,
  value: number | undefined,
  settings: { units: LengthUnit; precision: number },
): string {
  if (value === undefined) return '?';
  const factor = d.type === 'angle' ? 1 : (UNITS[settings.units]?.factor ?? 1);
  let text = (value / factor).toFixed(settings.precision);
  if (/^-0\.?0*$/.test(text)) text = text.slice(1);
  if (d.type === 'radius') text = `R${text}`;
  else if (d.type === 'diameter') text = `⌀${text}`;
  else if (d.type === 'angle') text = `${text}°`;
  if (d.driven) return `(${text})`;
  return PLAIN_NUMBER.test(d.expr) ? text : `fx: ${text}`;
}

/** Coordinates of `v` in the basis (a, b). */
function inBasis(v: Vec2, a: Vec2, b: Vec2): [number, number] {
  const det = a[0] * b[1] - a[1] * b[0];
  if (Math.abs(det) < 1e-12) return [1, 1];
  return [(v[0] * b[1] - v[1] * b[0]) / det, (a[0] * v[1] - a[1] * v[0]) / det];
}

const add = (a: Vec2, b: Vec2): Vec2 => [a[0] + b[0], a[1] + b[1]];
const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];
const scale = (a: Vec2, k: number): Vec2 => [a[0] * k, a[1] * k];
const dot = (a: Vec2, b: Vec2) => a[0] * b[0] + a[1] * b[1];

function unit(v: Vec2): Vec2 | undefined {
  const len = Math.hypot(v[0], v[1]);
  return len > 1e-12 ? [v[0] / len, v[1] / len] : undefined;
}
