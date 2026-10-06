// The tool host keeps projected geometry in line with the kernel (P2-09):
// `syncProjections` adds and moves projected curves, solves the sketch so
// geometry constrained to them follows, and joins the latest undo step.
import {
  addProjection,
  addToSketch,
  ORIGIN_PLANES,
  type ProjectionId,
  projectedEntities,
  type SketchEntityId,
  type SketchFrame,
  type SketchReport,
} from '@extrudo/core';
import { afterEach, describe, expect, it } from 'vitest';
import { disposeHosts, setup } from './testing';

afterEach(disposeHosts);

const P = 'pr' as ProjectionId;
const frame = ORIGIN_PLANES[0]?.frame as SketchFrame;
const line = (x: number): SketchReport => ({
  frame,
  projections: { [P]: { curves: { edge: { type: 'line', a: [0, 0], b: [x, 0] } } } },
});

describe('syncProjections', () => {
  it('adds the reported curves in the Project step, and constrained geometry follows them', async () => {
    const t = await setup();
    const { store, host, id } = t;
    store
      .getState()
      .dispatch(addProjection({ feature: id, id: P, ref: { kind: 'edge', id: 'e[a|b]' } }));
    host.syncProjections({ [id]: line(50) });
    const edge = t.data().projections?.[P]?.curves.edge as SketchEntityId;
    const e = t.data().entities[edge];
    if (e?.type !== 'line') throw new Error('no projected line');
    expect(t.point(e.end)).toEqual([50, 0]);
    expect(store.getState().undoLabel).toBe('Project');

    // A line of our own from the projected end, kept horizontal.
    store.getState().dispatch(
      addToSketch({
        feature: id,
        entities: {
          ['a' as SketchEntityId]: { type: 'point', x: 50, y: 0 },
          ['b' as SketchEntityId]: { type: 'point', x: 70, y: 0 },
          ['mine' as SketchEntityId]: {
            type: 'line',
            start: 'a' as SketchEntityId,
            end: 'b' as SketchEntityId,
            construction: false,
          },
        },
        constraints: {
          ['k1' as never]: { type: 'coincident', a: 'a' as SketchEntityId, b: e.end },
          ['k2' as never]: { type: 'horizontal', a: 'mine' as SketchEntityId },
        },
      }),
    );
    // The model changed: the edge is longer now. The same IDs move, ours follows.
    host.syncProjections({ [id]: line(60) });
    expect(t.data().projections?.[P]?.curves.edge).toBe(edge);
    expect(t.point(e.end)).toEqual([60, 0]);
    expect(t.point('a' as SketchEntityId)[0]).toBeCloseTo(60, 6);
    expect(store.getState().undoLabel).toBe('Draw');
    // Nothing left to do.
    const doc = store.getState().doc;
    host.syncProjections({ [id]: line(60) });
    expect(store.getState().doc).toBe(doc);

    // One undo takes back our line and what followed it; the next, the projection.
    store.getState().undo();
    expect(t.point(e.end)).toEqual([50, 0]);
    store.getState().undo();
    expect(t.data().projections).toBeUndefined();
    expect(t.data().entities[edge]).toBeUndefined();
  });

  it('holds projected geometry still while its constraints move the rest', async () => {
    const t = await setup();
    const { store, host, id } = t;
    store
      .getState()
      .dispatch(addProjection({ feature: id, id: P, ref: { kind: 'edge', id: 'e[a|b]' } }));
    host.syncProjections({ [id]: line(50) });
    expect(t.report().ok).toBe(true);
    const status = host.state.getState().status;
    const edge = t.data().projections?.[P]?.curves.edge as SketchEntityId;
    expect(status?.entities[edge]).toBe('fixed');
  });

  it('keeps geometry held at a distance on its side when the edge moves far (P3-13)', async () => {
    const t = await setup();
    const { store, host, id } = t;
    const edgeAt = (y: number): SketchReport => ({
      frame,
      projections: { [P]: { curves: { edge: { type: 'line', a: [0, y], b: [50, y] } } } },
    });
    store
      .getState()
      .dispatch(addProjection({ feature: id, id: P, ref: { kind: 'edge', id: 'e[a|b]' } }));
    host.syncProjections({ [id]: edgeAt(0) });
    const edge = t.data().projections?.[P]?.curves.edge as SketchEntityId;
    // A wall's inside: our horizontal line 3 mm above the projected edge.
    store.getState().dispatch(
      addToSketch({
        feature: id,
        entities: {
          ['a' as SketchEntityId]: { type: 'point', x: 5, y: 3 },
          ['b' as SketchEntityId]: { type: 'point', x: 45, y: 3 },
          ['mine' as SketchEntityId]: {
            type: 'line',
            start: 'a' as SketchEntityId,
            end: 'b' as SketchEntityId,
            construction: false,
          },
        },
        constraints: { ['k1' as never]: { type: 'horizontal', a: 'mine' as SketchEntityId } },
        dimensions: {
          ['w' as never]: {
            type: 'distance',
            orientation: 'aligned',
            a: 'mine' as SketchEntityId,
            b: edge,
            expr: '3 mm',
            paramName: 'd1',
            driven: false,
            label: { x: 0, y: 0 },
          },
        },
      }),
    );
    // The edge moves 30 mm up, ten times the distance: the line stays above it.
    host.syncProjections({ [id]: edgeAt(30) });
    expect(t.point('a' as SketchEntityId)[1]).toBeCloseTo(33, 6);
    host.syncProjections({ [id]: edgeAt(-40) });
    expect(t.point('b' as SketchEntityId)[1]).toBeCloseTo(-37, 6);
  });

  it('includes curves without a link in one step named for them (P4-12)', async () => {
    const t = await setup();
    const { store, host, id } = t;
    store
      .getState()
      .dispatch(
        addProjection({ feature: id, id: P, ref: { kind: 'face', id: 'f' }, linked: false }),
      );
    host.syncProjections({
      [id]: {
        frame,
        projections: {
          [P]: {
            curves: {
              a: { type: 'line', a: [0, 0], b: [40, 0] },
              b: { type: 'line', a: [40, 0], b: [40, 20] },
            },
          },
        },
      },
    });
    expect(t.data().projections).toBeUndefined();
    const lines = Object.values(t.data().entities).filter((e) => e.type === 'line');
    expect(lines).toHaveLength(2);
    expect(store.getState().undoLabel).toBe('Include 2 curves');
    // Nothing holds them: the solver can move them.
    expect(projectedEntities(t.data()).size).toBe(0);
    store.getState().undo();
    expect(Object.keys(t.data().entities)).toEqual([]);
  });
});
