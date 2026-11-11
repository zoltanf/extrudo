/**
 * FreeCAD sketches as Extrudo sketches (ADR-0144 S4), on hand-written files:
 * every drawn point is FreeCAD's stored point through the placement (1e-9
 * mm), each constraint gets the expected outcome, and solving with the real
 * solver moves nothing (1e-6 mm).
 */
import { Design } from '@extrudo/api';
import { type Feature, readSketch, type SketchData } from '@extrudo/core';
import { loadPlanegcs, type PlanegcsModule, SketchSolver } from '@extrudo/sketch';
import { beforeAll, describe, expect, it } from 'vitest';
import { rotate } from './final-shapes';
import type { FixtureObject } from './fixtures';
import { type FcObject, readFcstd } from './model';
import { decodeSketch, type FcGeometry } from './sketch-decode';
import {
  arc,
  bodyObject,
  bspline,
  circle,
  constraint,
  ellipse,
  line,
  point,
  type SketchSpec,
  sketchFile,
  sketchObject,
  T,
} from './sketch-fixtures';
import { arcEnds } from './sketch-map';
import { NO_PLANE } from './sketch-place';
import { type AddSketchResult, addSketch, sketchObjects } from './sketches';

let planegcs: PlanegcsModule;
beforeAll(async () => {
  planegcs = await loadPlanegcs();
});

const H = -1;
const V = -2;
const PI = Math.PI;
type V3 = [number, number, number];

interface Imported {
  result: AddSketchResult;
  design: Design;
  data: SketchData;
  object: FcObject;
  feature?: Feature;
}

/** Reads the file and adds its `which`-th sketch to a new design, with the real solver. */
function load(
  objects: FixtureObject[],
  options: { which?: number; solver?: boolean; version?: string; design?: Design } = {},
): Imported {
  const doc = readFcstd(sketchFile(objects, options.version));
  const object = sketchObjects(doc)[options.which ?? 0] as FcObject;
  const design = options.design ?? Design.create();
  const solver = options.solver === false ? undefined : new SketchSolver(planegcs);
  try {
    const result = addSketch(design, doc, object, solver ? { solver } : {});
    expect(design.validate()).toEqual([]);
    const feature = result.imported
      ? design.doc.features.find((f) => f.id === result.id)
      : undefined;
    const data = (feature && readSketch(feature)?.data) || {
      entities: {},
      constraints: {},
      dimensions: {},
    };
    return { result, design, data, object, ...(feature ? { feature } : {}) };
  } finally {
    solver?.dispose();
  }
}

const one = (s: SketchSpec, options?: Parameters<typeof load>[1]) =>
  load([sketchObject(s)], options);

/** Solves as the app would (dimension values from their stored expressions): how far anything moves. */
function solveAsApp(data: SketchData) {
  const solver = new SketchSolver(planegcs);
  try {
    const values: Record<string, number> = {};
    for (const [id, d] of Object.entries(data.dimensions))
      if (!d.driven) values[id] = Number.parseFloat(d.expr);
    const result = solver.solve(data, values);
    let moved = 0;
    for (const [id, p] of Object.entries(result.solution.points)) {
      const e = data.entities[id as keyof typeof data.entities];
      if (e?.type === 'point') moved = Math.max(moved, Math.hypot(p.x - e.x, p.y - e.y));
    }
    for (const [id, r] of Object.entries(result.solution.radii)) {
      const e = data.entities[id as keyof typeof data.entities];
      if (e?.type === 'circle') moved = Math.max(moved, Math.abs(r - e.radius));
    }
    return { ...result, moved };
  } finally {
    solver.dispose();
  }
}

/** A placement as the fixtures write it: position, angle about an axis. */
type At = [number, number, number, number?, V3?];

/** FreeCAD's world point of sketch point (u, v) for a placement chain, outermost first. */
function fcWorld(chain: At[], u: number, v: number): V3 {
  let p: V3 = [u, v, 0];
  for (const [x, y, z, angle = 0, axis = [0, 0, 1] as V3] of [...chain].reverse()) {
    const n = Math.hypot(...axis);
    const s = Math.sin(angle / 2);
    const q = [
      (axis[0] / n) * s,
      (axis[1] / n) * s,
      (axis[2] / n) * s,
      Math.cos(angle / 2),
    ] as const;
    const r = rotate(q, p);
    p = [r[0] + x, r[1] + y, r[2] + z];
  }
  return p;
}

interface Frame {
  origin: V3;
  x: V3;
  y: V3;
}
const XY: Frame = { origin: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0] };
const XZ: Frame = { origin: [0, 0, 0], x: [1, 0, 0], y: [0, 0, 1] };

/** FreeCAD's stored points of a curve (start, end, centre, or the point), in the sketch frame. */
function storedPoints(g: FcGeometry): [number, number][] {
  switch (g.kind) {
    case 'line':
      return [g.start as [number, number], g.end as [number, number]];
    case 'circle':
      return [g.center as [number, number]];
    case 'arc': {
      const { start, end } = arcEnds(g);
      return [start as [number, number], end as [number, number], g.center as [number, number]];
    }
    case 'point':
      return [g.at as [number, number]];
    case 'bspline':
      return g.poles as [number, number][];
    default:
      return [];
  }
}

/**
 * Every stored point of the drawn curves, through FreeCAD's frame, has an
 * Extrudo point at the same world position through the plane's frame, within
 * 1e-9 mm; and every Extrudo point is one of them (or the importer's datums).
 */
function expectPointsAt(imported: Imported, chain: At[], frame: Frame) {
  const points = Object.values(imported.data.entities).filter((e) => e.type === 'point') as {
    x: number;
    y: number;
  }[];
  const world = (p: { x: number; y: number }): V3 =>
    frame.origin.map(
      (o, i) => o + p.x * (frame.x[i] as number) + p.y * (frame.y[i] as number),
    ) as V3;
  let checked = 0;
  for (const g of decodeSketch(imported.object).geometry) {
    if (g?.internal !== 0) continue;
    if (g.kind !== 'line' && g.kind !== 'circle' && g.kind !== 'arc' && g.kind !== 'point')
      continue;
    for (const [u, v] of storedPoints(g)) {
      const fc = fcWorld(chain, u, v);
      const near = points.some(
        (p) => Math.hypot(...world(p).map((c, i) => c - (fc[i] as number))) <= 1e-9,
      );
      expect(near, `stored point (${u}, ${v}) at ${fc}`).toBe(true);
      checked++;
    }
  }
  expect(checked).toBeGreaterThan(0);
}

const types = (data: SketchData) =>
  Object.values(data.constraints)
    .map((c) => c.type)
    .sort();

const sketchOutcome = (i: Imported) => i.result.outcome;

// A 30 × 20 rectangle from the origin: four lines joined end to end.
const rectangle = [line(0, 0, 30, 0), line(30, 0, 30, 20), line(30, 20, 0, 20), line(0, 20, 0, 0)];
const corners = [
  constraint({ type: T.coincident, first: 0, firstPos: 2, second: 1, secondPos: 1 }),
  constraint({ type: T.coincident, first: 1, firstPos: 2, second: 2, secondPos: 1 }),
  constraint({ type: T.coincident, first: 2, firstPos: 2, second: 3, secondPos: 1 }),
  constraint({ type: T.coincident, first: 3, firstPos: 2, second: 0, secondPos: 1 }),
];

describe('addSketch', () => {
  it('brings in a rectangle with its corners, levels and two distances', () => {
    const i = one({
      geometry: rectangle,
      constraints: [
        ...corners,
        constraint({ type: T.horizontal, first: 0 }),
        constraint({ type: T.horizontal, first: 2 }),
        constraint({ type: T.vertical, first: 1 }),
        constraint({ type: T.vertical, first: 3 }),
        constraint({ type: T.distanceX, first: 0, value: 30 }),
        constraint({ type: T.distanceY, first: 1, value: 20 }),
      ],
    });
    expect(i.result.imported).toBe(true);
    const o = sketchOutcome(i);
    expect(o.plane).toBe('origin');
    expect(o.mirrored).toBe(false);
    expect(o.perConstraint).toEqual(Array(10).fill('mapped'));
    expect(o.constraints).toMatchObject({ total: 10, mapped: 10, leftOut: {} });
    expect(o.drawn).toEqual({ line: 4 });
    expect(types(i.data)).toEqual([
      'coincident',
      'coincident',
      'coincident',
      'coincident',
      'horizontal',
      'horizontal',
      'vertical',
      'vertical',
    ]);
    const dims = Object.values(i.data.dimensions);
    expect(dims.map((d) => [d.type, (d as { orientation?: string }).orientation, d.expr])).toEqual([
      ['distance', 'horizontal', '30 mm'],
      ['distance', 'vertical', '20 mm'],
    ]);
    expect(i.feature?.name).toBe('Sketch');
    expectPointsAt(i, [[0, 0, 0]], XY);
    expect(solveAsApp(i.data).moved).toBeLessThanOrEqual(1e-6);
    expect(o.maxDisplacement).toBeLessThanOrEqual(1e-6);
  });

  it('brings in a slot: arcs tangent to the lines end to end, equal, with a radius', () => {
    const i = one({
      geometry: [
        line(0, 5, 40, 5),
        line(40, -5, 0, -5),
        arc(40, 0, 5, -PI / 2, PI / 2),
        arc(0, 0, 5, PI / 2, (3 * PI) / 2),
      ],
      constraints: [
        constraint({
          type: T.tangent,
          first: 0,
          firstPos: 2,
          second: 2,
          secondPos: 2,
          value: PI / 2,
        }),
        constraint({
          type: T.tangent,
          first: 2,
          firstPos: 1,
          second: 1,
          secondPos: 1,
          value: PI / 2,
        }),
        constraint({
          type: T.tangent,
          first: 1,
          firstPos: 2,
          second: 3,
          secondPos: 2,
          value: PI / 2,
        }),
        constraint({
          type: T.tangent,
          first: 3,
          firstPos: 1,
          second: 0,
          secondPos: 1,
          value: PI / 2,
        }),
        constraint({ type: T.horizontal, first: 0 }),
        constraint({ type: T.equal, first: 2, second: 3 }),
        constraint({ type: T.radius, first: 2, value: 5 }),
        constraint({
          type: T.distanceX,
          first: 3,
          firstPos: 3,
          second: 2,
          secondPos: 3,
          value: 40,
        }),
      ],
    });
    const o = sketchOutcome(i);
    expect(o.perConstraint).toEqual(Array(8).fill('mapped'));
    expect(o.drawn).toEqual({ line: 2, arc: 2 });
    const t = types(i.data);
    expect(t.filter((x) => x === 'coincident')).toHaveLength(4);
    expect(t.filter((x) => x === 'tangent')).toHaveLength(4);
    // Each tangent keeps the side its curves meet on.
    for (const c of Object.values(i.data.constraints))
      if (c.type === 'tangent') expect(typeof c.reversed).toBe('boolean');
    expectPointsAt(i, [[0, 0, 0]], XY);
    expect(solveAsApp(i.data).moved).toBeLessThanOrEqual(1e-6);
  });

  it("places a circle from the sketch's origin and axes, drawn as fixed construction", () => {
    const i = one({
      geometry: [circle(15, 10, 4), line(5, 0, 5, 6), point(-3, 8), point(3, 8)],
      constraints: [
        constraint({ type: T.diameter, first: 0, value: 8 }),
        constraint({
          type: T.distanceX,
          first: H,
          firstPos: 1,
          second: 0,
          secondPos: 3,
          value: 15,
        }),
        constraint({ type: T.distanceY, first: 0, firstPos: 3, value: 10 }),
        constraint({ type: T.pointOnObject, first: 1, firstPos: 1, second: H }),
        constraint({ type: T.symmetric, first: 2, firstPos: 1, second: 3, secondPos: 1, third: V }),
        constraint({ type: T.vertical, first: 1 }),
      ],
    });
    const o = sketchOutcome(i);
    expect(o.perConstraint).toEqual(Array(6).fill('mapped'));
    const d = Object.values(i.data.dimensions);
    expect(d.map((x) => [x.type, x.expr])).toEqual([
      ['diameter', '8 mm'],
      ['distance', '15 mm'],
      ['distance', '10 mm'],
    ]);
    // The origin point and both axes, fixed; the axes are construction lines.
    const fixed = Object.values(i.data.constraints).filter((c) => c.type === 'fix');
    expect(fixed).toHaveLength(3);
    const lines = Object.values(i.data.entities).filter((e) => e.type === 'line');
    expect(lines.filter((l) => l.construction)).toHaveLength(2);
    expectPointsAt(i, [[0, 0, 0]], XY);
    expect(solveAsApp(i.data).moved).toBeLessThanOrEqual(1e-6);
  });

  it('leaves the datums out when nothing kept needs them', () => {
    const i = one({
      geometry: [line(0, 0, 10, 1)],
      // Horizontal on a slanted line: left out, and the H axis it never needed isn't drawn.
      constraints: [constraint({ type: T.pointOnObject, first: 0, firstPos: 2, second: H })],
    });
    expect(sketchOutcome(i).perConstraint).toEqual(['mismatch']);
    expect(Object.values(i.data.entities).filter((e) => e.type === 'line')).toHaveLength(1);
    expect(Object.values(i.data.constraints)).toEqual([]);
  });

  it('puts a sketch off an origin plane on an offset plane, shared by sketches on it', () => {
    const objects = [
      sketchObject({
        name: 'Top',
        geometry: [circle(5, 5, 3)],
        constraints: [constraint({ type: T.radius, first: 0, value: 3 })],
        placement: [0, 0, 12],
      }),
      sketchObject({ name: 'Top2', geometry: [line(0, 0, 4, 0)], placement: [1, 2, 12] }),
      // On XZ, 7 mm along its normal (−Y): FreeCAD's XZ frame is 90° about X.
      sketchObject({
        name: 'Front',
        geometry: [line(0, 0, 10, 0), line(10, 0, 10, 5)],
        constraints: [
          constraint({ type: T.horizontal, first: 0 }),
          constraint({ type: T.vertical, first: 1 }),
          constraint({ type: T.coincident, first: 0, firstPos: 2, second: 1, secondPos: 1 }),
        ],
        placement: [0, -7, 0, PI / 2, [1, 0, 0]],
      }),
    ];
    const design = Design.create();
    const top = load(objects, { design });
    expect(sketchOutcome(top).plane).toBe('offset');
    expectPointsAt(top, [[0, 0, 12]], { ...XY, origin: [0, 0, 12] });
    const top2 = load(objects, { design, which: 1 });
    expectPointsAt(top2, [[1, 2, 12]], { ...XY, origin: [0, 0, 12] });
    const planes = design.doc.features.filter((f) => f.type === 'offsetPlane');
    expect(planes).toHaveLength(1);
    expect(top.feature?.inputs.plane).toEqual(top2.feature?.inputs.plane);

    const front = load(objects, { which: 2 });
    expect(sketchOutcome(front)).toMatchObject({ plane: 'offset', mirrored: false, axes: 'same' });
    expect(sketchOutcome(front).perConstraint).toEqual(['mapped', 'mapped', 'mapped']);
    expectPointsAt(front, [[0, -7, 0, PI / 2, [1, 0, 0]]], { ...XZ, origin: [0, -7, 0] });
    expect(types(front.data)).toEqual(['coincident', 'horizontal', 'vertical']);
    expect(solveAsApp(front.data).moved).toBeLessThanOrEqual(1e-6);
  });

  it('mirrors a sketch whose normal is against the plane, arcs turned round', () => {
    const at: At = [0, 0, 0, PI, [1, 0, 0]];
    const i = one({
      geometry: [
        arc(0, 0, 10, 0, PI / 2),
        line(0, 10, -20, 10),
        // About a downward normal: clockwise from (25, 0) to (30, 5), so its first point is (30, 5).
        arc(30, 0, 5, 0, PI / 2, { reversed: true }),
        point(30, 5),
        point(25, 0),
      ],
      constraints: [
        constraint({
          type: T.tangent,
          first: 0,
          firstPos: 2,
          second: 1,
          secondPos: 1,
          value: -PI / 2,
        }),
        constraint({ type: T.horizontal, first: 1 }),
        constraint({ type: T.coincident, first: 2, firstPos: 1, second: 3, secondPos: 1 }),
        constraint({ type: T.coincident, first: 2, firstPos: 2, second: 4, secondPos: 1 }),
        constraint({ type: T.distanceX, first: 1, value: -20 }),
        constraint({ type: T.radius, first: 0, value: 10 }),
      ],
      placement: at,
    });
    const o = sketchOutcome(i);
    expect(o).toMatchObject({ plane: 'origin', mirrored: true, axes: 'same' });
    expect(o.perConstraint).toEqual(Array(6).fill('mapped'));
    expectPointsAt(i, [at], XY);
    expect(solveAsApp(i.data).moved).toBeLessThanOrEqual(1e-6);
  });

  it('keeps construction geometry as construction', () => {
    const i = one({
      geometry: [line(0, 0, 10, 0, { construction: true }), circle(5, 5, 2)],
      constraints: [],
    });
    const e = Object.values(i.data.entities);
    expect(e.filter((x) => x.type === 'line').map((x) => x.construction)).toEqual([true]);
    expect(e.filter((x) => x.type === 'circle').map((x) => x.construction)).toEqual([false]);
    expect(sketchOutcome(i).drawn).toEqual({ line: 1, construction: 1, circle: 1 });
  });

  it('reads the construction flag in each version’s form', () => {
    for (const [form, version] of [
      ['legacy', '0.18.4'],
      ['extension', '0.20.2'],
      ['both', '1.0.0'],
    ] as const) {
      const i = one(
        {
          geometry: [line(0, 0, 1, 0, { construction: true, form }), line(0, 1, 1, 1, { form })],
        },
        { version },
      );
      const g = decodeSketch(i.object).geometry;
      expect(
        g.map((x) => x?.construction),
        form,
      ).toEqual([true, false]);
    }
  });

  it('brings in a reference dimension as driven, outside the solve', () => {
    const i = one({
      geometry: [line(0, 0, 30, 0)],
      constraints: [
        constraint({ type: T.horizontal, first: 0 }),
        constraint({ type: T.distanceX, first: 0, value: 30, driving: false }),
      ],
    });
    expect(sketchOutcome(i).perConstraint).toEqual(['mapped', 'mapped']);
    const [d] = Object.values(i.data.dimensions);
    expect(d).toMatchObject({ type: 'distance', driven: true, expr: '30 mm' });
    expect(d?.paramName).toBeUndefined();
  });

  it('keeps a bound constraint’s stored number and returns the binding', () => {
    const i = one({
      name: 'Plate',
      geometry: [line(0, 0, 30, 0), circle(10, 10, 2.5)],
      constraints: [
        constraint({ type: T.distanceX, first: 0, value: 30, name: 'width' }),
        constraint({ type: T.radius, first: 1, value: 2.5 }),
        constraint({ type: T.horizontal, first: 0 }),
      ],
      expressions: [
        { path: '.Constraints.width', expression: 'Sheet.w' },
        { path: '.Constraints[1]', expression: 'width / 12' },
        { path: 'Placement.Base.z', expression: '3' },
      ],
    });
    const o = sketchOutcome(i);
    expect(o.perConstraint).toEqual(['mapped', 'mapped', 'mapped']);
    const dims = Object.entries(i.data.dimensions);
    const width = dims.find(([, d]) => d.paramName === 'width');
    expect(width?.[1].expr).toBe('30 mm');
    const radius = dims.find(([, d]) => d.type === 'radius');
    expect(o.bindings).toEqual([
      {
        sketch: 'Plate',
        index: 0,
        name: 'width',
        path: '.Constraints.width',
        expression: 'Sheet.w',
        dimension: width?.[0],
      },
      {
        sketch: 'Plate',
        index: 1,
        name: '',
        path: '.Constraints[1]',
        expression: 'width / 12',
        dimension: radius?.[0],
      },
    ]);
  });

  it('leaves out what the geometry does not satisfy, and moves nothing', () => {
    const i = one({
      geometry: [line(0, 0, 30, 0), line(30, 0, 40, 10)],
      constraints: [
        constraint({ type: T.distanceX, first: 0, value: 25 }),
        constraint({ type: T.horizontal, first: 1 }),
        constraint({ type: T.coincident, first: 0, firstPos: 2, second: 1, secondPos: 1 }),
        constraint({ type: T.horizontal, first: 0 }),
        // The same again: redundant.
        constraint({ type: T.horizontal, first: 0 }),
      ],
    });
    expect(sketchOutcome(i).perConstraint).toEqual([
      'mismatch',
      'mismatch',
      'mapped',
      'mapped',
      'overconstrains',
    ]);
    expectPointsAt(i, [[0, 0, 0]], XY);
    expect(solveAsApp(i.data).moved).toBeLessThanOrEqual(1e-6);
  });

  it('leaves out what would move the sketch when solved, one constraint of a pair', () => {
    // FreeCAD's line–arc tangency is a distance; the arc's centre is 2e-5 mm off square
    // under the joint, so Extrudo's joint tangency would turn the arc.
    const off = 2e-5;
    const r = Math.hypot(off, 10);
    const i = one({
      geometry: [line(0, 10, 20, 10), arc(20 - off, 0, r, 0, Math.atan2(10, off))],
      constraints: [
        constraint({ type: T.coincident, first: 0, firstPos: 2, second: 1, secondPos: 2 }),
        constraint({ type: T.tangent, first: 0, second: 1 }),
      ],
    });
    const o = sketchOutcome(i).perConstraint;
    expect(o.filter((x) => x === 'moves')).toHaveLength(1);
    expect(o.filter((x) => x === 'mapped')).toHaveLength(1);
    expectPointsAt(i, [[0, 0, 0]], XY);
    expect(solveAsApp(i.data).moved).toBeLessThanOrEqual(1e-6);
  });

  it('leaves out an ellipse and the constraints on it, counted', () => {
    const i = one({
      geometry: [ellipse(0, 0, 10, 5), line(0, 0, 10, 0)],
      constraints: [
        constraint({ type: T.coincident, first: 0, firstPos: 3, second: 1, secondPos: 1 }),
        constraint({ type: T.horizontal, first: 1 }),
      ],
    });
    const o = sketchOutcome(i);
    expect(o.geometryLeftOut).toEqual({ ellipse: 1 });
    expect(o.perConstraint).toEqual(['geometry', 'mapped']);
    expect(o.constraints.leftOut).toEqual({ geometry: 1 });
  });

  it('brings in a plain B-spline as a control spline, its helpers left out', () => {
    const i = one({
      geometry: [
        bspline(
          [
            [0, 0],
            [5, 8],
            [10, 0],
          ],
          [
            [0, 3],
            [36402, 3],
          ],
          2,
        ),
        circle(0, 0, 1, { construction: true, internal: 9 }),
        bspline(
          [
            [0, 0],
            [5, 8],
            [10, 0],
          ],
          [
            [0, 3],
            [1, 3],
          ],
          2,
          { weights: [1, 2, 1] },
        ),
      ],
      constraints: [
        constraint({ type: T.internalAlignment, first: 1, firstPos: 3, second: 0 }),
        constraint({ type: T.equal, first: 1, second: 0 }),
      ],
    });
    const o = sketchOutcome(i);
    expect(o.drawn).toEqual({ spline: 1 });
    expect(o.geometryLeftOut).toEqual({ internal: 1, 'rational-bspline': 1 });
    expect(o.perConstraint).toEqual(['internal', 'internal']);
    const [s] = Object.values(i.data.entities).filter((e) => e.type === 'spline');
    expect(s).toMatchObject({ mode: 'control', degree: 2, knots: [0, 0, 0, 1, 1, 1] });
  });

  it('places a sketch in a moved body in world coordinates, axes and all', () => {
    // The body is 90° about Z and 10 mm along X: FreeCAD's sketch x is Extrudo's y.
    const body: At = [10, 0, 0, PI / 2, [0, 0, 1]];
    const sketch = sketchObject({
      geometry: [line(0, 0, 20, 0), line(20, 0, 20, 5)],
      constraints: [
        constraint({ type: T.horizontal, first: 0 }),
        constraint({ type: T.distanceX, first: 0, value: 20 }),
        constraint({ type: T.distanceY, first: 1, value: 5 }),
      ],
    });
    const i = load([bodyObject(['Sketch'], body), sketch]);
    const o = sketchOutcome(i);
    expect(o).toMatchObject({ containers: 1, movedContainer: true, axes: 'swap', plane: 'origin' });
    expect(o.perConstraint).toEqual(['mapped', 'mapped', 'mapped']);
    expect(types(i.data)).toEqual(['vertical']);
    expect(
      Object.values(i.data.dimensions).map((d) => (d as { orientation: string }).orientation),
    ).toEqual(['vertical', 'horizontal']);
    expectPointsAt(i, [body, [0, 0, 0]], XY);
    expect(solveAsApp(i.data).moved).toBeLessThanOrEqual(1e-6);
  });

  it('keeps level lines level in a frame turned in its plane, against the drawn axis', () => {
    const at: At = [0, 0, 0, PI / 6, [0, 0, 1]];
    const i = one({
      geometry: [line(0, 0, 20, 0), line(0, 0, 0, 5)],
      constraints: [
        constraint({ type: T.horizontal, first: 0 }),
        constraint({ type: T.vertical, first: 1 }),
        constraint({ type: T.distanceX, first: 0, value: 20 }),
      ],
      placement: at,
    });
    const o = sketchOutcome(i);
    expect(o.axes).toBe('rotated');
    expect(o.perConstraint).toEqual(['mapped', 'mapped', 'unsupported']);
    expect(types(i.data)).toEqual(['fix', 'fix', 'parallel', 'parallel']);
    expectPointsAt(i, [at], XY);
    expect(solveAsApp(i.data).moved).toBeLessThanOrEqual(1e-6);
  });

  it('draws the geometry but imports no constraint without a solver', () => {
    const i = one({ geometry: rectangle, constraints: corners }, { solver: false });
    expect(sketchOutcome(i).perConstraint).toEqual(Array(4).fill('unchecked'));
    expect(Object.values(i.data.constraints)).toEqual([]);
    expectPointsAt(i, [[0, 0, 0]], XY);
  });

  it('gives a tilted sketch no plane, and says why', () => {
    const i = one({
      geometry: rectangle,
      constraints: corners,
      placement: [0, 0, 0, 0.5, [1, 1, 0]],
    });
    expect(i.result.imported).toBe(false);
    if (!i.result.imported) expect(i.result.reason).toBe(NO_PLANE);
    expect(i.design.doc.features).toEqual([]);
  });
});
