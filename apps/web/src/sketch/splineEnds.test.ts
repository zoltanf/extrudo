import {
  addToSketch,
  fitSpline,
  type SketchEntityId,
  splineTangentAt,
  type Vec2,
} from '@extrudo/core';
import { afterEach, describe, expect, it } from 'vitest';
import { tangentAt, tangentGrips } from './splineEnds';
import { at, disposeHosts, setup } from './tools/testing';

afterEach(disposeHosts);

const e = (id: string) => id as SketchEntityId;
const fit: Vec2[] = [
  [0, 0],
  [10, 8],
  [20, 0],
];

/** No tool running; a fit spline s through `fit` and a control spline c. */
async function withSpline() {
  const t = await setup();
  t.host.stop();
  t.store.getState().dispatch(
    addToSketch({
      feature: t.id,
      entities: {
        [e('p0')]: { type: 'point', x: 0, y: 0 },
        [e('p1')]: { type: 'point', x: 10, y: 8 },
        [e('p2')]: { type: 'point', x: 20, y: 0 },
        [e('s')]: { type: 'spline', points: [e('p0'), e('p1'), e('p2')], construction: false },
        [e('c0')]: { type: 'point', x: 0, y: 30 },
        [e('c1')]: { type: 'point', x: 10, y: 40 },
        [e('c2')]: { type: 'point', x: 20, y: 30 },
        [e('c')]: {
          type: 'spline',
          points: [e('c0'), e('c1'), e('c2')],
          mode: 'control',
          construction: false,
        },
      },
    }),
  );
  const spline = () => {
    const s = t.data().entities[e('s')];
    if (s?.type !== 'spline') throw new Error('no spline');
    return s;
  };
  return { ...t, spline };
}

describe('tangent grips (ADR-0063, third amendment)', () => {
  it('sit a third of the end derivative from each end, on the curve side', async () => {
    const t = await withSpline();
    const curve = fitSpline(fit);
    const [start, end] = tangentGrips(t.data(), e('s'));
    const d0 = splineTangentAt(curve, 0);
    const d1 = splineTangentAt(curve, 1);
    expect(start?.at[0]).toBeCloseTo(d0[0] / 3, 12);
    expect(start?.at[1]).toBeCloseTo(d0[1] / 3, 12);
    expect(end?.at[0]).toBeCloseTo(20 - d1[0] / 3, 12);
    expect(end?.at[1]).toBeCloseTo(-d1[1] / 3, 12);
    // The grip's own place stands for the derivative it was drawn from.
    const back = tangentAt(end as never, (end as { at: Vec2 }).at);
    expect(back[0]).toBeCloseTo(d1[0], 12);
    expect(back[1]).toBeCloseTo(d1[1], 12);
    // Control splines and closed ones have none.
    expect(tangentGrips(t.data(), e('c'))).toEqual([]);
  });

  it('drags a grip of the selected spline into one undo step, Esc puts it back', async () => {
    const t = await withSpline();
    t.host.click(at(5, 5.6));
    expect(t.session.getState().selection).toEqual([{ kind: 'sketchEntity', id: 's' }]);
    const end = tangentGrips(t.data(), e('s'))[1] as { at: Vec2 };
    const [gx, gy] = end.at;
    // A press without a move changes nothing and keeps the selection.
    expect(t.host.dragStart(at(gx, gy))).toBe(true);
    t.host.dragEnd(at(gx, gy));
    expect(t.spline()).not.toHaveProperty('tangents');
    t.host.click(at(gx, gy));
    expect(t.session.getState().selection).toEqual([{ kind: 'sketchEntity', id: 's' }]);

    // Esc during the drag puts it back.
    t.host.dragStart(at(gx, gy));
    t.host.move(at(gx, gy + 3));
    expect(t.spline().tangents?.end).toBeDefined();
    expect(t.host.cancelMove()).toBe(true);
    expect(t.spline()).not.toHaveProperty('tangents');

    // A drag sets the end's tangent to three times the grip's offset, turned.
    t.host.dragStart(at(gx, gy));
    t.host.move(at(gx, gy + 2));
    t.host.dragEnd(at(gx, gy + 3));
    expect(t.host.state.getState().moving).toBe(false);
    const tangent = t.spline().tangents?.end as Vec2;
    expect(tangent[0]).toBeCloseTo(-3 * (gx - 20), 9);
    expect(tangent[1]).toBeCloseTo(-3 * (gy + 3), 9);
    expect(t.store.getState().undoLabel).toBe('Spline tangent');
    t.store.getState().undo();
    expect(t.spline()).not.toHaveProperty('tangents');
  });
});
