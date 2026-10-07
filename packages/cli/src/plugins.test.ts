// Plugins end to end (P6-03 slice 1, ADR-0077): the example plugin
// (`examples/plugins/name-plate/`) packed into a `.extrudo-plugin` file,
// carried by a design as an attachment, and run by the real engine with the
// real OCCT build and the script runner injected — headless through the CLI's
// own `openDesign`, as `extrudo export` runs a design. This package is the one
// that holds both the runner and the kernel (ADR-0070 §2), so the tests live
// here.
//
// The engines run with `strictLeaks`, and every QuickJS handle a run makes is
// freed before it returns (QuickJS aborts the process otherwise).

import { readFileSync } from 'node:fs';
import { Design } from '@extrudo/api';
import {
  type AttachmentId,
  addAttachment,
  type ExtrudoDocument,
  type FeatureId,
  type FeatureStatus,
  loadDocument,
  PLUGIN_MEDIA_TYPE,
  remintFeatures,
} from '@extrudo/core';
import { Kernel, type RecomputeResult, runPluginCommand } from '@extrudo/kernel';
import { kernelFeatures, loadOcct, RecomputeEngine } from '@extrudo/kernel/node';
import { loadScriptHost, PLUGIN_REFUSAL_RULE, type ScriptHostAdapter } from '@extrudo/script';
import { sha256Hex, writeArchive, writePluginFile } from '@extrudo/storage';
import { strToU8, zipSync } from 'fflate';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { openDesign } from './headless';

type Done = Extract<RecomputeResult, { status: 'done' }>;

const EXAMPLE = new URL('../../../examples/plugins/name-plate/', import.meta.url);
const read = (file: string) => readFileSync(new URL(file, EXAMPLE), 'utf8');

/** The example's own manifest, parsed, so a test can change one field of it. */
const MANIFEST = (): Record<string, unknown> => JSON.parse(read('plugin.json'));

/** The example plugin as a file, or with its manifest or module changed. */
function pluginBytes(manifest = MANIFEST(), code = read('main.ts')): Uint8Array {
  return writePluginFile({ manifest, code, readme: read('README.md') });
}

const PLUGIN = 'name-plate' as AttachmentId;

/** A design that carries `bytes` as its plugin file (written before the feature, ADR-0061). */
function designWith(bytes: Uint8Array): Design {
  const d = Design.create({ name: 'Plate', now: '2026-10-07T00:00:00.000Z' });
  d.state.dispatch(
    addAttachment({
      id: PLUGIN,
      attachment: {
        name: 'Name plate 1.0.0',
        fileName: 'name-plate.extrudo-plugin',
        mediaType: PLUGIN_MEDIA_TYPE,
        sha256: sha256Hex(bytes),
        size: bytes.byteLength,
      },
    }),
  );
  return d;
}

/** The area of a `w` × `h` rectangle with its corners rounded by a quarter of the shorter side. */
const roundedArea = (w: number, h: number) => w * h - (4 - Math.PI) * (Math.min(w, h) / 4) ** 2;

let kernel: Kernel;
let host: ScriptHostAdapter;
const engines: RecomputeEngine[] = [];

beforeAll(async () => {
  kernel = new Kernel(await loadOcct());
  host = await loadScriptHost();
});

afterEach(() => {
  for (const engine of engines.splice(0)) engine.clear();
  expect(kernel.stats().liveShapes).toBe(0);
});

afterAll(() => {
  kernel.dispose();
});

/** An engine that has `files` (attachment ID → bytes) as the worker would. */
function engineOf(files: ReadonlyMap<string, Uint8Array>): RecomputeEngine {
  const engine = new RecomputeEngine(kernel, kernelFeatures(), {
    strictLeaks: true,
    scripts: () => host,
    files: (id) => {
      const bytes = files.get(id);
      return bytes && { bytes, mediaType: PLUGIN_MEDIA_TYPE, fileName: `${id}.extrudo-plugin` };
    },
  });
  engines.push(engine);
  return engine;
}

async function compute(engine: RecomputeEngine, doc: ExtrudoDocument): Promise<Done> {
  const result = await engine.recompute({ doc });
  if (result.status !== 'done') throw new Error('The recompute was cancelled.');
  return result;
}

/** The status of the design's last feature (the plugin feature in every test here). */
function lastStatus(doc: ExtrudoDocument, result: Done): FeatureStatus | undefined {
  return result.features[doc.features.at(-1)?.id as FeatureId];
}

describe('the example plugin, headless', () => {
  it('makes a name plate from a design that carries the plugin, driven by a parameter', async () => {
    const bytes = pluginBytes();
    const d = designWith(bytes);
    const width = d.parameter('plateWidth', '60 mm');
    d.plugin(
      {
        plugin: PLUGIN,
        handler: 'name-plate',
        inputs: { width, height: '20 mm', thickness: '3 mm', rounded: true, plane: d.origin.xy },
      },
      { name: 'Name plate1' },
    );
    const archive = writeArchive(d.toJSON(), undefined, [], new Map([[sha256Hex(bytes), bytes]]));
    const { job, notices } = await openDesign(archive);
    try {
      expect(notices).toEqual([]);
      const first = await job.compute();
      const feature = first.features.find((f) => f.type === 'plugin');
      expect(feature).toMatchObject({ name: 'Name plate1', status: 'ok' });
      expect(feature?.script?.generated.map((g) => [g.name, g.status])).toEqual([
        ['Name plate1 › Sketch1', 'ok'],
        ['Name plate1 › Extrude1', 'ok'],
      ]);
      expect(first.bodies).toHaveLength(1);
      const [plate] = first.bodies;
      expect(plate?.faces).toBe(10);
      expect(plate?.volume).toBeCloseTo(roundedArea(60, 20) * 3, 6);
      expect(plate?.size.map((v) => Math.round(v * 1000) / 1000)).toEqual([60, 20, 3]);
      // A parameter drives the plugin's expression input like any other.
      await job.setParameters({ plateWidth: '80 mm' });
      const wider = await job.compute();
      expect(wider.bodies[0]?.volume).toBeCloseTo(roundedArea(80, 20) * 3, 6);
      expect(wider.bodies[0]?.size[0]).toBeCloseTo(80, 3);
    } finally {
      await job.dispose();
    }
  });

  it('takes the defaults for inputs a feature leaves out, and square corners when asked', async () => {
    const bytes = pluginBytes();
    const d = designWith(bytes);
    d.plugin({ plugin: PLUGIN, handler: 'name-plate', inputs: { rounded: false } });
    const doc = d.toJSON();
    const engine = engineOf(new Map([[PLUGIN, bytes]]));
    const result = await compute(engine, doc);
    expect(lastStatus(doc, result)).toMatchObject({ status: 'ok' });
    const shape = engine.latestBody(result.bodies[0]?.id ?? ('' as never));
    if (shape === undefined) throw new Error('No body.');
    // 60 × 20 × 3 mm from the manifest's defaults, on the XY plane.
    expect(kernel.properties(shape).volume).toBeCloseTo(3600, 6);
    expect(result.bodies[0]?.mesh?.faceIds).toHaveLength(6);
  });

  it('opens a design whose plugin feature has an in: input of a foreign kind, and fails only that feature', async () => {
    const bytes = pluginBytes();
    const foreign: Record<string, unknown> = {
      file: { kind: 'file', id: 'gone' },
      labels: { kind: 'labels', labels: ['2'] },
      code: { kind: 'code', value: 'x' },
      sketchData: {
        kind: 'sketchData',
        sketch: { entities: {}, constraints: {}, dimensions: {} },
      },
    };
    for (const [kind, input] of Object.entries(foreign)) {
      const d = designWith(bytes);
      d.plugin({ plugin: PLUGIN, handler: 'name-plate', inputs: { rounded: false } });
      const raw = JSON.parse(JSON.stringify(d.toJSON()));
      raw.features.at(-1).inputs['in:x'] = input;
      const { doc } = loadDocument(raw);
      const engine = engineOf(new Map([[PLUGIN, bytes]]));
      const result = await compute(engine, doc);
      const status = lastStatus(doc, result);
      expect(status?.status, kind).toBe('error');
      expect(status?.message, kind).toBe("Invalid inputs: in:x has a kind this plugin can't take");
    }
  });

  it('runs the command through runPlugin, and its features cut the plate', async () => {
    const bytes = pluginBytes();
    const d = designWith(bytes);
    d.plugin({ plugin: PLUGIN, handler: 'name-plate', inputs: { plane: d.origin.xy } });
    const before = d.toJSON();
    const run = host.runPlugin({
      code: read('main.ts'),
      language: 'ts',
      handler: { kind: 'command', name: 'three-holes' },
      doc: before,
      featureId: 'cmd' as FeatureId,
      featureName: 'Three holes',
      params: {},
    });
    if (!run.ok) throw new Error(run.error.message);
    expect(run.features.map((f) => [f.id, f.type, f.name])).toEqual([
      ['cmd.f1', 'sketch', 'Three holes › Sketch1'],
      ['cmd.f2', 'extrude', 'Three holes › Extrude1'],
    ]);
    expect(run.features[1]?.inputs).toMatchObject({
      operation: { kind: 'enum', value: 'cut' },
      extent: { kind: 'enum', value: 'through-all' },
    });
    // Stored after the plate, as slice 2's one-transaction insert will.
    const doc: ExtrudoDocument = {
      ...before,
      features: [...before.features, ...run.features],
      timelineMarker: before.features.length + run.features.length,
    };
    const engine = engineOf(new Map([[PLUGIN, bytes]]));
    const result = await compute(engine, doc);
    expect(Object.values(result.features).every((s) => s.status === 'ok')).toBe(true);
    const shape = engine.latestBody(result.bodies[0]?.id ?? ('' as never));
    if (shape === undefined) throw new Error('No body.');
    const holes = 3 * Math.PI * 2 ** 2 * 3;
    expect(kernel.properties(shape).volume).toBeCloseTo(roundedArea(60, 20) * 3 - holes, 6);
  });
});

describe("a plugin's command, as the app runs it (P6-03 slice 2)", () => {
  it('runs in the worker on the selection, and its re-minted features cut the plate', async () => {
    const bytes = pluginBytes();
    const d = designWith(bytes);
    const plate = d.plugin({
      plugin: PLUGIN,
      handler: 'name-plate',
      inputs: { plane: d.origin.xy },
    });
    const before = d.toJSON();
    // What `KernelService.runPluginCommand` does with the file the app sent.
    const run = runPluginCommand(
      host,
      { bytes, mediaType: PLUGIN_MEDIA_TYPE },
      {
        fileId: 'plugin:name-plate@1.0.0',
        commandId: 'three-holes',
        doc: before,
        selection: [{ kind: 'body', id: `${plate.id}.f2:0` }],
      },
    );
    if (!run.ok) throw new Error(run.error.message);
    // What the app's one-transaction insert stores: fresh IDs, the app's names.
    const ids = ['c0ffee01', 'c0ffee02'] as FeatureId[];
    const features = remintFeatures(run.features, before, ids);
    expect(features.map((f) => [f.id, f.name])).toEqual([
      ['c0ffee01', 'Sketch1'],
      ['c0ffee02', 'Extrude1'],
    ]);
    expect(JSON.stringify(features)).not.toContain('cmd.');
    const doc: ExtrudoDocument = {
      ...before,
      features: [...before.features, ...features],
      timelineMarker: before.features.length + features.length,
    };
    const result = await compute(engineOf(new Map([[PLUGIN, bytes]])), doc);
    expect(Object.values(result.features).every((s) => s.status === 'ok')).toBe(true);
    const shape = result.bodies[0] && engines.at(-1)?.latestBody(result.bodies[0].id);
    if (shape === undefined) throw new Error('No body.');
    const holes = 3 * Math.PI * 2 ** 2 * 3;
    expect(kernel.properties(shape).volume).toBeCloseTo(roundedArea(60, 20) * 3 - holes, 6);
  });

  it("words a handler's failure with the plugin, its version and the line in main.ts", () => {
    const code =
      "export const commands = {\n  'three-holes': () => {\n    throw new Error('no');\n  },\n};\n";
    const bytes = pluginBytes(MANIFEST(), code);
    const run = runPluginCommand(
      host,
      { bytes, mediaType: PLUGIN_MEDIA_TYPE },
      { fileId: 'x', commandId: 'three-holes', doc: designWith(bytes).toJSON(), selection: [] },
    );
    expect(run).toMatchObject({
      ok: false,
      error: { message: 'Name plate 1.0.0, main.ts line 3: Error: no', line: 3 },
    });
  });
});

describe('what a plugin feature refuses', () => {
  /** The example's feature with one handler swapped for `code`'s. */
  async function withModule(code: string, handler = 'name-plate') {
    const bytes = pluginBytes(MANIFEST(), code);
    const d = designWith(bytes);
    d.plugin({ plugin: PLUGIN, handler }, { name: 'Name plate1' });
    const doc = d.toJSON();
    return { doc, result: await compute(engineOf(new Map([[PLUGIN, bytes]])), doc) };
  }

  it("words a remove call as a plugin's refusal, with the plugin, the file and the line", async () => {
    const { doc, result } = await withModule(
      `export const features = {\n  'name-plate': (design) => {\n    design.remove('f1');\n  },\n};\n`,
    );
    expect(lastStatus(doc, result)).toMatchObject({
      status: 'error',
      message: `Name plate 1.0.0, main.ts line 3: ${PLUGIN_REFUSAL_RULE}: design.remove() would delete a feature.`,
      script: { line: 3, generated: [] },
    });
    expect(result.bodies).toEqual([]);
  });

  it('names a handler the module lacks, and one the manifest lacks', async () => {
    const { doc, result } = await withModule('export const features = {};\n');
    expect(lastStatus(doc, result)?.message).toBe(
      "Name plate 1.0.0, main.ts: main.ts exports no `features['name-plate']`.",
    );
    const other = await withModule(read('main.ts'), 'badge');
    expect(lastStatus(other.doc, other.result)?.message).toBe(
      'The plugin Name plate 1.0.0 has no custom feature "badge".',
    );
  });

  it('refuses a manifest with an input kind it does not know, with its place', async () => {
    const manifest = MANIFEST();
    const features = manifest.features as { inputs: Record<string, unknown>[] }[];
    (features[0]?.inputs[3] as Record<string, unknown>).kind = 'colour';
    const bytes = pluginBytes(manifest);
    const d = designWith(bytes);
    d.plugin({ plugin: PLUGIN, handler: 'name-plate' }, { name: 'Name plate1' });
    const doc = d.toJSON();
    const result = await compute(engineOf(new Map([[PLUGIN, bytes]])), doc);
    expect(lastStatus(doc, result)?.message).toBe(
      "The plugin Name plate 1.0.0 (name-plate.extrudo-plugin) can't be read: plugin.json › features[0] › inputs[3] › kind: expected one of expr, bool, enum, ref",
    );
  });

  it('refuses a plugin file with a path outside its folder', async () => {
    const bytes = zipSync({
      'plugin.json': strToU8(read('plugin.json')),
      'main.ts': strToU8(read('main.ts')),
      '../evil.ts': strToU8('export {};'),
    });
    const d = designWith(bytes);
    d.plugin({ plugin: PLUGIN, handler: 'name-plate' }, { name: 'Name plate1' });
    const doc = d.toJSON();
    const result = await compute(engineOf(new Map([[PLUGIN, bytes]])), doc);
    expect(lastStatus(doc, result)?.message).toBe(
      "The plugin Name plate 1.0.0 (name-plate.extrudo-plugin) can't be read: This plugin file has an entry outside its folder: ../evil.ts.",
    );
  });

  it('says the plugin is missing when the design carries its record but not its bytes', async () => {
    const d = designWith(pluginBytes());
    d.plugin({ plugin: PLUGIN, handler: 'name-plate' }, { name: 'Name plate1' });
    const doc = d.toJSON();
    const result = await compute(engineOf(new Map()), doc);
    expect(lastStatus(doc, result)).toMatchObject({
      status: 'error',
      message:
        "The plugin Name plate 1.0.0 (name-plate.extrudo-plugin) is missing from this design, so Name plate1 can't run.",
    });
  });

  it('checks an input against the manifest: its unit, and a key the manifest lacks', async () => {
    const bytes = pluginBytes();
    const d = designWith(bytes);
    d.plugin(
      { plugin: PLUGIN, handler: 'name-plate', inputs: { width: 60, colour: true } },
      { name: 'Name plate1' },
    );
    const doc = d.toJSON();
    const result = await compute(engineOf(new Map([[PLUGIN, bytes]])), doc);
    expect(lastStatus(doc, result)?.message).toBe(
      'The input "width" takes a length, but it holds a plain number.',
    );
    const fixed = designWith(bytes);
    fixed.plugin(
      { plugin: PLUGIN, handler: 'name-plate', inputs: { width: '50 mm', colour: true } },
      { name: 'Name plate1' },
    );
    const warned = fixed.toJSON();
    const again = await compute(engineOf(new Map([[PLUGIN, bytes]])), warned);
    expect(lastStatus(warned, again)).toMatchObject({
      status: 'warning',
      message: 'The plugin\'s Name plate has no input "colour", so it was left out.',
    });
  });
});

describe("a plugin feature's references", () => {
  /** A plugin whose feature pads a circle on a picked face. */
  const PAD_MANIFEST = {
    id: 'face-pad',
    name: 'Face pad',
    version: '0.2.0',
    description: 'A round pad on a face.',
    author: 'Tests',
    license: 'MIT',
    main: 'main.js',
    features: [
      {
        type: 'pad',
        label: 'Pad',
        inputs: [{ name: 'face', label: 'Face', kind: 'ref', accepts: ['face'] }],
      },
    ],
  };
  const PAD = `export const features = {
  pad: (design, inputs) => {
    const s = design.sketch(inputs.face, (k) => k.circle([0, 0], '3 mm'));
    design.extrude({ profiles: s.profiles(), distance: '2 mm', operation: 'join' });
  },
};
`;

  it('resolves a face before the feature, and loses a missing one to Fix References', async () => {
    const bytes = writePluginFile({ manifest: PAD_MANIFEST, code: PAD });
    const d = designWith(bytes);
    const box = d.box({ length: '20 mm', width: '20 mm', height: '10 mm' });
    d.plugin({ plugin: PLUGIN, handler: 'pad', inputs: { face: box.face('cap:end') } });
    const doc = d.toJSON();
    const engine = engineOf(new Map([[PLUGIN, bytes]]));
    const result = await compute(engine, doc);
    expect(lastStatus(doc, result)).toMatchObject({ status: 'ok' });
    const shape = engine.latestBody(result.bodies[0]?.id ?? ('' as never));
    if (shape === undefined) throw new Error('No body.');
    expect(kernel.properties(shape).volume).toBeCloseTo(4000 + Math.PI * 9 * 2, 6);

    const lost = structuredClone(d.toJSON());
    const feature = lost.features.at(-1);
    if (!feature) throw new Error('No feature.');
    feature.inputs['in:face'] = {
      kind: 'ref',
      refs: [{ kind: 'face', id: 'box:f1:side:nowhere' }],
    };
    const failed = await compute(engineOf(new Map([[PLUGIN, bytes]])), lost);
    expect(lastStatus(lost, failed)).toMatchObject({
      status: 'error',
      refs: [{ ref: { kind: 'face', id: 'box:f1:side:nowhere' }, state: 'lost' }],
    });
  });
});
