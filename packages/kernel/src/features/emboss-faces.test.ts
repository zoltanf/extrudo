// The emboss feature on cones, spheres, free-form faces and round the far
// side of a cylinder (P4-12, ADR-0060's amendment) through the recompute
// engine with real OCCT and strict leaks: a rectangle and a letter wrapped on a
// 20° cone (the exact development volume), a circle projected onto a sphere
// (the exact column between two spheres), a square projected onto a lofted
// B-spline side, the projection's refusals, a 300° wrap and a wrap past a whole
// turn. The flat and cylindrical cases stay in `emboss.test.ts`.
import {
  type ConstructionReport,
  constructionRef,
  EMBOSS_FACE_ROLES,
  EMBOSS_TYPE,
  type EmbossInputOptions,
  type EmbossReport,
  embossInputs,
  extrudeInputs,
  type Feature,
  type FeatureId,
  FeatureRegistry,
  type FeatureStatus,
  faceRoleIssues,
  filletInputs,
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
import { edgeName } from '../naming/topo-id';
import { loadOcct } from '../occt/load';
import { RecomputeEngine } from '../recompute/engine';
import { testDocument, testFeature, testFeatures } from '../recompute/testing';
import type { KernelFeatureDefinition, RecomputeResult } from '../recompute/types';
import type { EmbossOutputData } from './emboss';

let kernel: Kernel;
let engine: RecomputeEngine;
/** The `data` and `report` of the emboss feature's latest evaluation. */
const seen = new Map<string, { data: EmbossOutputData; report: EmbossReport }>();
/** Construction planes' reports, by feature id (the tangent plane's frame). */
const planes = new Map<string, Extract<ConstructionReport, { kind: 'plane' }>>();

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
  planes.clear();
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
        const report = output.report as ConstructionReport | undefined;
        if (report?.kind === 'plane') planes.set(ctx.feature.id, report);
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
const YZ = originPlaneRef('origin:yz');
const AXIS_Z = { kind: 'axis', id: 'origin:z' } as const;
const AXIS_X = { kind: 'axis', id: 'origin:x' } as const;

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

function emboss(
  profiles: GeomRef[],
  face: GeomRef | GeomRef[],
  options: EmbossInputOptions = {},
): Feature {
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
      expect(seen.get('EM')?.report).toEqual({
        kind: 'emboss',
        method: 'wrapped-cone',
        faces: ['wrapped-cone'],
      });
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

  it('wraps a sketch on the cone’s tangent plane, out and in', async () => {
    const cone = frustum();
    const tp = feature('TP', 'tangentPlane', { face: refs([cone.face]) });
    const plane = constructionRef(tp) as GeomRef;
    ok(await run([...cone.features, tp]));
    // A sketch's origin is the plane report's frame origin (the world origin's
    // foot on the plane), which for this frustum lies below the body — so the
    // rectangle is centred on the report's anchor (the touching point) instead,
    // in the sketch's own coordinates.
    const report = planes.get('TP');
    if (!report) throw new Error('no tangent plane report');
    const { frame, anchor } = report;
    const dot3 = (a: readonly number[], b: readonly number[]) =>
      (a[0] ?? 0) * (b[0] ?? 0) + (a[1] ?? 0) * (b[1] ?? 0) + (a[2] ?? 0) * (b[2] ?? 0);
    const cx = dot3(
      [anchor[0] - frame.origin[0], anchor[1] - frame.origin[1], anchor[2] - frame.origin[2]],
      frame.x,
    );
    const cy = dot3(
      [anchor[0] - frame.origin[0], anchor[1] - frame.origin[1], anchor[2] - frame.origin[2]],
      frame.y,
    );
    const p = rectangle('SK', plane, [cx - 5, cy - 2, 10, 4]);
    for (const mode of ['emboss', 'deboss'] as const) {
      const result = ok(
        await run([...cone.features, tp, p.feature, emboss([p.profile], cone.face, { mode })]),
      );
      const body = shapeOf('R:0');
      const zc = anchor[2];
      const tool = coneWant(40, coneRadius(zc), 1, mode === 'emboss');
      expect(off(body.volume, FRUSTUM + (mode === 'emboss' ? tool : -tool))).toBeLessThan(1e-6);
      expect(body.valid).toBe(true);
      expect(body.solids).toBe(1);
      expect(seen.get('EM')?.report).toEqual({
        kind: 'emboss',
        method: 'wrapped-cone',
        faces: ['wrapped-cone'],
      });
      const names = faceNames(result, 'R:0');
      expect(names).toContain('emboss:EM:cap:end');
      for (const line of p.lines) expect(names).toContain(`emboss:EM:side:${line}`);
      expect(new Set(names).size).toBe(names.length);
      // The tool's centre sits at the touching generatrix's angle.
      const data = seen.get('EM')?.data;
      if (!data) throw new Error('no emboss data');
      expect(Math.atan2(data.origin[1], data.origin[0])).toBeCloseTo(
        Math.atan2(anchor[1], anchor[0]),
        9,
      );
    }
  });

  it('refuses a sketch across the cone axis', async () => {
    const cone = frustum();
    const [plane, above] = offsetPlane('P', XY, '30 mm');
    const p = rectangle('SK', above, [-5, -2, 10, 4]);
    const result = await run([...cone.features, plane, p.feature, emboss([p.profile], cone.face)]);
    expect(status(result, 'EM')).toMatchObject({
      status: 'error',
      message:
        "Sketch on a plane parallel to the cone's axis, or to one of its tangent planes, to emboss on a round face.",
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
      expect(seen.get('EM')?.report).toEqual({
        kind: 'emboss',
        method: 'projected',
        faces: ['projected'],
      });
      const names = faceNames(result, 'S:0');
      expect(names).toContain('emboss:EM:cap:end');
      expect(names.some((name) => name.startsWith('emboss:EM:side:'))).toBe(true);
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

// ------------------------------------------------- tangent to the face (S3)

const SQRT_HALF = Math.SQRT1_2;
/** The largest componentwise difference of two vectors. */
const apart = (a: readonly number[], b: readonly number[]) =>
  Math.max(...a.map((x, i) => Math.abs(x - (b[i] as number))));
const angle = (expr: string) => ({ kind: 'expr' as const, expr, unit: 'angle' as const });

/**
 * A 40 mm prism extruded along +X from a YZ sketch: (0,0) → (40,0) → (40,10) →
 * (30,20) → (0,20), so the slanted 45° chamfer's face is `extrude:E:side:<slant>`
 * (outward normal (0, √½, √½)). Body volume 30000.
 */
function chamferBody(): { features: Feature[]; chamfer: GeomRef; slant: string } {
  const b = new SketchBuilder();
  b.line(0, 0, 40, 0);
  b.line(40, 0, 40, 10);
  const slant = b.line(40, 10, 30, 20).id;
  b.line(30, 20, 0, 20);
  b.line(0, 20, 0, 0);
  const [found] = detectProfiles(b.sketch);
  if (!found) throw new Error('no profile');
  return {
    features: [
      sketch('EK', b.sketch, YZ),
      feature('E', 'extrude', extrudeInputs([profileOf('EK', found.id)], { distance: '40 mm' })),
    ],
    chamfer: { kind: 'face', id: `extrude:E:side:${slant}` },
    slant,
  };
}

describe('emboss tangent to the face', { timeout: 300_000 }, () => {
  it('folds a level sketch onto a 45° chamfer, out and in', async () => {
    const body = chamferBody();
    const [plane, above] = offsetPlane('P', XY, '30 mm');
    const p = rectangle('SK', above, [15, 33, 10, 4]);
    // Tangent off: a flat face refuses a sketch that isn't parallel to it.
    expect(
      status(
        await run([...body.features, plane, p.feature, emboss([p.profile], body.chamfer)]),
        'EM',
      ),
    ).toMatchObject({
      status: 'error',
      message: 'Sketch on a plane parallel to the face to emboss on a flat face.',
    });
    for (const mode of ['emboss', 'deboss'] as const) {
      const result = ok(
        await run([
          ...body.features,
          plane,
          p.feature,
          emboss([p.profile], body.chamfer, { mode, tangent: true }),
        ]),
      );
      const shape = shapeOf('E:0');
      const want = 30000 + (mode === 'emboss' ? 40 : -40);
      expect(off(shape.volume, want)).toBeLessThan(1e-9);
      expect(shape.valid).toBe(true);
      expect(shape.solids).toBe(1);
      const report = seen.get('EM')?.report;
      expect(report?.method).toBe('moved');
      const anchor = report?.anchor;
      if (!anchor) throw new Error('no anchor');
      const wantOrigin = [20, 35, 15];
      expect(apart(anchor.origin, wantOrigin)).toBeLessThan(1e-9);
      const wantNormal = [0, SQRT_HALF, SQRT_HALF];
      expect(apart(anchor.normal, wantNormal)).toBeLessThan(1e-9);
      const data = seen.get('EM')?.data as EmbossOutputData;
      expect(apart(data.origin, wantOrigin)).toBeLessThan(1e-9);
      const names = faceNames(result, 'E:0');
      expect(names).toContain('emboss:EM:cap:end');
      for (const line of p.lines) expect(names).toContain(`emboss:EM:side:${line}`);
      expect(new Set(names).size).toBe(names.length);
    }
  });

  it('reads the right way round from below, and the bar stays up', async () => {
    const b = new SketchBuilder();
    b.line(0, 0, 6, 0);
    b.line(6, 0, 6, 2);
    b.line(6, 2, 2, 2);
    b.line(2, 2, 2, 8);
    b.line(2, 8, 0, 8);
    b.line(0, 8, 0, 0);
    const [found] = detectProfiles(b.sketch);
    if (!found) throw new Error('no profile');
    const profile: GeomRef = { kind: 'profile', id: `SK/${found.id}` };
    const [plane, above] = offsetPlane('P', XY, '10 mm');
    const square = rectangle('Q', above, [-20, -20, 40, 40]);
    const extrude = feature('B', 'extrude', extrudeInputs([square.profile], { distance: '20 mm' }));
    const bottom: GeomRef = { kind: 'face', id: 'extrude:B:cap:start' };
    const base = [plane, square.feature, extrude, sketch('SK', b.sketch, XY)];
    // Tangent off: the letters read mirrored from below.
    ok(await run([...base, emboss([profile], bottom)]));
    const plain = shapeOf('B:0');
    expect(off(plain.volume, 32000 + 24)).toBeLessThan(1e-9);
    expect(solidAt(plain.shape, [5, 1, 9.5])).toBe(true);
    expect(solidAt(plain.shape, [-1, 1, 9.5])).toBe(false);
    // Tangent on: the L folds over about its up, so it reads right from below.
    ok(await run([...base, emboss([profile], bottom, { tangent: true })]));
    const shape = shapeOf('B:0');
    expect(off(shape.volume, 32000 + 24)).toBeLessThan(1e-9);
    expect(solidAt(shape.shape, [-1, 1, 9.5])).toBe(true);
    expect(solidAt(shape.shape, [5, 1, 9.5])).toBe(false);
    expect(solidAt(shape.shape, [3, 7, 9.5])).toBe(true);
  });

  it('folds a sketch tilted to the cylinder’s axis and wraps it', async () => {
    const tilt = feature('P', 'planeAtAngle', {
      axis: refs([AXIS_X]),
      plane: refs([XY]),
      angle: angle('60 deg'),
    });
    const plane = constructionRef(tilt) as GeomRef;
    ok(await run([cylinder(), tilt]));
    const p = rectangle('SK', plane, [-5, -2, 10, 4]);
    // Tangent off: the tilted sketch isn't parallel to the axis.
    expect(
      status(await run([cylinder(), tilt, p.feature, emboss([p.profile], WALL)]), 'EM'),
    ).toMatchObject({
      status: 'error',
      message: "Sketch on a plane parallel to the cylinder's axis to emboss on a round face.",
    });
    for (const mode of ['emboss', 'deboss'] as const) {
      ok(
        await run([
          cylinder(),
          tilt,
          p.feature,
          emboss([p.profile], WALL, { mode, tangent: true }),
        ]),
      );
      const shape = shapeOf('C:0');
      const plain = Math.PI * R * R * 20;
      const tool = 40 * ((mode === 'emboss' ? R + 0.5 : R - 0.5) / R);
      expect(off(shape.volume, plain + (mode === 'emboss' ? tool : -tool))).toBeLessThan(1e-5);
      expect(shape.valid).toBe(true);
      expect(shape.solids).toBe(1);
      const report = seen.get('EM')?.report;
      expect(report?.method).toBe('wrapped-cylinder');
      const anchor = report?.anchor;
      if (!anchor) throw new Error('no anchor');
      expect(Math.abs(Math.hypot(anchor.origin[0], anchor.origin[1]) - R)).toBeLessThan(1e-6);
    }
  });

  it('projects an off-centre circle along the sphere’s normal there', async () => {
    const [plane, above] = offsetPlane('P', XY, '30 mm');
    const c = circle('SK', above, 12, 0, 3);
    for (const mode of ['emboss', 'deboss'] as const) {
      ok(
        await run([
          sphereBody(),
          plane,
          c.feature,
          emboss([c.profile], SPHERE, { mode, tangent: true }),
        ]),
      );
      const shape = shapeOf('S:0');
      const want = mode === 'emboss' ? BALL + column(3, R, R + 1) : BALL - column(3, R - 1, R);
      expect(off(shape.volume, want)).toBeLessThan(1e-6);
      expect(shape.valid).toBe(true);
      expect(shape.solids).toBe(1);
      const report = seen.get('EM')?.report;
      expect(report?.method).toBe('projected');
      const anchor = report?.anchor;
      if (!anchor) throw new Error('no anchor');
      const wantOrigin = [12, 0, 16];
      const wantNormal = [0.6, 0, 0.8];
      expect(apart(anchor.origin, wantOrigin)).toBeLessThan(1e-9);
      expect(apart(anchor.normal, wantNormal)).toBeLessThan(1e-9);
    }
  });

  it('refuses when the line through the centre misses the face', async () => {
    const body = chamferBody();
    const [plane, above] = offsetPlane('P', XY, '30 mm');
    const p = rectangle('SK', above, [60, 33, 10, 4]);
    const result = await run([
      ...body.features,
      plane,
      p.feature,
      emboss([p.profile], body.chamfer, { tangent: true }),
    ]);
    expect(status(result, 'EM')).toMatchObject({
      status: 'error',
      message:
        "Tangent to the face needs the face in front of the profiles: the line through their centre along the sketch's normal misses it.",
    });
  });
});

// ------------------------------------------------------ several faces (S4)

/** A face reference by its name. */
const faceOf = (id: string): GeomRef => ({ kind: 'face', id });

/** A sketch of the closed polyline through `points` and its profile. */
function polygon(id: string, plane: GeomRef, points: readonly (readonly [number, number])[]) {
  const b = new SketchBuilder();
  const lines = points.map(([x, y], i) => {
    const [u, v] = points[(i + 1) % points.length] as readonly [number, number];
    return b.line(x, y, u, v).id;
  });
  const [found] = detectProfiles(b.sketch);
  if (!found) throw new Error('no profile');
  return { feature: sketch(id, b.sketch, plane), lines, profile: profileOf(id, found.id) };
}

/**
 * An L extruded 40 mm (y ±20) from XZ (body `E:0`, volume 24000): a lower top
 * at z = 10 over x 0…20 and an upper one at z = 20 over x 20…40, a riser
 * between them at x = 20.
 */
function stepped() {
  const l = polygon('LS', XZ, [
    [0, 0],
    [40, 0],
    [40, 20],
    [20, 20],
    [20, 10],
    [0, 10],
  ]);
  const extrude = feature(
    'E',
    'extrude',
    extrudeInputs([l.profile], { distance: '40 mm', direction: 'symmetric' }),
  );
  const side = (k: number) => faceOf(`extrude:E:side:${l.lines[k]}`);
  return {
    features: [l.feature, extrude],
    lower: side(4),
    upper: side(2),
    right: side(1),
  };
}
const STEPPED = 40 * 10 * 40 + 20 * 10 * 40;

/** The names of a body's own faces that are this emboss's, and the role issues among them. */
function namesOf(result: Done, body: string) {
  const names = faceNames(result, body);
  return {
    names,
    own: names.filter((name) => name.startsWith('emboss:EM:')),
    issues: faceRoleIssues(EMBOSS_FACE_ROLES, 'EM', names),
  };
}

describe('emboss on several faces', { timeout: 300_000 }, () => {
  it('moves onto both tops of a step: each takes its part, out and in, and the names', async () => {
    const step = stepped();
    const [plane, above] = offsetPlane('P', XY, '30 mm');
    // x 12…32: 8 × 10 over the lower top, 12 × 10 over the upper one.
    const p = rectangle('SK', above, [12, -5, 20, 10]);
    const area = 8 * 10 + 12 * 10;
    for (const mode of ['emboss', 'deboss'] as const) {
      const result = ok(
        await run([
          ...step.features,
          plane,
          p.feature,
          emboss([p.profile], [step.lower, step.upper], { mode }),
        ]),
      );
      const body = shapeOf('E:0');
      expect(Math.abs(body.volume - (STEPPED + (mode === 'emboss' ? area : -area)))).toBeLessThan(
        1e-9 * STEPPED,
      );
      expect(body.valid).toBe(true);
      expect(body.solids).toBe(1);
      expect(seen.get('EM')?.report).toEqual({
        kind: 'emboss',
        method: 'moved',
        faces: ['moved', 'moved'],
      });
      const { names, own, issues } = namesOf(result, 'E:0');
      expect(issues).toEqual([]);
      expect(new Set(names).size).toBe(names.length);
      // The walls along y = ±5 run over both tops: one piece each.
      for (const line of [p.lines[0], p.lines[2]]) {
        expect(own).toContain(`emboss:EM:side:${line}#1`);
        expect(own).toContain(`emboss:EM:side:${line}#2`);
      }
      // Cut in, the lower piece stops at the riser inside the material: its clip wall.
      if (mode === 'deboss') expect(own).toContain('emboss:EM:clip:1');
      else expect(own.some((name) => name.includes(':clip:'))).toBe(false);
    }
  });

  it('moves onto a flat face and wraps round the fillet beside it, out and in (the spike)', async () => {
    const square = polygon('BS', XY, [
      [0, 0],
      [40, 0],
      [40, 40],
      [0, 40],
    ]);
    const extrude = feature('E', 'extrude', extrudeInputs([square.profile], { distance: '10 mm' }));
    const side = (k: number) => `extrude:E:side:${square.lines[k]}`;
    const first = ok(await run([square.feature, extrude]));
    const corner = edgeName([side(1), side(2)]);
    const index = first.bodies[0]?.mesh?.edgeIds?.indexOf(corner) ?? -1;
    const edge = engine.reference('E:0' as never, 'edge', index);
    if (!edge) throw new Error(`no edge ${corner}`);
    const fillet = feature('F', 'fillet', filletInputs([{ edges: [edge], radius: '5 mm' }]));
    const rounded = [square.feature, extrude, fillet];
    ok(await run(rounded));
    const plain = shapeOf('E:0').volume;
    // The plane y = 50 (XZ's normal is −Y); x 30…40, z 3…7: half on +Y, half over the fillet.
    const [plane, front] = offsetPlane('P', XZ, '-50 mm');
    const p = rectangle('SK', front, [30, 3, 10, 4]);
    const faces = [faceOf(side(2)), faceOf(`fillet:F:from:(${corner})`)];
    for (const mode of ['emboss', 'deboss'] as const) {
      const result = ok(
        await run([...rounded, plane, p.feature, emboss([p.profile], faces, { mode })]),
      );
      const body = shapeOf('E:0');
      expect(Math.abs(body.volume - (plain + (mode === 'emboss' ? 42 : -38)))).toBeLessThan(1e-6);
      expect(body.valid).toBe(true);
      expect(body.solids).toBe(1);
      expect(seen.get('EM')?.report).toEqual({
        kind: 'emboss',
        method: 'moved',
        faces: ['moved', 'wrapped-cylinder'],
      });
      const { names, own, issues } = namesOf(result, 'E:0');
      expect(issues).toEqual([]);
      expect(new Set(names).size).toBe(names.length);
      // The outer cap is split across the pieces (flat and round); the walls at
      // z = 3 and 7 run flat across the seam, so the fuse leaves one face each.
      // The letters stop nowhere at a face's edge: no clip walls.
      expect([...own].sort()).toEqual(
        [
          'emboss:EM:cap:end#1',
          'emboss:EM:cap:end#2',
          ...p.lines.map((line) => `emboss:EM:side:${line}`),
        ].sort(),
      );
    }
  });

  it('wraps across both halves of a split cylinder as one face alone does', async () => {
    const b = new SketchBuilder();
    const upper = b.arc(0, 0, 20, 0, 180).id;
    const lower = b.arc(0, 0, 20, 180, 360).id;
    const [found] = detectProfiles(b.sketch);
    if (!found) throw new Error('no profile');
    const base = [
      sketch('CS', b.sketch, XY),
      feature('E', 'extrude', extrudeInputs([profileOf('CS', found.id)], { distance: '20 mm' })),
    ];
    // On x = 30, y −5…5 (across the seam at y = 0), z 8…12.
    const [plane, aside] = offsetPlane('P', YZ, '30 mm');
    const p = rectangle('SK', aside, [-5, 8, 10, 4]);
    const halves = [faceOf(`extrude:E:side:${upper}`), faceOf(`extrude:E:side:${lower}`)];
    const plain = Math.PI * 20 * 20 * 20;
    ok(await run([...base, plane, p.feature, emboss([p.profile], halves)]));
    const both = shapeOf('E:0');
    expect(seen.get('EM')?.report.faces).toEqual(['wrapped-cylinder', 'wrapped-cylinder']);
    ok(await run([...base, plane, p.feature, emboss([p.profile], halves[0] as GeomRef)]));
    const alone = shapeOf('E:0');
    expect(Math.abs(both.volume - alone.volume)).toBeLessThan(1e-6);
    expect(off(both.volume - plain, (40 * 20.5) / 20)).toBeLessThan(1e-6);
    expect(both.valid).toBe(true);
    expect(both.solids).toBe(1);
  });

  it('projects across a capsule: the cylinder takes a projection too', async () => {
    // A R 10 cylinder along X (x 0…30) with a half ball at x = 30, revolved about X.
    const b = new SketchBuilder();
    b.line(0, 0, 0, 10);
    const top = b.line(0, 10, 30, 10).id;
    const cap = b.arc(30, 0, 10, 0, 90).id;
    b.line(40, 0, 0, 0);
    const [found] = detectProfiles(b.sketch);
    if (!found) throw new Error('no profile');
    const base = [
      sketch('RS', b.sketch, XY),
      feature('R', 'revolve', revolveInputs([profileOf('RS', found.id)], AXIS_X)),
    ];
    ok(await run(base));
    const plain = shapeOf('R:0').volume;
    const [plane, above] = offsetPlane('P', XY, '20 mm');
    const p = rectangle('SK', above, [25, -3, 10, 6]);
    const faces = [faceOf(`revolve:R:side:${top}`), faceOf(`revolve:R:side:${cap}`)];
    const result = ok(await run([...base, plane, p.feature, emboss([p.profile], faces)]));
    const body = shapeOf('R:0');
    expect(seen.get('EM')?.report.faces).toEqual(['projected', 'projected']);
    expect(body.valid).toBe(true);
    expect(body.solids).toBe(1);
    expect(body.volume).toBeGreaterThan(plain + 60 * 0.9);
    expect(namesOf(result, 'R:0').issues).toEqual([]);
  });

  it('projects across three twisted side faces of a loft', async () => {
    const hexagon = (r: number, turn: number) =>
      Array.from({ length: 6 }, (_, k): [number, number] => {
        const t = ((60 * k + turn) * Math.PI) / 180;
        return [r * Math.cos(t), r * Math.sin(t)];
      });
    const bottom = polygon('L1', XY, hexagon(20, 0));
    const [plane, high] = offsetPlane('P', XY, '30 mm');
    const top = polygon('L2', high, hexagon(16, 15));
    const sections = [bottom.feature, plane, top.feature];
    const loft = feature('LO', 'loft', loftInputs([bottom.profile, top.profile]));
    ok(await run([...sections, loft]));
    const plain = shapeOf('LO:0').volume;
    // The faces from the edges 180°→240°, 240°→300° and 300°→360°: the ones facing −Y.
    const faces = [3, 4, 5].map((k) => faceOf(`loft:LO:side:${bottom.lines[k]}`));
    // The plane y = −40, x −14…14, z 8…14.
    const [front, aside] = offsetPlane('Q', XZ, '40 mm');
    const p = rectangle('SK', aside, [-14, 8, 28, 6]);
    const result = ok(await run([...sections, loft, front, p.feature, emboss([p.profile], faces)]));
    const body = shapeOf('LO:0');
    expect(seen.get('EM')?.report.faces).toEqual(['projected', 'projected', 'projected']);
    expect(body.valid).toBe(true);
    expect(body.solids).toBe(1);
    expect(body.volume).toBeGreaterThan(plain + 28 * 6 * 0.9);
    const { names, issues } = namesOf(result, 'LO:0');
    expect(issues).toEqual([]);
    expect(new Set(names).size).toBe(names.length);
  });

  it('refuses faces of two bodies, warns of a face no letter reaches, refuses when none is', async () => {
    const step = stepped();
    const [plane, above] = offsetPlane('P', XY, '30 mm');
    const p = rectangle('SK', above, [12, -5, 20, 10]);
    const other = feature('B', 'box', {
      length: length('10 mm'),
      width: length('10 mm'),
      height: length('10 mm'),
    });
    const twoBodies = await run([
      ...step.features,
      other,
      plane,
      p.feature,
      emboss([p.profile], [step.lower, faceOf('box:B:cap:end')]),
    ]);
    expect(status(twoBodies, 'EM')).toMatchObject({
      status: 'error',
      message: 'Pick faces of one body to emboss on.',
    });

    // The side at x = 40 is not parallel to the sketch: projected, and nothing lands on it.
    const third = await run([
      ...step.features,
      plane,
      p.feature,
      emboss([p.profile], [step.lower, step.upper, step.right]),
    ]);
    expect(status(third, 'EM')).toMatchObject({
      status: 'warning',
      message: 'No letters land on face 3.',
    });
    expect(seen.get('EM')?.report.faces).toEqual(['moved', 'moved', 'projected']);
    expect(Math.abs(shapeOf('E:0').volume - (STEPPED + 200))).toBeLessThan(1e-9 * STEPPED);

    const far = rectangle('SK', above, [60, -5, 10, 10]);
    const none = await run([
      ...step.features,
      plane,
      far.feature,
      emboss([far.profile], [step.lower, step.upper]),
    ]);
    expect(status(none, 'EM')).toMatchObject({
      status: 'error',
      message: "The profiles don't touch the faces.",
    });
  });

  it('lays the profiles once for every face with tangent', async () => {
    const step = stepped();
    const [plane, above] = offsetPlane('P', XY, '30 mm');
    const p = rectangle('SK', above, [12, -5, 20, 10]);
    ok(
      await run([
        ...step.features,
        plane,
        p.feature,
        emboss([p.profile], [step.lower, step.upper], { tangent: true }),
      ]),
    );
    expect(Math.abs(shapeOf('E:0').volume - (STEPPED + 200))).toBeLessThan(1e-9 * STEPPED);
    const report = seen.get('EM')?.report;
    expect(report?.faces).toEqual(['moved', 'moved']);
    // The centroid (22, 0, 30) is over the upper top only.
    expect(apart(report?.anchor?.origin ?? [], [22, 0, 20])).toBeLessThan(1e-9);
    expect(apart(report?.anchor?.normal ?? [], [0, 0, 1])).toBeLessThan(1e-9);
  });
});
