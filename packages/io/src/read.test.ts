import { describe, expect, it } from 'vitest';
import {
  type Contour,
  type Drawing,
  ellipseAt,
  flattenContour,
  type Layer,
  type Point,
  type Segment,
} from './drawing';
import { writeDxf } from './dxf';
import { readDxf } from './dxf-read';
import { writeSvg } from './svg';
import { readSvg } from './svg-read';

/**
 * Round trips (P4-06, ADR-0066 §1): a drawing the writers make and the readers
 * read again. The SVG writer keeps every curve exact, so its drawings come back
 * as the same shapes within the four decimals it writes. The DXF writer has no
 * ellipse and no Bézier (R12), so those come back as polylines within its
 * flattening tolerance, and it writes each stroke segment as its own entity, so
 * a drawing compares as a whole rather than contour by contour.
 */

const INK: Layer = { name: 'Sketch', color: '#000000', aci: 7 };
const FILL: Layer = { name: 'Profiles', color: '#000000', aci: 7, fill: true };
const TAU = 2 * Math.PI;

/** A drawing of one shape per contour. */
function drawing(
  contours: { start: Point; segments: Segment[]; closed?: boolean }[],
  layer = INK,
): Drawing {
  return {
    layers: [layer],
    shapes: contours.map((contour) => ({
      layer: layer.name,
      contours: [{ ...contour, closed: contour.closed ?? false }],
    })),
  };
}

const contoursOf = (result: { drawing: Drawing }) =>
  result.drawing.shapes.flatMap((s) => s.contours);

/** The distance from `p` to the polyline through `points` (point to segment). */
function distanceTo(polyline: readonly Point[], p: Point): number {
  let best = Number.POSITIVE_INFINITY;
  for (let i = 1; i < polyline.length; i++) {
    const a = polyline[i - 1] as Point;
    const b = polyline[i] as Point;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const lengthSquared = dx * dx + dy * dy;
    const t =
      lengthSquared === 0
        ? 0
        : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lengthSquared));
    best = Math.min(best, Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy)));
  }
  return best;
}

const pointsOf = (drawing: Drawing, tolerance: number): Point[] =>
  drawing.shapes.flatMap((shape) => shape.contours.flatMap((c) => flattenContour(c, tolerance)));

/** How far two drawings' shapes are from each other, mm (both ways round). */
function apart(a: Drawing, b: Drawing, tolerance = 1e-3): number {
  const pa = pointsOf(a, tolerance);
  const pb = pointsOf(b, tolerance);
  return Math.max(...pa.map((p) => distanceTo(pb, p)), ...pb.map((p) => distanceTo(pa, p)));
}

/** The cases both writers and readers carry exactly: lines, arcs, circles. */
const EXACT: { start: Point; segments: Segment[] }[] = [
  {
    start: [0, 0],
    segments: [
      { type: 'line', to: [40, 0] },
      { type: 'line', to: [40, 20] },
    ],
  },
  // A quarter turn from (30,10) to (20,20) about (20,10).
  {
    start: [30, 10],
    segments: [{ type: 'arc', center: [20, 10], sweep: Math.PI / 2, to: [20, 20] }],
  },
  { start: [5, 5], segments: [{ type: 'arc', center: [0, 0], sweep: TAU, to: [5, 5] }] },
  { start: [30, 30], segments: [{ type: 'arc', center: [20, 30], sweep: -TAU, to: [30, 30] }] },
];
const TILTED = { center: [20, 10] as Point, rx: 20, ry: 8, rotation: 0.4 };
const ROUND = { center: [10, 10] as Point, rx: 10, ry: 4, rotation: 0 };
/** The cases only SVG keeps: ellipses, and Béziers of both degrees. */
const CURVES: { start: Point; segments: Segment[] }[] = [
  {
    start: ellipseAt(TILTED, 0),
    segments: [{ type: 'ellipse', ...TILTED, sweep: TAU, to: ellipseAt(TILTED, 0) }],
  },
  {
    start: ellipseAt(ROUND, 0),
    segments: [
      { type: 'ellipse', ...ROUND, sweep: Math.PI / 2, to: ellipseAt(ROUND, Math.PI / 2) },
    ],
  },
  { start: [0, 0], segments: [{ type: 'cubic', c1: [10, 30], c2: [30, -30], to: [40, 0] }] },
  { start: [0, 0], segments: [{ type: 'quadratic', control: [20, 20], to: [40, 0] }] },
];

/** A closed contour with four sides and a rounded corner. */
const CLOSED: Contour = {
  start: [0, 0],
  segments: [
    { type: 'line', to: [15, 0] },
    // A quarter turn about (15,5) from (15,0) to (20,5).
    { type: 'arc', center: [15, 5], sweep: Math.PI / 2, to: [20, 5] },
    { type: 'line', to: [0, 5] },
    { type: 'line', to: [0, 0] },
  ],
  closed: true,
};

/**
 * How close a shape comes back. SVG spells an arc as its two endpoints and its
 * radii, so a radius rounded to 0.1 µm makes the arc a little longer than a
 * half turn and moves its centre a hundredth of a millimetre: that is the
 * format's own limit, not the reader's. Lines and Béziers are written as
 * coordinates, so they come back to the writer's four decimals.
 */
const SVG_EXACT = 1e-3;
const SVG_ARCS = 5e-2;

describe('SVG round trip', () => {
  it("brings lines and Béziers back to the writer's four decimals", () => {
    const straight = [EXACT[0] as Contour, ...CURVES.slice(2)];
    const original = drawing(straight);
    const back = readSvg(writeSvg(original)).drawing;
    expect(contoursOf({ drawing: back })).toHaveLength(straight.length);
    expect(apart(original, back)).toBeLessThan(SVG_EXACT);
  });

  it("brings arcs and circles back within the format's own accuracy", () => {
    const original = drawing(EXACT.slice(1));
    const back = readSvg(writeSvg(original)).drawing;
    expect(contoursOf({ drawing: back })).toHaveLength(EXACT.length - 1);
    expect(apart(original, back)).toBeLessThan(SVG_ARCS);
  });

  it("brings ellipses back within the format's own accuracy", () => {
    const original = drawing(CURVES.slice(0, 2));
    const back = readSvg(writeSvg(original)).drawing;
    expect(contoursOf({ drawing: back })).toHaveLength(2);
    expect(apart(original, back)).toBeLessThan(SVG_ARCS);
  });

  it('keeps circles circles and the rest its own kind', () => {
    const kinds = contoursOf({
      drawing: readSvg(writeSvg(drawing(EXACT.concat(CURVES)))).drawing,
    }).map((c) => c.segments.map((s) => s.type));
    // Two lines; a quarter turn; then the two circles as two half turns each,
    // then the ellipse, its quarter, a cubic Bézier and a quadratic one.
    expect(kinds).toEqual([
      ['line', 'line'],
      ['arc'],
      ['arc', 'arc'],
      ['arc', 'arc'],
      ['ellipse', 'ellipse'],
      ['ellipse'],
      ['cubic'],
      ['quadratic'],
    ]);
  });

  it("keeps a fill layer's closed contour closed", () => {
    const back = contoursOf(readSvg(writeSvg(drawing([CLOSED], FILL))));
    expect(back[0]?.closed).toBe(true);
    expect(back[0]?.segments).toHaveLength(4);
  });
});

describe('DXF round trip', () => {
  it('brings lines, arcs and circles back', () => {
    const original = drawing(EXACT);
    const back = readDxf(writeDxf(original)).drawing;
    // Each stroke segment is its own entity, so the segments come back apart.
    expect(apart(original, back, 1e-5)).toBeLessThan(1e-5);
    const kinds = contoursOf({ drawing: back }).map((c) => c.segments[0]?.type);
    expect(kinds).toEqual(['line', 'line', 'arc', 'arc', 'arc']);
  });

  it('brings a closed contour back closed, as one fill polyline', () => {
    const original = drawing([CLOSED], FILL);
    const back = contoursOf(readDxf(writeDxf(original)));
    expect(back).toHaveLength(1);
    expect(back[0]?.closed).toBe(true);
    // Four sides, the second one an arc (the bulge at the vertex before it).
    expect(back[0]?.segments).toHaveLength(4);
    expect(back[0]?.segments.map((s) => s.type)).toEqual(['line', 'arc', 'line', 'line']);
    expect(
      apart(original, {
        layers: [FILL],
        shapes: back.map((c) => ({ layer: FILL.name, contours: [c] })),
      }),
    ).toBeLessThan(1e-5);
    // On a stroke layer each segment is an entity of its own, so none is closed.
    const strokes = contoursOf(readDxf(writeDxf(drawing([CLOSED]))));
    expect(strokes.every((c) => !c.closed)).toBe(true);
  });

  it('flattens an ellipse and Béziers into polylines, as R12 has to', () => {
    // The DXF writer's own flattening tolerance is 0.002 mm.
    for (const contour of CURVES) {
      const back = readDxf(writeDxf(drawing([contour]))).drawing;
      const read = contoursOf({ drawing: back });
      expect(read).toHaveLength(1);
      expect(read[0]?.segments.length).toBeGreaterThan(1);
      expect(read[0]?.segments.every((s) => s.type === 'line')).toBe(true);
      expect(apart(drawing([contour]), back)).toBeLessThan(5e-3);
    }
  });
});
