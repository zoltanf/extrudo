import type { BodyMesh } from '@extrudo/kernel';
import { describe, expect, it } from 'vitest';
import { boundsOf, edgeSegments } from './Bodies';

const mesh = (
  positions: number[],
  edgePoints: number[] = [],
  edgeRanges: number[] = [],
): BodyMesh => ({
  positions: new Float32Array(positions),
  normals: new Float32Array(positions.length),
  indices: new Uint32Array(),
  faceRanges: new Uint32Array(),
  edgePoints: new Float32Array(edgePoints),
  edgeRanges: new Uint32Array(edgeRanges),
  vertices: new Float32Array(),
});

describe('edgeSegments', () => {
  it('turns polylines into segment pairs and skips degenerate edges', () => {
    const m = mesh(
      [],
      // Edge 0: three points; edge 1: degenerate; edge 2: two points.
      [0, 0, 0, 1, 0, 0, 1, 1, 0, 5, 5, 5, 6, 6, 6],
      [0, 3, 3, 0, 3, 2],
    );
    expect([...edgeSegments(m)]).toEqual([0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 1, 0, 5, 5, 5, 6, 6, 6]);
  });
});

describe('boundsOf', () => {
  it('is the bounding sphere of every body, or undefined when there are none', () => {
    expect(boundsOf([])).toBeUndefined();
    expect(boundsOf([mesh([])])).toBeUndefined();
    const b = boundsOf([mesh([0, 0, 0, 2, 0, 0]), mesh([0, 2, 0, 2, 2, 2])]);
    expect(b?.center).toEqual([1, 1, 1]);
    expect(b?.radius).toBeCloseTo(Math.sqrt(3), 9);
  });
});
