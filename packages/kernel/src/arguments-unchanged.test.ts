// No kernel call changes the shapes it is given (ADR-0035's amendment of 2026-11-25): a body in
// the recompute engine's cache is handed to the next edit's features as it is, so a call that
// wrote to its arguments (a tolerance raised, a curve added) would leave the cache different
// from a recompute from scratch. Every call that takes a shape runs on fresh inputs that make
// OCCT raise tolerances (a plate whose corner sits on a torus's inner equator), and each input is
// compared before and after: the box of every face, edge and vertex taken alone (each enlarged by
// that sub-shape's own tolerance) and the description. `mesh` and `exportMesh` add a
// triangulation, which no box or description reads (ADR-0035's amendment of 2026-11-24).
import { originPlaneRef, primitiveInputs } from '@extrudo/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Kernel, KernelError, type ShapeHandle, type WrapFrame } from './kernel';
import { loadOcct } from './occt/load';
import type { PlanarCurve, PlanarFrame, Vec2 } from './planar';
import { type BodyMesh, sameMesh } from './mesh';
import { DEFAULT_TESSELLATION, RecomputeEngine } from './recompute/engine';
import { testDocument, testFeature, testFeatures } from './recompute/testing';
import { buildTestPart } from './test-part';

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];

let kernel: Kernel;
let engine: RecomputeEngine;
let torusBase: ShapeHandle;

beforeAll(async () => {
  kernel = new Kernel(await loadOcct());
  engine = new RecomputeEngine(kernel, testFeatures().registry, { strictLeaks: true });
  const result = await engine.recompute({
    doc: testDocument([
      {
        ...testFeature('T', 'torus'),
        inputs: primitiveInputs('torus', {
          numbers: { diameter: '40 mm', tube: '10 mm' },
          plane: originPlaneRef('origin:xy'),
        }),
      },
    ]),
  });
  if (result.status !== 'done') throw new Error('cancelled');
  torusBase = engine.latestBody('T:0' as never) as ShapeHandle;
});

afterAll(() => {
  engine.clear();
  expect(kernel.stats().liveShapes).toBe(0);
});

/** A torus Ø40 (tube Ø10) on XY at the origin, fresh: an identity copy has its own sub-shapes. */
const torus = () => kernel.transform(torusBase, IDENTITY).shape;
/** A 60 × 40 × 3 mm plate whose corner (15, 0, 0) lies on the torus's inner equator. */
const plate = () => kernel.box([60, 40, 3], [15, 0, 0]);
/** A cylinder Ø10 × 10 standing in the plate's corner. */
const post = () => kernel.cylinder(5, 10, [15, 0, -2]);

// ------------------------------------------------------------------------------- profiles

type Vec3 = [number, number, number];
const XY: PlanarFrame = { origin: [0, 0, 0], x: [1, 0, 0], normal: [0, 0, 1] };
/** XZ, its `y` along world +Z. */
const XZ: PlanarFrame = { origin: [0, 0, 0], x: [1, 0, 0], normal: [0, -1, 0] };

const lines = (...corners: Vec2[]): PlanarCurve[] =>
  corners.map((a, i) => ({ kind: 'line', a, b: corners[(i + 1) % corners.length] as Vec2 }));
const circle = (center: Vec2, radius: number): PlanarCurve => ({
  kind: 'arc',
  center,
  radius,
  from: 0,
  sweep: 2 * Math.PI,
});
const ellipse = (center: Vec2, a: number, b: number): PlanarCurve => ({
  kind: 'ellipse',
  center,
  a,
  b,
  rotation: 0,
});
/** A closed cubic B-spline round `center`: a wavy ring, the way a letter's outline comes in. */
function ring(center: Vec2, radius: number): PlanarCurve {
  const steps = 12;
  const poles: Vec2[] = Array.from({ length: steps + 1 }, (_, i) => {
    const angle = (2 * Math.PI * i) / steps;
    const r = radius + 0.8 * Math.sin(3 * angle);
    return [center[0] + r * Math.cos(angle), center[1] + r * Math.sin(angle)];
  });
  const knots = [0, 0, 0, 0];
  for (let i = 1; i <= steps - 3; i++) knots.push(i / (steps - 2));
  knots.push(1, 1, 1, 1);
  return { kind: 'spline', degree: 3, poles, knots };
}

/** The largest face between `curves` in `frame`: a sketch's profile face, fresh. */
function profile(curves: PlanarCurve[], frame: PlanarFrame = XY): ShapeHandle {
  const { faces } = kernel.planarFaces(curves, frame, 1e-6);
  const sorted = [...faces].sort((a, b) => b.area - a.area);
  const face = sorted[0];
  if (!face) throw new Error('the curves made no face');
  kernel.release(...sorted.slice(1).map((f) => f.shape));
  return face.shape;
}

/** A path of sketch lines in `frame` (a wire, fresh). */
const path = (frame: PlanarFrame, ...points: Vec2[]) =>
  kernel.path(
    points.slice(1).map((b, i) => ({
      kind: 'curve' as const,
      curve: { kind: 'line' as const, a: points[i] as Vec2, b },
      frame,
    })),
  );

const R = 20;
/** The sketch plane x = R, its `x` along world +Y and its `y` along world +Z (ADR-0060). */
const WRAP_PLANE: PlanarFrame = { origin: [R, 0, 0], x: [0, 1, 0], normal: [1, 0, 0] };
const CYLINDER: WrapFrame = {
  origin: [0, 0, 0],
  axis: [0, 0, 1],
  reference: [1, 0, 0],
  radius: R,
  corner: [R, 0, 0],
  across: [0, 1, 0],
};
/** A cone of half angle 0.2 rad, radius R at z = 0 (its sketch plane is the cylinder's). */
const CONE: WrapFrame = { ...CYLINDER, halfAngle: 0.2 };

/** Where vertex `index` of `shape` is. */
function vertexOf(shape: ShapeHandle, index: number): [number, number, number] {
  const vertex = kernel.subShape(shape, 'vertex', index);
  const { min, max } = kernel.measure(vertex).bbox;
  kernel.release(vertex);
  return [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
}

/** What a shape is: the box of each face, edge and vertex alone, and its description. */
function snapshot(shape: ShapeHandle): string[] {
  const out = [JSON.stringify(kernel.describe(shape))];
  for (const kind of ['face', 'edge', 'vertex'] as const) {
    for (let i = 0; i < kernel.count(shape, kind); i++) {
      const part = kernel.subShape(shape, kind, i);
      out.push(`${kind} ${i} ${JSON.stringify(kernel.measure(part).bbox)}`);
      kernel.release(part);
    }
  }
  return out;
}

type Out = ShapeHandle | { shape: ShapeHandle } | readonly (ShapeHandle | null)[] | unknown;

/** Gives back whatever shapes a call returned. */
function release(out: Out): void {
  if (typeof out === 'number') {
    kernel.release(out as unknown as ShapeHandle);
  } else if (Array.isArray(out)) {
    for (const s of out) if (typeof s === 'number') kernel.release(s as unknown as ShapeHandle);
  } else if (out && typeof out === 'object' && 'shape' in out) {
    release((out as { shape: unknown }).shape);
  } else if (out && typeof out === 'object' && 'close' in out) {
    (out as { close(): void }).close();
  }
}

/** A call, the inputs it is made with, and the call itself. */
const CALLS: [string, () => ShapeHandle[], (s: ShapeHandle[]) => Out][] = [
  ['cut', () => [torus(), plate()], ([a, b]) => kernel.cut(a as ShapeHandle, b as ShapeHandle)],
  ['fuse', () => [torus(), plate()], ([a, b]) => kernel.fuse(a as ShapeHandle, b as ShapeHandle)],
  [
    'common',
    () => [torus(), plate()],
    ([a, b]) => kernel.common(a as ShapeHandle, b as ShapeHandle),
  ],
  [
    'cut, simplified',
    () => [torus(), plate()],
    ([a, b]) => kernel.cut(a as ShapeHandle, b as ShapeHandle, { simplify: true }),
  ],
  [
    'fuse, simplified',
    () => [torus(), plate()],
    ([a, b]) => kernel.fuse(a as ShapeHandle, b as ShapeHandle, { simplify: true }),
  ],
  ['split', () => [plate(), torus()], ([a, b]) => kernel.split(a as ShapeHandle, b as ShapeHandle)],
  [
    'distance',
    () => [torus(), plate()],
    ([a, b]) => void kernel.distance(a as ShapeHandle, b as ShapeHandle),
  ],
  [
    'closestPoints',
    () => [torus(), plate()],
    ([a, b]) => kernel.closestPoints(a as ShapeHandle, b as ShapeHandle),
  ],
  [
    'minGap',
    () => [torus(), plate()],
    ([a, b]) => void kernel.minGap(a as ShapeHandle, b as ShapeHandle),
  ],
  [
    'proximity',
    () => [torus(), plate()],
    ([a, b]) => kernel.proximity(a as ShapeHandle, b as ShapeHandle, 5),
  ],
  ['splitByPlane', () => [torus()], ([a]) => kernel.splitByPlane(a as ShapeHandle, [0, 1, 0], 0)],
  [
    'sectionWithPlane',
    () => [torus()],
    ([a]) => kernel.sectionWithPlane(a as ShapeHandle, [0, 0, 0], [0, 1, 0]),
  ],
  [
    'sectionWithPlane, through a vertex',
    () => [buildTestPart(kernel)],
    ([a]) => kernel.sectionWithPlane(a as ShapeHandle, vertexOf(a as ShapeHandle, 0), [1, 0, 0]),
  ],
  [
    'facesMeetPlane, through a vertex',
    () => [buildTestPart(kernel)],
    ([a]) => {
      const face = kernel.subShape(a as ShapeHandle, 'face', 0);
      try {
        return kernel.facesMeetPlane(face, null, {
          origin: vertexOf(a as ShapeHandle, 0),
          normal: [1, 0, 0],
        });
      } finally {
        kernel.release(face);
      }
    },
  ],
  [
    'facesMeetPlane',
    () => [plate(), post()],
    ([a, b]) =>
      kernel.facesMeetPlane(a as ShapeHandle, b as ShapeHandle, {
        origin: [0, 0, 1],
        normal: [0, 0, 1],
      }),
  ],
  ['edgeVisibility', () => [torus()], ([a]) => kernel.edgeVisibility(a as ShapeHandle, [0, -1, 0])],
  ['hlrSpans', () => [torus()], ([a]) => kernel.hlrSpans(a as ShapeHandle, [0, -1, 0])],
  ['hlrPolySpans', () => [torus()], ([a]) => kernel.hlrPolySpans(a as ShapeHandle, [0, -1, 0])],
  [
    'faceSilhouettes',
    () => [torus()],
    ([a]) => kernel.faceSilhouettes(a as ShapeHandle, 0, [0, -1, 0]),
  ],
  ['solids', () => [torus()], ([a]) => kernel.solids(a as ShapeHandle)],
  ['isValid', () => [torus()], ([a]) => kernel.isValid(a as ShapeHandle)],
  ['properties', () => [torus()], ([a]) => kernel.properties(a as ShapeHandle)],
  ['surfaceGeometry', () => [torus()], ([a]) => kernel.surfaceGeometry(a as ShapeHandle, 0)],
  ['edgeGeometry', () => [torus()], ([a]) => kernel.edgeGeometry(a as ShapeHandle, 0)],
  ['extendFace', () => [torus()], ([a]) => kernel.extendFace(a as ShapeHandle, 0, 5)],
  [
    'faceHit',
    () => [torus()],
    ([a]) => kernel.faceHit(a as ShapeHandle, 0, [20, 0, 20], [0, 0, -1]),
  ],
  [
    'mesh',
    () => [torus()],
    ([a]) => void kernel.mesh(a as ShapeHandle, { linearDeflection: 0.05, angularDeflection: 0.3 }),
  ],
  [
    'exportMesh',
    () => [torus()],
    ([a]) =>
      void kernel.exportMesh(a as ShapeHandle, { linearDeflection: 0.05, angularDeflection: 0.3 }),
  ],
  ['transform', () => [torus()], ([a]) => kernel.transform(a as ShapeHandle, IDENTITY)],
  ['scale', () => [torus()], ([a]) => kernel.scale(a as ShapeHandle, [0, 0, 0], [2, 2, 2])],
  [
    'locate',
    () => [plate()],
    ([a]) => {
      const face = kernel.subShape(a as ShapeHandle, 'face', 0);
      const at = kernel.locate(face, a as ShapeHandle, 'face');
      kernel.release(face);
      return at;
    },
  ],
  [
    'writeStep',
    () => [torus()],
    ([a]) => void kernel.writeStep([{ shape: a as ShapeHandle, name: 'T' }]),
  ],
  ['fillet', () => [buildTestPart(kernel)], ([a]) => kernel.fillet(a as ShapeHandle, [0], 1)],
  [
    'chamfer',
    () => [buildTestPart(kernel)],
    ([a]) => kernel.chamfer(a as ShapeHandle, [0], { mode: 'equal', distance: 1 }),
  ],
  ['shell', () => [buildTestPart(kernel)], ([a]) => kernel.shell(a as ShapeHandle, [0], 1)],
  [
    'offsetFaces',
    () => [buildTestPart(kernel)],
    ([a]) => kernel.offsetFaces(a as ShapeHandle, [0], 1),
  ],
  [
    'removeFaces',
    () => [buildTestPart(kernel)],
    ([a]) => kernel.removeFaces(a as ShapeHandle, [0]),
  ],
  [
    'draft',
    () => [buildTestPart(kernel)],
    ([a]) =>
      kernel.draft(a as ShapeHandle, [0], { origin: [0, 0, 0], normal: [0, 0, 1] }, Math.PI / 36),
  ],
  [
    'tangentChain',
    () => [buildTestPart(kernel)],
    ([a]) => void kernel.tangentChain(a as ShapeHandle, 0),
  ],
  [
    'tangentFaces',
    () => [buildTestPart(kernel)],
    ([a]) => void kernel.tangentFaces(a as ShapeHandle, 0),
  ],
  ['threadFace', () => [post()], ([a]) => kernel.threadFace(a as ShapeHandle, 0)],
  ['coneFace', () => [post()], ([a]) => kernel.coneFace(a as ShapeHandle, 0)],
  ['faceSlab', () => [post()], ([a]) => kernel.faceSlab(a as ShapeHandle, 0, 1)],
  [
    'prism',
    () => [plate()],
    ([a]) => {
      const face = kernel.subShape(a as ShapeHandle, 'face', 0);
      try {
        return kernel.prism(face, [0, 0, 5]);
      } finally {
        kernel.release(face);
      }
    },
  ],
  [
    'projectOnFace',
    () => [plate(), post()],
    ([a, b]) => {
      const face = kernel.subShape(a as ShapeHandle, 'face', 0);
      try {
        return kernel.projectOnFace(face, b as ShapeHandle, 0, 0.5);
      } finally {
        kernel.release(face);
      }
    },
  ],
  [
    'compound',
    () => [torus(), plate()],
    ([a, b]) => kernel.compound([a as ShapeHandle, b as ShapeHandle]),
  ],
];

/** The edge of `shape` that runs from `a` to `b` (either way), by its box. */
function edgeBetween(shape: ShapeHandle, a: Vec3, b: Vec3): number {
  for (let i = 0; i < kernel.count(shape, 'edge'); i++) {
    const edge = kernel.subShape(shape, 'edge', i);
    const { min, max } = kernel.measure(edge).bbox;
    kernel.release(edge);
    const near = (p: readonly number[], q: readonly number[]) =>
      p.every((v, k) => Math.abs(v - (q[k] as number)) < 1e-3);
    const lo: Vec3 = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2])];
    const hi: Vec3 = [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2])];
    if (near(min, lo) && near(max, hi)) return i;
  }
  throw new Error('no such edge');
}

/** A rectangle's corners. */
const rect = (x0: number, y0: number, x1: number, y1: number) =>
  lines([x0, y0], [x1, y0], [x1, y1], [x0, y1]);
const XY_HIGH: PlanarFrame = { origin: [0, 0, 20], x: [1, 0, 0], normal: [0, 0, 1] };

/**
 * The calls ADR-0035's amendment listed as not checked yet, and revolve: each must compute with
 * these inputs (a refusal would say nothing). Their profiles are sketch faces (`planarFaces`),
 * as a sketch's cached profile face reaches them, and paths sketch wires or a body's edge.
 */
const MORE_CALLS: [string, () => ShapeHandle[], (s: ShapeHandle[]) => Out][] = [
  [
    'revolve',
    () => [profile(rect(10, 0, 20, 5))],
    ([a]) => kernel.revolve(a as ShapeHandle, { origin: [0, 0, 0], direction: [0, 1, 0] }, 1.5),
  ],
  [
    'prism, tapered (lines: the draft path)',
    () => [profile(rect(-10, -5, 10, 5))],
    ([a]) => kernel.prism(a as ShapeHandle, [0, 0, 10], [0, 0, 0], 0.1),
  ],
  [
    'prism, tapered (an ellipse: the loft path)',
    () => [profile([ellipse([0, 0], 10, 5)])],
    ([a]) => kernel.prism(a as ShapeHandle, [0, 0, 10], [0, 0, 0], 0.1),
  ],
  [
    'prism, tapered (a spline: the loft path)',
    () => [profile([ring([0, 0], 8)])],
    ([a]) => kernel.prism(a as ShapeHandle, [0, 0, 10], [0, 0, 0], 0.1),
  ],
  [
    'loft',
    () => [profile([circle([0, 0], 8)]), profile([circle([0, 0], 5)], XY_HIGH)],
    ([a, b]) => kernel.loft([a as ShapeHandle, b as ShapeHandle]),
  ],
  [
    'loft, ruled',
    () => [profile(rect(-8, -8, 8, 8)), profile([circle([0, 0], 5)], XY_HIGH)],
    ([a, b]) => kernel.loft([a as ShapeHandle, b as ShapeHandle], { ruled: true }),
  ],
  [
    'loft to a point',
    () => [profile([circle([0, 0], 8)])],
    ([a]) => kernel.loft([a as ShapeHandle, { point: [0, 0, 15] }]),
  ],
  [
    'sweep, along sketch lines',
    () => [profile([circle([0, 0], 2)]), path(XZ, [0, 0], [0, 8], [6, 15])],
    ([a, b]) => kernel.sweep(a as ShapeHandle, b as ShapeHandle),
  ],
  [
    'sweep, twisted and scaled',
    () => [profile(rect(-2, -1, 2, 1)), path(XZ, [0, 0], [0, 12])],
    ([a, b]) => kernel.sweep(a as ShapeHandle, b as ShapeHandle, { twist: 0.6, scale: 0.7 }),
  ],
  [
    "sweep, along a body's edge",
    () => [profile([circle([15, 0], 1)]), plate()],
    ([a, b]) => {
      const edge = edgeBetween(b as ShapeHandle, [15, 0, 0], [15, 0, 3]);
      const wire = kernel.path([{ kind: 'edge', shape: b as ShapeHandle, edge }]);
      try {
        return kernel.sweep(a as ShapeHandle, wire);
      } finally {
        kernel.release(wire);
      }
    },
  ],
  [
    'threadSweep',
    () => [profile(lines([5, 0], [6, 0.4], [5, 0.8]), XZ)],
    ([a]) =>
      kernel.threadSweep(
        a as ShapeHandle,
        { origin: [0, 0, 0], direction: [0, 0, 1] },
        1,
        3,
        false,
      ),
  ],
  [
    'threadSweep, tapered',
    () => [profile(lines([5, 0], [6, 0.4], [5, 0.8]), XZ)],
    ([a]) =>
      kernel.threadSweep(
        a as ShapeHandle,
        { origin: [0, 0, 0], direction: [0, 0, 1] },
        1,
        3,
        false,
        0.05,
      ),
  ],
  [
    'wrapOnCylinder',
    () => [profile(rect(-3, 2, 3, 6), WRAP_PLANE)],
    ([a]) => kernel.wrapOnCylinder(a as ShapeHandle, CYLINDER, 1),
  ],
  [
    'wrapOnCone',
    () => [profile(rect(-3, 2, 3, 6), WRAP_PLANE)],
    ([a]) => kernel.wrapOnCone(a as ShapeHandle, CONE, 1),
  ],
  [
    'filletVariable',
    () => [buildTestPart(kernel)],
    ([a]) => kernel.filletVariable(a as ShapeHandle, [0], [[1, 2]]),
  ],
  [
    'shellFaces (a shell with a wall set)',
    () => [buildTestPart(kernel)],
    ([a]) => kernel.shell(a as ShapeHandle, [0], 1, 'inside', [{ face: 1, thickness: 2 }]),
  ],
  [
    'writeStepXde (a STEP file with a colour)',
    () => [torus(), plate()],
    ([a, b]) =>
      void kernel.writeStep([
        { shape: a as ShapeHandle, name: 'T', color: '#c81e28' },
        { shape: b as ShapeHandle, name: 'P' },
      ]),
  ],
  [
    'writeStepAssembly (a STEP file with a group)',
    () => [torus(), plate()],
    ([a, b]) =>
      void kernel.writeStep(
        [
          { shape: a as ShapeHandle, name: 'T', group: 0 },
          { shape: b as ShapeHandle, name: 'P' },
        ],
        ['G'],
      ),
  ],
];

describe('no kernel call changes the shapes it is given (ADR-0035, 2026-11-25)', () => {
  it.each(CALLS)('%s', { timeout: 60_000 }, (_name, inputs, call) => {
    const shapes = inputs();
    try {
      const before = shapes.map(snapshot);
      try {
        release(call(shapes));
      } catch {
        // A call that refuses these inputs must not have changed them either.
      }
      shapes.forEach((shape, i) => {
        expect(snapshot(shape), `input ${i}`).toEqual(before[i]);
      });
    } finally {
      kernel.release(...shapes);
    }
  });

  it.each(MORE_CALLS)('%s (computes)', { timeout: 60_000 }, (_name, inputs, call) => {
    const shapes = inputs();
    try {
      const before = shapes.map(snapshot);
      release(call(shapes));
      shapes.forEach((shape, i) => {
        expect(snapshot(shape), `input ${i}`).toEqual(before[i]);
      });
    } finally {
      kernel.release(...shapes);
    }
  });
});

describe('a profile face used by prisms and revolves before (ADR-0035, 2026-11-25)', () => {
  // A prism or a revolve adds a p-curve of each profile edge on the side face it makes to that
  // edge (OCCT's BRepSweep), on a sketch's cached profile face too. No later result reads them:
  // the same face extruded fresh, or after a revolve and another prism used it, gives the same
  // prism and the same cut with it, bit for bit.
  /** The top face of a cylinder Ø10 standing at (30, 15): a disc with one circle edge. */
  const disc = () => {
    const cylinder = kernel.cylinder(5, 4, [30, 15, -4]);
    const face = kernel.subShape(cylinder, 'face', 1);
    return { cylinder, face };
  };
  function cutWith(face: ShapeHandle) {
    const prism = kernel.prism(face, [0, 0, 6]);
    const plate = kernel.box([60, 40, 3], [0, 0, 0]);
    const cut = kernel.cut(plate, prism.shape);
    const out = {
      prism: fingerprint(prism.shape),
      cut: fingerprint(cut.shape),
    };
    kernel.release(prism.shape, plate, cut.shape);
    return out;
  }
  function fingerprint(shape: ShapeHandle) {
    const copy = kernel.transform(shape, IDENTITY).shape;
    const mesh = kernel.mesh(copy, { linearDeflection: 0.05, angularDeflection: 0.3 });
    kernel.release(copy);
    return {
      snapshot: snapshot(shape),
      measure: kernel.measure(shape),
      properties: kernel.properties(shape),
      mesh: JSON.stringify(Object.values(mesh).map((v) => Array.from(v as ArrayLike<number>))),
    };
  }

  it('gives the same prism and the same cut, fresh or after a revolve and a prism used it', {
    timeout: 60_000,
  }, () => {
    const fresh = disc();
    const used = disc();
    try {
      // The face's top is at z = 0; it lies off the revolve's axis (x = 0).
      const revolved = kernel.revolve(
        used.face,
        { origin: [0, 0, 0], direction: [0, 1, 0] },
        Math.PI / 2,
      );
      const prism = kernel.prism(used.face, [0, 0, 2]);
      kernel.release(revolved.shape, prism.shape);
      expect(cutWith(used.face)).toEqual(cutWith(fresh.face));
    } finally {
      kernel.release(fresh.face, fresh.cylinder, used.face, used.cylinder);
    }
  });
});

describe('a profile, path or body used by a call gives later results as a fresh one (ADR-0035)', () => {
  // What the box-and-description comparison can't see (a p-curve added to an edge, an edge's
  // continuity), a later result could still read. So each call's profile, path or body is used
  // again afterwards, and every result compared, bit for bit, with the same made from a fresh one.
  const cross = (a: readonly number[], b: readonly number[]): Vec3 => [
    (a[1] as number) * (b[2] as number) - (a[2] as number) * (b[1] as number),
    (a[2] as number) * (b[0] as number) - (a[0] as number) * (b[2] as number),
    (a[0] as number) * (b[1] as number) - (a[1] as number) * (b[0] as number),
  ];
  const along = (p: readonly number[], d: readonly number[], t: number): Vec3 => [
    (p[0] as number) + t * (d[0] as number),
    (p[1] as number) + t * (d[1] as number),
    (p[2] as number) + t * (d[2] as number),
  ];
  function fingerprint(shape: ShapeHandle) {
    const copy = kernel.transform(shape, IDENTITY).shape;
    const mesh = kernel.mesh(copy, { linearDeflection: 0.05, angularDeflection: 0.3 });
    kernel.release(copy);
    return {
      snapshot: snapshot(shape),
      measure: kernel.measure(shape),
      properties: kernel.properties(shape),
      mesh: JSON.stringify(Object.values(mesh).map((v) => Array.from(v as ArrayLike<number>))),
    };
  }
  /** Fingerprints what `make` builds (or its refusal), releasing it and anything it tracked. */
  function made(make: (track: (s: ShapeHandle) => ShapeHandle) => ShapeHandle) {
    const kept: ShapeHandle[] = [];
    try {
      return fingerprint(
        make((s) => {
          kept.push(s);
          return s;
        }),
      );
    } catch (error) {
      if (!(error instanceof KernelError)) throw error;
      return { refused: error.message };
    } finally {
      kernel.release(...kept);
    }
  }
  /** A small cube at the middle of `shape`'s box: what a later cut takes out of it. */
  function cubeIn(shape: ShapeHandle) {
    const { min, max } = kernel.measure(shape).bbox;
    const c = min.map((v, k) => (v + (max[k] as number)) / 2);
    return kernel.box(
      [2, 2, 2],
      [(c[0] as number) - 1, (c[1] as number) - 1, (c[2] as number) - 1],
    );
  }
  /** What later features make from a profile face in `frame`: prism, cut, revolve, loft, sweep. */
  function fromProfile(face: ShapeHandle, frame: PlanarFrame) {
    const { normal: n, x } = frame;
    const y = cross(n, x);
    const { min, max } = kernel.measure(face).bbox;
    const c = min.map((v, k) => (v + (max[k] as number)) / 2);
    return {
      prism: made((t) => t(kernel.prism(face, along([0, 0, 0], n, 6)).shape)),
      cut: made((t) => {
        const prism = t(kernel.prism(face, along([0, 0, 0], n, 6)).shape);
        return t(kernel.cut(prism, t(cubeIn(prism))).shape);
      }),
      revolve: made((t) =>
        t(kernel.revolve(face, { origin: along(c, x, -30), direction: y }, 1.2).shape),
      ),
      loft: made((t) => {
        const top = t(profile([circle([0, 0], 1)], { origin: along(c, n, 20), x, normal: n }));
        return t(kernel.loft([face, top]).shape);
      }),
      sweep: made((t) => {
        const wire = t(path({ origin: c as Vec3, x, normal: cross(x, n) }, [0, 0], [0, 12]));
        return t(kernel.sweep(face, wire).shape);
      }),
    };
  }
  /** What a later cut makes of a body, and the body itself. */
  const fromBody = (body: ShapeHandle) => ({
    body: fingerprint(body),
    cut: made((t) => t(kernel.cut(body, t(cubeIn(body))).shape)),
  });

  /** A call and the profile it takes (a fresh one each time), in its frame. */
  const PROFILES: [string, () => ShapeHandle, PlanarFrame, (face: ShapeHandle) => Out][] = [
    [
      'revolve',
      () => profile(rect(10, 0, 20, 5)),
      XY,
      (a) => kernel.revolve(a, { origin: [0, 0, 0], direction: [0, 1, 0] }, 1.5),
    ],
    [
      'prism, tapered (lines)',
      () => profile(rect(-10, -5, 10, 5)),
      XY,
      (a) => kernel.prism(a, [0, 0, 10], [0, 0, 0], 0.1),
    ],
    [
      'prism, tapered (an ellipse)',
      () => profile([ellipse([0, 0], 10, 5)]),
      XY,
      (a) => kernel.prism(a, [0, 0, 10], [0, 0, 0], 0.1),
    ],
    [
      'prism, tapered (a spline)',
      () => profile([ring([0, 0], 8)]),
      XY,
      (a) => kernel.prism(a, [0, 0, 10], [0, 0, 0], 0.1),
    ],
    [
      'loft',
      () => profile([circle([0, 0], 8)]),
      XY,
      (a) => {
        const top = profile([circle([0, 0], 5)], XY_HIGH);
        try {
          return kernel.loft([a, top]);
        } finally {
          kernel.release(top);
        }
      },
    ],
    [
      'loft, ruled',
      () => profile(rect(-8, -8, 8, 8)),
      XY,
      (a) => {
        const top = profile([circle([0, 0], 5)], XY_HIGH);
        try {
          return kernel.loft([a, top], { ruled: true });
        } finally {
          kernel.release(top);
        }
      },
    ],
    [
      'loft to a point',
      () => profile([circle([0, 0], 8)]),
      XY,
      (a) => kernel.loft([a, { point: [0, 0, 15] }]),
    ],
    [
      'sweep, twisted and scaled',
      () => profile(rect(-2, -1, 2, 1)),
      XY,
      (a) => {
        const wire = path(XZ, [0, 0], [0, 12]);
        try {
          return kernel.sweep(a, wire, { twist: 0.6, scale: 0.7 });
        } finally {
          kernel.release(wire);
        }
      },
    ],
    [
      'threadSweep, tapered',
      () => profile(lines([5, 0], [6, 0.4], [5, 0.8]), XZ),
      XZ,
      (a) => kernel.threadSweep(a, { origin: [0, 0, 0], direction: [0, 0, 1] }, 1, 3, false, 0.05),
    ],
    [
      'wrapOnCylinder',
      () => profile(rect(-3, 2, 3, 6), WRAP_PLANE),
      WRAP_PLANE,
      (a) => kernel.wrapOnCylinder(a, CYLINDER, 1),
    ],
    [
      'wrapOnCone',
      () => profile(rect(-3, 2, 3, 6), WRAP_PLANE),
      WRAP_PLANE,
      (a) => kernel.wrapOnCone(a, CONE, 1),
    ],
  ];

  it.each(PROFILES)('%s: its profile afterwards', { timeout: 60_000 }, (_n, make, frame, call) => {
    const fresh = make();
    const used = make();
    try {
      release(call(used));
      expect(fromProfile(used, frame)).toEqual(fromProfile(fresh, frame));
    } finally {
      kernel.release(fresh, used);
    }
  });

  it('a sweep: its path afterwards (sketch lines, and a body whose edge it took)', {
    timeout: 60_000,
  }, () => {
    const lines3 = () => path(XZ, [0, 0], [0, 8], [6, 15]);
    const freshPath = lines3();
    const usedPath = lines3();
    const freshPlate = plate();
    const usedPlate = plate();
    const disc = () => profile([circle([0, 0], 2)]);
    const along3 = (wire: ShapeHandle) => made((t) => t(kernel.sweep(t(disc()), wire).shape));
    try {
      const first = disc();
      release(kernel.sweep(first, usedPath));
      kernel.release(first);
      const edge = edgeBetween(usedPlate, [15, 0, 0], [15, 0, 3]);
      const wire = kernel.path([{ kind: 'edge', shape: usedPlate, edge }]);
      const foot = profile([circle([15, 0], 1)]);
      release(kernel.sweep(foot, wire));
      kernel.release(wire, foot);
      expect(along3(usedPath)).toEqual(along3(freshPath));
      expect(fromBody(usedPlate)).toEqual(fromBody(freshPlate));
    } finally {
      kernel.release(freshPath, usedPath, freshPlate, usedPlate);
    }
  });

  /** A call and the body it takes. */
  const BODIES: [string, () => ShapeHandle, (body: ShapeHandle) => Out][] = [
    ['filletVariable', () => buildTestPart(kernel), (a) => kernel.filletVariable(a, [0], [[1, 2]])],
    [
      'shellFaces',
      () => buildTestPart(kernel),
      (a) => kernel.shell(a, [0], 1, 'inside', [{ face: 1, thickness: 2 }]),
    ],
    [
      'writeStepXde',
      torus,
      (a) => void kernel.writeStep([{ shape: a, name: 'T', color: '#c81e28' }]),
    ],
    [
      'writeStepAssembly',
      torus,
      (a) => void kernel.writeStep([{ shape: a, name: 'T', group: 0 }], ['G']),
    ],
  ];

  it.each(BODIES)('%s: its body afterwards', { timeout: 60_000 }, (_n, make, call) => {
    const fresh = make();
    const used = make();
    try {
      release(call(used));
      expect(fromBody(used)).toEqual(fromBody(fresh));
    } finally {
      kernel.release(fresh, used);
    }
  });
});

describe('hlrPolySpans meshes a body that has no triangulation (ADR-0035, 2026-11-25)', () => {
  const VIEW = DEFAULT_TESSELLATION;
  const same = (a: BodyMesh, b: BodyMesh) => sameMesh(a, b);

  it('in place, at its own angle, which a later display mesh keeps (so callers mesh first)', {
    timeout: 60_000,
  }, () => {
    // The quick drawing view's mesher: the linear deflection asked for, an angle of 0.5 rad, on
    // faces without a triangulation. The view's display mesh (0.3 rad) then keeps that coarser
    // one. Meshed first at the view's own tessellation, the body keeps its display mesh.
    const fresh = buildTestPart(kernel);
    const unmeshed = buildTestPart(kernel);
    const meshed = buildTestPart(kernel);
    try {
      const display = kernel.mesh(meshed, VIEW);
      kernel.hlrPolySpans(unmeshed, [0, -1, 0], VIEW.linearDeflection);
      kernel.hlrPolySpans(meshed, [0, -1, 0], VIEW.linearDeflection);
      expect(same(kernel.mesh(unmeshed, VIEW), kernel.mesh(fresh, VIEW))).toBe(false);
      expect(same(kernel.mesh(meshed, VIEW), display)).toBe(true);
    } finally {
      kernel.release(fresh, unmeshed, meshed);
    }
  });

  it("the engine's quick view leaves a body it never meshed with the display mesh from scratch", {
    timeout: 60_000,
  }, async () => {
    // A recompute that holds the body's mesh already (`have`) doesn't mesh it, so its cached torus
    // has no triangulation when the quick view draws it. The engine meshes it at the view's
    // tessellation first (`sheetView`): the next display mesh equals a fresh engine's.
    const doc = testDocument([
      {
        ...testFeature('T', 'torus'),
        inputs: primitiveInputs('torus', {
          numbers: { diameter: '40 mm', tube: '10 mm' },
          plane: originPlaneRef('origin:xy'),
        }),
      },
    ]);
    const fresh = new RecomputeEngine(kernel, testFeatures().registry, { strictLeaks: true });
    const viewed = new RecomputeEngine(kernel, testFeatures().registry, { strictLeaks: true });
    try {
      const first = await fresh.recompute({ doc });
      if (first.status !== 'done') throw new Error(first.status);
      const body = first.bodies[0];
      if (!body?.mesh) throw new Error('no mesh');
      const held = await viewed.recompute({ doc, have: { [body.id]: body.version } });
      if (held.status !== 'done') throw new Error(held.status);
      expect(held.bodies[0]?.mesh).toBeUndefined();
      const view = viewed.sheetView({ id: 'v', direction: [0, 1, 0], up: [0, 0, 1], quick: true });
      expect('geometry' in view).toBe(true);
      const again = await viewed.recompute({ doc });
      if (again.status !== 'done') throw new Error(again.status);
      expect(same(again.bodies[0]?.mesh as BodyMesh, body.mesh)).toBe(true);
    } finally {
      fresh.clear();
      viewed.clear();
    }
  });
});
