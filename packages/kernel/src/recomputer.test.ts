// The Recomputer against an in-process kernel with the test features. The
// worker path (Comlink, transfers) is covered by e2e/recompute.spec.ts.
import {
  type BodyId,
  createDocumentStore,
  createModelStore,
  type DocumentStore,
  type ExtrudoDocument,
  type FeatureId,
  type GeomRef,
  type ModelStore,
  renameFeature,
} from '@extrudo/core';
import { afterEach, describe, expect, it } from 'vitest';
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
import { Recomputer } from './recomputer';
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

function setup(doc: ExtrudoDocument) {
  const requests: RecomputeRequest[] = [];
  let spawned = 0;
  const spawn = (): KernelConnection => {
    spawned++;
    const service = new KernelService(() => loadOcct(), { features: testFeatures().registry });
    return {
      api: {
        ...bind(service),
        recompute: (request, onFeature) => {
          requests.push(request);
          return service.recompute(request, onFeature);
        },
      },
      terminate: () => {},
      onFatal: () => {},
    };
  };
  const document = createDocumentStore(doc);
  const model = createModelStore<BodyMesh>();
  recomputer = new Recomputer({ spawn, document, model, delayMs: 5, previewDelayMs: 5 });
  recomputer.start();
  return { document, model, requests, spawned: () => spawned };
}

function bind(service: KernelService) {
  return {
    init: () => service.init(),
    recompute: service.recompute.bind(service),
    preview: service.preview.bind(service),
    endPreview: () => service.endPreview(),
    reference: service.reference.bind(service),
    debugTestPart: () => service.debugTestPart(),
    debugCrash: () => service.debugCrash(),
    stats: () => service.stats(),
  };
}

/** Replaces the document through a command-free path, like undo does. */
function edit(document: DocumentStore, change: (doc: ExtrudoDocument) => ExtrudoDocument) {
  document.setState({ doc: change(document.getState().doc) });
}

const ready = (model: ModelStore<BodyMesh>) => model.getState().status === 'ready';

describe('Recomputer', () => {
  it('computes the document and fills the model store', { timeout: 30_000 }, async () => {
    const { model } = setup(chainDocument(3));
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
