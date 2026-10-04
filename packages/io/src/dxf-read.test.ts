import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Contour, Segment } from './drawing';
import { bulgeArc, DxfError, readDxf, splineContour, unitsOf } from './dxf-read';

/** A fixture as text, so the tests read the file the app would (ADR-0066 §1). */
const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

/** The contours of a drawing, in order. */
const contours = (result: ReturnType<typeof readDxf>): Contour[] =>
  result.drawing.shapes.flatMap((shape) => shape.contours);

const IN = 25.4;
const rich = readDxf(fixture('rich.dxf'));

describe('readDxf', () => {
  it('reads the unit from $INSUNITS and gives millimetres', () => {
    expect(rich.units).toBe('in');
    // The LINE from (0,0) to (1,0) inches.
    const line = contours(rich)[0];
    expect(line?.start).toEqual([0, 0]);
    expect(line?.segments).toEqual([{ type: 'line', to: [IN, 0] }]);
    expect(
      unitsOf([
        { code: 9, value: '$INSUNITS' },
        { code: 70, value: '6' },
      ]),
    ).toBe('m');
    expect(
      unitsOf([
        { code: 9, value: '$INSUNITS' },
        { code: 70, value: '0' },
      ]),
    ).toBe('unitless');
    expect(unitsOf([])).toBe('unitless');
  });

  it('reads a circle as one full turn and an arc between its angles', () => {
    const circle = contours(rich)[1] as Contour;
    expect(circle.segments[0]).toMatchObject({ type: 'arc' });
    const arc = circle.segments[0] as Extract<Segment, { type: 'arc' }>;
    expect(arc.center[0]).toBeCloseTo(2 * IN, 9);
    expect(arc.sweep).toBeCloseTo(2 * Math.PI, 12);
    // ARC at (3,0) r 0.25 from 0° to 90°: a quarter turn from its start angle.
    const quarter = contours(rich)[2] as Contour;
    const quarterArc = quarter.segments[0] as Extract<Segment, { type: 'arc' }>;
    expect(quarterArc.sweep).toBeCloseTo(Math.PI / 2, 12);
    expect(quarterArc.center[0]).toBeCloseTo(3 * IN, 9);
    expect(quarter.start[0]).toBeCloseTo(3.25 * IN, 9);
    expect(quarter.segments[0]?.to[1]).toBeCloseTo(0.25 * IN, 9);
  });

  it('mirrors an entity extruded in −z in x, and reverses its turn', () => {
    // The second ARC is at (4,0) r 0.25 with the same angles, extruded in −z.
    const mirrored = contours(rich)[3] as Contour;
    const arc = mirrored.segments[0] as Extract<Segment, { type: 'arc' }>;
    expect(arc.center[0]).toBeCloseTo(-4 * IN, 9);
    expect(arc.sweep).toBeCloseTo(-Math.PI / 2, 12);
    expect(mirrored.start[0]).toBeCloseTo(-4.25 * IN, 9);
  });

  it('reads bulges as arcs and the closed flag', () => {
    // The LWPOLYLINE: a square whose first segment bulges a quarter turn.
    const polyline = contours(rich)[4] as Contour;
    expect(polyline.closed).toBe(true);
    expect(polyline.segments[0]?.type).toBe('arc');
    const arc = polyline.segments[0] as Extract<Segment, { type: 'arc' }>;
    expect(arc.sweep).toBeCloseTo(Math.PI / 2, 6);
    // A quarter turn over a chord of 0.4in: the radius is the chord over √2.
    expect(Math.hypot(arc.to[0] - arc.center[0], arc.to[1] - arc.center[1])).toBeCloseTo(
      (0.4 / Math.SQRT2) * IN,
      6,
    );
    expect(polyline.segments).toHaveLength(4);
    // The old POLYLINE is open, with its bulge on the first segment only.
    const old = contours(rich)[5] as Contour;
    expect(old.closed).toBe(false);
    expect(old.segments.map((s) => s.type)).toEqual(['arc', 'line']);
    expect(old.start).toEqual([IN, IN]);
  });

  it('reads a bulge arc from its two vertices', () => {
    // A quarter of the unit circle from (1,0) to (0,1) about the origin.
    const arc = bulgeArc([1, 0], [0, 1], Math.tan(Math.PI / 8)) as Extract<
      Segment,
      { type: 'arc' }
    >;
    expect(arc.center[0]).toBeCloseTo(0, 12);
    expect(arc.center[1]).toBeCloseTo(0, 12);
    expect(arc.sweep).toBeCloseTo(Math.PI / 2, 12);
    // A negative bulge bends the other way.
    const other = bulgeArc([1, 0], [0, 1], -Math.tan(Math.PI / 8)) as Extract<
      Segment,
      { type: 'arc' }
    >;
    expect(other.sweep).toBeCloseTo(-Math.PI / 2, 12);
    expect(other.center[0]).toBeCloseTo(1, 12);
    expect(other.center[1]).toBeCloseTo(1, 12);
    // Bulge 0 is a line.
    expect(bulgeArc([0, 0], [1, 1], 0)).toEqual({ type: 'line', to: [1, 1] });
  });

  it('reads an ellipse from its major axis vector, its ratio and its range', () => {
    // Centre (2,2), major axis vector (0.5,0), ratio 0.5, from 0 to π.
    const ellipse = contours(rich)[6] as Contour;
    const arc = ellipse.segments[0] as Extract<Segment, { type: 'ellipse' }>;
    expect(arc.rx).toBeCloseTo(0.5 * IN, 9);
    expect(arc.ry).toBeCloseTo(0.25 * IN, 9);
    expect(arc.rotation).toBeCloseTo(0, 12);
    expect(arc.sweep).toBeCloseTo(Math.PI, 9);
    expect(ellipse.closed).toBe(false);
    expect(ellipse.start[0]).toBeCloseTo(2.5 * IN, 9);
    expect(ellipse.segments[0]?.to[0]).toBeCloseTo(1.5 * IN, 9);
  });

  it('turns a non-rational spline of degree 3 into exactly its Bézier pieces', () => {
    const spline = contours(rich)[7] as Contour;
    expect(spline.segments).toHaveLength(1);
    expect(spline.start).toEqual([0, 3 * IN]);
    // The poles are the file's control points, unscaled in shape.
    expect(spline.segments[0]).toMatchObject({
      type: 'cubic',
      c1: [0.5 * IN, 3.5 * IN],
      c2: [1.5 * IN, 3.5 * IN],
      to: [2 * IN, 3 * IN],
    });
  });

  it('elevates a degree 2 spline and samples a rational one', () => {
    const quadratic = contours(rich)[8] as Contour;
    const pole = quadratic.segments[0] as Extract<Segment, { type: 'cubic' }>;
    // The quadratic's poles (3,3), (3.5,4), (4,3) two thirds of the way along.
    expect(pole.c1[0]).toBeCloseTo((3 + (2 * 0.5) / 3) * IN, 9);
    expect(pole.c1[1]).toBeCloseTo((3 + (2 * 1) / 3) * IN, 9);
    expect(pole.c2[0]).toBeCloseTo((4 - (2 * 0.5) / 3) * IN, 9);
    expect(pole.c2[1]).toBeCloseTo((3 + (2 * 1) / 3) * IN, 9);
    expect(pole.to).toEqual([4 * IN, 3 * IN]);
    // A rational spline (weights 1, 1.5, 1, 1) can't be Bézier, so it is sampled:
    // 16 pieces per knot span, and the first and last points are the file's ends.
    const rational = contours(rich)[9] as Contour;
    expect(rational.segments).toHaveLength(16);
    expect(rational.start).toEqual([5 * IN, 3 * IN]);
    expect(rational.segments[15]?.to).toEqual([7 * IN, 3 * IN]);
  });

  it('reads a spline with no knots in its file', () => {
    const contour = splineContour([
      { code: 71, value: '2' },
      { code: 10, value: '0' },
      { code: 20, value: '0' },
      { code: 10, value: '1' },
      { code: 20, value: '1' },
      { code: 10, value: '2' },
      { code: 20, value: '0' },
    ]);
    expect(contour.segments).toHaveLength(1);
    expect(contour.start).toEqual([0, 0]);
    expect(contour.segments[0]?.to).toEqual([2, 0]);
  });

  it('expands an INSERT with its position, scale, rotation and copies', () => {
    // The block "tick" is a 0.1in line and a 0.05in circle at its origin, inserted
    // at (1,3) with a scale of 2, a 30° turn and two columns, then again plain.
    const shapes = contours(rich);
    // The first ten are the entities; the inserts follow the POINT at index 10.
    const [line, circle, line2, circle2, plainLine, plainCircle] = shapes.slice(11) as Contour[];
    const cos = Math.cos(Math.PI / 6);
    const sin = Math.sin(Math.PI / 6);
    // First copy: the line's end is (1,3) + 2 × 0.1 × (cos 30°, sin 30°).
    expect(line?.start).toEqual([IN, 3 * IN]);
    expect(line?.segments[0]?.to[0]).toBeCloseTo((1 + 0.2 * cos) * IN, 9);
    expect(line?.segments[0]?.to[1]).toBeCloseTo((3 + 0.2 * sin) * IN, 9);
    // Its circle: centre at the insert, radius twice the block's.
    const arc = circle?.segments[0] as Extract<Segment, { type: 'arc' }>;
    expect(arc?.center[0]).toBeCloseTo(IN, 9);
    // Second copy, 0.3in along the insert's own x axis.
    expect(line2?.start[0]).toBeCloseTo((1 + 0.3 * cos) * IN, 9);
    expect(line2?.start[1]).toBeCloseTo((3 + 0.3 * sin) * IN, 9);
    expect(circle2?.segments[0]?.type).toBe('arc');
    // The plain insert at (2,3): no turn, no scale.
    expect(plainLine?.start).toEqual([2 * IN, 3 * IN]);
    expect(plainLine?.segments[0]?.to[0]).toBeCloseTo(2.1 * IN, 9);
    expect(plainCircle?.segments[0]?.type).toBe('arc');
    expect(shapes).toHaveLength(17);
  });

  it('reads a POINT as nothing to draw, and counts what it leaves out', () => {
    expect(rich.skipped).toEqual({ text: 1, hatch: 1 });
  });

  it('skips an entity extruded in another direction', () => {
    const text = readDxf(
      [
        '0',
        'SECTION',
        '2',
        'ENTITIES',
        '0',
        'LINE',
        '8',
        '0',
        '210',
        '0.0',
        '220',
        '1.0',
        '230',
        '0.0',
        '10',
        '0.0',
        '20',
        '0.0',
        '11',
        '1.0',
        '21',
        '0.0',
        '0',
        'ENDSEC',
        '0',
        'EOF',
      ].join('\n'),
    );
    expect(text.drawing.shapes).toHaveLength(0);
    expect(text.skipped).toEqual({ line: 1 });
  });

  it('refuses a binary DXF', () => {
    expect(() => readDxf('  AutoCAD Binary DXF\r\n ')).toThrow(DxfError);
    expect(() => readDxf('  AutoCAD Binary DXF\r\n ')).toThrow(
      "Binary DXF isn't supported: save it as ASCII DXF.",
    );
  });

  it('reads a closed square in inches', () => {
    const square = readDxf(fixture('square-inches.dxf'));
    expect(square.units).toBe('in');
    const contour = contours(square)[0] as Contour;
    expect(contour.closed).toBe(true);
    expect(contour.start).toEqual([0, 0]);
    expect(contour.segments.map((s) => s.to)).toEqual([
      [IN, 0],
      [IN, IN],
      [0, IN],
      [0, 0],
    ]);
  });
});
