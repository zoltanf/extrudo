// The Draft feature (P3-08) through the recompute engine with real OCCT: a
// block's sides tilted about its floor (narrowing up, or widening with a
// negative angle or a flipped pull), a face as the neutral plane, a
// cylinder's wall turned into a cone, faces keeping their names (a fillet
// after a draft survives the angle changing), and the messages for drafts
// that can't be built: too steep (with the largest angle that works), a face
// parallel to the plane, faces next to rounded edges, lost faces.
// `golden/draft-options.json` is a golden table of cases (a Vitest file
// snapshot); rewrite it with `pnpm vitest run -u packages/kernel/src/features/draft`
// and review the diff.
import {
  type BodyId,
  draftInputs,
  type ExtrudoDocument,
  extrudeInputs,
  type Feature,
  type FeatureId,
  FeatureRegistry,
  type FeatureStatus,
  filletInputs,
  type GeomRef,
  originPlaneRef,
  type SketchData,
  sketchInputs,
} from '@extrudo/core';
import { SketchBuilder } from '@extrudo/sketch/fixtures';
import { detectProfiles } from '@extrudo/sketch/profiles';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { SubShapeKind } from '../history';
import { Kernel, type ShapeHandle } from '../kernel';
import { edgeName } from '../naming';
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

function rect(b: SketchBuilder, x: number, y: number, w: number, h: number) {
  return {
    bottom: b.line(x, y, x + w, y).id,
    right: b.line(x + w, y, x + w, y + h).id,
    top: b.line(x + w, y + h, x, y + h).id,
    left: b.line(x, y + h, x, y).id,
  };
}

function sketch(id: string, data: SketchData): Feature {
  return { ...testFeature(id, 'sketch'), inputs: sketchInputs(originPlaneRef('origin:xy'), data) };
}

function extrude(id: string, sketchId: string, data: SketchData, distance: string): Feature {
  const found = detectProfiles(data)[0];
  if (!found) throw new Error('no profile');
  const ref: GeomRef = { kind: 'profile', id: `${sketchId}/${found.id}` };
  return { ...testFeature(id, 'extrude'), inputs: extrudeInputs([ref], { distance }) };
}

function draft(
  id: string,
  faces: GeomRef[],
  plane: GeomRef | undefined,
  angle: string,
  flip?: boolean,
): Feature {
  return { ...testFeature(id, 'draft'), inputs: draftInputs(faces, plane, angle, flip) };
}

async function run(doc: ExtrudoDocument): Promise<Done> {
  const result = await engine.recompute({ doc });
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

function refTo(result: Done, kind: SubShapeKind, id: string): GeomRef {
  for (const body of result.bodies) {
    const list =
      kind === 'face'
        ? body.mesh?.faceIds
        : kind === 'edge'
          ? body.mesh?.edgeIds
          : body.mesh?.vertexIds;
    const index = list?.indexOf(id) ?? -1;
    if (index < 0) continue;
    const ref = engine.reference(body.id, kind, index);
    if (ref) return ref;
  }
  throw new Error(`no ${kind} named ${id}`);
}

/** A recompute; `measure` then reads the bodies it made (`latestBody`). */
const runWithShapes = run;

const round = (x: number, digits = 3) => {
  const r = Number(x.toFixed(digits));
  return Object.is(r, -0) ? 0 : r;
};

function measure(body = 'B:0') {
  const shape = engine.latestBody(body as BodyId) as ShapeHandle;
  const { volume } = kernel.measure(shape);
  const { bbox } = kernel.properties(shape);
  const d = kernel.describe(shape);
  return {
    volume: round(volume, 2),
    bbox: [...bbox.min, ...bbox.max].map((x) => round(x, 2)),
    faces: d.faces.map((f) => f.type).join(' '),
    valid: kernel.isValid(shape),
  };
}

const faceNames = (result: Done, body = 'B:0') =>
  result.bodies.find((b) => b.id === body)?.mesh?.faceIds ?? [];

const XY: GeomRef = { kind: 'plane', id: 'origin:xy' };

const W = 40;
const D = 30;
const H = 20;
/** The volume of the block with all four sides drafted by `deg` about its floor, narrowing up. */
const drafted = (deg: number) => {
  const t = Math.tan((deg * Math.PI) / 180);
  return W * D * H - t * (W + D) * H * H + (4 / 3) * t * t * H * H * H;
};

/** A 40 × 30 × 20 mm block centred on the Z axis (body `B:0`), from z = 0 up. */
function block() {
  const b = new SketchBuilder();
  const lines = rect(b, -W / 2, -D / 2, W, D);
  return { lines, features: [sketch('SB', b.sketch), extrude('B', 'SB', b.sketch, `${H} mm`)] };
}

const side = (line: string) => `extrude:B:side:${line}`;
const cap = 'extrude:B:cap:end';
const floor = 'extrude:B:cap:start';

async function withBlock() {
  const base = block();
  const first = ok(await run(testDocument(base.features)));
  const l = base.lines;
  return {
    base,
    first,
    sides: [l.bottom, l.right, l.top, l.left].map((line) => refTo(first, 'face', side(line))),
    top: refTo(first, 'face', cap),
    bottom: refTo(first, 'face', floor),
  };
}

describe('draft', { timeout: 120_000 }, () => {
  it('tilts the four sides about the floor: the block narrows up, every face keeps its name', async () => {
    const { base, first, sides } = await withBlock();
    const result = ok(
      await runWithShapes(testDocument([...base.features, draft('T', sides, XY, '5 deg')])),
    );
    const m = measure();
    expect(m.valid).toBe(true);
    expect(m.faces).toBe('plane plane plane plane plane plane');
    expect(m.volume).toBeCloseTo(drafted(5), 1);
    // The floor stays 40 × 30.
    expect(m.bbox).toEqual([-20, -15, 0, 20, 15, 20]);
    expect([...faceNames(result)].sort()).toEqual([...faceNames(first)].sort());
  });

  it('a negative angle or a flipped pull widens the block instead', async () => {
    const { base, sides } = await withBlock();
    ok(await runWithShapes(testDocument([...base.features, draft('T', sides, XY, '-5 deg')])));
    const negative = measure();
    expect(negative.volume).toBeCloseTo(drafted(-5), 1);
    expect(negative.bbox[3]).toBeGreaterThan(21.7);
    ok(await runWithShapes(testDocument([...base.features, draft('T', sides, XY, '5 deg', true)])));
    expect(measure().volume).toBeCloseTo(drafted(-5), 1);
  });

  it('takes a face as the neutral plane: its outward normal is the pull', async () => {
    const { base, sides, top } = await withBlock();
    // The top looks up: drafted about it, the sides keep the top's size and the floor shrinks.
    ok(await runWithShapes(testDocument([...base.features, draft('T', sides, top, '-5 deg')])));
    const m = measure();
    expect(m.volume).toBeCloseTo(drafted(5), 1);
    expect(m.bbox).toEqual([-20, -15, 0, 20, 15, 20]);
  });

  it('turns a cylinder’s wall into a cone', async () => {
    const b = new SketchBuilder();
    const c = b.circle(0, 0, 10);
    const features = [sketch('SB', b.sketch), extrude('B', 'SB', b.sketch, '20 mm')];
    const first = ok(await run(testDocument(features)));
    const wall = refTo(first, 'face', `extrude:B:side:${c.id}`);
    ok(await runWithShapes(testDocument([...features, draft('T', [wall], XY, '10 deg')])));
    const m = measure();
    expect(m.faces.split(' ').sort()).toEqual(['cone', 'plane', 'plane']);
    const r2 = 10 - 20 * Math.tan(Math.PI / 18);
    expect(m.volume).toBeCloseTo((Math.PI * 20 * (100 + 10 * r2 + r2 * r2)) / 3, 0);
  });

  it('keeps faces findable: a fillet on a drafted edge survives a change of angle', async () => {
    const { base, sides } = await withBlock();
    const first = ok(await run(testDocument([...base.features, draft('T', sides, XY, '3 deg')])));
    const rim = edgeName([cap, side(base.lines.bottom)]);
    const fillet: Feature = {
      ...testFeature('R', 'fillet'),
      inputs: filletInputs([{ edges: [refTo(first, 'edge', rim)], radius: '2 mm' }]),
    };
    for (const angle of ['3 deg', '8 deg', '-4 deg']) {
      const result = ok(
        await run(testDocument([...base.features, draft('T', sides, XY, angle), fillet])),
      );
      expect(faceNames(result).some((n) => n.startsWith('fillet:R:'))).toBe(true);
    }
  });

  it('too steep says the largest angle that works, and that angle works', async () => {
    const { base, sides } = await withBlock();
    // The two 40 mm sides, 30 mm apart, meet 20 mm up when each leans by atan(15 / 20) ≈ 36.9°.
    const failed = await run(testDocument([...base.features, draft('T', sides, XY, '45 deg')]));
    const st = status(failed, 'T');
    expect(st.status).toBe('error');
    const match = /can't tilt by 45°: that is too steep for this body \(max ≈ ([\d.]+)°\)\./.exec(
      st.message ?? '',
    );
    expect(match, st.message).not.toBeNull();
    const max = Number(match?.[1]);
    expect(max).toBeGreaterThan(30);
    expect(max).toBeLessThan(36.87);
    const again = await run(testDocument([...base.features, draft('T', sides, XY, `${max} deg`)]));
    expect(status(again, 'T').status).toBe('ok');
  });

  it('a face parallel to the plane, faces next to rounded edges: messages that say why', async () => {
    const { base, first, sides, top } = await withBlock();
    const parallel = await run(testDocument([...base.features, draft('T', [top], XY, '5 deg')]));
    expect(status(parallel, 'T').message).toMatch(
      /^Face \d+ is parallel to the neutral plane, so there is no line to tilt it about\./,
    );
    // The top edges rounded: the sides run smoothly into the rounds, which can't tilt.
    const l = base.lines;
    const round: Feature = {
      ...testFeature('R', 'fillet'),
      inputs: filletInputs([
        {
          edges: [l.bottom, l.right, l.top, l.left].map((line) =>
            refTo(first, 'edge', edgeName([cap, side(line)])),
          ),
          radius: '3 mm',
        },
      ]),
    };
    const rounded = await run(
      testDocument([...base.features, round, draft('T', sides, XY, '5 deg')]),
    );
    expect(status(rounded, 'T').status).toBe('error');
    expect(status(rounded, 'T').message).toMatch(/draft before rounding the edges/);
  });

  it('asks for faces, a plane and an angle other than 0; a lost face can be fixed', async () => {
    const { base, sides } = await withBlock();
    const messageOf = async (feature: Feature) =>
      status(await run(testDocument([...base.features, feature])), 'T').message;
    expect(await messageOf(draft('T', [], XY, '5 deg'))).toBe('Pick the faces to draft.');
    expect(await messageOf(draft('T', sides, undefined, '5 deg'))).toBe(
      'Pick the neutral plane: the faces turn about where they meet it.',
    );
    expect(await messageOf(draft('T', sides, XY, '0 deg'))).toBe(
      'The draft angle is 0°, so nothing tilts. Enter an angle other than 0.',
    );
    const gone: GeomRef = { kind: 'face', id: 'extrude:B:side:nowhere' };
    const lost = await run(testDocument([...base.features, draft('T', [gone], XY, '5 deg')]));
    expect(status(lost, 'T').refs).toEqual([{ ref: { kind: 'face', id: gone.id }, state: 'lost' }]);
  });

  it('golden table of cases', async () => {
    const { base, sides, top } = await withBlock();
    const cases: Record<string, Feature> = {
      'sides 3 about XY': draft('T', sides, XY, '3 deg'),
      'sides -3 about XY': draft('T', sides, XY, '-3 deg'),
      'sides 3 flipped': draft('T', sides, XY, '3 deg', true),
      'one side 10': draft('T', [sides[0] as GeomRef], XY, '10 deg'),
      'sides 10 about the top': draft('T', sides, top, '10 deg'),
      'sides 45 too steep': draft('T', sides, XY, '45 deg'),
      'top parallel': draft('T', [top], XY, '5 deg'),
    };
    const table: Record<string, unknown> = {};
    for (const [key, feature] of Object.entries(cases)) {
      const result = await runWithShapes(testDocument([...base.features, feature]));
      const st = status(result, 'T');
      if (st.status === 'error') {
        table[key] = { error: st.message };
        continue;
      }
      table[key] = { ...measure(), names: [...faceNames(result)].sort() };
    }
    await expect(`${JSON.stringify(table, null, 1)}\n`).toMatchFileSnapshot(
      './golden/draft-options.json',
    );
  });
});
