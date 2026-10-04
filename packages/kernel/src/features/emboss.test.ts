// The emboss feature on flat faces (P4-04, ADR-0060 §1, §2) through the
// recompute engine with real OCCT: a rectangle sketched above, on and below a
// box's top face, a side face, a whole text, the names it gives (ADR-0005), its
// errors and a pattern that repeats it. `golden/emboss-options.json` is the
// golden table of mode × depth × face (a Vitest file snapshot); rewrite it with
// `pnpm vitest run -u packages/kernel/src/features/emboss` and review the diff.
import {
  EMBOSS_TYPE,
  type EmbossInputOptions,
  type EmbossMode,
  embossInputs,
  type Feature,
  type FeatureId,
  FeatureRegistry,
  type FeatureStatus,
  type GeomRef,
  HOLE_TYPE,
  holeInputs,
  originPlaneRef,
  type RectangularOptions,
  rectangularPatternInputs,
  type SketchData,
  type SketchEntity,
  type SketchEntityId,
  sketchInputs,
} from '@extrudo/core';
import { BUNDLED_FONTS, DEFAULT_FONT } from '@extrudo/fonts';
import { SketchBuilder } from '@extrudo/sketch/fixtures';
import { detectProfiles } from '@extrudo/sketch/profiles';
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
/** The `data` of the emboss feature's latest evaluation. */
const seen = new Map<string, EmbossOutputData>();

/** The bytes of a `data:` URL (Vite's `?url&inline` import of a binary file). */
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
  engine = new RecomputeEngine(kernel, registryOf(), { strictLeaks: true });
});

/** The kernel's features (so the emboss is registered) with `EM`'s output recorded. */
function registryOf(): FeatureRegistry<KernelFeatureDefinition> {
  const registry = new FeatureRegistry<KernelFeatureDefinition>();
  for (const definition of testFeatures().registry.list()) {
    registry.register({
      ...definition,
      evaluate(ctx) {
        const output = definition.evaluate(ctx);
        if (ctx.feature.type === EMBOSS_TYPE) {
          seen.set(ctx.feature.id, output.data as EmbossOutputData);
        }
        return output;
      },
    });
  }
  return registry;
}

afterAll(() => {
  engine.clear();
  expect(kernel.stats().liveShapes).toBe(0);
});

type Done = Extract<RecomputeResult, { status: 'done' }>;

// ------------------------------------------------------------------ helpers

const XY = originPlaneRef('origin:xy');
const XZ = originPlaneRef('origin:xz');
const YZ = originPlaneRef('origin:yz');
const AXIS_X = { kind: 'axis', id: 'origin:x' } as const;

const refs = (list: GeomRef[]) => ({ kind: 'ref' as const, refs: list });
const length = (expr: string) => ({ kind: 'expr' as const, expr, unit: 'length' as const });

function feature(id: string, type: string, inputs: Feature['inputs'] = {}): Feature {
  return { ...testFeature(id, type), inputs };
}

/** A 40 × 40 × 10 mm box on XY (body `B:0`): x, y ±20, z 0…10. */
const block = (id = 'B') =>
  feature(id, 'box', {
    length: length('40 mm'),
    width: length('40 mm'),
    height: length('10 mm'),
  });

const TOP: GeomRef = { kind: 'face', id: 'box:B:cap:end' };
const BOTTOM: GeomRef = { kind: 'face', id: 'box:B:cap:start' };
const RIGHT: GeomRef = { kind: 'face', id: 'box:B:side:right' };

function rect(b: SketchBuilder, x: number, y: number, w: number, h: number): string[] {
  return [
    b.line(x, y, x + w, y).id,
    b.line(x + w, y, x + w, y + h).id,
    b.line(x + w, y + h, x, y + h).id,
    b.line(x, y + h, x, y).id,
  ];
}

function sketch(id: string, data: SketchData, plane: GeomRef = XY): Feature {
  return { ...testFeature(id, 'sketch'), inputs: sketchInputs(plane, data) };
}

/** A construction plane `distance` along `plane`'s normal, and a ref to it. */
function offsetPlane(id: string, plane: GeomRef, distance: string): [Feature, GeomRef] {
  const made = feature(id, 'offsetPlane', { plane: refs([plane]), distance: length(distance) });
  return [made, { kind: 'plane', id }];
}

/** A text entity with its two points, as the Text tool would make them (P4-03). */
function addText(
  b: SketchBuilder,
  anchor: [number, number],
  top: [number, number],
  text: string,
): SketchEntityId {
  const a = b.point(...anchor);
  const t = b.point(...top);
  const id = b.id('t');
  const entity: SketchEntity = {
    type: 'text',
    anchor: a as SketchEntityId,
    top: t as SketchEntityId,
    text,
    font: DEFAULT_FONT,
    align: 'left',
    construction: false,
  };
  b.entities[id] = entity;
  return id as SketchEntityId;
}

/** A sketch with a rectangle and (optionally) a text: its features, data and refs. */
function pad(
  sketchId = 'SK',
  plane: GeomRef = XY,
  rectangle: [number, number, number, number] = [-5, -2.5, 10, 5],
  text?: { anchor: [number, number]; top: [number, number]; string: string },
): {
  features: Feature[];
  data: SketchData;
  lines: string[];
  profile: GeomRef;
  text?: GeomRef;
} {
  const b = new SketchBuilder();
  const lines = rect(b, ...rectangle);
  const t = text ? addText(b, text.anchor, text.top, text.string) : undefined;
  const data = b.sketch;
  const [found] = detectProfiles(data);
  if (!found) throw new Error('no profile');
  return {
    features: [sketch(sketchId, data, plane)],
    data,
    lines,
    profile: { kind: 'profile', id: `${sketchId}/${found.id}` },
    ...(t ? { text: { kind: 'sketchEntity' as const, id: `${sketchId}/${t}` } } : {}),
  };
}

function emboss(
  profiles: GeomRef[],
  face: GeomRef,
  options: EmbossInputOptions = {},
  id = 'EM',
): Feature {
  return { ...testFeature(id, EMBOSS_TYPE), inputs: embossInputs(profiles, face, options) };
}

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

/** The last computed shape of a body: its volume, tight box and counts. */
function shapeOf(body = 'B:0') {
  const shape = engine.latestBody(body as never);
  if (shape === undefined) throw new Error(`no body ${body}`);
  const props = kernel.properties(shape);
  const solids = kernel.solids(shape);
  kernel.release(...solids);
  return {
    shape,
    min: props.bbox.min.map((x) => round(x)),
    max: props.bbox.max.map((x) => round(x)),
    volume: props.volume,
    faces: kernel.count(shape, 'face'),
    solids: solids.length,
    valid: kernel.isValid(shape),
  };
}

const round3 = (v: readonly number[] | undefined) => v?.map((x) => round(x));

const round = (x: number, digits = 3) => {
  const r = Number(x.toFixed(digits));
  return Object.is(r, -0) ? 0 : r;
};

/** Whether a 0.05 mm cube centred at `at` is inside the shape. */
function solidAt(shape: ShapeHandle, at: readonly [number, number, number]): boolean {
  const h = 0.025;
  const probe = kernel.box([2 * h, 2 * h, 2 * h], [at[0] - h, at[1] - h, at[2] - h]);
  const common = kernel.common(shape, probe);
  const volume = kernel.measure(common.shape).volume;
  kernel.release(probe, common.shape);
  return volume > 1e-6;
}

/** The persistent face names of a body, in sub-shape order. */
function faceNames(result: Done, body = 'B:0'): string[] {
  return result.bodies.find((b) => b.id === body)?.mesh?.faceIds ?? [];
}

/** Within `part` of the exact value (0.005 = 0.5 %). */
const within = (value: number, exact: number, part = 0.005) =>
  Math.abs(value - exact) <= part * Math.abs(exact);

const BOX_VOLUME = 40 * 40 * 10;
/** The 10 × 5 mm pad, 2 mm deep. */
const PAD = 10 * 5 * 2;
/** The 5 × 5 mm pad on the side face, 2 mm deep. */
const SIDE_PAD = 5 * 5 * 2;
const TWO = { depth: '2 mm' } as const;

// -------------------------------------------------------------------- tests

describe('emboss on a flat face', { timeout: 300_000 }, () => {
  it('embosses a rectangle sketched above the face: the volume grows by ink × depth', async () => {
    const [plane, above] = offsetPlane('P', XY, '20 mm');
    const p = pad('SK', above);
    ok(await run([block(), plane, ...p.features, emboss([p.profile], TOP, TWO)]));

    const box = shapeOf();
    expect(box.volume).toBeCloseTo(BOX_VOLUME + PAD, 6);
    // The pad stands 2 mm proud of the top face; everything else is as it was.
    expect(box.max).toEqual([20, 20, 12]);
    expect(box.min).toEqual([-20, -20, 0]);
    expect(box.valid).toBe(true);
    expect(box.solids).toBe(1);
    // Six box faces, four pad sides and the pad's own top (its underside merges
    // into the face it stands on).
    expect(box.faces).toBe(6 + 5);
    expect(solidAt(box.shape, [0, 0, 11.9])).toBe(true);
    expect(solidAt(box.shape, [0, 0, 12.1])).toBe(false);
    expect(solidAt(box.shape, [6, 0, 11])).toBe(false);
    // The dialog's data: the profiles' middle on the face, the normal they grew along.
    expect(seen.get('EM')).toMatchObject({ depth: 2, body: 'B:0' });
    expect(round3(seen.get('EM')?.origin)).toEqual([0, 0, 10]);
    expect(round3(seen.get('EM')?.direction)).toEqual([0, 0, 1]);
  });

  it('debosses the same rectangle: the volume shrinks by ink × depth', async () => {
    const p = pad('SK');
    ok(await run([block(), ...p.features, emboss([p.profile], TOP, { ...TWO, mode: 'deboss' })]));
    expect(shapeOf().volume).toBeCloseTo(BOX_VOLUME - PAD, 6);
    const box = shapeOf();
    expect(box.max).toEqual([20, 20, 10]);
    expect(box.faces).toBe(6 + 5);
    expect(solidAt(box.shape, [0, 0, 9.9])).toBe(false);
    expect(solidAt(box.shape, [0, 0, 7.9])).toBe(true);
    expect(round3(seen.get('EM')?.direction)).toEqual([0, 0, -1]);
  });

  it('embosses from a sketch below the face as well: the same result either way', async () => {
    const p = pad('SK');
    ok(await run([block(), ...p.features, emboss([p.profile], TOP, TWO)]));
    expect(shapeOf().volume).toBeCloseTo(BOX_VOLUME + PAD, 6);
    expect(shapeOf().max[2]).toBe(12);
  });

  it('embosses on the bottom face downwards and on a side face outwards', async () => {
    const p = pad('SK');
    ok(await run([block(), ...p.features, emboss([p.profile], BOTTOM, TWO)]));
    expect(shapeOf().volume).toBeCloseTo(BOX_VOLUME + PAD, 6);
    expect(shapeOf().min).toEqual([-20, -20, -2]);
    expect(round3(seen.get('EM')?.direction)).toEqual([0, 0, -1]);

    // The +X face (x = 20) from a YZ sketch: sketch x is world Y, y is world Z,
    // so this is Y -2.5…2.5, Z 2.5…7.5: a 5 × 5 mm pad on the face.
    const q = pad('SQ', YZ, [-2.5, 2.5, 5, 5]);
    ok(await run([block(), ...q.features, emboss([q.profile], RIGHT, TWO)]));
    expect(shapeOf().volume).toBeCloseTo(BOX_VOLUME + SIDE_PAD, 6);
    expect(shapeOf().max[0]).toBe(22);
    expect(round3(seen.get('EM')?.direction)).toEqual([1, 0, 0]);
    expect(solidAt(shapeOf().shape, [21, 0, 5])).toBe(true);
    expect(solidAt(shapeOf().shape, [21, 4, 5])).toBe(false);

    engine.clear();
    const inward = await run([
      block(),
      ...q.features,
      emboss([q.profile], RIGHT, { ...TWO, mode: 'deboss' }),
    ]);
    expect(shapeOf().volume).toBeCloseTo(BOX_VOLUME - SIDE_PAD, 6);
    expect(shapeOf().max[0]).toBe(20);
    expect(status(inward, 'EM').status).toBe('ok');
  });

  it('embosses a whole text and keeps working when the string changes', async () => {
    const text = { anchor: [0, 0] as [number, number], top: [0, 8] as [number, number] };
    const p = pad('SK', XY, [-5, -2.5, 10, 5], { ...text, string: 'AB' });
    const whole = p.text as GeomRef;
    const area = detectProfiles(p.data)
      .filter((t) => t.text !== undefined)
      .reduce((sum, t) => sum + t.area, 0);
    expect(area).toBeGreaterThan(0);

    ok(await run([block(), ...p.features, emboss([whole], TOP, { depth: '1 mm' })]));
    const first = shapeOf().volume;
    expect(within(first, BOX_VOLUME + area)).toBe(true);
    expect(shapeOf().faces).toBeGreaterThan(6);
    // The letters stand 1 mm off the top face, which is where they were sketched.
    expect(shapeOf().max).toEqual([20, 20, 11]);

    // The same features and IDs with the string edited: still valid, bigger.
    const edited: SketchData = {
      ...p.data,
      entities: Object.fromEntries(
        Object.entries(p.data.entities).map(([id, e]) =>
          e.type === 'text' ? [id, { ...e, text: 'ABC' }] : [id, e],
        ),
      ),
    };
    const result = ok(
      await run([block(), sketch('SK', edited), emboss([whole], TOP, { depth: '1 mm' })]),
    );
    expect(status(result, 'EM').status).toBe('ok');
    expect(shapeOf().volume).toBeGreaterThan(first);
  });

  it('refuses a sketch that is not parallel to the face', async () => {
    const p = pad('SK', XZ, [-5, -2.5, 10, 5]);
    const cross = await run([block(), ...p.features, emboss([p.profile], TOP)]);
    expect(status(cross, 'EM')).toMatchObject({
      status: 'error',
      message: 'Sketch on a plane parallel to the face to emboss on a flat face.',
    });
    // The same rectangle on a plane that is parallel to the face: fine.
    const q = pad('SQ', YZ, [-5, -2.5, 10, 5]);
    const along = ok(await run([block(), ...q.features, emboss([q.profile], RIGHT, TWO)]));
    expect(along.bodies).toHaveLength(1);
  });

  it('refuses profiles that miss the face, in both modes', async () => {
    for (const mode of ['emboss', 'deboss'] as EmbossMode[]) {
      const p = pad('SK', XY, [30, 30, 10, 5]);
      const result = await run([
        block(),
        ...p.features,
        emboss([p.profile], TOP, { mode, depth: '1 mm' }),
      ]);
      expect(status(result, 'EM')).toMatchObject({
        status: 'error',
        message: "The profiles don't touch the face.",
      });

      // Straddling the face's edge still touches it.
      const q = pad('SK', XY, [18, -2.5, 6, 5]);
      ok(await run([block(), ...q.features, emboss([q.profile], TOP, { mode, depth: '1 mm' })]));
      // A join keeps the whole 6 × 5 × 1 mm pad (2 mm of its width hang over the
      // edge), a cut only the 2 × 5 × 1 mm that was in the material.
      expect(shapeOf().volume).toBeCloseTo(BOX_VOLUME + (mode === 'emboss' ? 30 : -10), 6);
      // Six box faces, four new ones from the cut, and for the join the pad's own
      // underside (it hangs over the edge, so OCCT can't merge it into the top
      // face) and its top.
      expect(shapeOf().faces).toBe(mode === 'emboss' ? 12 : 10);
    }
  });

  it('refuses surfaces that are neither flat nor round', async () => {
    const p = pad('SK');
    // A torus face.
    const torus = feature('K', 'torus', {
      diameter: length('30 mm'),
      tube: length('6 mm'),
    });
    const other = await run([
      torus,
      ...p.features,
      emboss([p.profile], { kind: 'face', id: 'torus:K:side:surface' }, { depth: '1 mm' }),
    ]);
    expect(status(other, 'EM')).toMatchObject({
      status: 'error',
      message: 'Emboss works on flat and cylindrical faces.',
    });

    // So is the cone of a countersunk hole (a cylinder wraps, a cone does not).
    const countersink = {
      ...testFeature('H', HOLE_TYPE),
      inputs: holeInputs({
        plane: TOP,
        type: 'countersink',
        extent: 'through',
        numbers: {
          diameter: '4 mm',
          csDiameter: '8 mm',
          csAngle: '90 deg',
          x: '0 mm',
          y: '0 mm',
        },
      }),
    };
    const cone = await run([
      block(),
      countersink,
      ...p.features,
      emboss([p.profile], { kind: 'face', id: 'hole:H:side:cone' }, { depth: '1 mm' }),
    ]);
    expect(status(cone, 'EM')).toMatchObject({
      status: 'error',
      message: 'Emboss works on flat and cylindrical faces.',
    });
  });

  it('names every face uniquely and stably, the sides after the sketch curves', async () => {
    const p = pad('SK');
    const doc = () => [block(), ...p.features, emboss([p.profile], TOP, TWO)];
    const first = faceNames(ok(await run(doc())));
    expect(first).toHaveLength(11);
    expect(new Set(first).size).toBe(first.length);
    for (const line of p.lines) expect(first).toContain(`emboss:EM:side:${line}`);
    expect(first.filter((n) => n.startsWith('emboss:EM:')).sort()).toEqual(
      ['emboss:EM:cap:end', ...p.lines.map((line) => `emboss:EM:side:${line}`)].sort(),
    );

    // A fresh engine (an empty cache) gives the same names.
    engine.clear();
    engine = new RecomputeEngine(kernel, registryOf(), { strictLeaks: true });
    expect(faceNames(ok(await run(doc())))).toEqual(first);
  });

  it('is patternable: a rectangular pattern raises two pads', async () => {
    const p = pad('SK');
    const options: RectangularOptions = {
      features: ['EM'],
      direction1: AXIS_X,
      count1: '2',
      distance1: '20 mm',
    };
    const result = ok(
      await run([
        block(),
        ...p.features,
        emboss([p.profile], TOP, { depth: '2 mm' }),
        { ...testFeature('P', 'rectangularPattern'), inputs: rectangularPatternInputs(options) },
      ]),
    );
    expect(status(result, 'P').status).toBe('ok');
    const box = shapeOf();
    expect(box.volume).toBeCloseTo(BOX_VOLUME + 2 * PAD, 6);
    // Six box faces and five per pad, plus the copy's underside, which OCCT's
    // simplifier leaves as a face of its own on the top face.
    expect(box.faces).toBe(6 + 10 + 1);
    expect(solidAt(box.shape, [0, 0, 11])).toBe(true);
    expect(solidAt(box.shape, [20, 0, 11])).toBe(true);
    expect(solidAt(box.shape, [10, 0, 11])).toBe(false);
  });

  it('keeps a golden table of modes, depths, faces and errors', async () => {
    const table: Record<string, unknown> = {};
    const cases: { name: string; plane: GeomRef; face: GeomRef; before?: Feature }[] = [
      { name: 'top', plane: XY, face: TOP },
      { name: 'bottom', plane: XY, face: BOTTOM },
      { name: 'side', plane: YZ, face: RIGHT },
      { name: 'above', plane: offsetPlane('P', XY, '20 mm')[1], face: TOP },
      { name: 'sketched on the face', plane: TOP, face: TOP },
      { name: 'cross', plane: XZ, face: TOP },
      { name: 'far off the face', plane: XY, face: BOTTOM },
    ];
    for (const c of cases) {
      const [plane, above] = offsetPlane('P', XY, '20 mm');
      const p = pad(
        'SK',
        c.plane,
        c.name === 'far off the face' ? [30, 30, 10, 5] : [-5, -2.5, 10, 5],
      );
      for (const depth of ['1 mm', '2 mm']) {
        for (const mode of ['emboss', 'deboss'] as EmbossMode[]) {
          const features = [
            block(),
            ...(c.name === 'above' ? [plane] : []),
            ...p.features,
            emboss([p.profile], c.face, { depth, mode }),
          ];
          const result = await run(features);
          const s = status(result, 'EM');
          if (s.status === 'error') {
            table[`${c.name} ${depth} ${mode}`] = { error: s.message };
            continue;
          }
          const m = shapeOf();
          table[`${c.name} ${depth} ${mode}`] = {
            volume: round(m.volume, 2),
            bbox: [...m.min, ...m.max],
            faces: m.faces,
            solids: m.solids,
            embossFaces: faceNames(result)
              .filter((n) => n.startsWith('emboss:'))
              .sort(),
          };
        }
      }
      expect(above.id).toBe('P');
    }
    // No profiles, no face, and a depth of 0.
    const p = pad('SK');
    for (const [name, inputs] of [
      ['no profiles', { profiles: refs([]), face: refs([TOP]) }],
      ['no face', { profiles: refs([p.profile]) }],
      ['zero depth', { profiles: refs([p.profile]), face: refs([TOP]), depth: length('0 mm') }],
      [
        'lost profile',
        { profiles: refs([{ kind: 'profile' as const, id: 'SK/nothing' }]), face: refs([TOP]) },
      ],
    ] as const) {
      const result = await run([
        block(),
        ...p.features,
        { ...testFeature('EM', EMBOSS_TYPE), inputs: inputs as Feature['inputs'] },
      ]);
      const s = status(result, 'EM');
      table[name] = s.status === 'error' ? { error: s.message } : { status: s.status };
    }
    await expect(`${JSON.stringify(table, null, 1)}\n`).toMatchFileSnapshot(
      './golden/emboss-options.json',
    );
  });
});

// ---------------------------------------------------------------- round faces

/** The Ø40 × 20 mm Cylinder primitive of these tests: axis Z through the origin, body `C:0`. */
const cylinder = (id = 'C') =>
  feature(id, 'cylinder', { diameter: length('40 mm'), height: length('20 mm') });

/** Its wall, the round face every case here embosses on. */
const WALL: GeomRef = { kind: 'face', id: 'cylinder:C:side:wall' };
const CYLINDER = Math.PI * 400 * 20;

/**
 * The volume a wrapped region of `area` mm² adds to a cylinder of radius `R`
 * (`outward`) or takes off it: the unrolled sketch keeps its width along the
 * surface, so the sector's mean radius decides (ADR-0060 §3).
 */
const want = (area: number, radius: number, depth: number, outward = true) =>
  area * depth * ((outward ? radius + depth / 2 : radius - depth / 2) / radius);

/** A 10 × 4 mm rectangle on the XZ plane, so its middle is on the cylinder's axis. */
const PATCH = [-5, 8, 10, 4] as const;
const INK = 10 * 4;

describe('emboss on a cylindrical face', { timeout: 300_000 }, () => {
  it('wraps a rectangle off an XZ sketch: the exact annular sector', async () => {
    const p = pad('SK', XZ, [...PATCH]);
    ok(await run([cylinder(), ...p.features, emboss([p.profile], WALL, { depth: '1 mm' })]));

    const shape = shapeOf('C:0');
    // The wrap, not a projection: the sector between radius 20 and 21 over the
    // 10 mm the sketch is wide (a fifth of the way round) and 4 mm tall.
    expect(shape.volume).toBeCloseTo(CYLINDER + want(INK, 20, 1), 6);
    expect(shape.valid).toBe(true);
    expect(shape.solids).toBe(1);
    // The wall stands 1 mm proud at the letters' middle height, on the side the
    // sketch is on: the body reaches y = -21 there and the cylinder's own -20
    // everywhere else.
    expect(shape.min[1]).toBe(-21);
    expect(shape.max[1]).toBe(20);
    expect(shape.min[2]).toBe(0);
    expect(shape.max[2]).toBe(20);
    expect(solidAt(shape.shape, [0, -20.9, 10])).toBe(true);
    expect(solidAt(shape.shape, [0, -21.1, 10])).toBe(false);
    expect(solidAt(shape.shape, [8, -20, 10])).toBe(false);
    // The dialog's data: the profiles' wrapped centre (on the wall, not on the
    // axis), and the radial way the letters grow.
    expect(seen.get('EM')).toMatchObject({ depth: 1, body: 'C:0' });
    expect(round3(seen.get('EM')?.origin)).toEqual([0, -20, 10]);
    expect(round3(seen.get('EM')?.direction)).toEqual([0, -1, 0]);

    // A deboss takes off the sector between 20 and 19 instead.
    ok(
      await run([
        cylinder(),
        ...p.features,
        emboss([p.profile], WALL, { depth: '1 mm', mode: 'deboss' }),
      ]),
    );
    const cut = shapeOf('C:0');
    expect(cut.volume).toBeCloseTo(CYLINDER - want(INK, 20, 1, false), 6);
    expect(cut.min[1]).toBe(-20);
    expect(solidAt(cut.shape, [0, -19.1, 10])).toBe(false);
    expect(solidAt(cut.shape, [0, -18.9, 10])).toBe(true);
    expect(round3(seen.get('EM')?.direction)).toEqual([0, 1, 0]);
  });

  it('wraps from a plane off the axis as well: the same volume either way', async () => {
    const [plane, beside] = offsetPlane('P', XZ, '-30 mm');
    const p = pad('SK', beside, [...PATCH]);
    ok(await run([cylinder(), plane, ...p.features, emboss([p.profile], WALL, { depth: '1 mm' })]));
    const near = shapeOf('C:0');
    expect(near.volume).toBeCloseTo(CYLINDER + want(INK, 20, 1), 6);
    // The sketch is on the far side, so its letters are too: the body reaches
    // radius 21 at y = +20 now.
    expect(near.min[1]).toBe(-20);
    expect(near.max[1]).toBe(21);
    expect(round3(seen.get('EM')?.origin)).toEqual([0, 20, 10]);
    expect(round3(seen.get('EM')?.direction)).toEqual([0, 1, 0]);
    expect(solidAt(near.shape, [0, 20.9, 10])).toBe(true);
  });

  it('wraps a whole text and keeps working when the string changes', async () => {
    const text = { anchor: [-5, 6] as [number, number], top: [-5, 11] as [number, number] };
    const p = pad('SK', XZ, [-25, -25, 4, 2], { ...text, string: 'AB' });
    const whole = p.text as GeomRef;
    expect(whole.kind).toBe('sketchEntity');

    ok(await run([cylinder(), ...p.features, emboss([whole], WALL, { depth: '1 mm' })]));
    const first = shapeOf('C:0');
    expect(first.valid).toBe(true);
    expect(first.volume).toBeGreaterThan(CYLINDER);
    expect(first.faces).toBeGreaterThan(3);
    expect(first.min[1]).toBeLessThan(-20.9);

    // The same features and IDs with the string edited: still valid, more faces.
    const edited: SketchData = {
      ...p.data,
      entities: Object.fromEntries(
        Object.entries(p.data.entities).map(([id, e]) =>
          e.type === 'text' ? [id, { ...e, text: 'ABC' }] : [id, e],
        ),
      ),
    };
    const result = ok(
      await run([cylinder(), sketch('SK', edited, XZ), emboss([whole], WALL, { depth: '1 mm' })]),
    );
    expect(status(result, 'EM').status).toBe('ok');
    expect(shapeOf('C:0').faces).toBeGreaterThan(first.faces);
  });

  it('wraps into a hole as well: emboss fills it in, deboss widens it', async () => {
    const bore = {
      ...testFeature('H', HOLE_TYPE),
      inputs: holeInputs({
        plane: TOP,
        extent: 'through',
        numbers: { diameter: '20 mm', x: '0 mm', y: '0 mm' },
      }),
    };
    // The patch is inside the block's 10 mm height, unlike the cylinder's cases.
    const p = pad('SK', XZ, [-5, 2, 10, 4]);
    const bored = Math.PI * 100 * 10;
    const box = 40 * 40 * 10;
    ok(
      await run([
        block(),
        bore,
        ...p.features,
        emboss([p.profile], { kind: 'face', id: 'hole:H:side:wall' }, { depth: '1 mm' }),
      ]),
    );
    // The wall is a hole's, so the letters grow into its free space (between
    // radius 10 and 9) and the body gets that much bigger.
    expect(shapeOf().volume).toBeCloseTo(box - bored + want(INK, 10, 1, false), 6);

    ok(
      await run([
        block(),
        bore,
        ...p.features,
        emboss(
          [p.profile],
          { kind: 'face', id: 'hole:H:side:wall' },
          { depth: '1 mm', mode: 'deboss' },
        ),
      ]),
    );
    // A deboss cuts into the material around the hole instead.
    expect(shapeOf().volume).toBeCloseTo(box - bored - want(INK, 10, 1), 6);
  });

  it('refuses a sketch across the axis, a too deep deboss and too long profiles', async () => {
    // Across the axis: an XY sketch on a cylinder whose axis is Z.
    const across = pad('SK', XY, [-5, -2, 10, 4]);
    const square = await run([
      cylinder(),
      ...across.features,
      emboss([across.profile], WALL, { depth: '1 mm' }),
    ]);
    expect(status(square, 'EM')).toMatchObject({
      status: 'error',
      message: "Sketch on a plane parallel to the cylinder's axis to emboss on a round face.",
    });

    // Deeper than the radius: 20 mm of wall, 21 mm of deboss.
    const p = pad('SK', XZ, [...PATCH]);
    const deep = await run([
      cylinder(),
      ...p.features,
      emboss([p.profile], WALL, { depth: '21 mm', mode: 'deboss' }),
    ]);
    expect(status(deep, 'EM')).toMatchObject({
      status: 'error',
      message: expect.stringContaining('the depth is bigger than the radius'),
    });

    // More than half way round: an 80 mm edge runs four radians (229°) round a
    // wall whose whole circumference is 126 mm.
    const wide = pad('SK', XZ, [0, 8, 80, 4]);
    const long = await run([
      cylinder(),
      ...wide.features,
      emboss([wide.profile], WALL, { depth: '1 mm' }),
    ]);
    expect(status(long, 'EM')).toMatchObject({
      status: 'error',
      message: expect.stringContaining('longer than half way round the cylinder'),
    });
  });

  it('says so when the letters land where the face is not', async () => {
    // The same patch 30 mm up, past the cylinder's top: the wrap still lands it
    // on the cylinder's continuation, which is no face of anything.
    const p = pad('SK', XZ, [-5, 30, 10, 4]);
    const away = await run([
      cylinder(),
      ...p.features,
      emboss([p.profile], WALL, { depth: '1 mm' }),
    ]);
    expect(status(away, 'EM')).toMatchObject({
      status: 'error',
      message: "The profiles don't touch the face.",
    });
  });

  it('names every face uniquely, the walls after the sketch curves', async () => {
    const p = pad('SK', XZ, [...PATCH]);
    const doc = () => [cylinder(), ...p.features, emboss([p.profile], WALL, { depth: '1 mm' })];
    const first = faceNames(ok(await run(doc())), 'C:0');
    expect(new Set(first).size).toBe(first.length);
    for (const line of p.lines) expect(first).toContain(`emboss:EM:side:${line}`);
    expect(first.filter((n) => n.startsWith('emboss:EM:')).sort()).toEqual(
      ['emboss:EM:cap:end', ...p.lines.map((line) => `emboss:EM:side:${line}`)].sort(),
    );

    // An unrelated edit (the cylinder gets taller) keeps every name.
    const taller = cylinder('C');
    taller.inputs = { ...taller.inputs, height: length('30 mm') };
    const second = faceNames(
      ok(await run([taller, ...p.features, emboss([p.profile], WALL, { depth: '1 mm' })])),
      'C:0',
    );
    expect(second).toEqual(first);

    // A fresh engine (an empty cache) gives the same names.
    engine.clear();
    engine = new RecomputeEngine(kernel, registryOf(), { strictLeaks: true });
    expect(faceNames(ok(await run(doc())), 'C:0')).toEqual(first);
  });
});
