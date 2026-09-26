import type { SketchArc, Vec2 } from '@extrudo/core';
import { afterEach, describe, expect, it } from 'vitest';
import { finishSketch } from '../mode';
import { ARC_CENTER_TOOL, ARC_TANGENT_TOOL, ARC_TOOL } from './arc';
import { CIRCLE_2POINT_TOOL, CIRCLE_3POINT_TOOL, CIRCLE_TOOL } from './circle';
import { POINT_TOOL } from './point';
import { RECTANGLE_3POINT_TOOL, RECTANGLE_CENTER_TOOL, RECTANGLE_TOOL } from './rectangle';
import { at, disposeHosts, setup } from './testing';

afterEach(disposeHosts);

const sorted = (list: string[]) => [...list].sort();
const closeTo = (a: Vec2, b: Vec2, digits = 6) => {
  expect(a[0]).toBeCloseTo(b[0], digits);
  expect(a[1]).toBeCloseTo(b[1], digits);
};

describe('rectangle tool', () => {
  it('draws a 2-point rectangle joined at its corners, horizontal and vertical', async () => {
    const t = await setup({ tool: RECTANGLE_TOOL });
    t.host.click(at(5, 5));
    t.host.move(at(25, 15));
    const fields = t.host.state.getState().tool?.fields() ?? [];
    expect(fields.map((f) => [f.name, f.value])).toEqual([
      ['width', 20],
      ['height', 10],
    ]);
    t.host.click(at(25, 15));
    expect(t.byType('line')).toHaveLength(4);
    expect(t.byType('point')).toHaveLength(8);
    expect(sorted(t.constraints())).toEqual(
      sorted([
        'coincident (25,5) (25,5)',
        'coincident (25,15) (25,15)',
        'coincident (5,15) (5,15)',
        'coincident (5,5) (5,5)',
        'horizontal line',
        'horizontal line',
        'vertical line',
        'vertical line',
      ]),
    );
    // Ready for the next rectangle.
    expect(t.host.state.getState().tool?.fields()).toEqual([]);
  });

  it('takes a typed width and height as dimensions, drawn toward the pointer', async () => {
    const t = await setup({ tool: RECTANGLE_TOOL });
    t.host.click(at(5, 5));
    t.host.move(at(-3, -2));
    t.host.lock('width', { expr: '30', value: 30 });
    t.host.lock('height', { expr: 'h', value: 12 });
    t.host.enter();
    const xs = t.byType('point').map((p) => (p.type === 'point' ? p.x : 0));
    const ys = t.byType('point').map((p) => (p.type === 'point' ? p.y : 0));
    expect(Math.min(...xs)).toBeCloseTo(-25, 6);
    expect(Math.min(...ys)).toBeCloseTo(-7, 6);
    expect(
      Object.values(t.data().dimensions)
        .map((d) => d.expr)
        .sort(),
    ).toEqual(['30', 'h']);
  });

  it('draws a 3-point rectangle at an angle, perpendicular and parallel', async () => {
    const t = await setup({ tool: RECTANGLE_3POINT_TOOL });
    t.host.click(at(0.5, 1));
    t.host.click(at(8.5, 7)); // a 10 mm edge at atan(3/4)
    t.host.move(at(5.5, 11));
    expect(t.host.state.getState().tool?.fields()[0]?.value).toBeCloseTo(5, 6);
    t.host.click(at(5.5, 11));
    expect(sorted(t.constraints().filter((c) => !c.startsWith('coincident')))).toEqual([
      'parallel line line',
      'parallel line line',
      'perpendicular line line',
    ]);
    const corners = t.byType('point').map((p) => (p.type === 'point' ? [p.x, p.y] : []));
    expect(corners).toContainEqual([expect.closeTo(5.5, 6), expect.closeTo(11, 6)]);
  });

  it('makes the first edge of a 3-point rectangle horizontal when it aligns', async () => {
    const t = await setup({ tool: RECTANGLE_3POINT_TOOL });
    t.host.click(at(1, 1));
    t.host.click(at(20, 1.4)); // level with the first corner
    t.host.click(at(20, 9));
    expect(t.constraints()).toContain('horizontal line');
  });

  it('draws a center rectangle with construction diagonals and its center point', async () => {
    const t = await setup({ tool: RECTANGLE_CENTER_TOOL });
    t.host.click(at(0.2, 0.1)); // the origin: the center is fixed there
    t.host.click(at(10, 6));
    const lines = t.byType('line');
    expect(lines).toHaveLength(6);
    expect(lines.filter((l) => l.type === 'line' && l.construction)).toHaveLength(2);
    expect(t.constraints()).toContain('fix (0,0)');
    expect(t.constraints().some((c) => c.startsWith('midpoint (0,0)'))).toBe(true);
    const xs = t.byType('point').map((p) => (p.type === 'point' ? p.x : 0));
    expect(Math.min(...xs)).toBeCloseTo(-10, 6);
    expect(Math.max(...xs)).toBeCloseTo(10, 6);
  });
});

describe('circle tool', () => {
  it('draws a circle from its center and a typed diameter', async () => {
    const t = await setup({ tool: CIRCLE_TOOL });
    t.host.click(at(10, 10));
    t.host.move(at(14, 10));
    expect(t.host.state.getState().tool?.fields()[0]?.value).toBeCloseTo(8, 9);
    t.host.lock('diameter', { expr: '2 * r', value: 20 });
    t.host.enter();
    const [circle] = t.byType('circle');
    expect(circle).toMatchObject({ type: 'circle', radius: 10, construction: false });
    expect(Object.values(t.data().dimensions)).toEqual([
      { type: 'diameter', curve: expect.any(String), expr: '2 * r', driven: false },
    ]);
  });

  it('puts snapped points on the rim of 2-point and 3-point circles', async () => {
    const t = await setup({ tool: POINT_TOOL });
    t.host.click(at(-10, 0));
    t.host.click(at(10, 0));
    t.host.start(CIRCLE_2POINT_TOOL);
    t.host.click(at(-10.2, 0.3));
    t.host.click(at(10.1, -0.2));
    const [circle] = t.byType('circle');
    expect(circle).toMatchObject({ radius: 10 });
    expect(t.constraints().filter((c) => c.startsWith('pointOnCurve'))).toEqual([
      'pointOnCurve (-10,0) circle',
      'pointOnCurve (10,0) circle',
    ]);

    t.host.start(CIRCLE_3POINT_TOOL);
    t.host.click(at(-10.2, 0.3));
    t.host.click(at(0, 30));
    t.host.click(at(10.1, -0.2));
    const big = t.byType('circle')[1];
    if (big?.type !== 'circle') throw new Error('no circle');
    // Through (±10, 0) and (0, 30): centered at (0, 40/3).
    expect(big.radius).toBeCloseTo(50 / 3, 6);
  });
});

describe('arc tool', () => {
  const arcOf = (t: Awaited<ReturnType<typeof setup>>) => {
    const [arc] = t.byType('arc') as SketchArc[];
    if (!arc) throw new Error('no arc');
    return { arc, center: t.point(arc.center), start: t.point(arc.start), end: t.point(arc.end) };
  };

  it('draws a 3-point arc, stored counter-clockwise', async () => {
    const t = await setup({ tool: ARC_TOOL });
    t.host.click(at(-10, 0)); // start
    t.host.click(at(10, 0)); // end
    t.host.click(at(0, 10)); // over the top: clockwise from the start
    const { center, start, end } = arcOf(t);
    closeTo(center, [0, 0]);
    // Clockwise, so the stored start is the second click.
    closeTo(start, [10, 0]);
    closeTo(end, [-10, 0]);
  });

  it('takes a typed radius instead of the third point', async () => {
    const t = await setup({ tool: ARC_TOOL });
    t.host.click(at(-6, 0));
    t.host.click(at(6, 0));
    t.host.move(at(0, -3));
    t.host.lock('radius', { expr: '10', value: 10 });
    t.host.enter();
    const { center } = arcOf(t);
    closeTo(center, [0, 8]);
    expect(Object.values(t.data().dimensions)[0]).toMatchObject({ type: 'radius', expr: '10' });
  });

  it('draws a center arc the way the pointer went round', async () => {
    const t = await setup({ tool: ARC_CENTER_TOOL });
    t.host.click(at(0, 0.1)); // the origin
    t.host.click(at(10, 0));
    // Round clockwise through the bottom to the top.
    for (const angle of [-30, -90, -150, -210, -270]) {
      const a = (angle * Math.PI) / 180;
      t.host.move(at(12 * Math.cos(a), 12 * Math.sin(a)));
    }
    expect(t.host.state.getState().tool?.fields()[0]?.value).toBeCloseTo(-270, 6);
    t.host.click(at(0, 12));
    const { center, start, end } = arcOf(t);
    closeTo(center, [0, 0]);
    closeTo(start, [0, 10]);
    closeTo(end, [10, 0]);
    expect(t.constraints()).toContain('fix (0,0)');
  });

  it('continues a line with a tangent arc that the solver keeps in place', async () => {
    const t = await setup();
    t.host.click(at(0, 5));
    t.host.click(at(20, 5.3)); // horizontal
    t.host.escape();
    t.host.start(ARC_TANGENT_TOOL);
    t.host.click(at(40, 40)); // not the end of anything
    expect(t.host.state.getState().tool?.prompt()).toBe('Start on the end of a line or an arc.');
    t.host.click(at(20.2, 5.1)); // the line's end
    t.host.click(at(30, 15));
    const { center, start, end } = arcOf(t);
    closeTo(center, [20, 15]);
    closeTo(start, [20, 5]);
    closeTo(end, [30, 15]);
    expect(t.constraints()).toContain('tangent line arc false');
    expect(t.constraints()).toContain('coincident (20,5) (20,5)');
  });
});

describe('line tool tangent-arc drag', () => {
  it('drags an arc off the end of the chain, then carries on with lines', async () => {
    const t = await setup();
    t.host.click(at(0, 0.1)); // the origin
    t.host.click(at(20, 0.3)); // horizontal
    t.host.dragStart(at(20.1, 0.2)); // on the chain's end
    expect(t.host.state.getState().dragging).toBe(true);
    t.host.move(at(20, -10));
    expect(t.host.state.getState().tool?.preview().arcs).toHaveLength(1);
    t.host.dragEnd(at(20, -10)); // turns right: clockwise
    const [arc] = t.byType('arc') as SketchArc[];
    if (!arc) throw new Error('no arc');
    closeTo(t.point(arc.center), [20, -5]);
    expect(t.constraints()).toContain('tangent line arc true');
    // The chain goes on from the arc's end.
    t.host.click(at(5, -10.2));
    expect(t.byType('line')).toHaveLength(2);
    expect(t.constraints()).toContain('coincident (20,-10) (20,-10)');
  });

  it('ignores drags that start away from the chain end', async () => {
    const t = await setup();
    t.host.click(at(0, 0));
    t.host.click(at(20, 3));
    t.host.dragStart(at(10, 10));
    expect(t.host.state.getState().dragging).toBe(false);
    t.host.dragEnd(at(10, 20));
    expect(t.byType('arc')).toHaveLength(0);
  });

  it('starts a chain with a tangent arc from the end of an existing line', async () => {
    const t = await setup();
    t.host.click(at(0, 10));
    t.host.click(at(0.2, 30)); // vertical, upward
    t.host.escape();
    t.host.dragStart(at(0.1, 30.1));
    t.host.dragEnd(at(-10, 30)); // turns left: counter-clockwise
    expect(t.constraints()).toContain('tangent line arc false');
    const [arc] = t.byType('arc') as SketchArc[];
    closeTo(t.point((arc as SketchArc).center), [-5, 30]);
  });
});

describe('point tool and construction', () => {
  it('places points, on curves where they snap', async () => {
    const t = await setup();
    t.host.click(at(0, 10));
    t.host.click(at(30, 10.2));
    t.host.start(POINT_TOOL);
    t.host.click(at(7, 10.3)); // on the line
    t.host.click(at(7, 25));
    expect(t.byType('point')).toHaveLength(4);
    expect(t.constraints()).toContain('pointOnCurve (7,10) line');
  });

  it('draws construction geometry while X is on, until the sketch closes', async () => {
    const t = await setup({ tool: CIRCLE_TOOL });
    t.host.toggleConstruction();
    t.host.click(at(0, 20));
    t.host.click(at(5, 20));
    t.host.start(RECTANGLE_TOOL);
    t.host.click(at(10, 10));
    t.host.click(at(20, 20));
    expect(t.byType('circle')[0]).toMatchObject({ construction: true });
    expect(t.byType('line').every((l) => l.type === 'line' && l.construction)).toBe(true);
    t.host.toggleConstruction();
    t.host.click(at(30, 10));
    t.host.click(at(40, 20));
    expect(t.byType('line').filter((l) => l.type === 'line' && !l.construction)).toHaveLength(4);
    t.host.toggleConstruction();
    finishSketch(t);
    expect(t.host.state.getState().construction).toBe(false);
  });
});
