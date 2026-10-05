// The `import` feature in the kernel (P4-06, ADR-0066 §2): a STEP file of
// the design becomes one body per solid, named by position in the file, with
// no history. Real OCCT, `strictLeaks` on: an evaluator that leaks fails here.
import {
  type AttachmentId,
  type BodyId,
  type ExtrudoDocument,
  type FeatureId,
  importInputs,
} from '@extrudo/core';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import step from '../../../../fixtures/imports/b3.step?url&inline';
import { Kernel } from '../kernel';
import { loadOcct } from '../occt/load';
import { RecomputeEngine } from '../recompute/engine';
import { testDocument, testFeature } from '../recompute/testing';
import type { ImportedFile, RecomputeResult } from '../recompute/types';
import { kernelFeatures } from '.';

type Done = Extract<RecomputeResult, { status: 'done' }>;

/** The one feature's ID: `testFeature` uses its name. */
const IMPORT_ID = 'Import1' as FeatureId;

let kernel: Kernel;
let engine: RecomputeEngine | undefined;
const held = new Map<AttachmentId, ImportedFile>();

beforeAll(async () => {
  kernel = new Kernel(await loadOcct());
});

afterEach(() => {
  engine?.clear();
  engine = undefined;
  held.clear();
  expect(kernel.stats().liveShapes).toBe(0);
});

/** The STEP file the fixture wrote of B3's two bodies (`import-fixture.test.ts`). */
function fixtureBytes(): Uint8Array {
  const binary = atob(step.slice(step.indexOf(',') + 1));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

/**
 * A design with one `import` of a file: its record, its bytes in the worker.
 * `content` is what the file holds (the STEP fixture by default) and
 * `mediaType` what the record says it is.
 */
function design(options: {
  bytes?: Uint8Array;
  fileName?: string;
  mediaType?: string;
  units?: 'auto' | 'mm';
  up?: 'y';
  /** The worker doesn't get the bytes: the design names a file that isn't there. */
  unsent?: boolean;
}): { doc: ExtrudoDocument; file: AttachmentId } {
  const file = 'file-1' as AttachmentId;
  const bytes = options.bytes ?? fixtureBytes();
  const mediaType = options.mediaType ?? 'model/step';
  if (options.unsent) held.delete(file);
  else held.set(file, { bytes, mediaType });
  return {
    file,
    doc: {
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
          name: 'b3',
          fileName: options.fileName ?? 'b3.step',
          mediaType: mediaType as 'model/step',
          sha256: 'b'.repeat(64),
          size: bytes.length,
        },
      },
    },
  };
}

const files = (id: AttachmentId) => held.get(id);

/**
 * Recomputes a document with the test's one engine (created on the first
 * call, so a second call hits its cache; `engine.clear()` makes the next one
 * cold). `afterEach` empties it and checks that no shape is left.
 */
async function recompute(doc: ExtrudoDocument): Promise<Done> {
  engine ??= new RecomputeEngine(kernel, kernelFeatures(), { strictLeaks: true, files });
  const result = await engine.recompute({ doc });
  if (result.status !== 'done') throw new Error('cancelled');
  return result;
}

/** Size (mm), volume and face names of each body, in creation order. */
function bodies(result: Done, engine: RecomputeEngine) {
  return result.bodies.map(({ id, mesh }) => {
    const shape = engine.latestBody(id as BodyId);
    if (shape === undefined) throw new Error(`no body ${id}`);
    const { bbox, volume } = kernel.measure(shape);
    const size = bbox.max.map((v, i) => (v as number) - (bbox.min[i] as number));
    return {
      id,
      size: size.map((v) => Number(v.toFixed(3))),
      volume,
      faces: [...(mesh?.faceIds ?? [])],
    };
  });
}

/**
 * The two solids of B3 (ADR-0039), as `fixtures/imports/b3.step` holds them:
 * the base plate 60 × 80 × 10 mm and the back rest 60 × 31.838 × 60, whose
 * end leans back at 70° (`60 / tan(70°) + 10` mm of depth).
 */
const BASE_SIZE = [60, 80, 10];
const REST_SIZE = [60, Number((60 / Math.tan((70 * Math.PI) / 180) + 10).toFixed(3)), 60];
const BASE_VOLUME = 60 * 80 * 10;
const REST_VOLUME = 60 * 10 * 60;

describe('the import feature (P4-06, ADR-0066 §2)', () => {
  it("gives one body per solid in the file, with B3's boxes and volumes", {
    timeout: 60_000,
  }, async () => {
    const { doc } = design({});
    const result = await recompute(doc);
    expect(result.features[IMPORT_ID]?.status).toBe('ok');
    const got = bodies(result, engine as RecomputeEngine);
    // One body per solid, the largest keeping the feature's body ID and the
    // other getting `<feature>:1` (ADR-0030): the base plate is the bigger.
    expect(got.map((b) => b.id)).toEqual(['Import1:0', 'Import1:1']);
    expect(got[0]?.size).toEqual(BASE_SIZE);
    expect(got[0]?.volume).toBeCloseTo(BASE_VOLUME, -6);
    expect(got[1]?.size).toEqual(REST_SIZE);
    expect(got[1]?.volume).toBeCloseTo(REST_VOLUME, -6);
    // A box is six faces.
    expect(got.map((b) => b.faces.length)).toEqual([6, 6]);
  });

  it("names the file's faces by position, the same every recompute", {
    timeout: 60_000,
  }, async () => {
    const { doc } = design({});
    const first = await recompute(doc);
    const warm = engine as RecomputeEngine;
    const names = bodies(first, warm).map((b) => [b.id, b.faces]);
    expect(names[0]?.[1]).toEqual([
      'import:Import1:face:1',
      'import:Import1:face:2',
      'import:Import1:face:3',
      'import:Import1:face:4',
      'import:Import1:face:5',
      'import:Import1:face:6',
    ]);
    // A second recompute of the same document is served from the cache, and a
    // cold engine reads the same file in the same order.
    const again = await warm.recompute({ doc });
    if (again.status !== 'done') throw new Error('cancelled');
    expect(again.stats.evaluated).toEqual([]);
    expect(bodies(again, warm).map((b) => [b.id, b.faces])).toEqual(names);
    warm.clear();
    const cold = await recompute(doc);
    expect(cold.stats.evaluated).toEqual(['Import1']);
    expect(bodies(cold, engine as RecomputeEngine).map((b) => [b.id, b.faces])).toEqual(names);
  });

  it('turns the file a quarter turn about X with up: y', { timeout: 60_000 }, async () => {
    const { doc: upright } = design({});
    const { doc: turned } = design({ up: 'y' });
    const before = await recompute(upright);
    const a = bodies(before, engine as RecomputeEngine);
    const after = await recompute(turned);
    const b = bodies(after, engine as RecomputeEngine);
    // (x, y, z) → (x, −z, y): the box's y and z swap, and the new y runs the
    // other way round the origin.
    for (const [was, now] of [
      [a[0], b[0]],
      [a[1], b[1]],
    ] as const) {
      if (!was || !now) throw new Error('two bodies');
      const [x, y, z] = was.size;
      expect(now.size).toEqual([x, z, y]);
      expect(now.volume).toBeCloseTo(was.volume, 6);
    }
    // The turn is part of the cache key: both results are in the cache, and
    // each recompute of either is a hit.
    const warm = engine as RecomputeEngine;
    const again = await warm.recompute({ doc: turned });
    if (again.status !== 'done') throw new Error('cancelled');
    expect(again.stats.evaluated).toEqual([]);
    expect(bodies(again, warm).map((x) => x.size)).toEqual(b.map((x) => x.size));
    const back = await warm.recompute({ doc: upright });
    if (back.status !== 'done') throw new Error('cancelled');
    expect(back.stats.evaluated).toEqual([]);
    expect(bodies(back, warm).map((x) => x.size)).toEqual(a.map((x) => x.size));
  });

  it('ignores `units` for a STEP file: the file brings its own', { timeout: 60_000 }, async () => {
    const { doc: plain } = design({});
    const { doc: withUnits } = design({ units: 'mm' });
    const a = await recompute(plain);
    const sizes = bodies(a, engine as RecomputeEngine).map((x) => x.size);
    const b = await recompute(withUnits);
    expect(b.features[IMPORT_ID]?.status).toBe('ok');
    expect(bodies(b, engine as RecomputeEngine).map((x) => x.size)).toEqual(sizes);
  });

  it("says what is wrong with a file it can't use", { timeout: 60_000 }, async () => {
    const messageOf = async (doc: ExtrudoDocument) => {
      const result = await recompute(doc);
      expect(result.features[IMPORT_ID]?.status).toBe('error');
      // The status is for the user, not an internal error, and no shapes leak.
      expect(result.features[IMPORT_ID]?.message).not.toMatch(/Internal error/);
      (engine as RecomputeEngine).clear();
      expect(kernel.stats().liveShapes).toBe(0);
      return result.features[IMPORT_ID]?.message ?? '';
    };

    // A file that isn't a STEP file: the facade's own message.
    const rubbish = await messageOf(
      design({ bytes: new TextEncoder().encode('not a STEP file') }).doc,
    );
    expect(rubbish.length).toBeGreaterThan(0);

    // A STEP file with a face but no solid in it.
    expect(await messageOf(design({ bytes: new TextEncoder().encode(shellOnlyStep()) }).doc)).toBe(
      'The STEP file has no solids: Extrudo imports solid bodies, not surfaces.',
    );

    // A mesh file goes through the mesh branch (ADR-0066 §3, `import-mesh.test.ts`).
    expect(
      await messageOf(
        design({ bytes: new Uint8Array([0, 1, 2]), fileName: 'b3.stl', mediaType: 'model/stl' })
          .doc,
      ),
    ).toMatch(/can't read b3\.stl/);

    // A file that is a model to the document but not one of the readers.
    expect(
      await messageOf(
        design({
          bytes: new TextEncoder().encode('ISO-10303-21;'),
          fileName: 'b3.stl',
          mediaType: 'model/stl',
        }).doc,
      ),
    ).toMatch(/can't read b3\.stl/);

    // A file the design names but the worker has no bytes for (ADR-0066 §0).
    expect(await messageOf(design({ unsent: true }).doc)).toBe(
      'The file b3.step is missing from this design.',
    );
  });
});

/**
 * A STEP file of one planar face, no solid in it: what a surface model looks
 * like to the reader.
 */
function shellOnlyStep(): string {
  using scope = kernel.scope();
  const { faces } = kernel.planarFaces(
    [
      { kind: 'line', a: [0, 0], b: [20, 0] },
      { kind: 'line', a: [20, 0], b: [20, 10] },
      { kind: 'line', a: [20, 10], b: [0, 0] },
    ],
    { origin: [0, 0, 0], x: [1, 0, 0], normal: [0, 0, 1] },
    1e-7,
  );
  const face = faces[0];
  if (!face) throw new Error('no face');
  scope.track(face.shape);
  return kernel.writeStep([{ shape: face.shape, name: 'A face' }]);
}
