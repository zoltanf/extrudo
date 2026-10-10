// The Recomputer's heap recycling (P4-12 H4, ADR-0067 §H4): a worker whose
// heap top has passed the limit is thrown away between recomputes and replaced,
// and the model store carries on showing the result it has. A fake kernel makes
// the heap and the calls visible; the real one (with a limit of a few MB, which
// any recompute passes) is in the last test.
import {
  type AttachmentId,
  createDocumentStore,
  createModelStore,
  type ExtrudoDocument,
  type Feature,
  type FeatureId,
  importInputs,
  type ModelStore,
  renameFeature,
} from '@extrudo/core';
import { afterEach, describe, expect, it } from 'vitest';
import interRegular from '../fonts/fonts/inter-regular.ttf?url&inline';
import type { KernelConnection } from './client';
import type { BodyMesh } from './mesh';
import { loadOcct } from './occt/load';
import { chainDocument, testDocument, testFeature, testFeatures } from './recompute/testing';
import type { RecomputeRequest } from './recompute/types';
import { type FileSource, type FontSource, Recomputer } from './recomputer';
import type { KernelApi } from './service';
import { KernelService } from './service';

const until = async (condition: () => boolean, ms = 30_000) => {
  const end = Date.now() + ms;
  while (!condition()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
};

let recomputer: Recomputer | undefined;
afterEach(() => recomputer?.dispose());

/** The bytes of a `data:` URL (Vite's `?url&inline` import of a binary file). */
function bytesOf(dataUrl: string): ArrayBuffer {
  const binary = atob(dataUrl.slice(dataUrl.indexOf(',') + 1));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0)).buffer as ArrayBuffer;
}

interface FakeOptions {
  /** Heap top each kernel reports, by which kernel of the session. */
  heap: (worker: number) => number;
}

/** A kernel that answers nothing but what the Recomputer asks, and says so. */
function fakeSpawn(options: FakeOptions) {
  const events: string[] = [];
  let spawned = 0;
  let requests = 0;
  const spawn = (): KernelConnection => {
    const worker = ++spawned;
    events.push(`spawn:${worker}`);
    const api = {
      init: async () => ({ initMs: 0, heapBytes: 16 }),
      addFont: async (id: string) => {
        events.push(`font:${id}`);
      },
      addFile: async (id: string) => {
        events.push(`file:${id}`);
      },
      enableMeshes: async () => {
        events.push(`meshes:${worker}`);
      },
      enableScripts: async () => {
        events.push(`scripts:${worker}`);
      },
      enableOpenscad: async () => {
        events.push(`openscad:${worker}`);
      },
      scadParameters: async () => ({ ok: true, parameters: [] }),
      runPluginCommand: async () => ({ ok: true, features: [], log: [] }),
      recompute: async (_request: RecomputeRequest) => {
        requests++;
        events.push(`recompute:${worker}`);
        return {
          status: 'done',
          features: { f1: { status: 'ok' } },
          bodies: [],
          reports: {},
          origins: {},
          stats: { evaluated: ['f1'], reused: 0, ms: 1, liveShapes: 0 },
        };
      },
      preview: async () => {
        events.push(`preview:${worker}`);
        return {
          status: 'done',
          features: { f1: { status: 'ok' } },
          bodies: [],
          reports: {},
          origins: {},
          stats: { evaluated: [], reused: 0, ms: 1, liveShapes: 0 },
        };
      },
      endPreview: async () => {
        events.push('endPreview');
      },
      heap: async () => {
        events.push(`heap:${worker}:${options.heap(worker)}`);
        return { top: options.heap(worker), size: 16 };
      },
      stats: async () => ({ liveShapes: 0, heapTop: options.heap(worker), heapBytes: 16 }),
      reference: async () => undefined,
      tangentChain: async () => undefined,
      exportMeshes: async () => [],
      exportStep: async () => '',
      inspect: async () => ({ items: [] }),
      debugTestPart: () => new Promise(() => {}),
      debugCrash: async () => {},
    } as unknown as KernelApi;
    return {
      api,
      terminate: () => {
        events.push(`terminate:${worker}`);
      },
      onFatal: () => {},
    };
  };
  return { spawn, events, spawned: () => spawned, requests: () => requests };
}

function setup(
  doc: ExtrudoDocument,
  options: {
    heapRecycleBytes: number;
    heap: (worker: number) => number;
    fonts?: FontSource;
    files?: FileSource;
  },
) {
  const fake = fakeSpawn({ heap: options.heap });
  const document = createDocumentStore(doc);
  const model = createModelStore<BodyMesh>();
  const recycled: number[] = [];
  recomputer = new Recomputer({
    spawn: fake.spawn,
    document,
    model,
    delayMs: 5,
    previewDelayMs: 5,
    heapRecycleBytes: options.heapRecycleBytes,
    ...(options.fonts && { fonts: options.fonts }),
    ...(options.files && { files: options.files }),
    onRecycle: () => recycled.push(fake.spawned()),
  });
  recomputer.start();
  return { document, model, ...fake, recycled };
}

const ready = (model: ModelStore<BodyMesh>) => model.getState().status === 'ready';

describe('Recomputer heap recycling', () => {
  it('replaces the worker once, after the recompute, when the heap is over the limit', async () => {
    // The first worker is over the limit, the second is not.
    const { model, events, spawned, recycled } = setup(chainDocument(2), {
      heapRecycleBytes: 1024,
      heap: (worker) => (worker === 1 ? 4096 : 512),
    });
    await until(() => events.filter((e) => e === 'recompute:2').length === 1);
    // The heap was asked after the first recompute, and the worker was replaced
    // between recomputes: terminate, spawn, then the cold recompute.
    expect(events.slice(0, 7)).toEqual([
      'spawn:1',
      'recompute:1',
      'heap:1:4096',
      'terminate:1',
      'spawn:2',
      'recompute:2',
      'heap:2:512',
    ]);
    expect(recycled).toEqual([2]);
    // One restart: the fresh kernel's heap is small, so nothing more happens.
    await new Promise((r) => setTimeout(r, 50));
    expect(spawned()).toBe(2);
    expect(events.filter((e) => e.startsWith('terminate'))).toHaveLength(1);
    expect(model.getState().status).toBe('ready');
  });

  it('leaves the worker alone under the limit', async () => {
    const { model, events, spawned, recycled } = setup(chainDocument(2), {
      heapRecycleBytes: 1024 * 1024,
      heap: () => 512,
    });
    await until(() => ready(model));
    await new Promise((r) => setTimeout(r, 50));
    expect(spawned()).toBe(1);
    expect(recycled).toEqual([]);
    expect(events).not.toContain('terminate:1');
  });

  it('never recycles when the limit is 0', async () => {
    const { model, spawned } = setup(chainDocument(2), {
      heapRecycleBytes: 0,
      heap: () => 1024 * 1024 * 1024 * 4,
    });
    await until(() => ready(model));
    await new Promise((r) => setTimeout(r, 50));
    expect(spawned()).toBe(1);
  });

  it('recycles once while the heap stays over the limit, never in a loop', async () => {
    // Every worker, fresh ones included, is over the limit: only one restart.
    const { model, events, spawned } = setup(chainDocument(2), {
      heapRecycleBytes: 1024,
      heap: () => 4096,
    });
    await until(() => ready(model) && spawned() === 2);
    await new Promise((r) => setTimeout(r, 50));
    expect(events.filter((e) => e.startsWith('terminate'))).toEqual(['terminate:1']);
    expect(spawned()).toBe(2);
  });

  it('waits for the dialog to close: no recycle while a draft is open', async () => {
    let top = 512; // under the limit to begin with
    const { model, document, events, spawned } = setup(chainDocument(2), {
      heapRecycleBytes: 1024,
      heap: () => top,
    });
    await until(() => ready(model));
    const r = recomputer as Recomputer;
    // The heap grows while a dialog is open: its draft keeps the worker.
    top = 4096;
    await r.preview(testFeature('f3', 'test-hole', { radius: '1 mm' }), 2);
    document.getState().dispatch(renameFeature({ id: 'f2' as FeatureId, name: 'Grow' }));
    await until(() => events.filter((e) => e === 'recompute:1').length === 2);
    await new Promise((delay) => setTimeout(delay, 50));
    expect(events).not.toContain('terminate:1');
    expect(spawned()).toBe(1);
    // The dialog closes, and the next recompute recycles.
    r.endPreview();
    document.getState().dispatch(renameFeature({ id: 'f1' as FeatureId, name: 'Base' }));
    await until(() => spawned() === 2 && ready(model));
    expect(events).toContain('terminate:1');
  });

  it('sends the fonts to the new worker again, and keeps the model store filled', async () => {
    const fonts: FontSource = {
      used: () => ['inter-regular@1'],
      bytes: async () => bytesOf(interRegular),
    };
    const { model, events } = setup(
      testDocument([testFeature('a', 'test-box', { size: '10 mm' })]),
      { heapRecycleBytes: 1024, heap: (worker) => (worker === 1 ? 4096 : 512), fonts },
    );
    await until(() => ready(model) && events.filter((e) => e === 'recompute:2').length === 1);
    // One font per worker, each before that worker's recompute.
    expect(events.filter((e) => e.startsWith('font:'))).toEqual([
      'font:inter-regular@1',
      'font:inter-regular@1',
    ]);
    expect(events.indexOf('font:inter-regular@1')).toBeLessThan(events.indexOf('recompute:1'));
    expect(events.lastIndexOf('font:inter-regular@1')).toBeLessThan(events.indexOf('recompute:2'));
    // The store was ready the whole time: the recycle never emptied it.
    expect(model.getState().status).toBe('ready');
  });

  it('sends a mesh file and loads manifold-3d again on the new worker', async () => {
    // A document that imports a mesh file: the worker needs the file's bytes
    // and manifold-3d, and a replacement needs both again (P4-06 §0/§3 through
    // the restart path P4-12 H4 takes).
    const file = 'a1' as AttachmentId;
    const files: FileSource = {
      bytes: async () => new ArrayBuffer(8),
      mediaType: () => 'model/stl',
    };
    const { model, events } = setup(
      {
        ...testDocument([{ ...testFeature('Import1', 'import'), inputs: importInputs({ file }) }]),
        attachments: {
          [file]: {
            name: 'cube',
            fileName: 'cube.stl',
            mediaType: 'model/stl',
            sha256: 'c'.repeat(64),
            size: 8,
          },
        },
      },
      { heapRecycleBytes: 1024, heap: (worker) => (worker === 1 ? 4096 : 512), files },
    );
    await until(() => ready(model) && events.filter((e) => e === 'recompute:2').length === 1);
    // The file and manifold-3d went to each worker, each before its recompute.
    expect(events.filter((e) => e.startsWith('file:'))).toEqual(['file:a1', 'file:a1']);
    expect(events.filter((e) => e.startsWith('meshes:'))).toEqual(['meshes:1', 'meshes:2']);
    expect(events.indexOf('file:a1')).toBeLessThan(events.indexOf('recompute:1'));
    expect(events.lastIndexOf('file:a1')).toBeLessThan(events.indexOf('recompute:2'));
    // manifold-3d is loaded before the first recompute that needs it.
    expect(events.indexOf('meshes:1')).toBeLessThan(events.indexOf('recompute:1'));
    expect(events.lastIndexOf('meshes:2')).toBeLessThan(events.indexOf('recompute:2'));
    expect(model.getState().status).toBe('ready');
  });

  it('loads the script runner again on the new worker (P5-02)', async () => {
    // A design with a script: the runner is a WASM of its own in the worker
    // (ADR-0070 §2), so a replacement needs it again, before its recompute.
    const script: Feature = {
      ...testFeature('Script1', 'script'),
      inputs: { code: { kind: 'code', value: 'design.box({});' } },
    };
    const { model, events } = setup(testDocument([script]), {
      heapRecycleBytes: 1024,
      heap: (worker) => (worker === 1 ? 4096 : 512),
    });
    await until(() => ready(model) && events.filter((e) => e === 'recompute:2').length === 1);
    expect(events.filter((e) => e.startsWith('scripts:'))).toEqual(['scripts:1', 'scripts:2']);
    expect(events.indexOf('scripts:1')).toBeLessThan(events.indexOf('recompute:1'));
    expect(events.lastIndexOf('scripts:2')).toBeLessThan(events.indexOf('recompute:2'));
  });

  it('loads OpenSCAD again on the new worker for a .scad import (ADR-0071 §3)', async () => {
    const file = 's1' as AttachmentId;
    const files: FileSource = {
      bytes: async () => new ArrayBuffer(9),
      mediaType: () => 'application/x-openscad',
    };
    const { model, events } = setup(
      {
        ...testDocument([{ ...testFeature('Import1', 'import'), inputs: importInputs({ file }) }]),
        attachments: {
          [file]: {
            name: 'gear',
            fileName: 'gear.scad',
            mediaType: 'application/x-openscad',
            sha256: 'd'.repeat(64),
            size: 9,
          },
        },
      },
      { heapRecycleBytes: 1024, heap: (worker) => (worker === 1 ? 4096 : 512), files },
    );
    await until(() => ready(model) && events.filter((e) => e === 'recompute:2').length === 1);
    expect(events.filter((e) => e.startsWith('file:'))).toEqual(['file:s1', 'file:s1']);
    expect(events.filter((e) => e.startsWith('openscad:'))).toEqual(['openscad:1', 'openscad:2']);
    // OpenSCAD brings manifold-3d with it: no separate call.
    expect(events.filter((e) => e.startsWith('meshes:'))).toEqual([]);
    expect(events.indexOf('openscad:1')).toBeLessThan(events.indexOf('recompute:1'));
    expect(events.lastIndexOf('openscad:2')).toBeLessThan(events.indexOf('recompute:2'));
  });

  it('resends a script’s model attachments and both loaders on a recycled worker', async () => {
    const file = 'script-scad' as AttachmentId;
    const script: Feature = {
      ...testFeature('Script1', 'script'),
      inputs: {
        code: { kind: 'code', value: `design.import({ file: '${file}' });` },
      },
    };
    const { model, events } = setup(
      {
        ...testDocument([script]),
        attachments: {
          [file]: {
            name: 'Block',
            fileName: 'block.scad',
            mediaType: 'application/x-openscad',
            sha256: 'e'.repeat(64),
            size: 9,
          },
        },
      },
      {
        heapRecycleBytes: 1024,
        heap: (worker) => (worker === 1 ? 4096 : 512),
        files: { bytes: async () => new ArrayBuffer(9) },
      },
    );
    await until(() => ready(model) && events.filter((e) => e === 'recompute:2').length === 1);
    expect(events.filter((e) => e.startsWith('file:'))).toEqual([`file:${file}`, `file:${file}`]);
    for (const kind of ['scripts', 'openscad']) {
      expect(events.filter((e) => e.startsWith(`${kind}:`))).toEqual([`${kind}:1`, `${kind}:2`]);
      expect(events.indexOf(`${kind}:1`)).toBeLessThan(events.indexOf('recompute:1'));
      expect(events.indexOf(`${kind}:2`)).toBeLessThan(events.indexOf('recompute:2'));
    }
  });

  it("sends a plugin feature's plugin file and the runner to each worker (ADR-0077 §4)", async () => {
    const file = 'name-plate' as AttachmentId;
    const plugin: Feature = {
      ...testFeature('Name plate1', 'plugin'),
      inputs: {
        plugin: { kind: 'file', id: file },
        handler: { kind: 'enum', value: 'name-plate' },
      },
    };
    const { model, events } = setup(
      {
        ...testDocument([plugin]),
        attachments: {
          [file]: {
            name: 'Name plate 1.0.0',
            fileName: 'name-plate.extrudo-plugin',
            mediaType: 'application/x-extrudo-plugin',
            sha256: 'f'.repeat(64),
            size: 9,
          },
        },
      },
      {
        heapRecycleBytes: 1024,
        heap: (worker) => (worker === 1 ? 4096 : 512),
        files: { bytes: async () => new ArrayBuffer(9) },
      },
    );
    await until(() => ready(model) && events.filter((e) => e === 'recompute:2').length === 1);
    expect(events.filter((e) => e.startsWith('file:'))).toEqual([`file:${file}`, `file:${file}`]);
    expect(events.filter((e) => e.startsWith('scripts:'))).toEqual(['scripts:1', 'scripts:2']);
    expect(events.indexOf(`file:${file}`)).toBeLessThan(events.indexOf('recompute:1'));
    expect(events.indexOf('scripts:2')).toBeLessThan(events.indexOf('recompute:2'));
    // A plugin file is no mesh: manifold-3d stays out.
    expect(events.filter((e) => e.startsWith('meshes:'))).toEqual([]);
  });

  it('recycles a real kernel whose heap passes a few MB, with the same result', {
    timeout: 120_000,
  }, async () => {
    const doc = chainDocument(3);
    const document = createDocumentStore(doc);
    const model = createModelStore<BodyMesh>();
    let spawned = 0;
    let recycled = 0;
    /** Node counts of the first body the model store had at each recycle. */
    const before: number[] = [];
    const spawn = (): KernelConnection => {
      spawned++;
      const service = new KernelService(() => loadOcct(), { features: testFeatures().registry });
      const api = {
        ...bind(service),
        // A few MB is under any real heap, so every recompute crosses it.
        heap: () => service.heap(),
      } as unknown as KernelApi;
      return { api, terminate: () => {}, onFatal: () => {} };
    };
    recomputer = new Recomputer({
      spawn,
      document,
      model,
      delayMs: 5,
      previewDelayMs: 5,
      heapRecycleBytes: 3 * 1024 * 1024,
      onRecycle: () => {
        recycled++;
        // The store still has the result of the worker that is going away.
        before.push(Object.values(model.getState().bodies)[0]?.positions.length ?? 0);
      },
    });
    recomputer.start();
    await until(() => ready(model) && recycled >= 1 && ready(model));
    // The new worker recomputed cold and came to the same body.
    await until(() => Object.keys(model.getState().bodies).length > 0);
    expect(Object.keys(model.getState().bodies)).toEqual(['f1:0']);
    expect(before[0]).toBeGreaterThan(0);
    expect(model.getState().bodies['f1:0' as never]?.positions.length).toBe(before[0]);
    // One restart for the over-the-limit kernel, and no loop: its heap is
    // over the limit from the start, which only counts as a growth once.
    expect(spawned).toBe(2);
    // The next edit recomputes on the new worker.
    document.getState().dispatch(renameFeature({ id: 'f2' as FeatureId, name: 'Grow' }));
    await until(() => ready(model));
    expect(spawned).toBe(2);
  });
});

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
    stats: () => service.stats(),
    heap: () => service.heap(),
    debugTestPart: () => service.debugTestPart(),
    debugCrash: () => service.debugCrash(),
  };
}
