import {
  type BSpline,
  ellipsePoint,
  type SketchData,
  SketchDataSchema,
  type SketchEntity,
  splineCurve,
  splinePoint,
  type Vec2,
} from '@extrudo/core';
import {
  type Contour,
  type Drawing,
  flattenContour,
  type Layer,
  type Point,
  type Segment,
} from '@extrudo/io';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { detectProfiles } from '../profiles';
import { loadPlanegcs } from '../solver/module';
import { applySolution, SketchSolver } from '../solver/solver';
import { drawingToSketch, ellipsePieces, ImportLimitError, MAX_IMPORT_CURVES } from './import';

let solver: SketchSolver;
beforeAll(async () => {
  solver = new SketchSolver(await loadPlanegcs());
});
afterAll(() => solver.dispose());

const TAU = 2 * Math.PI;
const INK: Layer = { name: 'Sketch', color: '#000000', aci: 7 };
const EMPTY: SketchData = { entities: {}, constraints: {}, dimensions: {} };
/** The rectangle several tests import. */
const RECTANGLE: Point[] = [
  [0, 0],
  [20, 0],
  [20, 10],
  [0, 10],
];

/** IDs from a counter, as the app passes `newId` (ADR-0003: a deterministic recipe). */
let counter = 0;
const newId = () => `n${counter++}`;

const drawing = (contours: { start: Point; segments: Segment[]; closed?: boolean }[]): Drawing => ({
  layers: [INK],
  shapes: contours.map((c) => ({
    layer: INK.name,
    contours: [{ ...c, closed: c.closed ?? false }],
  })),
});

const close = (points: Point[]): Contour => ({
  start: points[0] as Point,
  segments: points.slice(1).map((to) => ({ type: 'line' as const, to })),
  closed: true,
});

/** How far `p` is from the polyline through `points` (point to segment, mm). */
function distanceTo(points: readonly Point[], p: Vec2): number {
  let best = Number.POSITIVE_INFINITY;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1] as Point;
    const b = points[i] as Point;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const length = dx * dx + dy * dy;
    const t =
      length === 0
        ? 0
        : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length));
    best = Math.min(best, Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy)));
  }
  return best;
}

/** The point of an ellipse shape (core's spelling) at parameter `t`. */
const onEllipse = (e: { center: Point; rx: number; ry: number; rotation: number }, t: number) =>
  ellipsePoint({ center: e.center, a: e.rx, b: e.ry, rotation: e.rotation }, t);

/** A sketch curve's point at `u`, through core's own `splinePoint`. */
const evaluate = (spline: BSpline, u: number): Vec2 => splinePoint(spline, u);

/** The change as the sketch it adds to, validated by the document schema. */
function imported(source: Drawing, options: Partial<Parameters<typeof drawingToSketch>[2]> = {}) {
  counter = 0;
  const change = drawingToSketch(source, EMPTY, {
    scale: 1,
    offset: [0, 0],
    fixed: true,
    ids: newId,
    ...options,
  });
  const sketch = SketchDataSchema.parse({
    entities: change.entities ?? {},
    constraints: change.constraints ?? {},
    dimensions: change.dimensions ?? {},
  });
  return { change, sketch };
}

/** The curves of an imported sketch, in the order the change made them. */
function curves(sketch: SketchData) {
  return Object.entries(sketch.entities)
    .filter(([, e]) => e.type !== 'point')
    .map(([key, e]) => ({ key, entity: e }));
}

const position = (sketch: SketchData, id: string): Vec2 => {
  const p = (sketch.entities as Record<string, SketchEntity>)[id];
  if (p?.type !== 'point') throw new Error(`${id} is not a point`);
  return [p.x, p.y];
};

/** Every constraint of a type. */
const ofType = (sketch: SketchData, type: string) =>
  Object.values(sketch.constraints).filter((c) => c.type === type);

describe('drawingToSketch', () => {
  it('maps every segment kind to its own curve, at the right places', () => {
    const { sketch } = imported(
      drawing([
        { start: [0, 0], segments: [{ type: 'line', to: [10, 0] }] },
        {
          start: [0, 0],
          segments: [{ type: 'arc', center: [5, 5], sweep: Math.PI / 2, to: [5, 10] }],
        },
        { start: [0, 0], segments: [{ type: 'arc', center: [20, 20], sweep: TAU, to: [0, 0] }] },
        {
          start: [0, 0],
          segments: [
            {
              type: 'ellipse',
              center: [40, 0],
              rx: 10,
              ry: 5,
              rotation: 0,
              sweep: TAU,
              to: [0, 0],
            },
          ],
        },
        { start: [0, 0], segments: [{ type: 'cubic', c1: [1, 2], c2: [3, 4], to: [5, 6] }] },
        { start: [0, 0], segments: [{ type: 'quadratic', control: [10, 20], to: [20, 0] }] },
      ]),
    );
    const kinds = curves(sketch).map((c) => c.entity.type);
    expect(kinds).toEqual(['line', 'arc', 'circle', 'ellipse', 'spline', 'spline']);

    const [line, arc, circle, ellipse, cubic, quadratic] = curves(sketch);
    // A line keeps its two ends.
    if (line?.entity.type !== 'line') throw new Error('not a line');
    expect(position(sketch, line.entity.start)).toEqual([0, 0]);
    expect(position(sketch, line.entity.end)).toEqual([10, 0]);
    // An arc keeps its centre and both ends; a sketch arc runs counter-clockwise.
    if (arc?.entity.type !== 'arc') throw new Error('not an arc');
    expect(position(sketch, arc.entity.center)).toEqual([5, 5]);
    expect(position(sketch, arc.entity.start)).toEqual([0, 0]);
    expect(position(sketch, arc.entity.end)).toEqual([5, 10]);
    // A whole turn is a circle with a radius.
    if (circle?.entity.type !== 'circle') throw new Error('not a circle');
    expect(position(sketch, circle.entity.center)).toEqual([20, 20]);
    expect(circle.entity.radius).toBeCloseTo(Math.hypot(20, 20), 12);
    // A whole ellipse is three points: the centre and the ends of its axes.
    if (ellipse?.entity.type !== 'ellipse') throw new Error('not an ellipse');
    expect(position(sketch, ellipse.entity.center)).toEqual([40, 0]);
    expect(position(sketch, ellipse.entity.major)).toEqual([50, 0]);
    expect(position(sketch, ellipse.entity.minor)).toEqual([40, 5]);
    // A Bézier of either degree is a four-pole control spline (ADR-0063).
    if (cubic?.entity.type !== 'spline') throw new Error('not a spline');
    expect(cubic.entity.mode).toBe('control');
    expect(cubic.entity.points.map((p) => position(sketch, p))).toEqual([
      [0, 0],
      [1, 2],
      [3, 4],
      [5, 6],
    ]);
    if (quadratic?.entity.type !== 'spline') throw new Error('not a spline');
    expect(quadratic.entity.points.map((p) => position(sketch, p))).toEqual([
      [0, 0],
      [10, 20],
      [20, 0],
    ]);
  });

  it("swaps a clockwise arc's ends, so the sketch arc turns the same way", () => {
    const { sketch } = imported(
      drawing([
        {
          start: [5, 10],
          segments: [{ type: 'arc', center: [5, 5], sweep: -Math.PI / 2, to: [0, 0] }],
        },
      ]),
    );
    const [arc] = curves(sketch);
    if (arc?.entity.type !== 'arc') throw new Error('not an arc');
    expect(position(sketch, arc.entity.start)).toEqual([0, 0]);
    expect(position(sketch, arc.entity.end)).toEqual([5, 10]);
  });

  it('scales and moves the drawing', () => {
    const { sketch } = imported(
      drawing([{ start: [0, 0], segments: [{ type: 'line', to: [10, 0] }] }]),
      { scale: 2.5, offset: [3, -1] },
    );
    const [line] = curves(sketch);
    if (line?.entity.type !== 'line') throw new Error('not a line');
    expect(position(sketch, line.entity.start)).toEqual([3, -1]);
    expect(position(sketch, line.entity.end)).toEqual([28, -1]);
  });

  it('brings a cubic Bézier in exactly', () => {
    const c1: Point = [12, 30];
    const c2: Point = [30, -12];
    const to: Point = [40, 0];
    const { sketch } = imported(
      drawing([{ start: [0, 0], segments: [{ type: 'cubic', c1, c2, to }] }]),
    );
    const [spline] = curves(sketch);
    if (spline?.entity.type !== 'spline') throw new Error('not a spline');
    const poles = spline.entity.points.map((p) => position(sketch, p));
    const curve = splineCurve(spline.entity, poles);
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      // The sketch's own curve (ADR-0063: four poles are one Bézier) against the
      // Bézier the drawing had.
      const u = 1 - t;
      const expected: Vec2 = [
        u ** 3 * 0 + 3 * u ** 2 * t * c1[0] + 3 * u * t ** 2 * c2[0] + t ** 3 * to[0],
        u ** 3 * 0 + 3 * u ** 2 * t * c1[1] + 3 * u * t ** 2 * c2[1] + t ** 3 * to[1],
      ];
      const point = evaluate(curve, t);
      expect(point[0]).toBeCloseTo(expected[0], 9);
      expect(point[1]).toBeCloseTo(expected[1], 9);
    }
  });

  it('brings an elliptical arc in as Bézier pieces a millionth of the curve out', () => {
    // 120° of an ellipse with a major radius of 20 mm: three pieces.
    const shape = { center: [0, 0] as Point, rx: 20, ry: 8, rotation: 0.35 };
    const sweep = (2 * Math.PI) / 3;
    const from = 0.6;
    const { sketch } = imported(
      drawing([
        {
          start: onEllipse(shape, from),
          segments: [{ type: 'ellipse', ...shape, sweep, to: onEllipse(shape, from + sweep) }],
        },
      ]),
    );
    const pieces = curves(sketch).filter((c) => c.entity.type === 'spline');
    expect(pieces).toHaveLength(3);

    // Sample the imported curve, and measure each point against the exact
    // ellipse: the distance to the curve is what a user would see, and ADR-0066
    // §1 asks for less than 1e-5 of the major radius.
    const exact = flattenContour(
      {
        start: onEllipse(shape, from),
        segments: [{ type: 'ellipse', ...shape, sweep, to: onEllipse(shape, from + sweep) }],
        closed: false,
      },
      1e-5,
    );
    const importedCurves = pieces.map((s) => {
      const entity = s.entity as Extract<SketchEntity, { type: 'spline' }>;
      return splineCurve(
        entity,
        entity.points.map((p) => position(sketch, p)),
      );
    });
    let worst = 0;
    importedCurves.forEach((piece, j) => {
      for (let i = 0; i <= 16; i++) {
        const u = i / 16;
        const got = evaluate(piece, u);
        // The piece's own share of the arc, sampled on the exact ellipse.
        const wanted = onEllipse(shape, from + (sweep * (j + u)) / importedCurves.length);
        worst = Math.max(worst, Math.min(distanceTo(exact, got), distanceTo(exact, wanted)));
      }
    });
    expect(worst).toBeLessThan(1e-5 * 20);
  });

  it('cuts an ellipse into one piece per 45° of parameter', () => {
    const shape = { center: [0, 0] as Point, rx: 5, ry: 5, rotation: 0 };
    expect(ellipsePieces(shape, 0, Math.PI / 4)).toHaveLength(1);
    expect(ellipsePieces(shape, 0, Math.PI / 2)).toHaveLength(2);
    expect(ellipsePieces(shape, 0, (Math.PI / 4) * 2 + 1e-9)).toHaveLength(3);
    // A whole turn is eight pieces.
    expect(ellipsePieces(shape, 0, TAU)).toHaveLength(8);
  });

  it('fixes every curve and adds no coincident constraints by default', () => {
    const { sketch } = imported(drawing([close(RECTANGLE)]));
    expect(ofType(sketch, 'coincident')).toEqual([]);
    // One `fix` per curve: the four lines of the rectangle.
    const fixes = Object.values(sketch.constraints).filter((c) => c.type === 'fix');
    expect(fixes).toHaveLength(4);
    const fixed = curves(sketch).map((c) => c.key);
    for (const fix of fixes) expect(fixed).toContain(fix.entity);
  });

  it('leaves a fixed import exactly where the drawing put it, solver and all', () => {
    const { sketch } = imported(drawing([close(RECTANGLE)]));
    const result = solver.solve(sketch, {});
    expect(result.ok).toBe(true);
    // Every point keeps its place: fixed geometry is a constant for the solver.
    expect(result.solution.points).toEqual({});
    const solved = applySolution(sketch, result.solution);
    const after = solved.entities as Record<string, SketchEntity>;
    for (const [id, entity] of Object.entries(sketch.entities)) {
      expect(after[id]).toEqual(entity);
    }
    // And nothing is free: the whole import is held.
    expect(result.dof).toBe(0);
  });

  it('joins the ends of a free import with coincident constraints', () => {
    const { sketch } = imported(drawing([close(RECTANGLE)]), {
      fixed: false,
    });
    expect(ofType(sketch, 'fix')).toEqual([]);
    // Four lines, four joints, each with a constraint between two points.
    const coincident = ofType(sketch, 'coincident');
    expect(coincident).toHaveLength(4);
    const result = solver.solve(sketch, {});
    expect(result.ok).toBe(true);
    expect(result.dof).toBe(8);
    // The rectangle is still closed after a solve: every end has a partner
    // on the same place.
    const solved = applySolution(sketch, result.solution);
    expect(jointGaps(solved).every((gap) => gap < 1e-9)).toBe(true);
  });

  it('gives a closed drawing one profile, holes and all (ADR-0020)', () => {
    // A 40 × 20 rectangle with a Ø10 circle in it, as a drawing of an SVG.
    const { sketch } = imported(
      drawing([
        close([
          [-20, -10],
          [20, -10],
          [20, 10],
          [-20, 10],
        ]),
        { start: [5, 0], segments: [{ type: 'arc', center: [0, 0], sweep: TAU, to: [5, 0] }] },
      ]),
    );
    // ADR-0020: a region inside another is a hole of it and a region of its own,
    // so the drawing gives two regions and one hole: the plate with its hole, and
    // the disc.
    const profiles = detectProfiles(sketch);
    expect(profiles).toHaveLength(2);
    expect(profiles[0]?.holes).toHaveLength(1);
    expect(Math.abs(profiles[0]?.area ?? 0)).toBeCloseTo(40 * 20 - Math.PI * 25, 6);
    expect(Math.abs(profiles[1]?.area ?? 0)).toBeCloseTo(Math.PI * 25, 6);
  });

  it('drops a zero-length line and an exact duplicate', () => {
    const { sketch } = imported(
      drawing([
        { start: [0, 0], segments: [{ type: 'line', to: [10, 0] }] },
        // The same line again, the other way round: the same curve.
        { start: [10, 0], segments: [{ type: 'line', to: [0, 0] }] },
        // A line of no length, as a POINT or a stray `L` leaves behind.
        { start: [5, 5], segments: [{ type: 'line', to: [5, 5] }] },
        { start: [0, 5], segments: [{ type: 'line', to: [0, 10] }] },
      ]),
    );
    const lines = curves(sketch).filter((c) => c.entity.type === 'line');
    expect(lines).toHaveLength(2);
  });

  it('closes a contour that stops short of its own start', () => {
    // A polyline marked closed whose last segment doesn't reach the start.
    const { sketch } = imported(
      drawing([
        {
          start: [0, 0],
          segments: [
            { type: 'line', to: [10, 0] },
            { type: 'line', to: [10, 10] },
          ],
          closed: true,
        },
      ]),
    );
    const lines = curves(sketch).filter((c) => c.entity.type === 'line');
    expect(lines).toHaveLength(3);
    const last = lines[2];
    if (last?.entity.type !== 'line') throw new Error('not a line');
    expect(position(sketch, last.entity.start)).toEqual([10, 10]);
    expect(position(sketch, last.entity.end)).toEqual([0, 0]);
  });

  it('refuses a drawing with more curves than the limit', () => {
    const line = (i: number) => ({
      start: [i, 0] as Point,
      segments: [{ type: 'line' as const, to: [i + 0.5, 1] as Point }],
    });
    const many = drawing(Array.from({ length: MAX_IMPORT_CURVES + 1 }, (_, i) => line(i)));
    expect(() => imported(many)).toThrow(ImportLimitError);
    expect(() => imported(many)).toThrow(
      `This drawing has 5,001 curves; Extrudo imports up to 5,000.`,
    );
    // One curve fewer is fine.
    expect(() =>
      imported(drawing(Array.from({ length: MAX_IMPORT_CURVES }, (_, i) => line(i)))),
    ).not.toThrow();
  });

  it('is the same change for the same drawing, with the IDs the caller passes', () => {
    const source = drawing([close(RECTANGLE)]);
    counter = 0;
    const first = drawingToSketch(source, EMPTY, {
      scale: 1,
      offset: [0, 0],
      fixed: true,
      ids: newId,
    });
    counter = 0;
    const second = drawingToSketch(source, EMPTY, {
      scale: 1,
      offset: [0, 0],
      fixed: true,
      ids: newId,
    });
    expect(second).toEqual(first);
  });
});

/** How far every line's end is from the nearest other end, in a solved sketch. */
function jointGaps(sketch: SketchData): number[] {
  const ends: Vec2[] = [];
  for (const entity of Object.values(sketch.entities)) {
    if (entity.type === 'line') {
      ends.push(position(sketch, entity.start), position(sketch, entity.end));
    }
  }
  return ends.map((a, i) =>
    Math.min(...ends.filter((_, j) => j !== i).map((b) => Math.hypot(a[0] - b[0], a[1] - b[1]))),
  );
}
