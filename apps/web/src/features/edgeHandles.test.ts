import { describe, expect, it } from 'vitest';
import { type EdgeHandle, edgeHandle, setDistanceManipulator } from './edgeHandles';
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
