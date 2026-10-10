import type { BodyMesh } from '@extrudo/kernel';
import { describe, expect, it } from 'vitest';
import {
  chainEnds,
  chamferSetManipulators,
  type EdgeHandle,
  edgeHandle,
  faceDirections,
  localFaceDirections,
  setDistanceManipulator,
  variableSetManipulators,
} from './edgeHandles';
import type { DialogValues } from './spec';
import { BOX, cylinderMesh, namedBoxEdgesMesh, namedBoxMesh } from './testing';

const bodies = { [BOX]: namedBoxEdgesMesh() };

/** The 10 mm box's edge 2: between the top face (z = 10) and the front wall (y = 0). */
const TOP_FRONT = 'e[box:front|box:top]';
/** Its vertical edge where the front wall (y = 0) and the left one (x = 0) meet. */
const FRONT_LEFT = 'e[box:front|box:left]';

const round = (v: readonly number[]) => v.map((c) => Math.round(c * 1000) / 1000 + 0);

/** Where a handle sits, with its numbers to three decimals (1/√2 reads as 0.707). */
const shown = (handle: EdgeHandle | undefined) =>
  handle ? { origin: round(handle.origin), direction: round(handle.direction) } : undefined;

/** The bisector of the two unit vectors, at 45° between them. */
const half = (a: readonly number[], b: readonly number[]) =>
  round([0, 1, 2].map((k) => (a[k] as number) / Math.SQRT2 + (b[k] as number) / Math.SQRT2));

const values = (refs: DialogValues['refs']): DialogValues => ({
  refs,
  exprs: {},
  choices: {},
  toggles: {},
  labels: {},
});

describe('a fillet or chamfer handle on an edge', () => {
  it('sits at the middle of the edge and points away from the body', () => {
    // The top front edge runs from (0, 0, 10) to (10, 0, 10): its middle is
    // (5, 0, 10). Up (the top face) and out of the front (the front wall)
    // bisect to 45° between them, away from the solid.
    expect(shown(edgeHandle(bodies, { kind: 'edge', id: TOP_FRONT }))).toEqual({
      origin: [5, 0, 10],
      direction: half([0, 0, 1], [0, -1, 0]),
    });
    // The vertical corner where the front and left walls meet, at (0, 0, 5):
    // out of both walls.
    expect(shown(edgeHandle(bodies, { kind: 'edge', id: FRONT_LEFT }))).toEqual({
      origin: [0, 0, 5],
      direction: half([0, -1, 0], [-1, 0, 0]),
    });
  });

  it('drives the set’s field, with the edge of the set it is given', () => {
    const handle = setDistanceManipulator(
      'radius',
      'edges',
      values({ edges: [{ kind: 'edge', id: TOP_FRONT }] }),
      bodies,
    );
    expect(handle?.kind).toBe('distance');
    expect(handle?.field).toBe('radius');
    expect(shown(handle?.kind === 'distance' ? handle : undefined)).toEqual({
      origin: [5, 0, 10],
      direction: half([0, 0, 1], [0, -1, 0]),
    });
    // Nothing picked, nothing drawn.
    expect(setDistanceManipulator('radius', 'edges', values({}), bodies)).toBeUndefined();
  });

  it('is left out where the edge can’t carry one honestly', () => {
    // A kind that is not an edge, and an edge of one face only (a seam).
    expect(edgeHandle(bodies, { kind: 'face', id: 'box:top' })).toBeUndefined();
    expect(edgeHandle(bodies, { kind: 'edge', id: 'e[box:top]' })).toBeUndefined();
    // An edge of a body the meshes don’t have.
    expect(edgeHandle(bodies, { kind: 'edge', id: 'e[a|b]' })).toBeUndefined();
    // A mesh whose edge names don’t say which two faces bound them.
    const plain = { [BOX]: namedBoxMesh() };
    expect(edgeHandle(plain, { kind: 'edge', id: TOP_FRONT })).toBeUndefined();
    expect(edgeHandle(plain, { kind: 'edge', id: 'box:e2' })).toBeUndefined();
  });
});

const mesh = namedBoxEdgesMesh();
const edgeRef = (i: number) => ({ kind: 'edge' as const, id: mesh.edgeIds?.[i] as string });
const faceRef = (name: string) => ({ kind: 'face' as const, id: `box:${name}` });
/** The box's top edges as chains: 2 runs (0,0,10)→(10,0,10), 7 on to (10,10,10), 3 is (0,10,10)→(10,10,10), 6 (0,0,10)→(0,10,10). */
const TOP_FRONT_EDGE = 2;
const TOP_RIGHT_EDGE = 7;
const TOP_BACK_EDGE = 3;
const TOP_LEFT_EDGE = 6;
const unit = (v: readonly number[]) => round(v);

describe('where a variable round starts and ends', () => {
  it('walks the chain from its free end, the way the edges’ own polylines run', () => {
    const ends = chainEnds(bodies, [edgeRef(TOP_FRONT_EDGE), edgeRef(TOP_RIGHT_EDGE)]);
    expect(ends && round(ends.start.point)).toEqual([0, 0, 10]);
    expect(ends && round(ends.end.point)).toEqual([10, 10, 10]);
    expect(ends?.start.edge.id).toBe(edgeRef(TOP_FRONT_EDGE).id);
    expect(ends?.end.edge.id).toBe(edgeRef(TOP_RIGHT_EDGE).id);
    // The order the set lists them in changes nothing.
    const again = chainEnds(bodies, [edgeRef(TOP_RIGHT_EDGE), edgeRef(TOP_FRONT_EDGE)]);
    expect(again && round(again.start.point)).toEqual([0, 0, 10]);
  });

  it('is one edge’s own two ends', () => {
    const ends = chainEnds(bodies, [edgeRef(TOP_FRONT_EDGE)]);
    expect(ends && round(ends.start.point)).toEqual([0, 0, 10]);
    expect(ends && round(ends.end.point)).toEqual([10, 0, 10]);
  });

  it('has no ends where the chain is closed, broken, or its edges disagree on the way', () => {
    // The four top edges close up.
    const ring = [TOP_FRONT_EDGE, TOP_RIGHT_EDGE, TOP_BACK_EDGE, TOP_LEFT_EDGE].map(edgeRef);
    expect(chainEnds(bodies, ring)).toBeUndefined();
    // Two edges that don't meet.
    expect(chainEnds(bodies, [edgeRef(TOP_FRONT_EDGE), edgeRef(5)])).toBeUndefined();
    // Front → right runs with the polylines, back runs against them (6 → 7 after 5 → 7).
    expect(
      chainEnds(bodies, [edgeRef(TOP_FRONT_EDGE), edgeRef(TOP_RIGHT_EDGE), edgeRef(TOP_BACK_EDGE)]),
    ).toBeUndefined();
    // An edge the meshes don't have, and nothing at all.
    expect(chainEnds(bodies, [{ kind: 'edge', id: 'e[a|b]' }])).toBeUndefined();
    expect(chainEnds(bodies, [])).toBeUndefined();
  });

  it('makes a handle at each end on the bisector there, Radius first unless swapped', () => {
    const v = values({ edges: [edgeRef(TOP_FRONT_EDGE), edgeRef(TOP_RIGHT_EDGE)] });
    const placed = (fields: { start: string; end: string }) =>
      variableSetManipulators(fields, 'edges', v, bodies).map((m) =>
        m.kind === 'distance'
          ? { field: m.field, origin: round(m.origin), direction: unit(m.direction) }
          : m,
      );
    expect(placed({ start: 'radius', end: 'radiusEnd' })).toEqual([
      { field: 'radius', origin: [0, 0, 10], direction: half([0, 0, 1], [0, -1, 0]) },
      { field: 'radiusEnd', origin: [10, 10, 10], direction: half([0, 0, 1], [1, 0, 0]) },
    ]);
    // Swapped, the two change places.
    expect(placed({ start: 'radiusEnd', end: 'radius' })).toEqual([
      { field: 'radiusEnd', origin: [0, 0, 10], direction: half([0, 0, 1], [0, -1, 0]) },
      { field: 'radius', origin: [10, 10, 10], direction: half([0, 0, 1], [1, 0, 0]) },
    ]);
    // A closed chain: no handle at all.
    const ring = values({
      edges: [TOP_FRONT_EDGE, TOP_RIGHT_EDGE, TOP_BACK_EDGE, TOP_LEFT_EDGE].map(edgeRef),
    });
    expect(
      variableSetManipulators({ start: 'radius', end: 'radiusEnd' }, 'edges', ring, bodies),
    ).toEqual([]);
  });

  it('leaves out only the end whose bisector can’t be read', () => {
    // The first edge's second face isn't in the meshes: its end has no handle, the other end keeps its own.
    const names = mesh.edgeIds as string[];
    const broken = {
      ...mesh,
      edgeIds: names.map((n, i) => (i === TOP_FRONT_EDGE ? 'e[box:top|box:gone]' : n)),
    };
    const v = values({
      edges: [{ kind: 'edge', id: 'e[box:top|box:gone]' }, edgeRef(TOP_RIGHT_EDGE)],
    });
    const out = variableSetManipulators({ start: 'radius', end: 'radiusEnd' }, 'edges', v, {
      [BOX]: broken,
    });
    expect(out.map((m) => m.field)).toEqual(['radiusEnd']);
  });
});

describe('the handles of every set', () => {
  it('computes nothing for a set without edges', () => {
    let touched = 0;
    const counted = {} as Record<string, never>;
    Object.defineProperty(counted, BOX, {
      enumerable: true,
      get: () => {
        touched++;
        return mesh;
      },
    });
    const empty = values({ edges: [], edges2: [] });
    expect(setDistanceManipulator('radius2', 'edges2', empty, counted)).toBeUndefined();
    expect(touched).toBe(0);
    const one = values({ edges2: [edgeRef(TOP_FRONT_EDGE)] });
    expect(setDistanceManipulator('radius2', 'edges2', one, counted)?.field).toBe('radius2');
    expect(touched).toBeGreaterThan(0);
  });

  it('keeps each set’s own refusals', () => {
    const seam = values({ edges: [{ kind: 'edge', id: 'e[box:top]' }] });
    expect(setDistanceManipulator('radius', 'edges', seam, bodies)).toBeUndefined();
  });
});

describe('a chamfer’s distances along the faces', () => {
  const near = (v: readonly number[] | undefined) => v && unit(v);

  it('runs the first along the lower-numbered face and the second along the other', () => {
    // Top (index 1) is lower-numbered than front (2): the first distance runs
    // across the top away from the front edge, the second down the front.
    const d = faceDirections(bodies, edgeRef(TOP_FRONT_EDGE), undefined, false);
    expect(near(d?.origin)).toEqual([5, 0, 10]);
    expect(near(d?.first)).toEqual([0, 1, 0]);
    expect(near(d?.second)).toEqual([0, 0, -1]);
  });

  it('turns round with Flip, or with the picked reference face', () => {
    const flipped = faceDirections(bodies, edgeRef(TOP_FRONT_EDGE), undefined, true);
    expect(near(flipped?.first)).toEqual([0, 0, -1]);
    expect(near(flipped?.second)).toEqual([0, 1, 0]);
    // A picked face decides, whatever Flip says.
    const picked = faceDirections(bodies, edgeRef(TOP_FRONT_EDGE), faceRef('front'), false);
    expect(near(picked?.first)).toEqual([0, 0, -1]);
    const again = faceDirections(bodies, edgeRef(TOP_FRONT_EDGE), faceRef('front'), true);
    expect(near(again?.first)).toEqual([0, 0, -1]);
  });

  it('is left out for a face that isn’t one of the edge’s, a seam or a missing face', () => {
    expect(faceDirections(bodies, edgeRef(TOP_FRONT_EDGE), faceRef('left'), false)).toBeUndefined();
    expect(
      faceDirections(bodies, { kind: 'edge', id: 'e[box:top|box:gone]' }, undefined, false),
    ).toBeUndefined();
    expect(
      faceDirections(bodies, { kind: 'edge', id: 'e[box:top]' }, undefined, false),
    ).toBeUndefined();
    expect(faceDirections(bodies, undefined, undefined, false)).toBeUndefined();
  });

  const set = (mode: string, over: { flip?: boolean; face?: ReturnType<typeof faceRef> } = {}) =>
    chamferSetManipulators(
      {
        edges: 'edges',
        distance: 'distance',
        distanceB: 'distanceB',
        angle: 'angle',
        mode,
        flip: over.flip ?? false,
        face: over.face,
      },
      values({ edges: [edgeRef(TOP_FRONT_EDGE)] }),
      bodies,
    ).map((m) =>
      m.kind === 'distance'
        ? { field: m.field, direction: unit(m.direction) }
        : { field: m.field, kind: m.kind },
    );

  it('gives equal distances the bisector, two distances both face directions', () => {
    expect(set('equal')).toEqual([{ field: 'distance', direction: half([0, 0, 1], [0, -1, 0]) }]);
    expect(set('two-distances')).toEqual([
      { field: 'distance', direction: [0, 1, 0] },
      { field: 'distanceB', direction: [0, 0, -1] },
    ]);
    // Distance and angle has no second distance; its arc has its own describe below.
    expect(set('distance-angle')).toEqual([
      { field: 'distance', direction: [0, 1, 0] },
      { field: 'angle', kind: 'angle' },
    ]);
    expect(set('two-distances', { face: faceRef('front') })[0]).toEqual({
      field: 'distance',
      direction: [0, 0, -1],
    });
  });

  it('keeps the bisector for Distance where the faces can’t be read', () => {
    const out = chamferSetManipulators(
      {
        edges: 'edges',
        distance: 'distance',
        distanceB: 'distanceB',
        mode: 'two-distances',
        flip: false,
        face: faceRef('left'),
        angle: 'angle',
      },
      values({ edges: [edgeRef(TOP_FRONT_EDGE)] }),
      bodies,
    );
    expect(out.map((m) => m.field)).toEqual(['distance']);
  });
});

describe('a distance-and-angle set’s angle arc', () => {
  const cross = (a: readonly number[], b: readonly number[]) => [
    (a[1] as number) * (b[2] as number) - (a[2] as number) * (b[1] as number),
    (a[2] as number) * (b[0] as number) - (a[0] as number) * (b[2] as number),
    (a[0] as number) * (b[1] as number) - (a[1] as number) * (b[0] as number),
  ];
  const dot = (a: readonly number[], b: readonly number[]) =>
    (a[0] as number) * (b[0] as number) +
    (a[1] as number) * (b[1] as number) +
    (a[2] as number) * (b[2] as number);

  const set = (mode: string, style: Parameters<typeof chamferSetManipulators>[3] = {}) =>
    chamferSetManipulators(
      {
        edges: 'edges',
        distance: 'distance',
        distanceB: 'distanceB',
        angle: 'angle',
        mode,
        flip: false,
        face: undefined,
      },
      values({ edges: [edgeRef(TOP_FRONT_EDGE)] }),
      bodies,
      style,
    );

  it('follows the distance arrow, turning from the reference face towards the other one', () => {
    const out = set('distance-angle');
    expect(out.map((m) => m.kind)).toEqual(['distance', 'angle']);
    const arc = out[1];
    if (arc?.kind !== 'angle') throw new Error('no arc');
    expect(arc.field).toBe('angle');
    expect(round(arc.origin)).toEqual([5, 0, 10]);
    // The zero is the reference face's direction: across the top face, away
    // from the edge (the top face is the lower-numbered one here).
    expect(round(arc.zero)).toEqual([0, 1, 0]);
    // The axis is along the edge (it runs along x), signed so the swing to the
    // other face's direction is positive: a quarter turn reaches it.
    expect(round(arc.axis)).toEqual([-1, 0, 0]);
    const dirs = faceDirections(bodies, edgeRef(TOP_FRONT_EDGE), undefined, false);
    const second = (dirs?.second ?? []) as readonly number[];
    expect(dot(cross(arc.zero, second), arc.axis)).toBeGreaterThan(0);
    expect(round(cross(arc.axis, arc.zero))).toEqual(round(second));
  });

  it('gives a two-distance set both arrows and no arc', () => {
    expect(set('two-distances').map((m) => m.kind)).toEqual(['distance', 'distance']);
  });

  it('carries the style the dialog passes it, the set’s other fields and not itself', () => {
    const out = set('distance-angle', {
      distance: { follows: ['edges', 'mode', 'face', 'flip', 'angle'] },
      angle: { follows: ['edges', 'mode', 'face', 'flip', 'distance'] },
    });
    const arrow = out[0];
    const arc = out[1];
    if (arrow?.kind !== 'distance' || arc?.kind !== 'angle') throw new Error('missing handles');
    expect(arrow.follows).toEqual(['edges', 'mode', 'face', 'flip', 'angle']);
    expect(arc.follows).toEqual(['edges', 'mode', 'face', 'flip', 'distance']);
    expect(arc.follows?.includes('angle')).toBe(false);
  });

  /** The box with its top front edge bent (three polyline points): a curved edge. */
  const bent = (() => {
    const points: number[] = [];
    const ranges: number[] = [];
    let at = 0;
    for (let e = 0; e < 12; e++) {
      const start = mesh.edgeRanges?.[2 * e] ?? 0;
      const count = mesh.edgeRanges?.[2 * e + 1] ?? 0;
      const pt = (i: number): [number, number, number] => [
        mesh.edgePoints?.[3 * i] ?? 0,
        mesh.edgePoints?.[3 * i + 1] ?? 0,
        mesh.edgePoints?.[3 * i + 2] ?? 0,
      ];
      if (e === TOP_FRONT_EDGE) {
        ranges.push(at, 3);
        points.push(0, 0, 10, 5, 0, 12, 10, 0, 10);
        at += 3;
        continue;
      }
      ranges.push(at, count);
      for (let i = start; i < start + count; i++) points.push(...pt(i));
      at += count;
    }
    return { ...mesh, edgePoints: new Float32Array(points), edgeRanges: new Uint32Array(ranges) };
  })();

  it('reads a curved edge too: both directions at the bend, so the arc appears (P4-12 fourth amendment)', () => {
    // The bend's middle is (5, 0, 12); its tangent runs up and along x, so the
    // front wall's direction leans with it but the top's does not.
    const d = faceDirections({ [BOX]: bent }, edgeRef(TOP_FRONT_EDGE), undefined, false);
    expect(round(d?.origin ?? [])).toEqual([5, 0, 12]);
    expect(round(d?.first ?? [])).toEqual([0, 1, 0]);
    expect(round(d?.second ?? [])).toEqual([0.371, 0, -0.928]);
    const out = chamferSetManipulators(
      {
        edges: 'edges',
        distance: 'distance',
        distanceB: 'distanceB',
        angle: 'angle',
        mode: 'distance-angle',
        flip: false,
        face: undefined,
      },
      values({ edges: [edgeRef(TOP_FRONT_EDGE)] }),
      { [BOX]: bent },
    );
    expect(out.map((m) => m.kind)).toEqual(['distance', 'angle']);
    expect(round(out[0]?.kind === 'distance' ? out[0].origin : [])).toEqual([5, 0, 12]);
  });
});

/** A capped cylinder: a wall of `segments` quads, a top-cap fan and a rim edge between them. */
function cappedCylinder(segments = 5): { mesh: BodyMesh; rim: number } {
  const wall = cylinderMesh(10, 20, segments);
  const positions = [...wall.positions];
  const normals = [...wall.normals];
  const indices = [...wall.indices];
  const capStart = wall.faceRanges[1] ?? 0;
  const centre = positions.length / 3;
  positions.push(0, 0, 20);
  normals.push(0, 0, 1);
  const rimNode = (s: number): number => {
    const angle = (2 * Math.PI * s) / segments;
    const node = positions.length / 3;
    positions.push(10 * Math.cos(angle), 10 * Math.sin(angle), 20);
    normals.push(0, 0, 1);
    return node;
  };
  const rim: number[] = [];
  for (let s = 0; s < segments; s++) rim.push(rimNode(s));
  // A fan from the centre, counter-clockwise seen from +z.
  for (let s = 0; s < segments; s++) {
    indices.push(centre, rim[s] as number, rim[(s + 1) % segments] as number);
  }
  const edgePoints: number[] = [];
  for (let s = 0; s <= segments; s++) {
    const angle = (2 * Math.PI * s) / segments;
    edgePoints.push(10 * Math.cos(angle), 10 * Math.sin(angle), 20);
  }
  const mesh: BodyMesh = {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint32Array(indices),
    faceRanges: new Uint32Array([0, segments * 2, capStart, segments]),
    edgePoints: new Float32Array(edgePoints),
    edgeRanges: new Uint32Array([0, segments + 1]),
    edgeFlags: new Uint8Array(1),
    vertices: new Float32Array(0),
    faceIds: ['cyl:wall', 'cyl:cap'],
    edgeIds: ['e[cyl:cap|cyl:wall]'],
  };
  return { mesh, rim: 0 };
}

/** A frustum (bottom radius 10, top radius 5, height 20) with a cap fan and a rim edge. */
function cappedCone(segments = 5): BodyMesh {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const radiusAt = (z: number) => 10 - 0.25 * z;
  const node = (s: number, top: boolean) => {
    const angle = (2 * Math.PI * s) / segments;
    const z = top ? 20 : 0;
    positions.push(radiusAt(z) * Math.cos(angle), radiusAt(z) * Math.sin(angle), z);
    const n = Math.hypot(Math.cos(angle), Math.sin(angle), 0.25);
    normals.push(Math.cos(angle) / n, Math.sin(angle) / n, 0.25 / n);
  };
  for (let s = 0; s < segments; s++) {
    node(s, false);
    node(s, true);
    node(s + 1, false);
    node(s + 1, true);
    const base = 4 * s;
    indices.push(base, base + 2, base + 3, base, base + 3, base + 1);
  }
  const capStart = indices.length / 3;
  const centre = positions.length / 3;
  positions.push(0, 0, 20);
  normals.push(0, 0, 1);
  const rim: number[] = [];
  for (let s = 0; s < segments; s++) {
    const angle = (2 * Math.PI * s) / segments;
    rim.push(positions.length / 3);
    positions.push(5 * Math.cos(angle), 5 * Math.sin(angle), 20);
    normals.push(0, 0, 1);
  }
  for (let s = 0; s < segments; s++) {
    indices.push(centre, rim[s] as number, rim[(s + 1) % segments] as number);
  }
  const edgePoints: number[] = [];
  for (let s = 0; s <= segments; s++) {
    const angle = (2 * Math.PI * s) / segments;
    edgePoints.push(5 * Math.cos(angle), 5 * Math.sin(angle), 20);
  }
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint32Array(indices),
    faceRanges: new Uint32Array([0, segments * 2, capStart, segments]),
    edgePoints: new Float32Array(edgePoints),
    edgeRanges: new Uint32Array([0, segments + 1]),
    edgeFlags: new Uint8Array(1),
    vertices: new Float32Array(0),
    faceIds: ['cone:wall', 'cone:cap'],
    edgeIds: ['e[cone:cap|cone:wall]'],
  };
}

describe('the local face directions read at the edge’s middle (P4-12, fourth amendment)', () => {
  it('gives a box edge the same answers as the whole-edge reading', () => {
    const d = localFaceDirections(mesh, TOP_FRONT_EDGE, 1, 2);
    expect(round(d?.origin ?? [])).toEqual([5, 0, 10]);
    expect(round(d?.first ?? [])).toEqual([0, 1, 0]);
    expect(round(d?.second ?? [])).toEqual([0, 0, -1]);
  });

  it('reads a cylinder’s top rim: across the cap towards the axis, down the wall', () => {
    const { mesh: cylinder } = cappedCylinder(5);
    const d = localFaceDirections(cylinder, 0, 1, 0);
    // The ring’s middle by arc length is the chord midpoint opposite the start.
    expect(round(d?.origin ?? [])).toEqual([-8.09, 0, 20]);
    expect(round(d?.first ?? [])).toEqual([1, 0, 0]);
    expect(round(d?.second ?? [])).toEqual([0, 0, -1]);
  });

  it('reads a cone’s rim: across the cap towards the axis, down the slanted wall', () => {
    const cone = cappedCone(5);
    const d = localFaceDirections(cone, 0, 1, 0);
    expect(round(d?.origin ?? [])).toEqual([-4.045, 0, 20]);
    expect(round(d?.first ?? [])).toEqual([1, 0, 0]);
    expect(round(d?.second ?? [])).toEqual([-0.198, 0, -0.98]);
  });

  it('refuses a seam (one face), a missing face, and a smooth or nearly straight corner', () => {
    // A seam edge: named with one face, so `faceDirections` gives nothing.
    expect(
      faceDirections(bodies, { kind: 'edge', id: 'e[box:top]' }, undefined, false),
    ).toBeUndefined();
    // A face the mesh lacks.
    const { mesh: cylinder } = cappedCylinder(4);
    expect(localFaceDirections(cylinder, 0, 1, 9)).toBeUndefined();
    // Two faces whose normals agree within 60°: a shallow tent, flat enough to
    // run together, so there is no corner.
    const tent: BodyMesh = {
      positions: new Float32Array([0, 0, 0, 10, 0, 0, 5, 5, 1, 5, -5, 1]),
      normals: new Float32Array(12),
      indices: new Uint32Array([0, 1, 2, 0, 3, 1]),
      faceRanges: new Uint32Array([0, 1, 1, 1]),
      edgePoints: new Float32Array([0, 0, 0, 10, 0, 0]),
      edgeRanges: new Uint32Array([0, 2]),
      edgeFlags: new Uint8Array(1),
      vertices: new Float32Array(0),
      faceIds: ['sh:one', 'sh:two'],
      edgeIds: ['e[sh:one|sh:two]'],
    };
    expect(localFaceDirections(tent, 0, 0, 1)).toBeUndefined();
    expect(
      faceDirections({ [BOX]: tent }, { kind: 'edge', id: 'e[sh:one|sh:two]' }, undefined, false),
    ).toBeUndefined();
  });
});
