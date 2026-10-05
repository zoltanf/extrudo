// Mass properties of bodies whose faces are B-splines (P4-12 H3,
// ADR-0067 §H3). The facade integrates BRepGProp to an error bound
// (MASS_EPS = 1e-7) instead of with OCCT's fixed Gauss order, which was 1-2 %
// out on these: a loft's side wall, a conic profile's edge, a wrap's walls
// (ADR-0060 §3, tightened in wrap.test.ts).
//
// Every body here is checked against the volume of a fine tessellation of
// itself, which the integrator shares nothing with. The tessellation has its
// own error -- a chord stands in for the curve -- so 1e-4 is the agreement to
// expect, and where a closed form exists (a frustum) it is checked too.
// Real OCCT in Node.
import { conicPoint, type Vec2 } from '@extrudo/core';
import { SketchBuilder } from '@extrudo/sketch/fixtures';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { planarCurves } from './features/sketch';
import { Kernel, type ShapeHandle } from './kernel';
import { loadOcct } from './occt/load';
import type { PlanarCurve, PlanarFace, PlanarFrame } from './planar';

/**
 * The tessellation each body is compared against. It has to be much finer
 * than the 1e-4 it is asked to agree to: a chord of `d` mm stands in for the
 * curve under it, so the volume is off by about (surface area x d / 2) -- for
 * the loft below that is 8.8e-5 at 0.001 mm, and for the thinner conic body
 * under 1e-4 at 0.0005 mm.
 */
const LOFT_FINE = { linearDeflection: 0.001, angularDeflection: 0.2 };
const CONIC_FINE = { linearDeflection: 0.0005, angularDeflection: 0.05 };

let kernel: Kernel;

beforeAll(async () => {
  kernel = new Kernel(await loadOcct());
});

afterAll(() => {
  expect(kernel.stats().liveShapes).toBe(0);
});

/**
 * The volume of a closed triangulation, its triangles summed as tetrahedra
 * round the origin (the divergence theorem). This is what an exporter's volume
 * is, and what a slicer sees.
 */
function meshVolume(
  shape: ShapeHandle,
  fine: { linearDeflection: number; angularDeflection: number },
) {
  const mesh = kernel.exportMesh(shape, fine);
  const p = mesh.positions;
  let total = 0;
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const a = (mesh.indices[i] as number) * 3;
    const b = (mesh.indices[i + 1] as number) * 3;
    const c = (mesh.indices[i + 2] as number) * 3;
    const ax = p[a] as number;
    const ay = p[a + 1] as number;
    const az = p[a + 2] as number;
    const bx = p[b] as number;
    const by = p[b + 1] as number;
    const bz = p[b + 2] as number;
    const cx = p[c] as number;
    const cy = p[c + 1] as number;
    const cz = p[c + 2] as number;
    total += ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx);
  }
  return { volume: total / 6, triangles: mesh.indices.length / 3 };
}

/** A circle in a plane, as a face of its own. The caller releases it. */
function circleFace(frame: PlanarFrame, radius: number): PlanarFace {
  const curves: PlanarCurve[] = [
    { kind: 'ellipse', center: [0, 0], a: radius, b: radius, rotation: 0 },
  ];
  const { faces } = kernel.planarFaces(curves, frame, 1e-6);
  const face = faces[0];
  if (!face) throw new Error('the circle made no face');
  kernel.release(...faces.slice(1).map((f) => f.shape));
  return face;
}

/** The largest face between `curves`, releasing the rest. */
function biggestFace(curves: PlanarCurve[], frame: PlanarFrame): PlanarFace {
  const { faces } = kernel.planarFaces(curves, frame, 1e-6);
  const sorted = [...faces].sort((a, b) => b.area - a.area);
  const face = sorted[0];
  if (!face) throw new Error('the curves made no face');
  kernel.release(...sorted.slice(1).map((f) => f.shape));
  return face;
}

/** The area under a closed outline, from its points (the shoelace formula). */
function areaUnder(points: readonly Vec2[]): number {
  let total = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i] as Vec2;
    const b = points[(i + 1) % points.length] as Vec2;
    total += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(total) / 2;
}

const XY: PlanarFrame = { origin: [0, 0, 0], x: [1, 0, 0], normal: [0, 0, 1] };
const XY_HIGH: PlanarFrame = { origin: [0, 0, 20], x: [1, 0, 0], normal: [0, 0, 1] };

describe('mass properties with a tolerance', () => {
  it("agrees with a fine tessellation on a loft's B-spline walls", { timeout: 60_000 }, () => {
    const low = circleFace(XY, 8);
    const high = circleFace(XY_HIGH, 5);
    try {
      const { shape } = kernel.loft([low.shape, high.shape]);
      try {
        expect(kernel.isValid(shape)).toBe(true);
        const volume = kernel.measure(shape).volume;
        // The closed form of a conical frustum, and the mesh's own value.
        const exact = ((Math.PI * 20) / 3) * (8 * 8 + 8 * 5 + 5 * 5);
        const mesh = meshVolume(shape, LOFT_FINE);
        expect(Math.abs(volume - exact) / exact).toBeLessThan(1e-5);
        expect(Math.abs(volume - mesh.volume) / mesh.volume).toBeLessThan(1e-4);
      } finally {
        kernel.release(shape);
      }
    } finally {
      kernel.release(low.shape, high.shape);
    }
  });

  it('agrees with a fine tessellation on a conic extruded', () => {
    // The sketch's conic is a non-rational cubic B-spline (ADR-0063), so the
    // profile's edge is a B-spline and the body a prism of it.
    const b = new SketchBuilder();
    b.spline(
      [
        [0, 0],
        [15, 20],
        [30, 0],
      ],
      { mode: 'conic', rho: 0.4 },
    );
    b.line(30, 0, 0, 0);
    const { curves } = planarCurves(b.sketch);
    const profile = biggestFace(curves, XY);
    try {
      const { shape } = kernel.prism(profile.shape, [0, 0, 5]);
      try {
        const volume = kernel.measure(shape).volume;
        const mesh = meshVolume(shape, CONIC_FINE);
        expect(Math.abs(volume - mesh.volume) / mesh.volume).toBeLessThan(1e-4);
        // Against the conic itself, sampled densely: the extruded profile's
        // area times the distance.
        const exact: Vec2[] = [];
        for (let i = 0; i <= 2000; i++)
          exact.push(conicPoint([0, 0], [15, 20], [30, 0], 0.4, i / 2000));
        expect(Math.abs(volume - areaUnder(exact) * 5) / (areaUnder(exact) * 5)).toBeLessThan(1e-5);
      } finally {
        kernel.release(shape);
      }
    } finally {
      kernel.release(profile.shape);
    }
  });

  it('measures the same loft the same way however often it is asked', () => {
    const low = circleFace(XY, 8);
    const high = circleFace(XY_HIGH, 5);
    try {
      const { shape } = kernel.loft([low.shape, high.shape]);
      try {
        const first = kernel.measure(shape);
        const second = kernel.measure(shape);
        // The bound is on the integral, not on a sample, so two calls agree
        // exactly and a finer one (the properties call) gives the same volume.
        expect(second.volume).toBe(first.volume);
        expect(second.area).toBe(first.area);
        expect(kernel.properties(shape).volume).toBe(first.volume);
      } finally {
        kernel.release(shape);
      }
    } finally {
      kernel.release(low.shape, high.shape);
    }
  });
});
