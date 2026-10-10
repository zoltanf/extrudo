/**
 * Non-manifold edges on import (ADR-0066's 2026-10-09 amendment): an STL
 * Extrudo itself wrote can touch itself along an edge (two bodies meeting
 * along one edge), and `readStl`'s weld by position then leaves that edge used
 * by four triangles. `meshFrom` separates it, so the parts stay distinct
 * bodies that still touch geometrically. The pure split lives in `@extrudo/io`.
 */
import { checkManifold, readStl, splitNonManifoldEdges, writeStl } from '@extrudo/io';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Kernel, type ShapeHandle } from './index';
import { loadManifold } from './manifold';
import { loadOcct } from './occt/load';

let kernel: Kernel;

beforeAll(async () => {
  kernel = new Kernel(await loadOcct());
  kernel.enableMeshes(await loadManifold());
});

afterAll(() => kernel.dispose());

const MEDIUM = { linearDeflection: 0.02, angularDeflection: 0.2 };

/** The app's export path: each body meshed, then one STL of all of them. */
function exportStl(...shapes: ShapeHandle[]): ReturnType<typeof readStl>['mesh'] {
  const meshes = shapes.map((shape) => kernel.exportMesh(shape, MEDIUM));
  return readStl(writeStl(meshes)).mesh;
}

describe('non-manifold edges on import (ADR-0066 amendment)', () => {
  it('separates two cubes that share one edge', () => {
    const a = kernel.box([10, 10, 10], [0, 0, 0]);
    const b = kernel.box([10, 10, 10], [10, 10, 0]);
    const mesh = exportStl(a, b);
    const report = checkManifold(mesh);
    expect(report.nonManifoldEdges).toBe(1);
    const split = splitNonManifoldEdges(mesh);
    expect(split.split).toBe(1);
    expect(checkManifold(split.mesh).ok).toBe(true);
    // manifold-3d accepts the touching-but-separate parts, as two bodies.
    const body = kernel.meshFrom(mesh);
    const solids = kernel.solids(body);
    expect(solids.length).toBe(2);
    expect(solids.map((solid) => kernel.measure(solid).volume)).toEqual([
      expect.closeTo(1000, 3),
      expect.closeTo(1000, 3),
    ]);
  });

  it('does not give a single self-touching body: OCCT keeps two boxes apart', () => {
    // `fuse` of two boxes that share exactly one edge returns a compound of two
    // solids, not one solid touching itself (OCCT never merges along an edge
    // alone). The export then holds two bodies, and importing it splits the
    // shared edge as the two-body case does.
    const a = kernel.box([10, 10, 10], [0, 0, 0]);
    const b = kernel.box([10, 10, 10], [10, 10, 0]);
    const fused = kernel.fuse(a, b);
    expect(kernel.solids(fused.shape).length).toBe(2);
    const mesh = exportStl(...kernel.solids(fused.shape));
    expect(checkManifold(mesh).nonManifoldEdges).toBe(1);
    const body = kernel.meshFrom(mesh);
    expect(kernel.solids(body).length).toBe(2);
  });

  it('separates two cubes that touch at one corner', () => {
    const a = kernel.box([10, 10, 10], [0, 0, 0]);
    const b = kernel.box([10, 10, 10], [10, 10, 10]);
    const mesh = exportStl(a, b);
    expect(checkManifold(mesh).nonManifoldEdges).toBe(0);
    const split = splitNonManifoldEdges(mesh);
    expect(split.split).toBe(0);
    expect(split.mesh).not.toBe(mesh);
    const body = kernel.meshFrom(mesh);
    expect(kernel.solids(body).length).toBe(2);
  });
});
