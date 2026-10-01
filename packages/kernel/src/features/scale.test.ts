// The Scale feature (P3-08) through the recompute engine with real OCCT: a
// block scaled uniformly about its box centre and about a vertex, scaled per
// axis (flat faces stay planes, straight edges lines), a cylinder scaled
// across its axis, copies with names of their own, a fillet that survives a
// change of factor, and the messages for factors that aren't greater than 0.
// `golden/scale-options.json` is a golden table of cases (a Vitest file
// snapshot); rewrite it with `pnpm vitest run -u packages/kernel/src/features/scale`
// and review the diff.
import {
  type BodyId,
  type ExtrudoDocument,
  extrudeInputs,
  type Feature,
  type FeatureId,
  FeatureRegistry,
  type FeatureStatus,
  filletInputs,
  type GeomRef,
  originPlaneRef,
  type ScaleInputOptions,
  type SketchData,
  scaleInputs,
  sketchInputs,
} from '@extrudo/core';
import { SketchBuilder } from '@extrudo/sketch/fixtures';
import { detectProfiles } from '@extrudo/sketch/profiles';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { SubShapeKind } from '../history';
import { Kernel, type ShapeHandle } from '../kernel';
import { edgeName, vertexName } from '../naming';
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

function scaled(id: string, bodies: string[], options: ScaleInputOptions): Feature {
  return { ...testFeature(id, 'scale'), inputs: scaleInputs(bodies, options) };
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

function measure(body: string) {
  const shape = engine.latestBody(body as BodyId) as ShapeHandle;
  const { volume, bbox } = kernel.properties(shape);
  const d = kernel.describe(shape);
  return {
    volume: round(volume, 2),
    bbox: [...bbox.min, ...bbox.max].map((x) => round(x, 2)),
    faces: d.faces.map((f) => f.type).join(' '),
    lines: d.edges.filter((e) => e.type === 'line').length,
    valid: kernel.isValid(shape),
  };
}

const faceNames = (result: Done, body: string) =>
  result.bodies.find((b) => b.id === body)?.mesh?.faceIds ?? [];

/** A 40 × 30 × 20 mm block (body `B:0`) from (0, 0, 0). */
function block() {
  const b = new SketchBuilder();
  const lines = rect(b, 0, 0, 40, 30);
  return { lines, features: [sketch('SB', b.sketch), extrude('B', 'SB', b.sketch, '20 mm')] };
}

/** A cylinder of radius 10 and height 20 (body `B:0`) on the origin. */
function cylinder() {
  const b = new SketchBuilder();
  b.circle(0, 0, 10);
  return [sketch('SB', b.sketch), extrude('B', 'SB', b.sketch, '20 mm')];
}

const side = (line: string) => `extrude:B:side:${line}`;
const cap = 'extrude:B:cap:end';
const floor = 'extrude:B:cap:start';

describe('scale', { timeout: 120_000 }, () => {
  it('scales uniformly about the centre of the bodies’ box, every face keeping its name', async () => {
    const base = block();
    const before = [...faceNames(ok(await run(testDocument(base.features))), 'B:0')].sort();
    const result = ok(
      await runWithShapes(testDocument([...base.features, scaled('S', ['B:0'], { factor: '2' })])),
    );
    expect(measure('B:0')).toMatchObject({
      volume: 8 * 24000,
      bbox: [-20, -15, -10, 60, 45, 30],
      lines: 12,
      valid: true,
    });
    expect([...faceNames(result, 'B:0')].sort()).toEqual(before);
  });

  it('scales about a vertex, which stays where it is', async () => {
    const base = block();
    const first = ok(await run(testDocument(base.features)));
    const corner = refTo(
      first,
      'vertex',
      vertexName([floor, side(base.lines.bottom), side(base.lines.left)]),
    );
    ok(
      await runWithShapes(
        testDocument([...base.features, scaled('S', ['B:0'], { factor: '0.5', point: corner })]),
      ),
    );
    expect(measure('B:0').bbox).toEqual([0, 0, 0, 20, 15, 10]);
  });

  it('scales per axis: flat faces stay planes and straight edges lines', async () => {
    const base = block();
    ok(
      await runWithShapes(
        testDocument([
          ...base.features,
          scaled('S', ['B:0'], { mode: 'non-uniform', x: '2', y: '1', z: '0.5' }),
        ]),
      ),
    );
    expect(measure('B:0')).toEqual({
      volume: 24000,
      bbox: [-20, 0, 5, 60, 30, 15],
      faces: 'plane plane plane plane plane plane',
      lines: 12,
      valid: true,
    });
  });

  it('a cylinder scaled across its axis gets an elliptic wall of the right volume', async () => {
    ok(
      await runWithShapes(
        testDocument([
          ...cylinder(),
          scaled('S', ['B:0'], { mode: 'non-uniform', x: '2', y: '1', z: '1' }),
        ]),
      ),
    );
    const m = measure('B:0');
    expect(m.valid).toBe(true);
    // The wall is an exact ellipse; OCCT's default volume integration is about 0.8 % off on
    // B-spline faces (the same for a cylinder converted to B-splines without scaling).
    expect(Math.abs(m.volume / (2 * Math.PI * 100 * 20) - 1)).toBeLessThan(0.01);
    expect(m.faces.split(' ').sort()).toEqual(['bspline', 'plane', 'plane']);
  });

  it('copies get new bodies whose faces are named from the originals', async () => {
    const base = block();
    const result = ok(
      await runWithShapes(
        testDocument([...base.features, scaled('S', ['B:0'], { factor: '2', copy: true })]),
      ),
    );
    expect(result.bodies.map((b) => b.id)).toEqual(['B:0', 'S:0']);
    expect(measure('B:0').volume).toBe(24000);
    expect(measure('S:0').volume).toBe(8 * 24000);
    expect(faceNames(result, 'S:0')).toContain(`scale:S:from:(${cap})`);
  });

  it('keeps faces findable: a fillet after the scale survives a change of factor', async () => {
    const base = block();
    const first = ok(
      await run(testDocument([...base.features, scaled('S', ['B:0'], { factor: '2' })])),
    );
    const rim = edgeName([cap, side(base.lines.bottom)]);
    const fillet: Feature = {
      ...testFeature('R', 'fillet'),
      inputs: filletInputs([{ edges: [refTo(first, 'edge', rim)], radius: '2 mm' }]),
    };
    for (const factor of ['2', '1.5', '0.8']) {
      const result = ok(
        await run(testDocument([...base.features, scaled('S', ['B:0'], { factor }), fillet])),
      );
      expect(faceNames(result, 'B:0').some((n) => n.startsWith('fillet:R:'))).toBe(true);
    }
  });

  it('refuses factors that aren’t greater than 0, and warns when nothing changes', async () => {
    const base = block();
    const statusOf = async (feature: Feature) =>
      status(await run(testDocument([...base.features, feature])), 'S');
    expect((await statusOf(scaled('S', ['B:0'], { factor: '0' }))).message).toBe(
      'The scale factor is 0. Scale factors must be greater than 0 (use Mirror to turn a body over).',
    );
    expect(
      (await statusOf(scaled('S', ['B:0'], { mode: 'non-uniform', y: '-2' }))).message,
    ).toMatch(/^The Y factor is -2\./);
    expect(await statusOf(scaled('S', ['B:0'], { factor: '1' }))).toMatchObject({
      status: 'warning',
      message: 'Nothing changes size: every factor is 1.',
    });
    expect((await statusOf(scaled('S', [], { factor: '2' }))).message).toBe(
      'Pick the bodies to scale.',
    );
  });

  it('golden table of cases', async () => {
    const base = block();
    const cases: Record<string, { features: Feature[]; options: ScaleInputOptions }> = {
      'block x2': { features: base.features, options: { factor: '2' } },
      'block x0.25': { features: base.features, options: { factor: '0.25' } },
      'block 2,1,0.5': {
        features: base.features,
        options: { mode: 'non-uniform', x: '2', y: '1', z: '0.5' },
      },
      'block 1,1,1.5': {
        features: base.features,
        options: { mode: 'non-uniform', x: '1', y: '1', z: '1.5' },
      },
      'cylinder x3': { features: cylinder(), options: { factor: '3' } },
      'cylinder 1,2,1': {
        features: cylinder(),
        options: { mode: 'non-uniform', x: '1', y: '2', z: '1' },
      },
    };
    const table: Record<string, unknown> = {};
    for (const [key, one] of Object.entries(cases)) {
      const result = await runWithShapes(
        testDocument([...one.features, scaled('S', ['B:0'], one.options)]),
      );
      const st = status(result, 'S');
      if (st.status === 'error') {
        table[key] = { error: st.message };
        continue;
      }
      table[key] = { ...measure('B:0'), names: [...faceNames(result, 'B:0')].sort() };
    }
    await expect(`${JSON.stringify(table, null, 1)}\n`).toMatchFileSnapshot(
      './golden/scale-options.json',
    );
  });
});
