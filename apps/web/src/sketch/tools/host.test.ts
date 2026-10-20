import {
  addProjection,
  addToSketch,
  dimensionAnchor,
  type GeomRef,
  originAxisRef,
  type ProjectionId,
  removeFromSketch,
  type SketchData,
  type SketchDimension,
  type SketchEntityId,
  type Vec2,
} from '@extrudo/core';
import type { ModelSnap } from '@extrudo/sketch/inference';
import { afterEach, describe, expect, it } from 'vitest';
import { TOOLS } from '../../shell/tools';
import { finishSketch } from '../mode';
import { CONSTRAINT_TOOLS } from './constrain';
import { lineAxisCursor } from './dimensionLayout';
import { HOST_TOOL_IDS, SNAP_PIXELS } from './host';
import { CONSTRAINT_TOOL_IDS, isConstraintTool, isSketchTool, SKETCH_TOOL_IDS } from './ids';
import { LINE_TOOL } from './line';
import { at, disposeHosts, PER_PIXEL, setup } from './testing';

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
  const model = { ref, point: [5, 0] as [number, number], kind: 'vertex' as const, straight: true };
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

  it('pins the pending constraint to the step that added the projection (gap 1)', async () => {
    const t = await setup();
    t.host.click({ ...at(5, 0.1), model });
    t.host.click(at(20, 0.3)); // line 1 + its projection, in one step
    const pid = Object.keys(t.data().projections ?? {})[0] as ProjectionId;
    // A second line lands in its own step before the kernel reports the projection.
    t.store.getState().dispatch(
      addToSketch({
        feature: t.id,
        entities: {
          q0: { type: 'point', x: 0, y: 10 },
          q1: { type: 'point', x: 10, y: 10 },
          l2: { type: 'line', start: 'q0', end: 'q1', construction: false },
        } as never,
      }),
    );
    t.host.syncProjections({ [t.id]: report(pid) });
    const projected = t.data().projections?.[pid]?.curves.vertex as SketchEntityId;
    // The coincident joins line 1's step: one undo takes only the second line,
    // and the projection entity stays.
    t.store.getState().undo();
    expect(t.byType('line')).toHaveLength(1);
    expect(t.data().entities[projected]).toBeDefined();
    expect(
      Object.values(t.data().constraints).some((c) => c.type === 'coincident' && c.b === projected),
    ).toBe(true);
    // A second undo takes line 1, the projection record and the constraint.
    t.store.getState().undo();
    expect(t.byType('line')).toHaveLength(0);
    expect(t.data().constraints).toEqual({});
    expect(t.data().projections ?? {}).toEqual({});
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
  const vertex = {
    ref: vertexRef,
    point: [5, 0] as [number, number],
    kind: 'vertex' as const,
    straight: true,
  };
  const edge = (at: [number, number]): ModelSnap => ({
    ref: edgeRef,
    point: at,
    kind: 'edge',
    straight: true,
    line: [
      [at[0], at[1] - 2],
      [at[0], at[1] + 2],
    ],
  });
  /** Another snap on the same edge (a second point of one edit). */
  const e2 = (at: [number, number]): ModelSnap => ({
    ref: edgeRef,
    point: at,
    kind: 'edge',
    straight: true,
    line: [
      [0, at[1]],
      [20, at[1]],
    ],
  });
  const bothReport = (id: string) => ({
    frame,
    projections: {
      [id]: {
        curves: {
          vertex: { type: 'point' as const, at: [5, 0] as [number, number] },
          // Far from the vertex, so a new snap at (5,0) sees the model, not this curve.
          edge: {
            type: 'line' as const,
            a: [0, 100] as [number, number],
            b: [20, 100] as [number, number],
          },
        },
      },
    },
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
      point: [10, 5],
      kind: 'edge',
      straight: true,
      line: [
        [0, 5],
        [20, 5],
      ],
    };
    const e2: ModelSnap = {
      ref: { kind: 'edge', id: 'e2' },
      point: [10, 15],
      kind: 'edge',
      straight: true,
      line: [
        [0, 15],
        [20, 15],
      ],
    };
    // Off the X axis: a datum axis wins over a body edge under the pointer (ADR-0093).
    t.host.click({ ...at(10, 5.1), model: e1 });
    t.host.click({ ...at(10, 15.1), model: e2 });
    t.host.click(at(-5, 5)); // place the label
    const projections = t.data().projections ?? {};
    const ids = Object.keys(projections) as ProjectionId[];
    expect(ids).toHaveLength(2);
    // Report both edges; the distance measures 10.
    const reports = Object.fromEntries(
      ids.map((id) => [id, { curves: { edge: { type: 'line', a: [0, 5], b: [20, 5] } } }]),
    );
    reports[ids[1] as string] = { curves: { edge: { type: 'line', a: [0, 15], b: [20, 15] } } };
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

  it('makes one projection for two points on the same ref (gap 2)', async () => {
    const t = await setup();
    const a = edge([5, 0]);
    const b = e2([15, 0]);
    t.host.click({ ...at(5, 0.1), model: a });
    t.host.click({ ...at(15, 0.1), model: b });
    const projections = t.data().projections ?? {};
    const pids = Object.keys(projections) as ProjectionId[];
    // One projection for the ref; two deferred constraints wait for it.
    expect(pids).toHaveLength(1);
    t.host.syncProjections({ [t.id]: edgeReport(pids[0] as string, [0, 0], [20, 0]) });
    const projected = t.data().projections?.[pids[0] as ProjectionId]?.curves.edge;
    expect(typeof projected).toBe('string');
    expect(
      Object.values(t.data().constraints).filter(
        (c) => c.type === 'pointOnCurve' && c.curve === projected,
      ),
    ).toHaveLength(2);
  });

  it('revives a projection curve the user deleted when the ref is snapped again (gap 3)', async () => {
    const t = await setup();
    const pid = 'proj' as ProjectionId;
    t.store.getState().dispatch(addProjection({ feature: t.id, id: pid, ref: vertexRef }));
    t.host.syncProjections({ [t.id]: bothReport(pid) });
    const projected = t.data().projections?.[pid]?.curves.vertex as SketchEntityId;
    // The user deletes the projected point; the edge curve keeps the record alive.
    t.store.getState().dispatch(removeFromSketch({ feature: t.id, entities: [projected] }));
    expect(t.data().projections?.[pid]?.curves.vertex).toBeNull();
    // Snapping to the same vertex again revives it.
    t.host.click({ ...at(5, 0.1), model: vertex });
    t.host.click(at(20, 0.3));
    expect(t.data().projections?.[pid]?.curves.vertex).toBeUndefined();
    // The next report re-adds the curve and the constraint holds.
    t.host.syncProjections({ [t.id]: bothReport(pid) });
    const again = t.data().projections?.[pid]?.curves.vertex;
    expect(typeof again).toBe('string');
    expect(
      Object.values(t.data().constraints).some((c) => c.type === 'coincident' && c.b === again),
    ).toBe(true);
  });

  it('drops a pending edit whose projection the report marks lost (gap 4)', async () => {
    const t = await setup({ tool: 'parallel' });
    drawLine(t, 'a');
    t.host.click(at(10, 0.2));
    t.host.click({ ...at(10, 5.1), model: edge([10, 5]) });
    const pid = Object.keys(t.data().projections ?? {})[0] as string;
    // A report with no curves for it (lost) drops the pending.
    t.host.syncProjections({ [t.id]: { frame, projections: { [pid]: { lost: true } } } });
    // A later report must not revive the edit.
    t.host.syncProjections({ [t.id]: edgeReport(pid, [0, 10], [20, 14]) });
    expect(t.data().constraints).toEqual({});
  });

  it('drops the pendings on dispose', async () => {
    const t = await setup({ tool: 'parallel' });
    drawLine(t, 'a');
    t.host.click(at(10, 0.2));
    t.host.click({ ...at(10, 5.1), model: edge([10, 5]) });
    const pid = Object.keys(t.data().projections ?? {})[0] as string;
    t.host.dispose();
    t.host.syncProjections({ [t.id]: edgeReport(pid, [0, 10], [20, 14]) });
    expect(t.data().constraints).toEqual({});
  });

  it('a forced curved pending resolves to a message, not a throw (gap 5)', async () => {
    const t = await setup({ tool: 'collinear' });
    drawLine(t, 'a');
    t.host.click(at(10, 0.2));
    // The pick lies about the edge being straight, so a pending is made; the
    // report then says the edge is an arc.
    t.host.click({ ...at(10, 5.1), model: edge([10, 5]) });
    const pid = Object.keys(t.data().projections ?? {})[0] as ProjectionId;
    expect(() =>
      t.host.syncProjections({
        [t.id]: {
          frame,
          projections: {
            [pid]: {
              curves: { edge: { type: 'arc', center: [10, 0], start: [0, 0], end: [20, 0] } },
            },
          },
        },
      }),
    ).not.toThrow();
    expect(t.host.state.getState().error).toBe("Couldn't hold Collinear on the body geometry.");
    expect(t.data().constraints).toEqual({});
  });
});

describe('constraint and dimension tools pick the origin and axes (ADR-0093)', () => {
  const XY = {
    origin: [0, 0, 0] as [number, number, number],
    normal: [0, 0, 1] as [number, number, number],
    x: [1, 0, 0] as [number, number, number],
    y: [0, 1, 0] as [number, number, number],
  };
  type T = Awaited<ReturnType<typeof setup>>;
  const draw = (t: T, entities: Record<string, unknown>) =>
    t.store.getState().dispatch(addToSketch({ feature: t.id, entities: entities as never }));
  /** A vertical line at x = 20 from y = -10 to 10. */
  const drawLine = (t: T) =>
    draw(t, {
      a0: { type: 'point', x: 20, y: -10 },
      a1: { type: 'point', x: 20, y: 10 },
      a: { type: 'line', start: 'a0', end: 'a1', construction: false },
    });
  /** The only projection, and the kernel's report of it on the next recompute. */
  const project = (t: T, curves: Record<string, unknown>) => {
    const [pid] = Object.keys(t.data().projections ?? {}) as ProjectionId[];
    if (!pid) throw new Error('no projection');
    t.host.syncProjections({ [t.id]: { frame: XY, projections: { [pid]: { curves } } as never } });
    return { pid, projection: t.data().projections?.[pid] };
  };
  const yAxis = { axis: { type: 'line', a: [0, -50], b: [0, 50] } };
  const origin = { point: { type: 'point', at: [0, 0] } };

  it('dimensions a line to the Y axis, which lands as a construction line', async () => {
    const t = await setup({ tool: 'dimension' });
    drawLine(t);
    t.host.click(at(20.1, 0)); // the line
    t.host.click(at(0.1, 5)); // the Y axis: commits, no placement click
    expect(t.data().dimensions).toEqual({});
    const { projection } = project(t, yAxis);
    expect(t.host.state.getState().editing).toBeDefined(); // the value field
    expect(projection?.ref).toEqual({ kind: 'axis', id: 'origin:y' });
    const axis = projection?.curves.axis as SketchEntityId;
    expect(t.data().entities[axis]).toMatchObject({ type: 'line', construction: true });
    expect(Object.values(t.data().dimensions)).toEqual([
      expect.objectContaining({ type: 'distance', a: 'a', b: axis, expr: '20' }),
    ]);
    // At the origin the projected axis gives way to the origin point.
    t.host.click(at(20, 10.1)); // the line's top end
    t.host.click(at(0.1, 0.1));
    t.host.click(at(10, 12)); // the origin point still waits for a placement
    const refs = Object.values(t.data().projections ?? {}).map((p) => p.ref.id);
    expect(refs).toEqual(['origin:y', 'origin:point']);
  });

  /** The stored dimension's label sits where `lineAxisCursor` placed it (an off-centre line). */
  const expectLabelAtCursor = (t: T, d: SketchDimension) => {
    const ends: [Vec2, Vec2] = [
      [20, 20],
      [20, 40],
    ];
    const axisEnds: [Vec2, Vec2] = [
      [0, -50],
      [0, 50],
    ];
    const want = lineAxisCursor(ends, axisEnds, 3 * SNAP_PIXELS * PER_PIXEL);
    if (!want) throw new Error('no cursor');
    const anchor = dimensionAnchor(t.data(), d);
    if (!anchor) throw new Error('no anchor');
    expect(anchor[0] + (d.label?.x ?? Number.NaN)).toBeCloseTo(want[0], 6);
    expect(anchor[1] + (d.label?.y ?? Number.NaN)).toBeCloseTo(want[1], 6);
  };
  /** A vertical line at x = 20 from y = 20 to 40, off the axis span's middle. */
  const drawOffCentreLine = (t: T) =>
    draw(t, {
      a0: { type: 'point', x: 20, y: 20 },
      a1: { type: 'point', x: 20, y: 40 },
      a: { type: 'line', start: 'a0', end: 'a1', construction: false },
    });

  it('keeps a fresh axis dimension label where it placed it, off-centre line', async () => {
    const t = await setup({ tool: 'dimension' });
    drawOffCentreLine(t);
    t.host.click(at(20.1, 30)); // the line
    t.host.click(at(0.1, 30)); // the Y axis, not stored yet: commits, no placement click
    expect(t.data().dimensions).toEqual({});
    const { projection } = project(t, yAxis);
    const axis = projection?.curves.axis as SketchEntityId;
    expect(t.data().entities[axis]).toMatchObject({ type: 'line', construction: true });
    const [d] = Object.values(t.data().dimensions);
    expect(d).toMatchObject({ type: 'distance', a: 'a', b: axis, expr: '20' });
    if (!d) throw new Error('no dimension');
    expectLabelAtCursor(t, d);
  });

  it('places the same label for an already stored Y axis', async () => {
    const t = await setup({ tool: 'dimension' });
    drawOffCentreLine(t);
    t.store
      .getState()
      .dispatch(
        addProjection({ feature: t.id, id: 'py' as ProjectionId, ref: originAxisRef('origin:y') }),
      );
    project(t, yAxis);
    const axis = t.data().projections?.['py' as ProjectionId]?.curves.axis as SketchEntityId;
    t.host.click(at(20.1, 30)); // the line
    t.host.click(at(0.1, 30)); // the stored Y axis: commits, no placement click
    const [d] = Object.values(t.data().dimensions);
    expect(d).toMatchObject({ type: 'distance', a: 'a', b: axis, expr: '20' });
    if (!d) throw new Error('no dimension');
    expectLabelAtCursor(t, d);
  });

  it('dimensions a point to the X axis on the second pick', async () => {
    const t = await setup({ tool: 'dimension' });
    draw(t, { p: { type: 'point', x: 3, y: 4 } });
    t.host.click(at(3, 4.1));
    t.host.click(at(10, 0.1)); // the X axis: no placement click
    const { projection } = project(t, { axis: { type: 'line', a: [-50, 0], b: [50, 0] } });
    expect(Object.values(t.data().dimensions)).toEqual([
      expect.objectContaining({
        type: 'distance',
        a: 'p',
        b: projection?.curves.axis,
        expr: '4',
      }),
    ]);
    expect(t.host.state.getState().editing).toBeDefined();
  });

  it('waits for a placement click for a point and the origin', async () => {
    const t = await setup({ tool: 'dimension' });
    draw(t, { p: { type: 'point', x: 3, y: 4 } });
    t.host.click(at(3, 4.1));
    t.host.click(at(0.1, 0.1));
    expect(t.host.state.getState().editing).toBeUndefined();
    expect(t.data().projections ?? {}).toEqual({});
  });

  it('dimensions a point to the origin, vertically', async () => {
    const t = await setup({ tool: 'dimension' });
    draw(t, { p: { type: 'point', x: 3, y: 4 } });
    t.host.click(at(3, 4.1));
    t.host.click(at(0.1, 0.1)); // the origin
    t.host.click(at(-3.5, 2)); // left of both: the vertical distance
    const { projection } = project(t, origin);
    expect(projection?.ref).toEqual({ kind: 'point', id: 'origin:point' });
    expect(Object.values(t.data().dimensions)).toEqual([
      expect.objectContaining({
        type: 'distance',
        orientation: 'vertical',
        a: 'p',
        b: projection?.curves.point,
        expr: '4',
      }),
    ]);
  });

  it('makes a point coincident with the origin, with auto-project off too', async () => {
    const t = await setup({ tool: 'coincident' });
    t.viewport.getState().setAutoProject(false);
    draw(t, { p: { type: 'point', x: 3, y: 4 } });
    t.host.click(at(3, 4.1));
    t.host.click({ ...at(0.1, 0.1), frame: XY });
    const { projection } = project(t, origin);
    expect(Object.values(t.data().constraints)).toEqual([
      { type: 'coincident', a: 'p', b: projection?.curves.point },
    ]);
    expect(t.point('p' as SketchEntityId).map((v) => Math.round(v * 1e6) / 1e6 + 0)).toEqual([
      0, 0,
    ]);
  });

  it('puts a point on the X axis and a line parallel to the Y axis', async () => {
    // Coincident between a point and a curve is a point on the curve.
    const t = await setup({ tool: 'coincident' });
    draw(t, { p: { type: 'point', x: 3, y: 4 } });
    t.host.click(at(3, 4.1));
    t.host.click(at(10, 0.1)); // the X axis
    const { projection } = project(t, { axis: { type: 'line', a: [-50, 0], b: [50, 0] } });
    expect(projection?.ref).toEqual({ kind: 'axis', id: 'origin:x' });
    expect(Object.values(t.data().constraints)).toEqual([
      { type: 'pointOnCurve', point: 'p', curve: projection?.curves.axis },
    ]);
    expect(t.point('p' as SketchEntityId)[1]).toBeCloseTo(0, 6);

    const u = await setup({ tool: 'parallel' });
    draw(u, {
      a0: { type: 'point', x: 20, y: -10 },
      a1: { type: 'point', x: 22, y: 10 },
      a: { type: 'line', start: 'a0', end: 'a1', construction: false },
    });
    u.host.click(at(21, 0.2));
    u.host.click(at(0.1, 5));
    const y = project(u, yAxis).projection?.curves.axis;
    expect(Object.values(u.data().constraints)).toEqual([{ type: 'parallel', a: 'a', b: y }]);
  });

  it('leaves an axis across a picked line for the label; picked first, it makes an angle', async () => {
    const t = await setup({ tool: 'dimension' });
    // A horizontal line centred on the Y axis: its label goes on the axis.
    draw(t, {
      h0: { type: 'point', x: -20, y: 5 },
      h1: { type: 'point', x: 20, y: 5 },
      h: { type: 'line', start: 'h0', end: 'h1', construction: false },
    });
    t.host.click(at(5, 5.1));
    t.host.click(at(0.1, 12));
    expect(Object.values(t.data().dimensions)).toEqual([
      expect.objectContaining({ type: 'distance', a: 'h', expr: '40' }),
    ]);
    expect(t.data().projections ?? {}).toEqual({});
    t.store.getState().undo();
    // Once the axis is projected its line is left for the label too.
    t.store
      .getState()
      .dispatch(
        addProjection({ feature: t.id, id: 'py' as ProjectionId, ref: originAxisRef('origin:y') }),
      );
    project(t, yAxis);
    const axis = t.data().projections?.['py' as ProjectionId]?.curves.axis;
    t.host.click(at(-5, 5.1));
    t.host.click(at(0.1, -12));
    expect(Object.values(t.data().dimensions)).toEqual([
      expect.objectContaining({ type: 'distance', a: 'h', expr: '40' }),
    ]);
    t.store.getState().undo();
    expect(t.data().dimensions).toEqual({});
    // The axis first, then the line: their angle.
    t.host.click(at(0.1, 30));
    t.host.click(at(5, 5.1));
    t.host.click(at(6, 12));
    expect(Object.values(t.data().dimensions)).toEqual([
      expect.objectContaining({ type: 'angle', a: axis, b: 'h', expr: '90' }),
    ]);
  });

  it('skips a datum hidden in the browser', async () => {
    const t = await setup({ tool: 'dimension' });
    t.viewport.getState().setOrigin('y', false);
    drawLine(t);
    t.host.click(at(20.1, 0));
    t.host.click(at(0.1, 5)); // on the hidden Y axis: places the length
    expect(Object.values(t.data().dimensions)).toEqual([
      expect.objectContaining({ type: 'distance', a: 'a', expr: '20' }),
    ]);
    expect(t.data().dimensions).not.toHaveProperty('b');
    expect(t.data().projections ?? {}).toEqual({});
  });

  it('prefers a body vertex on an axis to the axis', async () => {
    const t = await setup({ tool: 'dimension' });
    draw(t, { p: { type: 'point', x: 3, y: 4 } });
    const vertex: ModelSnap = {
      ref: { kind: 'vertex', id: 'v' },
      point: [10, 0],
      kind: 'vertex',
      straight: true,
    };
    t.host.click(at(3, 4.1));
    t.host.click({ ...at(10, 0.1), model: vertex });
    t.host.click(at(6, 6));
    expect(Object.values(t.data().projections ?? {}).map((p) => p.ref)).toEqual([vertex.ref]);
  });
});

describe('construction datums through the host (ADR-0093 slice 2)', () => {
  const XY = {
    origin: [0, 0, 0] as [number, number, number],
    normal: [0, 0, 1] as [number, number, number],
    x: [1, 0, 0] as [number, number, number],
    y: [0, 1, 0] as [number, number, number],
  };
  type T = Awaited<ReturnType<typeof setup>>;
  const draw = (t: T, entities: Record<string, unknown>) =>
    t.store.getState().dispatch(addToSketch({ feature: t.id, entities: entities as never }));
  /** A horizontal line at y = 5. */
  const drawLine = (t: T) =>
    draw(t, {
      h0: { type: 'point', x: -20, y: 5 },
      h1: { type: 'point', x: 20, y: 5 },
      h: { type: 'line', start: 'h0', end: 'h1', construction: false },
    });
  /** The only projection, and the kernel's report of it on the next recompute. */
  const project = (t: T, curves: Record<string, unknown>) => {
    const [pid] = Object.keys(t.data().projections ?? {}) as ProjectionId[];
    if (!pid) throw new Error('no projection');
    t.host.syncProjections({
      [t.id]: { frame: XY, projections: { [pid]: { curves } as never } },
    });
    return { pid, projection: t.data().projections?.[pid] };
  };

  it('dimensions a line to a parallel construction axis, projected as construction', async () => {
    const t = await setup({
      tool: 'dimension',
      constructionDatums: () => [
        { ref: { kind: 'axis', id: 'cx' }, kind: 'axis', origin: [0, 10, 0], direction: [1, 0, 0] },
      ],
    });
    drawLine(t);
    t.host.click(at(5, 5.1)); // the line
    t.host.click(at(5, 10.1)); // the construction axis at y = 10
    t.host.click(at(5, 8)); // the label between them
    expect(t.data().dimensions).toEqual({});
    const { projection } = project(t, {
      axis: { type: 'line', a: [-50, 10], b: [50, 10] },
    });
    expect(projection?.ref).toEqual({ kind: 'axis', id: 'cx' });
    const axis = projection?.curves.axis as SketchEntityId;
    expect(t.data().entities[axis]).toMatchObject({ type: 'line', construction: true });
    expect(Object.values(t.data().dimensions)).toEqual([
      expect.objectContaining({ type: 'distance', a: 'h', b: axis, expr: '5' }),
    ]);
  });

  it('makes a point coincident with a construction point', async () => {
    const t = await setup({
      tool: 'coincident',
      constructionDatums: () => [
        { ref: { kind: 'point', id: 'cp' }, kind: 'point', point: [5, 3, 0] },
      ],
    });
    draw(t, { p: { type: 'point', x: 0, y: 0 } });
    t.host.click(at(0, 0.1)); // the sketch point
    t.host.click(at(5.1, 3)); // the construction point
    const { projection } = project(t, { point: { type: 'point', at: [5, 3] } });
    expect(projection?.ref).toEqual({ kind: 'point', id: 'cp' });
    expect(Object.values(t.data().constraints)).toEqual([
      { type: 'coincident', a: 'p', b: projection?.curves.point },
    ]);
  });

  it('a projected construction axis line gives way to a datum point', async () => {
    const t = await setup({
      tool: 'coincident',
      constructionDatums: () => [
        { ref: { kind: 'axis', id: 'cx' }, kind: 'axis', origin: [0, 0, 0], direction: [1, 0, 0] },
      ],
    });
    // The construction axis, projected first: its line runs through the origin.
    t.store.getState().dispatch(
      addProjection({
        feature: t.id,
        id: 'pcx' as ProjectionId,
        ref: { kind: 'axis', id: 'cx' },
      }),
    );
    t.host.syncProjections({
      [t.id]: {
        frame: XY,
        projections: {
          pcx: { curves: { axis: { type: 'line', a: [-50, 0], b: [50, 0] } } },
        } as never,
      },
    });
    draw(t, { p: { type: 'point', x: 3, y: 4 } });
    t.host.click(at(3, 4.1)); // the sketch point
    t.host.click(at(0.1, 0.1)); // on the projected axis line, but the origin point is there
    const projections = t.data().projections ?? {};
    const opid = (Object.keys(projections) as ProjectionId[]).find(
      (id) => projections[id]?.ref.id === 'origin:point',
    );
    expect(opid).toBeDefined();
    if (!opid) throw new Error('no origin projection');
    // The origin point lands, not the construction axis's line.
    t.host.syncProjections({
      [t.id]: {
        frame: XY,
        projections: {
          [opid]: { curves: { point: { type: 'point', at: [0, 0] } } } as never,
        },
      },
    });
    expect(Object.values(t.data().constraints)).toEqual([
      {
        type: 'coincident',
        a: 'p',
        b: t.data().projections?.[opid]?.curves.point,
      },
    ]);
  });
});

describe('constraint tools refuse a datum axis line (ADR-0093)', () => {
  const XY = {
    origin: [0, 0, 0] as [number, number, number],
    normal: [0, 0, 1] as [number, number, number],
    x: [1, 0, 0] as [number, number, number],
    y: [0, 1, 0] as [number, number, number],
  };
  type T = Awaited<ReturnType<typeof setup>>;
  const draw = (t: T, entities: Record<string, unknown>) =>
    t.store.getState().dispatch(addToSketch({ feature: t.id, entities: entities as never }));
  /** A vertical line at x = 20 from y = -10 to 10. */
  const drawLine = (t: T) =>
    draw(t, {
      a0: { type: 'point', x: 20, y: -10 },
      a1: { type: 'point', x: 20, y: 10 },
      a: { type: 'line', start: 'a0', end: 'a1', construction: false },
    });
  /** The only projection, and the kernel's report of it on the next recompute. */
  const project = (t: T, curves: Record<string, unknown>) => {
    const [pid] = Object.keys(t.data().projections ?? {}) as ProjectionId[];
    if (!pid) throw new Error('no projection');
    t.host.syncProjections({ [t.id]: { frame: XY, projections: { [pid]: { curves } } as never } });
    return { pid, projection: t.data().projections?.[pid] };
  };
  const yAxis = { axis: { type: 'line', a: [0, -50], b: [0, 50] } };
  const xAxis = { axis: { type: 'line', a: [-50, 0], b: [50, 0] } };
  const origin = { point: { type: 'point', at: [0, 0] } };
  const HINT = 'An axis has no length or middle; pick a sketch line.';

  it('Equal refuses the Y axis as the second pick', async () => {
    const t = await setup({ tool: 'equal' });
    drawLine(t);
    t.host.click(at(20.1, 0)); // the line
    t.host.click(at(0.1, 5)); // the Y axis
    expect(t.host.state.getState().error).toBe(HINT);
    expect(t.data().constraints).toEqual({});
    expect(t.data().projections ?? {}).toEqual({});
    expect(t.host.state.getState().tool?.preview().picked).toEqual(['a']);
  });

  it('Midpoint refuses the X axis as the line', async () => {
    const t = await setup({ tool: 'midpoint' });
    draw(t, { p: { type: 'point', x: 3, y: 4 } });
    t.host.click(at(3, 4.1)); // the point
    t.host.click(at(5, 0.1)); // the X axis, away from the origin
    expect(t.host.state.getState().error).toBe(HINT);
    expect(t.data().constraints).toEqual({});
    expect(t.data().projections ?? {}).toEqual({});
    expect(t.host.state.getState().tool?.preview().picked).toEqual(['p']);
  });

  it('Horizontal refuses the X axis as the first pick', async () => {
    const t = await setup({ tool: 'horizontal' });
    t.host.click(at(5, 0.1)); // the X axis
    expect(t.host.state.getState().error).toBe(HINT);
    expect(t.data().constraints).toEqual({});
    expect(t.data().projections ?? {}).toEqual({});
    expect(t.host.state.getState().tool?.preview().picked ?? []).toEqual([]);
  });

  it('Vertical refuses an already projected Y axis', async () => {
    const t = await setup({ tool: 'dimension' });
    drawLine(t);
    t.host.click(at(20.1, 0)); // the line
    t.host.click(at(0.1, 5)); // the Y axis: the dimension commits
    const { projection } = project(t, yAxis);
    const axis = projection?.curves.axis as SketchEntityId;
    expect(t.data().entities[axis]).toMatchObject({ type: 'line', construction: true });
    t.host.start('vertical');
    t.host.click(at(0.1, -30)); // on the projected axis line, away from the origin
    expect(t.host.state.getState().error).toBe(HINT);
    expect(t.data().constraints).toEqual({});
    expect(Object.values(t.data().dimensions)).toHaveLength(1);
    expect(Object.keys(t.data().projections ?? {})).toHaveLength(1);
  });

  it('Collinear puts a line on the Y axis', async () => {
    const t = await setup({ tool: 'collinear' });
    drawLine(t);
    t.host.click(at(20.1, 0)); // the line
    t.host.click(at(0.1, 5)); // the Y axis
    const { projection } = project(t, yAxis);
    const axis = projection?.curves.axis as SketchEntityId;
    expect(Object.values(t.data().constraints)).toEqual([{ type: 'collinear', a: 'a', b: axis }]);
    expect(t.point('a0' as SketchEntityId)[0]).toBeCloseTo(0, 6);
    expect(t.point('a1' as SketchEntityId)[0]).toBeCloseTo(0, 6);
    expect(t.point('a0' as SketchEntityId)[1]).toBeCloseTo(-10, 6);
    expect(t.point('a1' as SketchEntityId)[1]).toBeCloseTo(10, 6);
  });

  it('a stored axis shows the fresh-axis marker, not its segment, while hovered (ADR-0093 slice 7)', async () => {
    const t = await setup({ tool: 'parallel' });
    drawLine(t);
    t.host.click(at(20.1, 0));
    t.host.click(at(0.1, 5)); // projects the Y axis
    project(t, yAxis);
    draw(t, {
      b0: { type: 'point', x: 30, y: -10 },
      b1: { type: 'point', x: 30, y: 10 },
      b: { type: 'line', start: 'b0', end: 'b1', construction: false },
    });
    t.host.click(at(30.1, 0));
    t.host.move(at(0.2, 7)); // the stored axis
    const preview = t.host.state.getState().tool?.preview();
    expect(preview?.modelHover?.kind).toBe('axis');
    expect(preview?.modelHover?.point[0]).toBeCloseTo(0, 6);
    expect(preview?.modelHover?.point[1]).toBeCloseTo(7, 6);
  });

  it('Perpendicular makes a slanted line vertical to the X axis', async () => {
    const t = await setup({ tool: 'perpendicular' });
    draw(t, {
      b0: { type: 'point', x: 5, y: -10 },
      b1: { type: 'point', x: 15, y: 10 },
      b: { type: 'line', start: 'b0', end: 'b1', construction: false },
    });
    t.host.click(at(10.1, 0.2)); // the line
    t.host.click(at(5, 0.1)); // the X axis
    const { projection } = project(t, xAxis);
    const axis = projection?.curves.axis as SketchEntityId;
    expect(Object.values(t.data().constraints)).toEqual([
      { type: 'perpendicular', a: 'b', b: axis },
    ]);
    const start = t.point('b0' as SketchEntityId);
    const end = t.point('b1' as SketchEntityId);
    expect(Math.abs(start[0] - end[0])).toBeCloseTo(0, 6);
  });

  it('Symmetric mirrors two points about the Y axis', async () => {
    const t = await setup({ tool: 'symmetric' });
    draw(t, { p: { type: 'point', x: 3, y: 4 }, q: { type: 'point', x: 8, y: 9 } });
    t.host.click(at(3, 4.1)); // p
    t.host.click(at(8, 9.1)); // q
    t.host.click(at(0.1, 5)); // the Y axis
    const { projection } = project(t, yAxis);
    const axis = projection?.curves.axis as SketchEntityId;
    expect(Object.values(t.data().constraints)).toEqual([
      { type: 'symmetric', a: 'p', b: 'q', axis },
    ]);
    const p = t.point('p' as SketchEntityId);
    const q = t.point('q' as SketchEntityId);
    expect(p[0] + q[0]).toBeCloseTo(0, 6);
    expect(p[1] - q[1]).toBeCloseTo(0, 6);
  });

  it('Tangent makes a circle touch the X axis', async () => {
    const t = await setup({ tool: 'tangent' });
    draw(t, { c0: { type: 'point', x: 5, y: 8 }, c: { type: 'circle', center: 'c0', radius: 3 } });
    t.host.click(at(5, 11.1)); // the circle's rim
    t.host.click(at(5, 0.1)); // the X axis
    const { projection } = project(t, xAxis);
    const axis = projection?.curves.axis as SketchEntityId;
    expect(Object.values(t.data().constraints)).toEqual([{ type: 'tangent', a: 'c', b: axis }]);
    // The radius is free, so the solve shares the move: the circle touches the axis.
    const circle = t.data().entities['c' as SketchEntityId];
    if (circle?.type !== 'circle') throw new Error('no circle');
    expect(Math.abs(t.point('c0' as SketchEntityId)[1])).toBeCloseTo(circle.radius, 6);
  });

  it('Midpoint puts the middle of a line on the origin point', async () => {
    const t = await setup({ tool: 'midpoint' });
    drawLine(t);
    t.host.click(at(0.1, 0.1)); // the origin point
    t.host.click(at(20.1, 0)); // the line
    const { projection } = project(t, origin);
    const pt = projection?.curves.point as SketchEntityId;
    expect(Object.values(t.data().constraints)).toEqual([{ type: 'midpoint', point: pt, of: 'a' }]);
    expect(t.point('a0' as SketchEntityId)[0]).toBeCloseTo(0, 6);
    expect(t.point('a1' as SketchEntityId)[0]).toBeCloseTo(0, 6);
    expect(t.point('a0' as SketchEntityId)[1]).toBeCloseTo(-10, 6);
    expect(t.point('a1' as SketchEntityId)[1]).toBeCloseTo(10, 6);
  });

  it('Horizontal lines a sketch point up with the origin', async () => {
    const t = await setup({ tool: 'horizontal' });
    draw(t, { p: { type: 'point', x: 3, y: 4 } });
    t.host.click(at(3, 4.1)); // the point
    t.host.click(at(0.1, 0.1)); // the origin point
    const { projection } = project(t, origin);
    const pt = projection?.curves.point as SketchEntityId;
    expect(Object.values(t.data().constraints)).toEqual([{ type: 'horizontal', a: 'p', b: pt }]);
    expect(t.point('p' as SketchEntityId)[1]).toBeCloseTo(0, 6);
    expect(t.point('p' as SketchEntityId)[0]).toBeCloseTo(3, 6);
  });
});
