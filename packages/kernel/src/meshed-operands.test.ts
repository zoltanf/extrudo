// OCCT's booleans and its distance check give the same result whether their operands carry a
// display triangulation or none (ADR-0024's amendment on `add` access): an edit hands them
// cached bodies the view has meshed, a recompute from scratch bodies nobody meshed. Curved
// operands: a torus, a body with a B-spline face, a filleted box with a hole. Each operand three
// ways: never meshed, meshed coarse, meshed fine (all identity copies of one shape, so the same
// geometry). The results compare by their description (sub-shape counts, order, types, sizes),
// their history (what names are made from), their volume and the display mesh of a copy (so no
// triangulation an operand had can reach it), bit for bit.
import {
  extrudeInputs,
  type GeomRef,
  originPlaneRef,
  primitiveInputs,
  sketchInputs,
} from '@extrudo/core';
import { SketchBuilder } from '@extrudo/sketch/fixtures';
import { detectProfiles } from '@extrudo/sketch/profiles';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Kernel, type ShapeHandle } from './kernel';
import { type BodyMesh, sameMesh } from './mesh';
import { loadOcct } from './occt/load';
import { DEFAULT_TESSELLATION, RecomputeEngine } from './recompute/engine';
import { testDocument, testFeature, testFeatures } from './recompute/testing';
import { buildTestPart } from './test-part';

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
const COARSE = { linearDeflection: 0.5, angularDeflection: 0.5 };
const FINE = { linearDeflection: 0.005, angularDeflection: 0.1 };

let kernel: Kernel;
let engine: RecomputeEngine;
/** The three operands as built (the engine's are meshed for display; the test part isn't). */
const built: Record<string, ShapeHandle> = {};

beforeAll(async () => {
  kernel = new Kernel(await loadOcct());
  engine = new RecomputeEngine(kernel, testFeatures().registry, { strictLeaks: true });
  const spline = new SketchBuilder();
  spline.spline([
    [0, 0],
    [20, 0],
    [20, 20],
    [0, 20],
    [0, 0],
  ]);
  const [region] = detectProfiles(spline.sketch);
  const result = await engine.recompute({
    doc: testDocument([
      {
        ...testFeature('T', 'torus'),
        inputs: primitiveInputs('torus', {
          numbers: { diameter: '40 mm', tube: '10 mm' },
          plane: originPlaneRef('origin:xy'),
        }),
      },
      {
        ...testFeature('S', 'sketch'),
        inputs: sketchInputs(originPlaneRef('origin:xy'), spline.sketch),
      },
      {
        ...testFeature('E', 'extrude'),
        inputs: extrudeInputs([{ kind: 'profile', id: `S/${region?.id}` } as GeomRef], {
          distance: '10 mm',
        }),
      },
    ]),
  });
  if (result.status !== 'done') throw new Error('cancelled');
  for (const s of Object.values(result.features)) expect(s.status).toBe('ok');
  built.torus = engine.latestBody('T:0' as never) as ShapeHandle;
  built.spline = engine.latestBody('E:0' as never) as ShapeHandle;
  built.part = buildTestPart(kernel);
  // The spline body's first face is its B-spline side.
  expect(kernel.surfaceGeometry(built.spline, 0).type).not.toBe('plane');
  // The engine's bodies carry the view's triangulation (the recompute meshed them for display):
  // a coarse mesh keeps that finer one, where a never-meshed copy gets a coarse one. The test
  // part is never meshed (`buildTestPart` makes it here and nothing draws it).
  for (const body of [built.torus, built.spline]) {
    const fresh = copy(body);
    try {
      const coarse = kernel.mesh(fresh, COARSE).positions.length;
      expect(kernel.mesh(body, COARSE).positions.length).toBeGreaterThan(coarse);
    } finally {
      kernel.release(fresh);
    }
  }
});

afterAll(() => {
  if (built.part !== undefined) kernel.release(built.part);
  engine.clear();
  expect(kernel.stats().liveShapes).toBe(0);
});

const copy = (shape: ShapeHandle) => kernel.transform(shape, IDENTITY).shape;

/** The operand three ways: never meshed, then meshed coarse, then fine. */
function variants(shape: ShapeHandle): Record<'never' | 'coarse' | 'fine', ShapeHandle> {
  const never = copy(shape);
  const coarse = copy(shape);
  kernel.mesh(coarse, COARSE);
  const fine = copy(shape);
  kernel.mesh(fine, FINE);
  return { never, coarse, fine };
}

/** What a result is: its description, history, volume and the display mesh of a copy of it. */
function fingerprint(result: { shape: ShapeHandle; history: unknown }) {
  const clean = copy(result.shape);
  const mesh = kernel.mesh(clean, DEFAULT_TESSELLATION);
  kernel.release(clean);
  return {
    description: JSON.stringify(kernel.describe(result.shape)),
    history: JSON.stringify(result.history),
    volume: kernel.properties(result.shape).volume,
    mesh,
  };
}

function same(a: ReturnType<typeof fingerprint>, b: ReturnType<typeof fingerprint>): string[] {
  const out: string[] = [];
  if (a.description !== b.description) out.push('description');
  if (a.history !== b.history) out.push('history');
  if (a.volume !== b.volume) out.push('volume');
  if (!sameMesh(a.mesh as BodyMesh, b.mesh as BodyMesh)) out.push('mesh');
  return out;
}

const PAIRS = [
  ['part', 'torus'],
  ['part', 'spline'],
  ['torus', 'spline'],
] as const;
const OPS = ['fuse', 'cut', 'common'] as const;

describe('booleans and the distance check over meshed operands (ADR-0024, `add` access)', () => {
  it.each(PAIRS)(
    '%s and %s: the same fuse, cut, common and distance, meshed or not',
    {
      timeout: 120_000,
    },
    (a, b) => {
      const left = variants(built[a] as ShapeHandle);
      const right = variants(built[b] as ShapeHandle);
      try {
        for (const op of OPS) {
          const results = {
            never: kernel[op](left.never, right.never),
            coarse: kernel[op](left.coarse, right.coarse),
            fine: kernel[op](left.fine, right.fine),
          };
          try {
            const never = fingerprint(results.never);
            expect(same(fingerprint(results.coarse), never), `${op} coarse`).toEqual([]);
            expect(same(fingerprint(results.fine), never), `${op} fine`).toEqual([]);
          } finally {
            for (const r of Object.values(results)) kernel.release(r.shape);
          }
        }
        // The check behind `bodiesTouch` (`operation.ts`): the exact distance.
        const distance = kernel.distance(left.never, right.never);
        expect(kernel.distance(left.coarse, right.coarse)).toBe(distance);
        expect(kernel.distance(left.fine, right.fine)).toBe(distance);
      } finally {
        for (const s of [...Object.values(left), ...Object.values(right)]) kernel.release(s);
      }
    },
  );

  it('tells two results apart that differ by a nanometre (the comparison is not blind)', {
    timeout: 60_000,
  }, () => {
    const part = copy(built.part as ShapeHandle);
    const torus = copy(built.torus as ShapeHandle);
    const moved = kernel.transform(torus, [1, 0, 0, 1e-6, 0, 1, 0, 0, 0, 0, 1, 0]).shape;
    const a = kernel.cut(part, torus);
    const b = kernel.cut(part, moved);
    try {
      expect(same(fingerprint(a), fingerprint(b))).not.toEqual([]);
    } finally {
      for (const s of [part, torus, moved, a.shape, b.shape]) kernel.release(s);
    }
  });
});
