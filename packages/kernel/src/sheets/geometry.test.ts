// The 2D math of sheet views (P6-24 S2): conic spans projected exactly and
// running the right way, pieces joined, hidden stretches under drawn ones
// taken out, bounds. No kernel.
import { type SheetViewFrame, sheetBaseFrame, type Vec2, type Vec3 } from '@extrudo/core';
import { describe, expect, it } from 'vitest';
import type { EdgeGeometry } from '../kernel';
import {
  boundsOf,
  conicMinorDirection,
  joinPieces,
  pieceEnds,
  projectSpan,
  toView,
  uncovered,
  type ViewPiece,
} from './geometry';

/** A circle edge as `edgeGeometry` gives it, its points sampled from the conic. */
function circle(center: Vec3, axis: Vec3, x: Vec3, radius: number, minor?: number): EdgeGeometry {
  const y: Vec3 = [
    axis[1] * x[2] - axis[2] * x[1],
    axis[2] * x[0] - axis[0] * x[2],
    axis[0] * x[1] - axis[1] * x[0],
  ];
  const b = minor ?? radius;
  const points = Array.from({ length: 9 }, (_, i): Vec3 => {
    const t = (2 * Math.PI * i) / 8;
    return [0, 1, 2].map(
      (k) =>
        (center[k] as number) +
        radius * Math.cos(t) * (x[k] as number) +
        b * Math.sin(t) * (y[k] as number),
    ) as unknown as Vec3;
  });
  return {
    type: minor === undefined ? 'circle' : 'ellipse',
    closed: true,
    points,
    conic: {
      center,
      axis,
      xDirection: x,
      radius,
      ...(minor !== undefined && { minor }),
      first: 0,
      last: 2 * Math.PI,
    },
  };
}

/** The 3D point of a circle edge at `t`, seen in the frame. */
function seen(g: EdgeGeometry, frame: SheetViewFrame, t: number): Vec2 {
  if (g.type === 'degenerate' || !g.conic) throw new Error('not a conic');
  const minor = conicMinorDirection(g) as Vec3;
  const c = g.conic;
  const p = [0, 1, 2].map(
    (k) =>
      (c.center[k] as number) +
      c.radius * Math.cos(t) * (c.xDirection[k] as number) +
      (c.minor ?? c.radius) * Math.sin(t) * (minor[k] as number),
  ) as unknown as Vec3;
  return toView(frame, p);
}

const close = (a: Vec2, b: Vec2) => {
  expect(a[0]).toBeCloseTo(b[0], 9);
  expect(a[1]).toBeCloseTo(b[1], 9);
};
const front = sheetBaseFrame([0, 1, 0], [0, 0, 1]);
const top = sheetBaseFrame([0, 0, -1], [0, 1, 0]);
const below = sheetBaseFrame([0, 0, 1], [0, -1, 0]);
const tilted = sheetBaseFrame([-1, 1, -1], [0, 0, 1]);

describe('projectSpan on circles and ellipses', () => {
  const flat = circle([1, 2, 3], [0, 0, 1], [1, 0, 0], 5);
  const range: [number, number] = [0, 2 * Math.PI];

  it('gives an arc from above, starting and ending where the edge does', () => {
    const [p] = projectSpan(flat, range, 0.3, 2.1, top, conicMinorDirection(flat));
    expect(p?.type).toBe('arc');
    const [a, b] = pieceEnds(p as ViewPiece);
    close(a, seen(flat, top, 0.3));
    close(b, seen(flat, top, 2.1));
  });

  it('runs the other way round from below and still ends where the edge does', () => {
    const [p] = projectSpan(flat, range, 0.3, 2.1, below, conicMinorDirection(flat));
    expect(p?.type).toBe('arc');
    const ends = pieceEnds(p as ViewPiece);
    // Counter-clockwise on the sheet from the edge's end to its start.
    close(ends[0], seen(flat, below, 2.1));
    close(ends[1], seen(flat, below, 0.3));
    if (p?.type === 'arc') expect(p.end - p.start).toBeCloseTo(1.8, 12);
  });

  it('gives an ellipse arc when tilted, its middle on the curve', () => {
    for (const frame of [tilted, sheetBaseFrame([1, 1, 1], [0, 0, 1])]) {
      const [p] = projectSpan(flat, range, 1, 4, frame, conicMinorDirection(flat));
      expect(p?.type).toBe('ellipse');
      const [a, b] = pieceEnds(p as ViewPiece);
      const ends = [seen(flat, frame, 1), seen(flat, frame, 4)];
      // Either way round, the piece's ends are the edge's.
      const forward = Math.hypot(a[0] - (ends[0] as Vec2)[0], a[1] - (ends[0] as Vec2)[1]) < 1e-6;
      close(a, ends[forward ? 0 : 1] as Vec2);
      close(b, ends[forward ? 1 : 0] as Vec2);
      if (p?.type === 'ellipse') {
        expect(p.end - p.start).toBeCloseTo(3, 9);
        const mid = (p.start + p.end) / 2;
        const [c, s] = [Math.cos(p.rotation), Math.sin(p.rotation)];
        const [x, y] = [p.rx * Math.cos(mid), p.ry * Math.sin(mid)];
        close([p.center[0] + x * c - y * s, p.center[1] + x * s + y * c], seen(flat, frame, 2.5));
      }
    }
  });

  it('takes an ellipse edge exactly too', () => {
    const e = circle([0, 0, 0], [0, 0, 1], [0, 1, 0], 6, 2);
    const [p] = projectSpan(e, range, 0, 2 * Math.PI, top, conicMinorDirection(e));
    expect(p).toMatchObject({ type: 'ellipse', rx: 6, ry: 2 });
    expect(boundsOf([p as ViewPiece])).toEqual({ min: [-2, -6], max: [2, 6] });
  });

  it('gives a line seen edge-on, between the span’s farthest points', () => {
    const [p] = projectSpan(flat, range, 0, Math.PI, front, conicMinorDirection(flat));
    expect(p).toEqual({ type: 'line', a: [-4, 3], b: [6, 3] });
    // Two halves lying on each other join into one line, not a folded one.
    const halves = [0, Math.PI].flatMap((t) =>
      projectSpan(flat, range, t, t + Math.PI, front, conicMinorDirection(flat)),
    );
    expect(joinPieces(halves)).toEqual([{ type: 'line', a: [-4, 3], b: [6, 3] }]);
  });

  it('finds the minor direction a mirrored placement turned round', () => {
    const g = circle([0, 0, 0], [0, 0, 1], [1, 0, 0], 2);
    if (g.type === 'degenerate' || !g.conic) throw new Error();
    // The same points, the axis reversed: the parameter now runs clockwise about it.
    const flipped: EdgeGeometry = { ...g, conic: { ...g.conic, axis: [0, 0, -1] } };
    expect(conicMinorDirection(g)).toEqual([0, 1, 0]);
    expect(conicMinorDirection(flipped)?.map((v) => v + 0)).toEqual([0, 1, 0]);
  });
});

describe('joinPieces', () => {
  it('joins arcs of one circle into a whole one', () => {
    const arc = (start: number, end: number): ViewPiece => ({
      type: 'arc',
      center: [0, 0],
      radius: 2,
      start,
      end,
    });
    const joined = joinPieces([arc(0, 1), arc(1, 3), arc(3, 2 * Math.PI)]);
    expect(joined).toHaveLength(1);
    expect(joined[0]).toMatchObject({ type: 'arc', start: 0 });
    if (joined[0]?.type === 'arc') expect(joined[0].end).toBeCloseTo(2 * Math.PI, 12);
  });

  it('keeps lines at an angle apart', () => {
    const lines: ViewPiece[] = [
      { type: 'line', a: [0, 0], b: [1, 0] },
      { type: 'line', a: [1, 0], b: [1, 1] },
    ];
    expect(joinPieces(lines)).toEqual(lines);
  });
});

describe('uncovered', () => {
  it('takes the stretch a drawn line covers out of a hidden one', () => {
    const hidden: ViewPiece = { type: 'line', a: [0, 0], b: [10, 0] };
    expect(uncovered(hidden, [{ type: 'line', a: [2, 0], b: [5, 0] }])).toEqual([
      { type: 'line', a: [0, 0], b: [2, 0] },
      { type: 'line', a: [5, 0], b: [10, 0] },
    ]);
    expect(uncovered(hidden, [{ type: 'line', a: [12, 0], b: [-1, 0] }])).toEqual([]);
    // A line beside it covers nothing.
    expect(uncovered(hidden, [{ type: 'line', a: [0, 0.1], b: [10, 0.1] }])).toEqual([hidden]);
  });

  it('takes a drawn arc of the same circle out of a hidden one, across the start', () => {
    const hidden: ViewPiece = { type: 'arc', center: [0, 0], radius: 1, start: 0, end: Math.PI };
    const left = uncovered(hidden, [{ type: 'arc', center: [0, 0], radius: 1, start: -1, end: 1 }]);
    expect(left).toHaveLength(1);
    if (left[0]?.type !== 'arc') throw new Error('not an arc');
    expect(left[0].start).toBeCloseTo(1, 5);
    expect(left[0].end).toBeCloseTo(Math.PI, 12);
  });
});
