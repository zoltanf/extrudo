/**
 * A 2D drawing: the format-neutral geometry the SVG and DXF writers take
 * (P1-13). Coordinates are millimetres with y up, as in CAD; the SVG writer
 * flips them. Nothing here knows about sketches: callers map their own
 * curves onto contours of exact segments.
 */

export type Point = readonly [x: number, y: number];

/** One piece of a contour, from the current point to `to`. */
export type Segment =
  | { type: 'line'; to: Point }
  /**
   * A circular arc around `center`, its radius the current point's distance.
   * `sweep` is signed (counter-clockwise positive), up to a full turn.
   */
  | { type: 'arc'; center: Point; sweep: number; to: Point }
  /**
   * An elliptical arc: semi-axes `rx` along the axis at `rotation` (radians)
   * and `ry` across it. It starts at the current point's parameter and runs
   * `sweep` radians of parameter (counter-clockwise positive).
   */
  | {
      type: 'ellipse';
      center: Point;
      rx: number;
      ry: number;
      rotation: number;
      sweep: number;
      to: Point;
    }
  | { type: 'quadratic'; control: Point; to: Point }
  | { type: 'cubic'; c1: Point; c2: Point; to: Point };

/** Connected segments from `start`. A closed contour's last segment ends at `start`. */
export interface Contour {
  start: Point;
  segments: Segment[];
  closed: boolean;
}

export interface Layer {
  name: string;
  /** Stroke (or fill) colour, `#rrggbb`. */
  color: string;
  /** AutoCAD colour index for DXF (7 is black on white, white on black). */
  aci: number;
  dashed?: boolean;
  /** Closed regions: SVG fills them (even-odd, so inner contours are holes). */
  fill?: boolean;
}

/** Contours that belong together: one curve, or a region with its holes. */
export interface Shape {
  layer: string;
  contours: Contour[];
}

export interface Drawing {
  title?: string;
  layers: Layer[];
  shapes: Shape[];
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

// Evaluating segments ----------------------------------------------------------

/** Radians of parameter per step so a chord stays within `tolerance` of a radius-`r` arc. */
function angleStep(radius: number, tolerance: number): number {
  if (radius <= tolerance) return Math.PI / 2;
  return Math.min(Math.PI / 8, 2 * Math.acos(1 - tolerance / radius));
}

/** The parameter of `p` on an ellipse (the angle it has once the ellipse is made a unit circle). */
export function ellipseParam(
  e: { center: Point; rx: number; ry: number; rotation: number },
  p: Point,
): number {
  const dx = p[0] - e.center[0];
  const dy = p[1] - e.center[1];
  const cos = Math.cos(e.rotation);
  const sin = Math.sin(e.rotation);
  const u = dx * cos + dy * sin;
  const v = -dx * sin + dy * cos;
  return Math.atan2(v / (e.ry || 1), u / (e.rx || 1));
}

export function ellipseAt(
  e: { center: Point; rx: number; ry: number; rotation: number },
  t: number,
): Point {
  const cos = Math.cos(e.rotation);
  const sin = Math.sin(e.rotation);
  const x = e.rx * Math.cos(t);
  const y = e.ry * Math.sin(t);
  return [e.center[0] + x * cos - y * sin, e.center[1] + x * sin + y * cos];
}

/** Distance from `p` to the line through `a` and `b`. */
function offLine(p: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  if (len === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  return Math.abs((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / len;
}

function flattenCubic(
  p0: Point,
  c1: Point,
  c2: Point,
  p3: Point,
  tolerance: number,
  out: Point[],
  depth = 0,
): void {
  // Flat enough once both controls are within tolerance of the chord.
  if (depth >= 16 || Math.max(offLine(c1, p0, p3), offLine(c2, p0, p3)) <= tolerance) {
    out.push(p3);
    return;
  }
  const mid = (a: Point, b: Point): Point => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const ab = mid(p0, c1);
  const bc = mid(c1, c2);
  const cd = mid(c2, p3);
  const abc = mid(ab, bc);
  const bcd = mid(bc, cd);
  const m = mid(abc, bcd);
  flattenCubic(p0, ab, abc, m, tolerance, out, depth + 1);
  flattenCubic(m, bcd, cd, p3, tolerance, out, depth + 1);
}

/**
 * The points after `from` along a segment, ending exactly on `to`, with no
 * chord further than `tolerance` (mm) from the curve.
 */
export function flattenSegment(from: Point, segment: Segment, tolerance: number): Point[] {
  switch (segment.type) {
    case 'line':
      return [segment.to];
    case 'arc': {
      const { center, sweep } = segment;
      const r = Math.hypot(from[0] - center[0], from[1] - center[1]);
      const a0 = Math.atan2(from[1] - center[1], from[0] - center[0]);
      const n = Math.max(1, Math.ceil(Math.abs(sweep) / angleStep(r, tolerance)));
      const out: Point[] = [];
      for (let i = 1; i < n; i++) {
        const a = a0 + (sweep * i) / n;
        out.push([center[0] + r * Math.cos(a), center[1] + r * Math.sin(a)]);
      }
      out.push(segment.to);
      return out;
    }
    case 'ellipse': {
      const t0 = ellipseParam(segment, from);
      const r = Math.max(segment.rx, segment.ry);
      const n = Math.max(1, Math.ceil(Math.abs(segment.sweep) / angleStep(r, tolerance)));
      const out: Point[] = [];
      for (let i = 1; i < n; i++) out.push(ellipseAt(segment, t0 + (segment.sweep * i) / n));
      out.push(segment.to);
      return out;
    }
    case 'quadratic': {
      const { control: q, to } = segment;
      const c1: Point = [
        from[0] + (2 / 3) * (q[0] - from[0]),
        from[1] + (2 / 3) * (q[1] - from[1]),
      ];
      const c2: Point = [to[0] + (2 / 3) * (q[0] - to[0]), to[1] + (2 / 3) * (q[1] - to[1])];
      const out: Point[] = [];
      flattenCubic(from, c1, c2, to, tolerance, out);
      return out;
    }
    case 'cubic': {
      const out: Point[] = [];
      flattenCubic(from, segment.c1, segment.c2, segment.to, tolerance, out);
      out[out.length - 1] = segment.to;
      return out;
    }
  }
}

/** A contour as a polyline, its start first (a closed contour ends back on it). */
export function flattenContour(contour: Contour, tolerance: number): Point[] {
  const out: Point[] = [contour.start];
  let at = contour.start;
  for (const segment of contour.segments) {
    out.push(...flattenSegment(at, segment, tolerance));
    at = segment.to;
  }
  return out;
}

/** The bounding box of every shape's curves, or `undefined` for an empty drawing. */
export function drawingBounds(drawing: Drawing): Bounds | undefined {
  let box: Bounds | undefined;
  const add = ([x, y]: Point) => {
    if (!box) box = { minX: x, minY: y, maxX: x, maxY: y };
    else {
      box.minX = Math.min(box.minX, x);
      box.minY = Math.min(box.minY, y);
      box.maxX = Math.max(box.maxX, x);
      box.maxY = Math.max(box.maxY, y);
    }
  };
  for (const shape of drawing.shapes) {
    for (const contour of shape.contours) {
      add(contour.start);
      let at = contour.start;
      for (const segment of contour.segments) {
        segmentExtremes(at, segment).forEach(add);
        at = segment.to;
      }
    }
  }
  return box;
}

/** Points that bound a segment: its end, plus arcs' axis crossings and curves' extrema. */
function segmentExtremes(from: Point, segment: Segment): Point[] {
  switch (segment.type) {
    case 'line':
      return [segment.to];
    case 'arc': {
      const { center, sweep } = segment;
      const r = Math.hypot(from[0] - center[0], from[1] - center[1]);
      const a0 = Math.atan2(from[1] - center[1], from[0] - center[0]);
      const out: Point[] = [segment.to];
      for (let k = -8; k <= 8; k++) {
        const a = (k * Math.PI) / 2;
        const u = (a - a0) / sweep;
        if (sweep !== 0 && u > 0 && u < 1) {
          out.push([center[0] + r * Math.cos(a), center[1] + r * Math.sin(a)]);
        }
      }
      return out;
    }
    case 'ellipse': {
      // Where x or y is extreme: dx/dt = 0 or dy/dt = 0.
      const { rx, ry, rotation, sweep } = segment;
      const t0 = ellipseParam(segment, from);
      const tx = Math.atan2(-ry * Math.sin(rotation), rx * Math.cos(rotation));
      const ty = Math.atan2(ry * Math.cos(rotation), rx * Math.sin(rotation));
      const out: Point[] = [segment.to];
      for (const base of [tx, ty]) {
        for (let k = -6; k <= 6; k++) {
          const t = base + k * Math.PI;
          const u = (t - t0) / sweep;
          if (sweep !== 0 && u > 0 && u < 1) out.push(ellipseAt(segment, t));
        }
      }
      return out;
    }
    case 'quadratic':
    case 'cubic': {
      // Tight enough: the flattened curve at a fine tolerance.
      return flattenSegment(from, segment, 1e-4);
    }
  }
}
