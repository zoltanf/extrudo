import { describe, expect, it } from 'vitest';
import { ellipsePoint, ellipseShape, fitSpline, splinePoint, splinePolyline } from './curves';
import type { Vec2 } from './planes';

const dist = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const close = (a: Vec2, b: Vec2, eps = 1e-9) => {
  expect(a[0]).toBeCloseTo(b[0], -Math.log10(eps));
  expect(a[1]).toBeCloseTo(b[1], -Math.log10(eps));
};

describe('ellipseShape', () => {
  it('reads radii and rotation from the three points', () => {
    const e = ellipseShape([1, 2], [1 + 6 * Math.SQRT1_2, 2 + 6 * Math.SQRT1_2], [-1, 4]);
    expect(e.a).toBeCloseTo(6);
    expect(e.b).toBeCloseTo(2 * Math.SQRT2);
    expect(e.rotation).toBeCloseTo(Math.PI / 4);
    close(ellipsePoint(e, 0), [1 + 6 * Math.SQRT1_2, 2 + 6 * Math.SQRT1_2]);
    close(ellipsePoint(e, Math.PI / 2), [-1, 4]);
  });

  it('takes the minor radius square to the major axis', () => {
    // A minor point off square (before a solve) still gives its distance from the axis.
    expect(ellipseShape([0, 0], [10, 0], [3, 4]).b).toBeCloseTo(4);
  });
});

describe('fitSpline', () => {
  it('passes through every fit point', () => {
    const points: Vec2[] = [
      [0, 0],
      [10, 8],
      [25, 3],
      [30, 20],
      [12, 30],
    ];
    const spline = fitSpline(points);
    expect(spline.degree).toBe(3);
    expect(spline.poles).toHaveLength(points.length);
    expect(spline.knots).toHaveLength(points.length + 4);
    // The fit points sit at the chord-length parameters.
    const lengths = points.slice(1).map((p, i) => dist(p, points[i] as Vec2));
    const total = lengths.reduce((s, l) => s + l, 0);
    let u = 0;
    points.forEach((p, i) => {
      if (i > 0) u += (lengths[i - 1] as number) / total;
      close(splinePoint(spline, Math.min(1, u)), p, 1e-7);
    });
  });

  it('is a line for two points and a parabola for three', () => {
    const line = fitSpline([
      [0, 0],
      [10, 5],
    ]);
    expect(line.degree).toBe(1);
    close(splinePoint(line, 0.5), [5, 2.5]);
    const parabola = fitSpline([
      [0, 0],
      [5, 5],
      [10, 0],
    ]);
    expect(parabola.degree).toBe(2);
    close(splinePoint(parabola, 0.5), [5, 5]);
  });

  it('keeps a straight run straight', () => {
    const spline = fitSpline([
      [0, 0],
      [1, 1],
      [3, 3],
      [4, 4],
    ]);
    for (const p of splinePolyline(spline, 8)) expect(p[0]).toBeCloseTo(p[1]);
  });

  it('survives coincident neighbours', () => {
    const spline = fitSpline([
      [0, 0],
      [5, 5],
      [5, 5],
      [10, 0],
    ]);
    for (const p of splinePolyline(spline)) {
      expect(Number.isFinite(p[0]) && Number.isFinite(p[1])).toBe(true);
    }
  });

  it('samples each knot span evenly and ends on the last point', () => {
    const spline = fitSpline([
      [0, 0],
      [10, 8],
      [25, 3],
      [30, 20],
      [12, 30],
    ]);
    const polyline = splinePolyline(spline, 10);
    // Five points of a cubic: one inner knot, so two spans.
    expect(polyline).toHaveLength(21);
    close(polyline[20] as Vec2, [12, 30], 1e-7);
  });
});
