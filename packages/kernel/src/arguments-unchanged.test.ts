// No kernel call changes the shapes it is given (ADR-0035's amendment of 2026-11-26): a body in
// the recompute engine's cache is handed to the next edit's features as it is, so a call that
// wrote to its arguments (a tolerance raised, a curve added) would leave the cache different
// from a recompute from scratch. Every call that takes a shape runs on fresh inputs that make
// OCCT raise tolerances (a plate whose corner sits on a torus's inner equator), and each input is
// compared before and after: the box of every face, edge and vertex taken alone (each enlarged by
// that sub-shape's own tolerance) and the description. `mesh` and `exportMesh` add a
// triangulation, which no box or description reads (ADR-0035's amendment of 2026-11-24).
import { originPlaneRef, primitiveInputs } from '@extrudo/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Kernel, type ShapeHandle } from './kernel';
import { loadOcct } from './occt/load';
import { RecomputeEngine } from './recompute/engine';
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

describe('no kernel call changes the shapes it is given (ADR-0035, 2026-11-26)', () => {
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
});
