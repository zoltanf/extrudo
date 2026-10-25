// Mesh to Solid (P4-13, ADR-0097 §3): a mesh body's triangles go through the
// facade into one B-rep solid. Faceted merges coplanar facets; prismatic
// recognises planes and cylinders and rebuilds the body from exact surfaces.
// Real OCCT, a real manifold module and `strictLeaks`: a mesh handle or a
// solid a test forgets fails the `afterEach`.
import { readStl, type TriangleMesh } from '@extrudo/io';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import cubeStl from '../../../fixtures/imports/cube.stl?url&inline';
import { Kernel, KernelError, type ShapeHandle, type SurfaceGeometry } from './kernel';
import { loadManifold, type Manifold } from './manifold';
import { loadOcct } from './occt/load';

let kernel: Kernel;
let manifold: Awaited<ReturnType<typeof loadManifold>>;
/** The raw facade, for the non-manifold refusals `Kernel.meshFrom` never lets through. */
let occt: Awaited<ReturnType<typeof loadOcct>>;

beforeAll(async () => {
  occt = await loadOcct();
  kernel = new Kernel(occt);
  manifold = await loadManifold();
  kernel.enableMeshes(manifold);
});

afterEach(() => {
  expect(kernel.stats().liveShapes).toBe(0);
});

/** The bytes of a `data:` URL (Vite's `?url&inline` import of a fixture). */
function bytesOf(dataUrl: string): Uint8Array {
  const binary = atob(dataUrl.slice(dataUrl.indexOf(',') + 1));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

/** A manifold-3d solid as a mesh body (the manifold is freed). */
function meshOf(solid: Manifold): ShapeHandle {
  const gl = solid.getMesh();
  const positions = new Float64Array(gl.numVert * 3);
  for (let i = 0; i < gl.numVert; i++) {
    for (let k = 0; k < 3; k++)
      positions[3 * i + k] = gl.vertProperties[gl.numProp * i + k] as number;
  }
  const mesh: TriangleMesh = { positions, indices: Uint32Array.from(gl.triVerts) };
  solid.delete();
  return kernel.meshFrom(mesh);
}

function cube(): ShapeHandle {
  return kernel.meshFrom(readStl(bytesOf(cubeStl)).mesh);
}

/** cube.stl's mesh plus an identical copy offset by `offset` (indices don't overlap). */
function cubeAndCopyMesh(offset: readonly [number, number, number]): TriangleMesh {
  const { mesh } = readStl(bytesOf(cubeStl));
  const n = mesh.positions.length / 3;
  const positions = new Float64Array(n * 6);
  positions.set(mesh.positions, 0);
  for (let i = 0; i < n; i++)
    for (let k = 0; k < 3; k++)
      positions[3 * (n + i) + k] = (mesh.positions[3 * i + k] as number) + (offset[k] as number);
  const indices = new Uint32Array(mesh.indices.length * 2);
  indices.set(mesh.indices, 0);
  for (let i = 0; i < mesh.indices.length; i++)
    indices[mesh.indices.length + i] = (mesh.indices[i] as number) + n;
  return { positions, indices };
}

function cubeAndCopy(offset: readonly [number, number, number]): ShapeHandle {
  return kernel.meshFrom(cubeAndCopyMesh(offset));
}

/** `mesh` with nodes at the same (rounded) position merged into one (as a mesh body's weld). */
function weldByPosition(mesh: TriangleMesh): TriangleMesh {
  const n = mesh.positions.length / 3;
  const remap = new Uint32Array(n);
  const unique: number[] = [];
  const first = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    const x = Math.round((mesh.positions[3 * i] as number) * 1e6);
    const y = Math.round((mesh.positions[3 * i + 1] as number) * 1e6);
    const z = Math.round((mesh.positions[3 * i + 2] as number) * 1e6);
    const key = `${x},${y},${z}`;
    const known = first.get(key);
    if (known === undefined) {
      first.set(key, unique.length / 3);
      remap[i] = unique.length / 3;
      unique.push(x / 1e6, y / 1e6, z / 1e6);
    } else {
      remap[i] = known;
    }
  }
  return {
    positions: Float64Array.from(unique),
    indices: mesh.indices.map((v) => remap[v] as number),
  };
}

/** Stages `positions`/`indices` into a facade's buffers (as Kernel.#stageMesh does). */
function stageMesh(
  facade: InstanceType<typeof occt.ExtrudoFacade>,
  positions: ArrayLike<number>,
  indices: Uint32Array,
): void {
  const nodes = positions.length / 3;
  const triangles = indices.length / 3;
  expect(facade.meshNodes(nodes)).toBeGreaterThan(0);
  // Read the pointer and write at once: memory growth moves the heap.
  const xyz = new Float64Array(occt.wasmMemory.buffer, facade.meshNodesPtr(), 3 * nodes);
  for (let i = 0; i < nodes; i++) {
    xyz[3 * i] = positions[3 * i] as number;
    xyz[3 * i + 1] = positions[3 * i + 1] as number;
    xyz[3 * i + 2] = positions[3 * i + 2] as number;
  }
  expect(facade.meshTriangles(triangles)).toBeGreaterThan(0);
  new Uint32Array(occt.wasmMemory.buffer, facade.meshTrianglesPtr(), 3 * triangles).set(indices);
}

/** The size of cube.stl (one 20 mm cube). */
function cubeExtent(): [number, number, number] {
  const { mesh } = readStl(bytesOf(cubeStl));
  const xs: number[] = [];
  const ys: number[] = [];
  const zs: number[] = [];
  for (let i = 0; i < mesh.positions.length; i += 3) {
    xs.push(mesh.positions[i] as number);
    ys.push(mesh.positions[i + 1] as number);
    zs.push(mesh.positions[i + 2] as number);
  }
  const extent = (values: number[]): number => Math.max(...values) - Math.min(...values);
  return [extent(xs), extent(ys), extent(zs)];
}

/** The surface kind of every face. */
function kinds(shape: ShapeHandle): string[] {
  return Array.from(
    { length: kernel.count(shape, 'face') },
    (_, i) => kernel.surfaceGeometry(shape, i).type,
  );
}

describe('Kernel.meshToSolid, faceted', { timeout: 300_000 }, () => {
  it('turns cube.stl into a six-plane solid of the same volume', () => {
    const mesh = cube();
    try {
      const { shape, report } = kernel.meshToSolid(mesh, { method: 'faceted', tolerance: 0.01 });
      try {
        expect(kernel.count(shape, 'face')).toBe(6);
        expect(kinds(shape)).toEqual(Array(6).fill('plane'));
        expect(kernel.isValid(shape)).toBe(true);
        expect(kernel.properties(shape).volume).toBeCloseTo(8000, 6);
        expect(report).toEqual({
          method: 'faceted',
          faces: 6,
          planes: 6,
          cylinders: 0,
          cones: 0,
          spheres: 0,
          tori: 0,
          unfit: { regions: 0, triangles: 0, fraction: 0 },
          facets: 0,
        });
        expect(report.suggestedTolerance).toBeUndefined();
      } finally {
        kernel.release(shape);
      }
    } finally {
      kernel.release(mesh);
    }
  });

  it('gives a body that fillets and cuts like a native solid', () => {
    const mesh = cube();
    const { shape } = kernel.meshToSolid(mesh, { method: 'faceted', tolerance: 0.01 });
    kernel.release(mesh);
    try {
      const filleted = kernel.fillet(shape, [0], 1).shape;
      expect(kernel.count(filleted, 'face')).toBe(7);
      kernel.release(filleted);

      const { min, max } = kernel.properties(shape).bbox;
      const drill = kernel.cylinder(3, max[2] - min[2] + 10, [
        (min[0] + max[0]) / 2,
        (min[1] + max[1]) / 2,
        min[2] - 5,
      ]);
      const cut = kernel.cut(shape, drill).shape;
      kernel.release(drill);
      try {
        expect(kernel.count(cut, 'face')).toBe(7);
        expect(kinds(cut).sort()).toEqual([...Array(6).fill('plane'), 'cylinder'].sort());
        expect(kernel.properties(cut).volume).toBeCloseTo(8000 - Math.PI * 9 * 20, 3);
      } finally {
        kernel.release(cut);
      }
    } finally {
      kernel.release(shape);
    }
  });

  it('keeps a 32-sided cylinder mesh as 34 planes (faceted merges coplanar facets only)', () => {
    const mesh = meshOf(manifold.Manifold.cylinder(10, 10, 10, 32));
    const { shape, report } = kernel.meshToSolid(mesh, { method: 'faceted', tolerance: 0.01 });
    kernel.release(mesh);
    try {
      expect(kernel.count(shape, 'face')).toBe(34);
      expect(kinds(shape)).toEqual(Array(34).fill('plane'));
      expect(report).toMatchObject({ faces: 34, planes: 34 });
    } finally {
      kernel.release(shape);
    }
  });

  it('refuses a mesh that would give more than 5,000 faces', () => {
    const mesh = meshOf(manifold.Manifold.sphere(10, 128));
    try {
      let error: unknown;
      const start = performance.now();
      try {
        const { shape } = kernel.meshToSolid(mesh, { method: 'faceted', tolerance: 0.01 });
        kernel.release(shape);
      } catch (e) {
        error = e;
      }
      const ms = performance.now() - start;
      expect(error).toBeInstanceOf(KernelError);
      expect((error as Error).message).toMatch(/^Faceted would give /);
      expect((error as Error).message).toContain('Extrudo converts up to 5,000');
      // The face count comes before the build (ADR-0097 §3, 2026-10-22).
      expect(ms).toBeLessThan(1000);
    } finally {
      kernel.release(mesh);
    }
  });

  // Slice D4: the cap is 5,000, so the 72-segment sphere's 2,592 faces convert
  // (before it sat between the 2,000 cap and its 1.5x margin and the exact
  // count refused it).
  it('converts a 2,592-face sphere in Faceted (the cap is 5,000 since slice D4)', () => {
    const mesh = meshOf(manifold.Manifold.sphere(10, 72));
    try {
      const { shape, report } = kernel.meshToSolid(mesh, { method: 'faceted', tolerance: 0.01 });
      try {
        expect(kernel.isValid(shape)).toBe(true);
        expect(report.faces).toBe(2592);
        expect(report.planes).toBe(2592);
        expect(kernel.count(shape, 'face')).toBe(2592);
      } finally {
        kernel.release(shape);
      }
    } finally {
      kernel.release(mesh);
    }
  });

  it('refuses a solid body', () => {
    const box = kernel.box([10, 10, 10]);
    try {
      expect(() => kernel.meshToSolid(box, { method: 'faceted', tolerance: 0.01 })).toThrow(
        new KernelError('Mesh to Solid needs a mesh body: this body is already a solid.'),
      );
    } finally {
      kernel.release(box);
    }
  });

  it('converts a mesh of two disjoint closed shells into a compound of two solids', () => {
    const mesh = cubeAndCopy([30, 0, 0]);
    try {
      const { shape, report } = kernel.meshToSolid(mesh, { method: 'faceted', tolerance: 0.01 });
      try {
        expect(kernel.isValid(shape)).toBe(true);
        expect(kernel.count(shape, 'face')).toBe(12);
        expect(kernel.properties(shape).volume).toBeCloseTo(16000, 6);
        expect(report).toMatchObject({ faces: 12, planes: 12 });
        const solids = kernel.solids(shape);
        try {
          expect(solids).toHaveLength(2);
          for (const solid of solids) expect(kernel.properties(solid).volume).toBeCloseTo(8000, 6);
        } finally {
          kernel.release(...solids);
        }
      } finally {
        kernel.release(shape);
      }
    } finally {
      kernel.release(mesh);
    }
  });

  // Slice D2: faceted makes a hollow's cavity an inner shell, not a second
  // solid; prismatic (D1) does the same.
  it('keeps a box’s cubic cavity hollow in Faceted and Prismatic', () => {
    const outer = manifold.Manifold.cube([20, 20, 20]);
    const inner = manifold.Manifold.cube([10, 10, 10]).translate([5, 5, 5]);
    const hollow = outer.subtract(inner);
    outer.delete();
    inner.delete();
    const mesh = meshOf(hollow);
    try {
      const faceted = kernel.meshToSolid(mesh, { method: 'faceted', tolerance: 0.01 });
      try {
        expect(kernel.isValid(faceted.shape)).toBe(true);
        const solids = kernel.solids(faceted.shape);
        try {
          expect(solids).toHaveLength(1);
          expect(kernel.properties(faceted.shape).volume).toBeCloseTo(7000, 3);
        } finally {
          kernel.release(...solids);
        }
      } finally {
        kernel.release(faceted.shape);
      }
      const prism = kernel.meshToSolid(mesh, { method: 'prismatic', tolerance: -1 });
      try {
        expect(kernel.isValid(prism.shape)).toBe(true);
        expect(kernel.properties(prism.shape).volume).toBeCloseTo(7000, 3);
      } finally {
        kernel.release(prism.shape);
      }
    } finally {
      kernel.release(mesh);
    }
  });

  // Kernel.meshFrom repairs a non-manifold edge and splits a pinched vertex
  // before the mesh becomes a body, so these refusals are reachable only
  // through the facade directly.
  it('refuses an edge shared by more than two triangles, naming the reason', () => {
    const { mesh } = readStl(bytesOf(cubeStl));
    const indices = new Uint32Array(mesh.indices.length + 3);
    indices.set(mesh.indices, 0);
    indices.set(mesh.indices.subarray(0, 3), mesh.indices.length);
    const facade = new occt.ExtrudoFacade();
    stageMesh(facade, mesh.positions, indices);
    expect(facade.meshToSolid(0, 0.01)).toBe(0);
    expect(facade.lastError()).toContain('3 edges are shared by more than two triangles');
  });

  it('refuses shells that only touch at a vertex, naming the reason', () => {
    const { positions, indices } = weldByPosition(cubeAndCopyMesh(cubeExtent()));
    const facade = new occt.ExtrudoFacade();
    stageMesh(facade, positions, indices);
    expect(facade.meshToSolid(0, 0.01)).toBe(0);
    expect(facade.lastError()).toContain('vertex joins shells that only touch at a point');
  });
});

/** An OCCT solid meshed (fine or coarse) as a mesh body; the solid is released. */
function meshOfSolid(solid: ShapeHandle, linear: number, angular: number): ShapeHandle {
  const mesh = kernel.exportMesh(solid, { linearDeflection: linear, angularDeflection: angular });
  kernel.release(solid);
  return kernel.meshFrom(mesh);
}

/** Converts with prismatic and releases the mesh; the caller releases the shape. */
function prismatic(mesh: ShapeHandle, tolerance = 0.01) {
  try {
    return kernel.meshToSolid(mesh, { method: 'prismatic', tolerance });
  } finally {
    kernel.release(mesh);
  }
}

/** The radii of the cylinder faces. */
function radii(shape: ShapeHandle): number[] {
  return Array.from({ length: kernel.count(shape, 'face') }, (_, i) =>
    kernel.surfaceGeometry(shape, i),
  )
    .filter((g) => g.type === 'cylinder')
    .map((g) => g.radius as number);
}

/** The number of shells in `shape`: OCCT's STEP writer makes one CLOSED_SHELL per shell. */
function shells(shape: ShapeHandle): number {
  return kernel.writeStep([{ shape, name: 'Body' }]).match(/CLOSED_SHELL/g)?.length ?? 0;
}

const sorted = (list: string[]) => [...list].sort();

/** Every face's surface. */
function surfaces(shape: ShapeHandle): SurfaceGeometry[] {
  return Array.from({ length: kernel.count(shape, 'face') }, (_, i) =>
    kernel.surfaceGeometry(shape, i),
  );
}

/** `solid` with the edges whose sampled points all pass `pick` filleted by `radius` (the solid is released). */
function filleted(
  solid: ShapeHandle,
  radius: number,
  pick: (points: readonly (readonly number[])[], type: string) => boolean,
): ShapeHandle {
  const edges = Array.from({ length: kernel.count(solid, 'edge') }, (_, i) => i).filter((i) => {
    const g = kernel.edgeGeometry(solid, i);
    return g.type !== 'degenerate' && pick(g.points, g.type);
  });
  const rounded = kernel.fillet(solid, edges, radius).shape;
  kernel.release(solid);
  return rounded;
}

/** A donut about Z: major radius 10, tube radius 3 (a revolved circle). */
function donut(): ShapeHandle {
  const { faces } = kernel.planarFaces(
    [{ kind: 'arc', center: [10, 0], radius: 3, from: 0, sweep: 2 * Math.PI }],
    { origin: [0, 0, 0], x: [1, 0, 0], normal: [0, -1, 0] },
    1e-4,
  );
  const [disc, ...rest] = faces;
  if (!disc) throw new Error('no face');
  kernel.release(...rest.map((f) => f.shape));
  const solid = kernel.revolve(
    disc.shape,
    { origin: [0, 0, 0], direction: [0, 0, 1] },
    2 * Math.PI,
  ).shape;
  kernel.release(disc.shape);
  return solid;
}

/** A 40 x 30 x 5 plate with a through hole of radius 3 at its centre. */
function plate(): ShapeHandle {
  const box = kernel.box([40, 30, 5]);
  const drill = kernel.cylinder(3, 7, [20, 15, -1]);
  const cut = kernel.cut(box, drill).shape;
  kernel.release(box);
  kernel.release(drill);
  return cut;
}
const PLATE_VOLUME = 6000 - 45 * Math.PI;

/** The 32-gon cylinder r 5, h 20, its nodes moved radially by up to ±`amplitude` mm (deterministic). */
function noisyCylinder(amplitude = 0.005): ShapeHandle {
  const solid = manifold.Manifold.cylinder(20, 5, 5, 32);
  const gl = solid.getMesh();
  solid.delete();
  const positions = new Float64Array(gl.numVert * 3);
  for (let i = 0; i < gl.numVert; i++) {
    const x = gl.vertProperties[gl.numProp * i] as number;
    const y = gl.vertProperties[gl.numProp * i + 1] as number;
    const z = gl.vertProperties[gl.numProp * i + 2] as number;
    const r = Math.hypot(x, y);
    const scale = (r + amplitude * Math.sin(1.7 * i + 0.3)) / r;
    positions.set([x * scale, y * scale, z], 3 * i);
  }
  return kernel.meshFrom({ positions, indices: Uint32Array.from(gl.triVerts) });
}

/**
 * A box 20 x 20 x 10 whose vertical edge at x = 20, y = 20 is cut by a twisted
 * chamfer: `w0` wide on the y = 20 face all the way up, `w0` to `w1` on the
 * x = 20 face, in `steps` rows. The chamfer is a ruled saddle no plane,
 * cylinder, cone, sphere or torus fits (ADR-0097's slice C), built as a
 * welded mesh with outward triangles.
 */
function twistedChamferMesh(w0: number, w1: number, steps = 24): TriangleMesh {
  const [L, W, H] = [20, 20, 10];
  const positions: number[] = [];
  const indices: number[] = [];
  const index = new Map<string, number>();
  const node = (x: number, y: number, z: number) => {
    const key = `${x},${y},${z}`;
    let i = index.get(key);
    if (i === undefined) {
      i = positions.length / 3;
      positions.push(x, y, z);
      index.set(key, i);
    }
    return i;
  };
  const centre = [L / 2, W / 2, H / 2];
  const triangle = (a: number, b: number, c: number) => {
    const p = (i: number, k: number) => positions[3 * i + k] as number;
    const u = [0, 1, 2].map((k) => p(b, k) - p(a, k));
    const v = [0, 1, 2].map((k) => p(c, k) - p(a, k));
    const n = [
      (u[1] as number) * (v[2] as number) - (u[2] as number) * (v[1] as number),
      (u[2] as number) * (v[0] as number) - (u[0] as number) * (v[2] as number),
      (u[0] as number) * (v[1] as number) - (u[1] as number) * (v[0] as number),
    ];
    const out = [0, 1, 2].reduce(
      (sum, k) =>
        sum + (n[k] as number) * ((p(a, k) + p(b, k) + p(c, k)) / 3 - (centre[k] as number)),
      0,
    );
    indices.push(...(out >= 0 ? [a, b, c] : [a, c, b]));
  };
  const fan = (ring: number[]) => {
    for (let k = 1; k + 1 < ring.length; k++)
      triangle(ring[0] as number, ring[k] as number, ring[k + 1] as number);
  };
  const z = (k: number) => (H * k) / steps;
  const a = (k: number) => node(L, W - (w0 + ((w1 - w0) * k) / steps), z(k));
  const b = (k: number) => node(L - w0, W, z(k));
  for (let k = 0; k < steps; k++) {
    triangle(a(k), b(k), b(k + 1));
    triangle(a(k), b(k + 1), a(k + 1));
  }
  const rows = Array.from({ length: steps + 1 }, (_, k) => k);
  fan([node(L, 0, 0), ...rows.map(a), node(L, 0, H)]);
  fan([node(0, W, 0), ...rows.map(b), node(0, W, H)]);
  fan([node(0, 0, H), node(L, 0, H), a(steps), b(steps), node(0, W, H)]);
  fan([node(0, 0, 0), node(L, 0, 0), a(0), b(0), node(0, W, 0)]);
  fan([node(0, 0, 0), node(0, W, 0), node(0, W, H), node(0, 0, H)]);
  fan([node(0, 0, 0), node(L, 0, 0), node(L, 0, H), node(0, 0, H)]);
  return { positions: Float64Array.from(positions), indices: Uint32Array.from(indices) };
}

/** The signed volume of a triangle mesh. */
function volumeOfMesh({ positions, indices }: TriangleMesh): number {
  const at = (i: number) => positions[i] as number;
  let v = 0;
  for (let t = 0; t < indices.length; t += 3) {
    const [a, b, c] = [0, 1, 2].map((k) => 3 * (indices[t + k] as number)) as [
      number,
      number,
      number,
    ];
    v +=
      at(a) * (at(b + 1) * at(c + 2) - at(b + 2) * at(c + 1)) -
      at(a + 1) * (at(b) * at(c + 2) - at(b + 2) * at(c)) +
      at(a + 2) * (at(b) * at(c + 1) - at(b + 1) * at(c));
  }
  return v / 6;
}

describe('Kernel.meshToSolid, prismatic', { timeout: 300_000 }, () => {
  it('1: turns cube.stl into six exact planes', () => {
    const { shape, report } = prismatic(cube());
    try {
      expect(kernel.count(shape, 'face')).toBe(6);
      expect(kinds(shape)).toEqual(Array(6).fill('plane'));
      expect(kernel.isValid(shape)).toBe(true);
      expect(kernel.properties(shape).volume).toBeCloseTo(8000, 6);
      // Exact: the hybrid stage never ran (ADR-0097 slice D1).
      expect(report).toEqual({
        method: 'prismatic',
        faces: 6,
        planes: 6,
        cylinders: 0,
        cones: 0,
        spheres: 0,
        tori: 0,
        unfit: { regions: 0, triangles: 0, fraction: 0 },
        rebuild: 'exact',
        facets: 0,
        tolerance: 0.01,
      });
    } finally {
      kernel.release(shape);
    }
  });

  // 2-4: the same cylinder at 32, 360 (the fine trap: facets 1 degree apart)
  // and 16 segments (coarse: its polygon is 2.5 % short of the circle).
  for (const segments of [32, 360, 16]) {
    it(`${segments === 32 ? 2 : segments === 360 ? 3 : 4}: rebuilds a ${segments}-gon cylinder as 2 planes and an exact cylinder`, () => {
      const { shape, report } = prismatic(meshOf(manifold.Manifold.cylinder(20, 5, 5, segments)));
      try {
        expect(kernel.count(shape, 'face')).toBe(3);
        expect(sorted(kinds(shape))).toEqual(['cylinder', 'plane', 'plane']);
        const [radius] = radii(shape);
        expect(Math.abs((radius as number) - 5)).toBeLessThan(1e-6);
        const volume = kernel.properties(shape).volume;
        expect(Math.abs(volume / (Math.PI * 25 * 20) - 1)).toBeLessThan(0.001);
        expect(report).toMatchObject({ faces: 3, planes: 2, cylinders: 1, unfit: { regions: 0 } });
      } finally {
        kernel.release(shape);
      }
    });
  }

  it('5: rebuilds a plate with a hole: the hole is a circle and takes a fillet', () => {
    const { shape } = prismatic(meshOfSolid(plate(), 0.001, 0.05));
    try {
      expect(kernel.count(shape, 'face')).toBe(7);
      expect(sorted(kinds(shape))).toEqual(sorted([...Array(6).fill('plane'), 'cylinder']));
      expect(Math.abs(kernel.properties(shape).volume / PLATE_VOLUME - 1)).toBeLessThan(0.001);
      const topCircle = Array.from({ length: kernel.count(shape, 'edge') }, (_, i) => i).find(
        (i) => {
          const g = kernel.edgeGeometry(shape, i);
          return g.type === 'circle' && Math.abs((g.points[0]?.[2] ?? 0) - 5) < 1e-6;
        },
      );
      expect(topCircle).toBeDefined();
      const filleted = kernel.fillet(shape, [topCircle as number], 1).shape;
      try {
        expect(kernel.isValid(filleted)).toBe(true);
        expect(kernel.count(filleted, 'face')).toBe(8);
      } finally {
        kernel.release(filleted);
      }
    } finally {
      kernel.release(shape);
    }
  });

  // 6: the tangency trap: a fillet's cylinder touches both its planes.
  for (const [name, linear, angular] of [
    ['fine', 0.001, 0.05],
    ['coarse (8 segments)', 1, Math.PI / 16 + 1e-3],
  ] as const) {
    it(`6: rebuilds a box with a filleted edge, meshed ${name}`, () => {
      const box = kernel.box([20, 20, 20]);
      const rounded = kernel.fillet(box, [0], 2).shape;
      kernel.release(box);
      const exact = kernel.properties(rounded).volume;
      const { shape, report } = prismatic(meshOfSolid(rounded, linear, angular));
      try {
        expect(kernel.count(shape, 'face')).toBe(7);
        expect(sorted(kinds(shape))).toEqual(sorted([...Array(6).fill('plane'), 'cylinder']));
        expect(Math.abs((radii(shape)[0] as number) - 2)).toBeLessThan(1e-3);
        expect(Math.abs(kernel.properties(shape).volume / exact - 1)).toBeLessThan(0.001);
        expect(report).toMatchObject({ planes: 6, cylinders: 1 });
      } finally {
        kernel.release(shape);
      }
    });
  }

  it('7: keeps an ellipsoid, which fits no surface, as facets (the hybrid rebuild)', () => {
    const sphere = manifold.Manifold.sphere(10, 48);
    const ellipsoid = sphere.scale([1, 1, 0.6]);
    sphere.delete();
    const triangles = ellipsoid.numTri();
    const mesh = meshOf(ellipsoid);
    const { shape, report } = prismatic(mesh);
    try {
      expect(report).toMatchObject({
        rebuild: 'hybrid',
        planes: 0,
        cylinders: 0,
        unfit: { regions: 1, triangles, fraction: 1 },
      });
      expect(report.facets).toBe(kernel.count(shape, 'face'));
      expect(report.facets).toBeLessThanOrEqual(triangles);
      expect(kernel.isValid(shape)).toBe(true);
    } finally {
      kernel.release(shape);
    }
  });

  it('8: rebuilds a 602-face staircase over the 500-surface cap with the hybrid, quickly', () => {
    // 299 steps: the bottom, the back, 299 risers and 299 treads, and the two caps.
    const steps = 299;
    const outline: [number, number][] = [
      [0, 0],
      [steps, 0],
    ];
    for (let i = 0; i < steps; i++) outline.push([steps - i, i + 1], [steps - i - 1, i + 1]);
    const section = new manifold.CrossSection([outline]);
    const solid = section.extrude(5);
    section.delete();
    // Over the cap the exact rebuild is skipped (MakerVolume's pairs grow
    // with the square); the hybrid builds every plane from the mesh.
    const start = performance.now();
    const { shape, report } = prismatic(meshOf(solid));
    const ms = performance.now() - start;
    try {
      console.log(`prismatic: the staircase converted in ${ms.toFixed(0)} ms`);
      expect(report).toMatchObject({ rebuild: 'hybrid', faces: 602, planes: 602, facets: 0 });
      // Slice D3 collapses nothing here: every chain is one mesh edge
      // between two corners (1,800 edges before and after).
      expect(kernel.count(shape, 'edge')).toBe(1800);
      expect(kernel.isValid(shape)).toBe(true);
      expect(kernel.properties(shape).volume).toBeCloseTo(224250, 3);
      expect(ms).toBeLessThan(10000);
    } finally {
      kernel.release(shape);
    }
  });

  it('9: keeps a noisy cylinder’s side as facets, suggests a tolerance, and converts exactly there', () => {
    // Below the noise the side fits nothing: the hybrid keeps it as facets,
    // and the report still names the tolerance that would have fitted it.
    const noisy = prismatic(noisyCylinder(), 0.001);
    try {
      expect(noisy.report).toMatchObject({ rebuild: 'hybrid', planes: 2 });
      // The side's 64 triangles, a few coplanar pairs merged.
      expect(noisy.report.facets).toBeGreaterThan(48);
      expect(noisy.report.facets).toBeLessThanOrEqual(64);
      expect(kernel.isValid(noisy.shape)).toBe(true);
    } finally {
      kernel.release(noisy.shape);
    }
    // The sphere through two rings a diameter apart also nearly fits the side,
    // so the suggestion is the sphere's deviation, not the cylinder's.
    const suggested = noisy.report.suggestedTolerance as number;
    expect(suggested).toBeGreaterThanOrEqual(0.002);
    expect(suggested).toBeLessThanOrEqual(0.02);
    const { shape, report } = prismatic(noisyCylinder(), 0.02);
    try {
      expect(sorted(kinds(shape))).toEqual(['cylinder', 'plane', 'plane']);
      expect(report).toMatchObject({ planes: 2, cylinders: 1 });
    } finally {
      kernel.release(shape);
    }
  });

  it('24: Auto picks the ladder step (0.01 clean, higher when noisy)', () => {
    // A clean mesh: the first ladder step (0.01) already fits under 2 %.
    const clean = meshOf(manifold.Manifold.cylinder(20, 5, 5, 32));
    const exact = prismatic(clean, -1);
    try {
      expect(exact.report).toMatchObject({ auto: true, tolerance: 0.01, rebuild: 'exact' });
      expect(kinds(exact.shape)).toEqual(['cylinder', 'plane', 'plane']);
    } finally {
      kernel.release(exact.shape);
    }
  });

  it('25: Auto on a noisy mesh picks a higher step and converts; 0.01 leaves it unfit', () => {
    // The side is ±0.03 mm off its circle: unfit at 0.01 (kept as facets), a
    // step at or above 0.02 fits it under the 2 % allowance.
    const explicit = prismatic(noisyCylinder(0.03), 0.01);
    try {
      expect(explicit.report.unfit.regions).toBeGreaterThan(0);
      expect(explicit.report.unfit.fraction).toBeGreaterThan(0.02);
    } finally {
      kernel.release(explicit.shape);
    }
    const auto = prismatic(noisyCylinder(0.03), -1);
    try {
      expect(auto.report.auto).toBe(true);
      expect(auto.report.tolerance as number).toBeGreaterThanOrEqual(0.02);
      expect(auto.report.unfit.fraction).toBeLessThanOrEqual(0.02);
      expect(kernel.isValid(auto.shape)).toBe(true);
      expect(Math.abs(kernel.properties(auto.shape).volume - Math.PI * 25 * 20)).toBeLessThan(
        Math.PI * 25 * 20 * 0.02,
      );
    } finally {
      kernel.release(auto.shape);
    }
  });

  it('22: keeps a small unfit blend as facets (slice D4 skips the exact stage on any unfit region)', () => {
    const mesh = twistedChamferMesh(2, 1);
    const { shape, report } = prismatic(kernel.meshFrom(mesh));
    try {
      // The box's planes stay planes; the saddle is facets, the volume the mesh's.
      expect(report.rebuild).toBe('hybrid');
      expect(report.planes).toBeGreaterThanOrEqual(6);
      expect(report.facets).toBeGreaterThan(0);
      expect(kernel.isValid(shape)).toBe(true);
      // The report keeps what stayed facets: one region, its triangles and share.
      expect(report.unfit.regions).toBe(1);
      expect(report.unfit.triangles).toBeGreaterThan(0);
      expect(report.unfit.fraction).toBeGreaterThan(0);
      expect(report.unfit.fraction).toBeLessThanOrEqual(0.02);
      // The blend is kept as facets, so the volume is the mesh's (not the sharp box's 4000).
      expect(Math.abs(kernel.properties(shape).volume / volumeOfMesh(mesh) - 1)).toBeLessThan(
        0.005,
      );
    } finally {
      kernel.release(shape);
    }
  });

  it('23: keeps the same blend over 2 % of the surface as facets (the hybrid rebuild)', () => {
    const mesh = twistedChamferMesh(6, 3);
    const { shape, report } = prismatic(kernel.meshFrom(mesh));
    try {
      expect(report).toMatchObject({ rebuild: 'hybrid', unfit: { regions: 1 } });
      expect(report.unfit.fraction).toBeGreaterThan(0.02);
      expect(report.facets).toBeGreaterThan(0);
      // The box's planes stay planes; the saddle is facets, the volume the mesh's.
      expect(report.planes).toBeGreaterThanOrEqual(6);
      expect(kernel.isValid(shape)).toBe(true);
      expect(Math.abs(kernel.properties(shape).volume / volumeOfMesh(mesh) - 1)).toBeLessThan(1e-4);
    } finally {
      kernel.release(shape);
    }
  });

  it('11: converts a 20k-triangle plate and a 500k-triangle sphere in under 3 s and 10 s', () => {
    const mesh = meshOfSolid(plate(), 0.0002, 0.0025);
    const triangles =
      kernel.exportMesh(mesh, { linearDeflection: 1, angularDeflection: 1 }).indices.length / 3;
    let start = performance.now();
    const { shape } = prismatic(mesh);
    const convert = performance.now() - start;
    try {
      expect(kernel.count(shape, 'face')).toBe(7);
    } finally {
      kernel.release(shape);
    }
    start = performance.now();
    const sphere = meshOf(manifold.Manifold.sphere(10, 1000));
    const sphereTriangles =
      kernel.exportMesh(sphere, { linearDeflection: 1, angularDeflection: 1 }).indices.length / 3;
    const { shape: ball } = prismatic(sphere);
    const ballMs = performance.now() - start;
    try {
      expect(kernel.count(ball, 'face')).toBe(1);
      expect(kinds(ball)).toEqual(['sphere']);
    } finally {
      kernel.release(ball);
    }
    console.log(
      `prismatic: plate ${triangles} triangles converted in ${convert.toFixed(0)} ms; sphere ${sphereTriangles} triangles converted in ${ballMs.toFixed(0)} ms`,
    );
    expect(triangles).toBeGreaterThan(15_000);
    expect(sphereTriangles).toBeGreaterThan(400_000);
    expect(convert).toBeLessThan(3000);
    expect(ballMs).toBeLessThan(10_000);
  });

  it('12: converts a sphere into one exact sphere face', () => {
    const { shape, report } = prismatic(meshOf(manifold.Manifold.sphere(10, 48)));
    try {
      expect(kernel.count(shape, 'face')).toBe(1);
      expect(kinds(shape)).toEqual(['sphere']);
      expect(Math.abs((kernel.surfaceGeometry(shape, 0).radius as number) - 10)).toBeLessThan(1e-3);
      const volume = kernel.properties(shape).volume;
      expect(Math.abs(volume / ((4 / 3) * Math.PI * 1000) - 1)).toBeLessThan(0.01);
      expect(report).toMatchObject({ planes: 0, cylinders: 0, spheres: 1, cones: 0 });
    } finally {
      kernel.release(shape);
    }
  });

  it('13: rebuilds a dome: the sphere snaps to the cylinder’s radius', () => {
    const cylinder = manifold.Manifold.cylinder(10, 10, 10, 64);
    const cap0 = manifold.Manifold.sphere(10, 64);
    const cap = cap0.translate([0, 0, 10]);
    cap0.delete();
    const solid = manifold.Manifold.union(cylinder, cap);
    cylinder.delete();
    cap.delete();
    const { shape } = prismatic(meshOf(solid));
    try {
      expect(kernel.count(shape, 'face')).toBe(3);
      expect(sorted(kinds(shape))).toEqual(['cylinder', 'plane', 'sphere']);
      const geoms = Array.from({ length: 3 }, (_, i) => kernel.surfaceGeometry(shape, i));
      const cyl = geoms.find((g) => g.type === 'cylinder');
      const ball = geoms.find((g) => g.type === 'sphere');
      expect(Math.abs((ball?.radius as number) - (cyl?.radius as number))).toBeLessThan(1e-6);
      expect(Math.abs(ball?.origin?.[0] ?? 1)).toBeLessThan(1e-6);
      expect(Math.abs(ball?.origin?.[1] ?? 1)).toBeLessThan(1e-6);
      const volume = kernel.properties(shape).volume;
      expect(Math.abs(volume / (Math.PI * 100 * 10 + (2 / 3) * Math.PI * 1000) - 1)).toBeLessThan(
        0.01,
      );
    } finally {
      kernel.release(shape);
    }
  });

  it('14: rebuilds a truncated cone', () => {
    const { shape } = prismatic(meshOf(manifold.Manifold.cylinder(20, 10, 4, 64)));
    try {
      expect(kernel.count(shape, 'face')).toBe(3);
      const geoms = Array.from({ length: 3 }, (_, i) => kernel.surfaceGeometry(shape, i));
      expect(geoms.filter((g) => g.type === 'plane')).toHaveLength(2);
      const cone = geoms.find((g) => g.type === 'cone');
      expect(cone).toBeDefined();
      expect(Math.abs((cone?.halfAngle as number) - Math.atan(6 / 20))).toBeLessThan(1e-3);
      const volume = kernel.properties(shape).volume;
      expect(Math.abs(volume / ((Math.PI * 20 * (100 + 40 + 16)) / 3) - 1)).toBeLessThan(0.005);
    } finally {
      kernel.release(shape);
    }
  });

  it('15: rebuilds a countersunk hole', () => {
    const cube = manifold.Manifold.cube([40, 30, 5]);
    const hole0 = manifold.Manifold.cylinder(7, 3, 3, 64);
    const hole = hole0.translate([20, 15, -1]);
    hole0.delete();
    const sink0 = manifold.Manifold.cylinder(3, 3, 6, 64);
    const sink = sink0.translate([20, 15, 2]);
    sink0.delete();
    const drilled = cube.subtract(hole);
    cube.delete();
    hole.delete();
    const solid = drilled.subtract(sink);
    drilled.delete();
    sink.delete();
    const exact = solid.volume();
    const { shape } = prismatic(meshOf(solid));
    try {
      expect(kernel.count(shape, 'face')).toBe(8);
      const list = kinds(shape);
      expect(list.filter((k) => k === 'plane')).toHaveLength(6);
      expect(list).toContain('cylinder');
      expect(list).toContain('cone');
      expect(Math.abs(kernel.properties(shape).volume / exact - 1)).toBeLessThan(0.005);
    } finally {
      kernel.release(shape);
    }
  });

  it('16: converts a pointed cone to a plane and a cone (manifold’s apex works)', () => {
    // The harness's OCCT cone refuses at the rebuild (MakerVolume can't do
    // the singular apex); manifold's mesh for the same cone converts.
    const { shape, report } = prismatic(meshOf(manifold.Manifold.cylinder(20, 10, 0, 64)));
    try {
      expect(kernel.count(shape, 'face')).toBe(2);
      expect(sorted(kinds(shape))).toEqual(['cone', 'plane']);
      const cone = Array.from({ length: 2 }, (_, i) => kernel.surfaceGeometry(shape, i)).find(
        (g) => g.type === 'cone',
      );
      expect(Math.abs((cone?.halfAngle as number) - Math.atan(10 / 20))).toBeLessThan(1e-3);
      expect(report).toMatchObject({ planes: 1, cones: 1, spheres: 0 });
    } finally {
      kernel.release(shape);
    }
  });

  it('17: converts a donut into one torus face', () => {
    const { shape, report } = prismatic(meshOfSolid(donut(), 0.01, 0.2));
    try {
      expect(kinds(shape)).toEqual(['torus']);
      const torus = kernel.surfaceGeometry(shape, 0);
      expect(Math.abs((torus.radius as number) - 10)).toBeLessThan(1e-6);
      expect(Math.abs((torus.minorRadius as number) - 3)).toBeLessThan(1e-6);
      const volume = kernel.properties(shape).volume;
      expect(Math.abs(volume / (2 * Math.PI * Math.PI * 10 * 9) - 1)).toBeLessThan(0.005);
      expect(report).toMatchObject({ faces: 1, tori: 1, unfit: { regions: 0 } });
    } finally {
      kernel.release(shape);
    }
  });

  it('18: splits a box with four filleted top edges into planes and cylinders', () => {
    // OCCT mitres the corners where two top fillets meet (no corner face),
    // so the smooth ring is four cylinders.
    const rounded = filleted(kernel.box([40, 30, 10]), 2, (points) =>
      points.every((p) => Math.abs((p[2] as number) - 10) < 1e-6),
    );
    const exact = kernel.properties(rounded).volume;
    const { shape, report } = prismatic(meshOfSolid(rounded, 0.01, 0.2));
    try {
      expect(sorted(kinds(shape))).toEqual(
        sorted([...Array(6).fill('plane'), ...Array(4).fill('cylinder')]),
      );
      expect(Math.abs(kernel.properties(shape).volume / exact - 1)).toBeLessThan(1e-6);
      expect(report).toMatchObject({ planes: 6, cylinders: 4, unfit: { regions: 0 } });
    } finally {
      kernel.release(shape);
    }
  });

  it('19: rebuilds a cylinder with a filleted end: plane, cylinder, torus', () => {
    const rounded = filleted(
      kernel.cylinder(5, 20),
      2,
      (points, type) =>
        type === 'circle' && points.every((p) => Math.abs((p[2] as number) - 20) < 1e-6),
    );
    const exact = kernel.properties(rounded).volume;
    const { shape } = prismatic(meshOfSolid(rounded, 0.01, 0.2));
    try {
      const geoms = surfaces(shape);
      expect(sorted(geoms.map((g) => g.type))).toEqual(['cylinder', 'plane', 'plane', 'torus']);
      const cylinder = geoms.find((g) => g.type === 'cylinder') as SurfaceGeometry;
      const torus = geoms.find((g) => g.type === 'torus') as SurfaceGeometry;
      expect(Math.abs((torus.origin?.[0] ?? 1) - (cylinder.origin?.[0] ?? 0))).toBeLessThan(1e-9);
      expect(Math.abs((torus.origin?.[1] ?? 1) - (cylinder.origin?.[1] ?? 0))).toBeLessThan(1e-9);
      expect(Math.abs((torus.radius as number) - 3)).toBeLessThan(1e-3);
      expect(Math.abs((torus.minorRadius as number) - 2)).toBeLessThan(1e-3);
      expect(Math.abs(kernel.properties(shape).volume / exact - 1)).toBeLessThan(0.001);
    } finally {
      kernel.release(shape);
    }
  });

  it("20: rebuilds a plate whose hole is filleted: the torus takes the hole's axis", () => {
    const rounded = filleted(
      plate(),
      1,
      (points, type) =>
        type === 'circle' && points.every((p) => Math.abs((p[2] as number) - 5) < 1e-6),
    );
    const exact = kernel.properties(rounded).volume;
    const { shape } = prismatic(meshOfSolid(rounded, 0.01, 0.2));
    try {
      const geoms = surfaces(shape);
      expect(sorted(geoms.map((g) => g.type))).toEqual(
        sorted([...Array(6).fill('plane'), 'cylinder', 'torus']),
      );
      const torus = geoms.find((g) => g.type === 'torus') as SurfaceGeometry;
      expect(Math.abs((torus.origin?.[0] ?? 0) - 20)).toBeLessThan(1e-6);
      expect(Math.abs((torus.origin?.[1] ?? 0) - 15)).toBeLessThan(1e-6);
      expect(Math.abs((torus.radius as number) - 4)).toBeLessThan(1e-3);
      expect(Math.abs((torus.minorRadius as number) - 1)).toBeLessThan(1e-3);
      expect(Math.abs(kernel.properties(shape).volume / exact - 1)).toBeLessThan(0.001);
    } finally {
      kernel.release(shape);
    }
  });

  it('21: splits a box with all twelve edges filleted', () => {
    const box = kernel.box([20, 20, 20]);
    const rounded = filleted(box, 2, () => true);
    const exact = kernel.properties(rounded).volume;
    const { shape, report } = prismatic(meshOfSolid(rounded, 0.01, 0.2));
    try {
      expect(kernel.count(shape, 'face')).toBe(26);
      expect(sorted(kinds(shape))).toEqual(
        sorted([
          ...Array(6).fill('plane'),
          ...Array(12).fill('cylinder'),
          ...Array(8).fill('sphere'),
        ]),
      );
      expect(Math.abs(kernel.properties(shape).volume / exact - 1)).toBeLessThan(1e-6);
      expect(report).toMatchObject({ planes: 6, cylinders: 12, spheres: 8, unfit: { regions: 0 } });
    } finally {
      kernel.release(shape);
    }
  });
});

/** A boundary chain (slice D3): its regions, closed or not, its mesh edges, its curve (0 line, 1 circle, 2 ellipse; -1 none, -2 not a candidate). */
interface Chain {
  left: number;
  right: number;
  closed: boolean;
  edges: number;
  curve: number;
}

/**
 * The hybrid rebuild's regions and loops through the raw facade (ADR-0097
 * slice D1): per region its kind, surface and loops' edge counts, the outer
 * loop first; and the boundary chains between them (slice D3).
 */
function chainsAndLoopsOf(positions: ArrayLike<number>, indices: Uint32Array, tolerance = 0.01) {
  const facade = new occt.ExtrudoFacade();
  stageMesh(facade, positions, indices);
  const count = facade.meshLoopsDebug(tolerance);
  expect(count).toBeGreaterThan(0);
  const data = new Int32Array(
    occt.wasmMemory.buffer,
    facade.meshLoopsPtr(),
    facade.meshLoopsSize(),
  ).slice();
  const regions: { kind: number; surface: number; loops: number[] }[] = [];
  let i = 0;
  while (regions.length < count) {
    const loops = data[i + 2] as number;
    regions.push({
      kind: data[i] as number,
      surface: data[i + 1] as number,
      loops: Array.from(data.subarray(i + 3, i + 3 + loops)),
    });
    i += 3 + loops;
  }
  const chains: Chain[] = [];
  for (let c = 0, n = data[i++] as number; c < n; c++, i += 5) {
    chains.push({
      left: data[i] as number,
      right: data[i + 1] as number,
      closed: data[i + 2] === 1,
      edges: data[i + 3] as number,
      curve: data[i + 4] as number,
    });
  }
  expect(i).toBe(data.length);
  return { regions, chains };
}

function loopsOf(positions: ArrayLike<number>, indices: Uint32Array, tolerance = 0.01) {
  return chainsAndLoopsOf(positions, indices, tolerance).regions;
}

/** Every edge's curve type (line, circle, ellipse, other) and, for circles, the conic. */
function edgesOf(shape: ShapeHandle) {
  return Array.from({ length: kernel.count(shape, 'edge') }, (_, i) => {
    const g = kernel.edgeGeometry(shape, i, 2);
    return g.type === 'degenerate'
      ? { index: i, type: g.type, points: [] }
      : { index: i, type: g.type, conic: g.conic, points: g.points };
  });
}

/** A manifold solid's welded triangles (the manifold is freed). */
function trianglesOf(solid: Manifold): { positions: Float64Array; indices: Uint32Array } {
  const gl = solid.getMesh();
  const positions = new Float64Array(gl.numVert * 3);
  for (let i = 0; i < gl.numVert; i++)
    for (let k = 0; k < 3; k++)
      positions[3 * i + k] = gl.vertProperties[gl.numProp * i + k] as number;
  solid.delete();
  return { positions, indices: Uint32Array.from(gl.triVerts) };
}

/**
 * A 30 x 30 x 10 box with a cylindrical boss r 5 on top whose top is a
 * lopsided bump (2 mm high, tilted): no plane, cylinder, cone, sphere or
 * torus fits it, and it covers more than 2 % of the surface.
 */
function bossWithBump(): Manifold {
  const box = manifold.Manifold.cube([30, 30, 10]);
  const cylinder = manifold.Manifold.cylinder(6, 5, 5, 48).translate([15, 15, 10]);
  const boss = cylinder.refine(6);
  cylinder.delete();
  const bumped = boss.warp((v) => {
    if (v[2] > 15.999) {
      const x = v[0] - 15;
      const y = v[1] - 15;
      const r2 = (x * x + y * y) / 25;
      v[2] += 2 * Math.max(0, 1 - r2) * (1 + 0.3 * (x / 5) + 0.2 * (y / 5) ** 2);
    }
  });
  boss.delete();
  const part = box.add(bumped);
  box.delete();
  bumped.delete();
  return part;
}

describe('Mesh to Solid, the hybrid rebuild (ADR-0097 slice D1)', { timeout: 300_000 }, () => {
  it('orders a box’s boundaries: six regions, one loop of four edges each', () => {
    const { mesh } = readStl(bytesOf(cubeStl));
    const regions = loopsOf(mesh.positions, mesh.indices);
    expect(regions).toHaveLength(6);
    for (const region of regions) expect(region).toMatchObject({ kind: 0, loops: [4] });
  });

  it('gives the faces a through hole crosses an inner loop, and splits the hole’s wall in two', () => {
    const solid = plate();
    const exported = kernel.exportMesh(solid, { linearDeflection: 0.01, angularDeflection: 0.2 });
    kernel.release(solid);
    const { positions, indices } = weldByPosition(exported);
    const regions = loopsOf(positions, indices);
    const planes = regions.filter((r) => r.kind === 0);
    const walls = regions.filter((r) => r.kind === 1);
    expect(planes).toHaveLength(6);
    // Top and bottom: the box's four edges outside, the hole's polygon inside.
    const holed = planes.filter((r) => r.loops.length === 2);
    expect(holed).toHaveLength(2);
    for (const r of holed) expect(r.loops[0]).toBe(4);
    // The wall spans the full turn: two pieces on one surface, one loop each.
    expect(walls).toHaveLength(2);
    expect(walls[0]?.surface).toBe(walls[1]?.surface);
    for (const r of walls) expect(r.loops).toHaveLength(1);
  });

  it('splits a capped cylinder’s wall into two halves', () => {
    const { positions, indices } = trianglesOf(manifold.Manifold.cylinder(20, 5, 5, 32));
    const regions = loopsOf(positions, indices);
    const caps = regions.filter((r) => r.kind === 0);
    const halves = regions.filter((r) => r.kind === 1);
    expect(caps.map((r) => r.loops)).toEqual([[32], [32]]);
    // One loop each: the two rims' 64 edges between them, and the two cuts twice.
    expect(halves.map((r) => r.loops.length)).toEqual([1, 1]);
    expect((halves[0]?.loops[0] ?? 0) + (halves[1]?.loops[0] ?? 0)).toBe(68);
  });

  it('keeps a boss’s freeform top as facets and its wall as one exact cylinder', () => {
    const part = bossWithBump();
    const volume = part.volume();
    const { shape, report } = prismatic(meshOf(part));
    try {
      expect(report.rebuild).toBe('hybrid');
      expect(report.facets).toBeGreaterThan(0);
      expect(report.unfit.regions).toBe(1);
      // The wall's two halves merge back into one face (refine's nodes sit
      // on the 48-gon's chords: r 4.993); the bump's flanks may fit small
      // primitives of their own.
      expect(radii(shape).filter((r) => Math.abs(r - 5) < 0.02)).toHaveLength(1);
      expect(kernel.isValid(shape)).toBe(true);
      expect(Math.abs(kernel.properties(shape).volume / volume - 1)).toBeLessThan(0.01);
    } finally {
      kernel.release(shape);
    }
  });

  it('makes the boss with a freeform top one solid and one shell, which Offset Face accepts', () => {
    // `bossWithBump`'s own boolean leaves the body plus 46 flat zero-volume
    // components at the boss's base (the box top and the cylinder base are
    // coplanar). Each is a closed mesh component, so one solid per component
    // would put 46 degenerate shells beside the body: Offset Face then refuses
    // it ("the solid has an inner void"). The conversion drops them.
    const part = bossWithBump();
    const { shape, report } = prismatic(meshOf(part));
    try {
      expect(report.rebuild).toBe('hybrid');
      const solids = kernel.solids(shape);
      try {
        expect(solids).toHaveLength(1);
      } finally {
        kernel.release(...solids);
      }
      expect(shells(shape)).toBe(1);
      // With no inner void, Offset Face moves the box's bottom by 1 mm.
      const bottom = kernel
        .describe(shape)
        .faces.map((surface, index) => ({ surface, index }))
        .filter(({ surface }) => surface.type === 'plane')
        .sort((a, b) => (a.surface.centroid[2] as number) - (b.surface.centroid[2] as number))[0];
      expect(bottom).toBeDefined();
      const before = kernel.properties(shape).volume;
      const moved = kernel.offsetFaces(shape, [bottom?.index ?? -1], 1);
      try {
        expect(kernel.isValid(moved.shape)).toBe(true);
        // The box's 30 x 30 bottom rises 1 mm: 900 mm3 more (within 0.5 %).
        expect(Math.abs(kernel.properties(moved.shape).volume - before - 900)).toBeLessThan(4.5);
      } finally {
        kernel.release(moved.shape);
      }
    } finally {
      kernel.release(shape);
    }
  });

  it('keeps a closed cavity hollow: its shell goes inside the solid around it', () => {
    const part = bossWithBump();
    const cavity = manifold.Manifold.cube([10, 10, 4]).translate([10, 10, 3]);
    const hollow = part.subtract(cavity);
    part.delete();
    cavity.delete();
    const volume = hollow.volume();
    const { shape, report } = prismatic(meshOf(hollow));
    try {
      expect(report.rebuild).toBe('hybrid');
      expect(kernel.isValid(shape)).toBe(true);
      // The cavity's 400 mm3 stay out (filled, the volume would be 800 off).
      expect(Math.abs(kernel.properties(shape).volume / volume - 1)).toBeLessThan(0.01);
    } finally {
      kernel.release(shape);
    }
  });

  it('re-seams a merged band whose split edge was a diagonal, so Offset Face works (2026-10-25)', () => {
    // A 260-step staircase (521 planes: over the exact stage's 500-surface
    // cap, so the hybrid rebuilds it, no facets) under a disc r 8 h 1.2 of
    // 181 segments whose top ring is turned half a segment: no wall edge is
    // vertical, so the split edge unify keeps as the merged wall's seam is a
    // diagonal, π/181 off an isoline. OCCT's offset builds nothing on a body
    // with such a seam; Mesh to Solid moves it onto an isoline.
    const steps = 260;
    const w = 0.15;
    const outline: [number, number][] = [
      [0, 0],
      [steps * w, 0],
    ];
    for (let i = 0; i < steps; i++)
      outline.push([(steps - i) * w, (i + 1) * w], [(steps - i - 1) * w, (i + 1) * w]);
    const section = new manifold.CrossSection([outline]);
    const stairs = section.extrude(4);
    section.delete();
    const n = 181;
    const r = 8;
    const centre = (steps * w * (2 - Math.SQRT2)) / 2; // the staircase's incircle
    const nodes: number[] = [];
    for (let ring = 0; ring < 2; ring++) {
      for (let i = 0; i < n; i++) {
        const a = (2 * Math.PI * (i + ring / 2)) / n;
        nodes.push(centre + r * Math.cos(a), centre + r * Math.sin(a), 4 + 1.2 * ring);
      }
    }
    nodes.push(centre, centre, 4, centre, centre, 5.2);
    const triangles: number[] = [];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      triangles.push(i, j, n + i, j, n + j, n + i, 2 * n, j, i, 2 * n + 1, n + i, n + j);
    }
    const disc = new manifold.Manifold(
      new manifold.Mesh({
        numProp: 3,
        vertProperties: Float32Array.from(nodes),
        triVerts: Uint32Array.from(triangles),
      }),
    );
    const part = stairs.add(disc);
    stairs.delete();
    disc.delete();
    const { shape, report } = prismatic(meshOf(part), -1);
    try {
      expect(report).toMatchObject({ rebuild: 'hybrid', cylinders: 1, facets: 0 });
      expect(kernel.isValid(shape)).toBe(true);
      const faces = kernel.describe(shape).faces;
      const top = faces.findIndex(
        (f) => f.type === 'plane' && Math.abs((f.centroid[2] as number) - 5.2) < 1e-3,
      );
      expect(top).toBeGreaterThanOrEqual(0);
      const before = kernel.properties(shape).volume;
      const moved = kernel.offsetFaces(shape, [top], 1);
      try {
        expect(kernel.isValid(moved.shape)).toBe(true);
        // The disc's top rises 1 mm: π r² more.
        expect(kernel.properties(moved.shape).volume - before).toBeCloseTo(Math.PI * r * r, 0);
      } finally {
        kernel.release(moved.shape);
      }
    } finally {
      kernel.release(shape);
    }
  });
});

describe('Mesh to Solid, the hybrid’s chains (ADR-0097 slice D3)', { timeout: 300_000 }, () => {
  it('splits a box’s boundaries into 12 chains, each a line', () => {
    const { mesh } = readStl(bytesOf(cubeStl));
    const { chains } = chainsAndLoopsOf(mesh.positions, mesh.indices);
    expect(chains).toHaveLength(12);
    for (const chain of chains) expect(chain).toMatchObject({ closed: false, edges: 1, curve: 0 });
  });

  it('gives a through hole’s rims as circle chains, and keeps the split wall’s seams', () => {
    const solid = plate();
    const exported = kernel.exportMesh(solid, { linearDeflection: 0.01, angularDeflection: 0.2 });
    kernel.release(solid);
    const { positions, indices } = weldByPosition(exported);
    const { regions, chains } = chainsAndLoopsOf(positions, indices);
    const kindOf = (r: number) => regions[r]?.kind;
    const pairs = chains.map((c) => [kindOf(c.left), kindOf(c.right)].sort().join('|'));
    // The box's 12 edges, the two rims (one chain per half of the wall on each
    // face) and the two seams between the halves (one surface: no curve).
    expect(pairs.filter((p) => p === '0|0')).toHaveLength(12);
    expect(chains.filter((c, i) => pairs[i] === '0|0' && c.curve === 0)).toHaveLength(12);
    const rims = chains.filter((_, i) => pairs[i] === '0|1');
    expect(rims).toHaveLength(4);
    for (const rim of rims) expect(rim).toMatchObject({ closed: false, curve: 1 });
    const seams = chains.filter((_, i) => pairs[i] === '1|1');
    expect(seams).toHaveLength(2);
    for (const seam of seams) expect(seam.curve).toBe(-1);
  });

  it('closes a cap’s rim chain when one region is on each side', () => {
    // A plate whose 32-gon boss stands on a box: the cylinder is split, so
    // its rims are two arcs each; a sphere cap (one region, under 3/4 of a
    // turn) on a plane is one closed circle chain.
    const box = manifold.Manifold.cube([30, 30, 10]);
    const ball = manifold.Manifold.sphere(6, 96).translate([15, 15, 8]);
    const part = box.add(ball);
    box.delete();
    ball.delete();
    const { positions, indices } = trianglesOf(part);
    const { regions, chains } = chainsAndLoopsOf(positions, indices);
    const closed = chains.filter((c) => c.closed);
    expect(closed).toHaveLength(1);
    const [cap] = closed;
    expect([regions[cap?.left ?? -1]?.kind, regions[cap?.right ?? -1]?.kind].sort()).toEqual([
      0, 3,
    ]);
    expect(cap?.curve).toBe(1);
  });

  it('collapses a through hole’s rims into circles that take a fillet', () => {
    // The boss's freeform top makes the exact stage skip: the hybrid runs.
    const part = bossWithBump();
    const hole = manifold.Manifold.cylinder(12, 3, 3, 32).translate([6, 6, -1]);
    const holed = part.subtract(hole);
    part.delete();
    hole.delete();
    const volume = holed.volume();
    const { shape, report } = prismatic(meshOf(holed));
    try {
      expect(report.rebuild).toBe('hybrid');
      expect(kernel.isValid(shape)).toBe(true);
      expect(Math.abs(kernel.properties(shape).volume / volume - 1)).toBeLessThan(0.01);
      // The wall: one cylinder of r 3 (its halves merged back), its rims circles.
      expect(radii(shape).filter((r) => Math.abs(r - 3) < 0.02)).toHaveLength(1);
      const edges = edgesOf(shape);
      const rims = edges.filter(
        (e) => e.type === 'circle' && Math.abs((e.conic?.radius ?? 0) - 3) < 0.02,
      );
      const top = rims.find((e) => Math.abs((e.conic?.center[2] ?? 0) - 10) < 0.02);
      expect(top).toBeDefined();
      expect(rims.filter((e) => Math.abs(e.conic?.center[2] ?? 1) < 0.02).length).toBeGreaterThan(
        0,
      );
      // The polygon's 32 sides per rim are gone: a circle or two arcs.
      expect(rims.length).toBeLessThanOrEqual(4);
      // STEP carries them as circles.
      expect(kernel.writeStep([{ shape, name: 'Holed' }])).toMatch(/= CIRCLE\(/);
      const filleted = kernel.fillet(shape, [top?.index ?? -1], 0.5).shape;
      try {
        expect(kernel.isValid(filleted)).toBe(true);
        expect(kinds(filleted)).toContain('torus');
        expect(kernel.count(filleted, 'face')).toBe(kernel.count(shape, 'face') + 1);
      } finally {
        kernel.release(filleted);
      }
    } finally {
      kernel.release(shape);
    }
  });

  it('gives the boss with a freeform top one line per box edge and one circle round the boss', () => {
    const part = bossWithBump();
    const { shape, report } = prismatic(meshOf(part));
    try {
      expect(report.rebuild).toBe('hybrid');
      const edges = edgesOf(shape);
      // The box's edges: lines from corner to corner (the bump's facets add
      // their own triangle sides, lines too).
      const corner = (p: readonly number[] | undefined) =>
        p !== undefined &&
        [30, 30, 10].every(
          (size, k) => Math.abs(p[k] as number) < 1e-6 || Math.abs((p[k] as number) - size) < 1e-6,
        );
      const boxEdges = edges.filter(
        (e) => e.type === 'line' && corner(e.points[0]) && corner(e.points[e.points.length - 1]),
      );
      expect(boxEdges).toHaveLength(12);
      // The boss's rim on the box: the two halves' arcs, one circle after unify.
      const rims = edges.filter(
        (e) => e.type === 'circle' && Math.abs((e.conic?.radius ?? 0) - 5) < 0.02,
      );
      expect(rims).toHaveLength(1);
      expect(rims[0]?.conic?.center[2]).toBeCloseTo(10, 6);
    } finally {
      kernel.release(shape);
    }
  });
});

describe('Kernel.meshRegions', { timeout: 300_000 }, () => {
  /** The regions of `mesh` (released). */
  function regionsOf(mesh: ShapeHandle, tolerance = 0.01) {
    try {
      return kernel.meshRegions(mesh, tolerance);
    } finally {
      kernel.release(mesh);
    }
  }

  it('gives cube.stl six planes, one per pair of triangles', () => {
    const regions = regionsOf(cube());
    expect(regions.surfaceOf).toHaveLength(12);
    expect(Array.from(regions.kinds)).toEqual(Array(6).fill(0));
    expect(new Set(regions.surfaceOf).size).toBe(6);
    expect(regions).toMatchObject({
      planes: 6,
      cylinders: 0,
      unfit: { regions: 0, triangles: 0, fraction: 0 },
    });
    expect(regions.suggestedTolerance).toBeUndefined();
  });

  it("puts a 32-gon's side on its cylinder, in the view mesh's triangle order", () => {
    const mesh = meshOf(manifold.Manifold.cylinder(20, 5, 5, 32));
    // The view's triangles (`BodyMesh.indices` / 3) are the ones regions map onto.
    const view = kernel.mesh(mesh, { linearDeflection: 1, angularDeflection: 1 });
    const regions = regionsOf(mesh);
    expect([...regions.kinds].sort()).toEqual([0, 0, 1]);
    const cylinder = regions.kinds.indexOf(1);
    const triangles = view.indices.length / 3;
    expect(regions.surfaceOf).toHaveLength(triangles);
    let side = 0;
    for (let t = 0; t < triangles; t++) {
      const z = [0, 1, 2].map((k) => view.positions[3 * (view.indices[3 * t + k] as number) + 2]);
      const flat = z[0] === z[1] && z[1] === z[2];
      if (!flat) side++;
      expect(regions.surfaceOf[t] === cylinder).toBe(!flat);
    }
    expect(side).toBe(64);
  });

  it('marks an ellipsoid as one unfit surface', () => {
    const sphere = manifold.Manifold.sphere(10, 48);
    const ellipsoid = sphere.scale([1, 1, 0.6]);
    sphere.delete();
    const regions = regionsOf(meshOf(ellipsoid));
    expect(Array.from(regions.kinds)).toEqual([-1]);
    expect(regions.surfaceOf.every((s) => s === 0)).toBe(true);
    expect(regions.unfit.regions).toBe(1);
    expect(regions.unfit.fraction).toBe(1);
  });

  it('puts a sphere on one sphere surface', () => {
    const regions = regionsOf(meshOf(manifold.Manifold.sphere(10, 48)));
    expect(Array.from(regions.kinds)).toEqual([3]);
    expect(regions.spheres).toBe(1);
    expect(regions.cones).toBe(0);
    expect(regions.unfit.regions).toBe(0);
  });

  it('puts a donut on one torus surface', () => {
    const regions = regionsOf(meshOfSolid(donut(), 0.01, 0.2));
    expect(Array.from(regions.kinds)).toEqual([4]);
    expect(regions.tori).toBe(1);
    expect(regions.unfit.regions).toBe(0);
  });

  it("splits the filleted box's ring into cylinders and spheres", () => {
    const rounded = filleted(kernel.box([20, 20, 20]), 2, () => true);
    const regions = regionsOf(meshOfSolid(rounded, 0.01, 0.2));
    const kinds = Array.from(regions.kinds);
    expect(kinds).toContain(1);
    expect(kinds).toContain(3);
    expect(kinds).not.toContain(-1);
    expect(regions).toMatchObject({ planes: 6, cylinders: 12, spheres: 8 });
  });

  it('suggests a tolerance for the noisy 32-gon at 0.001 mm', () => {
    const regions = regionsOf(noisyCylinder(), 0.001);
    // The sphere through the two rings also nearly fits, so ~0.003, not 0.006.
    expect(regions.suggestedTolerance).toBeGreaterThanOrEqual(0.002);
    expect(regions.suggestedTolerance).toBeLessThanOrEqual(0.02);
  });

  it('refuses a solid, and reads a tolerance of 0 as Auto (slice D2)', () => {
    const box = kernel.box([1, 1, 1]);
    try {
      expect(() => kernel.meshRegions(box, 0.01)).toThrow(
        new KernelError('Mesh to Solid needs a mesh body: this body is already a solid.'),
      );
    } finally {
      kernel.release(box);
    }
    // 0 (or less) means Auto now: the cube still segments into six planes.
    const regions = regionsOf(cube(), 0);
    expect(regions.planes).toBe(6);
    expect(regions.tolerance).toBe(0.01);
    expect(regions.auto).toBe(true);
  });

  it('segments a 500k-triangle sphere in under 3 s, and agrees with the conversion on a plate', () => {
    const sphere = meshOf(manifold.Manifold.sphere(10, 1000));
    let start = performance.now();
    const regions = regionsOf(sphere);
    const sphereMs = performance.now() - start;
    expect(regions.surfaceOf.length).toBeGreaterThan(400_000);
    expect(Array.from(regions.kinds)).toEqual([3]);
    expect(regions.spheres).toBe(1);
    const platePieces = meshOfSolid(plate(), 0.0002, 0.0025);
    start = performance.now();
    const plateRegions = kernel.meshRegions(platePieces, 0.01);
    const plateMs = performance.now() - start;
    start = performance.now();
    const { shape, report } = prismatic(platePieces);
    const convertMs = performance.now() - start;
    kernel.release(shape);
    console.log(
      `meshRegions: sphere ${regions.surfaceOf.length} triangles in ${sphereMs.toFixed(0)} ms; plate ${plateRegions.surfaceOf.length} triangles in ${plateMs.toFixed(0)} ms (converted in ${convertMs.toFixed(0)} ms)`,
    );
    expect(plateRegions).toMatchObject({ planes: report.planes, cylinders: report.cylinders });
    expect(sphereMs).toBeLessThan(3000);
  });

  it('times a 302-surface staircase: regions, then the conversion', () => {
    const steps = 149;
    const outline: [number, number][] = [
      [0, 0],
      [steps, 0],
    ];
    for (let i = 0; i < steps; i++) outline.push([steps - i, i + 1], [steps - i - 1, i + 1]);
    const section = new manifold.CrossSection([outline]);
    const solid = section.extrude(5);
    section.delete();
    const mesh = meshOf(solid);
    let start = performance.now();
    const regions = kernel.meshRegions(mesh, 0.01);
    const regionsMs = performance.now() - start;
    start = performance.now();
    const { shape, report } = prismatic(mesh);
    const convertMs = performance.now() - start;
    kernel.release(shape);
    console.log(
      `meshRegions: staircase ${regions.kinds.length} surfaces in ${regionsMs.toFixed(0)} ms; converted in ${convertMs.toFixed(0)} ms (${report.faces} faces)`,
    );
    expect(regions.planes).toBe(302);
    expect(report.faces).toBe(302);
  });

  it('drops the mesh’s zero-volume flaps, so the preview matches the conversion (2026-10-25e)', () => {
    // `bossWithBump`'s own boolean leaves the body plus 46 flat zero-volume
    // components (the box top and the cylinder base are coplanar). The
    // conversion drops them; the preview must too, so its regions and counts
    // agree, and its per-triangle array stays in the staged triangle order.
    const mesh = meshOf(bossWithBump());
    try {
      const view = kernel.mesh(mesh, { linearDeflection: 1, angularDeflection: 1 });
      const triangles = view.indices.length / 3;
      const preview = kernel.meshRegions(mesh, 0.01);
      const { shape, report } = kernel.meshToSolid(mesh, { method: 'prismatic', tolerance: 0.01 });
      try {
        expect(preview.surfaceOf).toHaveLength(triangles);
        expect(preview.unfit.regions).toBe(report.unfit.regions);
        expect(preview.planes).toBe(report.planes);
        expect(preview.cylinders).toBe(report.cylinders);
        // Without the drop the flaps were 92 further plane surfaces (100).
        expect(preview.planes).toBeLessThan(30);
      } finally {
        kernel.release(shape);
      }
    } finally {
      kernel.release(mesh);
    }
  });
});
