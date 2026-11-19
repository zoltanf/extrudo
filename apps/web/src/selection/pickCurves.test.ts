import {
  entityPolylines,
  type FeatureId,
  originPlaneRef,
  planeFrame,
  type SketchData,
  type SketchEntityId,
  type SketchFrame,
} from '@extrudo/core';
import { pickEntity, polylineDistance } from '@extrudo/sketch/inference';
import { describe, expect, it } from 'vitest';
import { flatPolylineDistance, SketchCurves } from '../sketch/curveLines';
import { DEFAULT_FILTER } from './filter';
import { nearestEntity, type PickScene, pickBox, pickStack } from './pick';
import { cameraFrom, topViewPx } from './testing';

/** A seeded random number in [0, 1). */
function random(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** Lines, circles, arcs and control splines scattered over 100 mm, some construction. */
function scattered(seed: number, curves = 60): SketchData {
  const r = random(seed);
  const entities: Record<string, unknown> = {};
  let n = 0;
  const point = (x: number, y: number) => {
    const id = `p${n++}`;
    entities[id] = { type: 'point', x, y };
    return id;
  };
  for (let i = 0; i < curves; i++) {
    const x = r() * 100;
    const y = r() * 100;
    const construction = r() < 0.2;
    const kind = i % 4;
    if (kind === 0) {
      entities[`c${i}`] = {
        type: 'line',
        start: point(x, y),
        end: point(x + r() * 30 - 15, y + r() * 30 - 15),
        construction,
      };
    } else if (kind === 1) {
      entities[`c${i}`] = {
        type: 'circle',
        center: point(x, y),
        radius: 1 + r() * 10,
        construction,
      };
    } else if (kind === 2) {
      const radius = 2 + r() * 8;
      const a = r() * 6;
      const b = a + 0.5 + r() * 4;
      entities[`c${i}`] = {
        type: 'arc',
        center: point(x, y),
        start: point(x + radius * Math.cos(a), y + radius * Math.sin(a)),
        end: point(x + radius * Math.cos(b), y + radius * Math.sin(b)),
        construction,
      };
    } else {
      const poles = Array.from({ length: 6 }, (_, k) => point(x + k * 4, y + r() * 10 - 5));
      entities[`c${i}`] = { type: 'spline', points: poles, mode: 'control', construction };
    }
  }
  // Frozen all the way through, as the document store's data is.
  return deepFreeze({ entities, constraints: {}, dimensions: {} }) as unknown as SketchData;
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const inner of Object.values(value)) deepFreeze(inner);
    Object.freeze(value);
  }
  return value;
}

describe('picking on cached polylines (ADR-0156)', () => {
  it('flatPolylineDistance gives polylineDistance to the last bit', () => {
    const r = random(7);
    for (let k = 0; k < 200; k++) {
      const line = Array.from(
        { length: 2 + (k % 9) },
        () => [r() * 50, r() * 50] as [number, number],
      );
      const flat = Float64Array.from(line.flat());
      const x = r() * 60 - 5;
      const y = r() * 60 - 5;
      expect(flatPolylineDistance(flat, x, y)).toBe(polylineDistance(line, [x, y]));
    }
  });

  it('picks the entity pickEntity picks, at every cursor and reach', () => {
    const curves = new SketchCurves();
    let compared = 0;
    for (const seed of [1, 2]) {
      const data = scattered(seed);
      const r = random(100 + seed);
      for (let k = 0; k < 700; k++) {
        const cursor: [number, number] = [r() * 110 - 5, r() * 110 - 5];
        const reach = [0.05, 0.5, 2, 8][k % 4] as number;
        const accept = (e: { type: string; construction?: boolean }) =>
          e.type === 'point' ? k % 3 === 0 : k % 2 === 0 || !e.construction;
        const want = pickEntity(data, cursor, reach, accept);
        expect(nearestEntity(data, cursor, reach, accept, curves.lines)).toBe(want);
        if (want) compared++;
      }
    }
    // Enough cursors landed on something for the comparison to mean anything.
    expect(compared).toBeGreaterThan(150);
  });

  it('samples each curve of frozen data once, however many picks', () => {
    const data = scattered(4);
    const curves = new SketchCurves();
    const curveCount = Object.values(data.entities).filter((e) => e.type !== 'point').length;
    for (let k = 0; k < 50; k++) nearestEntity(data, [k * 2, k * 2], 1, () => true, curves.lines);
    expect(curves.sampled).toBe(curveCount);
  });

  it('samples data that is not frozen on every pick, and keeps nothing of it', () => {
    const data = scattered(5);
    const open = { ...data, entities: { ...data.entities } } as SketchData;
    const curves = new SketchCurves();
    nearestEntity(open, [5, 5], 1, () => true, curves.lines);
    const once = curves.sampled;
    nearestEntity(open, [5, 5], 1, () => true, curves.lines);
    expect(curves.sampled).toBe(2 * once);
    expect(curves.size).toBe(0);
  });

  it('gives the same lines as entityPolylines', () => {
    const data = scattered(6);
    const curves = new SketchCurves();
    for (const [id, e] of Object.entries(data.entities)) {
      const want = entityPolylines(data, e, id as SketchEntityId).map((l) => l.flat());
      const got = curves.lines(data, e, id as SketchEntityId).lines.map((l) => [...l]);
      expect(got).toEqual(want);
    }
  });

  it('lets go of the sketches a view no longer shows', () => {
    const a = scattered(8);
    const b = scattered(9);
    const curves = new SketchCurves();
    for (const data of [a, b]) {
      for (const [id, e] of Object.entries(data.entities)) curves.lines(data, e, id as never);
    }
    expect(curves.size).toBe(2);
    curves.retain([b]);
    expect(curves.size).toBe(1);
    const before = curves.sampled;
    for (const [id, e] of Object.entries(b.entities)) curves.lines(b, e, id as never);
    expect(curves.sampled).toBe(before);
  });

  it('picks, stacks and boxes the same with the cache and without', () => {
    const frame = planeFrame(originPlaneRef('origin:xy')) as SketchFrame;
    const sketches = [1, 2].map((seed) => ({
      id: `s${seed}` as FeatureId,
      frame,
      data: scattered(seed),
    }));
    const plain: PickScene = { bodies: [], sketches, occluding: true };
    const curves = new SketchCurves();
    const cached: PickScene = { ...plain, curves: curves.lines };
    const top = cameraFrom([0, 0, 1], { target: [50, 50, 0], size: 120 });
    const r = random(11);
    for (let k = 0; k < 300; k++) {
      const px = topViewPx(top, r() * 110 - 5, r() * 110 - 5);
      expect(pickStack(cached, top, px, DEFAULT_FILTER)).toEqual(
        pickStack(plain, top, px, DEFAULT_FILTER),
      );
    }
    for (let k = 0; k < 40; k++) {
      const from = topViewPx(top, r() * 100, r() * 100);
      const to = topViewPx(top, r() * 100, r() * 100);
      expect(pickBox(cached, top, from, to, DEFAULT_FILTER)).toEqual(
        pickBox(plain, top, from, to, DEFAULT_FILTER),
      );
    }
    // Each curve sampled once for all those picks.
    const count = sketches.reduce(
      (n, s) => n + Object.values(s.data.entities).filter((e) => e.type !== 'point').length,
      0,
    );
    expect(curves.sampled).toBe(count);
  });
});
