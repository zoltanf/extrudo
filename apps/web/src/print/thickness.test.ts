/**
 * Wall-thickness measurement (P5-06, ADR-0072): rays on hand-made indexed meshes against a
 * real three-mesh-bvh, as the display meshes are measured in the app.
 */
import type { BodyId } from '@extrudo/core';
import type { BodyMesh } from '@extrudo/kernel';
import { BufferAttribute, BufferGeometry } from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { describe, expect, it } from 'vitest';
import { boxMesh } from '../selection/testing';
import {
  cachedThickness,
  classifyThickness,
  defaultMinimum,
  measureThickness,
  measureTriangles,
  rememberThickness,
  type ThicknessState,
  thicknessRays,
  thicknessReport,
  thicknessSummary,
  thinAttribute,
  triangleAreas,
  triangleCount,
} from './thickness';

/** The BVH the app shares with picking (built once per mesh, `{ indirect: true }`). */
function bvhOf(mesh: BodyMesh): MeshBVH {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(mesh.positions, 3));
  geometry.setIndex(new BufferAttribute(mesh.indices, 1));
  return new MeshBVH(geometry, { indirect: true });
}

const body = (id: string) => id as BodyId;

/** Joins meshes into one (nodes per face stay separate, as the kernel's display mesh has them). */
function join(...meshes: BodyMesh[]): BodyMesh {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const faceRanges: number[] = [];
  let nodes = 0;
  let triangles = 0;
  for (const mesh of meshes) {
    positions.push(...mesh.positions);
    normals.push(...mesh.normals);
    for (const i of mesh.indices) indices.push(i + nodes);
    for (let f = 0; f < mesh.faceRanges.length >> 1; f++) {
      faceRanges.push(
        (mesh.faceRanges[2 * f] as number) + triangles,
        mesh.faceRanges[2 * f + 1] as number,
      );
    }
    nodes += mesh.positions.length / 3;
    triangles += mesh.indices.length / 3;
  }
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint32Array(indices),
    faceRanges: new Uint32Array(faceRanges),
    edgePoints: new Float32Array(),
    edgeRanges: new Uint32Array(),
    edgeFlags: new Uint8Array(),
    vertices: new Float32Array(),
  };
}

/** The same solid, wound the other way round: its normals point the other way. */
function reversed(mesh: BodyMesh): BodyMesh {
  const indices = new Uint32Array(mesh.indices);
  for (let t = 0; t < indices.length; t += 3) {
    const swap = indices[t + 1] as number;
    indices[t + 1] = indices[t + 2] as number;
    indices[t + 2] = swap;
  }
  const normals = new Float32Array(mesh.normals);
  for (let i = 0; i < normals.length; i++) normals[i] = -(normals[i] as number);
  return { ...mesh, indices, normals };
}

/** The mesh with one face's triangles left out (a cube with a hole). */
function withoutFace(mesh: BodyMesh, face: number): BodyMesh {
  const first = mesh.faceRanges[2 * face] as number;
  const count = mesh.faceRanges[2 * face + 1] as number;
  const indices: number[] = [];
  for (let t = 0; t < mesh.indices.length / 3; t++) {
    if (t >= first && t < first + count) continue;
    indices.push(
      mesh.indices[3 * t] as number,
      mesh.indices[3 * t + 1] as number,
      mesh.indices[3 * t + 2] as number,
    );
  }
  return { ...mesh, indices: new Uint32Array(indices) };
}

/**
 * A right wedge: the cross-section (0, 0) → (length, 0) → (length, height) in XZ, extruded
 * `width` along Y, its bottom split into `columns` strips so the thickness can grow along it.
 */
function wedge(length = 10, height = 5, width = 10, columns = 5): BodyMesh {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const faceRanges: number[] = [];
  const quad = (
    a: readonly [number, number, number],
    b: readonly [number, number, number],
    c: readonly [number, number, number],
    d: readonly [number, number, number],
    normal: readonly [number, number, number],
  ) => {
    const base = positions.length / 3;
    for (const p of [a, b, c, d]) {
      positions.push(...p);
      normals.push(...normal);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    const at = faceRanges.length > 0 ? (faceRanges[faceRanges.length - 2] as number) + 2 : 0;
    faceRanges.push(at, 2);
  };
  // The bottom, face up at z = 0 (its outward normal is −Z), one strip per column.
  const dx = length / columns;
  for (let i = 0; i < columns; i++) {
    const x0 = i * dx;
    const x1 = x0 + dx;
    quad([x0, 0, 0], [x0, width, 0], [x1, width, 0], [x1, 0, 0], [0, 0, -1]);
  }
  // The slope (0, 0) → (length, height), and the tall end at x = length.
  const slope = Math.hypot(length, height);
  quad(
    [0, 0, 0],
    [length, 0, height],
    [length, width, height],
    [0, width, 0],
    [-height / slope, 0, length / slope],
  );
  quad([length, 0, 0], [length, width, 0], [length, width, height], [length, 0, height], [1, 0, 0]);
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint32Array(indices),
    faceRanges: new Uint32Array(faceRanges),
    edgePoints: new Float32Array(),
    edgeRanges: new Uint32Array(),
    edgeFlags: new Uint8Array(),
    vertices: new Float32Array(),
  };
}

const values = (mesh: BodyMesh) => measureThickness(mesh, bvhOf(mesh));
const list = (a: Float32Array) => [...a].map((x) => Number(x.toFixed(3)));

describe('measuring a wall by ray (ADR-0072 §1)', () => {
  it('a 20 mm cube is 20 everywhere', () => {
    const mesh = boxMesh([0, 0, 0], [20, 20, 20]);
    const measured = values(mesh);
    expect(measured).toHaveLength(12);
    for (const value of measured) expect(value).toBeCloseTo(20, 3);
  });

  it('a 40 × 40 × 1 mm plate: the large faces 1, the edge faces 40', () => {
    const mesh = boxMesh([0, 0, 0], [40, 40, 1]);
    const measured = values(mesh);
    // boxMesh's faces are −Z, +Z, −Y, +Y, −X, +X, two triangles each.
    expect(list(measured)).toEqual([1, 1, 1, 1, ...Array(8).fill(40)]);
  });

  it('a hollow box with 2 mm walls is 2 everywhere on them', () => {
    const outer = boxMesh([0, 0, 0], [20, 20, 20]);
    const inner = reversed(boxMesh([2, 2, 2], [18, 18, 18]));
    const mesh = join(outer, inner);
    const measured = values(mesh);
    expect(measured).toHaveLength(24);
    for (const value of measured) expect(value).toBeCloseTo(2, 3);
  });

  it('a wedge is between 0 and its height on the bottom, thicker away from the edge', () => {
    const height = 5;
    const mesh = wedge(10, height, 10, 5);
    const measured = values(mesh).slice(0, 10);
    // The bottom's ten triangles: 0 < thickness < height, strictly growing along x.
    for (let i = 0; i < measured.length; i++) {
      const value = measured[i] as number;
      expect(value).toBeGreaterThan(0);
      expect(value).toBeLessThan(height);
      if (i > 0) expect(value).toBeGreaterThan(measured[i - 1] as number);
    }
    // The thick end approaches the height (its strip's centroid is a third in from it).
    expect(measured[9]).toBeGreaterThan(height * 0.8);
  });

  it('an open mesh: the rays that leave through the hole hit nothing and are not thin', () => {
    const mesh = withoutFace(boxMesh([0, 0, 0], [20, 20, 20]), 1);
    const measured = values(mesh);
    expect(measured).toHaveLength(10);
    // The bottom shoots up through the missing top face; the sides still hit each other.
    expect(Number.isNaN(measured[0] as number)).toBe(true);
    expect(Number.isNaN(measured[1] as number)).toBe(true);
    for (const value of measured.slice(2)) expect(value).toBeCloseTo(20, 3);
    const areas = triangleAreas(mesh);
    const report = classifyThickness(measured, areas, 100);
    expect(report.thin).toBe(8);
    expect(report.thinnest?.value).toBeCloseTo(20, 3);
  });
});

describe('classifying (ADR-0072 §1)', () => {
  it('counts the thin triangles, their area and the thinnest measured one', () => {
    const result = classifyThickness(
      Float32Array.from([1, 2, NaN, 0.5]),
      Float32Array.from([10, 20, 30, 5]),
      1.5,
    );
    expect(result.thin).toBe(2);
    expect(result.area).toBe(15);
    expect(result.thinnest).toEqual({ value: 0.5, triangle: 3 });
    // A wall exactly at the minimum is not thin.
    expect(classifyThickness(Float32Array.from([1.5]), Float32Array.from([1]), 1.5).thin).toBe(0);
  });

  it('a report counts the bodies with thin walls and marks the thinnest spot', () => {
    const thick = boxMesh([0, 0, 0], [20, 20, 20]);
    const thin = boxMesh([30, 0, 0], [40, 40, 1]);
    const report = thicknessReport(
      [
        { id: body('a'), mesh: thick, values: values(thick) },
        { id: body('b'), mesh: thin, values: values(thin) },
      ],
      5,
    );
    expect(report.measured).toBe(2);
    expect(report.thinBodies).toBe(1);
    expect(report.thin).toBe(4);
    expect(report.thinnest?.body).toBe('b');
    expect(report.thinnest?.value).toBeCloseTo(1, 3);
    // The first thin triangle of the plate's −Z face: its centroid is on z = 0.
    expect(report.thinnest?.triangle).toBe(0);
    expect(report.thinnest?.point[2]).toBeCloseTo(0, 3);
    expect(report.thinnest?.point[0]).toBeGreaterThan(30);
    expect(report.thinnest?.point[0]).toBeLessThan(40);
  });

  it('the thin flags reach the nodes of the thin triangles', () => {
    const mesh = boxMesh([0, 0, 0], [40, 40, 1]);
    const flags = thinAttribute(mesh, values(mesh), 5);
    // The plate's two large faces (8 nodes each) are thin; the edge faces' nodes are not.
    expect(list(flags)).toEqual([...Array(8).fill(1), ...Array(16).fill(0)]);
  });
});

describe('the cache (ADR-0072 §1)', () => {
  it('a second call with the same mesh casts no rays', () => {
    const mesh = boxMesh([0, 0, 0], [20, 20, 20]);
    const bvh = bvhOf(mesh);
    const before = thicknessRays();
    const first = measureThickness(mesh, bvh);
    const after = thicknessRays();
    expect(after).toBeGreaterThan(before);
    expect(cachedThickness(mesh)).toBe(first);
    const second = measureThickness(mesh, bvh);
    expect(second).toBe(first);
    expect(thicknessRays()).toBe(after);
    // A chunked run fills and remembers the same way.
    const out = new Float32Array(triangleCount(mesh)).fill(NaN);
    measureTriangles(mesh, bvh, out, 0, out.length);
    rememberThickness(mesh, out);
    expect(measureThickness(mesh, bvh)).toBe(out);
  });
});

describe('the summary and the default (ADR-0072 §2, §3)', () => {
  const state: ThicknessState = { min: '0.9 mm', on: true };
  const report = thicknessReport(
    (() => {
      const mesh = boxMesh([0, 0, 0], [40, 40, 1]);
      return [{ id: body('a'), mesh, values: values(mesh) }];
    })(),
    1.5,
  );

  it('reads as the Viewport region’s data-thickness', () => {
    expect(thicknessSummary(state, 1.5, report)).toBe(
      'min=1.5 thin=4 area=3200 thinnest=1 bodies=1',
    );
    expect(thicknessSummary(state, 1.5, report, true)).toBe('min=1.5 pending');
    expect(thicknessSummary({ ...state, on: false }, 1.5, report)).toBe('min=1.5 off');
    expect(thicknessSummary(state, undefined, undefined)).toBe('min=? off');
    const clean = thicknessReport([], 1);
    expect(thicknessSummary(state, 0.9, clean)).toBe(
      'min=0.9 thin=0 area=0 thinnest=none bodies=0',
    );
  });

  it('the default minimum is two line widths of the print material', () => {
    expect(defaultMinimum(0.45)).toBe('0.9 mm');
    expect(defaultMinimum(0.4)).toBe('0.8 mm');
  });
});

// P5-06 (NFR-01): what measuring costs, on a dense mesh like a mesh import brings.
// `BENCH=1 pnpm vitest run apps/web/src/print/thickness.test.ts` prints it.
const BENCH = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env
  .BENCH;

/** A unit cube whose faces are `n` × `n` grids: `6 × 2n²` triangles, wound outwards. */
function gridCube(n: number): BodyMesh {
  // Each face steps `u` then `v`; the triangles wind with `v × u`, which is the outward normal.
  const faces: {
    origin: [number, number, number];
    u: [number, number, number];
    v: [number, number, number];
    normal: [number, number, number];
  }[] = [
    { origin: [0, 0, 0], u: [1, 0, 0], v: [0, 1, 0], normal: [0, 0, -1] },
    { origin: [0, 1, 1], u: [1, 0, 0], v: [0, -1, 0], normal: [0, 0, 1] },
    { origin: [0, 0, 1], u: [1, 0, 0], v: [0, 0, -1], normal: [0, -1, 0] },
    { origin: [0, 1, 0], u: [1, 0, 0], v: [0, 0, 1], normal: [0, 1, 0] },
    { origin: [0, 0, 0], u: [0, 1, 0], v: [0, 0, 1], normal: [-1, 0, 0] },
    { origin: [1, 0, 1], u: [0, 1, 0], v: [0, 0, -1], normal: [1, 0, 0] },
  ];
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  for (const { origin, u, v, normal } of faces) {
    const base = positions.length / 3;
    for (let j = 0; j <= n; j++) {
      for (let i = 0; i <= n; i++) {
        positions.push(
          origin[0] + ((i / n) * u[0] + (j / n) * v[0]),
          origin[1] + ((i / n) * u[1] + (j / n) * v[1]),
          origin[2] + ((i / n) * u[2] + (j / n) * v[2]),
        );
        normals.push(...normal);
      }
    }
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const a = base + j * (n + 1) + i;
        const b = a + 1;
        const c = a + n + 1;
        const d = c + 1;
        indices.push(a, c, d, a, d, b);
      }
    }
  }
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint32Array(indices),
    faceRanges: new Uint32Array([0, indices.length / 3]),
    edgePoints: new Float32Array(),
    edgeRanges: new Uint32Array(),
    edgeFlags: new Uint8Array(),
    vertices: new Float32Array(),
  };
}

describe('measurement cost (P5-06)', () => {
  it('a 100,000-triangle mesh measures in one go', { timeout: 60_000 }, () => {
    const mesh = gridCube(91); // 6 × 2 × 91² = 99,372 triangles
    const triangles = triangleCount(mesh);
    expect(triangles).toBeGreaterThan(99_000);
    const bvhStart = performance.now();
    const bvh = bvhOf(mesh);
    const bvhMs = performance.now() - bvhStart;
    const start = performance.now();
    const measured = measureThickness(mesh, bvh);
    const ms = performance.now() - start;
    expect(measured).toHaveLength(triangles);
    // A unit cube is 1 mm thick everywhere (and the windings are outward).
    for (let t = 0; t < triangles; t += 97) expect(measured[t] as number).toBeCloseTo(1, 3);
    if (BENCH)
      expect
        .soft({
          triangles,
          bvhMs: Number(bvhMs.toFixed(1)),
          measureMs: Number(ms.toFixed(1)),
          raysPerSecond: Math.round(triangles / (ms / 1000)),
        })
        .toBeUndefined();
    expect(ms).toBeLessThan(BENCH ? 1e9 : 20_000);
  });
});
