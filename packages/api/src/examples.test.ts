/**
 * The examples are tests (ADR-0068 §6): every design under `docs/api/examples`
 * is built by this file, checked against what the app made where there is a
 * fixture for it, and recomputed with the real kernel where there is a body to
 * measure. `@extrudo/kernel` is a devDependency of this package and of nothing
 * else: the API's own entry never loads OCCT (ADR-0068 §1).
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ExtrudoDocument, SketchData } from '@extrudo/core';
import { Kernel } from '@extrudo/kernel';
import { kernelFeatures, loadOcct, RecomputeEngine } from '@extrudo/kernel/node';
import { readArchive } from '@extrudo/storage';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { b1 } from '../../../docs/api/examples/b1';
import { parametricBox } from '../../../docs/api/examples/parametric-box';
import { wallBracket } from '../../../docs/api/examples/wall-bracket';
import type { Design } from './design';
import { ApiError } from './error';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '../../../fixtures/benchmarks');

/** One benchmark fixture: the `.extrudo` file, read through storage's reader. */
function fixture(name: string): ExtrudoDocument {
  return readArchive(readFileSync(join(FIXTURES, name))).doc;
}

let kernel: Kernel;

beforeAll(async () => {
  kernel = new Kernel(await loadOcct());
});

afterAll(() => {
  kernel.dispose();
});

type Body = { id: string; volume: number; faces: number };

/**
 * Recomputes a design with the real kernel and measures every body it makes:
 * the exact volume and face count, which is what a mesh export can only
 * approximate. The kernel is a test-only dependency here (ADR-0068 §1).
 */
async function compute(d: Design): Promise<Body[]> {
  const engine = new RecomputeEngine(kernel, kernelFeatures(), { strictLeaks: true });
  try {
    const result = await engine.recompute({ doc: d.toJSON() });
    if (result.status !== 'done') throw new Error(`recompute ${result.status}`);
    const problems = Object.entries(result.features).filter(([, status]) => status.status !== 'ok');
    expect(problems).toEqual([]);
    return result.bodies.flatMap((body) => {
      const shape = engine.latestBody(body.id);
      return shape
        ? [
            {
              id: body.id,
              volume: kernel.measure(shape).volume,
              faces: kernel.count(shape, 'face'),
            },
          ]
        : [];
    });
  } finally {
    engine.clear();
  }
}

describe('the wall bracket', () => {
  const design = wallBracket();
  const doc = design.toJSON();

  it('is a valid design with its parameters', () => {
    expect(design.validate()).toEqual([]);
    expect(doc.name).toBe('Wall bracket');
    expect(doc.parameters.map((p) => [p.name, p.expression])).toEqual([
      ['width', '80 mm'],
      ['wall', '2.4 mm'],
      ['inner', 'width - 2 * wall'],
      ['tilt', '15 deg'],
      ['depth', '40 mm'],
      ['height', '60 mm'],
    ]);
    expect(doc.features.map((f) => `${f.type}:${f.name}`)).toEqual([
      'sketch:Sketch1',
      'extrude:Extrude1',
      'fillet:Fillet1',
      'sketch:Sketch2',
      'extrude:Extrude2',
    ]);
  });

  it('gives the same document every time', () => {
    // The timestamps are the one thing a design doesn't own: a clock.
    expect(bytes(wallBracket())).toBe(bytes(design));
  });

  it('is one bracket: the L, rounded, with the two holes cut through the foot', async () => {
    const bodies = await compute(design);
    expect(bodies).toHaveLength(1);
    // The plain L without the rounds or the holes: (40 × 2.4 + 2.4 × 57.6) mm²
    // of section, 80 mm wide. The rounds and the two holes take a little off.
    const section = 40 * 2.4 + 2.4 * 57.6;
    expect(bodies[0]?.volume).toBeGreaterThan(section * 80 * 0.95);
    expect(bodies[0]?.volume).toBeLessThan(section * 80);
    // Eight faces of the L, a round inside and outside, and a wall per hole.
    expect(bodies[0]?.faces).toBe(12);
  });
});

describe('benchmark B1', () => {
  const design = b1();
  const sketchOf = (d: Design): SketchData => {
    const feature = d.doc.features[0];
    if (feature?.type !== 'sketch' || feature.inputs.sketch?.kind !== 'sketchData') {
      throw new Error('the first feature is not a sketch');
    }
    return feature.inputs.sketch.sketch;
  };

  it('draws the sketch the app drew, up to its IDs', () => {
    // The fixture is what the e2e spec exported after drawing B1 with the
    // Rectangle, Circle and Dimension tools.
    const drawn = fixture('b1-plate.extrudo').features[0];
    if (drawn?.type !== 'sketch' || drawn.inputs.sketch?.kind !== 'sketchData') {
      throw new Error('the fixture has no sketch');
    }
    const canonical = (data: SketchData) => JSON.stringify(shape(data));
    expect(canonical(sketchOf(design))).toBe(canonical(drawn.inputs.sketch.sketch));
  });

  it('gives the plate B1 measures: one body, ten faces, the plate less four holes', async () => {
    const bodies = await compute(design);
    expect(bodies).toHaveLength(1);
    expect(bodies[0]?.faces).toBe(10); // two caps, four walls, four hole walls
    // 120 × 80 × 10 mm less four Ø6 holes straight through.
    const expected = 120 * 80 * 10 - 4 * Math.PI * 3 * 3 * 10;
    expect(bodies[0]?.volume).toBeCloseTo(expected, 6);
  });

  it('follows its parameters: the dimensions read them by name', () => {
    // The kernel does not re-solve a sketch (the app does that on open), so what
    // the API holds is the expression each dimension drives itself with.
    const wider = b1();
    wider.setParameter('width', '200 mm');
    const sketch = sketchOf(wider);
    expect(Object.values(sketch.dimensions).map((dim) => dim.expr)).toContain('width');
    expect(wider.getParameter('width').value()).toBe(200);
  });
});

describe('the parametric box', () => {
  it('is a valid design with two configurations of it', () => {
    const d = parametricBox();
    expect(d.validate()).toEqual([]);
    expect(d.doc.configurations?.map((c) => c.name)).toEqual(['Small', 'Large']);
    // The customizer ranges came out with the parameters (ADR-0059).
    const width = d.getParameter('width').parameter?.customizer;
    expect(width).toMatchObject({ min: 60, max: 300, step: 10, group: 'Size' });
  });

  it('switches between its configurations in one step', () => {
    const d = parametricBox();
    d.applyConfiguration('Large');
    expect(d.getParameter('width').expression).toBe('200 mm');
    expect(d.getParameter('wall').expression).toBe('2.4 mm'); // not in the configuration
    d.applyConfiguration('Small');
    expect(d.getParameter('width').expression).toBe('80 mm');
    expect(() => d.applyConfiguration('Enormous')).toThrow(ApiError);
  });

  it('is a hollow box with two holes and rounded rim', async () => {
    const bodies = await compute(parametricBox());
    expect(bodies).toHaveLength(1);
    // A 120 × 80 × 40 box with no top, hollowed to a 2.4 mm wall: the rounded
    // rim and the two Ø4 holes take a little more off.
    const hollow =
      120 * 80 * 40 - (120 - 2 * 2.4) * (80 - 2 * 2.4) * (40 - 2.4) - 2 * Math.PI * 4 * 2.4;
    expect(bodies[0]?.volume).toBeLessThan(hollow);
    expect(bodies[0]?.volume).toBeGreaterThan(hollow * 0.99);
    expect(bodies[0]?.faces).toBeGreaterThan(20);
  });
});

/** A design as `JSON.stringify` writes it, without the timestamps a clock gives. */
function bytes(d: Design): string {
  return JSON.stringify({ ...d.toJSON(), meta: undefined });
}

/** A sketch with every ID replaced by the number of the record it sits in. */
function shape(data: SketchData): unknown {
  const ids = [
    ...Object.keys(data.entities),
    ...Object.keys(data.constraints),
    ...Object.keys(data.dimensions),
  ];
  const name = new Map(ids.map((id, i) => [id, `#${i}`]));
  const rewrite = (key: string, value: unknown): unknown =>
    typeof value === 'string' && key !== 'paramName' ? (name.get(value) ?? value) : value;
  const records = (list: Record<string, Record<string, unknown>>, keep: readonly string[] = []) =>
    Object.entries(list).map(([id, record]) => [
      name.get(id),
      Object.fromEntries(
        Object.entries(record)
          .filter(([key]) => keep.includes(key))
          .map(([key, v]) => [key, rewrite(key, v)]),
      ),
    ]);
  return {
    entities: records(data.entities as Record<string, Record<string, unknown>>),
    constraints: records(data.constraints as Record<string, Record<string, unknown>>),
    // A dimension's label is where a person put it; the API stores none.
    dimensions: records(data.dimensions as Record<string, Record<string, unknown>>, ['paramName']),
  };
}
