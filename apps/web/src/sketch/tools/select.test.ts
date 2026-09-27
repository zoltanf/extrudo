import {
  addToSketch,
  CommandError,
  type ConstraintId,
  type DimensionId,
  type SketchEntityId,
} from '@extrudo/core';
import { afterEach, describe, expect, it } from 'vitest';
import { at, disposeHosts, setup } from './testing';

afterEach(disposeHosts);

const e = (id: string) => id as SketchEntityId;

/**
 * No tool running (P1-09): a horizontal line a–b from (5,5) to (15,5), a
 * lone point q at (30,30), a circle c around (50,0) of radius 5, and a
 * fixed point f at (0,20).
 */
async function selecting() {
  const t = await setup();
  t.host.stop();
  t.store.getState().dispatch(
    addToSketch({
      feature: t.id,
      entities: {
        [e('a')]: { type: 'point', x: 5, y: 5 },
        [e('b')]: { type: 'point', x: 15, y: 5 },
        [e('l')]: { type: 'line', start: e('a'), end: e('b'), construction: false },
        [e('q')]: { type: 'point', x: 30, y: 30 },
        [e('o')]: { type: 'point', x: 50, y: 0 },
        [e('c')]: { type: 'circle', center: e('o'), radius: 5, construction: false },
        [e('f')]: { type: 'point', x: 0, y: 20 },
      },
      constraints: {
        ['h' as ConstraintId]: { type: 'horizontal', a: e('l') },
        ['fix' as ConstraintId]: { type: 'fix', entity: e('f') },
      },
    }),
  );
  const selection = () => t.session.getState().selection.map((s) => `${s.kind}:${s.id}`);
  return { ...t, selection };
}

describe('selecting in sketch mode', () => {
  it('pre-highlights the entity under the pointer, points first', async () => {
    const t = await selecting();
    t.host.move(at(10, 5.3));
    expect(t.session.getState().hover).toEqual({ kind: 'sketchEntity', id: 'l' });
    t.host.move(at(5.2, 5));
    expect(t.session.getState().hover).toEqual({ kind: 'sketchEntity', id: 'a' });
    t.host.move(at(10, 15));
    expect(t.session.getState().hover).toBeUndefined();
    t.host.move(at(55.2, 0));
    t.host.leave();
    expect(t.session.getState().hover).toBeUndefined();
  });

  it('selects on click, toggles with a modifier, and clears on empty space', async () => {
    const t = await selecting();
    t.host.click(at(10, 5));
    expect(t.selection()).toEqual(['sketchEntity:l']);
    t.host.click({ ...at(30, 30.2), toggle: true });
    expect(t.selection()).toEqual(['sketchEntity:l', 'sketchEntity:q']);
    t.host.click({ ...at(10, 5), toggle: true });
    expect(t.selection()).toEqual(['sketchEntity:q']);
    t.host.click({ ...at(10, 15), toggle: true });
    expect(t.selection()).toEqual(['sketchEntity:q']);
    t.host.click(at(10, 15));
    expect(t.selection()).toEqual([]);
  });

  it('box-selects: a window takes what is inside, a crossing box what it touches', async () => {
    const t = await selecting();
    const corners = (x0: number, y0: number, x1: number, y1: number): [number, number][] => [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
    ];
    t.host.box({ corners: corners(0, 0, 12, 40), mode: 'window', add: false });
    expect(t.selection().sort()).toEqual(['sketchEntity:a', 'sketchEntity:f']);
    t.host.box({ corners: corners(0, 0, 12, 40), mode: 'crossing', add: false });
    expect(t.selection().sort()).toEqual(['sketchEntity:a', 'sketchEntity:f', 'sketchEntity:l']);
    t.host.box({ corners: corners(25, 25, 35, 35), mode: 'window', add: true });
    expect(t.selection()).toContain('sketchEntity:q');
    expect(t.selection()).toHaveLength(4);
    t.host.box({ corners: corners(100, 100, 110, 110), mode: 'window', add: false });
    expect(t.selection()).toEqual([]);
  });
});

describe('dragging geometry', () => {
  it('moves a line by its middle, within its constraints, as one undo step', async () => {
    const t = await selecting();
    const undoBefore = t.store.getState().canUndo;
    expect(t.host.dragStart(at(10, 5))).toBe(true);
    expect(t.host.state.getState().moving).toBe(true);
    t.host.move(at(12, 9));
    t.host.dragEnd(at(13, 10));
    expect(t.host.state.getState().moving).toBe(false);
    expect(t.point(e('a'))[0]).toBeCloseTo(8, 6);
    expect(t.point(e('a'))[1]).toBeCloseTo(10, 6);
    expect(t.point(e('b'))[0]).toBeCloseTo(18, 6);
    expect(t.point(e('b'))[1]).toBeCloseTo(10, 6);
    expect(undoBefore).toBe(true);
    t.store.getState().undo();
    expect(t.point(e('a'))).toEqual([5, 5]);
    expect(t.point(e('b'))).toEqual([15, 5]);
  });

  it('moves the whole selection when a selected entity is dragged', async () => {
    const t = await selecting();
    t.host.click(at(10, 5));
    t.host.click({ ...at(30, 30), toggle: true });
    t.host.dragStart(at(30, 30));
    t.host.dragEnd(at(31, 28));
    expect(t.point(e('q'))[0]).toBeCloseTo(31, 6);
    expect(t.point(e('q'))[1]).toBeCloseTo(28, 6);
    expect(t.point(e('a'))[0]).toBeCloseTo(6, 6);
    expect(t.point(e('a'))[1]).toBeCloseTo(3, 6);
    // The circle wasn't selected.
    expect(t.point(e('o'))).toEqual([50, 0]);
  });

  it('leaves a drag over empty space to the box, and a fixed point where it is', async () => {
    const t = await selecting();
    expect(t.host.dragStart(at(20, 20))).toBe(false);
    expect(t.host.dragStart(at(0, 20))).toBe(true);
    expect(t.host.state.getState().moving).toBe(false);
    expect(t.point(e('f'))).toEqual([0, 20]);
  });

  it('puts the geometry back on Esc', async () => {
    const t = await selecting();
    t.host.dragStart(at(30, 30));
    t.host.move(at(40, 40));
    expect(t.point(e('q'))[0]).toBeCloseTo(40, 6);
    expect(t.host.cancelMove()).toBe(true);
    expect(t.point(e('q'))).toEqual([30, 30]);
    expect(t.host.cancelMove()).toBe(false);
  });
});

describe('the properties panel edits', () => {
  it('moves a point to typed coordinates, or as near as its constraints allow', async () => {
    const t = await selecting();
    expect(t.host.moveTo(e('q'), 12, -3)).toBe(true);
    expect(t.point(e('q'))[0]).toBeCloseTo(12, 6);
    expect(t.point(e('q'))[1]).toBeCloseTo(-3, 6);
    // b stays level with a: y follows, but a moves along with it.
    expect(t.host.moveTo(e('b'), 20, 8)).toBe(true);
    expect(t.point(e('a'))[1]).toBeCloseTo(8, 6);
    expect(t.host.moveTo(e('f'), 1, 1)).toBe(false);
    expect(t.point(e('f'))).toEqual([0, 20]);
  });

  it('sets a free radius, and refuses one a dimension sets', async () => {
    const t = await selecting();
    t.host.setRadius(e('c'), 8);
    expect((t.data().entities[e('c')] as { radius: number }).radius).toBeCloseTo(8, 6);
    t.store.getState().dispatch(
      addToSketch({
        feature: t.id,
        dimensions: {
          ['r' as DimensionId]: { type: 'radius', curve: e('c'), expr: '8', driven: false },
        },
      }),
    );
    expect(() => t.host.setRadius(e('c'), 3)).toThrow(CommandError);
    expect((t.data().entities[e('c')] as { radius: number }).radius).toBeCloseTo(8, 6);
  });
});
