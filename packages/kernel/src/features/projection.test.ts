// Projecting edge geometry into a sketch plane (P2-09, ADR-0031): the pure
// maths on top of `Kernel.edgeGeometry`, on made-up edges.
import { ORIGIN_PLANES, type SketchFrame, type Vec3 } from '@extrudo/core';
import { describe, expect, it } from 'vitest';
import type { EdgeGeometry } from '../kernel';
import type { PlanarCurve } from '../planar';
import { projectEdge, projectSegment, projectSketchCurve } from './projection';

const XY = ORIGIN_PLANES[0]?.frame as SketchFrame;
const XZ = ORIGIN_PLANES[1]?.frame as SketchFrame;

/** A circle edge about `axis` through `center`, from angle `first` to `last`, sampled. */
function circle(
  center: Vec3,
  axis: Vec3,
  x: Vec3,
  radius: number,
  first = 0,
  last = 2 * Math.PI,
): EdgeGeometry {
  const y: Vec3 = [
    axis[1] * x[2] - axis[2] * x[1],
    axis[2] * x[0] - axis[0] * x[2],
    axis[0] * x[1] - axis[1] * x[0],
  ];
  const points: Vec3[] = [];
  for (let i = 0; i <= 24; i++) {
    const t = first + ((last - first) * i) / 24;
    points.push(
      [0, 1, 2].map(
        (k) =>
          (center[k] as number) +
          radius * (Math.cos(t) * (x[k] as number) + Math.sin(t) * (y[k] as number)),
      ) as unknown as Vec3,
    );
  }
  return {
    type: 'circle',
    closed: last - first >= 2 * Math.PI - 1e-12,
    points,
    conic: { center, axis, xDirection: x, radius, first, last },
  };
}

describe('projectEdge', () => {
  it('keeps lines, and drops a line seen end-on', () => {
    const edge: EdgeGeometry = {
      type: 'line',
      closed: false,
      points: [
        [1, 2, 5],
        [4, 6, 9],
      ],
    };
    expect(projectEdge(edge, XY)).toEqual({ type: 'line', a: [1, 2], b: [4, 6] });
    const vertical: EdgeGeometry = {
      ...edge,
      points: [
        [1, 2, 0],
        [1, 2, 9],
      ],
    };
    expect(projectEdge(vertical, XY)).toBeUndefined();
  });

  it('keeps circles and arcs in parallel planes, counter-clockwise in the sketch', () => {
    expect(projectEdge(circle([5, 5, 10], [0, 0, 1], [1, 0, 0], 3), XY)).toEqual({
      type: 'circle',
      center: [5, 5],
      radius: 3,
    });
    const up = projectEdge(circle([0, 0, 10], [0, 0, 1], [1, 0, 0], 3, 0, Math.PI / 2), XY);
    expect(up).toEqual({ type: 'arc', center: [0, 0], start: [3, 0], end: [0, 3] });
    // About −Z the edge runs clockwise in the sketch: start and end swap.
    const down = projectEdge(circle([0, 0, 10], [0, 0, -1], [1, 0, 0], 3, 0, Math.PI / 2), XY);
    expect(down).toEqual({ type: 'arc', center: [0, 0], start: [0, -3], end: [3, 0] });
  });

  it('turns a tilted circle into an ellipse, and one seen edge-on into a line', () => {
    const c = Math.SQRT1_2;
    const tilted = projectEdge(circle([0, 0, 0], [0, c, c], [1, 0, 0], 4), XY);
    expect(tilted?.type).toBe('ellipse');
    if (tilted?.type !== 'ellipse') return;
    const length = (p: readonly number[]) => Math.hypot(p[0] as number, p[1] as number);
    expect(length(tilted.major)).toBeCloseTo(4, 9);
    expect(length(tilted.minor)).toBeCloseTo(4 * c, 9);
    // A circle standing up in the XZ view is a line across its diameter.
    const edgeOn = projectEdge(circle([10, 0, 5], [0, 0, 1], [1, 0, 0], 2), XZ);
    expect(edgeOn?.type).toBe('line');
    if (edgeOn?.type !== 'line') return;
    const xs = [edgeOn.a[0], edgeOn.b[0]].sort((a, b) => a - b);
    expect(xs[0]).toBeCloseTo(8, 9);
    expect(xs[1]).toBeCloseTo(12, 9);
    expect(edgeOn.a[1]).toBeCloseTo(5, 9);
    // An arc seen edge-on reaches only as far as it goes.
    const quarter = projectEdge(circle([0, 0, 0], [0, 0, 1], [1, 0, 0], 2, 0, Math.PI / 2), XZ);
    expect(quarter?.type).toBe('line');
    if (quarter?.type !== 'line') return;
    expect(Math.min(quarter.a[0], quarter.b[0])).toBeCloseTo(0, 9);
    expect(Math.max(quarter.a[0], quarter.b[0])).toBeCloseTo(2, 9);
  });

  it('makes a fit-point spline of other curves, and a tilted arc', () => {
    const arc = projectEdge(circle([0, 0, 0], [0, 0.6, 0.8], [1, 0, 0], 4, 0, 1), XY);
    expect(arc?.type).toBe('spline');
    const other: EdgeGeometry = {
      type: 'other',
      closed: false,
      points: [
        [0, 0, 0],
        [1, 1, 3],
        [2, 0, 1],
        [3, -1, 0],
      ],
    };
    expect(projectEdge(other, XY)).toEqual({
      type: 'spline',
      points: [
        [0, 0],
        [1, 1],
        [2, 0],
        [3, -1],
      ],
    });
    expect(projectEdge({ type: 'degenerate' }, XY)).toBeUndefined();
  });

  it('projects silhouette segments', () => {
    expect(
      projectSegment(
        [
          [5, 0, 0],
          [5, 0, 10],
        ],
        XZ,
      ),
    ).toEqual({ type: 'line', a: [5, 0], b: [5, 10] });
    expect(
      projectSegment(
        [
          [5, 0, 0],
          [5, 0, 10],
        ],
        XY,
      ),
    ).toBeUndefined();
  });
});

// A sketch curve, point or whole sketch as a projection source (ADR-0125): the
// pure maths, from a source frame into a target frame, on made-up curves.
describe('projectSketchCurve', () => {
  const parallel: SketchFrame = { ...XY, origin: [0, 0, 10] };
  const opposite: SketchFrame = {
    origin: [0, 0, 10],
    x: [1, 0, 0],
    y: [0, -1, 0],
    normal: [0, 0, -1],
  };
  const circle: PlanarCurve = {
    kind: 'arc',
    center: [0, 0],
    radius: 5,
    from: 0,
    sweep: 2 * Math.PI,
  };
  const quarter: PlanarCurve = {
    kind: 'arc',
    center: [0, 0],
    radius: 5,
    from: 0,
    sweep: Math.PI / 2,
  };

  it('keeps a line, a circle, an arc and an ellipse on a parallel plane', () => {
    const line: PlanarCurve = { kind: 'line', a: [0, 0], b: [10, 5] };
    expect(projectSketchCurve(line, undefined, XY, parallel)).toEqual([
      { type: 'line', a: [0, 0], b: [10, 5] },
    ]);
    expect(projectSketchCurve(circle, undefined, XY, parallel)).toEqual([
      { type: 'circle', center: [0, 0], radius: 5 },
    ]);
    const arc = projectSketchCurve(quarter, undefined, XY, parallel)[0];
    expect(arc).toEqual({ type: 'arc', center: [0, 0], start: [5, 0], end: [0, 5] });
    const ellipse: PlanarCurve = { kind: 'ellipse', center: [1, 2], a: 6, b: 3, rotation: 0 };
    expect(projectSketchCurve(ellipse, undefined, XY, parallel)).toEqual([
      { type: 'ellipse', center: [1, 2], major: [7, 2], minor: [1, 5] },
    ]);
  });

  it('swaps an arc on a plane with the opposite normal', () => {
    const arc = projectSketchCurve(quarter, undefined, XY, opposite)[0];
    expect(arc).toEqual({ type: 'arc', center: [0, 0], start: [0, -5], end: [5, 0] });
  });

  it('sees a circle edge-on in the perpendicular plane as a line of its diameter', () => {
    const seen = projectSketchCurve(circle, undefined, XY, XZ);
    expect(seen).toHaveLength(1);
    const line = seen[0];
    expect(line?.type).toBe('line');
    if (line?.type !== 'line') return;
    expect(Math.hypot(line.b[0] - line.a[0], line.b[1] - line.a[1])).toBeCloseTo(10, 9);
  });

  it('gives a circle on a plane tilted 60° about X an ellipse r by r·cos 60°', () => {
    const t = (60 * Math.PI) / 180;
    const tilted: SketchFrame = {
      origin: [0, 0, 0],
      x: [1, 0, 0],
      y: [0, Math.cos(t), Math.sin(t)],
      normal: [0, -Math.sin(t), Math.cos(t)],
    };
    const out = projectSketchCurve(circle, undefined, XY, tilted);
    const e = out[0];
    expect(e?.type).toBe('ellipse');
    if (e?.type !== 'ellipse') return;
    const semi = (p: readonly [number, number]) =>
      Math.hypot(p[0] - e.center[0], p[1] - e.center[1]);
    expect(semi(e.major)).toBeCloseTo(5, 9);
    expect(semi(e.minor)).toBeCloseTo(5 * Math.cos(t), 9);
  });

  it('fits a spline through a source polyline, and gives nothing without one', () => {
    const spline: PlanarCurve = {
      kind: 'spline',
      degree: 3,
      poles: [
        [0, 0],
        [1, 2],
        [2, 0],
        [3, -2],
      ],
      knots: [0, 0, 0, 0, 1, 1, 1, 1],
    };
    const polyline = [
      [0, 0],
      [1, 0.2],
      [2, 0.6],
      [3, 1.2],
      [4, 2.0],
      [5, 3.0],
    ] as const;
    const out = projectSketchCurve(spline, polyline, XY, parallel);
    expect(out).toHaveLength(1);
    expect(out[0]?.type).toBe('spline');
    expect(projectSketchCurve(spline, undefined, XY, parallel)).toEqual([]);
  });
});
