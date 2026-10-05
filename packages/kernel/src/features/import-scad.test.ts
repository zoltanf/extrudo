// The OpenSCAD branch of the `import` feature (P5-04, ADR-0071): a `.scad`
// file of the design is compiled by OpenSCAD's real WASM in a worker of its
// own, in the engine's `prepare`, and becomes mesh bodies through ADR-0066's
// mesh path. Real OCCT, a real manifold module and `strictLeaks`.
import {
  type AttachmentId,
  type BodyId,
  type ExtrudoDocument,
  type Feature,
  type FeatureId,
  importInputs,
  primitiveInputs,
} from '@extrudo/core';
import type { ScadCompiler, ScadRequest, ScadResult } from '@extrudo/openscad';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import flatScad from '../../../../fixtures/imports/flat.scad?raw';
import missingScad from '../../../../fixtures/imports/missing-include.scad?raw';
import plateScad from '../../../../fixtures/imports/plate.scad?raw';
import syntaxScad from '../../../../fixtures/imports/syntax-error.scad?raw';
import twoBlocksScad from '../../../../fixtures/imports/two-blocks.scad?raw';
import { Kernel } from '../kernel';
import { loadManifold } from '../manifold';
import { loadOcct } from '../occt/load';
import { RecomputeEngine } from '../recompute/engine';
import { testDocument, testFeature } from '../recompute/testing';
import type { ImportedFile, RecomputeResult } from '../recompute/types';
import { kernelFeatures } from '.';

type Done = Extract<RecomputeResult, { status: 'done' }>;

// The Node compiler is `@extrudo/openscad/node`, which needs Node's types; the
// kernel's program has none (it runs in a worker), so the entry is loaded
// through a name the type checker doesn't follow.
const NODE_ENTRY = '@extrudo/openscad/node';

let kernel: Kernel;
let compiler: ScadCompiler;
/** Every compile the engine asked for, to see the cache at work. */
const compiled: ScadRequest[] = [];
let engine: RecomputeEngine | undefined;
const held = new Map<AttachmentId, ImportedFile>();

beforeAll(async () => {
  kernel = new Kernel(await loadOcct());
  kernel.enableMeshes(await loadManifold());
  const { createNodeCompiler } = (await import(/* @vite-ignore */ NODE_ENTRY)) as {
    createNodeCompiler(): ScadCompiler;
  };
  const real = createNodeCompiler();
  compiler = {
    compile(request): Promise<ScadResult> {
      compiled.push(request);
      return real.compile(request);
    },
    dispose: () => real.dispose(),
  };
});

afterAll(() => compiler.dispose());

afterEach(() => {
  engine?.clear();
  engine = undefined;
  held.clear();
  compiled.length = 0;
  expect(kernel.stats().liveShapes).toBe(0);
});

const FILE = 'file-scad' as AttachmentId;
const files = (id: AttachmentId) => held.get(id);

/** An import of a `.scad` source under a file name, with its overrides. */
function importScad(
  source: string,
  options: {
    fileName?: string;
    overrides?: { name: string; value: string; unit?: 'length' | 'unitless' }[];
  } = {},
): Feature {
  const bytes = new TextEncoder().encode(source);
  held.set(FILE, {
    bytes,
    mediaType: 'application/x-openscad',
    fileName: options.fileName ?? 'plate.scad',
  });
  return {
    ...testFeature('Import1', 'import'),
    inputs: importInputs({
      file: FILE,
      ...(options.overrides && { overrides: options.overrides }),
    }),
  };
}

function design(features: Feature[], parameters: Record<string, string> = {}): ExtrudoDocument {
  const file = held.get(FILE);
  return {
    ...testDocument(features, parameters),
    attachments: {
      [FILE]: {
        name: 'plate',
        fileName: file?.fileName ?? 'plate.scad',
        mediaType: 'application/x-openscad',
        sha256: 'd'.repeat(64),
        size: file?.bytes.length ?? 0,
      },
    },
  };
}

async function recompute(doc: ExtrudoDocument, withCompiler = true): Promise<Done> {
  engine ??= new RecomputeEngine(kernel, kernelFeatures(), {
    strictLeaks: true,
    files,
    ...(withCompiler && { openscad: () => compiler }),
  });
  const result = await engine.recompute({ doc });
  if (result.status !== 'done') throw new Error('cancelled');
  return result;
}

const status = (result: Done, id = 'Import1') => result.features[id as FeatureId];

function ok(result: Done): Done {
  for (const [id, s] of Object.entries(result.features)) {
    if (s.status === 'error') throw new Error(`${id}: ${s.message}`);
  }
  return result;
}

const round = (x: number, digits = 3) => {
  const r = Number(x.toFixed(digits));
  return Object.is(r, -0) ? 0 : r;
};

/** Each body's ID, size, lowest corner, volume, mesh flag and face names. */
function bodies(result: Done) {
  return result.bodies.map(({ id, mesh }) => {
    const shape = (engine as RecomputeEngine).latestBody(id as BodyId);
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

/** The plate's volume: a size² × height block less a 64-gon prism of the hole. */
function plateVolume(size: number, height: number, hole: number): number {
  const polygon = 0.5 * 64 * (hole / 2) ** 2 * Math.sin((2 * Math.PI) / 64);
  return size * size * height - polygon * height;
}

/** Within ±0.5 % of `expected` (the brief's tolerance; it is far closer). */
const near = (got: number, expected: number) => Math.abs(got - expected) <= expected * 0.005;

describe('OpenSCAD import (P5-04, ADR-0071)', { timeout: 120_000 }, () => {
  it('compiles a cube less a cylinder into one closed mesh body', async () => {
    const result = ok(await recompute(design([importScad(plateScad)])));
    expect(status(result)).toEqual({ status: 'ok' });
    const [body] = bodies(result);
    expect(body).toMatchObject({
      id: 'Import1:0',
      size: [20, 20, 10],
      min: [0, 0, 0],
      isMesh: true,
      faces: ['mesh:Import1'],
    });
    expect(near(body?.volume ?? 0, plateVolume(20, 20 / 2, 8))).toBe(true);
    // The 3MF's 1 µm: far inside the brief's 0.5 %.
    expect(body?.volume).toBeCloseTo(plateVolume(20, 10, 8), 2);
  });

  it('makes a body of each separate solid, the larger one first', async () => {
    const result = ok(
      await recompute(design([importScad(twoBlocksScad, { fileName: 'two.scad' })])),
    );
    expect(
      bodies(result).map(({ id, size, min, volume, faces }) => ({ id, size, min, volume, faces })),
    ).toEqual([
      {
        id: 'Import1:0',
        size: [10, 10, 10],
        min: [0, 0, 0],
        volume: expect.closeTo(1000, 6),
        faces: ['mesh:Import1'],
      },
      {
        id: 'Import1:1',
        size: [5, 5, 5],
        min: [20, 0, 0],
        volume: expect.closeTo(125, 6),
        faces: ['mesh:Import1#2'],
      },
    ]);
  });

  it("says where a syntax error is, in OpenSCAD's words", async () => {
    const result = await recompute(design([importScad(syntaxScad, { fileName: 'gear.scad' })]));
    expect(status(result)).toEqual({
      status: 'error',
      message: 'gear.scad, line 4: syntax error.',
    });
    expect(result.bodies).toEqual([]);
  });

  it('refuses a file that only makes a 2D shape', async () => {
    const result = await recompute(design([importScad(flatScad, { fileName: 'flat.scad' })]));
    expect(status(result)).toEqual({
      status: 'error',
      message:
        'flat.scad makes a 2D shape: Extrudo imports 3D solids (extrude it with linear_extrude or rotate_extrude).',
    });
  });

  it('names a library the file includes and the design lacks', async () => {
    const result = await recompute(design([importScad(missingScad, { fileName: 'gears.scad' })]));
    expect(status(result)).toEqual({
      status: 'error',
      message:
        "gears.scad, line 2: can't find MCAD/involute_gears.scad. Extrudo compiles one .scad file on its own, without libraries or other files.",
    });
  });

  it('turns echoes into warnings', async () => {
    const result = ok(await recompute(design([importScad('echo("hello", 1 + 2);\ncube(5);')])));
    expect(status(result)).toEqual({ status: 'warning', message: 'plate.scad echoes "hello", 3.' });
  });

  it('says so when the kernel has no compiler', async () => {
    const result = await recompute(design([importScad(plateScad)]), false);
    expect(status(result)).toEqual({
      status: 'error',
      message: "OpenSCAD isn't loaded in this kernel, so .scad files can't be compiled here.",
    });
  });

  it('follows a document parameter through an override, and caches the compile', async () => {
    const plate = (size: string) =>
      design(
        [
          importScad(plateScad, {
            overrides: [
              { name: 'size', value: 'width', unit: 'length' },
              { name: 'hole', value: '5' },
            ],
          }),
        ],
        {
          width: size,
        },
      );
    const first = ok(await recompute(plate('30 mm')));
    expect(bodies(first)[0]?.size).toEqual([30, 30, 10]);
    expect(bodies(first)[0]?.volume).toBeCloseTo(plateVolume(30, 10, 5), 2);
    expect(compiled.map((r) => r.defines)).toEqual([
      [
        { name: 'size', value: 30 },
        { name: 'hole', value: 5 },
      ],
    ]);

    // The same values: the engine's cache, no compile.
    const again = await recompute(plate('30 mm'));
    expect(again.bodies.map((b) => b.id)).toEqual(['Import1:0']);
    expect(compiled).toHaveLength(1);

    // A new value compiles again and changes the body.
    const wider = ok(await recompute(plate('2 * 20 mm')));
    expect(bodies(wider)[0]?.size).toEqual([40, 40, 10]);
    expect(compiled).toHaveLength(2);

    // Back to 30 mm: the compile is remembered, the engine's entry too.
    ok(await recompute(plate('30 mm')));
    expect(compiled).toHaveLength(2);
  });

  it('warns about an override of a variable the file lacks, and refuses half a pair', async () => {
    const unknown = await recompute(
      design([importScad(plateScad, { overrides: [{ name: 'teeth', value: '12' }] })]),
    );
    expect(status(unknown)).toEqual({
      status: 'warning',
      message: 'plate.scad has no variable teeth: its override does nothing.',
    });
    // $fn is OpenSCAD's own: it is never "missing".
    const fn = ok(
      await recompute(
        design([importScad(plateScad, { overrides: [{ name: '$fn', value: '16' }] })]),
      ),
    );
    expect(status(fn)).toEqual({ status: 'ok' });

    const half: Feature = {
      ...importScad(plateScad),
      inputs: {
        ...importInputs({ file: FILE }),
        scadValue: { kind: 'expr', expr: '3', unit: 'unitless' },
      },
    };
    const refused = await recompute(design([half]));
    expect(status(refused)).toEqual({
      status: 'error',
      message: 'Override 1 has a value but no variable: name the variable of plate.scad it sets.',
    });
  });

  it('takes part in a boolean with a B-rep box', async () => {
    // A 10 mm box over the plate's corner, cut out of it, and one joined beside it.
    const box = (id: string, x: string, operation: 'cut' | 'join') => ({
      ...testFeature(id, 'box'),
      inputs: primitiveInputs('box', {
        numbers: { length: '10 mm', width: '10 mm', height: '20 mm', x, y: '0 mm' },
        operation,
      }),
    });
    const result = ok(
      await recompute(
        design([importScad(plateScad), box('Cut', '0 mm', 'cut'), box('Join', '25 mm', 'join')]),
      ),
    );
    const [plate] = bodies(result);
    expect(plate?.isMesh).toBe(true);
    expect(plate?.faces).toEqual(['mesh:Join']);
    // Cut: a box is centred on its (x, y), so a 5 × 5 corner of the plate
    // goes. Join: that box (20…30 in x, −5…5 in y) meets the plate at x = 20.
    expect(plate?.volume).toBeCloseTo(plateVolume(20, 10, 8) - 5 * 5 * 10 + 10 * 10 * 20, 2);
    expect(plate?.size).toEqual([30, 25, 20]);
  });

  it('compiles fifty sizes without leaking or growing', { timeout: 300_000 }, async () => {
    const plate = (size: number) =>
      design([importScad(plateScad, { overrides: [{ name: 'size', value: `${size}` }] })]);
    // The compiler's worker is a thread of this process: its WASM is in the rss.
    const { process } = globalThis as unknown as { process: { memoryUsage(): { rss: number } } };
    const rss = () => process.memoryUsage().rss / 2 ** 20;
    const start = rss();
    let first = 0;
    const times: number[] = [];
    for (let i = 0; i < 50; i++) {
      const t = performance.now();
      ok(await recompute(plate(20 + i)));
      times.push(performance.now() - t);
      // The first compile starts the worker and compiles the WASM.
      if (i === 0) first = rss();
    }
    const grown = rss() - first;
    expect(compiled).toHaveLength(50);
    expect(kernel.stats().liveShapes).toBeGreaterThan(0);
    engine?.clear();
    expect(kernel.stats().liveShapes).toBe(0);
    times.sort((a, b) => a - b);
    console.info(
      `50 compiles: median ${times[25]?.toFixed(0)} ms a recompute; rss +${(first - start).toFixed(0)} MB for the first, +${grown.toFixed(0)} MB over the other 49`,
    );
    // A fresh OpenSCAD instance per compile: memory goes with each one.
    expect(grown).toBeLessThan(400);
  });
});
