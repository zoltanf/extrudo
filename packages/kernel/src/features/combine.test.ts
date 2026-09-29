// The Combine feature (P3-06, ADR-0044, FR-FT-09) through the recompute
// engine with real OCCT: join, cut and intersect of a target with tool
// bodies, keeping the tools, the names both bodies' faces carry into the
// result (ADR-0005), splitting into bodies, and the errors of a combine
// that does nothing. `golden/combine-options.json` is a golden table of
// cases (a Vitest file snapshot); rewrite it with
// `pnpm vitest run -u packages/kernel/src/features/combine` and review the diff.
import {
  type CombineInputOptions,
  combineInputs,
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
import { detectProfiles } from '@extrudo/sketch/profiles';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Kernel, type Vec3 } from '../kernel';
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

function sketch(id: string, data: SketchData): Feature {
  return {
    ...testFeature(id, 'sketch'),
    inputs: sketchInputs(originPlaneRef('origin:xy'), data),
  };
}

/** A `w` × `d` × `h` mm block from (x, y, 0) as body `<id>:0` (sketch `S<id>`, extrude `<id>`). */
function block(id: string, x: number, y: number, w = 40, d = 30, h = 20): Feature[] {
  const b = new SketchBuilder();
  b.line(x, y, x + w, y);
  b.line(x + w, y, x + w, y + d);
  b.line(x + w, y + d, x, y + d);
  b.line(x, y + d, x, y);
  const [found] = detectProfiles(b.sketch);
  if (!found) throw new Error('no profile');
  const profile: GeomRef = { kind: 'profile', id: `S${id}/${found.id}` };
  return [
    sketch(`S${id}`, b.sketch),
    { ...testFeature(id, 'extrude'), inputs: extrudeInputs([profile], { distance: `${h} mm` }) },
  ];
}

const combine = (
  id: string,
  target: string,
  tools: string[],
  options: CombineInputOptions = {},
): Feature => ({
  ...testFeature(id, 'combine'),
  inputs: combineInputs(target, tools, options),
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

const round = (x: number, digits = 3) => {
  const r = Number(x.toFixed(digits));
  return Object.is(r, -0) ? 0 : r;
};

function shapeOf(body: string) {
  const shape = engine.latestBody(body as never);
  if (shape === undefined) throw new Error(`no body ${body}`);
  const props = kernel.properties(shape);
  const r = (v: readonly number[]) => v.map((x) => round(x)) as unknown as Vec3;
  return {
    min: r(props.bbox.min),
    max: r(props.bbox.max),
    volume: round(props.volume),
    faces: kernel.count(shape, 'face'),
    valid: kernel.isValid(shape),
  };
}

const ids = (result: Done) => result.bodies.map((b) => b.id);
const faceNames = (result: Done, body: string) =>
  result.bodies.find((b) => b.id === body)?.mesh?.faceIds ?? [];

// A: x 0…40; B overlaps it at x 30…70 (10 mm of overlap); C touches B at x 70…110.
const A = block('A', 0, 0);
const B = block('B', 30, 0);
const C = block('C', 70, 0);
const OVERLAP = 10 * 30 * 20;

// --------------------------------------------------------------------- join

describe('combine join', { timeout: 120_000 }, () => {
  it('fuses the tool into the target and consumes the tool', async () => {
    const result = ok(await run([...A, ...B, combine('K', 'A:0', ['B:0'])]));
    expect(ids(result)).toEqual(['A:0']);
    // The flush sides merge: a 70 × 30 × 20 block again.
    expect(shapeOf('A:0')).toMatchObject({
      min: [0, 0, 0],
      max: [70, 30, 20],
      volume: 2 * 24_000 - OVERLAP,
      faces: 6,
      valid: true,
    });
  });

  it("carries both bodies' face names into the result", async () => {
    const result = ok(await run([...A, ...B, combine('K', 'A:0', ['B:0'])]));
    const names = faceNames(result, 'A:0');
    // The merged cap keeps the target's name; the tool's end face keeps its own.
    expect(names).toContain('extrude:A:cap:end');
    expect(names.some((n) => n.startsWith('extrude:B:side:'))).toBe(true);
  });

  it('keeps the tools when asked: the bodies overlap', async () => {
    const result = ok(await run([...A, ...B, combine('K', 'A:0', ['B:0'], { keepTools: true })]));
    expect(ids(result)).toEqual(['A:0', 'B:0']);
    expect(shapeOf('B:0')).toMatchObject({ min: [30, 0, 0], max: [70, 30, 20], volume: 24_000 });
    expect(shapeOf('A:0').volume).toBe(2 * 24_000 - OVERLAP);
  });

  it('reaches tools that only touch another tool, in any order', async () => {
    for (const tools of [
      ['B:0', 'C:0'],
      ['C:0', 'B:0'],
    ]) {
      const result = ok(await run([...A, ...B, ...C, combine('K', 'A:0', tools)]));
      expect(ids(result)).toEqual(['A:0']);
      expect(shapeOf('A:0')).toMatchObject({ min: [0, 0, 0], max: [110, 30, 20], faces: 6 });
    }
  });

  it("refuses a tool that doesn't touch anything", async () => {
    const far = block('D', 200, 0);
    const result = await run([...A, ...far, combine('K', 'A:0', ['D:0'])]);
    expect(status(result, 'K').status).toBe('error');
    expect(status(result, 'K').message).toMatch(/doesn't touch the target/);
    expect(ids(result)).toEqual(['A:0', 'D:0']);
  });
});

// ---------------------------------------------------------------------- cut

describe('combine cut', { timeout: 120_000 }, () => {
  it('subtracts the tool and consumes it', async () => {
    const result = ok(await run([...A, ...B, combine('K', 'A:0', ['B:0'], { operation: 'cut' })]));
    expect(ids(result)).toEqual(['A:0']);
    expect(shapeOf('A:0')).toMatchObject({
      min: [0, 0, 0],
      max: [30, 30, 20],
      volume: 24_000 - OVERLAP,
      faces: 6,
      valid: true,
    });
  });

  it('keeps the tool when asked', async () => {
    const result = ok(
      await run([...A, ...B, combine('K', 'A:0', ['B:0'], { operation: 'cut', keepTools: true })]),
    );
    expect(ids(result)).toEqual(['A:0', 'B:0']);
    expect(shapeOf('B:0').volume).toBe(24_000);
  });

  it('a cut that separates the target makes a body per piece', async () => {
    // A slab through the middle of A: x 15…25, over the whole depth and height.
    const slab = block('S', 15, -5, 10, 40, 30);
    const result = ok(
      await run([...A, ...slab, combine('K', 'A:0', ['S:0'], { operation: 'cut' })]),
    );
    expect(ids(result)).toEqual(['A:0', 'K:0']);
    expect(shapeOf('A:0').volume + shapeOf('K:0').volume).toBe(24_000 - 10 * 30 * 20);
  });

  it('cuts with several tools', async () => {
    const hole1 = block('H', 5, 5, 5, 5, 20);
    const hole2 = block('I', 20, 5, 5, 5, 20);
    const result = ok(
      await run([
        ...A,
        ...hole1,
        ...hole2,
        combine('K', 'A:0', ['H:0', 'I:0'], { operation: 'cut' }),
      ]),
    );
    expect(ids(result)).toEqual(['A:0']);
    expect(shapeOf('A:0').volume).toBe(24_000 - 2 * 5 * 5 * 20);
  });

  it('refuses a cut that removes nothing or everything', async () => {
    const far = block('D', 200, 0);
    const nothing = await run([...A, ...far, combine('K', 'A:0', ['D:0'], { operation: 'cut' })]);
    expect(status(nothing, 'K').message).toMatch(/removes nothing/);
    const big = block('E', -10, -10, 100, 100, 100);
    const all = await run([...A, ...big, combine('K', 'A:0', ['E:0'], { operation: 'cut' })]);
    expect(status(all, 'K').message).toMatch(/whole target/);
  });
});

// ---------------------------------------------------------------- intersect

describe('combine intersect', { timeout: 120_000 }, () => {
  it('keeps what the target shares with the tool', async () => {
    const result = ok(
      await run([...A, ...B, combine('K', 'A:0', ['B:0'], { operation: 'intersect' })]),
    );
    expect(ids(result)).toEqual(['A:0']);
    expect(shapeOf('A:0')).toMatchObject({
      min: [30, 0, 0],
      max: [40, 30, 20],
      volume: OVERLAP,
      valid: true,
    });
  });

  it('takes the tools together', async () => {
    // A ∩ (B ∪ E) with E at x -10…10: two separate pieces of A.
    const e = block('E', -10, 0, 20);
    const result = ok(
      await run([
        ...A,
        ...B,
        ...e,
        combine('K', 'A:0', ['B:0', 'E:0'], { operation: 'intersect' }),
      ]),
    );
    expect(ids(result)).toEqual(['A:0', 'K:0']);
    expect(shapeOf('A:0').volume).toBe(OVERLAP);
    expect(shapeOf('K:0').volume).toBe(10 * 30 * 20);
  });

  it("refuses tools that don't overlap the target", async () => {
    const far = block('D', 200, 0);
    const result = await run([
      ...A,
      ...far,
      combine('K', 'A:0', ['D:0'], { operation: 'intersect' }),
    ]);
    expect(status(result, 'K').message).toMatch(/nothing is left after intersecting/);
  });
});

// ------------------------------------------------------------------- errors

describe('combine errors', { timeout: 120_000 }, () => {
  it('says what is missing', async () => {
    const noTarget = await run([
      ...A,
      ...B,
      {
        ...testFeature('K', 'combine'),
        inputs: { ...combineInputs('A:0', ['B:0']), target: { kind: 'ref', refs: [] } },
      },
    ]);
    expect(status(noTarget, 'K').message).toBe('Pick the target body.');
    const noTools = await run([...A, ...B, combine('K', 'A:0', [])]);
    expect(status(noTools, 'K').message).toBe('Pick at least one tool body.');
    const same = await run([...A, ...B, combine('K', 'A:0', ['A:0'])]);
    expect(status(same, 'K').message).toMatch(/can't be one of its own tools/);
  });

  it('a body that is gone is a lost reference', async () => {
    const result = await run([...A, combine('K', 'A:0', ['Z:0'])]);
    expect(status(result, 'K').status).toBe('error');
    expect(status(result, 'K').message).toMatch(/tool body no longer exists/);
    expect(status(result, 'K').refs?.[0]).toMatchObject({
      ref: { kind: 'body', id: 'Z:0' },
      state: 'lost',
    });
    const target = await run([...B, combine('K', 'A:0', ['B:0'])]);
    expect(status(target, 'K').message).toMatch(/target body no longer exists/);
  });

  it('a later feature can pick the result: combine, then move', async () => {
    const result = await run([
      ...A,
      ...B,
      combine('K', 'A:0', ['B:0']),
      {
        ...testFeature('M', 'move'),
        inputs: {
          bodies: { kind: 'ref', refs: [{ kind: 'body', id: 'A:0' }] },
          dx: { kind: 'expr', expr: '10 mm', unit: 'length' },
        },
      },
    ]);
    expect(status(result, 'M').status).toBe('ok');
    expect(shapeOf('A:0').min).toEqual([10, 0, 0]);
  });
});

// -------------------------------------------------------------- golden table

describe('combine golden table', { timeout: 240_000 }, () => {
  const cases: [string, Feature[]][] = [];
  const spheres = block('D', 5, 5, 10, 10, 10);
  for (const operation of ['join', 'cut', 'intersect'] as const) {
    for (const keepTools of [false, true]) {
      cases.push([
        `${operation} overlapping keepTools=${keepTools}`,
        [...A, ...B, combine('K', 'A:0', ['B:0'], { operation, keepTools })],
      ]);
      cases.push([
        `${operation} inside keepTools=${keepTools}`,
        [...A, ...spheres, combine('K', 'A:0', ['D:0'], { operation, keepTools })],
      ]);
    }
    cases.push([
      `${operation} two tools`,
      [...A, ...B, ...C, combine('K', 'A:0', ['B:0', 'C:0'], { operation })],
    ]);
  }

  it('every case computes, with the bodies, faces and boxes of its golden', async () => {
    const table: Record<string, unknown> = {};
    for (const [name, features] of cases) {
      engine.clear();
      const result = await run(features);
      const problems = Object.entries(result.features).filter(([, s]) => s.status === 'error');
      table[name] = {
        errors: problems.map(([id, s]) => `${id}: ${s.message}`),
        bodies: result.bodies.map((b) => ({ id: b.id, ...shapeOf(b.id) })),
      };
    }
    await expect(`${JSON.stringify(table, null, 2)}\n`).toMatchFileSnapshot(
      './golden/combine-options.json',
    );
  });
});
