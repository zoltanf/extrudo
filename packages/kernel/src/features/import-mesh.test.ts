// The mesh branch of the `import` feature (P4-06, ADR-0066 §3): an STL, 3MF
// or OBJ of the design becomes one body per piece, a mesh body the engine
// holds like any other. Real OCCT and a real manifold module, `strictLeaks`
// on: an evaluator that leaks a mesh fails here like one that leaks a shape.
import {
  type AttachmentId,
  type BodyId,
  type ExtrudoDocument,
  type FeatureId,
  importInputs,
} from '@extrudo/core';
import { checkManifold } from '@extrudo/io';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import asciiCube from '../../../../fixtures/imports/ascii-cube.stl?url&inline';
import obj from '../../../../fixtures/imports/bracket-y-up.obj?url&inline';
import cubeStl from '../../../../fixtures/imports/cube.stl?url&inline';
import openStl from '../../../../fixtures/imports/open.stl?url&inline';
import touchingCubes from '../../../../fixtures/imports/touching-cubes.stl?url&inline';
import twoComponents from '../../../../fixtures/imports/two-components.3mf?url&inline';
import twoParts from '../../../../fixtures/imports/two-parts.3mf?url&inline';
import { Kernel } from '../kernel';
import { loadManifold } from '../manifold';
import { loadOcct } from '../occt/load';
import { RecomputeEngine } from '../recompute/engine';
import { testDocument, testFeature } from '../recompute/testing';
import type { ImportedFile, RecomputeResult } from '../recompute/types';
import { kernelFeatures } from '.';

type Done = Extract<RecomputeResult, { status: 'done' }>;

const IMPORT_ID = 'Import1' as FeatureId;

let kernel: Kernel;
let engine: RecomputeEngine | undefined;
const held = new Map<AttachmentId, ImportedFile>();

beforeAll(async () => {
  kernel = new Kernel(await loadOcct());
  kernel.enableMeshes(await loadManifold());
});

afterEach(() => {
  engine?.clear();
  engine = undefined;
  held.clear();
  expect(kernel.stats().liveShapes).toBe(0);
});

/** The bytes of a `data:` URL (Vite's `?url&inline` import of a fixture). */
function bytesOf(dataUrl: string): Uint8Array {
  if (!dataUrl.startsWith('data:')) {
    throw new Error('the fixture was not inlined; it is too big for a data URL');
  }
  const binary = atob(dataUrl.slice(dataUrl.indexOf(',') + 1));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

const CUBE_STL = bytesOf(cubeStl);
const OPEN_STL = bytesOf(openStl);
const TOUCHING_CUBES = bytesOf(touchingCubes);
const ASCII_CUBE = bytesOf(asciiCube);
const OBJ = bytesOf(obj);
const TWO_PARTS = bytesOf(twoParts);
const TWO_COMPONENTS = bytesOf(twoComponents);

/** A design with one `import` of a mesh file: its record and its bytes. */
function design(options: {
  bytes?: Uint8Array;
  fileName?: string;
  mediaType?: string;
  units?: 'auto' | 'mm' | 'cm' | 'in';
  up?: 'y';
  /** How many triangles the worker says the file has (the cap is tested). */
  fakeCount?: number;
}): ExtrudoDocument {
  const file = 'file-1' as AttachmentId;
  const bytes = options.bytes ?? CUBE_STL;
  const mediaType = options.mediaType ?? 'model/stl';
  if (options.fakeCount === undefined) {
    held.set(file, { bytes, mediaType });
  } else {
    // A binary STL's header count, without reading a megabyte of triangles.
    const withCount = bytes.slice();
    new DataView(withCount.buffer).setUint32(80, options.fakeCount, true);
    held.set(file, { bytes: withCount, mediaType });
  }
  return {
    ...testDocument([
      {
        ...testFeature('Import1', 'import'),
        inputs: importInputs({
          file,
          ...(options.units && { units: options.units }),
          ...(options.up && { up: options.up }),
        }),
      },
    ]),
    attachments: {
      [file]: {
        name: 'part',
        fileName: options.fileName ?? 'cube.stl',
        mediaType: mediaType as 'model/stl',
        sha256: 'c'.repeat(64),
        size: bytes.length,
      },
    },
  };
}

const files = (id: AttachmentId) => held.get(id);

/** A document without any import at all (for "no mesh kernel is loaded"). */
function plainDesign(): ExtrudoDocument {
  return testDocument([testFeature('Box1', 'box')]);
}

async function recompute(doc: ExtrudoDocument): Promise<Done> {
  engine ??= new RecomputeEngine(kernel, kernelFeatures(), { strictLeaks: true, files });
  const result = await engine.recompute({ doc });
  if (result.status !== 'done') throw new Error('cancelled');
  return result;
}

/** Size (mm), volume, face names and mesh flag of each body, in order. */
function bodies(result: Done) {
  const walk = engine as RecomputeEngine;
  return result.bodies.map(({ id, mesh }) => {
    const shape = walk.latestBody(id as BodyId);
    if (shape === undefined) throw new Error(`no body ${id}`);
    const { bbox, volume } = kernel.measure(shape);
    const size = bbox.max.map((v, i) =>
      Number(((v as number) - (bbox.min[i] as number)).toFixed(3)),
    );
    return {
      id,
      size,
      volume,
      isMesh: kernel.isMesh(shape),
      mesh: mesh?.mesh,
      faces: [...(mesh?.faceIds ?? [])],
      triangles: (mesh?.indices.length ?? 0) / 3,
      edges: (mesh?.edgeRanges.length ?? 0) / 2,
    };
  });
}

/** The feature's own status message, after a recompute that failed. */
async function messageOf(doc: ExtrudoDocument): Promise<string> {
  const result = await recompute(doc);
  expect(result.features[IMPORT_ID]?.status).toBe('error');
  const message = result.features[IMPORT_ID]?.message ?? '';
  expect(message).not.toMatch(/Internal error/);
  (engine as RecomputeEngine).clear();
  expect(kernel.stats().liveShapes).toBe(0);
  return message;
}

describe('importing a mesh (P4-06, ADR-0066 §3)', () => {
  it('gives one mesh body of the right size from a binary STL', { timeout: 60_000 }, async () => {
    const result = await recompute(design({}));
    expect(result.features[IMPORT_ID]?.status).toBe('ok');
    const [body] = bodies(result);
    expect(body?.id).toBe('Import1:0');
    expect(body?.size).toEqual([20, 20, 20]);
    // float32 coordinates: the volume is 8000 mm³ to within a rounding.
    expect(body?.volume).toBeCloseTo(20 ** 3, 3);
    expect(body?.isMesh).toBe(true);
    expect(body?.mesh).toBe(true);
    expect(body?.faces).toEqual(['mesh:Import1']);
    // The display mesh is the file's own twelve triangles, one face, and the
    // twelve creases of a cube as edges.
    expect(body?.triangles).toBe(12);
    expect(body?.edges).toBe(12);
  });

  it('reads an ASCII STL the same way', { timeout: 60_000 }, async () => {
    const result = await recompute(
      design({ bytes: ASCII_CUBE, fileName: 'ascii-cube.stl', mediaType: 'model/stl' }),
    );
    if (result.features[IMPORT_ID]?.status !== 'ok') {
      throw new Error(`the ASCII cube: ${result.features[IMPORT_ID]?.message}`);
    }
    const [body] = bodies(result);
    expect(body?.size).toEqual([20, 20, 20]);
    expect(body?.volume).toBeCloseTo(20 ** 3, 3);
  });

  it('reads a 3MF in its own unit: centimetres become millimetres', {
    timeout: 60_000,
  }, async () => {
    const result = await recompute(
      design({ bytes: TWO_PARTS, fileName: 'two-parts.3mf', mediaType: 'model/3mf' }),
    );
    expect(result.features[IMPORT_ID]?.status).toBe('ok');
    const got = bodies(result);
    // One body per object of the build; the biggest keeps the feature's first
    // body ID, the other the next one (ADR-0030).
    expect(got.map((b) => b.id)).toEqual(['Import1:0', 'Import1:1']);
    // The fixtures are a 4 cm and a 6 cm cube: 40 mm and 60 mm.
    expect(got.map((b) => b.size)).toEqual([
      [60, 60, 60],
      [40, 40, 40],
    ]);
    expect(got[0]?.volume).toBeCloseTo(60 ** 3, 2);
    expect(got.map((b) => b.faces)).toEqual([['mesh:Import1'], ['mesh:Import1#2']]);
    expect(got.map((b) => b.triangles)).toEqual([12, 12]);
  });

  it('reads a grouped 3MF as one body per component part (P6-05, ADR-0081 §7)', {
    timeout: 60_000,
  }, async () => {
    const result = await recompute(
      design({
        bytes: TWO_COMPONENTS,
        fileName: 'two-components.3mf',
        mediaType: 'model/3mf',
      }),
    );
    expect(result.features[IMPORT_ID]?.status).toBe('ok');
    const got = bodies(result);
    // Two components of two cubes each (sides 4 and 6) and one loose cube
    // (side 2): every mesh is its own body, whatever group it was in.
    expect(got).toHaveLength(5);
    expect(got.map((b) => Math.round(b.volume * 100) / 100).sort((a, b) => a - b)).toEqual([
      8, 64, 64, 216, 216,
    ]);
    expect(got.every((b) => b.isMesh)).toBe(true);
    expect(got.map((b) => b.faces.length)).toEqual([1, 1, 1, 1, 1]);
    expect(got.map((b) => b.triangles).sort((a, b) => a - b)).toEqual([12, 12, 12, 12, 12]);
  });

  it('reads a Y-up OBJ, turned a quarter turn with up: y', { timeout: 60_000 }, async () => {
    const file = { bytes: OBJ, fileName: 'bracket-y-up.obj', mediaType: 'model/obj' };
    // Each recompute's bodies are read before the next one: `bodies` measures
    // what the engine holds now.
    // Read as Z-up, the file's x and y are the body's x and y, and its 4 mm
    // thickness is in z.
    const [before] = bodies(await recompute(design(file)));
    expect(before?.size).toEqual([20, 30, 4]);
    expect(before?.volume).toBeCloseTo(20 * 30 * 4, 3);
    // Turned: (x, y, z) → (x, −z, y), so the thickness is now in y.
    const [after] = bodies(await recompute(design({ ...file, up: 'y' })));
    expect(after?.size).toEqual([20, 4, 30]);
    expect(after?.volume).toBeCloseTo(before?.volume ?? 0, 3);
  });

  it('takes the unit the user picks: an inch STL is 25.4 times bigger', {
    timeout: 60_000,
  }, async () => {
    const result = await recompute(design({ units: 'in' }));
    const [body] = bodies(result);
    expect(body?.size).toEqual([20, 20, 20].map((v) => Number((v * 25.4).toFixed(3))));
    expect(body?.volume).toBeCloseTo((20 * 25.4) ** 3, 1);
  });

  it('separates surfaces that touch along an edge, with a warning', {
    timeout: 60_000,
  }, async () => {
    const result = await recompute(
      design({
        bytes: TOUCHING_CUBES,
        fileName: 'touching-cubes.stl',
        mediaType: 'model/stl',
      }),
    );
    expect(result.features[IMPORT_ID]?.status).toBe('warning');
    expect(result.features[IMPORT_ID]?.message).toBe(
      'touching-cubes.stl: 1 edge where parts touch was separated.',
    );
    const got = bodies(result);
    expect(got).toHaveLength(2);
    expect(got.map((b) => b.size)).toEqual([
      [20, 20, 20],
      [20, 20, 20],
    ]);
  });

  it('says what is wrong with a mesh that is not closed', { timeout: 60_000 }, async () => {
    const message = await messageOf(
      design({ bytes: OPEN_STL, fileName: 'open.stl', mediaType: 'model/stl' }),
    );
    expect(message).toBe(
      "open.stl isn't a closed solid (3 open edges): repair it in your slicer or a mesh tool and import it again.",
    );
  });

  it('refuses a file with more triangles than it reads', { timeout: 60_000 }, async () => {
    const message = await messageOf(design({ fakeCount: 1_200_000 }));
    expect(message).toBe('cube.stl has 1,200,000 triangles; Extrudo imports up to 1,000,000.');
  });

  it('says what is wrong with a file it cannot read', { timeout: 60_000 }, async () => {
    expect(
      await messageOf(design({ bytes: new Uint8Array([1, 2, 3, 4]), fileName: 'rubbish.stl' })),
    ).toMatch(/can't read rubbish\.stl/);
    expect(
      await messageOf(
        design({
          bytes: new Uint8Array([1, 2, 3]),
          fileName: 'rubbish.3mf',
          mediaType: 'model/3mf',
        }),
      ),
    ).toMatch(/can't read rubbish\.3mf/);
    expect(
      await messageOf(
        design({
          bytes: new TextEncoder().encode('o A\nv 0 0 0\nf 1 2 9\n'),
          fileName: 'rubbish.obj',
          mediaType: 'model/obj',
        }),
      ),
    ).toMatch(/can't read rubbish\.obj/);
  });

  it('gives the same bodies warm and cold', { timeout: 60_000 }, async () => {
    const doc = design({});
    const cold = bodies(await recompute(doc));
    const warm = engine as RecomputeEngine;
    const again = await warm.recompute({ doc });
    if (again.status !== 'done') throw new Error('cancelled');
    expect(again.stats.evaluated).toEqual([]);
    expect(bodies(again)).toEqual(cold);
    warm.clear();
    expect(bodies(await recompute(doc))).toEqual(cold);
  });

  it('exports a mesh body as its own triangles, closed', { timeout: 60_000 }, async () => {
    const result = await recompute(design({}));
    const id = result.bodies[0]?.id as BodyId;
    const shape = (engine as RecomputeEngine).latestBody(id) as never;
    const exported = kernel.exportMesh(shape, { linearDeflection: 0.02, angularDeflection: 0.2 });
    expect(exported.indices.length).toBe(36);
    expect(checkManifold(exported).ok).toBe(true);
    expect(checkManifold(exported).triangles).toBe(12);
    expect(checkManifold(exported).volume).toBeCloseTo(20 ** 3, 6);
  });

  it('needs no mesh kernel for a design without a mesh import', { timeout: 60_000 }, async () => {
    // The Recomputer (the app) asks for manifold-3d only when a document names
    // a mesh file; a document without one never calls `enableMeshes`.
    expect(kernel.meshesEnabled()).toBe(true);
    const bare = new Kernel(await loadOcct());
    const plain = new RecomputeEngine(bare, kernelFeatures(), { strictLeaks: true });
    const result = await plain.recompute({ doc: plainDesign() });
    if (result.status !== 'done') throw new Error('cancelled');
    expect(Object.values(result.features).map((s) => s.status)).toEqual(['ok']);
    expect(bare.meshesEnabled()).toBe(false);
    plain.clear();
    expect(bare.stats().liveShapes).toBe(0);
    bare.dispose();
  });
});
