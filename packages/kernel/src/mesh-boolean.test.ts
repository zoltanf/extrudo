// Booleans and transforms with mesh bodies (P4-06, ADR-0066 §4): when either
// operand is a mesh the whole boolean goes to manifold-3d, the B-rep operand
// meshed at `MESH_BOOLEAN_DEFLECTION`, and the result is a mesh body again.
// Real OCCT, a real manifold module and `strictLeaks`: a temporary manifold a
// boolean leaks fails here like any other shape.
import {
  type AttachmentId,
  type BodyId,
  combineInputs,
  type ExtrudoDocument,
  extrudeInputs,
  type Feature,
  type FeatureId,
  type GeomRef,
  holeInputs,
  importInputs,
  mirrorInputs,
  moveInputs,
  originPlaneRef,
  placeOnBedInputs,
  primitiveInputs,
  rectangularPatternInputs,
  type SketchData,
  scaleInputs,
  sketchInputs,
  splitBodyInputs,
} from '@extrudo/core';
import { SketchBuilder } from '@extrudo/sketch/fixtures';
import { detectProfiles } from '@extrudo/sketch/profiles';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import cubeStl from '../../../fixtures/imports/cube.stl?url&inline';
import { kernelFeatures } from './features';
import { Kernel } from './kernel';
import { loadManifold } from './manifold';
import { loadOcct } from './occt/load';
import { RecomputeEngine } from './recompute/engine';
import { testDocument, testFeature } from './recompute/testing';
import type { ImportedFile, RecomputeResult } from './recompute/types';

type Done = Extract<RecomputeResult, { status: 'done' }>;

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
  const binary = atob(dataUrl.slice(dataUrl.indexOf(',') + 1));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

/** `fixtures/imports/cube.stl`: a 20 mm cube from (0, 0, 0) to (20, 20, 20). */
const CUBE = bytesOf(cubeStl);
const CUBE_VOLUME = 8000;
const CUBE_BODY = 'Import1:0';

const files = (id: AttachmentId) => held.get(id);

const FILE = 'file-1' as AttachmentId;
const FILE_2 = 'file-2' as AttachmentId;

/** One `import` of the cube fixture, under the name given. */
function importMesh(id: string, file: AttachmentId = FILE): Feature {
  held.set(file, { bytes: CUBE, mediaType: 'model/stl', fileName: 'cube.stl' });
  return { ...testFeature(id, 'import'), inputs: importInputs({ file }) };
}

/** The document's attachment record for the fixture. */
function attachments(): ExtrudoDocument['attachments'] {
  return {
    [FILE]: {
      name: 'cube',
      fileName: 'cube.stl',
      mediaType: 'model/stl',
      sha256: 'c'.repeat(64),
      size: CUBE.length,
    },
  };
}

async function recompute(features: Feature[]): Promise<Done> {
  engine ??= new RecomputeEngine(kernel, kernelFeatures(), { strictLeaks: true, files });
  const result = await engine.recompute({
    doc: { ...testDocument(features), attachments: attachments() },
  });
  if (result.status !== 'done') throw new Error('cancelled');
  return result;
}

/** Fails with the feature's message, so a broken test says why. */
function ok(result: Done): Done {
  for (const [id, s] of Object.entries(result.features)) {
    if (s.status === 'error') throw new Error(`${id}: ${s.message}`);
  }
  return result;
}

const status = (result: Done, id: string) => result.features[id as FeatureId];

const round = (x: number, digits = 3) => {
  const r = Number(x.toFixed(digits));
  return Object.is(r, -0) ? 0 : r;
};

/** The bodies a recompute made: ID, size, volume, whether it is a mesh, face names. */
function bodies(result: Done) {
  const walk = engine as RecomputeEngine;
  return result.bodies.map(({ id, mesh }) => {
    const shape = walk.latestBody(id as BodyId);
    if (shape === undefined) throw new Error(`no body ${id}`);
    const { bbox, volume } = kernel.measure(shape);
    return {
      id,
      size: bbox.max.map((v, i) => round((v as number) - (bbox.min[i] as number))),
      min: bbox.min.map((v) => round(v as number)),
      volume,
      isMesh: kernel.isMesh(shape),
      faces: [...(mesh?.faceIds ?? [])],
    };
  });
}

const faceNames = (result: Done, body: string) =>
  result.bodies.find((b) => b.id === body)?.mesh?.faceIds ?? [];

// ------------------------------------------------------------------ shapes

function sketch(id: string, data: SketchData, plane?: GeomRef): Feature {
  return {
    ...testFeature(id, 'sketch'),
    inputs: sketchInputs(plane ?? originPlaneRef('origin:xy'), data),
  };
}

/** An extrude of the sketch's first profile, by `options`. */
function extrude(
  id: string,
  sketchId: string,
  data: SketchData,
  options: Parameters<typeof extrudeInputs>[1] = {},
): Feature {
  const [found] = detectProfiles(data);
  if (!found) throw new Error('no profile');
  const profile: GeomRef = { kind: 'profile', id: `${sketchId}/${found.id}` };
  return { ...testFeature(id, 'extrude'), inputs: extrudeInputs([profile], options) };
}

/** A circle of `diameter` mm at (x, y), drawn on a sketch of its own. */
function circleCut(
  id: string,
  x: number,
  y: number,
  diameter: number,
  options: Parameters<typeof extrudeInputs>[1] = {},
): Feature[] {
  const b = new SketchBuilder();
  b.circle(x, y, diameter / 2);
  return [sketch(`${id}S`, b.sketch), extrude(id, `${id}S`, b.sketch, options)];
}

const box = (
  id: string,
  numbers: Record<string, string>,
  options: Parameters<typeof primitiveInputs>[1] = {},
): Feature => ({
  ...testFeature(id, 'box'),
  inputs: primitiveInputs('box', { numbers, ...options }),
});

const combine = (id: string, target: string, tools: string[], operation = 'join'): Feature => ({
  ...testFeature(id, 'combine'),
  inputs: combineInputs(target, tools, { operation: operation as 'join' }),
});

/** Within 0.1 % of `expected`: what a tessellated hole costs. */
function nearVolume(got: number, expected: number): boolean {
  return Math.abs(got - expected) <= expected * 0.001;
}

const YZ: GeomRef = { kind: 'plane', id: 'origin:yz' };

describe('booleans and transforms with meshes (P4-06, ADR-0066 §4)', { timeout: 300_000 }, () => {
  it('cuts a B-rep cylinder through a mesh body: one mesh, its own face name', async () => {
    // A Ø6 circle extruded 30 mm up from XY, cut through everything.
    const result = ok(
      await recompute([
        importMesh('Import1'),
        ...circleCut('Drill', 10, 10, 6, { operation: 'cut', extent: 'through-all' }),
      ]),
    );
    expect(status(result, 'Import1')?.status).toBe('ok');
    expect(status(result, 'Drill')?.status).toBe('ok');
    expect(result.bodies.map((b) => b.id)).toEqual([CUBE_BODY]);
    const [body] = bodies(result);
    // The hole is the cylinder's own volume to within the tessellation.
    expect(nearVolume(body?.volume ?? 0, CUBE_VOLUME - Math.PI * 9 * 20)).toBe(true);
    expect(body?.isMesh).toBe(true);
    expect(body?.size).toEqual([20, 20, 20]);
    // The result is named after the feature that made it, not after the import.
    expect(faceNames(result, CUBE_BODY)).toEqual(['mesh:Drill']);
  });

  it('joins a solid box to a mesh body, says once that it is a mesh from here on', async () => {
    // A 10 mm box centred 20 mm along X, so 5 mm of it sticks out of the cube:
    // 500 mm³ more, and the box is a solid while the cube is a mesh.
    const result = ok(
      await recompute([
        importMesh('Import1'),
        box('Box1', { length: '10 mm', width: '10 mm', height: '10 mm', x: '20 mm', y: '10 mm' }),
        combine('Combine1', 'Box1:0', [CUBE_BODY]),
      ]),
    );
    // The warning once, whatever the feature did with how many bodies.
    expect(status(result, 'Combine1')?.status).toBe('warning');
    expect(status(result, 'Combine1')?.message).toBe(
      'A solid body was combined with a mesh and is a mesh from here on: fillets and face picks no longer work on it.',
    );
    // The target's ID, one body, and it is a mesh now.
    expect(result.bodies.map((b) => b.id)).toEqual(['Box1:0']);
    const [body] = bodies(result);
    expect(body?.isMesh).toBe(true);
    expect(nearVolume(body?.volume ?? 0, CUBE_VOLUME + 500)).toBe(true);
    expect(body?.size).toEqual([25, 20, 20]);
    expect(faceNames(result, 'Box1:0')).toEqual(['mesh:Combine1']);
  });

  it('intersects two mesh bodies of the same cube', async () => {
    // The second cube moved 10 mm along X, so the two share 10 × 20 × 20 mm.
    const result = ok(
      await recompute([
        importMesh('Import1'),
        importMesh('Import2', FILE_2),
        {
          ...testFeature('Move1', 'move'),
          inputs: moveInputs(['Import2:0'], { dx: '10 mm' }),
        },
        combine('Combine1', CUBE_BODY, ['Import2:0'], 'intersect'),
      ]),
    );
    const got = bodies(result);
    expect(got.map((b) => b.id)).toEqual([CUBE_BODY]);
    expect(got[0]?.isMesh).toBe(true);
    expect(got[0]?.volume).toBeCloseTo(10 * 20 * 20, 0);
    expect(got[0]?.size).toEqual([10, 20, 20]);
    expect(faceNames(result, CUBE_BODY)).toEqual(['mesh:Combine1']);
  });

  it('leaves a mesh body alone when a cut misses it', async () => {
    const result = await recompute([
      importMesh('Import1'),
      // 60 mm away from the cube in x: the boxes don't even meet.
      ...circleCut('Drill', 70, 10, 6, { operation: 'cut', extent: 'through-all' }),
    ]);
    expect(status(result, 'Drill')?.status).toBe('error');
    expect(status(result, 'Drill')?.message).toContain("The cut doesn't touch any body.");
    // The body is as it was, with the name the import gave it.
    const [body] = bodies(result);
    expect(body?.volume).toBeCloseTo(CUBE_VOLUME, 0);
    expect(faceNames(result, CUBE_BODY)).toEqual(['mesh:Import1']);
  });

  it('drills three holes through a mesh body in one pattern', async () => {
    // A Ø2 hole at (5, 10) through all, then two more 5 mm along X.
    const hole: Feature = {
      ...testFeature('Hole1', 'hole'),
      inputs: holeInputs({
        plane: originPlaneRef('origin:xy'),
        numbers: { x: '5 mm', y: '10 mm', diameter: '2 mm' },
        extent: 'through',
        // The XY plane is the cube's floor, so the hole drills up into it.
        flip: true,
      }),
    };
    const result = ok(
      await recompute([
        importMesh('Import1'),
        hole,
        {
          ...testFeature('Pattern1', 'rectangularPattern'),
          inputs: rectangularPatternInputs({
            features: ['Hole1'],
            direction1: { kind: 'axis', id: 'origin:x' },
            count1: '3',
            distance1: '5 mm',
          }),
        },
      ]),
    );
    expect(status(result, 'Pattern1')?.status).toBe('ok');
    expect(result.bodies.map((b) => b.id)).toEqual([CUBE_BODY]);
    const [body] = bodies(result);
    expect(body?.isMesh).toBe(true);
    expect(nearVolume(body?.volume ?? 0, CUBE_VOLUME - 3 * Math.PI * 20)).toBe(true);
    expect(faceNames(result, CUBE_BODY)).toEqual(['mesh:Pattern1']);
  });

  it('moves, mirrors and scales a mesh body', async () => {
    // Moved 10 mm along X: 10…30 in x.
    const moved = ok(
      await recompute([
        importMesh('Import1'),
        { ...testFeature('Move1', 'move'), inputs: moveInputs([CUBE_BODY], { dx: '10 mm' }) },
      ]),
    );
    const [afterMove] = bodies(moved);
    expect(afterMove?.min).toEqual([10, 0, 0]);
    expect(afterMove?.volume).toBeCloseTo(CUBE_VOLUME, 0);
    // A move keeps the face name the import gave it (ADR-0005).
    expect(faceNames(moved, CUBE_BODY)).toEqual(['mesh:Import1']);

    // Mirrored in YZ as a copy: the cube is its own mirror image, so the copy
    // sits exactly on the original and the volume keeps its sign.
    (engine as RecomputeEngine).clear();
    const mirrored = ok(
      await recompute([
        importMesh('Import1'),
        {
          ...testFeature('Mirror1', 'mirror'),
          inputs: mirrorInputs([CUBE_BODY], YZ, { copy: true, join: false }),
        },
      ]),
    );
    const copies = bodies(mirrored);
    expect(copies.map((b) => b.id)).toEqual([CUBE_BODY, 'Mirror1:0']);
    expect(copies.map((b) => b.volume)).toEqual([CUBE_VOLUME, CUBE_VOLUME]);
    // The copy's one face is named from the original's, as ADR-0044 says.
    expect(faceNames(mirrored, 'Mirror1:0')).toEqual(['mirror:Mirror1:from:(mesh:Import1)']);

    (engine as RecomputeEngine).clear();
    // Scaled twice in x and to nothing in y, about the cube's own centre.
    const scaled = ok(
      await recompute([
        importMesh('Import1'),
        {
          ...testFeature('Scale1', 'scale'),
          inputs: scaleInputs([CUBE_BODY], { mode: 'non-uniform', x: '2', y: '0.5', z: '1' }),
        },
      ]),
    );
    const [afterScale] = bodies(scaled);
    expect(afterScale?.size).toEqual([40, 10, 20]);
    expect(afterScale?.volume).toBeCloseTo(CUBE_VOLUME, 0);
  });

  it('patterns a mesh body into copies, each named from the original', async () => {
    // Three cubes 30 mm apart along x: bodies, not one shape with three shells.
    const result = ok(
      await recompute([
        importMesh('Import1'),
        {
          ...testFeature('Pattern1', 'rectangularPattern'),
          inputs: rectangularPatternInputs({
            bodies: [CUBE_BODY],
            direction1: { kind: 'axis', id: 'origin:x' },
            count1: '3',
            distance1: '30 mm',
          }),
        },
      ]),
    );
    const got = bodies(result);
    // The copies' IDs come from the instance's slot and the body's place in the
    // list (Cantor pairing, ADR-0047), so they survive a growing count.
    expect(got.map((b) => b.id)).toEqual([CUBE_BODY, 'Pattern1:6', 'Pattern1:55']);
    expect(got.map((b) => b.min)).toEqual([
      [0, 0, 0],
      [30, 0, 0],
      [60, 0, 0],
    ]);
    expect(got.map((b) => b.isMesh)).toEqual([true, true, true]);
    // The copies are the same body moved, so each is the cube's own volume to
    // a float32 rounding.
    for (const body of got) expect(body?.volume ?? 0).toBeCloseTo(CUBE_VOLUME, 3);
    // Instance 0 is the original, and it keeps its name; a copy's one face is
    // named from it (ADR-0044's copy rule, ADR-0066 §4).
    expect(got.map((b) => b.faces)).toEqual([
      ['mesh:Import1'],
      ['pattern:Pattern1:1:from:(mesh:Import1)'],
      ['pattern:Pattern1:2:from:(mesh:Import1)'],
    ]);
  });

  it('splits a mesh body along a plane: two bodies whose volumes add up', async () => {
    // Moved so the YZ plane goes through its middle, then split.
    const result = ok(
      await recompute([
        importMesh('Import1'),
        { ...testFeature('Move1', 'move'), inputs: moveInputs([CUBE_BODY], { dx: '-10 mm' }) },
        {
          ...testFeature('Split1', 'splitBody'),
          inputs: splitBodyInputs([CUBE_BODY], YZ),
        },
      ]),
    );
    const got = bodies(result);
    // The largest keeps the body's ID (ADR-0030); both halves are equal, so
    // the first in x does.
    expect(got.map((b) => b.id)).toEqual([CUBE_BODY, 'Split1:0']);
    expect(got.map((b) => b.size)).toEqual([
      [10, 20, 20],
      [10, 20, 20],
    ]);
    expect(got.map((b) => b.isMesh)).toEqual([true, true]);
    expect(got.map((b) => b.volume)).toEqual([4000, 4000]);
    expect((got[0]?.volume ?? 0) + (got[1]?.volume ?? 0)).toBeCloseTo(CUBE_VOLUME, 3);
    // Two mesh bodies, so two names.
    expect(got.map((b) => b.faces)).toEqual([['mesh:Split1'], ['mesh:Split1#2']]);
  });

  it('is the same warm and cold, and leaves nothing behind', async () => {
    const features = [
      importMesh('Import1'),
      ...circleCut('Drill', 10, 10, 6, { operation: 'cut', extent: 'through-all' }),
    ];
    const cold = bodies(ok(await recompute(features)));
    const warm = ok(await recompute(features));
    expect(warm.stats.evaluated).toEqual([]);
    expect(bodies(warm)).toEqual(cold);
    // A second engine reads the same file and builds the same mesh.
    (engine as RecomputeEngine).clear();
    const again = bodies(ok(await recompute(features)));
    expect(again).toEqual(cold);
    (engine as RecomputeEngine).clear();
    expect(kernel.stats().liveShapes).toBe(0);
  });

  it('still refuses what a mesh body cannot do', async () => {
    await recompute([importMesh('Import1')]);
    // A mesh body's one face is pickable, and it is all its triangles: a hole
    // on it has no flat face to sit on, and Place on Bed none to lay down.
    const face = (engine as RecomputeEngine).reference(CUBE_BODY as BodyId, 'face', 0);
    expect(face).toBeDefined();
    const onFace = (type: string, more: Feature['inputs']): Feature => ({
      ...testFeature('F1', type),
      inputs: more,
    });
    const hole = await recompute([
      importMesh('Import1'),
      onFace('hole', holeInputs({ plane: face as GeomRef, numbers: { diameter: '2 mm' } })),
    ]);
    expect(status(hole, 'F1')?.status).toBe('error');
    expect(status(hole, 'F1')?.message).toBe(
      'The hole needs a solid body: this body is a mesh (imported, or combined with a mesh).',
    );
    (engine as RecomputeEngine).clear();
    const bed = await recompute([
      importMesh('Import1'),
      onFace('placeOnBed', placeOnBedInputs([face as GeomRef])),
    ]);
    expect(status(bed, 'F1')?.message).toBe(
      'Place on Bed needs a solid body: this body is a mesh (imported, or combined with a mesh).',
    );
    (engine as RecomputeEngine).clear();
    const rib = await recompute([importMesh('Import1')]);
    expect(rib.bodies.map((b) => b.id)).toEqual([CUBE_BODY]);
  });
});
