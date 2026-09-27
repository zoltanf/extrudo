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
import { SketchBuilder } from '@extrudo/sketch/fixtures';
import { PROFILE_TOLERANCE } from '@extrudo/sketch/profiles';
import { beforeAll, describe, expect, it } from 'vitest';
import { planarCurves } from './features/sketch';
import { Kernel } from './kernel';
import { loadOcct } from './occt/load';
import type { OcctModule } from './occt/types';
import { RecomputeEngine } from './recompute/engine';
import { testDocument, testFeature, testFeatures } from './recompute/testing';
import { makeTestPart } from './test-part';

const WARM_UP = 50;
const REBUILDS = 1000;
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

  it('the leak control trips the same limit', () => {
    // biome-ignore lint/suspicious/noExplicitAny: raw bindings are untyped in this narrow view
    const raw = oc as any;
    const leakyCut = () => {
      const box = new raw.BRepPrimAPI_MakeBox(40, 30, 20);
      const point = new raw.gp_Pnt(20, 15, -1);
      const dir = new raw.gp_Dir(0, 0, 1);
      const axis = new raw.gp_Ax2(point, dir);
      const cylinder = new raw.BRepPrimAPI_MakeCylinder(axis, 4, 22);
      const progress = new raw.Message_ProgressRange();
      const cut = new raw.BRepAlgoAPI_Cut(box.Shape(), cylinder.Shape(), progress);
      // No cut.Clear() before delete(): this is the leak.
      for (const o of [cut, progress, cylinder, axis, dir, point, box]) o.delete();
    };
    for (let i = 0; i < WARM_UP; i++) leakyCut();
    const before = kernel.stats().heapTop;
    for (let i = 0; i < 300; i++) leakyCut();
    expect(kernel.stats().heapTop - before).toBeGreaterThan(LIMIT_BYTES);
  });
});
