// Body origins (P6-05, ADR-0081 §2) through the recompute engine with real
// OCCT: a piece a feature breaks off a body that existed before it records the
// body it came from, so a new piece stays in its source's component; a copy or
// a body the feature itself made records none.
import {
  type ExtrudeInputOptions,
  type ExtrudoDocument,
  extrudeInputs,
  type Feature,
  type GeomRef,
  type MoveInputOptions,
  moveInputs,
  originPlaneRef,
  type SketchData,
  sketchInputs,
  splitBodyInputs,
  z,
} from '@extrudo/core';
import { SketchBuilder } from '@extrudo/sketch/fixtures';
import { detectProfiles } from '@extrudo/sketch/profiles';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Kernel, type ShapeHandle } from '../kernel';
import { positionalNames } from '../naming/names';
import { namedBoolean } from '../naming/ops';
import { loadOcct } from '../occt/load';
import { RecomputeEngine } from '../recompute/engine';
import { testDocument, testFeature, testFeatures } from '../recompute/testing';
import type { KernelFeatureDefinition, RecomputeResult } from '../recompute/types';
import { splitSolids } from './bodies';

let kernel: Kernel;
let engine: RecomputeEngine;

beforeAll(async () => {
  kernel = new Kernel(await loadOcct());
});

beforeEach(() => {
  engine?.clear();
  expect(kernel.stats().liveShapes).toBe(0);
  const registry = testFeatures().registry;
  // A feature that makes a *new* body out of two disjoint boxes: the body was
  // not there before the feature, so its two pieces must carry no origin.
  registry.register(joinIntoNewBody());
  engine = new RecomputeEngine(kernel, registry, { strictLeaks: true });
});

afterAll(() => {
  engine.clear();
  expect(kernel.stats().liveShapes).toBe(0);
});

type Done = Extract<RecomputeResult, { status: 'done' }>;

// ------------------------------------------------------------------ helpers

function rectangle(x: number, y: number, w: number, h: number): SketchData {
  const b = new SketchBuilder();
  b.line(x, y, x + w, y);
  b.line(x + w, y, x + w, y + h);
  b.line(x + w, y + h, x, y + h);
  b.line(x, y + h, x, y);
  return b.sketch;
}

function sketch(id: string, data: SketchData): Feature {
  return { ...testFeature(id, 'sketch'), inputs: sketchInputs(originPlaneRef('origin:xy'), data) };
}

function profileOf(sketchId: string, data: SketchData): GeomRef {
  const [largest] = detectProfiles(data).sort((a, b) => b.area - a.area);
  if (!largest) throw new Error('no profile');
  return { kind: 'profile', id: `${sketchId}/${largest.id}` };
}

function extrude(
  id: string,
  sketchId: string,
  data: SketchData,
  options: ExtrudeInputOptions,
): Feature {
  return {
    ...testFeature(id, 'extrude'),
    inputs: extrudeInputs([profileOf(sketchId, data)], options),
  };
}

function split(id: string, bodies: string[], plane: GeomRef): Feature {
  return { ...testFeature(id, 'splitBody'), inputs: splitBodyInputs(bodies, plane) };
}

function move(id: string, bodies: string[], options: MoveInputOptions): Feature {
  return { ...testFeature(id, 'move'), inputs: moveInputs(bodies, options) };
}

/** A 40 × 30 × 20 block from x = 0 (body `B:0`), and a 5 mm cutter at x = `at`. */
function scene(at: number): Feature[] {
  const block = rectangle(0, 0, 40, 30);
  const cutter = rectangle(at, -5, 5, 40);
  return [
    sketch('SB', block),
    extrude('B', 'SB', block, { distance: '20 mm' }),
    sketch('SC', cutter),
    extrude('C', 'SC', cutter, {
      direction: 'symmetric',
      extent: 'through-all',
      operation: 'cut',
    }),
  ];
}

/** A 40 × 30 × 20 mm block centred on the Z axis (body `B:0`), from z = 0 up. */
function block(): Feature[] {
  const rect = rectangle(-20, -15, 40, 30);
  return [sketch('SB', rect), extrude('B', 'SB', rect, { distance: '20 mm' })];
}

async function run(doc: ExtrudoDocument): Promise<Done> {
  const result = await engine.recompute({ doc });
  if (result.status !== 'done') throw new Error('cancelled');
  return result;
}

const YZ: GeomRef = { kind: 'plane', id: 'origin:yz' };

/** A feature that fuses two disjoint boxes into one brand-new body of two solids. */
function joinIntoNewBody(): KernelFeatureDefinition {
  return {
    type: 'test-join-new',
    label: 'Join into a new body',
    category: 'create',
    icon: 'test',
    inputsSchema: z.strictObject({}),
    bodyAccess: () => 'write',
    evaluate(ctx) {
      const { kernel: k, bodies, bodyId } = ctx;
      using scope = k.scope();
      const named = (shape: ShapeHandle) => ({
        shape,
        names: positionalNames('box', 'J', k.describe(shape)),
      });
      const a = scope.track(k.box([10, 10, 10], [0, 0, 0]));
      const b = scope.track(k.box([10, 10, 10], [20, 0, 0]));
      const fused = namedBoolean(k, 'fuse', named(a), named(b), { feature: 'J' });
      const id = bodyId();
      return splitSolids(ctx, scope, {
        bodies: new Map(bodies).set(id, fused.shape),
        names: new Map([[id, fused.names]]),
      });
    },
  } as KernelFeatureDefinition;
}

// -------------------------------------------------------------------- tests

describe('body origins', { timeout: 120_000 }, () => {
  it('a cut that breaks a body in two records the piece’s source', async () => {
    const result = await run(testDocument(scene(15)));
    expect(result.bodies.map((b) => b.id).sort()).toEqual(['B:0', 'C:0']);
    expect(result.origins).toEqual({ 'C:0': 'B:0' });
  });

  it('Split Body maps the second half to the body it cut', async () => {
    const features = [...block(), split('S', ['B:0'], YZ)];
    const result = await run(testDocument(features));
    expect(result.bodies.map((b) => b.id).sort()).toEqual(['B:0', 'S:0']);
    expect(result.origins).toEqual({ 'S:0': 'B:0' });
  });

  it('a cached second recompute replays the same origins', async () => {
    const doc = testDocument(scene(15));
    const first = await run(doc);
    const second = await run(doc);
    expect(second.stats.reused).toBeGreaterThan(0);
    expect(second.origins).toEqual(first.origins);
    expect(second.origins).toEqual({ 'C:0': 'B:0' });
  });

  it('a Move copy records no origin', async () => {
    const features = [...block(), move('M', ['B:0'], { dx: '50 mm', copy: true })];
    const result = await run(testDocument(features));
    expect(result.bodies.map((b) => b.id).sort()).toEqual(['B:0', 'M:0']);
    expect(result.origins).toEqual({});
  });

  it('a new body the feature itself made, broken in two, records no origin', async () => {
    const result = await run(testDocument([testFeature('J', 'test-join-new')]));
    // The join made one body of two solids; splitSolids gave the second a fresh ID.
    expect(result.bodies.map((b) => b.id).sort()).toEqual(['J:0', 'J:1']);
    expect(result.origins).toEqual({});
  });
});
