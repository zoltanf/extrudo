import {
  addProjection,
  addToSketch,
  type GeomRef,
  type ProjectionId,
  type SketchData,
  type SketchEntityId,
} from '@extrudo/core';
import type { ModelSnap } from '@extrudo/sketch/inference';
import { afterEach, describe, expect, it } from 'vitest';
import { TOOLS } from '../../shell/tools';
import { finishSketch } from '../mode';
import { CONSTRAINT_TOOLS } from './constrain';
import { HOST_TOOL_IDS } from './host';
import { CONSTRAINT_TOOL_IDS, isConstraintTool, isSketchTool, SKETCH_TOOL_IDS } from './ids';
import { LINE_TOOL } from './line';
import { at, disposeHosts, setup } from './testing';

afterEach(disposeHosts);

describe('tool IDs', () => {
  it('lists every tool the host runs, each in the toolbar catalogue', () => {
    expect([...SKETCH_TOOL_IDS].sort()).toEqual([...HOST_TOOL_IDS].sort());
    for (const id of SKETCH_TOOL_IDS) {
      const tool = (TOOLS as Record<string, { comesWith?: string }>)[id];
      expect(tool, id).toBeDefined();
      expect(tool?.comesWith, id).toBeUndefined();
    }
  });

  it('lists the constraint tools, which are sketch tools too', () => {
    expect([...CONSTRAINT_TOOL_IDS]).toEqual([...CONSTRAINT_TOOLS]);
    for (const id of CONSTRAINT_TOOL_IDS) {
      expect(isSketchTool(id) && isConstraintTool(id), id).toBe(true);
    }
    expect(isConstraintTool(LINE_TOOL)).toBe(false);
  });
});

describe('line tool through the host', () => {
  it('draws a chain with inferred constraints and closes it on its first point', async () => {
    const t = await setup();
    t.host.click(at(10.3, 5)); // start
    t.host.move(at(40, 5.4));
    expect(t.host.state.getState().pointer?.alignments[0]?.source).toEqual({ kind: 'anchor' });
    t.host.click(at(40, 5.4)); // horizontal
    t.host.click(at(40.3, 30)); // vertical
    t.host.click(at(10.5, 5.2)); // snaps to the first point and closes the loop
    expect(t.byType('line')).toHaveLength(3);
    expect(t.byType('point')).toHaveLength(6);
    expect(t.constraints().sort()).toEqual(
      [
        'coincident (40,5) (40,5)',
        'coincident (40,30) (40,30)',
        'coincident (10.3,5) (10.3,5)',
        'horizontal line',
        'vertical line',
      ].sort(),
    );
    // The loop closed: the next click starts a new line instead of adding a segment.
    expect(t.host.state.getState().tool?.anchor()).toBeUndefined();
    // One undo step per segment inside the sketch transaction.
    t.store.getState().undo();
    expect(t.byType('line')).toHaveLength(2);
  });

  it('shows the live length and angle, and places a segment from typed values', async () => {
    const t = await setup();
    t.host.click(at(0.5, 5.2)); // no snap: 8 px is 0.8 mm, the origin is further
    t.host.move(at(20.5, 5.2));
    const fields = t.host.state.getState().tool?.fields() ?? [];
    expect(fields.map((f) => [f.name, Math.round(f.value * 1000) / 1000])).toEqual([
      ['length', 20],
      ['angle', 0],
    ]);
    t.host.lock('length', { expr: 'w + 5', value: 25 });
    t.host.lock('angle', { expr: '90', value: 90 });
    t.host.enter();
    const [line] = t.byType('line');
    if (line?.type !== 'line') throw new Error('no line');
    expect(t.point(line.start)).toEqual([0.5, 5.2]);
    const end = t.point(line.end);
    expect(end[0]).toBeCloseTo(0.5, 9);
    expect(end[1]).toBeCloseTo(30.2, 9);
    expect(Object.values(t.data().dimensions)).toEqual([
      {
        type: 'distance',
        orientation: 'aligned',
        a: expect.any(String),
        expr: 'w + 5',
        paramName: 'd1',
        driven: false,
      },
    ]);
    expect(t.constraints()).toEqual(['vertical line']);
    // The lock is spent; the chain goes on from the new end.
    expect(
      t.host.state
        .getState()
        .tool?.fields()
        .every((f) => !f.locked),
    ).toBe(true);
    const anchor = t.host.state.getState().tool?.anchor() ?? [Number.NaN, Number.NaN];
    expect(anchor[0]).toBeCloseTo(end[0], 9);
    expect(anchor[1]).toBeCloseTo(end[1], 9);
  });

  it('snaps to existing geometry and pins a point clicked at the origin', async () => {
    const t = await setup();
    t.host.click(at(0.3, -0.2)); // the origin
    t.host.click(at(20, 0.5)); // level with the anchor
    t.host.escape(); // end the chain
    t.host.click(at(10.2, 0.4)); // the first line's midpoint
    t.host.click(at(10.4, 15)); // vertical from the anchor
    expect(t.constraints().sort()).toEqual(
      ['fix (0,0)', 'horizontal line', 'midpoint (10,0) line', 'vertical line'].sort(),
    );
  });

  it('turns inference off while the modifier is held', async () => {
    const t = await setup();
    t.host.click(at(0.3, -0.2, false));
    t.host.click(at(20, 0.5, false));
    expect(t.constraints()).toEqual([]);
    const [line] = t.byType('line');
    if (line?.type !== 'line') throw new Error('no line');
    expect(t.point(line.start)).toEqual([0.3, -0.2]);
  });

  it('snaps to the grid when Snap is on', async () => {
    const t = await setup();
    t.viewport.getState().setSnap(true);
    // At 0.1 mm/px the grid step is 10 mm.
    t.host.click(at(13, 22));
    t.host.click(at(38, 23));
    const [line] = t.byType('line');
    if (line?.type !== 'line') throw new Error('no line');
    expect(t.point(line.start)).toEqual([10, 20]);
    // Level with the anchor: horizontal, and x on the grid.
    expect(t.point(line.end)).toEqual([40, 20]);
  });

  it('drops inferred constraints the solver rejects, and keeps required ones', async () => {
    const checked: string[] = [];
    const fake = {
      check: (sketch: SketchData, _values: unknown, id: string) => {
        const type = sketch.constraints[id as never]?.type ?? '?';
        checked.push(type);
        return {
          accepted: type !== 'horizontal',
          ok: true,
          dof: 0,
          conflicting: [],
          redundant: [],
          partlyRedundant: [],
        };
      },
      solve: () => ({
        ok: true,
        dof: 0,
        conflicting: [],
        redundant: [],
        partlyRedundant: [],
        free: [],
        components: [],
        skipped: [],
        solution: { points: {}, radii: {} },
      }),
      dispose: () => {},
    };
    const t = await setup({ solver: fake });
    t.host.click(at(5, 5));
    t.host.click(at(30, 5.3)); // horizontal: rejected
    t.host.click(at(30.2, 20)); // vertical: accepted; the join is required, never checked
    expect(checked).toEqual(['horizontal', 'vertical']);
    expect(t.constraints().sort()).toEqual(['coincident (30,5) (30,5)', 'vertical line'].sort());
  });

  it('commits unsolved, with every inferred constraint, before the solver loads', async () => {
    const t = await setup({ solver: 'none' });
    t.host.click(at(5, 5));
    t.host.click(at(30, 5.3));
    expect(t.constraints()).toEqual(['horizontal line']);
    // Unsolved: the end stays level with the start because inference put it there.
    const [line] = t.byType('line');
    if (line?.type !== 'line') throw new Error('no line');
    expect(t.point(line.end)).toEqual([30, 5]);
  });

  it('solves the sketch as it commits, moving existing geometry in the same step', async () => {
    const t = await setup();
    const eid = (id: string) => id as SketchEntityId;
    // A 20 mm line whose dimension says 30: out of date, as after a parameter change.
    t.store.getState().dispatch(
      addToSketch({
        feature: t.id,
        entities: {
          [eid('a')]: { type: 'point', x: 0, y: 10 },
          [eid('b')]: { type: 'point', x: 20, y: 10 },
          [eid('l')]: { type: 'line', start: eid('a'), end: eid('b'), construction: false },
        },
        constraints: {
          ['h' as never]: { type: 'horizontal', a: eid('l') },
          ['f' as never]: { type: 'fix', entity: eid('a') },
        },
        dimensions: {
          ['d' as never]: {
            type: 'distance',
            orientation: 'aligned',
            a: eid('l'),
            expr: '30',
            driven: false,
          },
        },
      }),
    );
    const steps = t.store.getState().undoLabel;
    t.host.start(LINE_TOOL);
    t.host.click(at(20.2, 10.3)); // the line's end
    t.host.click(at(20.4, 40)); // vertical
    expect(t.point(eid('b'))[0]).toBeCloseTo(30, 6);
    const [, drawn] = t.byType('line');
    if (drawn?.type !== 'line') throw new Error('no line');
    expect(t.point(drawn.start)[0]).toBeCloseTo(30, 6);
    expect(t.point(drawn.end)[0]).toBeCloseTo(30, 6);
    // One undo puts both back.
    t.store.getState().undo();
    expect(t.store.getState().undoLabel).toBe(steps);
    expect(t.point(eid('b'))).toEqual([20, 10]);
  });

  it('steps back with Esc: typed values, then the chain, then the tool', async () => {
    const t = await setup();
    t.host.click(at(5, 5));
    t.host.lock('length', { expr: '10', value: 10 });
    t.host.escape();
    expect(t.host.state.getState().tool?.fields()[0]?.locked).toBeUndefined();
    expect(t.host.state.getState().tool?.anchor()).toEqual([5, 5]);
    t.host.escape();
    expect(t.host.state.getState().tool?.anchor()).toBeUndefined();
    t.host.escape();
    expect(t.host.state.getState().tool).toBeUndefined();
    expect(t.session.getState().activeTool).toBeUndefined();
  });

  it('starts afresh after an undo, and stops when the sketch closes', async () => {
    const t = await setup();
    t.host.click(at(5, 5));
    t.host.click(at(30, 5.3));
    expect(t.host.state.getState().tool?.anchor()).toEqual([30, 5]);
    t.store.getState().undo();
    // The chain's last point is gone: the tool starts over.
    expect(t.host.state.getState().tool?.anchor()).toBeUndefined();
    expect(t.host.state.getState().tool?.id).toBe(LINE_TOOL);
    finishSketch(t);
    expect(t.host.state.getState().tool).toBeUndefined();
  });

  it('only starts in sketch mode', async () => {
    const t = await setup();
    finishSketch(t);
    t.host.start(LINE_TOOL);
    expect(t.host.state.getState().tool).toBeUndefined();
    expect(t.session.getState().activeTool).toBeUndefined();
  });
});

describe('auto-project through the host (P6-07)', () => {
  const ref: GeomRef = { kind: 'vertex', id: 'v[face0|face1]' };
  const frame = {
    origin: [0, 0, 0] as [number, number, number],
    normal: [0, 0, 1] as [number, number, number],
    x: [1, 0, 0] as [number, number, number],
    y: [0, 1, 0] as [number, number, number],
  };
  const model = { ref, point: [5, 0] as [number, number], kind: 'vertex' as const };
  const report = (id: string) => ({
    frame,
    projections: {
      [id]: { curves: { vertex: { type: 'point' as const, at: [5, 0] as [number, number] } } },
    },
  });

  it('projects a body vertex a line end snapped to, holds it, and undoes as one', async () => {
    const t = await setup();
    t.host.click({ ...at(5, 0.1), model });
    t.host.click(at(20, 0.3));
    const projections = t.data().projections ?? {};
    const [key] = Object.keys(projections);
    expect(key).toBeDefined();
    const pid = key as ProjectionId;
    expect(projections[pid]?.ref).toEqual(ref);
    // The kernel reports the projected vertex on the next recompute.
    t.host.syncProjections({ [t.id]: report(pid) });
    const projected = t.data().projections?.[pid]?.curves.vertex;
    expect(projected).toBeTruthy();
    expect(t.data().entities[projected as SketchEntityId]).toMatchObject({
      type: 'point',
      x: 5,
      y: 0,
    });
    // The placed point is held on the projected vertex.
    expect(
      Object.values(t.data().constraints).some((c) => c.type === 'coincident' && c.b === projected),
    ).toBe(true);
    // One undo takes the line, the projection and the constraint away.
    t.store.getState().undo();
    expect(t.byType('line')).toHaveLength(0);
    expect(Object.keys(t.data().projections ?? {})).toHaveLength(0);
  });

  it('reuses a ref the sketch already projects', async () => {
    const t = await setup();
    // A record the sketch already holds, its curves not reported yet.
    t.store.getState().dispatch(addProjection({ feature: t.id, id: 'proj' as ProjectionId, ref }));
    t.host.click({ ...at(5, 0.1), model });
    t.host.click(at(20, 0.3));
    // No second record for the same ref.
    expect(Object.keys(t.data().projections ?? {})).toEqual(['proj']);
    // The report lands: the projected point appears and the point is held on it.
    t.host.syncProjections({ [t.id]: report('proj') });
    const projected = t.data().projections?.['proj' as ProjectionId]?.curves.vertex;
    expect(projected).toBeTruthy();
    expect(
      Object.values(t.data().constraints).some((c) => c.type === 'coincident' && c.b === projected),
    ).toBe(true);
  });
});

describe('constraint and dimension tools pick body geometry (P6-07 slice 2)', () => {
  const vertexRef: GeomRef = { kind: 'vertex', id: 'v[face0|face1]' };
  const edgeRef: GeomRef = { kind: 'edge', id: 'e[face0|face1]' };
  const frame = {
    origin: [0, 0, 0] as [number, number, number],
    normal: [0, 0, 1] as [number, number, number],
    x: [1, 0, 0] as [number, number, number],
    y: [0, 1, 0] as [number, number, number],
  };
  const vertex = { ref: vertexRef, point: [5, 0] as [number, number], kind: 'vertex' as const };
  const edge = (at: [number, number]): ModelSnap => ({
    ref: edgeRef,
    point: at,
    kind: 'edge',
    line: [
      [at[0], at[1] - 2],
      [at[0], at[1] + 2],
    ],
  });
  const vertexReport = (id: string) => ({
    frame,
    projections: {
      [id]: { curves: { vertex: { type: 'point' as const, at: [5, 0] as [number, number] } } },
    },
  });
  const edgeReport = (id: string, a: [number, number], b: [number, number]) => ({
    frame,
    projections: { [id]: { curves: { edge: { type: 'line' as const, a, b } } } },
  });
  const drawPoint = (t: Awaited<ReturnType<typeof setup>>, id: string, x: number, y: number) =>
    t.store
      .getState()
      .dispatch(
        addToSketch({ feature: t.id, entities: { [id]: { type: 'point', x, y } } as never }),
      );
  const drawLine = (t: Awaited<ReturnType<typeof setup>>, id: string) =>
    t.store.getState().dispatch(
      addToSketch({
        feature: t.id,
        entities: {
          [`${id}0`]: { type: 'point', x: 0, y: 0 },
          [`${id}1`]: { type: 'point', x: 20, y: 0 },
          [id]: { type: 'line', start: `${id}0`, end: `${id}1`, construction: false },
        } as never,
      }),
    );

  it('holds a Coincident between a sketch point and a body vertex, projected later', async () => {
    const t = await setup({ tool: 'coincident' });
    drawPoint(t, 'p', 0, 0);
    t.host.click(at(0, 0));
    t.host.click({ ...at(5, 0.1), model: vertex });
    // The vertex isn't projected yet: the projection record is in, the constraint is not.
    const projections = t.data().projections ?? {};
    const pid = Object.keys(projections)[0] as ProjectionId;
    expect(Object.values(t.data().constraints)).toHaveLength(0);
    // The kernel reports the vertex; the coincident follows in the same step.
    t.host.syncProjections({ [t.id]: vertexReport(pid) });
    const projected = t.data().projections?.[pid]?.curves.vertex;
    expect(Object.values(t.data().constraints)).toEqual([
      { type: 'coincident', a: 'p', b: projected },
    ]);
    // One undo takes the constraint and the projection away together.
    t.store.getState().undo();
    expect(t.data().constraints).toEqual({});
    expect(t.data().projections ?? {}).toEqual({});
  });

  it('picks an already-projected vertex as an ordinary sketch entity', async () => {
    const t = await setup({ tool: 'coincident' });
    drawPoint(t, 'p', 0, 0);
    t.store
      .getState()
      .dispatch(addProjection({ feature: t.id, id: 'proj' as ProjectionId, ref: vertexRef }));
    t.host.syncProjections({ [t.id]: vertexReport('proj') });
    const projected = t.data().projections?.['proj' as ProjectionId]?.curves.vertex;
    expect(projected).toBeTruthy();
    t.host.click(at(0, 0));
    t.host.click(at(5, 0.1));
    // No new projection, and the constraint is in at once.
    expect(Object.keys(t.data().projections ?? {})).toEqual(['proj']);
    expect(Object.values(t.data().constraints)).toEqual([
      { type: 'coincident', a: 'p', b: projected },
    ]);
  });

  it('makes a Parallel to a body edge, projected later', async () => {
    const t = await setup({ tool: 'parallel' });
    drawLine(t, 'a');
    t.host.click(at(10, 0.2));
    t.host.click({ ...at(10, 5.1), model: edge([10, 5]) });
    const projections = t.data().projections ?? {};
    const pid = Object.keys(projections)[0] as ProjectionId;
    t.host.syncProjections({ [t.id]: edgeReport(pid, [0, 10], [20, 14]) });
    const projected = t.data().projections?.[pid]?.curves.edge;
    expect(Object.values(t.data().constraints)).toEqual([
      { type: 'parallel', a: 'a', b: projected },
    ]);
    t.store.getState().undo();
    expect(t.data().constraints).toEqual({});
    expect(t.data().projections ?? {}).toEqual({});
  });

  it('measures a Distance from a sketch point to a body vertex', async () => {
    const t = await setup({ tool: 'dimension' });
    drawPoint(t, 'p', 0, 0);
    t.host.click(at(0, 0));
    t.host.click({ ...at(5, 0.1), model: vertex });
    t.host.click(at(2.5, 4)); // place the label
    const projections = t.data().projections ?? {};
    const pid = Object.keys(projections)[0] as ProjectionId;
    expect(Object.values(t.data().dimensions)).toHaveLength(0);
    t.host.syncProjections({ [t.id]: vertexReport(pid) });
    const projected = t.data().projections?.[pid]?.curves.vertex;
    expect(Object.values(t.data().dimensions)).toEqual([
      expect.objectContaining({
        type: 'distance',
        a: 'p',
        b: projected,
        expr: '5',
        paramName: 'd1',
      }),
    ]);
    t.store.getState().undo();
    expect(t.data().dimensions).toEqual({});
    expect(t.data().projections ?? {}).toEqual({});
  });

  it('measures a Distance between two body edges', async () => {
    const t = await setup({ tool: 'dimension' });
    const e1: ModelSnap = {
      ref: { kind: 'edge', id: 'e1' },
      point: [10, 0],
      kind: 'edge',
      line: [
        [0, 0],
        [20, 0],
      ],
    };
    const e2: ModelSnap = {
      ref: { kind: 'edge', id: 'e2' },
      point: [10, 10],
      kind: 'edge',
      line: [
        [0, 10],
        [20, 10],
      ],
    };
    t.host.click({ ...at(10, 0.1), model: e1 });
    t.host.click({ ...at(10, 10.1), model: e2 });
    t.host.click(at(-5, 5)); // place the label
    const projections = t.data().projections ?? {};
    const ids = Object.keys(projections) as ProjectionId[];
    expect(ids).toHaveLength(2);
    // Report both edges; the distance measures 10.
    const reports = Object.fromEntries(
      ids.map((id) => [id, { curves: { edge: { type: 'line', a: [0, 0], b: [20, 0] } } }]),
    );
    reports[ids[1] as string] = { curves: { edge: { type: 'line', a: [0, 10], b: [20, 10] } } };
    t.host.syncProjections({
      [t.id]: { frame, projections: reports as never },
    });
    const [d] = Object.values(t.data().dimensions);
    expect(d).toMatchObject({ type: 'distance', expr: '10' });
  });

  it('offers no model pick with the preference off', async () => {
    const t = await setup({ tool: 'parallel' });
    drawLine(t, 'a');
    t.viewport.getState().setAutoProject(false);
    t.host.click(at(10, 0.2));
    t.host.click({ ...at(10, 0.2), model: edge([10, 0]) });
    expect(t.host.state.getState().tool?.preview().picked).toEqual(['a']);
    expect(t.data().constraints).toEqual({});
    expect(t.data().projections ?? {}).toEqual({});
  });
});
