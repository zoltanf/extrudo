// Measure and inspect (P2-13, ADR-0035): item properties from exact
// geometry, distances with their closest points, angles and centre
// distances between two items.
import type { BodyId } from '@extrudo/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type ItemMeasure, inspectShapes, pairMeasure, unionBox } from './inspect';
import { Kernel, type ShapeHandle, type Vec3 } from './kernel';
import { loadOcct } from './occt/load';

const BODY = 'b1' as BodyId;
const OTHER = 'b2' as BodyId;

describe('pairMeasure', () => {
  const box = { min: [0, 0, 0] as Vec3, max: [0, 0, 0] as Vec3 };
  const closest = { distance: 5, from: [0, 0, 0] as Vec3, to: [5, 0, 0] as Vec3 };
  const plane = (normal: Vec3): ItemMeasure => ({
    kind: 'face',
    area: 1,
    centroid: [0, 0, 0],
    bbox: box,
    surface: 'plane',
    normal,
  });
  const line = (start: Vec3, end: Vec3): ItemMeasure => {
    const d: Vec3 = [end[0] - start[0], end[1] - start[1], end[2] - start[2]];
    const l = Math.hypot(...d);
    return {
      kind: 'edge',
      length: l,
      centroid: [0, 0, 0],
      bbox: box,
      curve: 'line',
      closed: false,
      start,
      end,
      direction: [d[0] / l, d[1] / l, d[2] / l],
    };
  };
  const cylinder = (origin: Vec3, direction: Vec3): ItemMeasure => ({
    kind: 'face',
    area: 1,
    centroid: origin,
    bbox: box,
    surface: 'cylinder',
    axis: { origin, direction },
    radius: 2,
  });
  const vertex = (point: Vec3): ItemMeasure => ({ kind: 'vertex', point, bbox: box });

  it('gives the angle between planes, 0–90°', () => {
    expect(pairMeasure(plane([0, 0, 1]), plane([1, 0, 0]), closest).angle).toBeCloseTo(90);
    expect(pairMeasure(plane([0, 0, 1]), plane([0, 0, -1]), closest).angle).toBeCloseTo(0);
    const tilted: Vec3 = [0, Math.sin(Math.PI / 6), Math.cos(Math.PI / 6)];
    expect(pairMeasure(plane([0, 0, 1]), plane(tilted), closest).angle).toBeCloseTo(30);
  });

  it('gives a line to a plane as the complement of the angle to its normal', () => {
    const a = pairMeasure(line([0, 0, 0], [0, 0, 5]), plane([0, 0, 1]), closest);
    expect(a.angle).toBeCloseTo(90);
    const b = pairMeasure(line([0, 0, 0], [3, 0, 0]), plane([0, 0, 1]), closest);
    expect(b.angle).toBeCloseTo(0);
  });

  it('measures the corner between line edges that share an end, 0–180°', () => {
    const a = line([0, 0, 0], [10, 0, 0]);
    const b = line([0, 0, 0], [-10, 10, 0]);
    expect(pairMeasure(a, b, closest).angle).toBeCloseTo(135);
    // Apart, they are undirected lines: 45°.
    const c = line([0, 5, 0], [-10, 15, 0]);
    expect(pairMeasure(a, c, closest).angle).toBeCloseTo(45);
  });

  it('has no angle without two directions', () => {
    expect(pairMeasure(vertex([0, 0, 0]), plane([0, 0, 1]), closest).angle).toBeUndefined();
  });

  it('gives the distance between parallel axes and from a point to an axis', () => {
    const a = cylinder([0, 0, 0], [0, 0, 1]);
    const b = cylinder([30, 40, 7], [0, 0, 1]);
    const pair = pairMeasure(a, b, { distance: 46, from: [2, 0, 0], to: [28, 0, 0] });
    expect(pair.centers?.distance).toBeCloseTo(50);
    expect(pair.centers?.to).toEqual([30, 40, 0]);
    const p = pairMeasure(vertex([3, 4, 9]), a, { ...closest, distance: 3 });
    expect(p.centers?.distance).toBeCloseTo(5);
    expect(pair.angle).toBeCloseTo(0);
    // Skew axes have no single distance.
    const skew = pairMeasure(a, cylinder([5, 0, 0], [1, 0, 0]), closest);
    expect(skew.centers).toBeUndefined();
  });

  it('leaves out a centre distance equal to the distance', () => {
    const pair = pairMeasure(vertex([0, 0, 0]), vertex([5, 0, 0]), closest);
    expect(pair.centers).toBeUndefined();
    expect(pair.distance).toBe(5);
  });

  it('boxes boxes', () => {
    expect(unionBox([])).toBeUndefined();
    expect(
      unionBox([
        { min: [0, 0, 0], max: [1, 2, 3] },
        { min: [-1, 1, 1], max: [0, 5, 2] },
      ]),
    ).toEqual({ min: [-1, 0, 0], max: [1, 5, 3] });
  });
});

describe('inspectShapes (OCCT)', () => {
  let kernel: Kernel;
  let block: ShapeHandle;
  let shaft: ShapeHandle;

  beforeAll(async () => {
    kernel = new Kernel(await loadOcct());
    block = kernel.box([40, 80, 60]);
    shaft = kernel.cylinder(5, 20, [100, 0, 0]);
  });
  afterAll(() => {
    kernel.release(block, shaft);
    expect(kernel.stats().liveShapes).toBe(0);
  });

  /** The index of the face of `shape` whose plane normal (or axis) is `direction`. */
  function faceWhere(
    shape: ShapeHandle,
    test: (s: ReturnType<Kernel['surfaceGeometry']>) => boolean,
  ): number {
    for (let i = 0; i < kernel.count(shape, 'face'); i++) {
      if (test(kernel.surfaceGeometry(shape, i))) return i;
    }
    throw new Error('no such face');
  }
  const same = (a: Vec3 | undefined, b: Vec3) =>
    a?.every((v, k) => Math.abs(v - (b[k] as number)) < 1e-9) ?? false;

  it('measures a body: volume, area, centroid, box', () => {
    const { items, bbox } = inspectShapes(kernel, [
      { body: block, target: { kind: 'body', body: BODY, index: 0 } },
    ]);
    const [item] = items;
    expect(item?.kind).toBe('body');
    if (item?.kind !== 'body') return;
    expect(item.volume).toBeCloseTo(40 * 80 * 60, 6);
    expect(item.area).toBeCloseTo(2 * (40 * 80 + 40 * 60 + 80 * 60), 6);
    expect(item.centroid.map((v) => Math.round(v * 1e6) / 1e6)).toEqual([20, 40, 30]);
    expect(bbox?.min.map((v) => Math.round(v * 1e6) / 1e6)).toEqual([0, 0, 0]);
    expect(bbox?.max.map((v) => Math.round(v * 1e6) / 1e6)).toEqual([40, 80, 60]);
  });

  it('measures faces: a plane with its outward normal, a cylinder with axis and radius', () => {
    const top = faceWhere(block, (s) => s.type === 'plane' && same(s.direction, [0, 0, 1]));
    const bottom = faceWhere(block, (s) => s.type === 'plane' && same(s.direction, [0, 0, -1]));
    const wall = faceWhere(shaft, (s) => s.type === 'cylinder');
    const { items, pair } = inspectShapes(kernel, [
      { body: block, target: { kind: 'face', body: BODY, index: top } },
      { body: block, target: { kind: 'face', body: BODY, index: bottom } },
    ]);
    expect(items[0]).toMatchObject({ kind: 'face', surface: 'plane', normal: [0, 0, 1] });
    expect(items[0]?.kind === 'face' && items[0].area).toBeCloseTo(40 * 80, 6);
    expect(pair?.distance).toBeCloseTo(60, 6);
    expect(pair?.angle).toBeCloseTo(0, 6);
    // The closest points lie on each face.
    expect(pair?.from[2]).toBeCloseTo(60, 6);
    expect(pair?.to[2]).toBeCloseTo(0, 6);

    const round = inspectShapes(kernel, [
      { body: shaft, target: { kind: 'face', body: OTHER, index: wall } },
    ]).items[0];
    expect(round).toMatchObject({ kind: 'face', surface: 'cylinder', radius: 5 });
    if (round?.kind !== 'face') return;
    expect(round.axis?.direction).toEqual([0, 0, 1]);
    expect(round.area).toBeCloseTo(2 * Math.PI * 5 * 20, 6);
    // The exact box of the wall, not the mesh's.
    expect(round.bbox.min[0]).toBeCloseTo(95, 6);
    expect(round.bbox.max[1]).toBeCloseTo(5, 6);
  });

  it('measures edges: a line with its ends, a circle with centre and radius', () => {
    const lines: number[] = [];
    let circle = -1;
    for (let i = 0; i < kernel.count(shaft, 'edge'); i++) {
      const g = kernel.edgeGeometry(shaft, i, 2);
      if (g.type === 'circle' && circle < 0) circle = i;
    }
    for (let i = 0; i < kernel.count(block, 'edge'); i++) lines.push(i);
    const [a] = inspectShapes(kernel, [
      { body: shaft, target: { kind: 'edge', body: OTHER, index: circle } },
    ]).items;
    expect(a).toMatchObject({ kind: 'edge', curve: 'circle', closed: true, radius: 5, sweep: 360 });
    expect(a?.kind === 'edge' && a.length).toBeCloseTo(10 * Math.PI, 6);

    // Two box edges that meet at a corner: 90°.
    const edges = lines.map((i) => ({
      i,
      g: kernel.edgeGeometry(block, i, 2),
    }));
    const [first] = edges;
    const firstStart = first?.g.type !== 'degenerate' ? first?.g.points[0] : undefined;
    const meeting = edges.find(
      ({ i, g }) =>
        i !== first?.i &&
        g.type === 'line' &&
        firstStart &&
        g.points.some((p) => same(p, firstStart)),
    );
    const corner = inspectShapes(kernel, [
      { body: block, target: { kind: 'edge', body: BODY, index: first?.i ?? 0 } },
      { body: block, target: { kind: 'edge', body: BODY, index: meeting?.i ?? 0 } },
    ]);
    expect(corner.pair?.distance).toBeCloseTo(0, 9);
    expect(corner.pair?.angle).toBeCloseTo(90, 6);
  });

  it('measures between bodies: vertex to cylinder axis, body to body', () => {
    const shaftWall = faceWhere(shaft, (s) => s.type === 'cylinder');
    const origin = (() => {
      for (let i = 0; i < kernel.count(block, 'vertex'); i++) {
        const [v] = inspectShapes(kernel, [
          { body: block, target: { kind: 'vertex', body: BODY, index: i } },
        ]).items;
        if (v?.kind === 'vertex' && same(v.point, [40, 0, 0])) return i;
      }
      return -1;
    })();
    const { pair } = inspectShapes(kernel, [
      { body: block, target: { kind: 'vertex', body: BODY, index: origin } },
      { body: shaft, target: { kind: 'face', body: OTHER, index: shaftWall } },
    ]);
    // 60 from the axis, 55 from the wall.
    expect(pair?.distance).toBeCloseTo(55, 6);
    expect(pair?.centers?.distance).toBeCloseTo(60, 6);

    const bodies = inspectShapes(kernel, [
      { body: block, target: { kind: 'body', body: BODY, index: 0 } },
      { body: shaft, target: { kind: 'body', body: OTHER, index: 0 } },
    ]);
    expect(bodies.pair?.distance).toBeCloseTo(55, 6);
    expect(bodies.bbox?.max[0]).toBeCloseTo(105, 6);
  });
});
