// Memory test (ADR-0001, P0-09): rebuilding a part must not grow the heap.
//
// The probe is the facade's heapTop() (sbrk(0)): dlmalloc can't give memory
// back in WASM, so the top only moves when freed chunks can't satisfy a
// request. A leak-free loop plateaus after warm-up; a leak moves it steadily.
// It is finer than the WASM memory size, which hides small leaks in its slack.
//
// The control runs a loop that leaks on purpose (raw BRepAlgoAPI_Cut deleted
// without Clear(), taucad/opencascade.js#40) and must trip the same limit, so
// a probe that stops seeing leaks fails this test instead of passing it.

import {
  type BodyId,
  type ExtrudeInputOptions,
  extrudeInputs,
  type Feature,
  type GeomRef,
  originAxisRef,
  originPlaneRef,
  type PrimitiveInputOptions,
  type PrimitiveType,
  primitiveInputs,
  type RevolveInputOptions,
  revolveInputs,
  type SketchData,
  sketchInputs,
} from '@extrudo/core';
import { SketchBuilder } from '@extrudo/sketch/fixtures';
import { detectProfiles, PROFILE_TOLERANCE } from '@extrudo/sketch/profiles';
import { beforeAll, describe, expect, it } from 'vitest';
import { mirror, rotation, translation } from './features/matrix';
import { planarCurves } from './features/sketch';
import {
  ChamferError,
  FilletError,
  Kernel,
  OffsetFaceError,
  type ShapeHandle,
  ShellError,
} from './kernel';
import { positionalNames } from './naming/names';
import {
  compoundSources,
  faceEdgeSources,
  namedBoolean,
  namedPrism,
  namedRevolve,
  withHistory,
} from './naming/ops';
import { resolveRef } from './naming/resolve';
import { loadOcct } from './occt/load';
import type { OcctModule } from './occt/types';
import { RecomputeEngine } from './recompute/engine';
import { testDocument, testFeature, testFeatures } from './recompute/testing';
import { makeTestPart } from './test-part';

const WARM_UP = 50;
const REBUILDS = 1000;
/** Offsets cost 10 to 140 ms (P3-08), so their memory test runs fewer rounds. */
const OFFSET_REBUILDS = 300;
/** Allowed heap growth over the whole run: fragmentation noise, not a leak. */
const LIMIT_BYTES = 256 * 1024;

let oc: OcctModule;
let kernel: Kernel;

beforeAll(async () => {
  oc = await loadOcct();
  kernel = new Kernel(oc);
});

describe('memory', () => {
  it(`rebuilding the test part ${REBUILDS} times does not grow the heap`, {
    timeout: 180_000,
  }, () => {
    for (let i = 0; i < WARM_UP; i++) makeTestPart(kernel);
    const before = kernel.stats();
    for (let i = 0; i < REBUILDS; i++) makeTestPart(kernel);
    const after = kernel.stats();

    expect(after.liveShapes).toBe(0);
    expect(after.heapTop - before.heapTop).toBeLessThan(LIMIT_BYTES);
    expect(after.heapBytes).toBe(before.heapBytes);
  });

  it(`making a sketch's profile faces ${REBUILDS} times does not grow the heap`, {
    timeout: 180_000,
  }, () => {
    // A plate with holes, a slot, a crossing line and a spline: every curve
    // type through General Fuse and the face builder (P2-02).
    const b = new SketchBuilder();
    b.line(0, 0, 120, 0);
    b.line(120, 0, 120, 80);
    b.line(120, 80, 0, 80);
    b.line(0, 80, 0, 0);
    b.circle(20, 20, 3);
    b.ellipse(60, 40, 10, 5, 30);
    b.line(90, 30, 110, 30);
    b.arc(110, 35, 5, -90, 90);
    b.line(110, 40, 90, 40);
    b.arc(90, 35, 5, 90, 270);
    b.line(-10, 60, 130, 60);
    b.spline([
      [10, 70],
      [30, 50],
      [50, 75],
    ]);
    const { curves } = planarCurves(b.sketch);
    const frame = { origin: [0, 0, 0], x: [1, 0, 0], normal: [0, 0, 1] } as const;
    const rebuild = () => {
      const { faces } = kernel.planarFaces(curves, frame, PROFILE_TOLERANCE);
      if (faces.length < 5) throw new Error(`only ${faces.length} faces`);
      kernel.release(...faces.map((f) => f.shape));
    };
    for (let i = 0; i < WARM_UP; i++) rebuild();
    const before = kernel.stats();
    for (let i = 0; i < REBUILDS; i++) rebuild();
    const after = kernel.stats();

    expect(after.liveShapes).toBe(0);
    expect(after.heapTop - before.heapTop).toBeLessThan(LIMIT_BYTES);
    expect(after.heapBytes).toBe(before.heapBytes);
  });

  it(`extruding, revolving, cutting, filleting and naming ${REBUILDS} times does not grow the heap`, {
    timeout: 180_000,
  }, () => {
    // Every naming operation of P2-04 (ADR-0005): sweeps with history, a
    // simplifying boolean, a fillet named through its history, compounds,
    // sub-shapes, descriptions and resolving a reference.
    const b = new SketchBuilder();
    b.line(0, 0, 30, 0);
    b.line(30, 0, 30, 10);
    b.line(30, 10, 0, 10);
    b.line(0, 10, 0, 0);
    b.circle(20, 5, 2);
    const { curves } = planarCurves(b.sketch);
    const frame = { origin: [0, 0, 0], x: [1, 0, 0], normal: [0, 0, 1] } as const;
    const rebuild = (i: number) => {
      using scope = kernel.scope();
      const { faces } = kernel.planarFaces(curves, frame, PROFILE_TOLERANCE);
      for (const face of faces) scope.track(face.shape);
      const profile = faces[0] as (typeof faces)[number];
      const sources = profile.edges.map((c) => `c${c}`);
      const plate = namedPrism(kernel, {
        feature: 'E',
        shape: profile.shape,
        edgeSources: sources,
        vector: [0, 0, 5 + (i % 5) / 10],
      });
      scope.track(plate.shape);
      const slot = scope.track(kernel.box([4, 20, 4], [8, -5, 3]));
      const tool = { shape: slot, names: positionalNames('box', 'B', kernel.describe(slot)) };
      const cut = namedBoolean(kernel, 'cut', plate, tool, { feature: 'C', simplify: true });
      scope.track(cut.shape);
      const rim = cut.names.edges.findIndex((e) => e.includes('cap:end') && e.includes(':side:c'));
      const found = resolveRef(
        { kind: 'edge', id: cut.names.edges[rim] as string },
        [{ id: 'b' as BodyId, shape: cut.shape, names: cut.names }],
        (shape) => kernel.describe(shape),
      );
      const rounded = withHistory(
        kernel,
        kernel.fillet(cut.shape, [found.index], 0.5),
        [cut.names],
        {
          op: 'fillet',
          feature: 'F',
        },
      );
      scope.track(rounded.shape);
      const ring = namedRevolve(kernel, {
        feature: 'V',
        shape: profile.shape,
        edgeSources: sources,
        axis: { origin: [0, -1, 0], direction: [1, 0, 0] },
        angle: i % 2 ? 2 * Math.PI : 1,
      });
      scope.track(ring.shape);
      const top = faceEdgeSources(kernel, rounded, 0);
      scope.track(top.shape);
      const both = scope.track(kernel.compound([plate.shape, ring.shape]));
      compoundSources(kernel, both, [top]);
      kernel.describe(both);
    };
    for (let i = 0; i < WARM_UP; i++) rebuild(i);
    const before = kernel.stats();
    for (let i = 0; i < REBUILDS; i++) rebuild(i);
    const after = kernel.stats();

    expect(after.liveShapes).toBe(0);
    expect(after.heapTop - before.heapTop).toBeLessThan(LIMIT_BYTES);
    expect(after.heapBytes).toBe(before.heapBytes);
  });

  it(`tapering, measuring distances and splitting solids ${REBUILDS} times does not grow the heap`, {
    timeout: 180_000,
  }, () => {
    // The facade ops of P2-06 (ADR-0028): tapered prisms (DraftAngle and
    // its checks, a slot's tangent arcs, a hole), one that fails as too
    // steep, distances between solids, and a compound's solids.
    const b = new SketchBuilder();
    b.line(0, 0, 30, 0);
    b.line(30, 0, 30, 10);
    b.line(30, 10, 0, 10);
    b.line(0, 10, 0, 0);
    b.circle(20, 5, 2);
    b.line(40, 0, 50, 0);
    b.arc(50, 3, 3, -90, 90);
    b.line(50, 6, 40, 6);
    b.arc(40, 3, 3, 90, 270);
    const { curves } = planarCurves(b.sketch);
    const frame = { origin: [0, 0, 0], x: [1, 0, 0], normal: [0, 0, 1] } as const;
    const rebuild = (i: number) => {
      using scope = kernel.scope();
      const { faces } = kernel.planarFaces(curves, frame, PROFILE_TOLERANCE);
      for (const face of faces) scope.track(face.shape);
      const [plate, slot] = faces.sort((x, y) => x.centroid[0] - y.centroid[0]).map((f) => f.shape);
      if (plate === undefined || slot === undefined) throw new Error('no faces');
      const taper = ((i % 3) - 1) * 0.05;
      const a = scope.track(kernel.prism(plate, [0, 0, 5 + (i % 5) / 10], [0, 0, 0], taper));
      const c = scope.track(kernel.prism(slot, [0, 0, -4], [0, 0, 0], 0.08));
      expect(() => kernel.prism(slot, [0, 0, 20], [0, 0, 0], -0.5)).toThrow(/too steep/);
      const both = scope.track(kernel.compound([a.shape, c.shape]));
      const block = scope.track(kernel.box([60, 20, 2], [-5, -5, 5]));
      if (kernel.distance(block, both) > 1e-4) throw new Error('should touch');
      const solids = kernel.solids(both);
      for (const solid of solids) scope.track(solid);
      if (solids.length !== 2) throw new Error(`${solids.length} solids`);
    };
    for (let i = 0; i < WARM_UP; i++) rebuild(i);
    const before = kernel.stats();
    for (let i = 0; i < REBUILDS; i++) rebuild(i);
    const after = kernel.stats();

    expect(after.liveShapes).toBe(0);
    expect(after.heapTop - before.heapTop).toBeLessThan(LIMIT_BYTES);
    expect(after.heapBytes).toBe(before.heapBytes);
  });

  it(`moving, turning and mirroring named bodies ${REBUILDS} times does not grow the heap`, {
    timeout: 180_000,
  }, () => {
    // The facade transform of P3-06 (ADR-0044): translations, turns and
    // mirrors of a cut body through their history, a mirrored copy fused
    // back to its original, and a mesh of the result.
    const rebuild = (i: number) => {
      using scope = kernel.scope();
      const box = scope.track(kernel.box([20, 10, 6]));
      const hole = scope.track(kernel.cylinder(2, 10, [10, 5, -2]));
      const body = scope.track(kernel.cut(box, hole));
      const names = positionalNames('B', 'B', kernel.describe(body.shape));
      const angle = (i % 90) * (Math.PI / 180);
      const matrices = [
        translation([i % 7, 1, 2]),
        rotation([3, 4, 5], [1, 1, 0], angle),
        mirror([(i % 5) - 10, 0, 0], [1, 0, 0]),
      ];
      matrices.forEach((matrix, k) => {
        const moved = withHistory(kernel, kernel.transform(body.shape, matrix), [names], {
          op: 'move',
          feature: 'M',
        });
        scope.track(moved.shape);
        kernel.mesh(moved.shape, { linearDeflection: 0.1, angularDeflection: 0.5 });
        if (k === 2) {
          const joined = namedBoolean(kernel, 'fuse', { shape: body.shape, names }, moved, {
            feature: 'J',
            simplify: true,
          });
          scope.track(joined.shape);
        }
      });
      expect(() => kernel.transform(body.shape, scaling)).toThrow(/scales/);
    };
    const scaling = [2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0];
    for (let i = 0; i < WARM_UP; i++) rebuild(i);
    const before = kernel.stats();
    for (let i = 0; i < REBUILDS; i++) rebuild(i);
    const after = kernel.stats();

    expect(after.liveShapes).toBe(0);
    expect(after.heapTop - before.heapTop).toBeLessThan(LIMIT_BYTES);
    expect(after.heapBytes).toBe(before.heapBytes);
  });

  it(`reading edge geometry and silhouettes ${REBUILDS} times does not grow the heap`, {
    timeout: 180_000,
  }, () => {
    // The facade ops of P2-09 (ADR-0031): every edge of a cylinder cut in half
    // (circles, arcs, lines, a seam), and the silhouettes of its curved face
    // from several directions, clipped by the face classifier.
    const cylinder = kernel.cylinder(5, 10);
    const half = kernel.box([20, 10, 12], [-10, 0, -1]);
    const cut = kernel.cut(cylinder, half);
    kernel.release(cylinder, half);
    const edges = kernel.count(cut.shape, 'edge');
    const faces = kernel.count(cut.shape, 'face');
    const read = (i: number) => {
      for (let e = 0; e < edges; e++) kernel.edgeGeometry(cut.shape, e, 8 + (i % 16));
      for (let f = 0; f < faces; f++) {
        kernel.faceSilhouettes(cut.shape, f, [0, 1, 0]);
        kernel.faceSilhouettes(cut.shape, f, [1, 0, i % 2]);
      }
      expect(() => kernel.edgeGeometry(cut.shape, edges, 8)).toThrow();
    };
    for (let i = 0; i < WARM_UP; i++) read(i);
    const before = kernel.stats();
    for (let i = 0; i < REBUILDS; i++) read(i);
    const after = kernel.stats();
    kernel.release(cut.shape);

    expect(kernel.stats().liveShapes).toBe(0);
    expect(after.heapTop - before.heapTop).toBeLessThan(LIMIT_BYTES);
    expect(after.heapBytes).toBe(before.heapBytes);
  });

  it('recomputing real extrudes 300 times with changing values does not grow the heap', {
    timeout: 180_000,
  }, async () => {
    // The extrude evaluator end to end: a block, a tapered cut through it,
    // a join up to its face, press-pull of a face; every run a new size.
    const engine = new RecomputeEngine(kernel, testFeatures().registry, {
      strictLeaks: true,
      maxEntries: 8,
    });
    const block = new SketchBuilder();
    block.line(0, 0, 40, 0);
    block.line(40, 0, 40, 30);
    block.line(40, 30, 0, 30);
    block.line(0, 30, 0, 0);
    const hole = new SketchBuilder();
    hole.circle(10, 10, 4);
    const regions = (data: SketchData) => detectProfiles(data).map((p) => p.id);
    const profileOf = (sketch: string, data: SketchData): GeomRef => ({
      kind: 'profile',
      id: `${sketch}/${regions(data)[0]}`,
    });
    const sketchOn = (id: string, data: SketchData): Feature => ({
      ...testFeature(id, 'sketch'),
      inputs: sketchInputs(originPlaneRef('origin:xy'), data),
    });
    const extrude = (id: string, refs: GeomRef[], options: ExtrudeInputOptions): Feature => ({
      ...testFeature(id, 'extrude'),
      inputs: extrudeInputs(refs, options),
    });
    const top: GeomRef = { kind: 'face', id: 'extrude:B:cap:end' };
    const doc = (h: number) =>
      testDocument([
        sketchOn('SB', block.sketch),
        extrude('B', [profileOf('SB', block.sketch)], { distance: `${h} mm` }),
        sketchOn('SH', hole.sketch),
        extrude('H', [profileOf('SH', hole.sketch)], {
          extent: 'through-all',
          operation: 'cut',
          taper: '-3 deg',
          direction: 'symmetric',
        }),
        extrude('P', [top], { distance: '2 mm', operation: 'join', taper: '-5 deg' }),
      ]);
    const run = async (i: number) => {
      const result = await engine.recompute({ doc: doc(5 + (i % 300) / 100) });
      if (result.status !== 'done' || result.bodies.length !== 1) throw new Error('no body');
      for (const s of Object.values(result.features)) {
        if (s.status !== 'ok') throw new Error(s.message);
      }
    };
    for (let i = 0; i < WARM_UP; i++) await run(i);
    const before = kernel.stats();
    for (let i = WARM_UP; i < WARM_UP + 300; i++) await run(i);
    const after = kernel.stats();

    expect(after.liveShapes).toBe(engine.size.shapes);
    expect(after.heapTop - before.heapTop).toBeLessThan(LIMIT_BYTES);
    engine.clear();
    expect(kernel.stats().liveShapes).toBe(0);
  });

  it('recomputing real revolves 300 times with changing values does not grow the heap', {
    timeout: 180_000,
  }, async () => {
    // The revolve evaluator end to end (ADR-0029): a block, a symmetric groove
    // cut about the Z axis (the profile turned to its start first), a ring
    // joined about a construction line, a flat face turned about a body edge.
    //
    // Every run starts from an empty cache. With cached shapes kept between
    // runs the heap top moves by 16 MB every few hundred runs: OCCT's
    // booleans and mesher grow their incremental allocator's blocks up to
    // 16 MB, and live cached shapes split the freed block. Cleared each run
    // the heap stays flat, so that is fragmentation, not a leak (ADR-0029).
    const engine = new RecomputeEngine(kernel, testFeatures().registry, {
      strictLeaks: true,
      maxEntries: 8,
    });
    const rectangle = (b: SketchBuilder, x: number, y: number, w: number, h: number) => {
      const bottom = b.line(x, y, x + w, y).id;
      b.line(x + w, y, x + w, y + h);
      b.line(x + w, y + h, x, y + h);
      b.line(x, y + h, x, y);
      return bottom;
    };
    const block = new SketchBuilder();
    const front = rectangle(block, 0, 0, 40, 30);
    const regions = (data: SketchData) => detectProfiles(data).map((p) => p.id);
    const profileOf = (sketch: string, data: SketchData): GeomRef => ({
      kind: 'profile',
      id: `${sketch}/${regions(data)[0]}`,
    });
    const sketchOn = (id: string, data: SketchData, plane: 'origin:xy' | 'origin:xz'): Feature => ({
      ...testFeature(id, 'sketch'),
      inputs: sketchInputs(originPlaneRef(plane), data),
    });
    const revolve = (
      id: string,
      refs: GeomRef[],
      axis: GeomRef,
      options: RevolveInputOptions,
    ): Feature => ({ ...testFeature(id, 'revolve'), inputs: revolveInputs(refs, axis, options) });
    const groove = new SketchBuilder();
    rectangle(groove, 10, 5, 8, 10);
    const ring = new SketchBuilder();
    rectangle(ring, 45, 0, 3, 4);
    const axis = ring.line(50, -5, 50, 20, true).id;
    const doc = (a: number) =>
      testDocument([
        sketchOn('SB', block.sketch, 'origin:xy'),
        {
          ...testFeature('B', 'extrude'),
          inputs: extrudeInputs([profileOf('SB', block.sketch)], {
            distance: '20 mm',
            direction: 'symmetric',
          }),
        },
        sketchOn('SG', groove.sketch, 'origin:xz'),
        revolve('G', [profileOf('SG', groove.sketch)], originAxisRef('origin:z'), {
          angle: `${a} deg`,
          direction: 'symmetric',
          operation: 'cut',
        }),
        sketchOn('SR', ring.sketch, 'origin:xy'),
        revolve(
          'R',
          [profileOf('SR', ring.sketch)],
          { kind: 'sketchEntity', id: `SR/${axis}` },
          {
            direction: 'two-sides',
            angle: `${a} deg`,
            angle2: '20 deg',
          },
        ),
        revolve(
          'F',
          [{ kind: 'face', id: 'extrude:B:cap:end' }],
          { kind: 'edge', id: `e[extrude:B:cap:end|extrude:B:side:${front}]` },
          { angle: '30 deg', operation: 'join' },
        ),
      ]);
    const run = async (i: number) => {
      const result = await engine.recompute({ doc: doc(60 + (i % 100) * 0.3) });
      if (result.status !== 'done' || result.bodies.length !== 2) throw new Error('no bodies');
      for (const s of Object.values(result.features)) {
        if (s.status === 'error') throw new Error(s.message);
      }
      engine.clear();
    };
    // One run through every angle first (the largest blocks OCCT asks for).
    for (let i = 0; i < 100; i++) await run(i);
    const before = kernel.stats();
    for (let i = 100; i < 400; i++) await run(i);
    const after = kernel.stats();

    expect(after.liveShapes).toBe(0);
    expect(after.heapTop - before.heapTop).toBeLessThan(LIMIT_BYTES);
  });

  it('recomputing real primitives 300 times with changing values does not grow the heap', {
    timeout: 180_000,
  }, async () => {
    // The primitives end to end (ADR-0032): a box, a cylinder cut into its
    // top face, a sphere joined to its side and a torus as a new body on
    // XZ, sized by the run. From an empty cache each run, as for revolves.
    const engine = new RecomputeEngine(kernel, testFeatures().registry, {
      strictLeaks: true,
      maxEntries: 8,
    });
    const primitive = (id: string, type: PrimitiveType, options: PrimitiveInputOptions) => ({
      ...testFeature(id, type),
      inputs: primitiveInputs(type, options),
    });
    const doc = (length: number) =>
      testDocument([
        primitive('B', 'box', {
          numbers: { length: `${length} mm`, width: '30 mm', height: '10 mm' },
        }),
        primitive('C', 'cylinder', {
          plane: { kind: 'face', id: 'box:B:cap:end' },
          numbers: { diameter: '8 mm', height: '-5 mm', x: '5 mm' },
          operation: 'cut',
        }),
        primitive('S', 'sphere', {
          plane: { kind: 'face', id: 'box:B:side:right' },
          numbers: { diameter: '10 mm', y: '5 mm' },
          operation: 'join',
        }),
        primitive('T', 'torus', {
          plane: originPlaneRef('origin:xz'),
          numbers: { diameter: `${length} mm`, tube: '4 mm', offset: '40 mm' },
        }),
      ]);
    const run = async (i: number) => {
      const result = await engine.recompute({ doc: doc(40 + (i % 100) * 0.3) });
      if (result.status !== 'done' || result.bodies.length !== 2) throw new Error('no bodies');
      for (const s of Object.values(result.features)) {
        if (s.status === 'error') throw new Error(s.message);
      }
      engine.clear();
    };
    for (let i = 0; i < 100; i++) await run(i);
    const before = kernel.stats();
    for (let i = 100; i < 400; i++) await run(i);
    const after = kernel.stats();

    expect(after.liveShapes).toBe(0);
    expect(after.heapTop - before.heapTop).toBeLessThan(LIMIT_BYTES);
  });

  it('recomputing a fixture 500 times with changing values does not grow the heap', {
    timeout: 180_000,
  }, async () => {
    // Every run misses the cache (a new hole size), evaluates, meshes and
    // evicts: the engine's reference counting must give every shape back.
    const engine = new RecomputeEngine(kernel, testFeatures().registry, {
      strictLeaks: true,
      maxEntries: 8,
    });
    const doc = (radius: number) =>
      testDocument(
        [
          testFeature('box', 'test-box', { size: '20 mm' }),
          testFeature('grow', 'test-grow', { height: '5 mm' }),
          testFeature('hole', 'test-hole', { radius: 'r' }),
        ],
        { r: `${radius} mm` },
      );
    const run = async (i: number) => {
      const result = await engine.recompute({ doc: doc(1 + (i % 400) / 100) });
      if (result.status !== 'done' || result.bodies.length !== 1) throw new Error('no body');
    };
    for (let i = 0; i < WARM_UP; i++) await run(i);
    const before = kernel.stats();
    for (let i = WARM_UP; i < WARM_UP + 500; i++) await run(i);
    const after = kernel.stats();

    expect(after.liveShapes).toBe(engine.size.shapes);
    expect(after.heapTop - before.heapTop).toBeLessThan(LIMIT_BYTES);
    engine.clear();
    expect(kernel.stats().liveShapes).toBe(0);
  });

  it(`exporting a meshed and a STEP body ${REBUILDS} times does not grow the heap`, {
    timeout: 180_000,
  }, () => {
    // P2-12 (ADR-0034): the welded export mesh (a copy meshed at the export's
    // deflection) and a STEP file written and read back.
    using scope = kernel.scope();
    const block = scope.track(kernel.box([40, 30, 20]));
    const hole = scope.track(kernel.cylinder(4, 40, [20, 15, -10]));
    const body = scope.track(kernel.cut(block, hole));
    const run = (i: number) => {
      const fine = i % 2 === 0;
      const mesh = kernel.exportMesh(body.shape, {
        linearDeflection: fine ? 0.01 : 0.1,
        angularDeflection: fine ? 0.1 : 0.5,
      });
      if (mesh.indices.length === 0) throw new Error('no triangles');
      if (i % 5 === 0) {
        const back = kernel.readStep(kernel.writeStep([{ shape: body.shape, name: `Body${i}` }]));
        kernel.release(back);
      }
    };
    for (let i = 0; i < WARM_UP; i++) run(i);
    const before = kernel.stats();
    for (let i = 0; i < REBUILDS; i++) run(i);
    const after = kernel.stats();

    expect(after.liveShapes).toBe(3);
    expect(after.heapTop - before.heapTop).toBeLessThan(LIMIT_BYTES);
  });

  it(`filleting ${REBUILDS} times, failing ones with their diagnosis included, does not grow the heap`, {
    timeout: 300_000,
  }, () => {
    // P3-01: several radii through the builder on the facade's stack, a
    // failed fillet whose maximum radius is found by probing (a dozen
    // builders per failure), a tangent chain query and a mixed-radii
    // refusal: all inside the facade, none may leave anything behind.
    const rebuild = (i: number) => {
      using scope = kernel.scope();
      const plate = scope.track(kernel.box([40, 30, 2 + (i % 3) / 10]));
      const rounded = scope.track(kernel.fillet(plate, [0, 2, 4, 6], [5, 5, 5, 5]));
      const chain = kernel.tangentChain(rounded.shape, 0);
      if (chain.length < 2) throw new Error('no chain');
      scope.track(kernel.fillet(plate, [0, 2], [1, 1.5]));
      try {
        kernel.fillet(plate, [0, 1], 3);
        throw new Error('a 3 mm fillet of a 2 mm plate should fail');
      } catch (error) {
        if (!(error instanceof FilletError)) throw error;
      }
      try {
        kernel.fillet(rounded.shape, chain.slice(0, 2), [0.5, 0.7]);
        throw new Error('two radii on one chain should fail');
      } catch (error) {
        if (!(error instanceof FilletError)) throw error;
      }
    };
    for (let i = 0; i < WARM_UP; i++) rebuild(i);
    const before = kernel.stats();
    for (let i = 0; i < REBUILDS; i++) rebuild(i);
    const after = kernel.stats();

    expect(after.liveShapes).toBe(before.liveShapes);
    expect(after.heapTop - before.heapTop).toBeLessThan(LIMIT_BYTES);
  });

  it(`chamfering ${REBUILDS} times, failing ones with their diagnosis included, does not grow the heap`, {
    timeout: 300_000,
  }, () => {
    // P3-02: the three modes through the builder on the facade's stack, a
    // failed chamfer whose maximum distance is found by probing (a dozen
    // builders per failure), a chain refused for two settings and an edge
    // that isn't between two faces: all inside the facade, none may leave
    // anything behind.
    const rebuild = (i: number) => {
      using scope = kernel.scope();
      const plate = scope.track(kernel.box([40, 30, 2 + (i % 3) / 10]));
      scope.track(kernel.chamfer(plate, [0, 2, 4, 6], { mode: 'equal', distance: 0.5 }));
      scope.track(
        kernel.chamfer(
          plate,
          [0, 2],
          [
            { mode: 'two-distances', distance: 0.4, distanceB: 0.8, flip: i % 2 === 0 },
            { mode: 'distance-angle', distance: 0.6, angle: Math.PI / 6, flip: i % 2 === 1 },
          ],
        ),
      );
      const rounded = scope.track(kernel.fillet(plate, [0, 2, 4, 6], [5, 5, 5, 5]));
      const chain = kernel.tangentChain(rounded.shape, 0);
      if (chain.length < 2) throw new Error('no chain');
      const failing = (run: () => unknown, what: string) => {
        try {
          run();
        } catch (error) {
          if (error instanceof ChamferError) return;
          throw error;
        }
        throw new Error(`${what} should fail`);
      };
      failing(
        () => kernel.chamfer(plate, [0, 1], { mode: 'equal', distance: 3 }),
        'a 3 mm chamfer of a 2 mm plate',
      );
      failing(
        () =>
          kernel.chamfer(rounded.shape, chain.slice(0, 2), [
            { mode: 'equal', distance: 0.5 },
            { mode: 'equal', distance: 0.7 },
          ]),
        'two settings on one chain',
      );
    };
    for (let i = 0; i < WARM_UP; i++) rebuild(i);
    const before = kernel.stats();
    for (let i = 0; i < REBUILDS; i++) rebuild(i);
    const after = kernel.stats();

    expect(after.liveShapes).toBe(before.liveShapes);
    expect(after.heapTop - before.heapTop).toBeLessThan(LIMIT_BYTES);
  });

  it(`shelling ${REBUILDS} times, failing ones with their diagnosis included, does not grow the heap`, {
    timeout: 300_000,
  }, () => {
    // P3-03: shells inside, outside and closed through the builder on the
    // facade's stack (each on a copy of the body), a shell too thick whose
    // largest thickness is found by probing, a removed face next to a fillet
    // (refused before OCCT runs) and a cylinder's wall (nothing to hold):
    // all inside the facade, none may leave anything behind.
    const rebuild = (i: number) => {
      using scope = kernel.scope();
      const plate = scope.track(kernel.box([40, 30, 10 + (i % 3) / 10]));
      scope.track(kernel.shell(plate, [0], 1 + (i % 4) / 10));
      scope.track(kernel.shell(plate, [1], 1, 'outside'));
      scope.track(kernel.shell(plate, [], 1 + (i % 2) / 10));
      const rounded = scope.track(kernel.fillet(plate, [0, 2, 4, 6], [3, 3, 3, 3]));
      scope.track(kernel.shell(rounded.shape, [], 1));
      const failing = (run: () => unknown, what: string) => {
        try {
          run();
        } catch (error) {
          if (error instanceof ShellError) return;
          throw error;
        }
        throw new Error(`${what} should fail`);
      };
      failing(() => kernel.shell(plate, [0], 30), 'a 30 mm wall on a 10 mm plate');
      failing(() => kernel.shell(plate, [0, 1, 2, 3, 4, 5], 1), 'removing every face');
      const cylinder = scope.track(kernel.cylinder(6, 20));
      failing(() => kernel.shell(cylinder, [0], 1), "a cylinder's whole wall");
    };
    for (let i = 0; i < WARM_UP; i++) rebuild(i);
    const before = kernel.stats();
    for (let i = 0; i < REBUILDS; i++) rebuild(i);
    const after = kernel.stats();

    expect(after.liveShapes).toBe(before.liveShapes);
    expect(after.heapTop - before.heapTop).toBeLessThan(LIMIT_BYTES);
  });

  it(`offsetting faces ${OFFSET_REBUILDS} times, failing ones with their diagnosis included, does not grow the heap`, {
    timeout: 300_000,
  }, () => {
    // P3-08: offsets of planar and curved faces out and in, a rounded body whose
    // smooth chain moves together, a face pushed too far (the largest distance is
    // found by probing), a wall pushed past a cylinder's axis and a sealed void
    // (refused): OCCT's offset builder lives on the facade's stack and works on a
    // copy of the body, so none may leave anything behind. An offset costs 10 to
    // 140 ms, so this runs fewer rounds than the others, the expensive bodies
    // (rounded corners, every edge rounded) in some of them.
    const rebuild = (i: number) => {
      using scope = kernel.scope();
      const plate = scope.track(kernel.box([40, 30, 10 + (i % 3) / 10]));
      scope.track(kernel.offsetFaces(plate, [0], 1 + (i % 4) / 10));
      scope.track(kernel.offsetFaces(plate, [1, 3], -1));
      if (i % 2 === 0) {
        const rounded = scope.track(kernel.fillet(plate, [0, 2, 4, 6], [3, 3, 3, 3]));
        // Whatever those four edges make, a refusal (rounded edges meeting at a corner) is fine.
        try {
          scope.track(kernel.offsetFaces(rounded.shape, [0], 1));
        } catch (error) {
          if (!(error instanceof OffsetFaceError)) throw error;
        }
        kernel.tangentFaces(rounded.shape, 0);
      }
      if (i % 4 === 0) {
        const blended = scope.track(
          kernel.fillet(
            plate,
            Array.from({ length: 12 }, (_, edge) => edge),
            Array(12).fill(2),
          ),
        );
        scope.track(kernel.offsetFaces(blended.shape, [0], 1));
      }
      const cylinder = scope.track(kernel.cylinder(6, 20));
      const hollow = scope.track(kernel.shell(plate, [], 1));
      const failing = (run: () => unknown, what: string) => {
        try {
          run();
        } catch (error) {
          if (error instanceof OffsetFaceError) return;
          throw error;
        }
        throw new Error(`${what} should fail`);
      };
      failing(() => kernel.offsetFaces(plate, [0], -50), 'pushing a 40 mm plate 50 mm in');
      failing(() => kernel.offsetFaces(hollow.shape, [0], 1), 'offsetting a sealed void');
      for (let face = 0; face < 3; face++) {
        try {
          scope.track(kernel.offsetFaces(cylinder, [face], -8));
        } catch (error) {
          if (!(error instanceof OffsetFaceError)) throw error;
        }
      }
    };
    for (let i = 0; i < WARM_UP; i++) rebuild(i);
    const before = kernel.stats();
    for (let i = 0; i < OFFSET_REBUILDS; i++) rebuild(i);
    const after = kernel.stats();

    expect(after.liveShapes).toBe(before.liveShapes);
    expect(after.heapTop - before.heapTop).toBeLessThan(LIMIT_BYTES);
  });

  it('the leak control trips the same limit', { timeout: 120_000 }, () => {
    // The WASM build binds no raw OCCT classes (ADR-0037), so the control leaks
    // through the facade instead: meshed cuts (the triangulation stays on the
    // shape) whose results are never released.
    const kept: ShapeHandle[] = [];
    const leakyCut = () => {
      using scope = kernel.scope();
      const block = scope.track(kernel.box([40, 30, 20]));
      const hole = scope.track(kernel.cylinder(4, 22, [20, 15, -1]));
      const cut = kernel.cut(block, hole).shape;
      kept.push(cut);
      kernel.mesh(cut, { linearDeflection: 0.01, angularDeflection: 0.1 });
    };
    for (let i = 0; i < WARM_UP; i++) leakyCut();
    const before = kernel.stats();
    for (let i = 0; i < 300; i++) leakyCut();
    const after = kernel.stats();
    try {
      expect(after.liveShapes - before.liveShapes).toBe(300);
      expect(after.heapTop - before.heapTop).toBeGreaterThan(LIMIT_BYTES);
    } finally {
      for (const handle of kept) kernel.release(handle);
    }
  });

  it('the chamfer leak control trips the same limit', { timeout: 120_000 }, () => {
    // The chamfer test above passes because nothing is kept: the same
    // chamfers whose results are kept and meshed must show as live shapes.
    // (Last in the file: it raises the heap's high-water mark, which the
    // generic control above needs to still be low.)
    const kept: ShapeHandle[] = [];
    const leakyChamfer = () => {
      using scope = kernel.scope();
      const plate = scope.track(kernel.box([40, 30, 2]));
      const chamfered = kernel.chamfer(plate, [0, 2, 4, 6], { mode: 'equal', distance: 0.5 }).shape;
      kept.push(chamfered);
      kernel.mesh(chamfered, { linearDeflection: 0.01, angularDeflection: 0.1 });
    };
    for (let i = 0; i < WARM_UP; i++) leakyChamfer();
    const before = kernel.stats();
    for (let i = 0; i < 300; i++) leakyChamfer();
    const after = kernel.stats();
    try {
      expect(after.liveShapes - before.liveShapes).toBe(300);
    } finally {
      for (const handle of kept) kernel.release(handle);
    }
  });

  it('the shell leak control trips the same limit', { timeout: 120_000 }, () => {
    // The shell test above passes because nothing is kept: the same shells
    // whose results are kept and meshed must show as live shapes. (After the
    // other controls: it raises the heap's high-water mark.)
    const kept: ShapeHandle[] = [];
    const leakyShell = () => {
      using scope = kernel.scope();
      const plate = scope.track(kernel.box([40, 30, 10]));
      const shelled = kernel.shell(plate, [0], 1).shape;
      kept.push(shelled);
      kernel.mesh(shelled, { linearDeflection: 0.01, angularDeflection: 0.1 });
    };
    for (let i = 0; i < WARM_UP; i++) leakyShell();
    const before = kernel.stats();
    for (let i = 0; i < 300; i++) leakyShell();
    const after = kernel.stats();
    try {
      expect(after.liveShapes - before.liveShapes).toBe(300);
    } finally {
      for (const handle of kept) kernel.release(handle);
    }
  });

  it('the offset leak control trips the same limit', { timeout: 120_000 }, () => {
    // The offset test above passes because nothing is kept: the same offsets
    // whose results are kept and meshed must show as live shapes. (After the
    // other controls: it raises the heap's high-water mark.)
    const kept: ShapeHandle[] = [];
    const leakyOffset = () => {
      using scope = kernel.scope();
      const plate = scope.track(kernel.box([40, 30, 10]));
      const moved = kernel.offsetFaces(plate, [0], 1).shape;
      kept.push(moved);
      kernel.mesh(moved, { linearDeflection: 0.01, angularDeflection: 0.1 });
    };
    for (let i = 0; i < WARM_UP; i++) leakyOffset();
    const before = kernel.stats();
    for (let i = 0; i < 300; i++) leakyOffset();
    const after = kernel.stats();
    try {
      expect(after.liveShapes - before.liveShapes).toBe(300);
    } finally {
      for (const handle of kept) kernel.release(handle);
    }
  });
});
