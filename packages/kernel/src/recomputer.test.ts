// The Recomputer against an in-process kernel with the test features. The
// worker path (Comlink, transfers) is covered by e2e/recompute.spec.ts.
import {
  type AttachmentId,
  AttachmentIdSchema,
  type BodyId,
  canvasInputs,
  createDocumentStore,
  createModelStore,
  type DocumentStore,
  type ExtrudoDocument,
  type Feature,
  type FeatureId,
  type GeomRef,
  importInputs,
  type ModelStore,
  originPlaneRef,
  renameFeature,
} from '@extrudo/core';
import { afterEach, describe, expect, it } from 'vitest';
import interRegular from '../fonts/fonts/inter-regular.ttf?url&inline';
import type { KernelConnection } from './client';
import type { BodyMesh } from './mesh';
import { loadOcct } from './occt/load';
import {
  chainDocument,
  testDocument,
  testFeature,
  testFeatures,
  withExpr,
} from './recompute/testing';
import type { RecomputeRequest } from './recompute/types';
import { type FileSource, type FontSource, Recomputer } from './recomputer';
import { KernelService } from './service';

const until = async (condition: () => boolean, ms = 20_000) => {
  const end = Date.now() + ms;
  while (!condition()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
};

let recomputer: Recomputer | undefined;
afterEach(() => recomputer?.dispose());

function setup(doc: ExtrudoDocument, options: { fonts?: FontSource; files?: FileSource } = {}) {
  const requests: RecomputeRequest[] = [];
  /** What went to each kernel, in order: a font or file, then `recompute`. */
  const events: string[] = [];
  let spawned = 0;
  const spawn = (): KernelConnection => {
    spawned++;
    const service = new KernelService(() => loadOcct(), { features: testFeatures().registry });
    return {
      api: {
        ...bind(service),
        addFont: (id: string, bytes: ArrayBuffer) => {
          events.push(`font:${id}:${bytes.byteLength}`);
          return service.addFont(id, bytes);
        },
        addFile: (id: AttachmentId, bytes: ArrayBuffer, mediaType: string, fileName?: string) => {
          events.push(`file:${id}:${mediaType}:${fileName}:${bytes.byteLength}`);
          return service.addFile(id, bytes, mediaType, fileName);
        },
        enableMeshes: () => {
          events.push('meshes');
          return service.enableMeshes();
        },
        // This kernel has no compiler: the test hears the call and goes on.
        enableOpenscad: async () => {
          events.push('openscad');
        },
        scadParameters: async (id: AttachmentId) => {
          events.push(`scad-parameters:${id}`);
          return {
            ok: true as const,
            parameters: [{ name: 'width', type: 'number', initial: 40 }],
          };
        },
        recompute: (request, onFeature) => {
          requests.push(request);
          events.push('recompute');
          return service.recompute(request, onFeature);
        },
        preview: (request, onFeature) => {
          events.push(`preview:${request.draft.id}`);
          return service.preview(request, onFeature);
        },
      },
      terminate: () => {},
      onFatal: () => {},
    };
  };
  const document = createDocumentStore(doc);
  const model = createModelStore<BodyMesh>();
  recomputer = new Recomputer({
    spawn,
    document,
    model,
    delayMs: 5,
    previewDelayMs: 5,
    ...(options.fonts && { fonts: options.fonts }),
    ...(options.files && { files: options.files }),
  });
  recomputer.start();
  return { document, model, requests, events, spawned: () => spawned };
}

function bind(service: KernelService) {
  return {
    init: () => service.init(),
    addFont: service.addFont.bind(service),
    recompute: service.recompute.bind(service),
    preview: service.preview.bind(service),
    endPreview: () => service.endPreview(),
    reference: service.reference.bind(service),
    tangentChain: service.tangentChain.bind(service),
    exportMeshes: service.exportMeshes.bind(service),
    exportStep: service.exportStep.bind(service),
    inspect: service.inspect.bind(service),
    debugTestPart: () => service.debugTestPart(),
    debugCrash: () => service.debugCrash(),
    stats: () => service.stats(),
    heap: () => service.heap(),
  };
}

/** Replaces the document through a command-free path, like undo does. */
function edit(document: DocumentStore, change: (doc: ExtrudoDocument) => ExtrudoDocument) {
  document.setState({ doc: change(document.getState().doc) });
}

const ready = (model: ModelStore<BodyMesh>) => model.getState().status === 'ready';

describe('Recomputer', () => {
  it('computes the document and fills the model store', { timeout: 30_000 }, async () => {
    const { model, document } = setup(chainDocument(3));
    expect(model.getState().status).toBe('idle');
    await until(() => ready(model));
    const state = model.getState();
    expect(Object.keys(state.bodies)).toEqual(['f1:0']);
    expect(state.bodies['f1:0' as never]?.positions.length).toBeGreaterThan(0);
    expect(state.features).toEqual({
      f1: { status: 'ok' },
      f2: { status: 'ok' },
      f3: { status: 'ok' },
    });
    expect(state.stats).toMatchObject({ evaluated: 3, reused: 0 });
    // The result says which document it is for (body names follow it, ADR-0030).
    expect(state.doc).toBe(document.getState().doc);
  });

  it('sends a burst of edits as one request, and keeps unchanged meshes', {
    timeout: 30_000,
  }, async () => {
    const doc = testDocument([
      testFeature('a', 'test-box', { size: '10 mm' }),
      testFeature('b', 'test-box', { size: '5 mm' }),
      testFeature('grow', 'test-grow', { height: '1 mm' }),
    ]);
    const { document, model, requests } = setup(doc);
    await until(() => ready(model));
    const before = model.getState().bodies;

    for (const h of ['2 mm', '3 mm', '4 mm'])
      edit(document, (d) => withExpr(d, 'grow', 'height', h));
    await until(() => ready(model) && requests.length === 2);
    await new Promise((r) => setTimeout(r, 30));
    expect(requests).toHaveLength(2);
    expect(requests[1]?.have).toEqual({
      'a:0': expect.any(String),
      'b:0': expect.any(String),
    });
    const after = model.getState().bodies;
    // b didn't change: the very same mesh object; a was rebuilt.
    expect(after['b:0' as never]).toBe(before['b:0' as never]);
    expect(after['a:0' as never]).not.toBe(before['a:0' as never]);
    expect(model.getState().stats).toMatchObject({ evaluated: 1, reused: 2 });
  });

  it('keeps the model records when a recompute changes nothing in them', {
    timeout: 30_000,
  }, async () => {
    const { document, model, requests } = setup(chainDocument(2));
    await until(() => ready(model));
    const { features, bodies } = model.getState();
    // A rename is a new document, but no new geometry or status.
    document.getState().dispatch(renameFeature({ id: 'f2' as FeatureId, name: 'Grow' }));
    await until(() => ready(model) && requests.length === 2);
    expect(model.getState().features).toBe(features);
    expect(model.getState().bodies).toBe(bodies);
  });

  it("doesn't send when something other than the document changes", {
    timeout: 30_000,
  }, async () => {
    const { document, model, requests } = setup(chainDocument(2));
    await until(() => ready(model));
    document.getState().beginTransaction('Sketch');
    await new Promise((r) => setTimeout(r, 30));
    expect(requests).toHaveLength(1);
  });

  it('shows the feature that crashed the kernel as an error until it changes', {
    timeout: 60_000,
  }, async () => {
    const doc = testDocument([
      testFeature('a', 'test-box', { size: '10 mm' }),
      testFeature('boom', 'test-crash'),
      testFeature('grow', 'test-grow', { height: '1 mm' }),
    ]);
    const { document, model, requests, spawned } = setup(doc);
    await until(() => ready(model));
    expect(spawned()).toBe(2);
    expect(requests.at(-1)?.crashed).toEqual(['boom']);
    expect(model.getState().features).toEqual({
      a: { status: 'ok' },
      boom: { status: 'error', message: expect.stringMatching(/^The kernel stopped/) },
      grow: { status: 'ok' },
    });
    expect(Object.keys(model.getState().bodies)).toEqual(['a:0']);

    // Renaming isn't a change the kernel sees, but it is a new feature object: tried again.
    document.getState().dispatch(renameFeature({ id: 'boom' as FeatureId, name: 'Boom' }));
    await until(() => spawned() === 3 && ready(model));
    expect(requests.at(-1)?.crashed).toEqual(['boom']);
  });

  it('sends a font once, before the recompute that needs it, and again after a restart', {
    timeout: 60_000,
  }, async () => {
    const doc = testDocument([
      testFeature('a', 'test-box', { size: '10 mm' }),
      testFeature('boom', 'test-crash'),
    ]);
    // Real font bytes: the kernel parses them (ADR-0058 §3: bytes never change under an ID).
    const binary = atob(interRegular.slice(interRegular.indexOf(',') + 1));
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0)).buffer as ArrayBuffer;
    const fonts: FontSource = {
      used: () => ['inter-regular@1', 'nobody-has@1'],
      bytes: async (id) => (id === 'nobody-has@1' ? undefined : bytes),
    };
    const { document, model, events, spawned } = setup(doc, { fonts });
    await until(() => ready(model) && spawned() >= 2);
    // Once per kernel, before its first recompute; a font no source knows is left out.
    expect(events.filter((e) => e.startsWith('font:'))).toEqual([
      `font:inter-regular@1:${bytes.byteLength}`,
      `font:inter-regular@1:${bytes.byteLength}`,
    ]);
    expect(events[0]?.startsWith('font:')).toBe(true);
    const firstRecompute = events.indexOf('recompute');
    expect(events.slice(0, firstRecompute)).toContain(`font:inter-regular@1:${bytes.byteLength}`);

    // A later edit doesn't send it again: the kernel has it.
    const before = events.length;
    edit(document, (d) => withExpr(d, 'a', 'size', '12 mm'));
    await until(() => events.length > before);
    expect(events.slice(before).filter((e) => e.startsWith('font:'))).toEqual([]);
  });

  it('sends a file once, before the recompute that needs it, and a preview its own', {
    timeout: 60_000,
  }, async () => {
    const bytes = Uint8Array.from([1, 2, 3]).buffer as ArrayBuffer;
    const attachment = (fileName: string) => ({
      name: fileName.replace(/\..*$/, ''),
      fileName,
      mediaType: 'model/step' as const,
      sha256: 'b'.repeat(64),
      size: bytes.byteLength,
    });
    const file = 'a1' as AttachmentId;
    // The design's own import, and one only the preview's draft names.
    const importer: Feature = { ...testFeature('imp', 'import'), inputs: importInputs({ file }) };
    const doc: ExtrudoDocument = {
      ...testDocument([testFeature('a', 'test-box', { size: '10 mm' }), importer]),
      attachments: { [file]: attachment('bracket.step') },
    };
    const files: FileSource = {
      bytes: async (id) => (id === ('a-nobody-has' as AttachmentId) ? undefined : bytes),
    };
    const { document, model, events } = setup(doc, { files });
    await until(() => ready(model));
    // Once, before the recompute that names it: the evaluator gets its bytes
    // (this test registry can't compute an import, but the file went out).
    expect(events.filter((e) => e.startsWith('file:'))).toEqual([
      `file:${file}:model/step:bracket.step:3`,
    ]);
    expect(events[0]).toBe(`file:${file}:model/step:bracket.step:3`);

    // An edit doesn't send it again.
    const before = events.length;
    edit(document, (d) => withExpr(d, 'a', 'size', '12 mm'));
    await until(() => events.length > before);
    expect(events.slice(before).filter((e) => e.startsWith('file:'))).toEqual([]);

    // A preview's draft isn't in the document yet, so its file goes first too.
    const other = 'a2' as AttachmentId;
    edit(document, (d) => ({
      ...d,
      attachments: { ...d.attachments, [other]: attachment('other.step') },
    }));
    const marked = events.length;
    await (recomputer as Recomputer).preview(
      { ...importer, id: 'draft' as FeatureId, inputs: importInputs({ file: other }) },
      2,
    );
    await until(() => events.slice(marked).some((e) => e.startsWith('preview:')));
    const slice = events.slice(marked);
    expect(slice).toContain(`file:${other}:model/step:other.step:3`);
    expect(slice.indexOf(`file:${other}:model/step:other.step:3`)).toBeLessThan(
      slice.indexOf('preview:draft'),
    );
  });

  it('asks for manifold-3d only for a document that imports a mesh', {
    timeout: 60_000,
  }, async () => {
    const bytes = Uint8Array.from([1, 2, 3]).buffer as ArrayBuffer;
    const file = 'm1' as AttachmentId;
    const importer: Feature = { ...testFeature('imp', 'import'), inputs: importInputs({ file }) };
    const attachment = (mediaType: 'model/step' | 'model/stl') => ({
      name: 'part',
      fileName: mediaType === 'model/step' ? 'part.step' : 'part.stl',
      mediaType,
      sha256: 'b'.repeat(64),
      size: bytes.byteLength,
    });
    const files: FileSource = { bytes: async () => bytes };

    // A STEP import needs no mesh kernel.
    const step: ExtrudoDocument = {
      ...testDocument([testFeature('a', 'test-box', { size: '10 mm' }), importer]),
      attachments: { [file]: attachment('model/step') },
    };
    const first = setup(step, { files });
    await until(() => ready(first.model));
    expect(first.events).not.toContain('meshes');

    // The same document with an STL does: once, before the recompute.
    const mesh: ExtrudoDocument = {
      ...step,
      attachments: { [file]: attachment('model/stl') },
    };
    const second = setup(mesh, { files });
    await until(() => ready(second.model));
    expect(second.events.filter((e) => e === 'meshes')).toEqual(['meshes']);
    const recompute = second.events.indexOf('recompute');
    expect(second.events.indexOf('meshes')).toBeLessThan(recompute);
    // Once per kernel: an edit doesn't ask again.
    const before = second.events.length;
    edit(second.document, (d) => withExpr(d, 'a', 'size', '12 mm'));
    await until(() => second.events.length > before);
    expect(second.events.slice(before)).not.toContain('meshes');
  });

  it('loads OpenSCAD once for a document that imports a .scad file (ADR-0071 §3)', {
    timeout: 60_000,
  }, async () => {
    const bytes = new TextEncoder().encode('cube(10);').buffer as ArrayBuffer;
    const file = 's1' as AttachmentId;
    const importer: Feature = { ...testFeature('imp', 'import'), inputs: importInputs({ file }) };
    const doc: ExtrudoDocument = {
      ...testDocument([testFeature('a', 'test-box', { size: '10 mm' }), importer]),
      attachments: {
        [file]: {
          name: 'part',
          fileName: 'part.scad',
          mediaType: 'application/x-openscad',
          sha256: 'c'.repeat(64),
          size: bytes.byteLength,
        },
      },
    };
    const { model, events, document } = setup(doc, { files: { bytes: async () => bytes } });
    await until(() => ready(model));
    // OpenSCAD (which brings manifold-3d with it), after the file, before the recompute.
    expect(events.filter((e) => e === 'openscad')).toEqual(['openscad']);
    expect(events).not.toContain('meshes');
    expect(events.indexOf(`file:${file}:application/x-openscad:part.scad:9`)).toBeLessThan(
      events.indexOf('openscad'),
    );
    expect(events.indexOf('openscad')).toBeLessThan(events.indexOf('recompute'));
    const before = events.length;
    edit(document, (d) => withExpr(d, 'a', 'size', '12 mm'));
    await until(() => events.length > before);
    expect(events.slice(before)).not.toContain('openscad');

    // The Import dialog's rows: the kernel lists the file's variables.
    const listed = await recomputer?.scadParameters(file);
    expect(listed).toEqual({
      ok: true,
      parameters: [{ name: 'width', type: 'number', initial: 40 }],
    });
    expect(events.at(-1)).toBe(`scad-parameters:${file}`);
  });

  it('sends a just-picked .scad file before listing its variables', {
    timeout: 30_000,
  }, async () => {
    const bytes = new TextEncoder().encode('width = 4;').buffer as ArrayBuffer;
    const file = 'picked' as AttachmentId;
    const { model, events } = setup(
      testDocument([testFeature('a', 'test-box', { size: '10 mm' })]),
      {
        files: {
          bytes: async () => bytes,
          mediaType: (id) => (id === file ? 'application/x-openscad' : undefined),
          fileName: (id) => (id === file ? 'gear.scad' : undefined),
        },
      },
    );
    await until(() => ready(model));
    expect(events).not.toContain('openscad');
    await recomputer?.scadParameters(file);
    const slice = events.filter((e) => e !== 'recompute');
    expect(slice).toEqual([
      `file:${file}:application/x-openscad:gear.scad:10`,
      'openscad',
      `scad-parameters:${file}`,
    ]);
  });

  it("collects the canvases' frames, and never sends an image to the worker", {
    timeout: 30_000,
  }, async () => {
    const image = AttachmentIdSchema.parse('a-1');
    const doc: ExtrudoDocument = {
      ...testDocument([
        testFeature(
          'plane',
          'offsetPlane',
          { distance: '15 mm' },
          {
            plane: { kind: 'ref', refs: [originPlaneRef('origin:xy')] },
          },
        ),
        {
          ...testFeature('canvas', 'canvas'),
          inputs: canvasInputs({ image, plane: { kind: 'plane', id: 'plane' } }),
        },
      ]),
      attachments: {
        [image]: {
          name: 'plan',
          fileName: 'plan.png',
          mediaType: 'image/png',
          sha256: 'a'.repeat(64),
          size: 10,
        },
      },
    };
    const { document, model, events, requests } = setup(doc);
    await until(() => ready(model));
    // The report is the plane's frame, in the model store's own `canvases`.
    expect(model.getState().canvases).toEqual({
      canvas: {
        kind: 'canvas',
        frame: expect.objectContaining({ origin: [0, 0, 15], normal: [0, 0, 1] }),
      },
    });
    // A canvas makes no body, and its image is the view's business (ADR-0066 §5).
    expect(model.getState().bodies).toEqual({});
    expect(events.filter((e) => e.startsWith('file:'))).toEqual([]);

    // Unchanged reports keep their object, so the view doesn't redraw the image.
    const { canvases } = model.getState();
    document.getState().dispatch(renameFeature({ id: 'plane' as FeatureId, name: 'Above' }));
    await until(() => ready(model) && requests.length === 2);
    expect(model.getState().canvases).toBe(canvases);

    // A dialog's preview of a canvas carries its own frame (ADR-0066 §5).
    const r = recomputer as Recomputer;
    const preview = await r.preview(
      {
        ...testFeature('canvas2', 'canvas'),
        inputs: canvasInputs({ image }),
      },
      2,
    );
    expect(preview?.canvas?.frame.origin).toEqual([0, 0, 0]);
    expect(preview?.construction).toBeUndefined();
  });

  it('previews a draft after it settles; a newer draft supersedes the older', {
    timeout: 30_000,
  }, async () => {
    const { model } = setup(chainDocument(2));
    await until(() => ready(model));
    const r = recomputer as Recomputer;
    const older = r.preview(testFeature('f3', 'test-hole', { radius: '1 mm' }), 2);
    const newer = r.preview(testFeature('f3', 'test-hole', { radius: '2 mm' }), 2);
    expect(await older).toBeUndefined();
    const preview = await newer;
    expect(preview?.features['f3' as FeatureId]).toEqual({ status: 'ok' });
    expect(Object.keys(preview?.bodies ?? {})).toEqual(['f1:0']);

    const ended = r.preview(testFeature('f3', 'test-hole', { radius: '3 mm' }), 2);
    r.endPreview();
    expect(await ended).toBeUndefined();
  });

  it("hands over a draft's preview tools, and references with fingerprints", {
    timeout: 30_000,
  }, async () => {
    const { model } = setup(testDocument([testFeature('box', 'test-box', { size: '10 mm' })]));
    await until(() => ready(model));
    const r = recomputer as Recomputer;
    const refs = await Promise.all(
      [0, 1, 2, 3, 4, 5].map((i) => r.reference('box:0' as BodyId, 'face', i)),
    );
    const top = refs.find((ref) => ref?.fingerprint?.dir?.[2] === 1);
    expect(top?.kind).toBe('face');
    expect(await r.reference('nothing' as BodyId, 'face', 0)).toBeUndefined();

    const draft = testFeature(
      'press',
      'test-press',
      { distance: '-3 mm' },
      { faces: { kind: 'ref', refs: [top as GeomRef] }, operation: { kind: 'enum', value: 'cut' } },
    );
    const preview = await r.preview(draft, 1);
    expect(preview?.features['press' as FeatureId]).toEqual({ status: 'ok' });
    expect(preview?.tools.map((t) => t.style)).toEqual(['cut']);
    // The cut changed the box: a new mesh, not the model store's.
    expect(preview?.bodies['box:0' as BodyId]).not.toBe(model.getState().bodies['box:0' as BodyId]);
  });
});
