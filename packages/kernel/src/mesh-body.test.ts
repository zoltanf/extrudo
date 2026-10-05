/**
 * Mesh bodies (P4-06, ADR-0066 §3): handles the `Kernel` owns above
 * `MESH_HANDLE_BASE`, backed by manifold-3d instead of OCCT. Real OCCT and a
 * real manifold module; the guards are what every other feature relies on.
 */
import { checkManifold, writeStl } from '@extrudo/io';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { IDENTITY, translation } from './features/matrix';
import {
  Kernel,
  KernelError,
  MESH_HANDLE_BASE,
  MeshBodyError,
  MeshError,
  type ShapeHandle,
} from './index';
import { loadManifold } from './manifold';
import { EDGE_MESH } from './mesh';
import { loadOcct } from './occt/load';
import type { OcctModule } from './occt/types';

let kernel: Kernel;
let manifold: Awaited<ReturnType<typeof loadManifold>>;

beforeAll(async () => {
  kernel = new Kernel(await loadOcct());
  manifold = await loadManifold();
  kernel.enableMeshes(manifold);
});

afterAll(() => kernel.dispose());

/** A w × d × h box as triangles, in mm. */
function box(w: number, d: number, h: number, at: [number, number, number] = [0, 0, 0]) {
  const [x, y, z] = at;
  const positions = new Float64Array([
    x,
    y,
    z,
    x + w,
    y,
    z,
    x + w,
    y + d,
    z,
    x,
    y + d,
    z,
    x,
    y,
    z + h,
    x + w,
    y,
    z + h,
    x + w,
    y + d,
    z + h,
    x,
    y + d,
    z + h,
  ]);
  // biome-ignore format: two triangles per side
  const indices = new Uint32Array([
    0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 2, 3, 7, 2, 7, 6, 1, 2, 6, 1, 6, 5, 3, 0, 4,
    3, 4, 7,
  ]);
  return { positions, indices };
}

/** A 10 mm cube as a mesh body. */
const cube = () => kernel.meshFrom(box(10, 10, 10));

describe('a mesh body', () => {
  it('is a handle of its own, with the exact volume and box of a 10 mm cube', () => {
    const handle = cube();
    expect(handle).toBeGreaterThanOrEqual(MESH_HANDLE_BASE);
    expect(kernel.isMesh(handle)).toBe(true);
    expect(kernel.measure(handle).volume).toBeCloseTo(1000, 3);
    expect(kernel.measure(handle).bbox).toEqual({
      min: [0, 0, 0],
      max: [10, 10, 10],
    });
    expect(kernel.properties(handle)).toMatchObject({
      volume: 1000,
      area: 600,
      length: 0,
      // No centre of mass in manifold-3d: the centre of the box (ADR-0066 §3).
      centroid: [5, 5, 5],
    });
    expect(kernel.describe(handle).faces).toHaveLength(1);
    expect(kernel.describe(handle).edges).toEqual([]);
    expect(kernel.describe(handle).vertices).toEqual([]);
    expect(kernel.count(handle, 'face')).toBe(1);
    expect(kernel.count(handle, 'edge')).toBe(0);
    expect(kernel.isValid(handle)).toBe(true);
    expect(kernel.stats().liveShapes).toBe(1);
    kernel.release(handle);
    expect(kernel.stats().liveShapes).toBe(0);
  });

  it('refuses a mesh that is not closed, with the open edge count', () => {
    const open = box(10, 10, 10);
    // A cube missing one triangle: three open edges.
    const missing = { ...open, indices: open.indices.slice(0, open.indices.length - 3) };
    expect(checkManifold(missing).boundaryEdges).toBe(3);
    let thrown: MeshError | undefined;
    try {
      kernel.meshFrom(missing);
    } catch (error) {
      thrown = error as MeshError;
    }
    expect(thrown).toBeInstanceOf(MeshError);
    expect(thrown?.message).toMatch(/3 open edges/);
    expect(thrown?.problem?.openEdges).toBe(3);
  });

  it('refuses a mesh that faces the wrong way', () => {
    const inside = box(10, 10, 10);
    // Every triangle the other way round: closed, but inside-out.
    const flipped = {
      ...inside,
      indices: Uint32Array.from(
        Array.from({ length: 12 }, (_, t) => [
          inside.indices[3 * t],
          inside.indices[3 * t + 2],
          inside.indices[3 * t + 1],
        ]).flat(),
      ),
    };
    expect(() => kernel.meshFrom(flipped)).toThrow(/triangles face inwards/);
  });

  it('needs the mesh kernel, which a design without one never loads', () => {
    // A Kernel whose module never called `enableMeshes`: nothing of OCCT's is
    // used here, so a facade that only exists is enough.
    const bare = new Kernel({ ExtrudoFacade: class {} } as unknown as OcctModule);
    expect(bare.meshesEnabled()).toBe(false);
    expect(() => bare.meshFrom(box(10, 10, 10))).toThrow(/need the mesh kernel/);
    expect(kernel.meshesEnabled()).toBe(true);
  });

  it('gives the box of a sphere, and its connected pieces', () => {
    const sphereMesh = manifold.Manifold.sphere(10, 32);
    const gl = sphereMesh.getMesh();
    const sphere = kernel.meshFrom({
      positions: Float64Array.from(gl.vertProperties),
      indices: gl.triVerts,
    });
    const { volume, bbox } = kernel.measure(sphere);
    expect(volume).toBeGreaterThan(3000);
    expect(volume).toBeLessThan(4200);
    expect(bbox.min[0]).toBeCloseTo(-10, 1);
    kernel.release(sphere);

    // Two boxes in one mesh: the import evaluator splits them, not this.
    const left = box(10, 10, 10);
    const right = box(10, 10, 10, [20, 0, 0]);
    const two = {
      positions: new Float64Array(48),
      indices: new Uint32Array(72),
    };
    two.positions.set(left.positions);
    two.positions.set(right.positions, 24);
    two.indices.set(left.indices, 0);
    for (let i = 0; i < 36; i++) two.indices[36 + i] = (right.indices[i] as number) + 8;
    const joined = kernel.meshFrom(two);
    const pieces = kernel.solids(joined);
    expect(pieces).toHaveLength(2);
    for (const piece of pieces) expect(kernel.isMesh(piece)).toBe(true);
    kernel.release(joined, ...pieces);
    expect(kernel.stats().liveShapes).toBe(0);
  });
});

describe('meshing a mesh body for the view', () => {
  it('is one face of all the triangles with flat normals and 12 creases', () => {
    using scope = kernel.scope();
    const mesh = kernel.mesh(scope.track(cube()), {
      linearDeflection: 0.05,
      angularDeflection: 0.3,
    });
    expect(mesh.faceRanges).toEqual(new Uint32Array([0, 12]));
    expect(mesh.mesh).toBe(true);
    expect(mesh.vertices).toHaveLength(0);
    // A box's twelve edges are all creases, and all of them are mesh edges.
    expect(mesh.edgeRanges.length / 2).toBe(12);
    expect(Array.from(mesh.edgeFlags).every((flag) => flag === EDGE_MESH)).toBe(true);
    // Each of the six sides is flat: every normal of a triangle is one of the
    // six axis directions, and a corner has three nodes.
    const normals = new Set<string>();
    for (let n = 0; n < mesh.normals.length; n += 3) {
      normals.add(
        [0, 1, 2].map((k) => Math.round((mesh.normals[n + k] as number) * 1e5) / 1e5).join(','),
      );
    }
    expect([...normals].sort()).toEqual(
      ['0,0,-1', '0,0,1', '0,-1,0', '0,1,0', '-1,0,0', '1,0,0'].sort(),
    );
    // Each of the eight corners carries the three normals of its sides.
    expect(mesh.positions.length / 3).toBe(24);
  });

  it('is smooth on a sphere: one node per vertex and no creases', () => {
    using scope = kernel.scope();
    const sphere = manifold.Manifold.sphere(10, 32);
    const gl = sphere.getMesh();
    const handle = scope.track(
      kernel.meshFrom({
        positions: Float64Array.from(gl.vertProperties),
        indices: gl.triVerts,
      }),
    );
    const mesh = kernel.mesh(handle, { linearDeflection: 0.05, angularDeflection: 0.3 });
    const triangles = gl.triVerts.length / 3;
    // Every triangle keeps its own three nodes, but no edge is a crease and
    // the node count is the sphere's, not three times the triangles'.
    expect(mesh.faceRanges).toEqual(new Uint32Array([0, triangles]));
    expect(mesh.edgeFlags).toHaveLength(0);
    expect(mesh.positions.length / 3).toBeLessThanOrEqual(gl.vertProperties.length / 3);
    expect(mesh.positions.length / 3).toBeGreaterThan(0);
  });

  it('exports the triangles as they are', () => {
    using scope = kernel.scope();
    const exported = kernel.exportMesh(scope.track(cube()), {
      linearDeflection: 0.02,
      angularDeflection: 0.2,
    });
    expect(exported.indices.length).toBe(36);
    expect(exported.positions.length / 3).toBe(8);
    expect(checkManifold(exported).ok).toBe(true);
  });

  it('round trips through our own STL writer', () => {
    using scope = kernel.scope();
    const bytes = writeStl(
      kernel.exportMesh(scope.track(cube()), {
        linearDeflection: 0.05,
        angularDeflection: 0.3,
      }),
    );
    expect(bytes.length).toBe(84 + 12 * 50);
  });
});

describe('transforming a mesh body', () => {
  it('moves its box, with no history', () => {
    const handle = cube();
    const { shape, history } = kernel.transform(handle, translation([5, 0, 0]));
    expect(kernel.isMesh(shape)).toBe(true);
    expect(history).toEqual([]);
    expect(kernel.measure(shape).bbox.min).toEqual([5, 0, 0]);
    // The input keeps its own place: transform copies, like OCCT's.
    expect(kernel.measure(handle).bbox.min).toEqual([0, 0, 0]);
    kernel.release(handle, shape);
  });

  it('is the identity for the identity matrix', () => {
    const handle = cube();
    const { shape } = kernel.transform(handle, IDENTITY);
    expect(kernel.measure(shape).bbox).toEqual({ min: [0, 0, 0], max: [10, 10, 10] });
    kernel.release(handle, shape);
  });
});

describe('operations that need a solid', () => {
  /** Every public method that takes a shape and can't work on a mesh. */
  const guarded: [string, (shape: ShapeHandle) => unknown, string][] = [
    ['fillet', (s) => kernel.fillet(s, [0], 1), 'Fillet'],
    ['filletVariable', (s) => kernel.filletVariable(s, [0], [[1, 2]]), 'Fillet'],
    ['tangentChain', (s) => kernel.tangentChain(s, 0), 'Fillet'],
    ['chamfer', (s) => kernel.chamfer(s, [0], { mode: 'equal', distance: 1 }), 'Chamfer'],
    ['shell', (s) => kernel.shell(s, [], 1), 'Shell'],
    ['offsetFaces', (s) => kernel.offsetFaces(s, [0], 1), 'Press Pull'],
    ['tangentFaces', (s) => kernel.tangentFaces(s, 0), 'Press Pull'],
    ['draft', (s) => kernel.draft(s, [0], { origin: [0, 0, 0], normal: [0, 0, 1] }, 0.1), 'Draft'],
    ['prism', (s) => kernel.prism(s, [0, 0, 1]), 'Extrude'],
    [
      'revolve',
      (s) => kernel.revolve(s, { origin: [0, 0, 0], direction: [0, 0, 1] }, 1),
      'Revolve',
    ],
    ['sweep', (s) => kernel.sweep(s, s), 'Sweep'],
    [
      'threadSweep',
      (s) => kernel.threadSweep(s, { origin: [0, 0, 0], direction: [0, 0, 1] }, 2, 2, false),
      'Thread',
    ],
    ['threadFace', (s) => kernel.threadFace(s, 0), 'Thread'],
    // Emboss asks for the same geometry and names itself (ADR-0066 §4).
    ['threadFace for an Emboss', (s) => kernel.threadFace(s, 0, 'Emboss'), 'Emboss'],
    [
      'wrapOnCylinder',
      (s) =>
        kernel.wrapOnCylinder(
          s,
          {
            origin: [0, 0, 0],
            axis: [0, 0, 1],
            reference: [1, 0, 0],
            radius: 10,
            corner: [10, 0, 0],
            across: [0, 1, 0],
          },
          1,
        ),
      'Emboss',
    ],
    ['subShape', (s) => kernel.subShape(s, 'face', 0), 'Sketch on face'],
    ['locate', (s) => kernel.locate(s, s, 'face'), 'Split Body'],
    ['edgeGeometry', (s) => kernel.edgeGeometry(s, 0), 'Project'],
    ['faceSilhouettes', (s) => kernel.faceSilhouettes(s, 0, [0, 0, 1]), 'Sketch on face'],
    ['surfaceGeometry', (s) => kernel.surfaceGeometry(s, 0), 'Construction geometry'],
    ['distance', (s) => kernel.distance(s, s), 'Measure'],
    ['compound', (s) => kernel.compound([s]), 'Combine'],
    ['writeStep', (s) => kernel.writeStep([{ shape: s, name: 'Mesh' }]), 'A STEP file'],
  ];

  it.each(guarded)(
    '%s refuses with MeshBodyError naming the operation',
    (name, call, operation) => {
      const handle = cube();
      const live = kernel.stats().liveShapes;
      let thrown: unknown;
      try {
        call(handle);
      } catch (error) {
        thrown = error;
      }
      expect(thrown, name).toBeInstanceOf(MeshBodyError);
      expect((thrown as Error).message).toBe(
        `${operation} needs a solid body: this body is a mesh (imported, or combined with a mesh).`,
      );
      // The refusal is a KernelError, so the engine makes it the feature's error.
      expect(thrown).toBeInstanceOf(KernelError);
      // A refusal builds nothing: the mesh is still the only thing held.
      expect(kernel.stats().liveShapes).toBe(live);
      kernel.release(handle);
    },
  );

  it('splits along a plane, and refuses to split a solid that way', () => {
    // Split Body on a mesh body is manifold's own split (ADR-0066 §4).
    const handle = cube();
    const [above, below] = kernel.splitByPlane(handle, [1, 0, 0], 5);
    expect(kernel.measure(above as ShapeHandle).volume).toBeCloseTo(500, 0);
    expect(kernel.measure(below as ShapeHandle).volume).toBeCloseTo(500, 0);
    // A plane that misses the body: the whole body is on the normal's side, and
    // the other side has nothing in it.
    const [whole, none] = kernel.splitByPlane(handle, [1, 0, 0], -5);
    expect(none).toBeNull();
    expect(kernel.measure(whole as ShapeHandle).volume).toBeCloseTo(1000, 0);
    kernel.release(handle, ...([above, below, whole].filter(Boolean) as ShapeHandle[]));
    // A solid is split with a half-space box, not with this.
    const solid = kernel.box([10, 10, 10]);
    expect(() => kernel.splitByPlane(solid, [1, 0, 0], 5)).toThrow(/Only a mesh body/);
    kernel.release(solid);
  });

  it('measures the gap to a solid by meshing it (ADR-0066 §4)', () => {
    const handle = cube();
    const apart = kernel.box([10, 10, 10], [10.5, 0, 0]);
    const apartBy = kernel.box([10, 10, 10], [12, 0, 0]);
    // manifold's minGap caps its answer at the length it searches.
    expect(kernel.minGap(handle, apart)).toBeCloseTo(0.5, 6);
    expect(kernel.minGap(handle, apartBy, 3)).toBeCloseTo(2, 6);
    expect(kernel.minGap(handle, apartBy, 1)).toBe(1);
    expect(kernel.minGap(handle, kernel.box([2, 2, 2], [1, 1, 1]))).toBe(0);
    // Two solids are OCCT's own distance, as before.
    expect(kernel.minGap(handle, kernel.box([10, 10, 10], [10.5, 0, 0]), 1)).toBeCloseTo(0.5, 3);
    kernel.release(handle, apart, apartBy);
  });
});

describe('a scope', () => {
  it('releases meshes it holds, even when the work throws', () => {
    const start = kernel.stats().liveShapes;
    using scope = kernel.scope();
    scope.track(cube());
    expect(kernel.stats().liveShapes).toBe(start + 1);
    expect(() => {
      using inner = kernel.scope();
      inner.track(cube());
      throw new Error('a feature gave up');
    }).toThrow('a feature gave up');
    expect(kernel.stats().liveShapes).toBe(start + 1);
  });

  it('keeps a mesh that the scope is told to keep', () => {
    const start = kernel.stats().liveShapes;
    using scope = kernel.scope();
    // A transform copies: its input is the caller's to release and the copy
    // is what the scope is told to keep.
    const moved = kernel.transform(scope.track(cube()), translation([1, 0, 0])).shape;
    scope.track(moved);
    expect(kernel.stats().liveShapes).toBe(start + 2);
    expect(kernel.measure(moved).bbox.min).toEqual([1, 0, 0]);
    kernel.release(moved);
    expect(kernel.stats().liveShapes).toBe(start + 1);
  });
});
