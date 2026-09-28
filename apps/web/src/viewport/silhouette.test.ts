import type { BodyMesh } from '@extrudo/kernel';
import { describe, expect, it } from 'vitest';
import { curvedFaces, silhouetteCapacity, silhouetteSegments } from './silhouette';

/**
 * A cylinder of radius 5 around the z axis, 10 tall: face 0 its side
 * (smooth normals, `n` segments, rotated by `phase`), face 1 its flat top.
 */
function cylinder(n = 36, phase = 0.1): BodyMesh {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = phase + (2 * Math.PI * i) / n;
    const [c, s] = [Math.cos(a), Math.sin(a)];
    positions.push(5 * c, 5 * s, 0, 5 * c, 5 * s, 10);
    normals.push(c, s, 0, c, s, 0);
  }
  for (let i = 0; i < n; i++) {
    const [a, b] = [2 * i, 2 * ((i + 1) % n)];
    indices.push(a, b, b + 1, a, b + 1, a + 1);
  }
  const top = positions.length / 3;
  for (let i = 0; i < n; i++) {
    const a = phase + (2 * Math.PI * i) / n;
    positions.push(5 * Math.cos(a), 5 * Math.sin(a), 10);
    normals.push(0, 0, 1);
  }
  for (let i = 1; i + 1 < n; i++) indices.push(top, top + i, top + i + 1);
  return {
    positions: Float32Array.from(positions),
    normals: Float32Array.from(normals),
    indices: Uint32Array.from(indices),
    faceRanges: Uint32Array.from([0, 2 * n, 2 * n, n - 2]),
    edgePoints: new Float32Array(),
    edgeRanges: new Uint32Array(),
    edgeFlags: new Uint8Array(),
    vertices: new Float32Array(),
  };
}

function points(out: Float32Array, count: number): [number, number, number][] {
  const list: [number, number, number][] = [];
  for (let i = 0; i < count; i += 3) list.push([out[i] ?? 0, out[i + 1] ?? 0, out[i + 2] ?? 0]);
  return list;
}

describe('silhouettes of curved faces', () => {
  const mesh = cylinder();
  const curved = curvedFaces(mesh);

  it('finds the curved faces only', () => {
    expect([...curved]).toEqual([0, 72]);
    expect(silhouetteCapacity(curved)).toBe(72 * 6);
  });

  it('orthographic: two lines along the axis where the side turns away', () => {
    const out = new Float32Array(silhouetteCapacity(curved));
    const count = silhouetteSegments(mesh, curved, { direction: [-1, 0, 0] }, out);
    // Two quads (four triangles) straddle each side: one segment each.
    expect(count).toBe(4 * 6);
    const found = points(out, count);
    for (const [x, y] of found) {
      expect(Math.abs(x)).toBeLessThan(0.1);
      expect(Math.abs(Math.abs(y) - 5)).toBeLessThan(0.05);
    }
    const zs = found.map(([, , z]) => z);
    expect(Math.min(...zs)).toBeCloseTo(0);
    expect(Math.max(...zs)).toBeCloseTo(10);
    expect(new Set(found.map(([, y]) => Math.sign(y)))).toEqual(new Set([-1, 1]));
  });

  it('perspective: the outline moves towards the eye as it comes closer', () => {
    const out = new Float32Array(silhouetteCapacity(curved));
    const count = silhouetteSegments(mesh, curved, { eye: [10, 0, 5] }, out);
    expect(count).toBeGreaterThan(0);
    // Tangent points from 10 mm away: x = r² / 10 = 2.5.
    for (const [x, y] of points(out, count)) {
      expect(x).toBeGreaterThan(2.3);
      expect(x).toBeLessThan(2.7);
      expect(Math.hypot(x, y)).toBeCloseTo(5, 0);
    }
  });

  it('looking down the axis: no outline on the side', () => {
    const out = new Float32Array(silhouetteCapacity(curved));
    expect(silhouetteSegments(mesh, curved, { direction: [0, 0, -1] }, out)).toBe(0);
  });
});
