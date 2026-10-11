import { describe, expect, it } from 'vitest';
import { HALO_SHELLS, smoothNormals } from './ghostHalo';

describe('the ghost halo (R3-06)', () => {
  it('averages the normals of nodes at one position, so the shells do not crack at corners', () => {
    // A cube corner as the display mesh has it: three nodes at (1, 1, 1), one per face.
    const positions = new Float32Array([1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0]);
    const normals = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, -1]);
    const out = smoothNormals(positions, normals);
    const d = 1 / Math.sqrt(3);
    for (let i = 0; i < 3; i++) {
      expect(out[i * 3]).toBeCloseTo(d);
      expect(out[i * 3 + 1]).toBeCloseTo(d);
      expect(out[i * 3 + 2]).toBeCloseTo(d);
    }
    // A node alone keeps its own normal.
    expect([...out.slice(9)]).toEqual([0, 0, -1]);
  });

  it('keeps a node’s own normal where opposite normals cancel (a sheet from both sides)', () => {
    const positions = new Float32Array([0, 0, 0, 0, 0, 0]);
    const normals = new Float32Array([0, 0, 1, 0, 0, -1]);
    expect([...smoothNormals(positions, normals)]).toEqual([0, 0, 1, 0, 0, -1]);
  });

  it('fades outwards: each shell reaches further and is fainter', () => {
    for (let i = 1; i < HALO_SHELLS.length; i++) {
      expect(HALO_SHELLS[i]?.width).toBeGreaterThan(HALO_SHELLS[i - 1]?.width ?? 0);
      expect(HALO_SHELLS[i]?.opacity).toBeLessThan(HALO_SHELLS[i - 1]?.opacity ?? 1);
    }
  });
});
