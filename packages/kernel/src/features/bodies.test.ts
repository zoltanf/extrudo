// Bodies (P2-08, ADR-0030) through the recompute engine with real OCCT:
// a cut or an intersection that leaves separate solids makes one body per
// solid (the largest keeps the body's ID), and the Remove feature takes
// bodies out of the model.
import {
  type BodyId,
  type ExtrudeInputOptions,
  type ExtrudoDocument,
  extrudeInputs,
  type Feature,
  type FeatureId,
  type GeomRef,
  originPlaneRef,
  removeBodiesFeatureOf,
  type SketchData,
  sketchInputs,
} from '@extrudo/core';
import { SketchBuilder } from '@extrudo/sketch/fixtures';
import { detectProfiles } from '@extrudo/sketch/profiles';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Kernel } from '../kernel';
import { loadOcct } from '../occt/load';
import { RecomputeEngine } from '../recompute/engine';
import { testDocument, testFeature, testFeatures } from '../recompute/testing';
import type { RecomputeResult } from '../recompute/types';

let kernel: Kernel;
let engine: RecomputeEngine;

beforeAll(async () => {
  kernel = new Kernel(await loadOcct());
});

beforeEach(() => {
  engine?.clear();
  expect(kernel.stats().liveShapes).toBe(0);
  engine = new RecomputeEngine(kernel, testFeatures().registry, { strictLeaks: true });
});

afterAll(() => {
  engine.clear();
  expect(kernel.stats().liveShapes).toBe(0);
});

type Done = Extract<RecomputeResult, { status: 'done' }>;

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

/** A 40 × 30 × 20 block from x = 0 (body `B:0`), and a slot-shaped cutter from x = `at`, `width` wide. */
function scene(at: number, width: number, operation: 'cut' | 'intersect' = 'cut'): Feature[] {
  const block = rectangle(0, 0, 40, 30);
  const cutter = rectangle(at, -5, width, 40);
  return [
    sketch('SB', block),
    extrude('B', 'SB', block, { distance: '20 mm' }),
    sketch('SC', cutter),
    extrude('C', 'SC', cutter, {
      direction: 'symmetric',
      extent: 'through-all',
      operation,
    }),
  ];
}

async function run(doc: ExtrudoDocument): Promise<Done> {
  const result = await engine.recompute({ doc });
  if (result.status !== 'done') throw new Error('cancelled');
  return result;
}

/** Each body's x extent (from its mesh), by ID. */
function spans(result: Done): Record<string, [number, number]> {
  const out: Record<string, [number, number]> = {};
  for (const body of result.bodies) {
    const p = body.mesh?.positions ?? new Float32Array();
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < p.length; i += 3) {
      lo = Math.min(lo, p[i] as number);
      hi = Math.max(hi, p[i] as number);
    }
    out[body.id] = [Math.round(lo * 100) / 100, Math.round(hi * 100) / 100];
  }
  return out;
}

const statusOf = (result: Done, id: string) => result.features[id as FeatureId];

describe('one body per solid', { timeout: 60_000 }, () => {
  it('a cut through a block makes two bodies; the larger keeps its ID', async () => {
    const result = await run(testDocument(scene(15, 5)));
    expect(statusOf(result, 'C')).toEqual({ status: 'ok' });
    // Left 15 mm wide, right 20 mm: the right one is the block still.
    expect(spans(result)).toEqual({ 'B:0': [20, 40], 'C:0': [0, 15] });
    const left = result.bodies.find((b) => b.id === 'C:0');
    expect(left?.mesh?.faceRanges.length).toBe(12);
    // Faces keep their names: the cut's wall and the block's own sides.
    // (The cut split the block's faces, so its pieces are `#n`, as in ADR-0005.)
    expect(left?.mesh?.faceIds?.filter((n) => n.startsWith('extrude:B:cap:')).sort()).toEqual([
      'extrude:B:cap:end#1',
      'extrude:B:cap:start#1',
    ]);
    expect(left?.mesh?.faceIds?.some((n) => n.startsWith('extrude:C:side:'))).toBe(true);
  });

  it('equal pieces: the first in geometric order keeps the ID', async () => {
    const result = await run(testDocument(scene(17.5, 5)));
    expect(spans(result)).toEqual({ 'B:0': [0, 17.5], 'C:0': [22.5, 40] });
  });

  it('an intersection that leaves two pieces makes two bodies', async () => {
    // Two separate slabs of the block survive an intersection with a U-shaped tool.
    const block = rectangle(0, 0, 40, 30);
    const b = new SketchBuilder();
    for (const [x1, y1, x2, y2] of [
      [5, -5, 10, -5],
      [10, -5, 10, 35],
      [10, 35, 30, 35],
      [30, 35, 30, -5],
      [30, -5, 32, -5],
      [32, -5, 32, 40],
      [32, 40, 5, 40],
      [5, 40, 5, -5],
    ] as const) {
      b.line(x1, y1, x2, y2);
    }
    const u = b.sketch;
    const result = await run(
      testDocument([
        sketch('SB', block),
        extrude('B', 'SB', block, { distance: '20 mm' }),
        sketch('SU', u),
        extrude('I', 'SU', u, {
          direction: 'symmetric',
          distance: '100 mm',
          operation: 'intersect',
        }),
      ]),
    );
    expect(statusOf(result, 'I')).toEqual({ status: 'ok' });
    // The legs at x 5–10 and 30–32 (the top of the U lies outside the block).
    expect(spans(result)).toEqual({ 'B:0': [5, 10], 'I:0': [30, 32] });
  });

  it('a cut that splits nothing keeps one body and its shape', async () => {
    const block = rectangle(0, 0, 40, 30);
    const hole = rectangle(10, 10, 5, 5);
    const result = await run(
      testDocument([
        sketch('SB', block),
        extrude('B', 'SB', block, { distance: '20 mm' }),
        sketch('SH', hole),
        extrude('H', 'SH', hole, {
          direction: 'symmetric',
          extent: 'through-all',
          operation: 'cut',
        }),
      ]),
    );
    expect(result.bodies.map((b) => b.id)).toEqual(['B:0']);
  });

  it('many rebuilds leave no shapes behind', async () => {
    for (let i = 0; i < 20; i++) {
      engine.clear();
      await run(testDocument(scene(10 + (i % 5), 5)));
    }
    engine.clear();
    expect(kernel.stats().liveShapes).toBe(0);
  });
});

describe('the Remove feature', { timeout: 60_000 }, () => {
  const remove = (id: string, bodies: string[]) =>
    removeBodiesFeatureOf(id as FeatureId, id, bodies as BodyId[]);

  it('takes bodies out of the model; suppressed, it brings them back', async () => {
    const features = [...scene(15, 5), remove('R', ['C:0'])];
    const removed = await run(testDocument(features));
    expect(statusOf(removed, 'R')).toEqual({ status: 'ok' });
    expect(removed.bodies.map((b) => b.id)).toEqual(['B:0']);

    const suppressed = features.map((f) => (f.id === 'R' ? { ...f, suppressed: true } : f));
    const back = await run(testDocument(suppressed));
    expect(back.bodies.map((b) => b.id)).toEqual(['B:0', 'C:0']);

    const both = await run(testDocument([...scene(15, 5), remove('R', ['B:0', 'C:0'])]));
    expect(both.bodies).toEqual([]);
  });

  it('fails when a body it removes no longer exists', async () => {
    // Without the split, there is no C:0.
    const result = await run(testDocument([...scene(50, 5), remove('R', ['C:0'])]));
    expect(statusOf(result, 'R')?.status).toBe('error');
    expect(statusOf(result, 'R')?.message).toMatch(/^The body to remove no longer exists/);
    const two = await run(testDocument([...scene(50, 5), remove('R', ['C:0', 'X:1'])]));
    expect(statusOf(two, 'R')?.message).toMatch(/^2 of the bodies to remove no longer exist/);
  });
});
