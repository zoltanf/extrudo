import type { FeatureId, FeatureStatus } from '@extrudo/core';
import { describe, expect, it } from 'vitest';
import {
  GHOST_CIRCLE_SEGMENTS,
  ghostSegments,
  ghostsOf,
  ghostsSummary,
  planeBasis,
} from './ghostGeometry';

type V3 = [number, number, number];
const points = (s: number[]): V3[] => {
  const out: V3[] = [];
  for (let i = 0; i + 2 < s.length; i += 3) out.push(s.slice(i, i + 3) as V3);
  return out;
};
const dist = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

describe('ghostSegments', () => {
  it('draws a plane face as a square of side √area square to its normal', () => {
    const s = ghostSegments({ type: 'plane', at: [1, 2, 3], dir: [0, 0, 1], size: 400 }, 'face');
    expect(s).toHaveLength(4 * 6);
    const p = points(s);
    for (let i = 0; i < p.length; i += 2) {
      expect(dist(p[i] as V3, p[i + 1] as V3)).toBeCloseTo(20, 9);
      expect((p[i] as V3)[2]).toBeCloseTo(3, 9);
    }
    // Centred on `at`.
    const cx = p.filter((_, i) => i % 2 === 0).reduce((a, q) => a + q[0], 0) / 4;
    const cy = p.filter((_, i) => i % 2 === 0).reduce((a, q) => a + q[1], 0) / 4;
    expect([cx, cy]).toEqual([expect.closeTo(1, 9), expect.closeTo(2, 9)]);
  });

  it('draws a curved face as a circle of radius √(area / π)', () => {
    const s = ghostSegments(
      { type: 'cylinder', at: [0, 0, 5], dir: [1, 0, 0], size: Math.PI * 25 },
      'face',
    );
    expect(s).toHaveLength(GHOST_CIRCLE_SEGMENTS * 6);
    for (const q of points(s)) {
      expect(q[0]).toBeCloseTo(0, 9);
      expect(Math.hypot(q[1], q[2] - 5)).toBeCloseTo(5, 9);
    }
  });

  it('draws a line edge as a segment of its length through the midpoint', () => {
    const s = ghostSegments({ type: 'line', at: [0, 0, 10], dir: [0, 1, 0], size: 8 }, 'edge');
    expect(s).toEqual([0, -4, 10, 0, 4, 10]);
  });

  it('draws a circle edge with radius length / 2π', () => {
    const s = ghostSegments(
      { type: 'circle', at: [0, 0, 0], dir: [0, 0, 1], size: 2 * Math.PI * 3 },
      'edge',
    );
    for (const q of points(s)) expect(Math.hypot(q[0], q[1])).toBeCloseTo(3, 9);
  });

  it('draws any other edge as a segment along its direction', () => {
    const s = ghostSegments({ type: 'bspline', at: [1, 1, 1], dir: [1, 0, 0], size: 6 }, 'edge');
    expect(s).toEqual([-2, 1, 1, 4, 1, 1]);
  });

  it('draws a vertex as a cross of the given length', () => {
    const s = ghostSegments({ type: 'point', at: [1, 2, 3] }, 'vertex', 0.4);
    expect(s).toEqual([0.8, 2, 3, 1.2, 2, 3, 1, 1.8, 3, 1, 2.2, 3, 1, 2, 2.8, 1, 2, 3.2]);
  });

  it('marks a place with a cross when the fingerprint has no size', () => {
    expect(ghostSegments({ type: 'plane', at: [0, 0, 0] }, 'face', 2)).toHaveLength(18);
  });

  it('gives orthonormal axes', () => {
    const [u, v] = planeBasis([0, 0, 1]);
    expect(u[0] * v[0] + u[1] * v[1] + u[2] * v[2]).toBeCloseTo(0, 12);
    expect(planeBasis([1, 0, 0])).toHaveLength(2);
  });
});

describe('ghostsOf', () => {
  const fingerprint = { type: 'line', at: [1, 2, 3] as [number, number, number], size: 4 };
  const features = [
    {
      id: 'F1' as FeatureId,
      name: 'Fillet 1',
      inputs: { edges: { kind: 'ref', refs: [{ kind: 'edge', id: 'e[a|b]', fingerprint }] } },
    },
    { id: 'F2' as FeatureId, name: 'Other', inputs: {} },
  ] as never;
  const statuses: Record<string, FeatureStatus> = {
    F1: {
      status: 'warning',
      refs: [
        { ref: { kind: 'edge', id: 'e[a|b]' }, state: 'lost' },
        { ref: { kind: 'face', id: 'no-fingerprint' }, state: 'lost' },
      ],
    },
  };

  it('reads the fingerprint stored with the reference, only for the features asked for', () => {
    const ghosts = ghostsOf(features, statuses, ['F1', 'F1', 'F2']);
    expect(ghosts).toHaveLength(1);
    expect(ghosts[0]).toMatchObject({ feature: 'F1', kind: 'edge', type: 'line', state: 'lost' });
    expect(ghostsOf(features, statuses, [])).toEqual([]);
  });

  it('summarises as feature:type:x,y,z', () => {
    expect(ghostsSummary(ghostsOf(features, statuses, ['F1']))).toBe('F1:line:1,2,3');
    expect(ghostsSummary([])).toBeUndefined();
  });
});
