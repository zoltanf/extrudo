import { describe, expect, it } from 'vitest';
import {
  type BSpline,
  CIRCLE_SEGMENTS,
  CONIC_MAX_PIECES,
  CONIC_TOLERANCE,
  closedControlSpline,
  closedFitSpline,
  conicPoint,
  conicSpline,
  controlSpline,
  curvePolyline,
  ellipsePoint,
  ellipseShape,
  fitControlPoles,
  fitSpline,
  insertKnot,
  normalizeSpline,
  splineCurve,
  splineDerivative,
  splinePoint,
  splinePolyline,
  splineRange,
  splitSpline,
} from './curves';
import type { Vec2 } from './planes';
import type { SketchData, SketchSpline } from './schema';

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

describe('curvePolyline', () => {
  const data = {
    entities: {
      c: { type: 'point', x: 0, y: 0 },
      s: { type: 'point', x: 10, y: 0 },
      e: { type: 'point', x: 0, y: 10 },
      m: { type: 'point', x: 0, y: 5 },
      arc: { type: 'arc', center: 'c', start: 's', end: 'e', construction: false },
      line: { type: 'line', start: 's', end: 'e', construction: false },
      circle: { type: 'circle', center: 'c', radius: 3, construction: false },
      oval: { type: 'ellipse', center: 'c', major: 's', minor: 'm', construction: false },
      spline: { type: 'spline', points: ['s', 'm', 'e'], construction: false },
      broken: { type: 'line', start: 's', end: 'zz', construction: false },
    },
    constraints: {},
    dimensions: {},
  } as unknown as SketchData;
  const of = (id: string) => {
    const entity = data.entities[id as keyof typeof data.entities];
    return entity && curvePolyline(data, entity);
  };

  it('gives lines their two points and arcs a counter-clockwise run', () => {
    expect(of('line')).toEqual([
      [10, 0],
      [0, 10],
    ]);
    const arc = of('arc') ?? [];
    expect(arc).toHaveLength(CIRCLE_SEGMENTS / 4 + 1);
    close(arc[0] as Vec2, [10, 0]);
    close(arc.at(-1) as Vec2, [0, 10]);
    close(arc[CIRCLE_SEGMENTS / 8] as Vec2, [10 * Math.SQRT1_2, 10 * Math.SQRT1_2]);
  });

  it('closes circles and ellipses on their first point', () => {
    for (const id of ['circle', 'oval']) {
      const line = of(id) ?? [];
      expect(line).toHaveLength(CIRCLE_SEGMENTS + 1);
      close(line[0] as Vec2, line.at(-1) as Vec2);
    }
    close((of('oval') ?? [])[CIRCLE_SEGMENTS / 4] as Vec2, [0, 5]);
  });

  it('runs splines through their fit points, and skips points and broken curves', () => {
    const spline = of('spline') ?? [];
    close(spline[0] as Vec2, [10, 0]);
    close(spline.at(-1) as Vec2, [0, 10]);
    expect(of('c')).toBeUndefined();
    expect(of('broken')).toBeUndefined();
  });
});

describe('controlSpline', () => {
  it('is a clamped B-spline of the poles it is given', () => {
    const poles: Vec2[] = [
      [0, 0],
      [10, 20],
      [25, 3],
      [30, 20],
      [12, 30],
      [-5, 14],
    ];
    const spline = controlSpline(poles);
    expect(spline.degree).toBe(3);
    expect(spline.poles).toEqual(poles);
    expect(spline.knots).toHaveLength(poles.length + 4);
    // Clamped: degree + 1 zeros, then uniform interior knots, then degree + 1 ones.
    expect(spline.knots.slice(0, 4)).toEqual([0, 0, 0, 0]);
    expect(spline.knots.slice(-4)).toEqual([1, 1, 1, 1]);
    const interior = [...new Set(spline.knots)].slice(1, -1);
    expect(interior).toEqual([1 / 3, 2 / 3]);
    // It starts on the first pole, ends on the last, and is tangent to the
    // control polygon there.
    close(splinePoint(spline, 0), poles[0] as Vec2);
    close(splinePoint(spline, 1), poles.at(-1) as Vec2);
    const start = splinePoint(spline, 0.001);
    const end = splinePoint(spline, 0.999);
    const leg = (from: Vec2, to: Vec2, at: Vec2) => {
      const d = dist(to, from);
      return (
        Math.abs((at[0] - from[0]) * (to[1] - from[1]) - (at[1] - from[1]) * (to[0] - from[0])) / d
      );
    };
    expect(leg(poles[0] as Vec2, poles[1] as Vec2, start)).toBeLessThan(1e-3);
    expect(leg(poles.at(-1) as Vec2, poles.at(-2) as Vec2, end)).toBeLessThan(1e-3);
  });

  it('is a line for two poles and a quadratic for three', () => {
    const line = controlSpline([
      [0, 0],
      [10, 5],
    ]);
    expect(line.degree).toBe(1);
    expect(line.knots).toEqual([0, 0, 1, 1]);
    close(splinePoint(line, 0.5), [5, 2.5]);
    const parabola = controlSpline([
      [0, 0],
      [5, 5],
      [10, 0],
    ]);
    expect(parabola.degree).toBe(2);
    expect(parabola.knots).toEqual([0, 0, 0, 1, 1, 1]);
    // The middle pole pulls the curve off the straight line, but it keeps both ends.
    close(splinePoint(parabola, 0.5), [5, 2.5]);
    close(splinePoint(parabola, 0), [0, 0]);
    close(splinePoint(parabola, 1), [10, 0]);
  });
});

describe('conicPoint', () => {
  const start: Vec2 = [0, 0];
  const shoulder: Vec2 = [30, 40];
  const end: Vec2 = [60, 0];

  it('runs from the start through the shoulder point to the end', () => {
    for (const rho of [0.1, 0.3, 0.5, 0.7, 0.9]) {
      close(conicPoint(start, shoulder, end, rho, 0), start, 1e-12);
      close(conicPoint(start, shoulder, end, rho, 1), end, 1e-12);
      // A conic is not its shoulder point: the weight decides how near it gets.
      // At t = 0.5 its height is rho of the shoulder's.
      const middle = conicPoint(start, shoulder, end, rho, 0.5);
      expect(middle[0]).toBeCloseTo(30, 6);
      expect(middle[1]).toBeCloseTo(rho * shoulder[1], 6);
      // The fuller the conic, the nearer the shoulder it comes.
    }
    // The fuller the conic, the nearer the shoulder it comes.
    expect(conicPoint(start, shoulder, end, 0.9, 0.5)[1]).toBeGreaterThan(
      conicPoint(start, shoulder, end, 0.1, 0.5)[1] as number,
    );
  });

  it('is a parabola at rho 0.5, whose middle is the quadratic Bézier at t = 0.5', () => {
    // Weights 1, 1, 1: the midpoint is (start + 2·shoulder + end) / 4.
    const middle = conicPoint(start, shoulder, end, 0.5, 0.5);
    close(
      middle,
      [(start[0] + 2 * shoulder[0] + end[0]) / 4, (start[1] + 2 * shoulder[1] + end[1]) / 4],
      1e-12,
    );
    expect(middle[1]).toBeCloseTo(20, 12);
  });

  it('swings out for a small rho and stays near the shoulder for a large one', () => {
    const at = (rho: number) => conicPoint(start, shoulder, end, rho, 0.25)[1] as number;
    expect(at(0.1)).toBeLessThan(at(0.5));
    expect(at(0.9)).toBeGreaterThan(at(0.5));
  });
});

describe('conicSpline', () => {
  const start: Vec2 = [0, 0];
  const shoulder: Vec2 = [30, 40];
  const end: Vec2 = [60, 0];
  /** How far a conic's curve runs from the exact one, sampled at `samples` parameters. */
  const errorOf = (rho: number, samples = 200) => {
    const spline = conicSpline(start, shoulder, end, rho);
    let worst = 0;
    for (let i = 0; i <= samples; i++) {
      const t = i / samples;
      worst = Math.max(
        worst,
        dist(splinePoint(spline, t), conicPoint(start, shoulder, end, rho, t)),
      );
    }
    return { worst, spline };
  };
  /** The interior knots of a double-knot spline, in order. */
  const spans = (spline: BSpline) => [...new Set(spline.knots)].slice(1, -1);

  it('stays within a hundredth of a micron of the exact conic, at every rho', () => {
    for (const rho of [0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95]) {
      const { worst, spline } = errorOf(rho);
      expect(worst, `rho ${rho}`).toBeLessThan(CONIC_TOLERANCE);
      // A spline of k pieces has 2k + 2 poles and 2k + 6 knots, and the
      // subdivision stays inside the budget.
      const pieces = spans(spline).length + 1;
      expect(pieces, `rho ${rho}`).toBeLessThanOrEqual(CONIC_MAX_PIECES);
      expect(spline.poles.length).toBe(2 * pieces + 2);
      expect(spline.knots.length).toBe(spline.poles.length + 4);
    }
  });

  it("draws a conic's polyline with few points, its pieces being short", () => {
    // Four segments per span, and never fewer than 96 in all (ADR-0063): a
    // full conic is drawn and picked in well under 600 points, a one-span
    // parabola still smooth. Fit-point and control-point splines keep sixteen
    // segments per span.
    const drawn = (mode: 'fit' | 'conic', rho?: number) => {
      const entity: SketchSpline = {
        type: 'spline',
        points: ['a', 'b', 'c'],
        ...(mode === 'conic' ? { mode: 'conic', rho } : {}),
        construction: false,
      } as SketchSpline;
      const data = {
        entities: {
          a: { type: 'point', x: 0, y: 0 },
          b: { type: 'point', x: 15, y: 20 },
          c: { type: 'point', x: 30, y: 0 },
          s: entity,
        },
        constraints: {},
        dimensions: {},
      } as unknown as SketchData;
      return curvePolyline(data, entity) as Vec2[];
    };
    const pieces = (rho: number) => spans(conicSpline([0, 0], [15, 20], [30, 0], rho)).length + 1;
    for (const rho of [0.3, 0.7, 0.95]) {
      expect(drawn('conic', rho), `rho ${rho}`).toHaveLength(4 * pieces(rho) + 1);
      expect(drawn('conic', rho).length).toBeLessThan(600);
    }
    // A one-span parabola still gets the 96 segments that make it look round.
    expect(pieces(0.5)).toBe(1);
    expect(drawn('conic', 0.5)).toHaveLength(97);
    // A fit-point spline keeps sixteen segments per span (three fit points are
    // one quadratic, a single span).
    expect(drawn('fit')).toHaveLength(16 + 1);
  });

  it('is one Bézier span for rho 0.5, the parabola', () => {
    const spline = conicSpline(start, shoulder, end, 0.5);
    expect(spline.degree).toBe(3);
    expect(spline.knots).toEqual([0, 0, 0, 0, 1, 1, 1, 1]);
    expect(spline.poles).toHaveLength(4);
    // The quadratic Bézier raised to degree 3, so the exact parabola.
    for (const t of [0.1, 0.25, 0.5, 0.75, 0.9]) {
      close(splinePoint(spline, t), conicPoint(start, shoulder, end, 0.5, t), 1e-9);
    }
  });

  it("puts double interior knots at the pieces' parameters, exact at every join", () => {
    const rho = 0.7;
    const spline = conicSpline(start, shoulder, end, rho);
    const ts = spans(spline);
    expect(ts.length).toBeGreaterThan(2);
    // The pieces are not evenly spaced: they are finer where the curve swings.
    const widths = ts.map((t, i) => t - (i === 0 ? 0 : (ts[i - 1] as number)));
    const sizes = new Set(widths.map((w) => w.toFixed(6)));
    expect(sizes.size).toBeGreaterThan(2);
    expect(Math.min(...widths)).toBeLessThan(Math.max(...widths));
    // Each interior knot is there twice, which is C1, and its two copies are a
    // piece's parameter (never the clamped 0 or 1).
    for (let i = 4; i < spline.knots.length - 4; i += 2) {
      expect(spline.knots[i]).toBe(spline.knots[i + 1]);
      expect(ts).toContain(spline.knots[i] as number);
    }
    const poles = spline.poles;
    for (let j = 1; j < ts.length; j++) {
      // Join j sits at the (j - 1)-th interior knot, between the poles 2j and
      // 2j + 1: the piece before it keeps its middle two, the piece after it
      // brings its.
      const t = ts[j - 1] as number;
      const left = (ts[j - 2] ?? 0) as number;
      const right = (ts[j] ?? 1) as number;
      // At the join the spline is the exact conic.
      const at = splinePoint(spline, t);
      const exact = conicPoint(start, shoulder, end, rho, t);
      expect(Math.hypot(at[0] - exact[0], at[1] - exact[1])).toBeLessThan(1e-12);
      // And the join point the pieces dropped is the two poles either side of
      // it, weighted by their spans: the chain's tangents are the exact
      // derivative times each span, which is what makes that combination hold.
      const h1 = t - left;
      const h2 = right - t;
      const before = poles[2 * j] as Vec2;
      const after = poles[2 * j + 1] as Vec2;
      const join: Vec2 = [
        (h2 * before[0] + h1 * after[0]) / (h1 + h2),
        (h2 * before[1] + h1 * after[1]) / (h1 + h2),
      ];
      expect(Math.hypot(join[0] - exact[0], join[1] - exact[1])).toBeLessThan(1e-12);
    }
  });

  it('ends on the two end points, tangent at the shoulder', () => {
    for (const rho of [0.2, 0.5, 0.8]) {
      const spline = conicSpline(start, shoulder, end, rho);
      close(splinePoint(spline, 0), start, 1e-9);
      close(splinePoint(spline, 1), end, 1e-9);
      // The end tangents point at the shoulder, like the exact conic's.
      const near = splinePoint(spline, 0.0005);
      const last = splinePoint(spline, 0.9995);
      const leg = (from: Vec2, to: Vec2, at: Vec2) => {
        const d = dist(to, from);
        return (
          Math.abs((at[0] - from[0]) * (to[1] - from[1]) - (at[1] - from[1]) * (to[0] - from[0])) /
          d
        );
      };
      expect(leg(start, shoulder, near)).toBeLessThan(1e-2);
      expect(leg(end, shoulder, last)).toBeLessThan(1e-2);
    }
  });

  it('stops at the piece cap only for a degenerate conic', () => {
    // The fullest conic the UI allows (rho 0.95) needs 144 of the 160 pieces,
    // so nothing ordinary hits the cap; a rho at the very edge of the schema
    // (rho → 1, where the weight runs away) does, and then the curve is
    // whatever the pieces it got make it.
    expect(spans(conicSpline(start, shoulder, end, 0.95)).length + 1).toBe(144);
    const { spline } = errorOf(0.999999);
    const pieces = spans(spline).length + 1;
    expect(pieces).toBeLessThanOrEqual(CONIC_MAX_PIECES);
    expect(spline.poles.length).toBe(2 * pieces + 2);
  });

  it('scales with the curve: the tolerance is in mm, not in pieces', () => {
    const small = conicSpline([0, 0], [1.5, 2], [3, 0], 0.5);
    expect(small.poles).toHaveLength(4);
    let worst = 0;
    for (let i = 0; i <= 200; i++) {
      const t = i / 200;
      worst = Math.max(
        worst,
        dist(splinePoint(small, t), conicPoint([0, 0], [1.5, 2], [3, 0], 0.5, t)),
      );
    }
    expect(worst).toBeLessThan(CONIC_TOLERANCE);
  });
});

describe('splineCurve', () => {
  const points: Vec2[] = [
    [0, 0],
    [10, 20],
    [25, 3],
  ];
  const at = (entity: Partial<SketchSpline>) =>
    splineCurve(
      { type: 'spline', points: ['a', 'b', 'c'], construction: false, ...entity } as SketchSpline,
      points,
    );

  it('reads the mode off the entity', () => {
    // No mode is a fit-point spline (P1-05 files).
    expect(at({}).poles).toEqual(fitSpline(points).poles);
    expect(at({ mode: 'fit' }).poles).toEqual(fitSpline(points).poles);
    expect(at({ mode: 'control' }).poles).toEqual(controlSpline(points).poles);
    expect(at({ mode: 'conic', rho: 0.5 }).poles).toEqual(
      conicSpline(points[0] as Vec2, points[1] as Vec2, points[2] as Vec2, 0.5).poles,
    );
    // A conic without a rho (which the schema refuses) falls back to a fit spline.
    expect(at({ mode: 'conic' }).poles).toEqual(fitSpline(points).poles);
  });
});

describe('fitControlPoles (P4-12)', () => {
  const nearest = (spline: BSpline, p: Vec2) => {
    const line = splinePolyline(spline, 400);
    let best = Number.POSITIVE_INFINITY;
    for (let i = 1; i < line.length; i++) {
      const [a, b] = [line[i - 1] as Vec2, line[i] as Vec2];
      const d: Vec2 = [b[0] - a[0], b[1] - a[1]];
      const l2 = d[0] * d[0] + d[1] * d[1] || 1;
      const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1]) / l2));
      best = Math.min(best, Math.hypot(p[0] - a[0] - t * d[0], p[1] - a[1] - t * d[1]));
    }
    return best;
  };

  it('follows samples of a smooth curve within the tolerance, ends held', () => {
    // A quarter of an ellipse and a sine wave, sampled densely.
    const curves: Vec2[][] = [
      Array.from({ length: 80 }, (_, i) => {
        const t = (i / 79) * (Math.PI / 2);
        return [20 * Math.cos(t), 8 * Math.sin(t)] as Vec2;
      }),
      Array.from({ length: 200 }, (_, i) => [i * 0.2, 3 * Math.sin(i * 0.05)] as Vec2),
    ];
    for (const points of curves) {
      const poles = fitControlPoles(points, 1e-3);
      expect(poles[0]).toEqual(points[0]);
      expect(poles[poles.length - 1]).toEqual(points[points.length - 1]);
      expect(poles.length).toBeLessThan(points.length);
      const spline = controlSpline(poles);
      for (const p of points) expect(nearest(spline, p)).toBeLessThan(1.1e-3);
    }
  });

  it('gives a line two poles', () => {
    expect(
      fitControlPoles(
        [
          [0, 0],
          [3, 4],
        ],
        1e-3,
      ),
    ).toEqual([
      [0, 0],
      [3, 4],
    ]);
  });
});

// ADR-0063's P4-12 amendment: closed splines, stored knots, splitting ----------------

const deriv = (spline: BSpline, u: number, order: number): Vec2 => {
  let d = spline;
  for (let i = 0; i < order; i++) d = splineDerivative(d);
  return splinePoint(d, u);
};
const gap = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** The periodic uniform cubic B-spline of `poles` at `u` in [0, 1), evaluated directly. */
function periodicUniform(poles: readonly Vec2[], u: number): Vec2 {
  const n = poles.length;
  const x = u * n;
  const k = Math.min(n - 1, Math.floor(x));
  const t = x - k;
  const b = [
    (1 - t) ** 3 / 6,
    (3 * t ** 3 - 6 * t ** 2 + 4) / 6,
    (-3 * t ** 3 + 3 * t ** 2 + 3 * t + 1) / 6,
    t ** 3 / 6,
  ];
  // The span from k/n to (k+1)/n is centred on pole k (the seam is at the first pole).
  let px = 0;
  let py = 0;
  for (let j = 0; j < 4; j++) {
    const p = poles[(k - 1 + j + n) % n] as Vec2;
    px += (b[j] as number) * p[0];
    py += (b[j] as number) * p[1];
  }
  return [px, py];
}

describe('closed splines', () => {
  const fit: Vec2[] = [
    [0, 0],
    [30, -5],
    [42, 18],
    [20, 34],
    [-6, 22],
  ];

  it('passes a closed fit spline through every point and makes it C2 across the seam', () => {
    const spline = closedFitSpline(fit);
    expect(spline.degree).toBe(3);
    expect(spline.knots).toHaveLength(spline.poles.length + 4);
    expect(spline.poles[0]).toEqual(spline.poles.at(-1));
    // Each fit point at its own knot: the knots are the chord-length parameters.
    const distinct = [...new Set(spline.knots)];
    distinct.slice(0, fit.length).forEach((u, i) => {
      expect(gap(splinePoint(spline, u), fit[i] as Vec2)).toBeLessThan(1e-9);
    });
    for (const order of [1, 2]) {
      const start = deriv(spline, 0, order);
      const end = deriv(spline, 1, order);
      const scale = Math.max(1, Math.hypot(...start));
      expect(gap(start, end) / scale).toBeLessThan(1e-9);
    }
  });

  it('solves a long closed fit spline in its band, the same curve as the dense solve', () => {
    const many: Vec2[] = Array.from({ length: 80 }, (_, i) => {
      const t = (2 * Math.PI * i) / 80;
      return [40 * Math.cos(t) + 3 * Math.cos(5 * t), 25 * Math.sin(t)];
    });
    const spline = closedFitSpline(many);
    const distinct = [...new Set(spline.knots)];
    distinct.slice(0, many.length).forEach((u, i) => {
      expect(gap(splinePoint(spline, u), many[i] as Vec2)).toBeLessThan(1e-9);
    });
    for (const order of [1, 2]) {
      expect(gap(deriv(spline, 0, order), deriv(spline, 1, order))).toBeLessThan(1e-6);
    }
  });

  it('makes a closed control spline the periodic B-spline of its poles', () => {
    const poles: Vec2[] = [
      [0, 0],
      [40, 0],
      [40, 30],
      [10, 40],
      [-10, 20],
    ];
    const spline = closedControlSpline(poles);
    for (let i = 0; i < 100; i++) {
      const u = i / 100;
      expect(gap(splinePoint(spline, u), periodicUniform(poles, u))).toBeLessThan(1e-12);
    }
    // The seam is the curve point nearest the first pole.
    const seam: Vec2 = [
      ((poles[4] as Vec2)[0] + 4 * (poles[0] as Vec2)[0] + (poles[1] as Vec2)[0]) / 6,
      ((poles[4] as Vec2)[1] + 4 * (poles[0] as Vec2)[1] + (poles[1] as Vec2)[1]) / 6,
    ];
    expect(gap(splinePoint(spline, 0), seam)).toBeLessThan(1e-12);
    for (const order of [1, 2]) {
      expect(gap(deriv(spline, 0, order), deriv(spline, 1, order))).toBeLessThan(1e-9);
    }
  });

  it("closes the unwrapped spline's polyline exactly", () => {
    for (const spline of [closedFitSpline(fit), closedControlSpline(fit)]) {
      const line = splinePolyline(spline);
      expect(line[0]).toEqual(line.at(-1));
    }
  });

  it('reads closed and knots off the entity', () => {
    const closed: SketchSpline = { type: 'spline', points: [], closed: true, construction: false };
    expect(splineCurve(closed, fit)).toEqual(closedFitSpline(fit));
    expect(splineCurve({ ...closed, mode: 'control' }, fit)).toEqual(closedControlSpline(fit));
    const knots = [0, 0, 0, 0, 0.2, 1, 1, 1, 1];
    const stored = splineCurve(
      { type: 'spline', points: [], mode: 'control', knots, construction: false },
      fit,
    );
    expect(stored).toEqual({ degree: 3, poles: fit, knots });
  });
});

describe('knot insertion and splitting', () => {
  const spline = controlSpline(
    [
      [0, 0],
      [10, 20],
      [30, 25],
      [45, -5],
      [60, 10],
      [70, 30],
    ],
    [0, 0, 0, 0, 0.3, 0.45, 1, 1, 1, 1],
  );

  it('leaves the curve as it is', () => {
    let s = spline;
    for (const u of [0.2, 0.3, 0.3, 0.7]) s = insertKnot(s, u);
    for (let i = 0; i <= 100; i++) {
      expect(gap(splinePoint(s, i / 100), splinePoint(spline, i / 100))).toBeLessThan(1e-12);
    }
  });

  it('splits a curve into two pieces that are exactly it', () => {
    const u = 0.38;
    const [before, after] = splitSpline(spline, u).map(normalizeSpline) as [BSpline, BSpline];
    expect(before.knots.slice(0, 4)).toEqual([0, 0, 0, 0]);
    expect(after.knots.slice(-4)).toEqual([1, 1, 1, 1]);
    for (let i = 0; i <= 100; i++) {
      const t = i / 100;
      expect(gap(splinePoint(before, t), splinePoint(spline, t * u))).toBeLessThan(1e-12);
      expect(gap(splinePoint(after, t), splinePoint(spline, u + t * (1 - u)))).toBeLessThan(1e-12);
    }
  });

  it("takes a part round a closed spline's seam as one piece", () => {
    const closed = closedFitSpline([
      [0, 0],
      [30, 0],
      [30, 20],
      [0, 20],
    ]);
    const part = splineRange(closed, 0.7, 1.2);
    expect(part.knots).toHaveLength(part.poles.length + 4);
    const share = 0.3 / 0.5;
    for (let i = 0; i <= 100; i++) {
      const t = i / 100;
      const u = t < share ? 0.7 + (t / share) * 0.3 : ((t - share) / (1 - share)) * 0.2;
      expect(gap(splinePoint(part, t), splinePoint(closed, u))).toBeLessThan(1e-9);
    }
  });

  it('raises a line or a quadratic to a cubic before cutting it', () => {
    const quadratic = controlSpline([
      [0, 0],
      [10, 20],
      [20, 0],
    ]);
    const part = splineRange(quadratic, 0.25, 0.75);
    expect(part.degree).toBe(3);
    for (let i = 0; i <= 50; i++) {
      const t = i / 50;
      expect(gap(splinePoint(part, t), splinePoint(quadratic, 0.25 + t / 2))).toBeLessThan(1e-12);
    }
  });
});
