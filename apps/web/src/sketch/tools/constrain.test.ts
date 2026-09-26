import {
  addToSketch,
  type ConstraintId,
  type SketchConstraint,
  type SketchEntity,
  type SketchEntityId,
} from '@extrudo/core';
import { afterEach, describe, expect, it } from 'vitest';
import { at, disposeHosts, setup } from './testing';

afterEach(disposeHosts);

type Setup = Awaited<ReturnType<typeof setup>>;

/** Adds geometry (and constraints) to the open sketch directly, as if drawn earlier. */
function draw(
  t: Setup,
  entities: Record<string, SketchEntity>,
  constraints: Record<string, SketchConstraint> = {},
) {
  t.store.getState().dispatch(
    addToSketch({
      feature: t.id,
      entities: entities as Record<SketchEntityId, SketchEntity>,
      constraints: constraints as Record<ConstraintId, SketchConstraint>,
    }),
  );
}

const eid = (id: string) => id as SketchEntityId;
const pt = (x: number, y: number): SketchEntity => ({ type: 'point', x, y });
const line = (start: string, end: string): SketchEntity => ({
  type: 'line',
  start: start as SketchEntityId,
  end: end as SketchEntityId,
  construction: false,
});

/** Two lines: `a` along X from the origin, `b` above it, tilted. */
async function twoLines(tool: string) {
  const t = await setup({ tool });
  draw(t, {
    a0: pt(0, 0),
    a1: pt(20, 0),
    a: line('a0', 'a1'),
    b0: pt(0, 10),
    b1: pt(20, 14),
    b: line('b0', 'b1'),
  });
  return t;
}

const prompt = (t: Setup) => t.host.state.getState().tool?.prompt();
const error = (t: Setup) => t.host.state.getState().error;

describe('constraint tools', () => {
  it('pick two lines, show what they would pick, and add a solved Parallel', async () => {
    const t = await twoLines('parallel');
    expect(prompt(t)).toBe('Pick a line.');
    t.host.move(at(10, 0.5));
    expect(t.host.state.getState().tool?.preview().hover).toBe('a');
    // No snapping while picking.
    expect(t.host.state.getState().pointer?.snap).toBeUndefined();
    t.host.click(at(10, 0.5));
    expect(t.host.state.getState().tool?.preview().picked).toEqual(['a']);
    expect(prompt(t)).toBe('Pick a line to make parallel to it.');
    t.host.move(at(10, 11.5));
    expect(t.host.state.getState().tool?.preview().hover).toBe('b');
    t.host.click(at(10, 12.2));
    expect(t.constraints()).toEqual(['parallel line line']);
    // Solved in the same step: the lines are parallel now.
    const d = (s: string, e: string): [number, number] => {
      const [p, q] = [t.point(s as SketchEntityId), t.point(e as SketchEntityId)];
      return [q[0] - p[0], q[1] - p[1]];
    };
    const [ax, ay] = d('a0', 'a1');
    const [bx, by] = d('b0', 'b1');
    expect(ax * by - ay * bx).toBeCloseTo(0, 6);
    expect(t.report().ok).toBe(true);
    // The tool stays on, ready for the next pair; one undo takes the constraint back.
    expect(t.host.state.getState().tool?.preview().picked).toBeUndefined();
    t.store.getState().undo();
    expect(t.constraints()).toEqual([]);
  });

  it('picks only what the constraint takes', async () => {
    const t = await twoLines('parallel');
    // At a line's end the line is picked, not its end point.
    t.host.click(at(0.2, 0.2));
    expect(t.host.state.getState().tool?.preview().picked).toEqual(['a']);
    // The same line can't be picked twice, and empty space picks nothing.
    t.host.click(at(10, 0));
    t.host.click(at(10, 30));
    expect(t.host.state.getState().tool?.preview().picked).toEqual(['a']);
    expect(t.constraints()).toEqual([]);
  });

  it('refuses a redundant or conflicting constraint and says why', async () => {
    const t = await twoLines('horizontal');
    t.host.click(at(10, 0));
    t.host.click(at(10, 12));
    expect(t.constraints()).toEqual(['horizontal line', 'horizontal line']);
    // The second line settled level at y = 10.
    expect(t.point('b1' as SketchEntityId)[1]).toBeCloseTo(10, 6);
    t.host.start('parallel');
    t.host.click(at(10, 0));
    t.host.click(at(10, 10));
    expect(error(t)).toBe("Parallel isn't needed: the sketch already holds it.");
    // planegcs "solves" this one by shrinking both lines to dots: refused all the same.
    t.host.start('perpendicular');
    t.host.click(at(10, 0));
    t.host.click(at(10, 10));
    expect(error(t)).toBe("Perpendicular would conflict with the sketch's other constraints.");
    expect(t.point('a1' as SketchEntityId)).toEqual([20, 0]);
    expect(t.constraints()).toHaveLength(2);
    // The next click clears the message.
    t.host.click(at(10, 30));
    expect(error(t)).toBeUndefined();
  });

  it('makes horizontal and vertical from a line at once, or from two points', async () => {
    const t = await twoLines('vertical');
    expect(prompt(t)).toBe('Pick a line to make vertical, or two points to line up.');
    t.host.click(at(0.1, 0.1)); // a point: a second one is needed
    expect(prompt(t)).toBe('Pick the second point.');
    t.host.click(at(10, 12)); // a line is refused now
    expect(t.constraints()).toEqual([]);
    t.host.click(at(0.1, 9.9));
    expect(t.constraints()).toEqual(['vertical (0,0) (0,10)']);
    t.host.start('horizontal');
    t.host.click(at(10, 12));
    expect(t.constraints()).toContain('horizontal line');
  });

  it('makes a coincidence of two points, or a point on a curve in either order', async () => {
    const t = await setup({ tool: 'coincident' });
    draw(t, {
      a0: pt(0, 0),
      a1: pt(20, 0),
      a: line('a0', 'a1'),
      p: pt(10, 3),
      q: pt(25, 5),
      c0: pt(40, 0),
      c: { type: 'circle', center: 'c0' as SketchEntityId, radius: 5, construction: false },
    });
    const raw = () => Object.values(t.data().constraints);
    t.host.click(at(10, 3)); // p
    t.host.click(at(5, 0)); // the line
    expect(raw()).toEqual([{ type: 'pointOnCurve', point: 'p', curve: 'a' }]);
    t.host.click(at(45, 0)); // the circle first: only a point may follow
    expect(prompt(t)).toBe('Pick a point to put on the curve.');
    t.host.click(at(25, 5));
    // Solving moves things: pick the rest where they are now.
    const click = (id: string) => t.host.click(at(...t.point(id as SketchEntityId)));
    click('a1');
    click('c0');
    expect(raw().slice(1)).toEqual([
      { type: 'pointOnCurve', point: 'q', curve: 'c' },
      { type: 'coincident', a: 'a1', b: 'c0' },
    ]);
    expect(t.report().ok).toBe(true);
  });

  it('fixes an entity, and frees it when fixed again', async () => {
    const t = await twoLines('fix');
    t.host.click(at(10, 0));
    expect(t.constraints()).toEqual(['fix line']);
    t.host.click(at(10, 0));
    expect(t.constraints()).toEqual([]);
    // Freeing is its own undo step.
    t.store.getState().undo();
    expect(t.constraints()).toEqual(['fix line']);
  });

  it('puts a point at the middle of a line from either pick order', async () => {
    const t = await twoLines('midpoint');
    t.host.click(at(10, 0)); // the line first
    expect(prompt(t)).toBe('Pick the point to put at its middle.');
    t.host.click(at(0, 10)); // b0
    expect(Object.values(t.data().constraints)).toEqual([
      { type: 'midpoint', point: 'b0', of: 'a' },
    ]);
    expect(t.report().ok).toBe(true);
  });

  it('keeps the side of a tangent joint, and joins a line to a circle anywhere', async () => {
    const t = await setup({ tool: 'tangent' });
    draw(
      t,
      {
        l0: pt(-20, 1),
        l1: pt(0, 0),
        l: line('l0', 'l1'),
        ac: pt(0, 10),
        as: pt(0, 0),
        ae: pt(10, 10),
        arc: { type: 'arc', center: 'ac', start: 'as', end: 'ae', construction: false },
        cc: pt(40, 10),
        c: { type: 'circle', center: 'cc', radius: 5, construction: false },
      } as unknown as Record<string, SketchEntity>,
      { j: { type: 'coincident', a: 'l1', b: 'as' } as SketchConstraint },
    );
    t.host.click(at(-10, 0.5));
    t.host.click(at(10 * Math.SQRT1_2, 10 * (1 - Math.SQRT1_2))); // the arc
    const joint = Object.values(t.data().constraints).find((c) => c.type === 'tangent');
    expect(joint).toMatchObject({ type: 'tangent', a: 'l', b: 'arc', reversed: false });
    // A line can't be tangent to a line.
    t.host.click(at(-10, 0.5));
    t.host.click(at(-10, 0.5));
    expect(t.host.state.getState().tool?.preview().picked).toEqual(['l']);
    t.host.click(at(45, 10)); // the circle: no joint, so no side
    const free = Object.values(t.data().constraints).filter((c) => c.type === 'tangent')[1];
    expect(free).toEqual({ type: 'tangent', a: 'l', b: 'c' });
    expect(t.report().ok).toBe(true);
  });

  it('makes two points symmetric about a line', async () => {
    const t = await setup({ tool: 'symmetric' });
    draw(t, {
      p: pt(-5, 3),
      q: pt(6, 4),
      y0: pt(0, -10),
      y1: pt(0, 10),
      axis: line('y0', 'y1'),
    });
    t.host.click(at(-5, 3));
    expect(prompt(t)).toBe('Pick its mirror image.');
    t.host.click(at(0, 5)); // the axis isn't a point: nothing
    t.host.click(at(6, 4));
    expect(prompt(t)).toBe('Pick the line to mirror about.');
    t.host.click(at(0, 5));
    expect(Object.values(t.data().constraints)).toEqual([
      { type: 'symmetric', a: 'p', b: 'q', axis: 'axis' },
    ]);
    // The axis may turn too: q is p mirrored about wherever it ended up.
    const [p, q, a, b] = [
      t.point(eid('p')),
      t.point(eid('q')),
      t.point(eid('y0')),
      t.point(eid('y1')),
    ];
    const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
    const [mx, my] = [(p[0] + q[0]) / 2 - a[0], (p[1] + q[1]) / 2 - a[1]];
    expect(mx * dy - my * dx).toBeCloseTo(0, 6); // the midpoint is on the axis
    expect((q[0] - p[0]) * dx + (q[1] - p[1]) * dy).toBeCloseTo(0, 6); // p→q is square to it
  });

  it('matches lengths or radii, not a line with a circle', async () => {
    const t = await setup({ tool: 'equal' });
    draw(t, {
      a0: pt(0, 0),
      a1: pt(20, 0),
      a: line('a0', 'a1'),
      c0: pt(40, 0),
      c: { type: 'circle', center: 'c0' as SketchEntityId, radius: 5, construction: false },
      d0: pt(60, 0),
      d: { type: 'circle', center: 'd0' as SketchEntityId, radius: 8, construction: false },
    });
    t.host.click(at(10, 0));
    expect(prompt(t)).toBe('Pick a line to make the same length.');
    t.host.click(at(45, 0)); // refused
    t.host.escape(); // drops the line
    t.host.click(at(45, 0));
    t.host.click(at(68, 0));
    expect(t.constraints()).toEqual(['equal circle circle']);
    const radii = t.byType('circle').map((c) => (c.type === 'circle' ? c.radius : 0));
    expect(radii[0]).toBeCloseTo(radii[1] as number, 6);
  });

  it('steps back with Esc: the last pick, then the tool', async () => {
    const t = await twoLines('collinear');
    t.host.click(at(10, 0));
    t.host.escape();
    expect(t.host.state.getState().tool?.preview().picked).toBeUndefined();
    expect(t.session.getState().activeTool).toBe('collinear');
    t.host.escape();
    expect(t.session.getState().activeTool).toBeUndefined();
  });
});
