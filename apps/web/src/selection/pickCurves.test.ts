import {
  entityPolylines,
  type FeatureId,
  originPlaneRef,
  planeFrame,
  type SketchData,
  type SketchEntityId,
  type SketchFrame,
  sketchToWorld,
} from '@extrudo/core';
import { pickEntity, polylineDistance } from '@extrudo/sketch/inference';
import { describe, expect, it } from 'vitest';
import { flatPolylineDistance, SketchCurves } from '../sketch/curveLines';
import { sketchSegments } from '../viewport/sketchGeometry';
import { DEFAULT_FILTER } from './filter';
import {
  nearestEntity,
  type PickScene,
  pickBox,
  pickStack,
  projectPoint,
  segmentMeetsRect,
} from './pick';

type Rect = Parameters<typeof segmentMeetsRect>[2];

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

  it('samples each kept curve of frozen data once, however many picks', () => {
    const data = scattered(4);
    const curves = new SketchCurves();
    const all = Object.values(data.entities);
    const lines = all.filter((e) => e.type === 'line').length;
    const kept = all.filter((e) => e.type !== 'point' && e.type !== 'line').length;
    for (let k = 0; k < 50; k++) nearestEntity(data, [k * 2, k * 2], 1, () => true, curves.lines);
    // Lines are measured from their end points on each pick; nothing of them is kept.
    expect(curves.sampled).toBe(kept + 50 * lines);
    expect(curves.built).toBe(1);
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
    const lines = Object.values(b.entities).filter((e) => e.type === 'line').length;
    expect(curves.sampled).toBe(before + lines);
    expect(curves.built).toBe(2);
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
    // Each sketch's kept curves sampled once for all those picks.
    expect(curves.built).toBe(2);
  });

  it('breaks exact ties as pickEntity does: duplicate curves, integer-like IDs first', () => {
    // Integer-like keys come first in iteration order, whatever order they were added in.
    const entities: Record<string, unknown> = {
      a: { type: 'point', x: 0, y: 0 },
      b: { type: 'point', x: 10, y: 0 },
      c: { type: 'point', x: 5, y: 5 },
      lineB: { type: 'line', start: 'a', end: 'b' },
      '7': { type: 'line', start: 'a', end: 'b' },
      lineA: { type: 'line', start: 'b', end: 'a' },
      circleB: { type: 'circle', center: 'c', radius: 3 },
      '3': { type: 'circle', center: 'c', radius: 3 },
      circleA: { type: 'circle', center: 'c', radius: 3 },
      arc: { type: 'arc', center: 'c', start: 'b', end: 'a' },
      '12': { type: 'arc', center: 'c', start: 'b', end: 'a' },
    };
    const data = deepFreeze({ entities, constraints: {}, dimensions: {} }) as unknown as SketchData;
    const curves = new SketchCurves();
    let n = 0;
    for (let x = -1; x <= 11; x += 0.5) {
      for (let y = -1; y <= 9; y += 0.5) {
        for (const reach of [0.1, 1, 3]) {
          for (const points of [false, true]) {
            const accept = (e: { type: string }) => points || e.type !== 'point';
            const want = pickEntity(data, [x, y], reach, accept);
            expect(nearestEntity(data, [x, y], reach, accept, curves.lines)).toBe(want);
            if (want) n++;
          }
        }
      }
    }
    expect(n).toBeGreaterThan(100);
  });

  it('measures a curve whose box is exactly at reach, and one step either side', () => {
    const data = scattered(12, 24);
    const curves = new SketchCurves();
    let cases = 0;
    for (const [key, e] of Object.entries(data.entities)) {
      if (e.type === 'point') continue;
      const id = key as SketchEntityId;
      const { lines, box } = curves.lines(data, e, id);
      const line = lines[0];
      if (!box || !line) continue;
      const [minX, minY, maxX, maxY] = [box[0], box[1], box[2], box[3]] as number[] as [
        number,
        number,
        number,
        number,
      ];
      // The vertex furthest right: a cursor straight right of it at `reach` is at `reach` exactly.
      let vy = 0;
      for (let i = 0; i + 1 < line.length; i += 2) if (line[i] === maxX) vy = line[i + 1] as number;
      for (const reach of [0.25, 1, 4]) {
        const step = reach * 1e-15;
        const cursors: [number, number][] = [];
        for (const d of [reach - step, reach, reach + step]) {
          cursors.push(
            [maxX + d, vy],
            [minX - d, (minY + maxY) / 2],
            [(minX + maxX) / 2, maxY + d],
          );
          cursors.push([maxX + d / Math.SQRT2, maxY + d / Math.SQRT2]);
          cursors.push([minX - d / Math.SQRT2, minY - d / Math.SQRT2]);
        }
        for (const cursor of cursors) {
          // Only this curve may be picked, so the box skip decides alone.
          const only = (x: unknown) => x === e;
          expect(nearestEntity(data, cursor, reach, only, curves.lines)).toBe(
            pickEntity(data, cursor, reach, only),
          );
          cases++;
        }
      }
    }
    expect(cases).toBeGreaterThan(500);
  });

  it('takes construction curves or leaves them at every reach as pickEntity does', () => {
    const data = scattered(13);
    const curves = new SketchCurves();
    const r = random(14);
    for (let k = 0; k < 150; k++) {
      const cursor: [number, number] = [r() * 110 - 5, r() * 110 - 5];
      for (const reach of [0.05, 0.5, 2, 8]) {
        for (const construction of [false, true]) {
          const accept = (e: { type: string; construction?: boolean }) =>
            e.type !== 'point' && (construction || !e.construction);
          expect(nearestEntity(data, cursor, reach, accept, curves.lines)).toBe(
            pickEntity(data, cursor, reach, accept),
          );
        }
      }
    }
  });

  it("box selects the sketch curves the old code's loop took", () => {
    const frame = planeFrame(originPlaneRef('origin:xy')) as SketchFrame;
    const sketches = [15, 16].map((seed) => ({
      id: `s${seed}` as FeatureId,
      frame,
      data: scattered(seed, 40),
    }));
    const filter = { ...DEFAULT_FILTER, construction: true, sketchPoints: true };
    const curves = new SketchCurves();
    const scene: PickScene = { bodies: [], sketches, occluding: true, curves: curves.lines };
    const top = cameraFrom([0, 0, 1], { target: [50, 50, 0], size: 120 });
    // A copy of the old sketch pass: every accepted entity's polylines, projected point by point.
    const inside = (rect: Rect, p: readonly [number, number]) =>
      p[0] >= rect.x0 && p[0] <= rect.x1 && p[1] >= rect.y0 && p[1] <= rect.y1;
    const polylineIn = (pts: ([number, number] | undefined)[], rect: Rect, window: boolean) => {
      if (pts.length === 0) return false;
      if (window) return pts.every((p) => p !== undefined && inside(rect, p));
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        if (p && inside(rect, p)) return true;
        const q = pts[i + 1];
        if (p && q && segmentMeetsRect(p, q, rect)) return true;
      }
      return false;
    };
    const old = (from: [number, number], to: [number, number]) => {
      const window = to[0] >= from[0];
      const rect = {
        x0: Math.min(from[0], to[0]),
        y0: Math.min(from[1], to[1]),
        x1: Math.max(from[0], to[0]),
        y1: Math.max(from[1], to[1]),
      };
      return sketches.flatMap((sketch) => {
        const out: { kind: string; id: string }[] = [];
        for (const [key, entity] of Object.entries(sketch.data.entities)) {
          const ok =
            entity.type === 'point'
              ? filter.sketchPoints
              : filter.sketches && (!entity.construction || filter.construction);
          if (!ok) continue;
          const hit = entityPolylines(sketch.data, entity, key as SketchEntityId).some((line) =>
            polylineIn(
              line.map((q) => projectPoint(top, sketchToWorld(sketch.frame, q))),
              rect,
              window,
            ),
          );
          if (hit) out.push({ kind: 'sketchEntity', id: `${sketch.id}/${key}` });
        }
        return out;
      });
    };
    const r = random(17);
    let taken = 0;
    for (let k = 0; k < 40; k++) {
      const from = topViewPx(top, r() * 100, r() * 100);
      const to = topViewPx(top, r() * 100, r() * 100);
      const want = old(from, to);
      taken += want.length;
      expect(pickBox(scene, top, from, to, filter)).toEqual(want);
    }
    expect(taken).toBeGreaterThan(40);
    // No point was asked for: nothing kept for them.
    expect(curves.keptBytes()).toBeGreaterThan(0);
  });

  it('keeps at most twice the bytes the drawing keeps: lines, circles, a mix', () => {
    const frame = planeFrame(originPlaneRef('origin:xy')) as SketchFrame;
    const drawn = (data: SketchData, curves: SketchCurves) => {
      const s = sketchSegments(data, frame, undefined, false, undefined, curves.lines);
      return [s.curves.free, s.curves.fixed, s.curves.conflict, s.construction, s.projected].reduce(
        (n, a) => n + a.byteLength,
        0,
      );
    };
    const kinds = (data: SketchData) => {
      const curves = new SketchCurves();
      const bytes = drawn(data, curves);
      return { kept: curves.keptBytes(), drawn: bytes };
    };
    const only = (kind: 'line' | 'circle' | 'arc') => {
      const entities: Record<string, unknown> = {};
      for (let i = 0; i < 300; i++) {
        entities[`a${i}`] = { type: 'point', x: i, y: 0 };
        entities[`b${i}`] = { type: 'point', x: i + 0.4, y: 0.3 };
        if (kind === 'line') entities[`e${i}`] = { type: 'line', start: `a${i}`, end: `b${i}` };
        if (kind === 'circle') entities[`e${i}`] = { type: 'circle', center: `a${i}`, radius: 0.2 };
        // A short arc (0.1 rad): three points, too few to keep.
        if (kind === 'arc') {
          entities[`s${i}`] = { type: 'point', x: i + 0.5, y: 0 };
          entities[`t${i}`] = { type: 'point', x: i + 0.5 * Math.cos(0.1), y: 0.5 * Math.sin(0.1) };
          entities[`e${i}`] = { type: 'arc', center: `a${i}`, start: `s${i}`, end: `t${i}` };
        }
      }
      return deepFreeze({ entities, constraints: {}, dimensions: {} }) as unknown as SketchData;
    };
    const lines = kinds(only('line'));
    expect(lines.kept).toBe(0);
    expect(lines.drawn).toBe(300 * 24);
    const circles = kinds(only('circle'));
    expect(circles.kept).toBeGreaterThan(0);
    expect(circles.kept).toBeLessThanOrEqual(circles.drawn);
    const arcs = kinds(only('arc'));
    expect(arcs.drawn).toBe(300 * 2 * 24);
    expect(arcs.kept).toBe(0);
    for (const seed of [18, 19]) {
      const mix = kinds(scattered(seed, 120));
      expect(mix.kept).toBeGreaterThan(0);
      expect(mix.kept).toBeLessThanOrEqual(2 * mix.drawn);
    }
    // Points are never kept, however they are asked for.
    const curves = new SketchCurves();
    const data = only('line');
    for (const [id, e] of Object.entries(data.entities)) curves.lines(data, e, id as never);
    expect(curves.keptBytes()).toBe(0);
  });
});
