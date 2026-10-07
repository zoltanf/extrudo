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

/** An ellipse 2a × 2b at the origin with holes from `holes(s)`, returning their IDs. */
function ellipseWith(a: number, b: number, holes: (s: SketchBuilder) => string[][]) {
  const s = new SketchBuilder();
  const outer = s.ellipse(0, 0, a, b).id;
  const ids = holes(s);
  return { data: s.sketch, outer, holes: ids };
}

/** A slot's four curves (two lines, two arcs): straight sides 2·half long, round ends r. */
function slot(s: SketchBuilder, cx: number, cy: number, half: number, r: number): string[] {
  return [
    s.line(cx - half, cy - r, cx + half, cy - r).id,
    s.arc(cx + half, cy, r, -90, 90).id,
    s.line(cx + half, cy + r, cx - half, cy + r).id,
    s.arc(cx - half, cy, r, 90, 270).id,
  ];
}

/** Two round lobes (radius 8 about (±12, 0)) joined by a neck 2 mm wide whose
 * top side is a straight control spline, so the taper takes the loft. */
function dumbbell() {
  const s = new SketchBuilder();
  const x = 12 - Math.sqrt(63);
  const a = (Math.asin(1 / 8) * 180) / Math.PI;
  s.arc(-12, 0, 8, a, 360 - a);
  s.line(-x, -1, x, -1);
  s.arc(12, 0, 8, 180 + a, 540 - a);
  s.spline(
    [
      [x, 1],
      [x / 3, 1],
      [-x / 3, 1],
      [-x, 1],
    ],
    { mode: 'control' },
  );
  return { data: s.sketch };
}

/** A line, an arc and a fit spline: a square 20 × 20 whose left side is a half circle and right side a bulge. */
function mixed() {
  const s = new SketchBuilder();
  s.line(-10, -10, 10, -10);
  const spline = s.spline([
    [10, -10],
    [13, -3],
    [13, 3],
    [10, 10],
  ]).id;
  const line = s.line(10, 10, -10, 10).id;
  const arc = s.arc(-10, 0, 10, 90, 270).id;
  return { data: s.sketch, spline, line, arc };
}

/** Whether a face name is a wall made from sketch curve `id` (`side:<id>`, maybe `#n`). */
const sideOf = (name: string, id: string) => new RegExp(`:side:${id}(#\\d+)?$`).test(name);

/** The middle (x, y) of the box round the faces of `body` named from sketch curves `ids`. */
function wallCentre(result: Done, body: string, ids: string[]): [number, number] {
  const shape = bodyShapes.get(body) as ShapeHandle;
  const names = measure(result, body).names;
  const min = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
  const max = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
  let found = 0;
  names.forEach((name, index) => {
    if (!ids.some((id) => sideOf(name, id))) return;
    found += 1;
    const face = kernel.subShape(shape, 'face', index);
    try {
      const { bbox } = kernel.properties(face);
      for (const k of [0, 1]) {
        min[k] = Math.min(min[k] as number, bbox.min[k] as number);
        max[k] = Math.max(max[k] as number, bbox.max[k] as number);
      }
    } finally {
      kernel.release(face);
    }
  });
  if (found === 0) throw new Error(`no wall named from ${ids.join(', ')}`);
  return [
    ((min[0] as number) + (max[0] as number)) / 2,
    ((min[1] as number) + (max[1] as number)) / 2,
  ];
}

/** The area and perimeter of `body`'s face named `name`. */
function faceFacts(result: Done, body: string, name: string) {
  const shape = bodyShapes.get(body) as ShapeHandle;
  const index = measure(result, body).names.indexOf(name);
  if (index < 0) throw new Error(`no face ${name}`);
  const face = kernel.subShape(shape, 'face', index);
  try {
    const { area } = kernel.properties(face);
    let length = 0;
    for (let e = 0; e < kernel.count(face, 'edge'); e += 1) {
      const edge = kernel.subShape(face, 'edge', e);
      length += kernel.properties(edge).length;
      kernel.release(edge);
    }
    return { area, length };
  } finally {
    kernel.release(face);
  }
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
      // The ruled walls are about 0.07 % off the exact offset taper (ADR-0028).
      const start = faceFacts(result, 'E:0', 'extrude:E:cap:start');
      const exact = steinerVolume(start.area, start.length, 20, (degrees * Math.PI) / 180);
      expect(rel(m.volume, exact), `${degrees}°: ${m.volume} vs ${exact}`).toBeLessThan(2e-3);
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

  it('two equal holes in an ellipse: each hole keeps its own wall', async () => {
    const e = ellipseWith(20, 10, (s) => [[s.circle(-10, 0, 3).id], [s.circle(10, 0, 3).id]]);
    const result = await runWithShapes(
      testDocument([
        sketch('S', e.data),
        extrude('E', [profile('S', e.data)], { distance: '20 mm', taper: '5 deg' }),
      ]),
    );
    const s = status(result, 'E');
    expect(s.status, s.message).toBe('ok');
    // Steiner for the outline less two cones narrowing from radius 3.
    const g = Math.tan((5 * Math.PI) / 180);
    const exact =
      steinerVolume(Math.PI * 20 * 10, ramanujanPerimeter(20, 10), 20, (5 * Math.PI) / 180) -
      2 * ((Math.PI * 20) / 3) * (9 + 3 * (3 - 20 * g) + (3 - 20 * g) ** 2);
    const m = measure(result, 'E:0');
    expect(rel(m.volume, exact), `${m.volume} vs ${exact}`).toBeLessThan(1e-3);
    const [left, right] = e.holes as [string[], string[]];
    for (const [ids, x] of [
      [left, -10],
      [right, 10],
    ] as const) {
      expect(m.names.some((n) => ids.some((id) => sideOf(n, id)))).toBe(true);
      const [cx, cy] = wallCentre(result, 'E:0', [...ids]);
      expect(Math.hypot(cx - x, cy)).toBeLessThan(1e-3);
    }
  });

  it('a thin slot and a round hole at -5 degrees (their box areas swap ranks)', async () => {
    const e = ellipseWith(30, 15, (s) => [slot(s, -12, 0, 7, 1), [s.circle(12, 0, 3).id]]);
    const result = await runWithShapes(
      testDocument([
        sketch('S', e.data),
        extrude('E', [profile('S', e.data)], { distance: '20 mm', taper: '-5 deg' }),
      ]),
    );
    const s = status(result, 'E');
    expect(s.status, s.message).toBe('ok');
    // The outline shrinks by g·z, the slot and the hole grow by it.
    const g = Math.tan((5 * Math.PI) / 180);
    const L = 20;
    const slotArea = 4 * 7 * 1 + Math.PI;
    const slotPerimeter = 4 * 7 + 2 * Math.PI;
    const exact =
      (Math.PI * 30 * 15 - slotArea - Math.PI * 9) * L -
      ((ramanujanPerimeter(30, 15) + slotPerimeter + 2 * Math.PI * 3) * g * L * L) / 2 -
      (Math.PI * g * g * L ** 3) / 3;
    const m = measure(result, 'E:0');
    expect(rel(m.volume, exact), `${m.volume} vs ${exact}`).toBeLessThan(1e-3);
    const [slotIds, holeIds] = e.holes as [string[], string[]];
    const [sx, sy] = wallCentre(result, 'E:0', slotIds);
    expect(Math.hypot(sx + 12, sy)).toBeLessThan(1e-3);
    const [hx, hy] = wallCentre(result, 'E:0', holeIds);
    expect(Math.hypot(hx - 12, hy)).toBeLessThan(1e-3);
  });

  it('refuses a taper that pinches a dumbbell outline in two', async () => {
    const d = dumbbell();
    const result = await run(
      testDocument([
        sketch('S', d.data),
        extrude('E', [profile('S', d.data)], { distance: '20 mm', taper: '-5 deg' }),
      ]),
    );
    const s = status(result, 'E');
    expect(s.status).toBe('error');
    expect(s.message).toBe(
      'The taper pinches the outline in two: use a smaller angle or a shorter distance.',
    );
  });

  it('a profile of a line, an arc and a spline: the arc side is named from the arc', async () => {
    const p = mixed();
    const result = await runWithShapes(
      testDocument([
        sketch('S', p.data),
        extrude('E', [profile('S', p.data)], { distance: '20 mm', taper: '5 deg' }),
      ]),
    );
    const s = status(result, 'E');
    expect(s.status, s.message).toBe('ok');
    const m = measure(result, 'E:0');
    for (const id of [p.arc, p.spline, p.line]) {
      expect(
        m.names.some((n) => sideOf(n, id)),
        id,
      ).toBe(true);
    }
    // A convex outline: Steiner to the ruled walls' 2e-3.
    const start = faceFacts(result, 'E:0', 'extrude:E:cap:start');
    const exact = steinerVolume(start.area, start.length, 20, (5 * Math.PI) / 180);
    expect(rel(m.volume, exact), `${m.volume} vs ${exact}`).toBeLessThan(2e-3);
  });

  it('a negative taper that nearly closes an ellipse', async () => {
    // Ellipse 20 × 10 narrowed 20° over 10 mm: 3.64 mm in, past the ends'
    // radius of curvature (2.5 mm) but short of the minor semi-axis (5 mm).
    const e = ellipse(10, 5);
    const result = await runWithShapes(
      testDocument([
        sketch('S', e.data),
        extrude('E', [profile('S', e.data)], { distance: '10 mm', taper: '-20 deg' }),
      ]),
    );
    // The facade builds it (OCCT trims the offset's cusps at the major ends):
    // ok, and less than the straight extrude's volume.
    const s = status(result, 'E');
    expect(s.status, s.message).toBe('ok');
    const m = measure(result, 'E:0');
    expect(m.volume).toBeGreaterThan(0);
    expect(m.volume).toBeLessThan(Math.PI * 10 * 5 * 10);
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
