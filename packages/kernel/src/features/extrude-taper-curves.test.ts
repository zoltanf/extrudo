// P4-12's taper on ellipse and spline sides (ADR-0028's amendment): a profile
// with an ellipse or B-spline edge is tapered by a ruled loft between the
// profile and its 2D offset, through real OCCT with strict leaks. The
// DraftAngle route (lines and arcs) is unchanged; `extrude.test.ts` covers it.
import {
  type ExtrudoDocument,
  extrudeInputs,
  type Feature,
  type FeatureId,
  FeatureRegistry,
  type FeatureStatus,
  type GeomRef,
  originPlaneRef,
  type SketchData,
  sketchInputs,
} from '@extrudo/core';
import { SketchBuilder } from '@extrudo/sketch/fixtures';
import { detectProfiles, type Profile } from '@extrudo/sketch/profiles';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Kernel, type ShapeHandle } from '../kernel';
import { loadOcct } from '../occt/load';
import { RecomputeEngine } from '../recompute/engine';
import { testDocument, testFeature, testFeatures } from '../recompute/testing';
import type { KernelFeatureDefinition, RecomputeResult } from '../recompute/types';

let kernel: Kernel;
let engine: RecomputeEngine;

beforeAll(async () => {
  kernel = new Kernel(await loadOcct());
});

beforeEach(() => {
  engine?.clear();
  expect(kernel.stats().liveShapes).toBe(0);
  const registry = new FeatureRegistry<KernelFeatureDefinition>();
  for (const definition of testFeatures().registry.list()) registry.register(definition);
  engine = new RecomputeEngine(kernel, registry, { strictLeaks: true });
});

afterAll(() => {
  engine.clear();
  expect(kernel.stats().liveShapes).toBe(0);
});

type Done = Extract<RecomputeResult, { status: 'done' }>;

function sketch(
  id: string,
  data: SketchData,
  plane: GeomRef = originPlaneRef('origin:xy'),
): Feature {
  return { ...testFeature(id, 'sketch'), inputs: sketchInputs(plane, data) };
}

/** A construction plane `distance` above `plane` (ADR-0040). */
function offsetPlane(id: string, plane: GeomRef, distance: string): Feature {
  return {
    ...testFeature(id, 'offsetPlane'),
    inputs: {
      plane: { kind: 'ref', refs: [plane] },
      distance: { kind: 'expr', expr: distance, unit: 'length' },
    },
  };
}

/** A reference to the largest profile of `data` in `sketchId`. */
function profile(sketchId: string, data: SketchData): GeomRef {
  const found = detectProfiles(data).sort((a, b) => b.area - a.area)[0] as Profile | undefined;
  if (!found) throw new Error('no profile');
  return { kind: 'profile', id: `${sketchId}/${found.id}` };
}

function extrude(id: string, profiles: GeomRef[], options: Record<string, unknown>): Feature {
  return { ...testFeature(id, 'extrude'), inputs: extrudeInputs(profiles, options as never) };
}

async function run(doc: ExtrudoDocument): Promise<Done> {
  const result = await engine.recompute({ doc });
  if (result.status !== 'done') throw new Error('cancelled');
  return result;
}

const status = (result: Done, id: string): FeatureStatus =>
  result.features[id as FeatureId] ?? { status: 'ok' };

const bodyShapes = new Map<string, ShapeHandle>();

async function runWithShapes(doc: ExtrudoDocument): Promise<Done> {
  bodyShapes.clear();
  const shapes: ShapeHandle[] = [];
  const mesh = kernel.mesh.bind(kernel);
  kernel.mesh = (shape, options) => {
    shapes.push(shape);
    return mesh(shape, options);
  };
  try {
    const result = await run(doc);
    result.bodies.forEach((b, i) => {
      const shape = shapes[i];
      if (shape !== undefined) bodyShapes.set(b.id, shape);
    });
    return result;
  } finally {
    kernel.mesh = mesh;
  }
}

function measure(result: Done, body: string) {
  const found = result.bodies.find((b) => b.id === body);
  const shape = bodyShapes.get(body) as ShapeHandle | undefined;
  if (!found || shape === undefined) throw new Error(`no body ${body}`);
  const m = kernel.measure(shape);
  return {
    volume: m.volume,
    faces: kernel.count(shape, 'face'),
    names: found.mesh?.faceIds ?? [],
  };
}

/** The names of the faces of `body` made by feature `E` (any role). */
const extrudeFaces = (result: Done, body: string) =>
  measure(result, body).names.filter((n) => n.includes(':E:'));

/** The perimeter of an ellipse, by Ramanujan's approximation. */
function ramanujanPerimeter(a: number, b: number) {
  const hh = (a - b) ** 2 / (a + b) ** 2;
  return Math.PI * (a + b) * (1 + (3 * hh) / (10 + Math.sqrt(4 - 3 * hh)));
}

/** A tapered loft's caps are named like a prism's: status ok, the Steiner
 * volume, both caps and one `side:` wall face per profile edge. */
function expectPrismNames(result: Done, ellipseId: string, exact: number) {
  const s = status(result, 'E');
  expect(s.status, s.message).toBe('ok');
  const m = measure(result, 'E:0');
  expect(rel(m.volume, exact), `${m.volume} vs ${exact}`).toBeLessThan(1e-4);
  const names = extrudeFaces(result, 'E:0');
  expect(names).toContain('extrude:E:cap:start');
  expect(names).toContain('extrude:E:cap:end');
  expect(names.filter((n) => n.includes(':side:'))).toHaveLength(4);
  expect(names.some((n) => n.includes(`:side:${ellipseId}`))).toBe(true);
}

const rel = (got: number, want: number) => Math.abs(got - want) / Math.max(1, Math.abs(want));

// --------------------------------------------------------------- profiles

/** An ellipse of semi-axes a × b, centred at (cx, cy) (default the origin), on XY. */
function ellipse(a: number, b: number, cx = 0, cy = 0) {
  const s = new SketchBuilder();
  const id = s.ellipse(cx, cy, a, b).id;
  return { data: s.sketch, ellipse: id };
}

/** A smooth closed control-point B-spline (a wavy ring) on XY. */
function spline(radius: number, wave: number) {
  const s = new SketchBuilder();
  const points: [number, number][] = [];
  for (let i = 0; i < 8; i += 1) {
    const a = (2 * Math.PI * i) / 8;
    const r = radius + wave * Math.sin(3 * a);
    points.push([r * Math.cos(a), r * Math.sin(a)]);
  }
  const id = s.spline(points, { mode: 'control', closed: true }).id;
  return { data: s.sketch, spline: id };
}

/** The spline ring with a circular hole at its centre. */
function splineHole(radius: number, wave: number, hole: number) {
  const s = new SketchBuilder();
  const points: [number, number][] = [];
  for (let i = 0; i < 8; i += 1) {
    const a = (2 * Math.PI * i) / 8;
    const r = radius + wave * Math.sin(3 * a);
    points.push([r * Math.cos(a), r * Math.sin(a)]);
  }
  s.spline(points, { mode: 'control', closed: true });
  const circle = s.circle(0, 0, hole).id;
  return { data: s.sketch, circle };
}

/** The exact volume a ruled loft between the profile and its offset approaches:
 * the Steiner area A + P d + π d², integrated over the height (for an ellipse
 * the ruled loft matches this to ~1e-7). */
function steinerVolume(area: number, perimeter: number, length: number, taper: number) {
  const t = Math.tan(taper);
  return (
    area * length + (perimeter * t * length * length) / 2 + (Math.PI * t * t * length ** 3) / 3
  );
}

describe('extrude taper on curves', { timeout: 120_000 }, () => {
  it('an ellipse profile tapered 10 degrees by a ruled loft, named like a prism', async () => {
    const e = ellipse(20, 10);
    const r = (10 * Math.PI) / 180;
    const result = await runWithShapes(
      testDocument([
        sketch('S', e.data),
        extrude('E', [profile('S', e.data)], { distance: '20 mm', taper: '10 deg' }),
      ]),
    );
    const s = status(result, 'E');
    expect(s.status, s.message).toBe('ok');
    const m = measure(result, 'E:0');
    // Ellipse 20 × 10: area = π·a·b, perimeter by Ramanujan.
    const a = 20;
    const b = 10;
    const hh = (a - b) ** 2 / (a + b) ** 2;
    const perimeter = Math.PI * (a + b) * (1 + (3 * hh) / (10 + Math.sqrt(4 - 3 * hh)));
    const exact = steinerVolume(Math.PI * a * b, perimeter, 20, r);
    expect(rel(m.volume, exact), `${m.volume} vs ${exact}`).toBeLessThan(1e-4);
    const names = extrudeFaces(result, 'E:0');
    expect(names).toContain('extrude:E:cap:start');
    expect(names).toContain('extrude:E:cap:end');
    expect(names.filter((n) => n.includes(':side:'))).toHaveLength(4);
    expect(names.some((n) => n.includes(`:side:${e.ellipse}`))).toBe(true);
  });

  it('an ellipse drawn far from the sketch origin keeps its cap names', async () => {
    const e = ellipse(20, 10, 200, 150);
    const exact = steinerVolume(
      Math.PI * 20 * 10,
      ramanujanPerimeter(20, 10),
      20,
      (10 * Math.PI) / 180,
    );
    const result = await runWithShapes(
      testDocument([
        sketch('S', e.data),
        extrude('E', [profile('S', e.data)], { distance: '20 mm', taper: '10 deg' }),
      ]),
    );
    expectPrismNames(result, e.ellipse, exact);
  });

  it('the same taper on a construction plane 30 mm above XY', async () => {
    const e = ellipse(20, 10, 200, 150);
    const exact = steinerVolume(
      Math.PI * 20 * 10,
      ramanujanPerimeter(20, 10),
      20,
      (10 * Math.PI) / 180,
    );
    const result = await runWithShapes(
      testDocument([
        offsetPlane('OP', originPlaneRef('origin:xy'), '30 mm'),
        sketch('S', e.data, { kind: 'plane', id: 'OP' }),
        extrude('E', [profile('S', e.data)], { distance: '20 mm', taper: '10 deg' }),
      ]),
    );
    expectPrismNames(result, e.ellipse, exact);
  });

  it('a control spline outline tapered both ways', async () => {
    const sp = spline(20, 2);
    for (const degrees of [8, -8]) {
      const result = await runWithShapes(
        testDocument([
          sketch('S', sp.data),
          extrude('E', [profile('S', sp.data)], { distance: '20 mm', taper: `${degrees} deg` }),
        ]),
      );
      const s = status(result, 'E');
      expect(s.status, s.message).toBe('ok');
      const m = measure(result, 'E:0');
      expect(m.volume).toBeGreaterThan(0);
      expect(m.names.some((n) => n.includes(`:side:${sp.spline}`))).toBe(true);
    }
  });

  it('a spline outline with a circular hole: the hole wall is named from its circle', async () => {
    const sp = splineHole(30, 1, 5);
    const result = await runWithShapes(
      testDocument([
        sketch('S', sp.data),
        extrude('E', [profile('S', sp.data)], { distance: '20 mm', taper: '3 deg' }),
      ]),
    );
    const s = status(result, 'E');
    expect(s.status, s.message).toBe('ok');
    const names = extrudeFaces(result, 'E:0');
    expect(names.some((n) => n.includes(`:side:${sp.circle}`))).toBe(true);
  });

  it('refuses a taper that shrinks the outline to nothing', async () => {
    const e = ellipse(10, 5);
    const result = await run(
      testDocument([
        sketch('S', e.data),
        extrude('E', [profile('S', e.data)], { distance: '20 mm', taper: '-45 deg' }),
      ]),
    );
    const s = status(result, 'E');
    expect(s.status).toBe('error');
    expect(s.message).toContain('too steep for this outline');
  });

  it('refuses a taper that closes a hole', async () => {
    const sp = splineHole(30, 1, 4);
    const result = await run(
      testDocument([
        sketch('S', sp.data),
        extrude('E', [profile('S', sp.data)], { distance: '20 mm', taper: '15 deg' }),
      ]),
    );
    const s = status(result, 'E');
    expect(s.status).toBe('error');
    expect(s.message).toContain('closes a hole');
  });

  it('a symmetric and a two-sided taper', async () => {
    const e = ellipse(20, 10);
    for (const options of [
      { direction: 'symmetric', distance: '20 mm', taper: '5 deg' },
      {
        direction: 'two-sides',
        distance: '12 mm',
        taper: '5 deg',
        distance2: '8 mm',
        taper2: '-4 deg',
      },
    ]) {
      const result = await runWithShapes(
        testDocument([sketch('S', e.data), extrude('E', [profile('S', e.data)], options)]),
      );
      const s = status(result, 'E');
      expect(s.status, s.message).toBe('ok');
      const m = measure(result, 'E:0');
      expect(m.volume).toBeGreaterThan(0);
    }
  });
});
