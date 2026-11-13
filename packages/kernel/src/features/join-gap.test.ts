// A join whose tool lies a hair off the body (ADR-0051, 2026-11-10): a block
// and a tool whose bottom face lies GAP above the block's top, a free sketch
// point's drift. The touching test (`TOUCH`, 1e-4 mm) calls them touching;
// OCCT's plain fuse sees no contact (its tolerance is 1e-7 mm) and returned
// two solids, so the join made two bodies. The facade builds such a fuse again
// with a fuzzy value of `TOUCH`. A tool 1e-3 mm off stays apart, as before.
// Synthetic shapes only.
import {
  combineInputs,
  type ExtrudoDocument,
  extrudeInputs,
  type Feature,
  type FeatureStatus,
  type GeomRef,
  originAxisRef,
  originPlaneRef,
  revolveInputs,
  type SketchData,
  sketchInputs,
} from '@extrudo/core';
import { SketchBuilder } from '@extrudo/sketch/fixtures';
import { detectProfiles } from '@extrudo/sketch/profiles';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Kernel, type ShapeHandle } from '../kernel';
import { loadOcct } from '../occt/load';
import { RecomputeEngine } from '../recompute/engine';
import { testDocument, testFeature, testFeatures } from '../recompute/testing';
import type { RecomputeResult } from '../recompute/types';
import { TOUCH } from './operation';

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

/** The drift of the case that found it: a free sketch point 2.4e-6 mm off. */
const GAP = 2.4e-6;
/** Apart: more than `TOUCH`. */
const FAR = 1e-3;

function rect(b: SketchBuilder, x: number, y: number, w: number, h: number): void {
  b.line(x, y, x + w, y);
  b.line(x + w, y, x + w, y + h);
  b.line(x + w, y + h, x, y + h);
  b.line(x, y + h, x, y);
}

function sketch(id: string, data: SketchData, plane: 'origin:xy' | 'origin:xz'): Feature {
  return { ...testFeature(id, 'sketch'), inputs: sketchInputs(originPlaneRef(plane), data) };
}

function profile(sketchId: string, data: SketchData): GeomRef {
  const [found] = detectProfiles(data);
  if (!found) throw new Error('no profile');
  return { kind: 'profile', id: `${sketchId}/${found.id}` };
}

/** The block: x and y −10…10, z 0…10 (body `B:0`). */
function block(): Feature[] {
  const s = new SketchBuilder();
  rect(s, -10, -10, 20, 20);
  return [
    sketch('SB', s.sketch, 'origin:xy'),
    {
      ...testFeature('B', 'extrude'),
      inputs: extrudeInputs([profile('SB', s.sketch)], { distance: '10' }),
    },
  ];
}

/** A block 10 × 10 × 5 standing `gap` above the block's top: extruded both ways from the XZ plane. */
function extrudeTool(gap: number, operation: 'join' | 'new-body'): Feature[] {
  const s = new SketchBuilder();
  rect(s, -5, 10 + gap, 10, 5 - gap);
  return [
    sketch('ST', s.sketch, 'origin:xz'),
    {
      ...testFeature('T', 'extrude'),
      inputs: extrudeInputs([profile('ST', s.sketch)], {
        distance: '10',
        direction: 'symmetric',
        operation,
      }),
    },
  ];
}

/** A cylinder of radius 4 standing `gap` above the block's top: a rectangle in XZ turned about Z. */
function revolveTool(gap: number, operation: 'join' | 'new-body'): Feature[] {
  const s = new SketchBuilder();
  rect(s, 0, 10 + gap, 4, 5 - gap);
  return [
    sketch('SR', s.sketch, 'origin:xz'),
    {
      ...testFeature('R', 'revolve'),
      inputs: revolveInputs([profile('SR', s.sketch)], originAxisRef('origin:z'), { operation }),
    },
  ];
}

async function run(features: Feature[]): Promise<Done> {
  const doc: ExtrudoDocument = testDocument(features);
  const result = await engine.recompute({ doc });
  if (result.status !== 'done') throw new Error('cancelled');
  return result;
}

const status = (result: Done, id: string): FeatureStatus =>
  result.features[id as keyof typeof result.features] ?? { status: 'ok' };

function ok(result: Done): Done {
  for (const [id, s] of Object.entries(result.features)) {
    if (s.status !== 'ok') throw new Error(`${id}: ${s.status} ${s.message ?? ''}`);
  }
  return result;
}

/** Each body's volume, validity and solid count, through a spy on the kernel's mesh call. */
async function measured(features: Feature[]) {
  const shapes: ShapeHandle[] = [];
  const mesh = kernel.mesh.bind(kernel);
  kernel.mesh = (shape, options) => {
    shapes.push(shape);
    return mesh(shape, options);
  };
  try {
    const result = await run(features);
    const bodies = result.bodies.map((b, i) => {
      const shape = shapes[i] as ShapeHandle;
      const solids = kernel.solids(shape);
      kernel.release(...solids);
      return {
        id: b.id,
        volume: kernel.measure(shape).volume,
        valid: kernel.isValid(shape),
        solids: solids.length,
        faces: [...(b.mesh?.faceIds ?? [])].sort(),
        edges: [...(b.mesh?.edgeIds ?? [])].sort(),
      };
    });
    return { result, bodies };
  } finally {
    kernel.mesh = mesh;
  }
}

const close = (actual: number, expected: number) =>
  expect(Math.abs(actual - expected) / expected).toBeLessThan(1e-6);

const BLOCK = 20 * 20 * 10;

describe('a join whose tool lies a hair off the body', { timeout: 120_000 }, () => {
  it('the gap is inside the touching distance', () => {
    expect(GAP).toBeLessThan(TOUCH);
    expect(FAR).toBeGreaterThan(TOUCH);
  });

  it('an extrude join gives one body, named as when the faces meet exactly', async () => {
    const tool = 10 * 10 * (5 - GAP);
    const { bodies } = await measured([...block(), ...extrudeTool(GAP, 'join')]);
    expect(bodies.map((b) => b.id)).toEqual(['B:0']);
    const [b] = bodies;
    expect(b?.solids).toBe(1);
    expect(b?.valid).toBe(true);
    close(b?.volume ?? 0, BLOCK + tool);
    // The names are those of the same join with the faces exactly on each other.
    const exact = await measured([...block(), ...extrudeTool(0, 'join')]);
    expect(b?.faces).toEqual(exact.bodies[0]?.faces);
    expect(b?.edges).toEqual(exact.bodies[0]?.edges);
    // The block's six faces and the tool's, but its bottom (on the block's top, l2's side).
    expect(b?.faces).toEqual([
      'extrude:B:cap:end',
      'extrude:B:cap:start',
      'extrude:B:side:l11',
      'extrude:B:side:l2',
      'extrude:B:side:l5',
      'extrude:B:side:l8',
      'extrude:T:cap:end',
      'extrude:T:cap:start',
      'extrude:T:side:l11',
      'extrude:T:side:l5',
      'extrude:T:side:l8',
    ]);
  });

  it('a revolve join gives one body, named as when the faces meet exactly', async () => {
    const tool = Math.PI * 16 * (5 - GAP);
    const { bodies } = await measured([...block(), ...revolveTool(GAP, 'join')]);
    expect(bodies.map((b) => b.id)).toEqual(['B:0']);
    const [b] = bodies;
    expect(b?.solids).toBe(1);
    expect(b?.valid).toBe(true);
    close(b?.volume ?? 0, BLOCK + tool);
    const exact = await measured([...block(), ...revolveTool(0, 'join')]);
    expect(b?.faces).toEqual(exact.bodies[0]?.faces);
    expect(b?.edges).toEqual(exact.bodies[0]?.edges);
  });

  it('a combine join gives one body with the target’s id', async () => {
    const tool = 10 * 10 * (5 - GAP);
    const combine: Feature = {
      ...testFeature('K', 'combine'),
      inputs: combineInputs('B:0', ['T:0']),
    };
    const { bodies } = await measured([...block(), ...extrudeTool(GAP, 'new-body'), combine]);
    expect(bodies.map((b) => b.id)).toEqual(['B:0']);
    const [b] = bodies;
    expect(b?.solids).toBe(1);
    expect(b?.valid).toBe(true);
    close(b?.volume ?? 0, BLOCK + tool);
  });

  it('joins a tool just inside the touching distance (the facade fuses at TOUCH too)', async () => {
    const gap = 0.9 * TOUCH;
    const { bodies } = await measured([...block(), ...extrudeTool(gap, 'join')]);
    expect(bodies.map((b) => b.id)).toEqual(['B:0']);
    expect(bodies[0]?.solids).toBe(1);
    expect(bodies[0]?.valid).toBe(true);
  });

  it('a tool 1e-3 mm off is not joined, as before', async () => {
    const extruded = await measured([...block(), ...extrudeTool(FAR, 'join')]);
    expect(extruded.bodies.map((b) => b.id)).toEqual(['B:0', 'T:0']);
    expect(status(extruded.result, 'T')).toMatchObject({
      status: 'warning',
      message: 'Nothing to join to, so the extrude made a new body.',
    });
    const revolved = await measured([...block(), ...revolveTool(FAR, 'join')]);
    expect(revolved.bodies.map((b) => b.id)).toEqual(['B:0', 'R:0']);
    close(revolved.bodies[1]?.volume ?? 0, Math.PI * 16 * (5 - FAR));
    const combine: Feature = {
      ...testFeature('K', 'combine'),
      inputs: combineInputs('B:0', ['T:0']),
    };
    const combined = await run([...block(), ...extrudeTool(FAR, 'new-body'), combine]);
    expect(status(combined, 'K')).toMatchObject({
      status: 'error',
      message:
        "The tool body doesn't touch the target, so it can't be joined. Move them together, or pick another body.",
    });
  });

  it('an exact join is unchanged', async () => {
    ok(await run([...block(), ...extrudeTool(0, 'join')]));
    const { bodies } = await measured([...block(), ...extrudeTool(0, 'join')]);
    expect(bodies.map((b) => b.id)).toEqual(['B:0']);
    close(bodies[0]?.volume ?? 0, BLOCK + 500);
  });
});
