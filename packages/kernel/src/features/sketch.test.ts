import {
  type FeatureId,
  originPlaneRef,
  type SketchData,
  type SketchEntityId,
  sketchInputs,
} from '@extrudo/core';
import { gear, SketchBuilder } from '@extrudo/sketch/fixtures';
import { detectProfiles, PROFILE_TOLERANCE } from '@extrudo/sketch/profiles';
import { beforeAll, describe, expect, it } from 'vitest';
import { Kernel } from '../kernel';
import { loadOcct } from '../occt/load';
import type { PlanarFrame } from '../planar';
import { RecomputeEngine } from '../recompute/engine';
import { testDocument, testFeature, testFeatures } from '../recompute/testing';
import { planarCurves, profileFaceIds, type SketchOutputData } from './sketch';

let kernel: Kernel;

beforeAll(async () => {
  kernel = new Kernel(await loadOcct());
});

const XY: PlanarFrame = { origin: [0, 0, 0], x: [1, 0, 0], normal: [0, 0, 1] };
const PI = Math.PI;

function rect(b: SketchBuilder, x: number, y: number, w: number, h: number) {
  b.line(x, y, x + w, y);
  b.line(x + w, y, x + w, y + h);
  b.line(x + w, y + h, x, y + h);
  b.line(x, y + h, x, y);
}

/** The sketches of detectProfiles' tests (profiles.test.ts), and a few more. */
const CASES: Record<string, (b: SketchBuilder) => void> = {
  'open curves': (b) => {
    b.line(0, 0, 10, 0);
    b.line(10, 0, 10, 10);
    b.arc(0, 0, 5, 90, 180);
  },
  rectangle: (b) => rect(b, 0, 0, 20, 10),
  'rectangle drawn clockwise': (b) => {
    b.line(0, 0, 0, 10);
    b.line(0, 10, 20, 10);
    b.line(20, 10, 20, 0);
    b.line(20, 0, 0, 0);
  },
  'circle, ellipse and slot': (b) => {
    b.circle(0, 0, 5);
    b.ellipse(50, 0, 8, 3, 30);
    b.line(100, 0, 120, 0);
    b.arc(120, 5, 5, -90, 90);
    b.line(120, 10, 100, 10);
    b.arc(100, 5, 5, 90, 270);
  },
  'spline closed by a line': (b) => {
    b.line(0, 0, 30, 0);
    b.spline([
      [30, 0],
      [20, 10],
      [10, 8],
      [0, 0],
    ]);
  },
  'construction and points': (b) => {
    rect(b, 0, 0, 10, 10);
    b.line(0, 0, 10, 10, true);
    b.point(5, 5);
  },
  'crossing line': (b) => {
    rect(b, 0, 0, 20, 10);
    b.line(5, -5, 5, 15);
  },
  'dangling line': (b) => {
    rect(b, 0, 0, 20, 10);
    b.line(0, 5, 8, 5);
    b.line(8, 5, 8, 2);
  },
  'overlapping rectangles': (b) => {
    rect(b, 0, 0, 20, 10);
    rect(b, 10, 5, 20, 10);
  },
  'overlapping circles': (b) => {
    b.circle(0, 0, 10);
    b.circle(10, 0, 10);
  },
  'circle inside a rectangle': (b) => {
    rect(b, 0, 0, 40, 20);
    b.circle(10, 10, 5);
  },
  'three deep': (b) => {
    rect(b, -50, -50, 100, 100);
    b.circle(0, 0, 30);
    rect(b, -5, -5, 10, 10);
  },
  'side-by-side holes': (b) => {
    rect(b, 0, 0, 60, 20);
    b.circle(10, 10, 4);
    b.circle(30, 10, 4);
    rect(b, 45, 5, 10, 10);
  },
  'bridge to a hole': (b) => {
    rect(b, 0, 0, 40, 40);
    rect(b, 10, 10, 20, 20);
    b.line(0, 20, 10, 20);
  },
  'circle touching a side from inside': (b) => {
    rect(b, 0, 0, 40, 20);
    b.circle(25, 8, 8);
  },
  'tangent circles': (b) => {
    b.circle(0, 0, 10);
    b.circle(5, 0, 5);
  },
  'figure eight': (b) => {
    b.circle(0, 0, 5);
    b.circle(10, 0, 5);
  },
  'T-junction': (b) => {
    rect(b, 0, 0, 20, 10);
    b.line(8, 0, 8, 10);
  },
  'overlapping collinear lines': (b) => {
    rect(b, 0, 0, 20, 10);
    b.line(-5, 0, 25, 0);
  },
  'circle cut at one point': (b) => {
    b.circle(0, 0, 10);
    b.line(10, 0, 20, 0);
    b.line(20, 0, 20, 10);
    b.line(20, 10, 10, 0);
  },
  'two lines across': (b) => {
    rect(b, 0, 0, 30, 10);
    b.line(10, -5, 10, 15);
    b.line(20, -5, 20, 15);
  },
  'spline weaving across a line': (b) => {
    b.line(0, 0, 40, 0);
    b.spline([
      [0, 0],
      [10, 5],
      [20, -5],
      [30, 5],
      [40, 0],
    ]);
  },
  'benchmark B1 plate': (b) => {
    rect(b, 0, 0, 120, 80);
    for (const [x, y] of [
      [25, 5],
      [95, 5],
      [25, 75],
      [95, 75],
    ] as const) {
      b.circle(x, y + (y < 40 ? 10 : -10), 3);
    }
  },
  'rounded rectangle': (b) => {
    b.line(5, 0, 35, 0);
    b.arc(35, 5, 5, -90, 0);
    b.line(40, 5, 40, 15);
    b.arc(35, 15, 5, 0, 90);
    b.line(35, 20, 5, 20);
    b.arc(5, 15, 5, 90, 180);
    b.line(0, 15, 0, 5);
    b.arc(5, 5, 5, 180, 270);
  },
  'ellipse crossing a rectangle': (b) => {
    rect(b, 0, 0, 30, 20);
    b.ellipse(30, 10, 12, 6, 20);
  },
  'arc and chord (D shape)': (b) => {
    b.arc(0, 0, 10, 0, 180);
    b.line(-10, 0, 10, 0);
  },
  'touching holes': (b) => {
    rect(b, 0, 0, 40, 20);
    b.circle(10, 10, 4);
    b.circle(18, 10, 4);
  },
  'spline crossing itself': (b) => {
    b.spline([
      [0, 0],
      [20, 10],
      [20, -10],
      [0, 10],
      [-5, 20],
    ]);
  },
};

/** Cases with an ellipse or a spline, which the arrangement draws as polylines. */
const POLYLINES = new Set([
  'circle, ellipse and slot',
  'spline closed by a line',
  'spline weaving across a line',
  'ellipse crossing a rectangle',
  'spline crossing itself',
]);

function build(make: (b: SketchBuilder) => void): SketchData {
  const b = new SketchBuilder();
  make(b);
  return b.sketch;
}

function kernelProfiles(data: SketchData, frame = XY) {
  const { curves, ids } = planarCurves(data);
  const { faces, skipped } = kernel.planarFaces(curves, frame, PROFILE_TOLERANCE);
  const { ids: regionIds, reassigned } = profileFaceIds(faces, ids, data);
  const out = faces.map((face, i) => ({
    ...face,
    id: regionIds[i] as string,
    valid: kernel.isValid(face.shape),
    bbox: kernel.measure(face.shape).bbox,
  }));
  kernel.release(...faces.map((f) => f.shape));
  return { faces: out, skipped, reassigned, ids };
}

describe('sketch profiles in the kernel', () => {
  it.each(Object.keys(CASES))('agree with detectProfiles: %s', (name) => {
    const data = build(CASES[name] as (b: SketchBuilder) => void);
    const detected = detectProfiles(data);
    const { faces, reassigned } = kernelProfiles(data);

    // The same regions under the same IDs, found from the faces' own loops.
    expect(reassigned).toBe(0);
    expect(faces.map((f) => f.id).sort()).toEqual(detected.map((p) => p.id).sort());
    for (const face of faces) {
      const region = detected.find((p) => p.id === face.id);
      expect(face.valid).toBe(true);
      expect(face.holes).toBe(region?.holes.length);
      // Exact for lines and arcs; the arrangement's ellipses and splines are
      // polylines (16 segments per spline span).
      const ratio = face.area / (region?.area ?? 0);
      expect(Math.abs(ratio - 1)).toBeLessThan(POLYLINES.has(name) ? 0.02 : 1e-9);
    }
    expect(kernel.stats().liveShapes).toBe(0);
  });

  it('makes exact faces: lines and arcs to 1e-9, an ellipse and a slot too', () => {
    const { faces } = kernelProfiles(build(CASES['circle, ellipse and slot'] as never));
    const areas = faces.map((f) => f.area).sort((a, b) => b - a);
    expect(areas).toEqual([
      expect.closeTo(200 + PI * 25, 9),
      expect.closeTo(PI * 25, 9),
      expect.closeTo(PI * 24, 9),
    ]);
    const { faces: plate } = kernelProfiles(build(CASES['circle inside a rectangle'] as never));
    expect(plate.find((f) => f.holes === 1)?.area).toBeCloseTo(800 - PI * 25, 9);
  });

  it('records the curve of every edge, and the directions around the outer loop', () => {
    const b = new SketchBuilder();
    b.line(0, 0, 0, 10);
    b.line(0, 10, 20, 10);
    b.line(20, 10, 20, 0);
    b.line(20, 0, 0, 0);
    const hole = b.circle(10, 5, 2);
    const { faces, ids } = kernelProfiles(b.sketch);
    const plate = faces.find((f) => f.holes === 1);
    expect(plate?.outer).toHaveLength(4);
    // Drawn clockwise: every side runs against its line.
    expect(plate?.outer.every((e) => e.reversed)).toBe(true);
    const sides = plate?.outer.map((e) => ids[e.curve]) ?? [];
    expect(plate?.edges.map((c) => ids[c]).sort()).toEqual([...sides, hole.id].sort());
  });

  it('finds a gear outline as one face', () => {
    const { builder } = gear({ teeth: 24 });
    const { faces } = kernelProfiles(builder.sketch);
    expect(faces).toHaveLength(1);
    expect(faces[0]?.valid).toBe(true);
    expect(faces[0]?.id).toBe(detectProfiles(builder.sketch)[0]?.id);
  });

  it('skips a line with no length', () => {
    const b = new SketchBuilder();
    rect(b, 0, 0, 10, 10);
    b.line(3, 3, 3, 3);
    const { faces, skipped } = kernelProfiles(b.sketch);
    expect(faces).toHaveLength(1);
    expect(skipped).toHaveLength(1);
  });

  it('places the faces in the sketch plane', () => {
    const data = build((b) => rect(b, 5, 0, 20, 10));
    // The XZ plane: sketch X is world X, sketch Y is world Z (ADR-0010).
    const xz = kernelProfiles(data, { origin: [0, 0, 0], x: [1, 0, 0], normal: [0, -1, 0] });
    expect(xz.faces[0]?.bbox.min).toEqual([5, 0, 0].map((v) => expect.closeTo(v, 6)));
    expect(xz.faces[0]?.bbox.max).toEqual([25, 0, 10].map((v) => expect.closeTo(v, 6)));
    // An offset, tilted frame.
    const s = Math.SQRT1_2;
    const tilted = kernelProfiles(data, { origin: [0, 0, 7], x: [s, s, 0], normal: [0, 0, 1] });
    expect(tilted.faces[0]?.bbox.min[2]).toBeCloseTo(7, 6);
    expect(tilted.faces[0]?.bbox.max[0]).toBeCloseTo(25 * s, 6);
    expect(tilted.faces[0]?.centroid).toEqual([expect.closeTo(15, 9), expect.closeTo(5, 9)]);
  });
});

describe('profileFaceIds', () => {
  it('gives a face whose own key names no region the ID of the region it covers', () => {
    const data = build(CASES['circle inside a rectangle'] as never);
    const { curves, ids } = planarCurves(data);
    const { faces } = kernel.planarFaces(curves, XY, PROFILE_TOLERANCE);
    kernel.release(...faces.map((f) => f.shape));
    const plate = faces.findIndex((f) => f.holes === 1);
    // Pretend the plate's loop ran the other way round one side.
    const tampered = faces.map((f, i) =>
      i === plate
        ? { ...f, outer: f.outer.map((e, k) => (k ? e : { ...e, reversed: !e.reversed })) }
        : f,
    );
    const expected = profileFaceIds(faces, ids, data);
    const result = profileFaceIds(tampered, ids, data);
    expect(result.reassigned).toBe(1);
    expect(result.ids).toEqual(expected.ids);
  });
});

describe('the sketch evaluator', () => {
  it('outputs a face per profile under its region ID, which a later feature reads', async () => {
    const b = new SketchBuilder();
    rect(b, 0, 0, 40, 20);
    b.circle(10, 10, 5);
    const detected = detectProfiles(b.sketch);
    const plate = detected.find((p) => p.holes.length === 1)?.id as string;
    const sketch = {
      ...testFeature('s1', 'sketch'),
      inputs: sketchInputs(originPlaneRef('origin:xz'), b.sketch),
    };
    const sheet = testFeature(
      'sheet',
      'test-sheet',
      {},
      {
        profile: { kind: 'ref', refs: [{ kind: 'profile', id: `s1/${plate}` }] },
      },
    );
    const engine = new RecomputeEngine(kernel, testFeatures().registry, { strictLeaks: true });
    const result = await engine.recompute({ doc: testDocument([sketch, sheet]) });
    if (result.status !== 'done') throw new Error('cancelled');
    expect(result.features).toEqual({ s1: { status: 'ok' }, sheet: { status: 'ok' } });
    // The plate with its hole, standing in the XZ plane.
    const mesh = result.bodies[0]?.mesh;
    expect(mesh?.faceRanges).toHaveLength(2);
    const ys = [...(mesh?.positions ?? [])].filter((_, i) => i % 3 === 1);
    expect(Math.max(...ys.map(Math.abs))).toBeLessThan(1e-6);
    expect(result.stats.liveShapes).toBe(engine.size.shapes);
    engine.clear();
    expect(kernel.stats().liveShapes).toBe(0);
  });

  it('re-evaluates a changed sketch and takes an undone one from the cache', async () => {
    const make = (w: number) => {
      const b = new SketchBuilder();
      rect(b, 0, 0, w, 20);
      return {
        ...testFeature('s1', 'sketch'),
        inputs: sketchInputs(originPlaneRef('origin:xy'), b.sketch),
      };
    };
    const engine = new RecomputeEngine(kernel, testFeatures().registry, { strictLeaks: true });
    const run = (w: number) => engine.recompute({ doc: testDocument([make(w)]) });
    await run(40);
    const second = await run(50);
    const back = await run(40);
    expect(second.status === 'done' && second.stats.evaluated).toEqual(['s1' as FeatureId]);
    expect(back.status === 'done' && back.stats.reused).toBe(1);
    engine.clear();
  });

  it('reports the plane, and each profile with the curves of its edges', async () => {
    const b = new SketchBuilder();
    const bottom = b.line(0, 0, 10, 0);
    b.line(10, 0, 10, 10);
    b.line(10, 10, 0, 0);
    const id = detectProfiles(b.sketch)[0]?.id as string;
    const sketch = {
      ...testFeature('s1', 'sketch'),
      inputs: sketchInputs(originPlaneRef('origin:yz'), b.sketch),
    };
    const sheet = testFeature(
      'sheet',
      'test-sheet',
      {},
      {
        profile: { kind: 'ref', refs: [{ kind: 'profile', id: `s1/${id}` }] },
      },
    );
    const { registry, seen } = testFeatures();
    const engine = new RecomputeEngine(kernel, registry, { strictLeaks: true });
    await engine.recompute({ doc: testDocument([sketch, sheet]) });
    const output = seen.at(-1);
    const data = output?.data as SketchOutputData;
    expect(data.frame.normal).toEqual([1, 0, 0]);
    expect(data.profiles).toEqual([
      {
        id,
        area: expect.closeTo(50, 9),
        holes: 0,
        edges: expect.arrayContaining([bottom.id as SketchEntityId]),
      },
    ]);
    expect(Object.keys(output?.shapes ?? {})).toEqual([id]);
    engine.clear();
  });

  it('fails a profile reference the sketch has no face for', async () => {
    const b = new SketchBuilder();
    rect(b, 0, 0, 10, 10);
    const sketch = {
      ...testFeature('s1', 'sketch'),
      inputs: sketchInputs(originPlaneRef('origin:xy'), b.sketch),
    };
    const sheet = testFeature(
      'sheet',
      'test-sheet',
      {},
      {
        profile: { kind: 'ref', refs: [{ kind: 'profile', id: 's1/nothing' }] },
      },
    );
    const engine = new RecomputeEngine(kernel, testFeatures().registry, { strictLeaks: true });
    const result = await engine.recompute({ doc: testDocument([sketch, sheet]) });
    expect(result.status === 'done' && result.features['sheet' as FeatureId]).toEqual({
      status: 'error',
      message: expect.stringMatching(/profile/),
    });
    engine.clear();
  });
});
