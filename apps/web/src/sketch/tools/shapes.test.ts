import type { SketchArc, SketchCircle, SketchEllipse, SketchLine, Vec2 } from '@extrudo/core';
import { afterEach, describe, expect, it } from 'vitest';
import { ELLIPSE_TOOL } from './ellipse';
import { POLYGON_CIRCUMSCRIBED_TOOL, POLYGON_EDGE_TOOL, POLYGON_TOOL } from './polygon';
import { SLOT_OVERALL_TOOL, SLOT_TOOL } from './slot';
import { SPLINE_TOOL } from './spline';
import { at, disposeHosts, setup } from './testing';

// P1-05: polygons, slots, ellipses and splines, solved with the real planegcs.

afterEach(disposeHosts);

type Tested = Awaited<ReturnType<typeof setup>>;

const closeTo = (a: Vec2, b: Vec2, digits = 6) => {
  expect(a[0]).toBeCloseTo(b[0], digits);
  expect(a[1]).toBeCloseTo(b[1], digits);
};
const dist = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const count = (list: string[], prefix: string) => list.filter((c) => c.startsWith(prefix)).length;

/** A clean solve: converged, nothing conflicting or redundant, `dof` left. */
function clean(t: Tested, dof: number) {
  const r = t.report();
  expect(r.ok).toBe(true);
  expect(r.conflicting).toEqual([]);
  expect(r.redundant).toEqual([]);
  expect(r.dof).toBe(dof);
}

const lines = (t: Tested) => t.byType('line') as SketchLine[];
const edges = (t: Tested) => lines(t).filter((l) => !l.construction);
const length = (t: Tested, l: SketchLine) => dist(t.point(l.start), t.point(l.end));

describe('polygon tool', () => {
  it('draws an inscribed hexagon: equal edges, corners on a construction circle', async () => {
    const t = await setup({ tool: POLYGON_TOOL });
    t.host.click(at(0.1, 0.1)); // the origin: the center is fixed there
    t.host.move(at(10, 0.3));
    const fields = t.host.state.getState().tool?.fields() ?? [];
    expect(fields.map((f) => [f.name, f.value])).toEqual([
      ['diameter', expect.closeTo(20, 6)],
      ['sides', 6],
    ]);
    t.host.click(at(10, 0.3)); // level with the center
    expect(edges(t)).toHaveLength(6);
    const [circle] = t.byType('circle') as SketchCircle[];
    expect(circle).toMatchObject({ construction: true, radius: expect.closeTo(10, 6) });
    const constraints = t.constraints();
    expect(count(constraints, 'coincident')).toBe(6);
    expect(count(constraints, 'pointOnCurve')).toBe(6);
    expect(count(constraints, 'equal')).toBe(5);
    expect(constraints).toContain('fix (0,0)');
    expect(constraints).toContain('horizontal (10,0) (0,0)');
    for (const l of edges(t)) expect(length(t, l)).toBeCloseTo(10, 6);
    clean(t, 1); // only the size is left
  });

  it('solves cleanly with 3 to 8 sides, and keeps the typed count', async () => {
    const t = await setup({ tool: POLYGON_TOOL });
    for (const n of [3, 4, 5, 6, 7, 8]) {
      t.host.lock('sides', { expr: String(n), value: n });
      // Staggered, so nothing lines up with an earlier polygon.
      t.host.click(at(40 * n, 50 + 3 * n));
      t.host.click(at(40 * n + 7, 58 + 5 * n));
    }
    expect(edges(t)).toHaveLength(3 + 4 + 5 + 6 + 7 + 8);
    clean(t, 6 * 4);
    // Not whole, or too few: ignored.
    const tool = t.host.state.getState().tool;
    t.host.lock('sides', { expr: '2.5', value: 2.5 });
    t.host.click(at(0, -40));
    t.host.move(at(5, -40));
    expect(tool?.fields().find((f) => f.name === 'sides')?.value).toBe(6);
  });

  it('draws a circumscribed polygon sized across the flats', async () => {
    const t = await setup({ tool: POLYGON_CIRCUMSCRIBED_TOOL });
    t.host.click(at(20, 20));
    t.host.move(at(20, 25));
    t.host.lock('diameter', { expr: '13', value: 13 });
    t.host.enter();
    const circles = t.byType('circle') as SketchCircle[];
    expect(circles.map((c) => c.radius).sort()).toEqual([
      expect.closeTo(6.5, 6),
      expect.closeTo(13 / Math.sqrt(3), 6),
    ]);
    expect(Object.values(t.data().dimensions)).toEqual([
      {
        type: 'diameter',
        curve: expect.any(String),
        expr: '13',
        paramName: 'd1',
        driven: false,
      },
    ]);
    const constraints = t.constraints();
    expect(constraints).toContain('concentric circle circle');
    expect(constraints).toContain('tangent circle line');
    clean(t, 3);

    // An odd count solves as cleanly; a middle level with the center makes that edge vertical.
    t.host.lock('sides', { expr: '5', value: 5 });
    t.host.click(at(-20, 33));
    t.host.click(at(-10, 33.2));
    expect(t.constraints()).toContain('vertical line');
    clean(t, 3 + 3);
  });

  it('draws a polygon from one edge, on the side of the third click', async () => {
    const t = await setup({ tool: POLYGON_EDGE_TOOL });
    t.host.click(at(3, 7));
    t.host.click(at(13, 7.2)); // level with the first corner
    t.host.move(at(8, 0));
    t.host.click(at(8, 0)); // below the edge
    expect(edges(t)).toHaveLength(6);
    const points = t.byType('point').map((p) => (p.type === 'point' ? p.y : 0));
    expect(Math.max(...points)).toBeCloseTo(7, 6);
    expect(Math.min(...points)).toBeCloseTo(7 - 10 * Math.sqrt(3), 6);
    expect(t.constraints()).toContain('horizontal line');
    clean(t, 3);
  });
});

describe('slot tool', () => {
  const arcs = (t: Tested) =>
    (t.byType('arc') as SketchArc[]).map((a) => ({
      center: t.point(a.center),
      radius: dist(t.point(a.center), t.point(a.start)),
    }));

  it('draws a center-to-center slot: tangent all round, equal ends, a centerline', async () => {
    const t = await setup({ tool: SLOT_TOOL });
    t.host.click(at(0.1, 0.1)); // the origin
    t.host.click(at(20, 0.2)); // level
    t.host.move(at(10, 5));
    expect(t.host.state.getState().tool?.fields()[0]?.value).toBeCloseTo(10, 6);
    t.host.click(at(10, 5));
    expect(edges(t)).toHaveLength(2);
    expect(lines(t).filter((l) => l.construction)).toHaveLength(1);
    const ends = arcs(t);
    expect(ends).toHaveLength(2);
    expect(ends.map((a) => a.radius)).toEqual([expect.closeTo(5, 6), expect.closeTo(5, 6)]);
    const centers = ends.map((a) => a.center).sort((p, q) => p[0] - q[0]);
    closeTo(centers[0] as Vec2, [0, 0]);
    closeTo(centers[1] as Vec2, [20, 0]);
    const constraints = t.constraints();
    expect(count(constraints, 'tangent')).toBe(4);
    expect(constraints).toContain('equal arc arc');
    clean(t, 2); // length and width
  });

  it('draws an overall slot from typed length, angle and width', async () => {
    const t = await setup({ tool: SLOT_OVERALL_TOOL });
    t.host.click(at(5, 20));
    t.host.move(at(30, 25));
    t.host.lock('length', { expr: '40', value: 40 });
    t.host.lock('angle', { expr: '0', value: 0 });
    t.host.enter();
    t.host.move(at(20, 30));
    t.host.lock('width', { expr: '10', value: 10 });
    t.host.enter();
    const centers = arcs(t)
      .map((a) => a.center)
      .sort((p, q) => p[0] - q[0]);
    closeTo(centers[0] as Vec2, [10, 20]);
    closeTo(centers[1] as Vec2, [40, 20]);
    expect(
      Object.values(t.data().dimensions)
        .map((d) => d.expr)
        .sort(),
    ).toEqual(['10', '40']);
    expect(t.constraints()).toContain('horizontal line');
    clean(t, 2); // position only
  });

  it('refuses an overall slot narrower than it is wide', async () => {
    const t = await setup({ tool: SLOT_OVERALL_TOOL });
    t.host.click(at(0, 30));
    t.host.click(at(8, 30));
    t.host.click(at(4, 40)); // 20 wide, 8 long
    expect(t.byType('arc')).toHaveLength(0);
  });
});

describe('ellipse tool', () => {
  const ellipse = (t: Tested) => {
    const [e] = t.byType('ellipse') as SketchEllipse[];
    if (!e) throw new Error('no ellipse');
    return { center: t.point(e.center), major: t.point(e.major), minor: t.point(e.minor), e };
  };

  it('draws an ellipse from its center and two axes', async () => {
    const t = await setup({ tool: ELLIPSE_TOOL });
    t.host.click(at(5, 5));
    t.host.click(at(15, 5.2)); // level with the center
    t.host.move(at(7, 8));
    expect(t.host.state.getState().tool?.fields()[0]?.value).toBeCloseTo(3, 6);
    t.host.click(at(7, 8));
    const { center, major, minor } = ellipse(t);
    closeTo(center, [5, 5]);
    closeTo(major, [15, 5]);
    closeTo(minor, [5, 8]);
    expect(t.constraints()).toContain('horizontal (15,5) (5,5)');
    clean(t, 4);
  });

  it('swaps the axes when the second is longer, and dimensions typed radii', async () => {
    const t = await setup({ tool: ELLIPSE_TOOL });
    t.host.click(at(-20, -20));
    t.host.move(at(-20, -10));
    t.host.lock('radius', { expr: '4', value: 4 });
    t.host.lock('angle', { expr: '90', value: 90 });
    t.host.enter();
    t.host.move(at(-30, -20));
    t.host.lock('radius2', { expr: '9', value: 9 });
    t.host.enter();
    const { center, major, minor } = ellipse(t);
    closeTo(minor, [-20, -16]);
    closeTo(major, [-29, -20]);
    expect(dist(center, major)).toBeCloseTo(9, 6);
    expect(
      Object.values(t.data().dimensions)
        .map((d) => d.expr)
        .sort(),
    ).toEqual(['4', '9']);
    clean(t, 3); // position and rotation
  });
});

describe('spline tool', () => {
  it('draws a spline through the clicked points; Enter finishes', async () => {
    const t = await setup({ tool: SPLINE_TOOL });
    t.host.click(at(0, 10));
    t.host.click(at(10, 20));
    expect(t.host.state.getState().tool?.preview().polylines).toHaveLength(1);
    t.host.click(at(20, 5));
    t.host.escape(); // takes back (20, 5)
    t.host.click(at(25, 12));
    t.host.enter();
    const [spline] = t.byType('spline');
    if (spline?.type !== 'spline') throw new Error('no spline');
    expect(spline.points.map((p) => t.point(p))).toEqual([
      [0, 10],
      [10, 20],
      [25, 12],
    ]);
    clean(t, 6);
  });

  it('starts on a line end, and a second click on the last point finishes', async () => {
    const t = await setup();
    t.host.click(at(-20, -5));
    t.host.click(at(-10, -15));
    t.host.escape();
    t.host.start(SPLINE_TOOL);
    t.host.click(at(-10.1, -15.2)); // the line's end
    t.host.click(at(0, -10));
    t.host.click(at(0, -10));
    expect(t.byType('spline')).toHaveLength(1);
    expect(t.constraints()).toContain('coincident (-10,-15) (-10,-15)');
    // Enter with fewer than two points does nothing.
    t.host.click(at(30, 30));
    t.host.enter();
    expect(t.byType('spline')).toHaveLength(1);
  });
});
