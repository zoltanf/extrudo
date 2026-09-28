import type { SketchData } from '@extrudo/core';
import { SketchDataSchema } from '@extrudo/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { plate, SketchBuilder } from '../fixtures';
import { splitComponents } from './components';
import { mapSketch } from './mapping';
import { loadPlanegcs, type PlanegcsModule } from './module';
import { applySolution, SketchSolver, type SolveResult } from './solver';
import { tangentReversed } from './tangent';

let module: PlanegcsModule;
beforeAll(async () => {
  module = await loadPlanegcs();
});

const solvers: SketchSolver[] = [];
afterAll(() => {
  for (const solver of solvers) solver.dispose();
});
const newSolver = () => {
  const solver = new SketchSolver(module);
  solvers.push(solver);
  return solver;
};

interface Solved {
  result: SolveResult;
  sketch: SketchData;
  p: (id: string) => { x: number; y: number };
  r: (id: string) => number;
}

/** Solves the builder's sketch once (validated by the document schema first). */
function solve(b: SketchBuilder, solver = newSolver()): Solved {
  const input = SketchDataSchema.parse(b.sketch);
  const result = solver.solve(input, b.values);
  const sketch = applySolution(input, result.solution);
  const entities = sketch.entities as Record<
    string,
    SketchData['entities'][keyof SketchData['entities']]
  >;
  const p = (id: string) => {
    const e = entities[id];
    if (e?.type !== 'point') throw new Error(`${id} is not a point`);
    return { x: e.x, y: e.y };
  };
  const r = (id: string) => {
    const e = entities[id];
    if (e?.type === 'circle') return e.radius;
    if (e?.type === 'arc') return dist(p(e.center), p(e.start));
    throw new Error(`${id} is not round`);
  };
  return { result, sketch, p, r };
}

type V = { x: number; y: number };
const dist = (a: V, b: V) => Math.hypot(a.x - b.x, a.y - b.y);
const sub = (a: V, b: V) => ({ x: a.x - b.x, y: a.y - b.y });
const cross = (a: V, b: V) => a.x * b.y - a.y * b.x;
const dot = (a: V, b: V) => a.x * b.x + a.y * b.y;
const unit = (v: V) => ({ x: v.x / Math.hypot(v.x, v.y), y: v.y / Math.hypot(v.x, v.y) });
/** Distance from a point to the infinite line through a and b. */
const toLine = (p: V, a: V, b: V) => Math.abs(cross(sub(b, a), sub(p, a))) / dist(a, b);
const close = (value: number, expected: number, digits = 6) =>
  expect(value).toBeCloseTo(expected, digits);

/** Expects a clean solve: converged, nothing conflicting or redundant. */
function clean(s: Solved, dof: number) {
  expect(s.result.ok).toBe(true);
  expect(s.result.conflicting).toEqual([]);
  expect(s.result.redundant).toEqual([]);
  expect(s.result.dof).toBe(dof);
}

describe('constraints (one per type)', () => {
  it('coincident joins two points', () => {
    const b = new SketchBuilder();
    const [p, q] = [b.point(0, 0), b.point(3, 4)];
    b.constrain({ type: 'coincident', a: p, b: q });
    const s = solve(b);
    clean(s, 2);
    close(dist(s.p(p), s.p(q)), 0);
  });

  it('pointOnCurve puts a point on a line, a circle and an arc', () => {
    const b = new SketchBuilder();
    const line = b.line(0, 0, 10, 0);
    const circle = b.circle(30, 0, 5);
    const arc = b.arc(60, 0, 5, 0, 90);
    const [p1, p2, p3] = [b.point(5, 3), b.point(30, 9), b.point(62, 7)];
    b.constrain({ type: 'pointOnCurve', point: p1, curve: line.id });
    b.constrain({ type: 'pointOnCurve', point: p2, curve: circle.id });
    b.constrain({ type: 'pointOnCurve', point: p3, curve: arc.id });
    const s = solve(b);
    clean(s, 4 + 2 + 3 + 2 + 5 + 2 - 3);
    close(toLine(s.p(p1), s.p(line.start), s.p(line.end)), 0);
    close(dist(s.p(p2), s.p(circle.center)), s.r(circle.id));
    close(dist(s.p(p3), s.p(arc.center)), s.r(arc.id));
  });

  it('collinear puts two lines on one line', () => {
    const b = new SketchBuilder();
    const a = b.line(0, 0, 10, 0);
    const c = b.line(15, 2, 25, 3);
    b.constrain({ type: 'collinear', a: a.id, b: c.id });
    const s = solve(b);
    clean(s, 6);
    close(toLine(s.p(c.start), s.p(a.start), s.p(a.end)), 0);
    close(toLine(s.p(c.end), s.p(a.start), s.p(a.end)), 0);
  });

  it('concentric shares the centre of a circle and an arc', () => {
    const b = new SketchBuilder();
    const circle = b.circle(0, 0, 5);
    const arc = b.arc(2, 1, 8, 0, 120);
    b.constrain({ type: 'concentric', a: circle.id, b: arc.id });
    const s = solve(b);
    clean(s, 6);
    close(dist(s.p(circle.center), s.p(arc.center)), 0);
  });

  it('midpoint of a line and of an arc', () => {
    const b = new SketchBuilder();
    const line = b.line(0, 0, 10, 0);
    const arc = b.arc(30, 0, 5, 0, 90);
    const [m1, m2] = [b.point(4, 2), b.point(33, 5)];
    b.constrain({ type: 'midpoint', point: m1, of: line.id });
    b.constrain({ type: 'midpoint', point: m2, of: arc.id });
    const s = solve(b);
    clean(s, 4 + 5);
    const [ls, le] = [s.p(line.start), s.p(line.end)];
    close(s.p(m1).x, (ls.x + le.x) / 2);
    close(s.p(m1).y, (ls.y + le.y) / 2);
    close(dist(s.p(m2), s.p(arc.center)), s.r(arc.id));
    close(dist(s.p(m2), s.p(arc.start)), dist(s.p(m2), s.p(arc.end)));
  });

  it('fix keeps a point, a line and a circle where they are', () => {
    const b = new SketchBuilder();
    const p = b.point(1, 2);
    const line = b.line(10, 0, 20, 5);
    const circle = b.circle(40, 0, 3);
    const free = b.point(7, 7);
    b.constrain({ type: 'fix', entity: p });
    b.constrain({ type: 'fix', entity: line.id });
    b.constrain({ type: 'fix', entity: circle.id });
    b.constrain({ type: 'coincident', a: free, b: line.end });
    const s = solve(b);
    clean(s, 0);
    expect(s.p(p)).toEqual({ x: 1, y: 2 });
    expect(s.p(line.end)).toEqual({ x: 20, y: 5 });
    close(dist(s.p(free), { x: 20, y: 5 }), 0);
    expect(s.r(circle.id)).toBe(3);
  });

  it('parallel and perpendicular lines', () => {
    const b = new SketchBuilder();
    const a = b.line(0, 0, 10, 1);
    const c = b.line(0, 5, 10, 8);
    const d = b.line(20, 0, 22, 10);
    b.constrain({ type: 'parallel', a: a.id, b: c.id });
    b.constrain({ type: 'perpendicular', a: a.id, b: d.id });
    const s = solve(b);
    clean(s, 12 - 2);
    const u = sub(s.p(a.end), s.p(a.start));
    close(cross(unit(u), unit(sub(s.p(c.end), s.p(c.start)))), 0);
    close(dot(unit(u), unit(sub(s.p(d.end), s.p(d.start)))), 0);
  });

  it('horizontal and vertical, on a line or on two points', () => {
    const b = new SketchBuilder();
    const h = b.line(0, 0, 10, 2);
    const v = b.line(20, 0, 21, 10);
    const [p1, p2, q1, q2] = [b.point(0, 20), b.point(5, 23), b.point(10, 20), b.point(12, 30)];
    b.constrain({ type: 'horizontal', a: h.id });
    b.constrain({ type: 'vertical', a: v.id });
    b.constrain({ type: 'horizontal', a: p1, b: p2 });
    b.constrain({ type: 'vertical', a: q1, b: q2 });
    const s = solve(b);
    clean(s, 16 - 4);
    close(s.p(h.start).y, s.p(h.end).y);
    close(s.p(v.start).x, s.p(v.end).x);
    close(s.p(p1).y, s.p(p2).y);
    close(s.p(q1).x, s.p(q2).x);
  });

  it('tangent between curves that only touch', () => {
    const b = new SketchBuilder();
    const line = b.line(-10, 6, 10, 6);
    const circle = b.circle(0, 0, 5);
    const c2 = b.circle(12, 1, 6);
    const arc = b.arc(0, -20, 4, 0, 180);
    const line2 = b.line(-10, -15, 10, -14);
    const c3 = b.circle(10, -20, 5);
    b.constrain({ type: 'tangent', a: line.id, b: circle.id });
    b.constrain({ type: 'tangent', a: circle.id, b: c2.id });
    b.constrain({ type: 'tangent', a: arc.id, b: line2.id });
    b.constrain({ type: 'tangent', a: c3.id, b: arc.id });
    const s = solve(b);
    clean(s, 4 + 3 + 3 + 5 + 4 + 3 - 4);
    close(toLine(s.p(circle.center), s.p(line.start), s.p(line.end)), s.r(circle.id));
    close(dist(s.p(circle.center), s.p(c2.center)), s.r(circle.id) + s.r(c2.id));
    close(toLine(s.p(arc.center), s.p(line2.start), s.p(line2.end)), s.r(arc.id));
    close(dist(s.p(c3.center), s.p(arc.center)), s.r(c3.id) + s.r(arc.id));
  });

  it('tangent at an endpoint joint keeps the side and reports no false redundancy', () => {
    // A line running into a quarter arc (same direction), and an arc into an arc.
    const b = new SketchBuilder();
    const line = b.line(-10, 5.5, 0, 5);
    const arc = b.arc(0, 0, 5, 90, 180);
    const arc2 = b.arc(-12, 0, 7, 0, 90);
    b.constrain({ type: 'coincident', a: line.end, b: arc.start });
    b.constrain({ type: 'coincident', a: arc.end, b: arc2.start });
    b.constrain({ type: 'tangent', a: line.id, b: arc.id });
    b.constrain({ type: 'smooth', a: arc.id, b: arc2.id });
    const s = solve(b);
    clean(s, 4 + 5 + 5 - 2 - 2 - 1 - 1);
    // The line's direction and the arc's (counter-clockwise) at the joint are parallel.
    const joint = s.p(arc.start);
    const radial = sub(joint, s.p(arc.center));
    close(cross(unit(sub(s.p(line.end), s.p(line.start))), unit({ x: -radial.y, y: radial.x })), 0);
    expect(tangentReversed(s.sketch, line.id, arc.id)).toBe(true);
    expect(tangentReversed(s.sketch, arc.id, arc2.id)).toBe(true);
  });

  it('tangent honours a stored side', () => {
    const b = new SketchBuilder();
    const line = b.line(0, 5, 10, 5);
    const arc = b.arc(10, 0, 5, 0, 90);
    b.constrain({ type: 'coincident', a: line.end, b: arc.end });
    // The line runs into the arc's end, against the arc's direction…
    const k = b.constrain({ type: 'tangent', a: line.id, b: arc.id });
    expect(tangentReversed(b.sketch, line.id, arc.id)).toBe(true);
    const free = solve(b);
    clean(free, 4 + 5 - 3);
    // …and a stored side wins over the geometry: the arc turns over.
    (b.constraints[k] as { reversed?: boolean }).reversed = false;
    const flipped = solve(b);
    expect(flipped.result.ok).toBe(true);
    const joint = flipped.p(arc.end);
    const radial = sub(joint, flipped.p(arc.center));
    const arcDir = unit({ x: -radial.y, y: radial.x });
    const lineDir = unit(sub(flipped.p(line.end), flipped.p(line.start)));
    close(dot(lineDir, arcDir), 1);
    expect(tangentReversed(b.sketch, b.point(0, 0), line.id)).toBeUndefined();
  });

  it('equal lengths and radii', () => {
    const b = new SketchBuilder();
    const l1 = b.line(0, 0, 10, 0);
    const l2 = b.line(0, 5, 14, 5);
    const c1 = b.circle(30, 0, 5);
    const c2 = b.circle(45, 0, 7);
    const a1 = b.arc(60, 0, 4, 0, 90);
    const a2 = b.arc(75, 0, 6, 0, 90);
    b.constrain({ type: 'equal', a: l1.id, b: l2.id });
    b.constrain({ type: 'equal', a: c1.id, b: c2.id });
    b.constrain({ type: 'equal', a: c1.id, b: a1.id });
    b.constrain({ type: 'equal', a: a2.id, b: a1.id });
    const s = solve(b);
    clean(s, 8 + 6 + 10 - 4);
    close(dist(s.p(l1.start), s.p(l1.end)), dist(s.p(l2.start), s.p(l2.end)));
    close(s.r(c1.id), s.r(c2.id));
    close(s.r(c1.id), s.r(a1.id));
    close(s.r(a2.id), s.r(a1.id));
  });

  it('symmetric points, lines, circles and arcs about a line', () => {
    const b = new SketchBuilder();
    const axis = b.line(0, -10, 0, 50, true);
    b.constrain({ type: 'fix', entity: axis.id });
    const [p, q] = [b.point(-3, 0), b.point(4, 1)];
    const l1 = b.line(-10, 10, -2, 12);
    const l2 = b.line(3, 13, 9, 9);
    const c1 = b.circle(-5, 25, 2);
    const c2 = b.circle(6, 24, 3);
    const a1 = b.arc(-5, 40, 3, 0, 90);
    const a2 = b.arc(6, 41, 3.5, 90, 180);
    b.constrain({ type: 'symmetric', a: p, b: q, axis: axis.id });
    b.constrain({ type: 'symmetric', a: l1.id, b: l2.id, axis: axis.id });
    b.constrain({ type: 'symmetric', a: c1.id, b: c2.id, axis: axis.id });
    b.constrain({ type: 'symmetric', a: a1.id, b: a2.id, axis: axis.id });
    const s = solve(b);
    clean(s, 4 + 8 + 6 + 10 - 2 - 4 - 3 - 5);
    const mirrored = (m: string, n: string) => {
      close(s.p(m).x, -s.p(n).x);
      close(s.p(m).y, s.p(n).y);
    };
    mirrored(p, q);
    mirrored(l1.start, l2.end);
    mirrored(l1.end, l2.start);
    mirrored(c1.center, c2.center);
    close(s.r(c1.id), s.r(c2.id));
    mirrored(a1.center, a2.center);
    mirrored(a1.start, a2.end);
    mirrored(a1.end, a2.start);
  });

  it('a constraint on fixed geometry only is redundant', () => {
    const b = new SketchBuilder();
    const [p, q] = [b.point(0, 0), b.point(5, 0)];
    b.constrain({ type: 'fix', entity: p });
    b.constrain({ type: 'fix', entity: q });
    const k = b.constrain({ type: 'horizontal', a: p, b: q });
    const s = solve(b);
    expect(s.result.redundant).toEqual([k]);
    expect(s.result.dof).toBe(0);
  });
});

describe('dimensions (one per type)', () => {
  it('aligned distance: a line, two points, point to line, two parallel lines', () => {
    const b = new SketchBuilder();
    const line = b.line(0, 0, 10, 3);
    const [p, q] = [b.point(0, 20), b.point(4, 22)];
    const r = b.point(30, 7);
    const base = b.line(20, 0, 40, 0);
    const other = b.line(20, 12, 40, 11);
    b.dimension({ type: 'distance', orientation: 'aligned', a: line.id }, 25);
    b.dimension({ type: 'distance', orientation: 'aligned', a: p, b: q }, 8);
    b.dimension({ type: 'distance', orientation: 'aligned', a: r, b: base.id }, 5);
    b.constrain({ type: 'parallel', a: base.id, b: other.id });
    b.dimension({ type: 'distance', orientation: 'aligned', a: base.id, b: other.id }, 9);
    const s = solve(b);
    clean(s, 4 + 4 + 2 + 8 - 5);
    close(dist(s.p(line.start), s.p(line.end)), 25);
    close(dist(s.p(p), s.p(q)), 8);
    close(toLine(s.p(r), s.p(base.start), s.p(base.end)), 5);
    close(toLine(s.p(other.start), s.p(base.start), s.p(base.end)), 9);
    close(toLine(s.p(other.end), s.p(base.start), s.p(base.end)), 9);
  });

  it('horizontal and vertical distances keep their sign', () => {
    const b = new SketchBuilder();
    const [p, q] = [b.point(10, 0), b.point(4, 3)];
    const line = b.line(20, 0, 22, 9);
    b.dimension({ type: 'distance', orientation: 'horizontal', a: p, b: q }, 15);
    b.dimension({ type: 'distance', orientation: 'vertical', a: p, b: q }, 7);
    b.dimension({ type: 'distance', orientation: 'horizontal', a: line.id }, 5);
    const s = solve(b);
    clean(s, 8 - 3);
    close(s.p(p).x - s.p(q).x, 15); // q stays left of p
    close(s.p(q).y - s.p(p).y, 7);
    close(s.p(line.end).x - s.p(line.start).x, 5);
  });

  it('radius and diameter of circles and arcs', () => {
    const b = new SketchBuilder();
    const [c1, c2] = [b.circle(0, 0, 3), b.circle(20, 0, 3)];
    const [a1, a2] = [b.arc(40, 0, 3, 0, 90), b.arc(60, 0, 3, 45, 200)];
    b.dimension({ type: 'radius', curve: c1.id }, 7);
    b.dimension({ type: 'diameter', curve: c2.id }, 9);
    b.dimension({ type: 'radius', curve: a1.id }, 4.5);
    b.dimension({ type: 'diameter', curve: a2.id }, 12);
    const s = solve(b);
    clean(s, 6 + 10 - 4);
    close(s.r(c1.id), 7);
    close(s.r(c2.id), 4.5);
    close(s.r(a1.id), 4.5);
    close(s.r(a2.id), 6);
  });

  it('angle between two lines, and a new value turns without flipping', () => {
    const b = new SketchBuilder();
    const a = b.line(0, 0, 10, 0);
    const c = b.line(0, 0, 8, -5);
    b.constrain({ type: 'fix', entity: a.id });
    b.constrain({ type: 'coincident', a: a.start, b: c.start });
    const d = b.dimension({ type: 'angle', a: a.id, b: c.id }, 40);
    const angle = (s: Solved) => {
      const u = sub(s.p(a.end), s.p(a.start));
      const v = sub(s.p(c.end), s.p(c.start));
      return (Math.atan2(cross(u, v), dot(u, v)) * 180) / Math.PI;
    };
    const solver = newSolver();
    const s = solve(b, solver);
    clean(s, 1);
    close(angle(s), -40); // c was below a, so it stays below
    b.values[d] = 150;
    close(angle(solve(b, solver)), -150);
  });

  it('a supplement angle dimensions the other pair of angles (P1-07)', () => {
    const b = new SketchBuilder();
    const a = b.line(0, 0, 10, 0);
    const c = b.line(0, 0, 8, 5);
    b.constrain({ type: 'fix', entity: a.id });
    b.constrain({ type: 'coincident', a: a.start, b: c.start });
    b.dimension({ type: 'angle', a: a.id, b: c.id, supplement: true }, 120);
    const s = solve(b);
    clean(s, 1);
    const u = sub(s.p(a.end), s.p(a.start));
    const v = sub(s.p(c.end), s.p(c.start));
    close((Math.atan2(cross(u, v), dot(u, v)) * 180) / Math.PI, 60);
  });

  it('driven dimensions and dimensions without a value are left out', () => {
    const b = new SketchBuilder();
    const line = b.line(0, 0, 10, 0);
    const driven = b.dimension({ type: 'distance', orientation: 'aligned', a: line.id }, 30);
    (b.dimensions[driven] as { driven: boolean }).driven = true;
    const missing = b.dimension({ type: 'radius', curve: b.circle(0, 0, 1).id }, 2);
    delete b.values[missing];
    const s = solve(b);
    clean(s, 7);
    expect(s.result.skipped.sort()).toEqual([driven, missing].sort());
    close(dist(s.p(line.start), s.p(line.end)), 10);
  });
});

describe('components', () => {
  it('splits cells anchored to a fixed point, and not chained ones', () => {
    for (const [layout, expected] of [
      ['anchored', 4],
      ['chained', 1],
    ] as const) {
      const { builder } = plate({ entities: 36, layout });
      const split = splitComponents(mapSketch(builder.sketch, builder.values));
      expect(split.components).toHaveLength(expected);
      // Each anchored component carries its own copy of the fixed origin.
      const origin = Object.keys(builder.constraints)
        .map((k) => builder.constraints[k])
        .find((c) => c?.type === 'fix');
      for (const c of split.components) {
        expect(c.items.some((i) => origin?.type === 'fix' && i.id === origin.entity)).toBe(true);
        expect(c.entities).not.toContain(origin?.type === 'fix' ? origin.entity : '');
      }
    }
  });

  it('solves generated plates from a perturbed start to DOF 0', () => {
    for (const layout of ['anchored', 'chained'] as const) {
      const { builder } = plate({ entities: 27, layout, noise: 2 });
      const s = solve(builder);
      clean(s, 0);
    }
  });
});

describe('incremental solving', () => {
  it('skips unchanged components, updates values in place, rebuilds changed ones', () => {
    const { builder } = plate({ entities: 27, layout: 'anchored', noise: 1 });
    const solver = newSolver();
    let sketch = SketchDataSchema.parse(builder.sketch);
    let result = solver.solve(sketch, builder.values);
    expect(solver.stats).toEqual({ builds: 3, updates: 0, unchanged: 0 });
    sketch = applySolution(sketch, result.solution);

    // Writing the solution back changes point objects: one value update per component.
    result = solver.solve(sketch, builder.values);
    expect(solver.stats).toEqual({ builds: 3, updates: 3, unchanged: 0 });
    result = solver.solve(sketch, builder.values);
    expect(solver.stats).toEqual({ builds: 3, updates: 3, unchanged: 3 });

    // A dimension value: only its component is solved again, without a rebuild.
    const hole = Object.entries(sketch.dimensions).find(([, d]) => d.type === 'diameter');
    const holeId = hole?.[0] as string;
    result = solver.solve(sketch, { ...builder.values, [holeId]: 12 });
    expect(solver.stats).toEqual({ builds: 3, updates: 4, unchanged: 5 });
    expect(result.ok).toBe(true);

    // A new constraint: only its component is rebuilt.
    const circle = Object.entries(sketch.entities).find(
      ([, e]) => e.type === 'circle',
    )?.[0] as string;
    const fixed: SketchData = {
      ...sketch,
      dimensions: Object.fromEntries(
        Object.entries(sketch.dimensions).filter(([id]) => id !== holeId),
      ) as SketchData['dimensions'],
      constraints: { ...sketch.constraints, kx: { type: 'fix', entity: circle } } as never,
    };
    result = solver.solve(fixed, builder.values);
    expect(solver.stats.builds).toBe(4);
    expect(result.dof).toBe(0);
    expect(solver.systemCount).toBe(3);
  });

  it('frees the systems of components that disappear', () => {
    const { builder } = plate({ entities: 27, layout: 'anchored' });
    const solver = newSolver();
    solver.solve(SketchDataSchema.parse(builder.sketch), builder.values);
    expect(solver.systemCount).toBe(3);
    solver.solve({ entities: {}, constraints: {}, dimensions: {} } as never, {});
    expect(solver.systemCount).toBe(0);
  });
});

describe('dragging', () => {
  it('moves a free corner within its constraints, and refuses fixed points', () => {
    const { builder, dragPoint } = plate({
      entities: 18,
      layout: 'anchored',
      freeLastHeight: true,
    });
    const solver = newSolver();
    const sketch = SketchDataSchema.parse(builder.sketch);
    const before = solver.solve(sketch, builder.values);
    expect(before.dof).toBe(1);
    const origin = Object.values(sketch.constraints).find((c) => c.type === 'fix');
    expect(solver.beginDrag(origin?.type === 'fix' ? origin.entity : '')).toBe(false);
    const start = before.solution.points[dragPoint] as V;

    expect(solver.beginDrag(dragPoint)).toBe(true);
    for (let i = 1; i <= 20; i++) {
      const step = solver.drag(start.x + 3, start.y + i);
      expect(step.ok).toBe(true);
      expect(step.dof).toBe(1);
    }
    const last = solver.drag(start.x + 3, start.y + 20);
    const corner = last.solution.points[dragPoint] as V;
    close(corner.y, start.y + 20); // the height follows the pointer
    close(corner.x, start.x); // the width is dimensioned
    solver.endDrag();

    // The next solve rebuilds the dragged component only.
    const builds = solver.stats.builds;
    const after = solver.solve(applySolution(sketch, last.solution), builder.values);
    expect(solver.stats.builds).toBe(builds + 1);
    close((after.solution.points[dragPoint] as V).y, start.y + 20);
  });
});

describe('dragging several points (P1-09)', () => {
  it('moves a line by both ends, and a lone circle with it, by the same offset', () => {
    const b = new SketchBuilder();
    const l = b.line(0, 0, 10, 0);
    b.constrain({ type: 'horizontal', a: l.id });
    const c = b.circle(30, 0, 5);
    const fixed = b.point(50, 50);
    b.constrain({ type: 'fix', entity: fixed });
    const solver = newSolver();
    const sketch = SketchDataSchema.parse(b.sketch);
    solver.solve(sketch, b.values);
    // The fixed point has no unknowns: it is left out, and the drag goes on without it.
    expect(solver.beginDrag([fixed, l.start, l.end, c.center])).toBe(true);
    const step = solver.drag(3, 4);
    expect(step.ok).toBe(true);
    const at = (id: string) => step.solution.points[id] as V;
    close(at(l.start).x, 3);
    close(at(l.start).y, 4);
    close(at(l.end).x, 13);
    close(at(l.end).y, 4);
    close(at(c.center).x, 33);
    close(at(c.center).y, 4);
    close(step.solution.radii[c.id] as number, 5);
    expect(step.solution.points[fixed]).toBeUndefined();
    solver.endDrag();
    expect(solver.beginDrag([fixed])).toBe(false);
  });
});

describe('dragging a circle rim (resize)', () => {
  it('resizes a circle whose centre is fixed, and keeps the centre of a free one', () => {
    const b = new SketchBuilder();
    const pinned = b.circle(0, 0, 5);
    b.constrain({ type: 'fix', entity: pinned.center });
    const loose = b.circle(30, 0, 4);
    const solver = newSolver();
    solver.solve(SketchDataSchema.parse(b.sketch), b.values);

    expect(solver.beginRadiusDrag(pinned.id)).toBe(true);
    for (const r of [6, 8, 12]) {
      const step = solver.dragRadius(r);
      expect(step.ok).toBe(true);
      close(step.solution.radii[pinned.id] as number, r);
    }
    solver.endDrag();

    expect(solver.beginRadiusDrag(loose.id)).toBe(true);
    const step = solver.dragRadius(9);
    close(step.solution.radii[loose.id] as number, 9);
    const centre = step.solution.points[loose.center] as V;
    close(centre.x, 30);
    close(centre.y, 0);
    solver.endDrag();
  });

  it('leaves a held radius alone, and refuses a fixed circle and non-circles', () => {
    const b = new SketchBuilder();
    const sized = b.circle(0, 0, 5);
    b.dimension({ type: 'radius', curve: sized.id }, 5);
    const fixed = b.circle(30, 0, 4);
    b.constrain({ type: 'fix', entity: fixed.id });
    const line = b.line(0, 20, 10, 20);
    const solver = newSolver();
    solver.solve(SketchDataSchema.parse(b.sketch), b.values);

    expect(solver.beginRadiusDrag(sized.id)).toBe(true);
    const step = solver.dragRadius(9);
    close(step.solution.radii[sized.id] as number, 5);
    solver.endDrag();
    expect(solver.beginRadiusDrag(fixed.id)).toBe(false);
    expect(solver.beginRadiusDrag(line.id)).toBe(false);
  });
});

describe('ellipses and splines (P1-05)', () => {
  /** Distance from the minor point to the major axis, and its offset along it. */
  const axes = (s: Solved, e: { center: string; major: string; minor: string }) => {
    const c = s.p(e.center);
    const u = unit(sub(s.p(e.major), c));
    const m = sub(s.p(e.minor), c);
    return { a: dist(s.p(e.major), c), side: cross(u, m), along: dot(u, m) };
  };

  it('an ellipse has five degrees of freedom and keeps its minor point square', () => {
    const b = new SketchBuilder({ noise: 0.3, seed: 7 });
    const e = b.ellipse(10, 5, 8, 3, 30);
    const s = solve(b);
    clean(s, 5);
    const { side, along } = axes(s, e);
    expect(side).toBeGreaterThan(0);
    close(along, 0);
  });

  it('takes distance dimensions for its radii, and keeps the minor side', () => {
    const b = new SketchBuilder();
    const e = b.ellipse(0, 0, 8, 3, 0);
    // Mirror the minor point below the axis: it must stay there.
    const minor = b.entities[e.minor] as { type: 'point'; x: number; y: number };
    minor.y = -3;
    b.constrain({ type: 'fix', entity: e.center });
    b.constrain({ type: 'horizontal', a: e.center, b: e.major });
    b.dimension({ type: 'distance', orientation: 'aligned', a: e.center, b: e.major }, 12);
    b.dimension({ type: 'distance', orientation: 'aligned', a: e.center, b: e.minor }, 5);
    const s = solve(b);
    clean(s, 0);
    const { a, side, along } = axes(s, e);
    close(a, 12);
    close(side, -5);
    close(along, 0);
  });

  it('puts a point on an ellipse, and a fixed ellipse holds still', () => {
    const b = new SketchBuilder();
    const e = b.ellipse(0, 0, 10, 4, 0);
    const p = b.point(3, 7);
    b.constrain({ type: 'fix', entity: e.id });
    b.constrain({ type: 'pointOnCurve', point: p, curve: e.id });
    const s = solve(b);
    clean(s, 1);
    const q = s.p(p);
    close((q.x / 10) ** 2 + (q.y / 4) ** 2, 1);
    expect(s.p(e.major)).toEqual({ x: 10, y: 0 });
    expect(s.p(e.minor)).toEqual({ x: 0, y: 4 });
  });

  it('drags an ellipse by its major point; the minor point follows', () => {
    const b = new SketchBuilder();
    const e = b.ellipse(0, 0, 10, 4, 0);
    b.constrain({ type: 'fix', entity: e.center });
    b.dimension({ type: 'distance', orientation: 'aligned', a: e.center, b: e.minor }, 4);
    const solver = newSolver();
    const sketch = SketchDataSchema.parse(b.sketch);
    expect(solver.solve(sketch, b.values).dof).toBe(2);
    expect(solver.beginDrag(e.major)).toBe(true);
    const step = solver.drag(0, 12);
    expect(step.ok).toBe(true);
    const major = step.solution.points[e.major] as V;
    const minor = step.solution.points[e.minor] as V;
    close(major.x, 0, 4);
    close(major.y, 12, 4);
    close(minor.x, -4, 4);
    close(minor.y, 0, 4);
    solver.endDrag();
  });

  it('a spline is its points: two degrees of freedom each, joined by coincidence', () => {
    const b = new SketchBuilder();
    const spline = b.spline([
      [0, 0],
      [5, 5],
      [10, 0],
    ]);
    const line = b.line(10, 0, 20, 0);
    b.constrain({ type: 'coincident', a: spline.points[2], b: line.start });
    clean(solve(b), 6 + 4 - 2);
    b.constrain({ type: 'fix', entity: spline.id });
    const s = solve(b);
    clean(s, 2);
    expect(s.p(spline.points[1] as string)).toEqual({ x: 5, y: 5 });
  });
});

describe('conflicts and the test-solve', () => {
  const rectangle = () => {
    const b = new SketchBuilder();
    const bottom = b.line(0, 0, 50, 0);
    const right = b.line(50, 0, 50, 30);
    b.constrain({ type: 'fix', entity: bottom.start });
    b.constrain({ type: 'coincident', a: bottom.end, b: right.start });
    b.constrain({ type: 'horizontal', a: bottom.id });
    b.constrain({ type: 'vertical', a: right.id });
    const width = b.dimension({ type: 'distance', orientation: 'aligned', a: bottom.id }, 50);
    return { b, bottom, right, width };
  };

  it('reports both widths when a second one conflicts', () => {
    const { b, bottom, width } = rectangle();
    const second = b.dimension(
      { type: 'distance', orientation: 'horizontal', a: bottom.start, b: bottom.end },
      60,
    );
    const s = solve(b);
    expect(s.result.conflicting.sort()).toEqual([second, width].sort());
  });

  it('check() refuses conflicting and redundant constraints and accepts good ones', () => {
    const { b, bottom, right } = rectangle();
    const solver = newSolver();
    solver.solve(SketchDataSchema.parse(b.sketch), b.values);
    const stats = { ...solver.stats };

    const conflict = b.dimension(
      { type: 'distance', orientation: 'horizontal', a: bottom.start, b: bottom.end },
      60,
    );
    let check = solver.check(b.sketch, b.values, conflict);
    expect(check.accepted).toBe(false);
    expect(check.conflicting).toContain(conflict);
    delete b.dimensions[conflict];

    const redundant = b.dimension(
      { type: 'distance', orientation: 'horizontal', a: bottom.start, b: bottom.end },
      50,
    );
    check = solver.check(b.sketch, b.values, redundant);
    expect(check.accepted).toBe(false);
    expect(check.redundant).toContain(redundant);
    delete b.dimensions[redundant];

    const height = b.dimension({ type: 'distance', orientation: 'aligned', a: right.id }, 30);
    check = solver.check(b.sketch, b.values, height);
    expect(check).toMatchObject({ accepted: true, ok: true, dof: 0 });

    // The persistent systems were left alone.
    expect(solver.stats).toEqual(stats);
  });

  it('a constraint with only some equations redundant still counts: partly redundant', () => {
    // Collinear is two point-on-line equations; on two lines already horizontal,
    // the second follows from the first, but the constraint still removes a freedom.
    const b = new SketchBuilder();
    const a = b.line(0, 0, 20, 0);
    const c = b.line(0, -10, 20, -10);
    b.constrain({ type: 'horizontal', a: a.id });
    b.constrain({ type: 'horizontal', a: c.id });
    const solver = newSolver();
    expect(solver.solve(SketchDataSchema.parse(b.sketch), b.values).dof).toBe(6);
    const collinear = b.constrain({ type: 'collinear', a: a.id, b: c.id });
    const check = solver.check(b.sketch, b.values, collinear);
    expect(check).toMatchObject({ accepted: true, dof: 5, redundant: [] });
    expect(check.partlyRedundant).toEqual([collinear]);
    const { result, p } = solve(b, solver);
    expect(result).toMatchObject({ ok: true, dof: 5, redundant: [], partlyRedundant: [collinear] });
    expect(p(c.start).y).toBeCloseTo(p(a.start).y, 9);

    // The same again removes nothing: every equation is redundant.
    const again = b.constrain({ type: 'collinear', a: a.id, b: c.id });
    expect(solver.check(b.sketch, b.values, again)).toMatchObject({
      accepted: false,
      redundant: expect.arrayContaining([again]),
    });
  });

  it('check() on a fix refuses when it over-constrains', () => {
    const { b, right } = rectangle();
    b.dimension({ type: 'distance', orientation: 'aligned', a: right.id }, 30);
    const solver = newSolver();
    const fix = b.constrain({ type: 'fix', entity: right.end });
    expect(solver.check(b.sketch, b.values, fix).accepted).toBe(false);
  });
});

describe('applySolution', () => {
  it('keeps unchanged entities (and the sketch) identical', () => {
    const b = new SketchBuilder();
    b.line(0, 0, 10, 0);
    const sketch = SketchDataSchema.parse(b.sketch);
    const solver = newSolver();
    const result = solver.solve(sketch, {});
    expect(applySolution(sketch, result.solution)).toBe(sketch);
  });
});

describe('projected geometry (P2-09)', () => {
  it('stays where the model put it, and constrained geometry follows it', () => {
    const b = new SketchBuilder();
    const edge = b.line(0, 0, 50, 0);
    const mine = b.line(3, 4, 20, 30);
    b.constrain({ type: 'coincident', a: mine.start, b: edge.end });
    b.constrain({ type: 'horizontal', a: mine.id });
    const sketch = {
      ...b.sketch,
      projections: { pr: { ref: { kind: 'edge', id: 'e[x]' }, curves: { edge: edge.id } } },
    } as unknown as SketchData;
    const solver = newSolver();
    const result = solver.solve(SketchDataSchema.parse(sketch), {});
    expect(result.ok).toBe(true);
    const solved = applySolution(sketch, result.solution);
    const at = (id: string) => solved.entities[id as keyof SketchData['entities']];
    expect(at(edge.start)).toMatchObject({ x: 0, y: 0 });
    expect(at(edge.end)).toMatchObject({ x: 50, y: 0 });
    expect(at(mine.start)).toMatchObject({ x: 50, y: 0 });
    expect((at(mine.end) as { y: number }).y).toBeCloseTo(0, 9);
  });
});
