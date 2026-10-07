import {
  addParameter,
  addToSketch,
  CommandError,
  type ConstraintId,
  type DimensionId,
  evaluateParameters,
  type ParameterId,
  type SketchConstraint,
  type SketchDimension,
  type SketchEntity,
  type SketchEntityId,
  updateParameter,
  updateSketchDimension,
} from '@extrudo/core';
import type { ModelSnap } from '@extrudo/sketch/inference';
import { afterEach, describe, expect, it } from 'vitest';
import { DIMENSION_TOOL } from './dimension';
import { at, disposeHosts, setup } from './testing';

afterEach(disposeHosts);

type Setup = Awaited<ReturnType<typeof setup>>;

/** Adds geometry, constraints and dimensions to the open sketch directly, as if drawn earlier. */
function draw(
  t: Setup,
  entities: Record<string, SketchEntity>,
  constraints: Record<string, SketchConstraint> = {},
  dimensions: Record<string, SketchDimension> = {},
) {
  t.store.getState().dispatch(
    addToSketch({
      feature: t.id,
      entities: entities as Record<SketchEntityId, SketchEntity>,
      constraints: constraints as Record<ConstraintId, SketchConstraint>,
      dimensions: dimensions as Record<DimensionId, SketchDimension>,
    }),
  );
}

const e = (id: string) => id as SketchEntityId;
const pt = (x: number, y: number): SketchEntity => ({ type: 'point', x, y });
const line = (start: string, end: string): SketchEntity => ({
  type: 'line',
  start: e(start),
  end: e(end),
  construction: false,
});

const prompt = (t: Setup) => t.host.state.getState().tool?.prompt();
const dims = (t: Setup) => Object.values(t.data().dimensions);
const length = (t: Setup, a: string, b: string) => {
  const [p, q] = [t.point(e(a)), t.point(e(b))];
  return Math.hypot(q[0] - p[0], q[1] - p[1]);
};

describe('Dimension tool', () => {
  it('places a line’s length where the next click is, and opens it for editing', async () => {
    const t = await setup({ tool: DIMENSION_TOOL });
    draw(t, { a0: pt(0, 0), a1: pt(20, 0), a: line('a0', 'a1') });
    expect(prompt(t)).toBe('Pick a line, circle or arc to dimension, or a point.');
    t.host.move(at(10, 0.3));
    expect(t.host.state.getState().tool?.preview().hover).toBe('a');
    t.host.click(at(10, 0.3));
    expect(prompt(t)).toBe('Click to place the length, or pick a second line or a point.');
    t.host.move(at(10, 6));
    expect(t.host.state.getState().tool?.preview().dimension).toMatchObject({
      type: 'distance',
      a: 'a',
      expr: '20',
    });
    t.host.click(at(10, 6));
    expect(dims(t)).toEqual([
      {
        type: 'distance',
        orientation: 'aligned',
        a: 'a',
        expr: '20',
        paramName: 'd1',
        driven: false,
        label: { x: 0, y: 6 },
      },
    ]);
    const [id] = Object.keys(t.data().dimensions);
    expect(t.host.state.getState().editing).toBe(id);
    // A parameter now: it shows in the parameters table.
    const d1 = evaluateParameters(t.store.getState().doc).parameters.get('d1');
    expect(d1?.owner).toMatchObject({ type: 'dimension', dimension: id });
    // The tool stays on for the next one.
    expect(prompt(t)).toBe('Pick a line, circle or arc to dimension, or a point.');
  });

  it('measures a slanted line horizontally, vertically or aligned, by where the label goes', async () => {
    const orientationAt = async (x: number, y: number) => {
      const t = await setup({ tool: DIMENSION_TOOL });
      draw(t, { a0: pt(0, 0), a1: pt(30, 40), a: line('a0', 'a1') });
      t.host.click(at(15, 20));
      t.host.click(at(x, y));
      const [d] = dims(t);
      return d?.type === 'distance' ? [d.orientation, d.expr] : undefined;
    };
    expect(await orientationAt(15, 55)).toEqual(['horizontal', '30']);
    expect(await orientationAt(-10, 20)).toEqual(['vertical', '40']);
    expect(await orientationAt(10, 26)).toEqual(['aligned', '50']);
  });

  it('gives a circle its diameter and an arc its radius', async () => {
    const t = await setup({ tool: DIMENSION_TOOL });
    draw(t, {
      c: pt(0, 0),
      hole: { type: 'circle', center: e('c'), radius: 5, construction: false },
      ac: pt(40, 0),
      as: pt(48, 0),
      ae: pt(40, 8),
      arc: { type: 'arc', center: e('ac'), start: e('as'), end: e('ae'), construction: false },
    });
    t.host.click(at(5, 0));
    expect(prompt(t)).toBe('Click to place the dimension.');
    t.host.click(at(10, 10));
    t.host.click(at(40 + 8 * Math.SQRT1_2, 8 * Math.SQRT1_2));
    t.host.click(at(55, 15));
    expect(dims(t).map((d) => [d.type, d.expr, d.paramName])).toEqual([
      ['diameter', '10', 'd1'],
      ['radius', '8', 'd2'],
    ]);
    expect(t.report().ok).toBe(true);
  });

  it('dimensions two points, a point and a line, two parallel lines, and an angle', async () => {
    const t = await setup({ tool: DIMENSION_TOOL });
    draw(t, {
      a0: pt(0, 0),
      a1: pt(20, 0),
      a: line('a0', 'a1'),
      b0: pt(0, 10),
      b1: pt(20, 10),
      b: line('b0', 'b1'),
      p: pt(40, 30),
      q: pt(50, 30),
      s0: pt(30, 0),
      s1: pt(40, 10),
      s: line('s0', 's1'),
    });
    // Two points (aligned, placed above them).
    t.host.click(at(40, 30));
    expect(prompt(t)).toBe('Pick a second point, or a line.');
    t.host.click(at(50, 30));
    t.host.click(at(45, 36));
    // A point and a line.
    t.host.click(at(40, 30));
    t.host.click(at(10, 0.2));
    t.host.click(at(38, 15));
    // Two parallel lines.
    t.host.click(at(10, 0.2));
    t.host.click(at(10, 10.2));
    t.host.click(at(-5, 5));
    // Two crossing lines: the angle between them, in the sector of the label.
    t.host.click(at(10, 0.2));
    t.host.click(at(35, 5.2));
    t.host.click(at(45, 3));
    expect(dims(t).map((d) => [d.type, d.expr])).toEqual([
      ['distance', '10'],
      ['distance', '30'],
      ['distance', '10'],
      ['angle', '45'],
    ]);
    const angle = dims(t)[3];
    expect(angle?.type === 'angle' && angle.supplement).toBeFalsy();
  });

  it('takes the supplement when the label goes in the other pair of angles', async () => {
    const t = await setup({ tool: DIMENSION_TOOL });
    draw(t, {
      a0: pt(0, 0),
      a1: pt(20, 0),
      a: line('a0', 'a1'),
      s0: pt(30, 0),
      s1: pt(40, 10),
      s: line('s0', 's1'),
    });
    t.host.click(at(10, 0.2));
    t.host.click(at(35, 5.2));
    t.host.click(at(25, 4));
    expect(dims(t)).toEqual([
      expect.objectContaining({ type: 'angle', expr: '135', supplement: true }),
    ]);
    expect(t.report().ok).toBe(true);
  });

  it('asks before adding one that would over-constrain the sketch', async () => {
    const t = await setup({ tool: DIMENSION_TOOL });
    draw(
      t,
      { a0: pt(0, 0), a1: pt(20, 0), a: line('a0', 'a1') },
      { f0: { type: 'fix', entity: e('a0') }, f1: { type: 'fix', entity: e('a1') } },
    );
    t.host.click(at(10, 0.2));
    t.host.click(at(10, 5));
    expect(dims(t)).toEqual([]);
    expect(t.host.state.getState().overConstrained).toEqual({
      dimension: expect.any(String),
      label: 'Distance',
    });

    // Added as driven: it measures, and has no parameter.
    t.host.resolveOverConstrained(true);
    expect(t.host.state.getState().overConstrained).toBeUndefined();
    expect(dims(t)).toEqual([expect.objectContaining({ expr: '20', driven: true })]);
    expect(dims(t)[0]?.paramName).toBeUndefined();
    expect(t.host.state.getState().error).toBeUndefined();

    // Cancelled: nothing is added.
    t.host.click(at(10, 0.2));
    t.host.click(at(10, -5));
    expect(t.host.state.getState().overConstrained).toBeDefined();
    t.host.resolveOverConstrained(false);
    expect(t.host.state.getState().overConstrained).toBeUndefined();
    expect(dims(t)).toHaveLength(1);
  });

  it('drops its picks on Esc, then leaves', async () => {
    const t = await setup({ tool: DIMENSION_TOOL });
    draw(t, { a0: pt(0, 0), a1: pt(20, 0), a: line('a0', 'a1') });
    t.host.click(at(10, 0.2));
    t.host.escape();
    expect(t.host.state.getState().tool?.preview().picked ?? []).toEqual([]);
    expect(t.host.state.getState().tool).toBeDefined();
    t.host.escape();
    expect(t.host.state.getState().tool).toBeUndefined();
  });
});

describe('apply: changes that move sketch geometry', () => {
  /** A horizontal line from a fixed origin, its length a driving dimension `k`. */
  async function dimensioned(expr: string) {
    const t = await setup({ tool: DIMENSION_TOOL });
    draw(
      t,
      { a0: pt(0, 0), a1: pt(20, 0), a: line('a0', 'a1') },
      { f: { type: 'fix', entity: e('a0') }, h: { type: 'horizontal', a: e('a') } },
    );
    t.host.click(at(10, 0.2));
    t.host.click(at(10, 5));
    const [id] = Object.keys(t.data().dimensions) as DimensionId[];
    if (!id) throw new Error('no dimension');
    if (expr !== '20') {
      t.host.apply(updateSketchDimension({ feature: t.id, id, changes: { expr } }));
    }
    return { t, id };
  }

  it('solves the sketch with a dimension’s new value, as one undo step', async () => {
    const { t } = await dimensioned('35');
    expect(length(t, 'a0', 'a1')).toBeCloseTo(35, 9);
    expect(t.store.getState().undoLabel).toBe('Edit dimension');
    t.store.getState().undo();
    expect(length(t, 'a0', 'a1')).toBeCloseTo(20, 9);
    expect(dims(t)[0]?.expr).toBe('20');
  });

  it('follows a parameter the dimension uses', async () => {
    const { t, id } = await dimensioned('20');
    t.store.getState().dispatch(
      addParameter({
        parameter: { id: 'w' as ParameterId, name: 'w', expression: '12', unit: 'length' },
      }),
    );
    t.host.apply(updateSketchDimension({ feature: t.id, id, changes: { expr: 'w * 2' } }));
    expect(length(t, 'a0', 'a1')).toBeCloseTo(24, 9);
    t.host.apply(updateParameter({ id: 'w' as ParameterId, changes: { expression: '15' } }));
    expect(length(t, 'a0', 'a1')).toBeCloseTo(30, 9);
    t.store.getState().undo();
    expect(length(t, 'a0', 'a1')).toBeCloseTo(24, 9);
  });

  it('refuses a value the sketch can’t take, changing nothing', async () => {
    const t = await setup({ tool: DIMENSION_TOOL });
    // A triangle: a0 fixed, a1 level with it, all three sides 10 long.
    draw(
      t,
      { a0: pt(0, 0), a1: pt(10, 0), c: pt(5, 8) },
      {
        f: { type: 'fix', entity: e('a0') },
        h: { type: 'horizontal', a: e('a0'), b: e('a1') },
      },
      {
        k1: {
          type: 'distance',
          orientation: 'aligned',
          a: e('a0'),
          b: e('a1'),
          expr: '10',
          driven: false,
        },
        k2: {
          type: 'distance',
          orientation: 'aligned',
          a: e('a0'),
          b: e('c'),
          expr: '10',
          driven: false,
        },
        k3: {
          type: 'distance',
          orientation: 'aligned',
          a: e('a1'),
          b: e('c'),
          expr: '10',
          driven: false,
        },
      },
    );
    t.host.apply(
      updateSketchDimension({ feature: t.id, id: 'k1' as DimensionId, changes: { expr: '11' } }),
    );
    expect(length(t, 'a0', 'a1')).toBeCloseTo(11, 6);
    const before = t.store.getState().doc;
    expect(() =>
      t.host.apply(
        updateSketchDimension({ feature: t.id, id: 'k1' as DimensionId, changes: { expr: '100' } }),
      ),
    ).toThrow(CommandError);
    expect(t.store.getState().doc).toEqual(before);
    expect(t.store.getState().canRedo).toBe(false);
  });
});

describe('constraint status (P1-08)', () => {
  it('follows the open sketch through edits, value changes and undo', async () => {
    const t = await setup({ tool: DIMENSION_TOOL });
    const status = () => t.host.state.getState().status;
    draw(
      t,
      { a0: pt(0, 0), a1: pt(20, 0), a: line('a0', 'a1') },
      { f: { type: 'fix', entity: e('a0') }, h: { type: 'horizontal', a: e('a') } },
    );
    expect(status()?.dof).toBe(1);
    expect(status()?.entities).toEqual({ a0: 'fixed', a1: 'free', a: 'free' });

    t.host.click(at(10, 0.2));
    t.host.click(at(10, 5));
    expect(status()?.dof).toBe(0);
    expect(status()?.entities).toEqual({ a0: 'fixed', a1: 'fixed', a: 'fixed' });

    const [id] = Object.keys(t.data().dimensions) as DimensionId[];
    t.host.apply(
      updateSketchDimension({ feature: t.id, id: id as DimensionId, changes: { expr: '30' } }),
    );
    expect(status()?.dof).toBe(0);

    t.store.getState().undo();
    t.store.getState().undo();
    expect(status()?.dof).toBe(1);
  });

  it('is gone outside sketch mode', async () => {
    const t = await setup({ tool: DIMENSION_TOOL });
    draw(t, { a0: pt(0, 0), a1: pt(20, 0), a: line('a0', 'a1') });
    expect(t.host.state.getState().status?.dof).toBe(4);
    t.session.getState().exitSketch();
    expect(t.host.state.getState().status).toBeUndefined();
  });

  it('refuses a value that fixed geometry cannot meet', async () => {
    const t = await setup({ tool: DIMENSION_TOOL });
    draw(
      t,
      { a0: pt(0, 0), a1: pt(20, 0), a: line('a0', 'a1') },
      { f: { type: 'fix', entity: e('a') } },
      {
        k: {
          type: 'distance',
          orientation: 'aligned',
          a: e('a'),
          expr: '20',
          driven: false,
        } as SketchDimension,
      },
    );
    const k = 'k' as DimensionId;
    expect(t.host.state.getState().status?.over).toEqual([]);
    expect(() =>
      t.host.apply(updateSketchDimension({ feature: t.id, id: k, changes: { expr: '30' } })),
    ).toThrow(CommandError);
    expect(t.data().dimensions[k]?.expr).toBe('20');
  });

  it('refuses to make a dimension driving when that over-constrains the sketch', async () => {
    const t = await setup({ tool: DIMENSION_TOOL });
    draw(
      t,
      { a0: pt(0, 0), a1: pt(20, 0), a: line('a0', 'a1') },
      { f0: { type: 'fix', entity: e('a0') }, f1: { type: 'fix', entity: e('a1') } },
      {
        k: {
          type: 'distance',
          orientation: 'aligned',
          a: e('a'),
          expr: '20',
          driven: true,
        } as SketchDimension,
      },
    );
    const k = 'k' as DimensionId;
    expect(() =>
      t.host.apply(
        updateSketchDimension({ feature: t.id, id: k, changes: { driven: false, expr: '20' } }),
      ),
    ).toThrow(new CommandError('Distance would over-constrain the sketch, so it stays driven.'));
    expect(t.data().dimensions[k]?.driven).toBe(true);
    expect(t.host.state.getState().status?.over).toEqual([]);
  });
});

describe('Dimension tool with body geometry (P6-07 slice 2)', () => {
  const edgeAt = (y: number): ModelSnap => ({
    ref: { kind: 'edge', id: `e${y}` },
    point: [10, y],
    kind: 'edge',
    line: [
      [0, y],
      [20, y],
    ],
  });

  it('places a line’s length even when a body edge lies under the label click', async () => {
    const t = await setup({ tool: DIMENSION_TOOL });
    draw(t, { a0: pt(0, 0), a1: pt(20, 0), a: line('a0', 'a1') });
    t.host.click(at(10, 0.2)); // the line
    // The label goes below it, right under a body edge: it still places.
    t.host.click({ ...at(10, 6), model: edgeAt(6) });
    expect(dims(t)).toEqual([expect.objectContaining({ type: 'distance', a: 'a', expr: '20' })]);
    expect(t.data().projections ?? {}).toEqual({});
  });

  it('takes a body vertex as the second point of a distance', async () => {
    const t = await setup({ tool: DIMENSION_TOOL });
    draw(t, { p: pt(0, 0) });
    const vertex: ModelSnap = { ref: { kind: 'vertex', id: 'v' }, point: [10, 0], kind: 'vertex' };
    t.host.click(at(0, 0.1));
    t.host.click({ ...at(10, 0.1), model: vertex });
    t.host.click(at(5, 5)); // place the label
    expect(Object.keys(t.data().projections ?? {})).toHaveLength(1);
    expect(Object.values(t.data().dimensions)).toHaveLength(0); // pending
  });
});
