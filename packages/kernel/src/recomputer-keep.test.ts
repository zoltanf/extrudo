// Unchanged bodies keep their mesh objects after a recompute (ADR-0024's amendment of
// 2026-11-24): the Recomputer hands out the mesh it holds for a body when the kernel sends one
// the same in every field. Against an in-process kernel (OCCT), and against a stand-in kernel
// whose meshes the test makes. Waits follow the model store; no test reads the clock.
import {
  type BodyId,
  createDocumentStore,
  createModelStore,
  type ExtrudoDocument,
  extrudeInputs,
  type Feature,
  type FeatureId,
  type GeomRef,
  type ModelStore,
  originPlaneRef,
  type SketchData,
  sketchInputs,
} from '@extrudo/core';
import { SketchBuilder } from '@extrudo/sketch/fixtures';
import { detectProfiles } from '@extrudo/sketch/profiles';
import { afterEach, describe, expect, it } from 'vitest';
import type { KernelConnection } from './client';
import { type BodyMesh, sameMesh } from './mesh';
import { loadOcct } from './occt/load';
import { testDocument, testFeature, testFeatures } from './recompute/testing';
import type { BodyResult, RecomputeRequest, RecomputeResult } from './recompute/types';
import { Recomputer } from './recomputer';
import { type KernelApi, KernelService } from './service';

let recomputer: Recomputer | undefined;
afterEach(() => recomputer?.dispose());

/** A seeded generator (mulberry32): the same edits on every run. */
function random(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Resolves once the model is ready after at least `n` recomputes were sent. */
function settled(model: ModelStore<BodyMesh>, sent: () => number, n: number) {
  return new Promise<void>((resolve) => {
    const check = () => {
      if (model.getState().status === 'ready' && sent() >= n) {
        stop();
        resolve();
      }
    };
    const stop = model.subscribe(check);
    check();
  });
}

function start(doc: ExtrudoDocument, api: () => Partial<KernelApi>) {
  const document = createDocumentStore(doc);
  const model = createModelStore<BodyMesh>();
  const spawn = (): KernelConnection => ({
    // Whatever the Recomputer asks besides what the test gives answers nothing.
    api: new Proxy(api(), {
      get: (target, key) =>
        (target as Record<string | symbol, unknown>)[key] ?? (async () => undefined),
    }) as KernelApi,
    terminate: () => {},
    onFatal: () => {},
  });
  recomputer = new Recomputer({ spawn, document, model, delayMs: 5, previewDelayMs: 5 });
  recomputer.start();
  return { document, model };
}

function rectangle(x: number, w: number): SketchData {
  const b = new SketchBuilder();
  b.line(x, 0, x + w, 0);
  b.line(x + w, 0, x + w, 10);
  b.line(x + w, 10, x, 10);
  b.line(x, 10, x, 0);
  return b.sketch;
}

/** `n` plates side by side, each a sketch and an extrude making its own body. */
function plates(n: number): ExtrudoDocument {
  const features: Feature[] = [];
  for (let i = 0; i < n; i++) {
    const data = rectangle(i * 30, 20);
    const [region] = detectProfiles(data);
    const ref: GeomRef = { kind: 'profile', id: `sk${i}/${region?.id}` };
    features.push({
      ...testFeature(`sk${i}`, 'sketch'),
      inputs: sketchInputs(originPlaneRef('origin:xy'), data),
    });
    features.push({
      ...testFeature(`ex${i}`, 'extrude'),
      inputs: extrudeInputs([ref], { distance: `${2 + i} mm` }),
    });
  }
  return testDocument(features);
}

const distance = (doc: ExtrudoDocument, id: string, mm: number): ExtrudoDocument => ({
  ...doc,
  features: doc.features.map((f) =>
    f.id === id
      ? {
          ...f,
          inputs: { ...f.inputs, distance: { kind: 'expr', expr: `${mm} mm`, unit: 'length' } },
        }
      : f,
  ),
});

/** The real kernel, counting what it sends. */
function realKernel() {
  const sent = { recomputes: 0, meshes: 0 };
  const api = () => {
    const service = new KernelService(() => loadOcct(), { features: testFeatures().registry });
    return {
      init: () => service.init(),
      endPreview: () => service.endPreview(),
      preview: service.preview.bind(service),
      recompute: async (request: RecomputeRequest, onFeature?: (id?: FeatureId) => void) => {
        sent.recomputes++;
        const result = await service.recompute(request, onFeature);
        if (result.status === 'done') sent.meshes += result.bodies.filter((b) => b.mesh).length;
        return result;
      },
    } as Partial<KernelApi>;
  };
  return { api, sent };
}

/** Every body's mesh from a kernel that holds nothing: what a full rebuild gives. */
async function rebuilt(doc: ExtrudoDocument): Promise<Record<string, BodyMesh>> {
  const service = new KernelService(() => loadOcct(), { features: testFeatures().registry });
  await service.init();
  const result = await service.recompute({ doc });
  if (result.status !== 'done') throw new Error('cancelled');
  return Object.fromEntries(result.bodies.map((b) => [b.id, b.mesh as BodyMesh]));
}

describe('unchanged bodies keep their mesh objects (ADR-0024, 2026-11-24)', () => {
  it('an edit of the first of six plates: the kernel sends all six, one gets a new object', {
    timeout: 60_000,
  }, async () => {
    const kernel = realKernel();
    const { document, model } = start(plates(6), kernel.api);
    await settled(model, () => kernel.sent.recomputes, 1);
    const before = model.getState().bodies;
    expect(Object.keys(before)).toHaveLength(6);
    kernel.sent.meshes = 0;
    document.setState({ doc: distance(document.getState().doc, 'ex0', 9) });
    await settled(model, () => kernel.sent.recomputes, 2);
    const after = model.getState().bodies;
    // Every later extrude's cache key takes in the first one's: all six come again.
    expect(kernel.sent.meshes).toBe(6);
    const kept = Object.keys(after).filter((id) => after[id as BodyId] === before[id as BodyId]);
    expect(kept).toEqual(['ex1:0', 'ex2:0', 'ex3:0', 'ex4:0', 'ex5:0']);
    // The same arrays a full rebuild gives.
    const full = await rebuilt(document.getState().doc);
    for (const [id, mesh] of Object.entries(after))
      expect(sameMesh(mesh, full[id] as BodyMesh)).toBe(true);
  });

  it('a seeded run of edits: a body keeps its object exactly when its mesh is the same', {
    timeout: 240_000,
  }, async () => {
    const rand = random(2411);
    const kernel = realKernel();
    const first = plates(5);
    const { document, model } = start(first, kernel.api);
    await settled(model, () => kernel.sent.recomputes, 1);
    const history: ExtrudoDocument[] = [first];
    let undone: ExtrudoDocument[] = [];
    const counts: Record<string, number> = {};
    const kinds: [string, (doc: ExtrudoDocument) => ExtrudoDocument | undefined][] = [
      ['distance', (d) => distance(d, `ex${Math.floor(rand() * 5)}`, 1 + Math.floor(rand() * 6))],
      [
        'suppress',
        (d) => {
          const i = Math.floor(rand() * d.features.length);
          return {
            ...d,
            features: d.features.map((f, k) => (k === i ? { ...f, suppressed: !f.suppressed } : f)),
          };
        },
      ],
      [
        'reorder',
        // Two plates' extrudes swap places (each after its own sketch still).
        (d) => {
          const ids = d.features.map((f) => f.id);
          const a = ids.indexOf('ex1' as FeatureId);
          const b = ids.indexOf('ex3' as FeatureId);
          const features = [...d.features];
          [features[a], features[b]] = [features[b] as Feature, features[a] as Feature];
          return { ...d, features };
        },
      ],
      ['marker', (d) => ({ ...d, timelineMarker: Math.floor(rand() * (d.features.length + 1)) })],
      [
        'rename',
        (d) => ({
          ...d,
          features: d.features.map((f) =>
            f.id === 'ex2' ? { ...f, name: `Plate ${Math.floor(rand() * 99)}` } : f,
          ),
        }),
      ],
      [
        'colour',
        (d) => ({
          ...d,
          bodies: {
            ...d.bodies,
            ['ex0:0' as BodyId]: { name: 'P', visible: rand() < 0.5, color: '#ff0000' },
          },
        }),
      ],
      [
        'hole',
        // A hole through the first body: its faces and their names change.
        (d) =>
          d.features.some((f) => f.id === 'hole')
            ? { ...d, features: d.features.filter((f) => f.id !== 'hole') }
            : {
                ...d,
                features: [...d.features, testFeature('hole', 'test-hole', { radius: '2 mm' })],
                timelineMarker: d.features.length + 1,
              },
      ],
      [
        'combine',
        // The first two bodies fused: one goes, one changes.
        (d) =>
          d.features.some((f) => f.id === 'join')
            ? { ...d, features: d.features.filter((f) => f.id !== 'join') }
            : {
                ...d,
                features: [...d.features, testFeature('join', 'test-combine', {})],
                timelineMarker: d.features.length + 1,
              },
      ],
      [
        'undo',
        () => {
          if (history.length < 2) return undefined;
          undone.push(history.pop() as ExtrudoDocument);
          return history.at(-1);
        },
      ],
      ['redo', () => undone.pop()],
    ];
    // Each kind once (undo and redo last), then 30 picked at random.
    const order = [...kinds.slice(0, -2), ...kinds.slice(-2)];
    for (let step = 0; step < order.length + 30; step++) {
      const [kind, make] = (order[step] ??
        kinds[Math.floor(rand() * kinds.length)]) as (typeof kinds)[number];
      const doc = document.getState().doc;
      const next = make(doc);
      if (!next || next === doc) continue;
      if (kind !== 'undo' && kind !== 'redo') {
        history.push(next);
        undone = [];
      } else if (kind === 'redo') history.push(next);
      counts[kind] = (counts[kind] ?? 0) + 1;
      const before = model.getState().bodies;
      const sent = kernel.sent.recomputes;
      document.setState({ doc: next });
      await settled(model, () => kernel.sent.recomputes, sent + 1);
      const after = model.getState().bodies;
      const full = await rebuilt(next);
      expect(Object.keys(after).sort()).toEqual(Object.keys(full).sort());
      for (const [id, mesh] of Object.entries(after)) {
        const ref = full[id] as BodyMesh;
        expect(sameMesh(mesh, ref)).toBe(true);
        const old = before[id as BodyId];
        // Kept exactly when it is the same as before; a new object whenever anything differs.
        if (old) expect(mesh === old).toBe(sameMesh(old, ref));
      }
    }
    // The run went through every kind of edit at least once.
    expect(Object.keys(counts).sort()).toEqual(kinds.map(([k]) => k).sort());
  });

  it("a dialog's commit after a preview keeps the later plates' objects", {
    timeout: 60_000,
  }, async () => {
    const kernel = realKernel();
    const { document, model } = start(plates(4), kernel.api);
    await settled(model, () => kernel.sent.recomputes, 1);
    const before = model.getState().bodies;
    const r = recomputer as Recomputer;
    const draft = distance(document.getState().doc, 'ex0', 8).features[1] as Feature;
    // While the first plate is edited, the timeline before it is all there is.
    const preview = await r.preview(draft, 1, { base: true });
    expect(Object.keys(preview?.bodies ?? {})).toEqual(['ex0:0']);
    r.endPreview();
    document.setState({ doc: distance(document.getState().doc, 'ex0', 8) });
    await settled(model, () => kernel.sent.recomputes, 2);
    const after = model.getState().bodies;
    for (const id of ['ex1:0', 'ex2:0', 'ex3:0'])
      expect(after[id as BodyId]).toBe(before[id as BodyId]);
    expect(after['ex0:0' as BodyId]).not.toBe(before['ex0:0' as BodyId]);
  });
});

describe('the comparison covers every field (a stand-in kernel)', () => {
  /** A small random mesh with names, in new arrays each time. */
  function meshOf(rand: () => number): BodyMesh {
    const floats = (n: number) =>
      new Float32Array(Array.from({ length: n }, () => Math.round(rand() * 100) / 4));
    const ints = (n: number, max: number) =>
      new Uint32Array(Array.from({ length: n }, () => Math.floor(rand() * max)));
    return {
      positions: floats(18),
      normals: floats(18),
      indices: ints(6, 6),
      faceRanges: new Uint32Array([0, 1, 1, 1]),
      edgePoints: floats(12),
      edgeRanges: new Uint32Array([0, 2, 2, 2]),
      edgeFlags: new Uint8Array([0, 1]),
      vertices: floats(6),
      faceIds: ['f:a', 'f:b'],
      edgeIds: ['e:a', 'e:b'],
      vertexIds: ['v:a', 'v:b'],
    };
  }
  /** A copy in new arrays, as the worker sends it again. */
  const copy = (m: BodyMesh): BodyMesh =>
    Object.fromEntries(
      Object.entries(m).map(([k, v]) => [
        k,
        ArrayBuffer.isView(v) ? (v as Float32Array).slice() : Array.isArray(v) ? [...v] : v,
      ]),
    ) as unknown as BodyMesh;
  /** One change to one field: a bit of an array, a sign of a zero, a name, a field gone or added. */
  const changes: [string, (m: BodyMesh, rand: () => number) => void][] = [
    ['positions', (m, r) => flip(m.positions, r)],
    ['normals', (m, r) => flip(m.normals, r)],
    ['indices', (m, r) => flip(m.indices, r)],
    [
      'faceRanges',
      (m) => {
        m.faceRanges = new Uint32Array([0, 2, 2, 0]);
      },
    ],
    ['edgePoints', (m, r) => flip(m.edgePoints, r)],
    [
      'edgeRanges',
      (m) => {
        m.edgeRanges = new Uint32Array([0, 1, 1, 3]);
      },
    ],
    [
      'edgeFlags',
      (m) => {
        m.edgeFlags = new Uint8Array([1, 1]);
      },
    ],
    ['vertices', (m, r) => flip(m.vertices, r)],
    [
      '-0',
      (m) => {
        const p = m.positions.slice();
        p[0] = p[0] === 0 ? -0 : 0;
        m.positions = p;
      },
    ],
    [
      'faceIds',
      (m) => {
        m.faceIds = ['f:a', 'f:c'];
      },
    ],
    [
      'edgeIds',
      (m) => {
        m.edgeIds = ['e:b', 'e:a'];
      },
    ],
    [
      'vertexIds',
      (m) => {
        delete m.vertexIds;
      },
    ],
    [
      'mesh',
      (m) => {
        m.mesh = true;
      },
    ],
  ];
  /** The test's own answer, field by field and byte by byte. */
  function differs(a: BodyMesh, b: BodyMesh): boolean {
    const text = (m: BodyMesh) =>
      JSON.stringify(
        Object.entries(m)
          .sort(([x], [y]) => (x < y ? -1 : 1))
          .map(([k, v]) => [
            k,
            ArrayBuffer.isView(v)
              ? [v.constructor.name, ...new Uint8Array(v.buffer, v.byteOffset, v.byteLength)]
              : v,
          ]),
      );
    return text(a) !== text(b);
  }
  function flip(array: Float32Array | Uint32Array, rand: () => number) {
    const bits = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
    const at = Math.floor(rand() * bits.length);
    bits[at] = (bits[at] as number) ^ (1 << Math.floor(rand() * 8));
  }

  it('over a seeded run, a body keeps its object exactly when no field of its mesh changed', {
    timeout: 30_000,
  }, async () => {
    const rand = random(77);
    const ids = ['a:0', 'b:0', 'c:0', 'd:0'] as BodyId[];
    let current: Record<string, BodyMesh> = Object.fromEntries(ids.map((id) => [id, meshOf(rand)]));
    let version = 0;
    let calls = 0;
    const api = () =>
      ({
        // Every body sent again under a new version, as after an edit of the first feature.
        recompute: async (): Promise<RecomputeResult> => {
          calls++;
          version++;
          const bodies: BodyResult[] = ids.map((id) => ({
            id,
            version: `v${version}`,
            mesh: copy(current[id] as BodyMesh),
          }));
          return {
            status: 'done',
            features: {},
            bodies,
            origins: {},
            reports: {},
            stats: { evaluated: [], reused: 0, ms: 0, liveShapes: 0 },
          };
        },
      }) as Partial<KernelApi>;
    const { document, model } = start(testDocument([]), api);
    await settled(model, () => calls, 1);
    const seen = new Set<string>();
    for (let step = 0; step < 60; step++) {
      const before = model.getState().bodies;
      const changed = new Set<BodyId>();
      current = { ...current };
      for (const id of ids) {
        if (rand() < 0.4) {
          const [name, change] = changes[
            Math.floor(rand() * changes.length)
          ] as (typeof changes)[number];
          const mesh = copy(current[id] as BodyMesh);
          change(mesh, rand);
          if (differs(mesh, current[id] as BodyMesh)) {
            current[id] = mesh;
            changed.add(id);
            seen.add(name);
          }
        }
      }
      // A new document, so the Recomputer sends again.
      document.setState({ doc: { ...document.getState().doc, name: `step ${step}` } });
      await settled(model, () => calls, step + 2);
      const after = model.getState().bodies;
      for (const id of ids) {
        expect(after[id] === before[id]).toBe(!changed.has(id));
        expect(sameMesh(after[id] as BodyMesh, current[id] as BodyMesh)).toBe(true);
      }
    }
    expect([...seen].sort()).toEqual(changes.map(([name]) => name).sort());
  });
});
