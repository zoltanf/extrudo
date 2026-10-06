// The emboss feature on cones, spheres, free-form faces and round the far
// side of a cylinder (P4-12, ADR-0060's amendment) through the recompute
// engine with real OCCT and strict leaks: a rectangle and a letter wrapped on a
// 20° cone (the exact development volume), a circle projected onto a sphere
// (the exact column between two spheres), a square projected onto a lofted
// B-spline side, the projection's refusals, a 300° wrap and a wrap past a whole
// turn. The flat and cylindrical cases stay in `emboss.test.ts`.
import {
  EMBOSS_TYPE,
  type EmbossInputOptions,
  type EmbossReport,
  embossInputs,
  type Feature,
  type FeatureId,
  FeatureRegistry,
  type FeatureStatus,
  type GeomRef,
  loftInputs,
  originPlaneRef,
  revolveInputs,
  type SketchData,
  type SketchEntity,
  type SketchEntityId,
  sketchInputs,
} from '@extrudo/core';
import { BUNDLED_FONTS, DEFAULT_FONT } from '@extrudo/fonts';
import { SketchBuilder } from '@extrudo/sketch/fixtures';
import { detectProfiles, profileCentroid } from '@extrudo/sketch/profiles';
import { loadFont } from '@extrudo/sketch/text';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import interRegular from '../../../fonts/fonts/inter-regular.ttf?url&inline';
import { Kernel, type ShapeHandle } from '../kernel';
import { loadOcct } from '../occt/load';
import { RecomputeEngine } from '../recompute/engine';
import { testDocument, testFeature, testFeatures } from '../recompute/testing';
import type { KernelFeatureDefinition, RecomputeResult } from '../recompute/types';
import type { EmbossOutputData } from './emboss';

let kernel: Kernel;
let engine: RecomputeEngine;
/** The `data` and `report` of the emboss feature's latest evaluation. */
const seen = new Map<string, { data: EmbossOutputData; report: EmbossReport }>();

function bytesOf(dataUrl: string): Uint8Array {
  const binary = atob(dataUrl.slice(dataUrl.indexOf(',') + 1));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

beforeAll(async () => {
  kernel = new Kernel(await loadOcct());
  expect(BUNDLED_FONTS.find((f) => f.id === DEFAULT_FONT)?.file).toBe('inter-regular.ttf');
  loadFont(DEFAULT_FONT, bytesOf(interRegular));
});

beforeEach(() => {
  engine?.clear();
  expect(kernel.stats().liveShapes).toBe(0);
  seen.clear();
  const registry = new FeatureRegistry<KernelFeatureDefinition>();
  for (const definition of testFeatures().registry.list()) {
    registry.register({
      ...definition,
      evaluate(ctx) {
        const output = definition.evaluate(ctx);
        if (ctx.feature.type === EMBOSS_TYPE) {
          seen.set(ctx.feature.id, {
            data: output.data as EmbossOutputData,
            report: output.report as EmbossReport,
          });
        }
        return output;
      },
    });
  }
  engine = new RecomputeEngine(kernel, registry, { strictLeaks: true });
});

afterAll(() => {
  engine.clear();
  expect(kernel.stats().liveShapes).toBe(0);
});

type Done = Extract<RecomputeResult, { status: 'done' }>;

// ------------------------------------------------------------------ helpers

const XY = originPlaneRef('origin:xy');
const XZ = originPlaneRef('origin:xz');
const AXIS_Z = { kind: 'axis', id: 'origin:z' } as const;

const refs = (list: GeomRef[]) => ({ kind: 'ref' as const, refs: list });
const length = (expr: string) => ({ kind: 'expr' as const, expr, unit: 'length' as const });

function feature(id: string, type: string, inputs: Feature['inputs'] = {}): Feature {
  return { ...testFeature(id, type), inputs };
}

function sketch(id: string, data: SketchData, plane: GeomRef = XY): Feature {
  return { ...testFeature(id, 'sketch'), inputs: sketchInputs(plane, data) };
}

function offsetPlane(id: string, plane: GeomRef, distance: string): [Feature, GeomRef] {
  const made = feature(id, 'offsetPlane', { plane: refs([plane]), distance: length(distance) });
  return [made, { kind: 'plane', id }];
}

function emboss(profiles: GeomRef[], face: GeomRef, options: EmbossInputOptions = {}): Feature {
  return { ...testFeature('EM', EMBOSS_TYPE), inputs: embossInputs(profiles, face, options) };
}

/** A sketch of one rectangle: its feature, its lines and its profile. */
function rectangle(
  id: string,
  plane: GeomRef,
  [x, y, w, h]: readonly [number, number, number, number],
): { feature: Feature; lines: string[]; profile: GeomRef } {
  const b = new SketchBuilder();
  const lines = [
    b.line(x, y, x + w, y).id,
    b.line(x + w, y, x + w, y + h).id,
    b.line(x + w, y + h, x, y + h).id,
    b.line(x, y + h, x, y).id,
  ];
  const [found] = detectProfiles(b.sketch);
  if (!found) throw new Error('no profile');
  return { feature: sketch(id, b.sketch, plane), lines, profile: profileOf(id, found.id) };
}

/** A sketch of one circle and its profile. */
function circle(id: string, plane: GeomRef, cx: number, cy: number, r: number) {
  const b = new SketchBuilder();
  b.circle(cx, cy, r);
  const [found] = detectProfiles(b.sketch);
  if (!found) throw new Error('no profile');
  return { feature: sketch(id, b.sketch, plane), profile: profileOf(id, found.id) };
}

const profileOf = (sketchId: string, region: string): GeomRef => ({
  kind: 'profile',
  id: `${sketchId}/${region}`,
});

async function run(features: Feature[]): Promise<Done> {
  const result = await engine.recompute({ doc: testDocument(features) });
  if (result.status !== 'done') throw new Error('cancelled');
  return result;
}

const status = (result: Done, id: string): FeatureStatus =>
  result.features[id as FeatureId] ?? { status: 'ok' };

function ok(result: Done): Done {
  for (const [id, s] of Object.entries(result.features)) {
    if (s.status !== 'ok') throw new Error(`${id}: ${s.status} ${s.message ?? ''}`);
  }
  return result;
}

function shapeOf(body: string) {
  const shape = engine.latestBody(body as never);
  if (shape === undefined) throw new Error(`no body ${body}`);
  const props = kernel.properties(shape);
  const solids = kernel.solids(shape);
  kernel.release(...solids);
  return {
    shape,
    volume: props.volume,
    faces: kernel.count(shape, 'face'),
    solids: solids.length,
    valid: kernel.isValid(shape),
  };
}

function faceNames(result: Done, body: string): string[] {
  return result.bodies.find((b) => b.id === body)?.mesh?.faceIds ?? [];
}

function solidAt(shape: ShapeHandle, at: readonly [number, number, number]): boolean {
  const h = 0.025;
  const probe = kernel.box([2 * h, 2 * h, 2 * h], [at[0] - h, at[1] - h, at[2] - h]);
  const common = kernel.common(shape, probe);
  const volume = kernel.measure(common.shape).volume;
  kernel.release(probe, common.shape);
  return volume > 1e-6;
}

const off = (value: number, exact: number) => Math.abs(value - exact) / Math.abs(exact);

// ------------------------------------------------------------------- the cone

const ALPHA = (20 * Math.PI) / 180;
/** The cone's radius at height z: 20 mm at z = 10, opening upwards by 20°. */
const coneRadius = (z: number) => 20 + (z - 10) * Math.tan(ALPHA);
const R0 = coneRadius(0);
const R1 = coneRadius(20);
const FRUSTUM = ((Math.PI * 20) / 3) * (R0 * R0 + R0 * R1 + R1 * R1);

/**
 * A frustum revolved about Z from an XZ trapezoid (body `R:0`), 20 mm tall, and
 * the name of its conical face (`revolve:R:side:<the slanted line>`).
 */
function frustum(): { features: Feature[]; face: GeomRef } {
  const b = new SketchBuilder();
  b.line(0, 0, R0, 0);
  const slant = b.line(R0, 0, R1, 20).id;
  b.line(R1, 20, 0, 20);
  b.line(0, 20, 0, 0);
  const [found] = detectProfiles(b.sketch);
  if (!found) throw new Error('no profile');
  return {
    features: [
      sketch('RS', b.sketch, XZ),
      feature('R', 'revolve', revolveInputs([profileOf('RS', found.id)], AXIS_Z)),
    ],
    face: { kind: 'face', id: `revolve:R:side:${slant}` },
  };
}

/**
 * The exact volume a profile of `area` mm² wrapped on the cone adds or takes
 * off: the frame is centred on its centroid's height, where the radius is `r`,
 * so `A d / r (r ± d cos α / 2)` (ADR-0060's amendment A1).
 */
const coneWant = (area: number, r: number, depth: number, outward = true) =>
  (area * depth * (r + ((outward ? 1 : -1) * depth * Math.cos(ALPHA)) / 2)) / r;

describe('emboss on a cone', { timeout: 300_000 }, () => {
  it('wraps a rectangle: the exact development volume, out and in, and the names', async () => {
    const cone = frustum();
    const p = rectangle('SK', XZ, [-5, 8, 10, 4]);
    for (const mode of ['emboss', 'deboss'] as const) {
      const result = ok(
        await run([...cone.features, p.feature, emboss([p.profile], cone.face, { mode })]),
      );
      const body = shapeOf('R:0');
      const tool = coneWant(40, coneRadius(10), 1, mode === 'emboss');
      expect(off(body.volume, FRUSTUM + (mode === 'emboss' ? tool : -tool))).toBeLessThan(1e-5);
      expect(body.valid).toBe(true);
      expect(body.solids).toBe(1);
      expect(seen.get('EM')?.report).toEqual({ kind: 'emboss', method: 'wrapped-cone' });
      const names = faceNames(result, 'R:0');
      expect(names).toContain('emboss:EM:cap:end');
      for (const line of p.lines) expect(names).toContain(`emboss:EM:side:${line}`);
      expect(new Set(names).size).toBe(names.length);
    }
  });

  it('wraps off the middle: the frame sits at the profile, the radius there', async () => {
    const cone = frustum();
    const p = rectangle('SK', XZ, [-3, 13, 6, 5]);
    ok(
      await run([...cone.features, p.feature, emboss([p.profile], cone.face, { depth: '0.5 mm' })]),
    );
    const want = coneWant(30, coneRadius(15.5), 0.5);
    expect(off(shapeOf('R:0').volume, FRUSTUM + want)).toBeLessThan(1e-5);
    // The letters stand out of the wall square to it: the arrow's direction is
    // the cone's outward normal, tilted 20° down from the radius.
    const data = seen.get('EM')?.data;
    expect(data?.direction[2]).toBeCloseTo(-Math.sin(ALPHA), 6);
  });

  it('wraps a letter o, keeping its counter open', async () => {
    const cone = frustum();
    const b = new SketchBuilder();
    const anchor = b.point(-3, 7);
    const top = b.point(-3, 13);
    const textId = b.id('t');
    const entity: SketchEntity = {
      type: 'text',
      anchor: anchor as SketchEntityId,
      top: top as SketchEntityId,
      text: 'o',
      font: DEFAULT_FONT,
      align: 'left',
      construction: false,
    };
    b.entities[textId] = entity;
    const ink = detectProfiles(b.sketch).filter((profile) => profile.text === textId);
    expect(ink).toHaveLength(1);
    const letter = ink[0] as (typeof ink)[number];
    const z = profileCentroid(letter)[1];
    ok(
      await run([
        ...cone.features,
        sketch('SK', b.sketch, XZ),
        emboss([{ kind: 'sketchEntity', id: `SK/${textId}` }], cone.face, { depth: '0.6 mm' }),
      ]),
    );
    const body = shapeOf('R:0');
    expect(body.valid).toBe(true);
    // The ink's own area is a polyline's (profile detection), so 1e-3.
    expect(off(body.volume, FRUSTUM + coneWant(letter.area, coneRadius(z), 0.6))).toBeLessThan(
      1e-3,
    );
    // The ring's centre, where the counter is, stays empty; its centre line
    // through the wall is solid.
    const data = seen.get('EM')?.data as EmbossOutputData;
    const at = (t: number) => data.origin.map((x, i) => x + t * (data.direction[i] ?? 0));
    expect(solidAt(body.shape, at(0.3) as [number, number, number])).toBe(false);
    expect(solidAt(body.shape, at(-0.3) as [number, number, number])).toBe(true);
  });

  it('refuses a sketch across the cone axis', async () => {
    const cone = frustum();
    const [plane, above] = offsetPlane('P', XY, '30 mm');
    const p = rectangle('SK', above, [-5, -2, 10, 4]);
    const result = await run([...cone.features, plane, p.feature, emboss([p.profile], cone.face)]);
    expect(status(result, 'EM')).toMatchObject({
      status: 'error',
      message: "Sketch on a plane parallel to the cone's axis to emboss on a round face.",
    });
  });
});

// ------------------------------------------------------------ the projection

const SPHERE: GeomRef = { kind: 'face', id: 'sphere:S:side:surface' };
const R = 20;
const BALL = ((4 * Math.PI) / 3) * R ** 3;
const sphereBody = () => feature('S', 'sphere', { diameter: length('40 mm') });

/** The column of radius `a` between two concentric spheres, on one side. */
function column(a: number, inner: number, outer: number): number {
  const cap = (r: number) => ((2 * Math.PI) / 3) * (r ** 3 - (r * r - a * a) ** 1.5);
  return cap(outer) - cap(inner);
}

describe('emboss projected onto a sphere', { timeout: 300_000 }, () => {
  it('projects a circle: the exact column between two spheres, out and in', async () => {
    const [plane, above] = offsetPlane('P', XY, '30 mm');
    const c = circle('SK', above, 0, 0, 5);
    for (const mode of ['emboss', 'deboss'] as const) {
      const result = ok(
        await run([sphereBody(), plane, c.feature, emboss([c.profile], SPHERE, { mode })]),
      );
      const body = shapeOf('S:0');
      const want = mode === 'emboss' ? BALL + column(5, R, R + 1) : BALL - column(5, R - 1, R);
      expect(off(body.volume, want)).toBeLessThan(1e-6);
      expect(body.valid).toBe(true);
      expect(body.solids).toBe(1);
      expect(seen.get('EM')?.report).toEqual({ kind: 'emboss', method: 'projected' });
      const names = faceNames(result, 'S:0');
      expect(names).toContain('emboss:EM:cap:end');
      expect(names.some((name) => name.startsWith("emboss:EM:side:"))).toBe(true);
      // On the top of the sphere, below the sketch.
      expect(seen.get('EM')?.data.origin[2]).toBeGreaterThan(R - 1);
    }
  });

  it('refuses profiles past the outline and profiles that miss the sphere', async () => {
    const [plane, above] = offsetPlane('P', XY, '30 mm');
    const past = circle('SK', above, 17, 0, 5);
    expect(
      status(await run([sphereBody(), plane, past.feature, emboss([past.profile], SPHERE)]), 'EM'),
    ).toMatchObject({
      status: 'error',
      message: "The profiles reach past the face's edge as seen from the sketch.",
    });
    const away = circle('SK', above, 40, 0, 5);
    expect(
      status(await run([sphereBody(), plane, away.feature, emboss([away.profile], SPHERE)]), 'EM'),
    ).toMatchObject({ status: 'error', message: "The profiles don't touch the face." });
  });
});

describe('emboss projected onto a free-form face', { timeout: 300_000 }, () => {
  it('projects a square onto a lofted side: four walls and a volume between the bounds', async () => {
    const bottom = new SketchBuilder();
    bottom.circle(0, 0, 20);
    const [lower] = detectProfiles(bottom.sketch);
    const [plane, high] = offsetPlane('P', XY, '30 mm');
    const topSketch = new SketchBuilder();
    topSketch.ellipse(3, 0, 26, 16);
    const [upper] = detectProfiles(topSketch.sketch);
    if (!lower || !upper) throw new Error('no profiles');
    const loft = feature(
      'LO',
      'loft',
      loftInputs([profileOf('L1', lower.id), profileOf('L2', upper.id)]),
    );
    const sections = [sketch('L1', bottom.sketch, XY), plane, sketch('L2', topSketch.sketch, high)];
    const before = ok(await run([...sections, loft]));
    const plain = shapeOf('LO:0');
    const side = faceNames(before, 'LO:0').find((name) => name.includes(':side:'));
    expect(side).toBeDefined();
    const face: GeomRef = { kind: 'face', id: side as string };
    const [front, aside] = offsetPlane('Q', XZ, '40 mm');
    const square = rectangle('SK', aside, [-4, 8, 8, 8]);
    for (const mode of ['emboss', 'deboss'] as const) {
      ok(
        await run([
          ...sections,
          loft,
          front,
          square.feature,
          emboss([square.profile], face, { mode }),
        ]),
      );
      const body = shapeOf('LO:0');
      expect(body.valid).toBe(true);
      // The cap on the face merges into it: one cap more and four walls.
      expect(body.faces).toBe(plain.faces + 5);
      // 1 mm along the normal is at least 1 mm along the ray, at most 1 / cos of the slope.
      const change = Math.abs(body.volume - plain.volume);
      expect(change).toBeGreaterThan(64 * 0.9);
      expect(change).toBeLessThan(64 * 1.3);
      expect(seen.get('EM')?.report.method).toBe('projected');
    }
  });
});

// ------------------------------------------------ round the far side of a cylinder

const cylinder = () =>
  feature('C', 'cylinder', { diameter: length('40 mm'), height: length('20 mm') });
const WALL: GeomRef = { kind: 'face', id: 'cylinder:C:side:wall' };

describe('emboss more than half way round a cylinder', { timeout: 300_000 }, () => {
  it('wraps 300 degrees from the sketch to one side, out and in', async () => {
    const width = (300 / 180) * Math.PI * R;
    const p = rectangle('SK', XZ, [0, 8, width, 4]);
    for (const mode of ['emboss', 'deboss'] as const) {
      ok(await run([cylinder(), p.feature, emboss([p.profile], WALL, { mode })]));
      const body = shapeOf('C:0');
      const tool = width * 4 * ((mode === 'emboss' ? R + 0.5 : R - 0.5) / R);
      const plain = Math.PI * R * R * 20;
      expect(off(body.volume, plain + (mode === 'emboss' ? tool : -tool))).toBeLessThan(1e-6);
      expect(body.valid).toBe(true);
      expect(body.solids).toBe(1);
      expect(seen.get('EM')?.report.method).toBe('wrapped-cylinder');
    }
  });

  it('refuses a profile wider than the circumference', async () => {
    const p = rectangle('SK', XZ, [0, 8, 2 * Math.PI * R + 1, 4]);
    const result = await run([cylinder(), p.feature, emboss([p.profile], WALL)]);
    expect(status(result, 'EM')).toMatchObject({
      status: 'error',
      message: "The profile is wider than the face's circumference.",
    });
  });
});
