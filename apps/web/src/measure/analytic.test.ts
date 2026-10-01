import {
  createDocument,
  createDocumentStore,
  createSketch,
  type FeatureId,
  newId,
  originPlaneRef,
  type SketchData,
} from '@extrudo/core';
import type { InspectTarget, ItemMeasure, Vec3 } from '@extrudo/kernel';
import { describe, expect, it } from 'vitest';
import { analyticItem, closestBetween } from './analytic';
import { measureState } from './inspection';

const B = 'b' as InspectTarget['body'];
const box = { min: [0, 0, 0] as Vec3, max: [0, 0, 0] as Vec3 };
const vertex = (point: Vec3): ItemMeasure => ({ kind: 'vertex', point, bbox: box });
const segment = (start: Vec3, end: Vec3): ItemMeasure => ({
  kind: 'edge',
  length: 1,
  centroid: start,
  bbox: box,
  curve: 'line',
  closed: false,
  start,
  end,
});
const axis = (origin: Vec3, direction: Vec3): ItemMeasure => ({ kind: 'axis', origin, direction });
const plane = (origin: Vec3, normal: Vec3): ItemMeasure => ({ kind: 'plane', origin, normal });

/** A document with one XZ sketch holding a 10 mm line, a circle of radius 5 and a point. */
function sketchDoc() {
  const store = createDocumentStore(createDocument());
  const id = newId<FeatureId>();
  store.getState().dispatch(createSketch({ id, plane: originPlaneRef('origin:xz') }));
  const data: SketchData = {
    entities: {
      p1: { type: 'point', x: 0, y: 0 },
      p2: { type: 'point', x: 10, y: 0 },
      l1: { type: 'line', start: 'p1', end: 'p2' },
      c: { type: 'point', x: 20, y: 5 },
      k1: { type: 'circle', center: 'c', radius: 5 },
      p3: { type: 'point', x: 0, y: 30 },
    },
    constraints: {},
    dimensions: {},
  } as unknown as SketchData;
  const doc = store.getState().doc;
  return {
    id,
    doc: {
      ...doc,
      features: doc.features.map((f) =>
        f.id === id
          ? { ...f, inputs: { ...f.inputs, sketch: { kind: 'sketchData' as const, sketch: data } } }
          : f,
      ),
    },
  };
}

describe('analyticItem', () => {
  it('measures sketch curves and points in world mm through their frame', () => {
    const { id, doc } = sketchDoc();
    const line = analyticItem({ kind: 'sketchEntity', id: `${id}/l1` }, { doc });
    expect(line).toMatchObject({ kind: 'edge', curve: 'line', length: 10 });
    const circle = analyticItem({ kind: 'sketchEntity', id: `${id}/k1` }, { doc });
    expect(circle).toMatchObject({ kind: 'edge', curve: 'circle', closed: true, radius: 5 });
    expect(circle?.kind === 'edge' && circle.length).toBeCloseTo(10 * Math.PI);
    const point = analyticItem({ kind: 'sketchEntity', id: `${id}/p3` }, { doc });
    expect(point?.kind).toBe('vertex');
    // The XZ plane's sketch y is world Z (its frame matches the ViewCube).
    expect(point?.kind === 'vertex' && Math.abs(point.point[2])).toBeCloseTo(30);
    expect(analyticItem({ kind: 'sketchEntity', id: `${id}/gone` }, { doc })).toBeUndefined();
  });

  it('measures origin axes and planes, and construction reports', () => {
    const doc = createDocument();
    expect(analyticItem({ kind: 'axis', id: 'origin:z' }, { doc })).toEqual(
      axis([0, 0, 0], [0, 0, 1]),
    );
    expect(analyticItem({ kind: 'plane', id: 'origin:xy' }, { doc })).toMatchObject({
      kind: 'plane',
      normal: [0, 0, 1],
    });
    const construction = {
      a1: { kind: 'axis' as const, origin: [1, 2, 3] as Vec3, direction: [0, 1, 0] as Vec3 },
      q1: { kind: 'point' as const, point: [4, 5, 6] as Vec3 },
    };
    expect(analyticItem({ kind: 'axis', id: 'a1' }, { doc, construction })).toEqual(
      axis([1, 2, 3], [0, 1, 0]),
    );
    expect(analyticItem({ kind: 'point', id: 'q1' }, { doc, construction })).toMatchObject({
      kind: 'vertex',
      point: [4, 5, 6],
    });
    expect(analyticItem({ kind: 'profile', id: 's/r1' }, { doc })).toBeUndefined();
  });
});

describe('closestBetween', () => {
  it('points, segments, axes and planes in any mix', () => {
    expect(closestBetween(vertex([0, 0, 0]), vertex([3, 4, 0]))?.distance).toBeCloseTo(5);
    // A point beyond a segment's end: the end is nearest.
    const end = closestBetween(vertex([15, 3, 0]), segment([0, 0, 0], [10, 0, 0]));
    expect(end?.to).toEqual([10, 0, 0]);
    expect(end?.distance).toBeCloseTo(Math.hypot(5, 3));
    // The same point to the unbounded X axis: straight down.
    expect(closestBetween(vertex([15, 3, 0]), axis([0, 0, 0], [1, 0, 0]))?.distance).toBeCloseTo(3);
    expect(closestBetween(vertex([1, 2, 7]), plane([0, 0, 0], [0, 0, 1]))?.to).toEqual([1, 2, 0]);
    // Skew axes: X and a Y-parallel line at z = 4.
    const skew = closestBetween(axis([0, 0, 0], [1, 0, 0]), axis([5, 0, 4], [0, 1, 0]));
    expect(skew?.distance).toBeCloseTo(4);
    expect(skew?.from[0]).toBeCloseTo(5);
    // Parallel segments 2 apart.
    expect(
      closestBetween(segment([0, 0, 0], [10, 0, 0]), segment([3, 2, 0], [20, 2, 0]))?.distance,
    ).toBeCloseTo(2);
    // A segment crossing a plane touches it; one above it is its nearer end away.
    expect(
      closestBetween(segment([0, 0, -1], [0, 0, 1]), plane([0, 0, 0], [0, 0, 1]))?.distance,
    ).toBeCloseTo(0);
    expect(
      closestBetween(plane([0, 0, 0], [0, 0, 1]), segment([0, 0, 3], [0, 0, 8]))?.distance,
    ).toBeCloseTo(3);
    // Planes: parallel ones are apart, others meet.
    expect(
      closestBetween(plane([0, 0, 0], [0, 0, 1]), plane([0, 0, 6], [0, 0, -1]))?.distance,
    ).toBeCloseTo(6);
    const meet = closestBetween(plane([0, 0, 0], [0, 0, 1]), plane([2, 0, 0], [1, 0, 0]));
    expect(meet?.distance).toBeCloseTo(0);
    expect(meet?.from[0]).toBeCloseTo(2);
    expect(meet?.from[2]).toBeCloseTo(0);
  });

  it('leaves faces, bodies and curves to the kernel', () => {
    const circle = { ...segment([0, 0, 0], [1, 0, 0]), curve: 'circle' } as ItemMeasure;
    expect(closestBetween(circle, vertex([0, 0, 0]))).toBeUndefined();
  });
});

describe('measureState', () => {
  const face = { kind: 'face' as const, id: 'b:2' };
  const target: InspectTarget = { kind: 'face', body: B, index: 2 };
  const faceItem: ItemMeasure = {
    kind: 'face',
    area: 100,
    centroid: [0, 0, 5],
    bbox: { min: [-5, -5, 5], max: [5, 5, 5] },
    surface: 'plane',
    normal: [0, 0, 1],
  };
  const local = (item: { kind: string; id: string }) =>
    item.kind === 'axis'
      ? { item: axis([0, 0, 0], [1, 0, 0]), label: 'X axis' }
      : item.kind === 'sketchEntity'
        ? { item: vertex([0, 0, 0]), label: 'Point · Sketch1' }
        : undefined;
  const label = () => 'Face 3 · Body1';

  it('mixes kernel items and local ones in selection order', () => {
    const empty = measureState([], { targets: [] }, local, label);
    expect(empty.status).toBe('empty');
    const pending = measureState(
      [{ kind: 'axis', id: 'origin:x' }, face],
      { targets: [target] },
      local,
      label,
    );
    expect(pending).toMatchObject({ status: 'pending', labels: ['X axis', 'Face 3 · Body1'] });
    const ready = measureState(
      [{ kind: 'axis', id: 'origin:x' }, face],
      { targets: [target], inspection: { items: [faceItem], bbox: faceItem.bbox } },
      local,
      label,
    );
    expect(ready.status).toBe('ready');
    expect(ready.measurement?.items.map((i) => i.kind)).toEqual(['axis', 'face']);
    // An axis and a face: no distance here, but the angle and the face's box.
    expect(ready.measurement?.pair).toEqual({ angle: 0 });
    expect(ready.measurement?.bbox).toEqual(faceItem.bbox);
  });

  it('needs no kernel for local items alone, and gives their distance', () => {
    const state = measureState(
      [
        { kind: 'axis', id: 'origin:x' },
        { kind: 'sketchEntity', id: 's/p' },
      ],
      { targets: [] },
      local,
      label,
    );
    expect(state.status).toBe('ready');
    expect(state.measurement?.pair?.distance).toBeCloseTo(0);
    expect(state.count).toBe(2);
  });

  it('reports a kernel error only when a kernel item is selected', () => {
    const err = measureState([face], { targets: [target], error: 'Body gone' }, local, label);
    expect(err).toMatchObject({ status: 'error', error: 'Body gone' });
  });
});
