import { describe, expect, it } from 'vitest';
import {
  chainEnds,
  chamferSetManipulators,
  type EdgeHandle,
  edgeHandle,
  faceDirections,
  setDistanceManipulator,
  variableSetManipulators,
} from './edgeHandles';
import type { DialogValues } from './spec';
import { BOX, namedBoxEdgesMesh, namedBoxMesh } from './testing';

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

  it('is left out for a face that isn’t one of the edge’s, a curved edge or a missing face', () => {
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

  it('keeps the single bisector on a curved edge: no pair, no arc', () => {
    expect(
      faceDirections({ [BOX]: bent }, edgeRef(TOP_FRONT_EDGE), undefined, false),
    ).toBeUndefined();
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
    expect(out).toHaveLength(1);
    const only = out[0];
    if (only?.kind !== 'distance') throw new Error('no bisector');
    // The handle stands on the bend's middle, on the bisector of the two faces.
    expect(round(only.origin)).toEqual([5, 0, 12]);
    expect(round(only.direction)).toEqual(half([0, 0, 1], [0, -1, 0]));
  });
});
