import type { Kernel, ShapeHandle } from './kernel';
import type { BodyMesh, Measurements, MeshOptions } from './mesh';

/**
 * The P0-02 scenario part: a 40 × 30 × 20 mm box, its four vertical edges
 * filleted (r = 3 mm), and a Ø8 mm hole through it. The debug command renders
 * it, and the kernel tests and the memory test build it.
 */
export const TEST_PART = {
  size: [40, 30, 20],
  filletRadius: 3,
  holeRadius: 4,
  /** Analytic volume in mm³: box − 4 fillet corners − hole. */
  volume: 40 * 30 * 20 - 4 * (3 * 3 - (Math.PI * 3 * 3) / 4) * 20 - Math.PI * 4 * 4 * 20,
  faces: 11,
} as const;

export const TEST_PART_MESH: MeshOptions = { linearDeflection: 0.05, angularDeflection: 0.3 };

export interface TestPart {
  mesh: BodyMesh;
  measurements: Measurements;
  faces: number;
  edges: number;
  valid: boolean;
  /** Time to build, check, measure and mesh, in ms. */
  ms: number;
}

/**
 * Builds the test part and returns its handle; intermediate shapes are
 * released. The caller owns the result.
 */
export function buildTestPart(kernel: Kernel): ShapeHandle {
  const [x, y, z] = TEST_PART.size;
  using scope = kernel.scope();
  const box = scope.track(kernel.box(TEST_PART.size));
  const filleted = scope.track(
    kernel.fillet(box, verticalEdges(kernel, box), TEST_PART.filletRadius),
  );
  const hole = scope.track(kernel.cylinder(TEST_PART.holeRadius, z + 2, [x / 2, y / 2, -1]));
  return kernel.cut(filleted.shape, hole).shape;
}

/** Builds, checks, measures and meshes the test part, then releases it. */
export function makeTestPart(kernel: Kernel): TestPart {
  const start = performance.now();
  const part = buildTestPart(kernel);
  try {
    return {
      valid: kernel.isValid(part),
      measurements: kernel.measure(part),
      faces: kernel.count(part, 'face'),
      edges: kernel.count(part, 'edge'),
      mesh: kernel.mesh(part, TEST_PART_MESH),
      ms: performance.now() - start,
    };
  } finally {
    kernel.release(part);
  }
}

/**
 * Indices of a box's edges parallel to Z. A primitive's edge order is fixed
 * for a given OCCT build, but reading it from the edge geometry keeps this
 * independent of that.
 */
function verticalEdges(kernel: Kernel, shape: ShapeHandle): number[] {
  const { edgePoints, edgeRanges } = kernel.mesh(shape, {
    linearDeflection: 1,
    angularDeflection: 1,
  });
  const vertical: number[] = [];
  for (let edge = 0; edge < edgeRanges.length / 2; edge++) {
    const first = edgeRanges[2 * edge] ?? 0;
    const count = edgeRanges[2 * edge + 1] ?? 0;
    if (count < 2) continue;
    const a = 3 * first;
    const b = 3 * (first + count - 1);
    const dx = (edgePoints[b] ?? 0) - (edgePoints[a] ?? 0);
    const dy = (edgePoints[b + 1] ?? 0) - (edgePoints[a + 1] ?? 0);
    if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) vertical.push(edge);
  }
  return vertical;
}
