// The Split Body feature (P3-08) through the recompute engine with real OCCT:
// a block cut along origin planes and along another body's face, each side a
// body of its own (the larger keeps the ID), one side kept, faces cut in two
// named #1 and #2, the cut faces split:<id>:cut:above|below, a fillet on a cut
// edge, and the messages for planes that don't cut. `golden/split-body-options.json`
// is a golden table of cases (a Vitest file snapshot); rewrite it with
// `pnpm vitest run -u packages/kernel/src/features/split-body` and review the diff.
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
  type SketchData,
  type SplitKeep,
  sketchInputs,
  splitBodyInputs,
} from '@extrudo/core';
import { SketchBuilder } from '@extrudo/sketch/fixtures';
import { detectProfiles } from '@extrudo/sketch/profiles';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { SubShapeKind } from '../history';
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

// ------------------------------------------------------------------ helpers

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

function split(
  id: string,
  bodies: string[],
  plane: GeomRef | undefined,
  keep?: SplitKeep,
): Feature {
  return { ...testFeature(id, 'splitBody'), inputs: splitBodyInputs(bodies, plane, keep) };
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
  const { volume } = kernel.measure(shape);
  const { bbox } = kernel.properties(shape);
  return {
    volume: round(volume, 2),
    bbox: [...bbox.min, ...bbox.max].map((x) => round(x, 2)),
    faces: kernel.count(shape, 'face'),
    valid: kernel.isValid(shape),
  };
}

const faceNames = (result: Done, body: string) =>
  result.bodies.find((b) => b.id === body)?.mesh?.faceIds ?? [];

const XY: GeomRef = { kind: 'plane', id: 'origin:xy' };
const YZ: GeomRef = { kind: 'plane', id: 'origin:yz' };
const XZ: GeomRef = { kind: 'plane', id: 'origin:xz' };

/** A 40 × 30 × 20 mm block centred on the Z axis (body `B:0`), from z = 0 up. */
function block() {
  const b = new SketchBuilder();
  const lines = rect(b, -20, -15, 40, 30);
  return {
    lines,
    features: [sketch('SB', b.sketch), extrude('B', 'SB', b.sketch, '20 mm')],
  };
}

const side = (line: string) => `extrude:B:side:${line}`;
const cap = 'extrude:B:cap:end';

describe('split body', { timeout: 120_000 }, () => {
  it('cuts a block in two along the YZ plane: two bodies, the faces cut in two named #1 and #2', async () => {
    const base = block();
    const result = ok(
      await runWithShapes(testDocument([...base.features, split('S', ['B:0'], YZ)])),
    );
    expect(result.bodies.map((b) => b.id)).toEqual(['B:0', 'S:0']);
    // YZ's normal is +X: "above" is x > 0. Equal halves: the first in x keeps the ID.
    expect(measure('B:0')).toEqual({
      volume: 12000,
      bbox: [-20, -15, 0, 0, 15, 20],
      faces: 6,
      valid: true,
    });
    expect(measure('S:0').bbox).toEqual([0, -15, 0, 20, 15, 20]);
    const left = [...faceNames(result, 'B:0')].sort();
    const right = [...faceNames(result, 'S:0')].sort();
    expect(left).toContain('split:S:cut:below');
    expect(right).toContain('split:S:cut:above');
    expect(left).toContain(side(base.lines.left));
    expect(right).toContain(side(base.lines.right));
    // The top, the floor and the two long sides are cut in two: one piece in each body.
    for (const name of [cap, side(base.lines.bottom)]) {
      expect([...left, ...right].filter((n) => n.startsWith(`${name}#`)).sort()).toEqual([
        `${name}#1`,
        `${name}#2`,
      ]);
    }
    // Names are unique across the two bodies.
    expect(new Set([...left, ...right]).size).toBe(left.length + right.length);
  });

  it('the larger side keeps the body, and keeping one side leaves one body', async () => {
    const b = new SketchBuilder();
    rect(b, -10, -15, 40, 30);
    const features = [sketch('SB', b.sketch), extrude('B', 'SB', b.sketch, '20 mm')];
    ok(await runWithShapes(testDocument([...features, split('S', ['B:0'], YZ)])));
    expect(measure('B:0').bbox[0]).toBe(0);
    expect(measure('S:0').bbox[3]).toBe(0);
    const above = ok(
      await runWithShapes(testDocument([...features, split('S', ['B:0'], YZ, 'above')])),
    );
    expect(above.bodies.map((x) => x.id)).toEqual(['B:0']);
    expect(measure('B:0').volume).toBe(30 * 30 * 20);
    const below = ok(
      await runWithShapes(testDocument([...features, split('S', ['B:0'], YZ, 'below')])),
    );
    expect(below.bodies.map((x) => x.id)).toEqual(['B:0']);
    expect(measure('B:0').volume).toBe(10 * 30 * 20);
  });

  it('splits along the plane of another body’s face, extended past it', async () => {
    const base = block();
    // A thin plate standing at x = 5…10, much smaller than the block's section.
    const b = new SketchBuilder();
    const plate = rect(b, 5, -2, 5, 4);
    const features = [
      ...base.features,
      sketch('SP', b.sketch),
      extrude('P', 'SP', b.sketch, '3 mm'),
    ];
    const first = ok(await run(testDocument(features)));
    // Its left side faces -X at x = 5: above is x < 5.
    const face = refTo(first, 'face', `extrude:P:side:${plate.left}`);
    ok(await runWithShapes(testDocument([...features, split('S', ['B:0'], face)])));
    expect(measure('B:0').bbox).toEqual([-20, -15, 0, 5, 15, 20]);
    expect(measure('S:0').bbox).toEqual([5, -15, 0, 20, 15, 20]);
  });

  it('a fillet on an edge of the cut face survives', async () => {
    const base = block();
    const first = ok(await run(testDocument([...base.features, split('S', ['B:0'], XZ)])));
    // An edge where a cut face meets a piece of the top.
    const edges = first.bodies.flatMap((b) => b.mesh?.edgeIds ?? []);
    const rim = edges.find((e) => e.includes('split:S:cut:') && e.includes(`${cap}#`));
    if (!rim) throw new Error(`no cut edge on the top in ${edges.join(' ')}`);
    const fillet: Feature = {
      ...testFeature('R', 'fillet'),
      inputs: filletInputs([{ edges: [refTo(first, 'edge', rim)], radius: '2 mm' }]),
    };
    const after = ok(await run(testDocument([...base.features, split('S', ['B:0'], XZ), fillet])));
    expect(
      after.bodies.flatMap((b) => b.mesh?.faceIds ?? []).some((n) => n.startsWith('fillet:R:')),
    ).toBe(true);
  });

  it('says when the plane doesn’t cut, and when the kept side is empty', async () => {
    const base = block();
    const messageOf = async (feature: Feature) =>
      status(await run(testDocument([...base.features, feature])), 'S').message;
    // The XY plane is the block's floor.
    expect(await messageOf(split('S', ['B:0'], XY))).toMatch(/doesn't cut the body/);
    expect(await messageOf(split('S', ['B:0'], XY, 'below'))).toBe(
      'Nothing of the body is below the plane, so nothing would be left. Keep the other side, or both.',
    );
    expect(await messageOf(split('S', ['B:0'], undefined))).toBe('Pick the plane to split along.');
    expect(await messageOf(split('S', [], YZ))).toBe('Pick the bodies to split.');
  });

  it('splits the bodies it cuts and warns about the ones it doesn’t', async () => {
    const base = block();
    const b = new SketchBuilder();
    rect(b, 30, 30, 10, 10);
    const features = [
      ...base.features,
      sketch('SC', b.sketch),
      extrude('C', 'SC', b.sketch, '5 mm'),
    ];
    const result = await runWithShapes(testDocument([...features, split('S', ['B:0', 'C:0'], YZ)]));
    expect(status(result, 'S')).toMatchObject({ status: 'warning' });
    expect(status(result, 'S').message).toMatch(/doesn't cut one of the bodies/);
    expect(result.bodies.map((x) => x.id).sort()).toEqual(['B:0', 'C:0', 'S:0']);
  });

  it('golden table of cases', async () => {
    const base = block();
    const cases: Record<string, Feature> = {
      'YZ both': split('S', ['B:0'], YZ),
      'YZ above': split('S', ['B:0'], YZ, 'above'),
      'YZ below': split('S', ['B:0'], YZ, 'below'),
      'XZ both': split('S', ['B:0'], XZ),
      'XY no cut': split('S', ['B:0'], XY),
    };
    const table: Record<string, unknown> = {};
    for (const [key, feature] of Object.entries(cases)) {
      const result = await runWithShapes(testDocument([...base.features, feature]));
      const st = status(result, 'S');
      if (st.status === 'error') {
        table[key] = { error: st.message };
        continue;
      }
      table[key] = Object.fromEntries(
        result.bodies.map((b) => [
          b.id,
          { ...measure(b.id), names: [...faceNames(result, b.id)].sort() },
        ]),
      );
    }
    await expect(`${JSON.stringify(table, null, 1)}\n`).toMatchFileSnapshot(
      './golden/split-body-options.json',
    );
  });
});
