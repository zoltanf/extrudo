import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Contour, Point, Segment } from './drawing';
import { pathContours, readSvg, SvgError, transformOf } from './svg-read';

/** A fixture as text, so the tests read the file the app would (ADR-0066 §1). */
const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

/** The contours of a drawing, in order. */
const contours = (result: ReturnType<typeof readSvg>): Contour[] =>
  result.drawing.shapes.flatMap((shape) => shape.contours);

const kinds = readSvg(fixture('kinds.svg'));

describe('readSvg', () => {
  it('reads a line, a polyline and a polygon, in millimetres with y up', () => {
    // <line x1="0" y1="0" x2="10" y2="0"/> and friends from kinds.svg.
    expect(kinds.units).toBe('mm');
    const [line, polyline, polygon] = contours(kinds);
    expect(line?.start).toEqual([0, 0]);
    expect(line?.segments).toEqual([{ type: 'line', to: [10, 0] }]);
    expect(polyline?.closed).toBe(false);
    expect(polyline?.segments).toEqual([
      { type: 'line', to: [10, -5] },
      { type: 'line', to: [10, -8] },
    ]);
    expect(polygon?.closed).toBe(true);
    expect(polygon?.segments).toEqual([
      { type: 'line', to: [30, 0] },
      { type: 'line', to: [30, -10] },
    ]);
  });

  it('reads a circle as one full turn and an ellipse as one full ellipse', () => {
    const circle = contours(kinds)[3] as Contour;
    expect(circle.segments).toHaveLength(1);
    expect(circle.segments[0]).toMatchObject({
      type: 'arc',
      center: [50, -10],
      sweep: -2 * Math.PI,
    });
    expect((circle.segments[0] as { center: Point }).center[0]).toBeCloseTo(50, 12);
    const ellipse = contours(kinds)[4] as Contour;
    expect(ellipse.segments[0]).toMatchObject({ type: 'ellipse', rx: 8, ry: 3 });
  });

  it('reads a plain rect as four lines and a rounded one as four quarter arcs', () => {
    const rect = contours(kinds)[5] as Contour;
    expect(rect.segments.every((s) => s.type === 'line')).toBe(true);
    expect(rect.start).toEqual([0, -20]);
    const rounded = contours(kinds)[6] as Contour;
    const corners = rounded.segments.filter((s) => s.type === 'ellipse');
    expect(corners).toHaveLength(4);
    for (const corner of corners) {
      // The contour runs counter-clockwise in the file, so the mirror in y
      // turns each quarter of a corner the other way round.
      expect(corner).toMatchObject({ type: 'ellipse', rx: 3, ry: 2, sweep: -Math.PI / 2 });
    }
    // A line between each pair of arcs: (25,-20) → (42,-20) → (45,-28) → (28,-30) → (25,-22).
    const lines = rounded.segments.filter((s) => s.type === 'line').map((s) => s.to);
    expect(lines).toEqual([
      [42, -20],
      [45, -28],
      [28, -30],
      [25, -22],
    ]);
  });

  it('reads every path command, including the shorthands and implicit repeats', () => {
    // M 50 20 h 10 v 10 h -10 z
    const relative = contours(kinds)[7] as Contour;
    expect(relative.start).toEqual([50, -20]);
    expect(relative.closed).toBe(true);
    expect(relative.segments.map((s) => s.to)).toEqual([
      [60, -20],
      [60, -30],
      [50, -30],
      [50, -20],
    ]);
    // C, then S with the control point mirrored from the last C.
    const bezier = contours(kinds)[8] as Contour;
    const first = bezier.segments[0] as Extract<Segment, { type: 'cubic' }>;
    const second = bezier.segments[1] as Extract<Segment, { type: 'cubic' }>;
    expect(first.c1).toEqual([75, -20]);
    expect(first.c2).toEqual([80, -25]);
    expect(first.to).toEqual([80, -30]);
    expect(second.c1).toEqual([80, -35]);
    // Q and T, whose control point mirrors the last Q.
    const quads = contours(kinds)[9] as Contour;
    expect(quads.segments[0]).toMatchObject({ type: 'quadratic', control: [5, -50] });
    expect((quads.segments[1] as Extract<Segment, { type: 'quadratic' }>).control).toEqual([
      15, -30,
    ]);
    // Numbers written without separators, and an exponent.
    const terse = contours(kinds)[11] as Contour;
    expect(terse.segments.map((s) => s.to)).toEqual([
      [1.5, -0.5],
      [2.5, 1],
    ]);
  });

  it('reads an arc command as a circular arc through its endpoints', () => {
    // M 30 40 a5 5 0 0 1 10 0 a5 5 0 1 1 -10 0 z: two half turns of one circle.
    const contour = contours(kinds)[10] as Contour;
    expect(contour.closed).toBe(true);
    // The sweep flag says the parameter turns the positive way in the file's
    // y-down frame; the mirror in y turns each half the other way round.
    const arcs = contour.segments as Extract<Segment, { type: 'arc' }>[];
    expect(arcs).toHaveLength(2);
    for (const arc of arcs) {
      expect(arc.type).toBe('arc');
      expect(arc.sweep).toBeCloseTo(-Math.PI, 12);
      // Both arcs are the same circle of radius 5 about (35, -40).
      expect(arc.center[0]).toBeCloseTo(35, 9);
      expect(arc.center[1]).toBeCloseTo(-40, 9);
      expect(Math.hypot(arc.to[0] - 35, arc.to[1] + 40)).toBeCloseTo(5, 9);
    }
  });

  it('grows an arc whose radii are too small for its endpoints', () => {
    // A half circle of radius 1 written with radii 0.1: the radii grow to 1.
    const [contour] = pathContours('M0 0 A0.1 0.1 0 0 1 2 0');
    const arc = contour?.segments[0];
    expect(arc?.type).toBe('arc');
    if (arc?.type !== 'arc') throw new Error('not an arc');
    expect(arc.center[0]).toBeCloseTo(1, 9);
    expect(arc.center[1]).toBeCloseTo(0, 9);
    expect(Math.abs(arc.sweep)).toBeCloseTo(Math.PI, 9);
  });

  it('composes transforms down the tree', () => {
    const shapes = contours(kinds);
    // translate(0,50) then a plain rect: the group's own rectangle.
    const rect = shapes[12] as Contour;
    expect(rect.start).toEqual([0, -50]);
    expect(rect.segments.map((s) => s.to)).toEqual([
      [10, -50],
      [10, -55],
      [0, -55],
      [0, -50],
    ]);
    // rotate(90 5 2.5) about a point, under the group's translate: the line
    // (0,0) → (10,0) turns to (7.5, 7.5) → (7.5, 47.5) in the file's y-down frame.
    const turned = shapes[13] as Contour;
    expect(turned.start[0]).toBeCloseTo(7.5, 9);
    expect(turned.start[1]).toBeCloseTo(-47.5, 9);
    expect(turned.segments[0]?.to[0]).toBeCloseTo(7.5, 9);
    expect(turned.segments[0]?.to[1]).toBeCloseTo(-57.5, 9);
    // scale(2 1) doesn't keep circles, so the circle becomes an ellipse.
    const squashed = shapes[14] as Contour;
    expect(squashed.segments[0]).toMatchObject({ type: 'ellipse', rx: 4, ry: 2 });
    // matrix(1 0 0 1 30 0) skewX(10): a skewed rectangle.
    const skewed = shapes[15] as Contour;
    expect(skewed.segments.map((s) => s.to)).toEqual([
      [34, -50],
      [34.70530792283386, -54],
      [30.70530792283386, -54],
      [30, -50],
    ]);
  });

  it('counts what it leaves out and skips what is not drawn', () => {
    expect(kinds.skipped).toEqual({ style: 1, text: 1, image: 1, use: 1, defs: 1, clipPath: 1 });
    expect(kinds.drawing.title).toBe('Kinds');
    // The two hidden lines and the `defs` path are not among the contours.
    expect(contours(kinds)).toHaveLength(16);
  });

  it('reads a pixel drawing without a unit at 96 to the inch', () => {
    const pixels = readSvg(fixture('pixels.svg'));
    expect(pixels.units).toBe('px');
    const [rect, circle] = contours(pixels);
    expect(rect?.start).toEqual([0, 0]);
    expect(rect?.segments[0]?.to[0]).toBeCloseTo(25.4, 9);
    const circleStart = (circle?.segments[0] as Extract<Segment, { type: 'arc' }>)?.center;
    expect(circleStart).toBeDefined();
    // The circle's centre is 150 px, 50 px down the page.
    expect(circleStart?.[0]).toBeCloseTo((150 * 25.4) / 96, 9);
    expect(circleStart?.[1]).toBeCloseTo(-((50 * 25.4) / 96), 9);
  });

  it('takes millimetres per user unit from the width and the viewBox', () => {
    // 40 mm wide over a viewBox of 80 user units: half a millimetre per unit.
    const half = readSvg(
      '<svg width="40mm" height="40mm" viewBox="0 0 80 80"><rect x="40" y="20" width="80" height="80"/></svg>',
    );
    expect(half.units).toBe('mm');
    const to = (half.drawing.shapes[0]?.contours[0]?.segments[0] as { to: Point })?.to;
    expect(to?.[0]).toBeCloseTo(60, 9);
    expect(to?.[1]).toBeCloseTo(-10, 9);
  });

  it('refuses a file that has no svg root', () => {
    expect(() => readSvg('<html><body/></html>')).toThrow(SvgError);
    expect(() => readSvg('not xml at all')).toThrow(SvgError);
  });

  it('reads a self-closing root and attribute entities', () => {
    const { drawing } = readSvg(`<svg width="1mm" height="1mm" id="a&amp;b"/>`);
    expect(drawing.layers[0]?.name).toBe('a&b');
  });
});

describe('transformOf', () => {
  it('reads every transform function', () => {
    expect(transformOf('matrix(1 2 3 4 5 6)')).toEqual([1, 2, 3, 4, 5, 6]);
    expect(transformOf('translate(3)')).toEqual([1, 0, 0, 1, 3, 0]);
    expect(transformOf('scale(2, 3)')).toEqual([2, 0, 0, 3, 0, 0]);
    expect(transformOf('skewX(45)')[2]).toBeCloseTo(1, 12);
    expect(transformOf('skewX(45)')[0]).toBe(1);
    expect(transformOf('skewY(45)')[1]).toBeCloseTo(1, 12);
    // rotate(90) then a second rotate(90): a half turn, so x → −x.
    const two = transformOf('rotate(90) rotate(90)');
    expect(two[0]).toBeCloseTo(-1, 12);
    expect(two[1]).toBeCloseTo(0, 12);
    expect(transformOf(undefined)).toEqual([1, 0, 0, 1, 0, 0]);
  });
});
