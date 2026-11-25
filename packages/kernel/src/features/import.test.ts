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
import tessellated from '../../../../fixtures/imports/tessellated.step?url&inline';
import tessellatedCopy from '../../../../fixtures/imports/tessellated-copy.step?url&inline';
import tessellatedMixed from '../../../../fixtures/imports/tessellated-mixed.step?url&inline';
import tessellatedStray from '../../../../fixtures/imports/tessellated-stray.step?url&inline';
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

/** A fixture's text, from its inlined data URL. */
function textOf(url: string): string {
  return new TextDecoder().decode(
    Uint8Array.from(atob(url.slice(url.indexOf(',') + 1)), (c) => c.charCodeAt(0)),
  );
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
  position?: 'file' | 'centre';
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
            ...(options.position && { position: options.position }),
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

/** Each body's exact box (`properties`'), in creation order. */
function boxes(result: Done, engine: RecomputeEngine) {
  return result.bodies.map(({ id }) => {
    const shape = engine.latestBody(id as BodyId);
    if (shape === undefined) throw new Error(`no body ${id}`);
    return kernel.properties(shape).bbox;
  });
}

/** The box around all of them. */
function around(all: readonly { min: readonly number[]; max: readonly number[] }[]) {
  const at = (i: number) => ({
    min: Math.min(...all.map((b) => b.min[i] as number)),
    max: Math.max(...all.map((b) => b.max[i] as number)),
  });
  return [at(0), at(1), at(2)];
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

  it('centres the bodies over the origin, on the XY plane, with position: centre (2026-11-04)', {
    timeout: 60_000,
  }, async () => {
    const asFiled = await recompute(design({}).doc);
    const filed = boxes(asFiled, engine as RecomputeEngine);
    const names = bodies(asFiled, engine as RecomputeEngine).map((b) => [b.id, b.faces]);
    const [fx, fy, fz] = around(filed);
    if (!fx || !fy || !fz) throw new Error('no box');
    // The file's B3 is not centred, so the move is a real one.
    expect(Math.abs(fx.min + fx.max) + Math.abs(fy.min + fy.max)).toBeGreaterThan(1);

    for (const up of [undefined, 'y'] as const) {
      const centred = await recompute(design({ position: 'centre', ...(up && { up }) }).doc);
      const moved = boxes(centred, engine as RecomputeEngine);
      const [x, y, z] = around(moved);
      if (!x || !y || !z) throw new Error('no box');
      expect((x.min + x.max) / 2).toBeCloseTo(0, 6);
      expect((y.min + y.max) / 2).toBeCloseTo(0, 6);
      expect(z.min).toBeCloseTo(0, 6);
      // Both bodies by the same move, so they keep their places, IDs and face names.
      expect(bodies(centred, engine as RecomputeEngine).map((b) => [b.id, b.faces])).toEqual(names);
      if (up) continue;
      const by = [-(fx.min + fx.max) / 2, -(fy.min + fy.max) / 2, -fz.min];
      for (const [i, box] of moved.entries()) {
        for (const k of [0, 1, 2]) {
          expect(box.min[k]).toBeCloseTo((filed[i]?.min[k] as number) + (by[k] as number), 6);
        }
      }
    }
  });

  it('refuses a STEP file with a part given only as triangles, with what to do, and goes on', {
    timeout: 120_000,
  }, async () => {
    const box = textOf(tessellatedStray).slice(0, textOf(tessellatedStray).indexOf('#9001='));
    const twoBoxes = (() => {
      using scope = kernel.scope();
      const a = scope.track(kernel.box([20, 20, 20]));
      const b = scope.track(kernel.box([20, 20, 20], [-40, 0, 0]));
      return kernel.writeStep([
        { shape: a, name: 'A' },
        { shape: b, name: 'B' },
      ]);
    })();
    const lone = textOf(tessellatedStray).slice(textOf(tessellatedStray).indexOf('#9001='));
    for (const [name, text] of [
      // Only triangles (a tetrahedron), and a box with surfaces beside one such part.
      ['tessellated.step', textOf(tessellated)],
      ['tessellated-mixed.step', textOf(tessellatedMixed)],
      // A box with surfaces and a lone face given as triangles in a part of its own; the same face
      // as a TRIANGULATED_SURFACE_SET; the face among the box's own items.
      ['tessellated-stray.step', textOf(tessellatedStray)],
      [
        'surface set',
        textOf(tessellatedStray).replace(
          "TRIANGULATED_FACE('',#9018,3,(),$,(),((1,2,3)))",
          "TRIANGULATED_SURFACE_SET('',#9018,3,(),(),((1,2,3)))",
        ),
      ],
      [
        'among the box items',
        `${box.replace('(#11,#15),#345)', '(#11,#15,#9017),#345)')}#9017=TRIANGULATED_FACE('',#9018,3,(),$,(),((1,2,3)));\n#9018=COORDINATES_LIST('',3,((30.,0.,0.),(40.,0.,0.),(30.,10.,0.)));\nENDSEC;\nEND-ISO-10303-21;\n`,
      ],
      // Two solids with surfaces (so the import would split them) and the lone face.
      ['two solids', twoBoxes.replace(/ENDSEC;\s*END-ISO-10303-21;\s*$/, lone)],
    ] as const) {
      expect(text, name).toMatch(/TRIANGULATED_|TESSELLATED_/);
      engine?.clear();
      const result = await recompute(
        design({ bytes: new TextEncoder().encode(text), fileName: `${name}.step` }).doc,
      );
      expect(result.features[IMPORT_ID], name).toEqual({
        status: 'error',
        message:
          'STEP import failed: the file gives at least one face as triangles, not as a surface. Export the part again with its surfaces, or export it as STL or 3MF and import that as a mesh.',
      });
      expect(result.bodies, name).toEqual([]);
      // The same engine and kernel compute the next design (the cache emptied before each design:
      // this test's designs all name their file with one ID and hash).
      engine?.clear();
      const next = await recompute(design({}).doc);
      expect(next.features[IMPORT_ID]?.status, name).toBe('ok');
      expect(next.bodies.length, name).toBeGreaterThan(0);
    }
  });

  it('centres by what becomes bodies: a free face beside two solids leaves them in place', {
    timeout: 60_000,
  }, async () => {
    // Two 10 mm boxes side by side and, 100 mm off, a free square face with a surface.
    const text = (() => {
      using scope = kernel.scope();
      const a = scope.track(kernel.box([10, 10, 10]));
      const b = scope.track(kernel.box([10, 10, 10], [20, 0, 0]));
      const far = scope.track(kernel.box([10, 10, 10], [100, 0, 50]));
      const patch = scope.track(kernel.subShape(far, 'face', 0));
      return kernel.writeStep([
        { shape: a, name: 'A' },
        { shape: b, name: 'B' },
        { shape: patch, name: 'Patch' },
      ]);
    })();
    const read = kernel.readStep(text);
    expect(kernel.count(read, 'face')).toBe(13);
    kernel.release(read);
    const result = await recompute(
      design({ bytes: new TextEncoder().encode(text), position: 'centre' }).doc,
    );
    expect(result.features[IMPORT_ID]?.status).toBe('ok');
    const [x, y, z] = around(boxes(result, engine as RecomputeEngine));
    expect(result.bodies).toHaveLength(2);
    expect(
      [x?.min, x?.max, y?.min, y?.max, z?.min, z?.max].map((v) => Number(v?.toFixed(6)) + 0),
    ).toEqual([-15, 15, -5, 5, 0, 10]);
  });

  it('reads a part by its exact geometry and leaves out a tessellated copy of it', {
    timeout: 120_000,
  }, async () => {
    // A red box named Box with surfaces, and a TESSELLATED_SOLID linked to its solid and faces,
    // in a representation of its own; the same copy among the box's items (where OCCT's writer
    // puts one); the file without the copy.
    const copied = textOf(tessellatedCopy);
    const among = copied
      .replace(/^#9009=SHAPE_DEFINITION_REPRESENTATION.*\n/m, '')
      .replace(/^#9015=TESSELLATED_SHAPE_REPRESENTATION.*\n/m, '')
      .replace('(#11,#15),#345)', '(#11,#15,#9016),#345)');
    const plain = copied.replace(/^#90(09|15|16|3\d)=.*\n/gm, '');
    expect(plain.slice(plain.indexOf('DATA;'))).not.toMatch(/TESSELLATED_|TRIANGULATED_/);
    expect(among).not.toContain('TESSELLATED_SHAPE_REPRESENTATION');
    const read = async (text: string) => {
      engine?.clear();
      const result = await recompute(design({ bytes: new TextEncoder().encode(text) }).doc);
      expect(result.features[IMPORT_ID]?.status).toBe('ok');
      const meshes = result.bodies.map(({ mesh }) => [...(mesh?.positions ?? [])]);
      return {
        bodies: bodies(result, engine as RecomputeEngine),
        meshes,
        report: result.reports[IMPORT_ID],
        versions: result.bodies.map((b) => b.version),
      };
    };
    const expected = await read(plain);
    expect(expected.bodies.map((b) => [b.size, b.volume])).toEqual([
      [[20, 20, 20], expect.closeTo(8000, 6)],
    ]);
    expect(expected.report).toMatchObject({ names: { [expected.bodies[0]?.id as string]: 'Box' } });
    expect(Object.keys((expected.report as { colors: object }).colors)).toHaveLength(1);
    expect(await read(copied)).toEqual(expected);
    expect(await read(among)).toEqual(expected);
    // The three readers the import uses for colours, names and hidden solids see its one solid.
    const hidden = (text: string) =>
      text.replace('ENDSEC;\nEND-ISO', '#9110=INVISIBILITY((#9108));\nENDSEC;\nEND-ISO');
    for (const text of [copied, among]) {
      expect(kernel.readStepColors(text)).toEqual(kernel.readStepColors(plain));
      expect(kernel.readStepNames(text)).toEqual(['Box']);
      expect(kernel.readStepHidden(hidden(text))).toEqual([true]);
    }
    // A copy with no links to the faces it copies is read as faces without a surface: refused.
    const unlinked = copied
      .replace(
        '(#9031,#9032,#9033,#9034,#9035,#9036),#15)',
        '(#9031,#9032,#9033,#9034,#9035,#9036),$)',
      )
      .replace(/(TRIANGULATED_FACE\('',#9030,8,\(\)),#\d+,/g, '$1,$,');
    expect(unlinked).not.toMatch(/TRIANGULATED_FACE\('',#9030,8,\(\),#/);
    engine?.clear();
    const refused = await recompute(design({ bytes: new TextEncoder().encode(unlinked) }).doc);
    expect(refused.features[IMPORT_ID]?.status).toBe('error');
    expect(refused.bodies).toEqual([]);
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

  it('reads reals written without a decimal point as the standard requires (2026-11-15)', {
    timeout: 60_000,
  }, async () => {
    // A 10 mm box as another writer might put it: `1e1` for 10., `0e0` for 0.,
    // `1e0` for 1. (one-digit mantissas, which the reader took as other numbers).
    const box = (() => {
      using scope = kernel.scope();
      const shape = scope.track(kernel.box([10, 10, 10]));
      return kernel.writeStep([{ shape, name: 'Box' }]);
    })();
    const odd = box.replace(/(?<=[(,])(-?)(10|0|1)\.(?=[,)])/g, (_, sign, n) =>
      n === '10' ? `${sign}1e1` : n === '0' ? `${sign}0e0` : `${sign}1e0`,
    );
    expect(odd).not.toBe(box);
    expect(odd).toMatch(/[(,]1e1[,)]/);
    const result = await recompute(design({ bytes: new TextEncoder().encode(odd) }).doc);
    expect(result.features[IMPORT_ID]?.status).toBe('ok');
    expect(bodies(result, engine as RecomputeEngine).map((b) => [b.size, b.volume])).toEqual([
      [[10, 10, 10], expect.closeTo(1000, 6)],
    ]);
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
