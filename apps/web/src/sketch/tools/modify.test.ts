import {
  addToSketch,
  type ConstraintId,
  type DimensionId,
  type SketchConstraint,
  type SketchDimension,
  type SketchEntity,
  type SketchEntityId,
} from '@extrudo/core';
import { afterEach, describe, expect, it } from 'vitest';
import { at, disposeHosts, setup } from './testing';

afterEach(disposeHosts);

type Setup = Awaited<ReturnType<typeof setup>>;

const e = (id: string) => id as SketchEntityId;
const pt = (x: number, y: number): SketchEntity => ({ type: 'point', x, y });
const line = (start: string, end: string): SketchEntity => ({
  type: 'line',
  start: e(start),
  end: e(end),
  construction: false,
});

/** Adds geometry (and constraints, dimensions) to the open sketch, as if drawn earlier. */
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

/** A horizontal line h across a vertical line v, crossing at (10, 0). */
async function cross(tool: string) {
  const t = await setup({ tool });
  draw(t, {
    h0: pt(0, 0),
    h1: pt(20, 0),
    h: line('h0', 'h1'),
    v0: pt(10, -10),
    v1: pt(10, 10),
    v: line('v0', 'v1'),
  });
  return t;
}

/** A 40 × 20 rectangle from a fixed origin corner, horizontal and vertical sides, width and height. */
async function rectangle(tool: string) {
  const t = await setup({ tool });
  draw(
    t,
    {
      a: pt(0, 0),
      b: pt(40, 0),
      c: pt(40, 20),
      d: pt(0, 20),
      a2: pt(0, 0),
      b2: pt(40, 0),
      c2: pt(40, 20),
      d2: pt(0, 20),
      bottom: line('a', 'b2'),
      right: line('b', 'c2'),
      top: line('c', 'd2'),
      left: line('d', 'a2'),
    },
    {
      k1: { type: 'coincident', a: e('b2'), b: e('b') },
      k2: { type: 'coincident', a: e('c2'), b: e('c') },
      k3: { type: 'coincident', a: e('d2'), b: e('d') },
      k4: { type: 'coincident', a: e('a2'), b: e('a') },
      h1: { type: 'horizontal', a: e('bottom') },
      h2: { type: 'horizontal', a: e('top') },
      v1: { type: 'vertical', a: e('right') },
      v2: { type: 'vertical', a: e('left') },
      fix: { type: 'fix', entity: e('a') },
    },
    {
      w: {
        type: 'distance',
        orientation: 'aligned',
        a: e('bottom'),
        expr: '40',
        driven: false,
        paramName: 'd1',
      },
      hgt: {
        type: 'distance',
        orientation: 'aligned',
        a: e('right'),
        expr: '20',
        driven: false,
        paramName: 'd2',
      },
    },
  );
  return t;
}

const tool = (t: Setup) => t.host.state.getState().tool;
const error = (t: Setup) => t.host.state.getState().error;
const types = (t: Setup) =>
  Object.values(t.data().entities)
    .map((x) => x.type)
    .filter((x) => x !== 'point')
    .sort();
const clean = (t: Setup) => {
  const r = t.report();
  expect(r.conflicting).toEqual([]);
  expect(r.redundant).toEqual([]);
  expect(r.ok).toBe(true);
  return r;
};
const lineEnds = (t: Setup, id: string) => {
  const l = t.data().entities[e(id)];
  if (l?.type !== 'line') throw new Error(`${id} is not a line`);
  return [t.point(l.start), t.point(l.end)].map(([x, y]) => [
    Math.round(x * 1e6) / 1e6 + 0,
    Math.round(y * 1e6) / 1e6 + 0,
  ]);
};

describe('trim, extend and break', () => {
  it('shows what a trim takes away, and takes it as one undo step', async () => {
    const t = await cross('trim');
    t.host.move(at(15, 0.2));
    expect(tool(t)?.preview().removed).toEqual([
      [
        [10, 0],
        [20, 0],
      ],
    ]);
    t.host.click(at(15, 0.2));
    expect(lineEnds(t, 'h')).toEqual([
      [0, 0],
      [10, 0],
    ]);
    expect(t.constraints()).toEqual(['pointOnCurve (10,0) line']);
    clean(t);
    // The tool stays on; one undo brings the old end back.
    expect(tool(t)?.id).toBe('trim');
    t.store.getState().undo();
    expect(lineEnds(t, 'h')).toEqual([
      [0, 0],
      [20, 0],
    ]);
    expect(t.constraints()).toEqual([]);
  });

  it('extends a line to the next curve, and says so when nothing is there', async () => {
    const t = await setup({ tool: 'extend' });
    draw(t, {
      h0: pt(0, 0),
      h1: pt(5, 0),
      h: line('h0', 'h1'),
      v0: pt(10, -10),
      v1: pt(10, 10),
      v: line('v0', 'v1'),
    });
    t.host.move(at(4.5, 0.1));
    expect(tool(t)?.preview().accent).toEqual([
      [
        [5, 0],
        [10, 0],
      ],
    ]);
    t.host.click(at(4.5, 0.1));
    expect(lineEnds(t, 'h')).toEqual([
      [0, 0],
      [10, 0],
    ]);
    t.host.click(at(0.5, 0.1));
    expect(error(t)).toBe('There is nothing for it to reach.');
  });

  it('breaks a line where another crosses it', async () => {
    const t = await cross('break');
    t.host.click(at(15, 0.2));
    expect(types(t)).toEqual(['line', 'line', 'line']);
    expect(t.constraints()).toEqual(['coincident (10,0) (10,0)', 'parallel line line']);
    clean(t);
  });
});

describe('fillet and chamfer', () => {
  it('rounds a corner picked at its point, with a typed radius that becomes a parameter', async () => {
    const t = await rectangle('sketchFillet');
    t.host.move(at(40, 0.2));
    expect(tool(t)?.fields()).toEqual([
      expect.objectContaining({ name: 'size', label: 'Radius', value: 5 }),
    ]);
    t.host.lock('size', { expr: '4 mm', value: 4 });
    expect(tool(t)?.preview().accent).toHaveLength(1);
    t.host.click(at(40, 0.2));
    expect(types(t)).toEqual(['arc', 'line', 'line', 'line', 'line']);
    const radius = Object.values(t.data().dimensions).find((d) => d.type === 'radius');
    expect(radius).toMatchObject({ expr: '4 mm', paramName: 'd3', driven: false });
    expect(lineEnds(t, 'bottom')).toEqual([
      [0, 0],
      [36, 0],
    ]);
    expect(clean(t).dof).toBe(0);
    // The width parameter still drives the rectangle, now through the corner's sharp.
    expect(t.data().dimensions['w' as DimensionId]).toMatchObject({ paramName: 'd1', expr: '40' });
  });

  it('chamfers two picked lines; the second distance follows the first', async () => {
    const t = await rectangle('sketchChamfer');
    t.host.click(at(20, 0.2));
    expect(tool(t)?.prompt()).toBe('Pick the second line.');
    t.host.lock('size', { expr: '3', value: 3 });
    t.host.click(at(40, 10));
    // The width and height now run from the corner's sharp; the chamfer adds two distances.
    const distances = Object.entries(t.data().dimensions)
      .filter(([id]) => id !== 'w' && id !== 'hgt')
      .map(([, d]) => d);
    expect(distances.map((d) => [d.expr, d.paramName])).toEqual([
      ['3', 'd3'],
      ['d3', 'd4'],
    ]);
    expect(clean(t).dof).toBe(0);
  });

  it("refuses a radius that doesn't fit", async () => {
    const t = await rectangle('sketchFillet');
    t.host.lock('size', { expr: '30', value: 30 });
    t.host.click(at(40, 0.2));
    expect(error(t)).toBe("That radius doesn't fit this corner.");
    expect(types(t)).toEqual(['line', 'line', 'line', 'line']);
  });
});

describe('offset', () => {
  it('offsets a closed rectangle by a typed distance, one parameter driving every side', async () => {
    const t = await rectangle('sketchOffset');
    t.host.click(at(20, 0.2));
    expect(tool(t)?.preview().picked).toHaveLength(4);
    t.host.move(at(20, -4));
    expect(tool(t)?.fields()[0]).toMatchObject({ value: 4 });
    t.host.lock('distance', { expr: '5', value: 5 });
    t.host.click(at(20, -4));
    expect(types(t)).toHaveLength(8);
    const exprs = Object.values(t.data().dimensions)
      .filter((d) => d.type === 'distance' && d.b !== undefined)
      .map((d) => d.expr);
    expect(exprs).toEqual(['5', 'd3', 'd3', 'd3']);
    expect(clean(t).dof).toBe(0);
  });
});

describe('mirror, move, copy, patterns and scale', () => {
  it('mirrors the selection about a picked line', async () => {
    const t = await setup({ tool: 'line' });
    t.host.stop();
    draw(t, {
      a0: pt(0, -10),
      a1: pt(0, 10),
      axis: line('a0', 'a1'),
      l0: pt(3, 0),
      l1: pt(8, 5),
      l: line('l0', 'l1'),
    });
    t.session.getState().select([{ kind: 'sketchEntity', id: 'l' }], 'replace');
    t.host.start('sketchMirror');
    expect(tool(t)?.prompt()).toBe('Pick the line to mirror about.');
    t.host.click(at(0.1, 2));
    expect(types(t)).toEqual(['line', 'line', 'line']);
    expect(t.constraints()).toEqual(['symmetric line line line']);
    clean(t);
  });

  it('moves picked geometry by two clicks, the rest following through constraints', async () => {
    const t = await cross('sketchMove');
    t.store.getState().dispatch(
      addToSketch({
        feature: t.id,
        entities: {},
        constraints: { j: { type: 'coincident', a: e('h1'), b: e('v1') } } as never,
        points: { h1: { x: 10, y: 10 } } as never,
      }),
    );
    t.host.click(at(5, 5));
    expect(tool(t)?.preview().picked).toEqual(['h']);
    t.host.enter();
    t.host.click(at(0, 0));
    t.host.move(at(3, 1));
    expect(
      tool(t)
        ?.fields()
        .map((f) => f.name),
    ).toEqual(['length', 'angle']);
    t.host.click(at(3, 1));
    expect(error(t)).toBeUndefined();
    expect(lineEnds(t, 'h')).toEqual([
      [3, 1],
      [13, 11],
    ]);
    // The vertical line's joined end came along.
    expect(lineEnds(t, 'v')[1]).toEqual([13, 11]);
  });

  it('says so when constraints keep a move from happening', async () => {
    const t = await rectangle('sketchMove');
    t.host.click(at(0, 10));
    t.host.enter();
    t.host.click(at(0, 0));
    t.host.click(at(5, 0));
    expect(error(t)).toBe('Its constraints kept it from moving all the way.');
  });

  it('drops a copy at every click', async () => {
    const t = await cross('sketchCopy');
    t.host.click(at(15, 0.2));
    t.host.enter();
    t.host.click(at(0, 0));
    t.host.click(at(0, 30));
    t.host.click(at(0, 60));
    expect(types(t)).toHaveLength(4);
  });

  it('patterns in columns with typed counts and spacing', async () => {
    const t = await setup({ tool: 'line' });
    t.host.stop();
    draw(t, { o: pt(0, 0), c: { type: 'circle', center: e('o'), radius: 2, construction: false } });
    t.session.getState().select([{ kind: 'sketchEntity', id: 'c' }], 'replace');
    t.host.start('sketchRectangularPattern');
    t.host.lock('columns', { expr: '4', value: 4 });
    t.host.lock('spacingX', { expr: '10', value: 10 });
    t.host.move(at(50, 3));
    expect(tool(t)?.preview().accent).toHaveLength(3);
    t.host.click(at(50, 3));
    const centers = Object.values(t.data().entities)
      .filter((x) => x.type === 'circle')
      .map((x) => (x.type === 'circle' ? t.point(x.center)[0] : 0));
    expect(centers).toEqual([0, 10, 20, 30]);
  });

  it('patterns around a clicked center', async () => {
    const t = await setup({ tool: 'line' });
    t.host.stop();
    draw(t, {
      o: pt(10, 0),
      c: { type: 'circle', center: e('o'), radius: 2, construction: false },
    });
    t.session.getState().select([{ kind: 'sketchEntity', id: 'c' }], 'replace');
    t.host.start('sketchCircularPattern');
    t.host.lock('count', { expr: '4', value: 4 });
    t.host.click(at(0, 0));
    expect(types(t)).toEqual(['circle', 'circle', 'circle', 'circle']);
  });

  it('scales a circle and its diameter; refuses when a fix holds it', async () => {
    const t = await setup({ tool: 'line' });
    t.host.stop();
    draw(
      t,
      { o: pt(10, 0), c: { type: 'circle', center: e('o'), radius: 3, construction: false } },
      {},
      { dia: { type: 'diameter', curve: e('c'), expr: '6', driven: false, paramName: 'd1' } },
    );
    t.session.getState().select([{ kind: 'sketchEntity', id: 'c' }], 'replace');
    t.host.start('sketchScale');
    t.host.click(at(0, 0));
    t.host.lock('factor', { expr: '2', value: 2 });
    t.host.enter();
    expect(t.data().dimensions['dia' as DimensionId]?.expr).toBe('12');
    expect(t.data().entities[e('c')]).toMatchObject({ radius: 6 });
    expect(t.point(e('o'))).toEqual([20, 0]);
    draw(t, {}, { fx: { type: 'fix', entity: e('o') } });
    t.session.getState().select([{ kind: 'sketchEntity', id: 'c' }], 'replace');
    t.host.start('sketchScale');
    t.host.click(at(0, 0));
    t.host.lock('factor', { expr: '2', value: 2 });
    t.host.enter();
    expect(error(t)).toBe("Fixed geometry can't be scaled; unfix it first.");
  });

  it('refuses a scale that a dimension to other geometry would undo', async () => {
    const t = await setup({ tool: 'line' });
    t.host.stop();
    draw(
      t,
      {
        p: pt(0, 0),
        o: pt(10, 0),
        c: { type: 'circle', center: e('o'), radius: 3, construction: false },
      },
      { fx: { type: 'fix', entity: e('p') } },
      {
        gap: {
          type: 'distance',
          orientation: 'aligned',
          a: e('p'),
          b: e('o'),
          expr: '10',
          driven: false,
          paramName: 'd1',
        },
      },
    );
    t.session.getState().select([{ kind: 'sketchEntity', id: 'c' }], 'replace');
    t.host.start('sketchScale');
    t.host.click(at(0, 0));
    t.host.lock('factor', { expr: '2', value: 2 });
    t.host.enter();
    expect(error(t)).toBe("Scale can't be done: constraints hold some of it in place.");
    expect(t.point(e('o'))).toEqual([10, 0]);
  });
});
