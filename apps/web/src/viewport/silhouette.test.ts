import type { BodyMesh } from '@extrudo/kernel';
import { describe, expect, it } from 'vitest';
import {
  curvedFaces,
  type SilhouetteView,
  silhouetteCapacity,
  silhouettePlan,
  silhouetteSegments,
} from './silhouette';

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
  const plan = silhouettePlan(mesh, curved);

  it('finds the curved faces only', () => {
    expect([...curved]).toEqual([0, 72]);
    expect(silhouetteCapacity(curved)).toBe(72 * 6);
  });

  it('orthographic: two lines along the axis where the side turns away', () => {
    const out = new Float32Array(silhouetteCapacity(curved));
    const count = silhouetteSegments(mesh, plan, { direction: [-1, 0, 0] }, out);
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
    const count = silhouetteSegments(mesh, plan, { eye: [10, 0, 5] }, out);
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
    expect(silhouetteSegments(mesh, plan, { direction: [0, 0, -1] }, out)).toBe(0);
  });

  it('a hair off the axis: still no outline, the side is edge-on', () => {
    const out = new Float32Array(silhouetteCapacity(curved));
    // What the wall bracket's Top view is: the camera a millionth of a degree
    // off the axis used to bring the whole side's outline in and out.
    expect(silhouetteSegments(mesh, plan, { direction: [1e-9, 0, -1] }, out)).toBe(0);
    expect(silhouetteSegments(mesh, plan, { direction: [0, -1e-9, -1] }, out)).toBe(0);
    // A real angle still has its outline.
    expect(silhouetteSegments(mesh, plan, { direction: [0.05, 0, -1] }, out)).toBeGreaterThan(0);
  });

  it('exactly side-on: the two outline lines, on a line of edge-on nodes', () => {
    // A cylinder of 8 sides has nodes at the turn's quarter points, so its
    // outline in a view down -Y runs along a line of nodes whose facing value
    // is zero to within float noise. Those count as facing (EDGE_ON), or every
    // triangle there is "all facing" and the outline vanishes.
    const side = cylinder(8, 0);
    const sideCurved = curvedFaces(side);
    const sidePlan = silhouettePlan(side, sideCurved);
    const out = new Float32Array(silhouetteCapacity(sideCurved));
    const count = silhouetteSegments(side, sidePlan, { direction: [0, -1, 0] }, out);
    expect(count % 6).toBe(0);
    expect(count).toBeGreaterThan(0);
    const found = points(out, count);
    // Every point is on one of the two tangent lines, x = ±r, and between them
    // they run the whole height.
    for (const [x] of found) expect(Math.abs(Math.abs(x) - 5)).toBeLessThan(1e-4);
    expect(new Set(found.map(([x]) => Math.sign(x)))).toEqual(new Set([-1, 1]));
    const zs = found.map(([, , z]) => z);
    expect(Math.min(...zs)).toBeCloseTo(0, 4);
    expect(Math.max(...zs)).toBeCloseTo(10, 4);
    // Both lines, and nothing else: two quads straddle each one.
    expect(count / 6).toBe(4);
  });
});

/**
 * A fillet's tangent line against a wall, as the Wall bracket's meshes it: two
 * nodes whose smooth normal is exactly horizontal (edge-on from the Top view, to
 * within float noise) and, a row in, nodes tilted 8° `tilt` above or below the
 * horizontal. The wall bracket has one of each, and which one a Top view draws
 * used to depend on the sign of ~1e-17 of float noise in those normals.
 */
function tangentLine(tilt: number): BodyMesh {
  const positions = [0, -40, 3.6, 0, 40, 3.6, 0.04, 40, 3.09, 0.04, -40, 3.09];
  const flat = Math.sqrt(1 - tilt * tilt);
  const normals = [-1, 0, 0, -1, 0, 0, -flat, 0, tilt, -flat, 0, tilt];
  return {
    positions: Float32Array.from(positions),
    normals: Float32Array.from(normals),
    indices: Uint32Array.from([0, 1, 2, 0, 2, 3]),
    faceRanges: Uint32Array.from([0, 6]),
    edgePoints: new Float32Array(),
    edgeRanges: new Uint32Array(),
    edgeFlags: new Uint8Array(),
    vertices: new Float32Array(),
  };
}

describe('an edge-on tangent line', () => {
  it('tilted towards the camera: nothing from the Top view, however far off the axis', () => {
    const mesh = tangentLine(0.142);
    const curved = curvedFaces(mesh);
    const plan = silhouettePlan(mesh, curved);
    const out = new Float32Array(silhouetteCapacity(curved));
    for (const direction of [
      [0, 0, -1],
      [1e-12, 0, -1],
      [-1e-9, 0, -1],
      [0, 1e-9, -1],
      [1e-6, -1e-6, -1],
    ] as [number, number, number][]) {
      expect(silhouetteSegments(mesh, plan, { direction }, out)).toBe(0);
    }
    // Turned far enough the other way the tangent line is a real outline: one
    // segment per triangle.
    expect(silhouetteSegments(mesh, plan, { direction: [-0.1, 0, -1] }, out)).toBe(2 * 6);
  });

  it('tilted away from it: the same count from the Top view, however far off the axis', () => {
    const mesh = tangentLine(-0.142);
    const curved = curvedFaces(mesh);
    const plan = silhouettePlan(mesh, curved);
    const out = new Float32Array(silhouetteCapacity(curved));
    // The tangent line is where the wall turns away, so this is an outline: one
    // segment per triangle, and the same whether the camera is exactly on the
    // axis or a millionth of a degree off it (it was 0 on the axis before,
    // because the tangent nodes' normals came out with the sign of the noise).
    for (const direction of [
      [0, 0, -1],
      [1e-12, 0, -1],
      [-1e-9, 0, -1],
      [0, 1e-9, -1],
      [1e-6, -1e-6, -1],
    ] as [number, number, number][]) {
      expect(silhouetteSegments(mesh, plan, { direction }, out)).toBe(2 * 6);
    }
  });

  it('every view of a mesh with edge-on nodes writes whole segments', () => {
    // Two sides per node and a crossing on every edge whose two nodes differ:
    // a triangle that straddles the contour contributes two points, so `out` is
    // never left half a segment in. 200 seeded views over both tangent lines
    // and a cylinder.
    const meshes = [tangentLine(0.142), tangentLine(-0.142), cylinder(8, 0), cylinder(36, 0.1)];
    const views: SilhouetteView[] = [];
    // A small LCG, so a failure is reproducible.
    let seed = 20261004;
    const next = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (let i = 0; i < 200; i++) {
      const a = next() * 2 - 1;
      const b = next() * 2 - 1;
      const c = next() * 2 - 1;
      const d = next() * 2 - 1;
      const e = next() * 2 - 1;
      const g = next() * 2 - 1;
      views.push(
        next() < 0.5
          ? { direction: [a, b, c] }
          : { eye: [a * 200, b * 200, c * 200 + (d < 0 ? -20 : 20)] },
      );
      // Views along the axes and the mesh's own diagonals too: the ones where a
      // node's facing value is exactly (or nearly) zero.
      views.push({ direction: [e, g, 0] }, { direction: [0, e, g] }, { eye: [0, 0, e * 30] });
    }
    for (const mesh of meshes) {
      const curved = curvedFaces(mesh);
      const plan = silhouettePlan(mesh, curved);
      const out = new Float32Array(silhouetteCapacity(curved));
      for (const view of views) {
        const count = silhouetteSegments(mesh, plan, view, out);
        expect(count % 6).toBe(0);
        expect(count).toBeLessThanOrEqual(silhouetteCapacity(curved));
      }
    }
  });
});

/** A torus of `rings` × `sides` quads (two triangles each), smooth normals: one curved face. */
function torus(rings: number, sides: number, R = 40, r = 10): BodyMesh {
  const positions = new Float32Array(rings * sides * 3);
  const normals = new Float32Array(rings * sides * 3);
  for (let i = 0; i < rings; i++) {
    const u = (2 * Math.PI * i) / rings;
    for (let j = 0; j < sides; j++) {
      const v = (2 * Math.PI * j) / sides;
      const k = (i * sides + j) * 3;
      const [nx, ny, nz] = [Math.cos(u) * Math.cos(v), Math.sin(u) * Math.cos(v), Math.sin(v)];
      normals.set([nx, ny, nz], k);
      positions.set([R * Math.cos(u) + r * nx, R * Math.sin(u) + r * ny, r * nz], k);
    }
  }
  const indices = new Uint32Array(rings * sides * 6);
  let o = 0;
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < sides; j++) {
      const a = i * sides + j;
      const b = ((i + 1) % rings) * sides + j;
      const c = ((i + 1) % rings) * sides + ((j + 1) % sides);
      const d = i * sides + ((j + 1) % sides);
      indices.set([a, b, c, a, c, d], o);
      o += 6;
    }
  }
  return {
    positions,
    normals,
    indices,
    faceRanges: Uint32Array.from([0, rings * sides * 2]),
    edgePoints: new Float32Array(),
    edgeRanges: new Uint32Array(),
    edgeFlags: new Uint8Array(),
    vertices: new Float32Array(),
  };
}

// P3-13 (NFR-01): the cost of one silhouette pass on a big curved mesh, the
// work the view does per frame of a camera move in the line styles.
// `BENCH=1 pnpm vitest run apps/web/src/viewport/silhouette.test.ts` prints it.
const BENCH = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env
  .BENCH;

describe('silhouette cost (P3-13)', () => {
  it('stays within a frame for a million triangles', { timeout: 60_000 }, () => {
    const mesh = torus(1000, 500);
    const curved = curvedFaces(mesh);
    const plan = silhouettePlan(mesh, curved);
    const out = new Float32Array(silhouetteCapacity(curved));
    const views: SilhouetteView[] = [{ eye: [150, -200, 120] }, { direction: [-0.3, 0.8, -0.5] }];
    const times: number[] = [];
    for (let run = 0; run < (BENCH ? 40 : 6); run++) {
      const view = views[run % 2] as SilhouetteView;
      const start = performance.now();
      const count = silhouetteSegments(mesh, plan, view, out);
      times.push(performance.now() - start);
      expect(count).toBeGreaterThan(0);
    }
    const warm = times.slice(2).sort((a, b) => a - b);
    const median = warm[Math.floor(warm.length / 2)] ?? 0;
    if (BENCH) expect.soft({ triangles: mesh.indices.length / 3, median }).toBeUndefined();
    expect(median).toBeLessThan(BENCH ? 1e9 : 200);
  });
});
