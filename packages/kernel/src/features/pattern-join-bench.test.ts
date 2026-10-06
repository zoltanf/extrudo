// P4-12 backlog (ADR-0047): a cheaper join of many interfering pattern copies.
// Measurement only: `BENCH=1 pnpm vitest run
// packages/kernel/src/features/pattern-join-bench.test.ts` prints a table of
// four joins and, per case, the `Kernel` methods the recompute spent its time
// in (as `pattern-bench.test.ts` does). The whole document recompute is timed;
// `BENCH_ONLY` runs one case (`a`|`b`|`c`|`d`).
import {
  type CircularOptions,
  circularPatternInputs,
  extrudeInputs,
  type Feature,
  type GeomRef,
  originAxisRef,
  originPlaneRef,
  type PrimitiveInputOptions,
  primitiveInputs,
  type RectangularOptions,
  rectangularPatternInputs,
  type SketchData,
  sketchInputs,
} from '@extrudo/core';
import { SketchBuilder } from '@extrudo/sketch/fixtures';
import { detectProfiles } from '@extrudo/sketch/profiles';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Kernel } from '../kernel';
import { loadOcct } from '../occt/load';
import { RecomputeEngine } from '../recompute/engine';
import { testDocument, testFeature, testFeatures } from '../recompute/testing';
import type { RecomputeResult } from '../recompute/types';

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env;

let kernel: Kernel;
beforeAll(async () => {
  kernel = new Kernel(await loadOcct());
});
afterAll(() => kernel?.dispose());

const XY = originPlaneRef('origin:xy');
const AXIS_X = originAxisRef('origin:x');
const AXIS_Y = originAxisRef('origin:y');
const AXIS_Z = originAxisRef('origin:z');

function sketch(id: string, data: SketchData): Feature {
  return { ...testFeature(id, 'sketch'), inputs: sketchInputs(XY, data) };
}

/** A `w` × `d` × `h` block from (x, y, 0) as body `<id>:0`. */
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

const primitive = (
  id: string,
  type: 'box' | 'cylinder',
  options: PrimitiveInputOptions = {},
): Feature => ({ ...testFeature(id, type), inputs: primitiveInputs(type, options) });

/** A 120 × 120 × 10 plate, body `L:0`. */
const plate = () => block('L', 0, 0, 120, 120, 10);

/** A 6 × 6 × 5 box boss joined on the plate's top, centred at (x, y). */
const boss = (id: string, x: number, y: number): Feature =>
  primitive(id, 'box', {
    numbers: {
      length: '6 mm',
      width: '6 mm',
      height: '5 mm',
      x: `${x} mm`,
      y: `${y} mm`,
      offset: '10 mm',
    },
    operation: 'join',
  });

/** A Ø6 × 5 cylinder boss joined on the plate's top, centred at (x, y). */
const cylBoss = (id: string, x: number, y: number): Feature =>
  primitive(id, 'cylinder', {
    numbers: { diameter: '6 mm', height: '5 mm', x: `${x} mm`, y: `${y} mm`, offset: '10 mm' },
    operation: 'join',
  });

const rect = (id: string, o: RectangularOptions): Feature => ({
  ...testFeature(id, 'rectangularPattern'),
  inputs: rectangularPatternInputs(o),
});
const circ = (id: string, o: CircularOptions): Feature => ({
  ...testFeature(id, 'circularPattern'),
  inputs: circularPatternInputs(o),
});

/** The A block: 40 × 30 × 20, so a bodies grid at 40/30 mm pitch touches. */
const A = block('A', 0, 0);

interface Case {
  name: string;
  features: Feature[];
}

const CASES: Record<string, Case> = {
  // (a) a rectangular pattern of a joined boss feature, 10 × 10 overlapping.
  a: {
    name: 'features join, 10x10 overlapping bosses (4 mm pitch)',
    features: [
      ...plate(),
      boss('B', 10, 10),
      rect('P', {
        features: ['B'],
        direction1: AXIS_X,
        count1: '10',
        distance1: '4 mm',
        direction2: AXIS_Y,
        count2: '10',
        distance2: '4 mm',
      }),
    ],
  },
  // (b) the same, touching but not overlapping (6 mm pitch for 6 mm bosses).
  b: {
    name: 'features join, 10x10 touching bosses (6 mm pitch)',
    features: [
      ...plate(),
      boss('B', 10, 10),
      rect('P', {
        features: ['B'],
        direction1: AXIS_X,
        count1: '10',
        distance1: '6 mm',
        direction2: AXIS_Y,
        count2: '10',
        distance2: '6 mm',
      }),
    ],
  },
  // (c) a bodies pattern joined into the original, 2 × 20 touching copies (B5's case).
  c: {
    name: 'bodies join, 2x20 touching copies (40/30 mm pitch)',
    features: [
      ...A,
      rect('P', {
        bodies: ['A:0'],
        direction1: AXIS_X,
        count1: '2',
        distance1: '40 mm',
        direction2: AXIS_Y,
        count2: '20',
        distance2: '30 mm',
        join: true,
      }),
    ],
  },
  // (d) a circular pattern of 36 overlapping joined cylinder bosses.
  d: {
    name: 'features join, circular 36 overlapping cylinder bosses',
    features: [
      ...plate(),
      cylBoss('B', 20, 0),
      circ('C', { features: ['B'], axis: AXIS_Z, count: '36' }),
    ],
  },
};

describe.runIf(env?.BENCH)('pattern joins', () => {
  it('times four joins and where their time went', { timeout: 900_000 }, async () => {
    const only = env?.BENCH_ONLY;
    const table: string[] = [];
    for (const [key, testCase] of Object.entries(CASES)) {
      if (only && only !== key) continue;
      // Fresh engine: a feature's cache would otherwise answer immediately.
      const spent = new Map<string, { ms: number; calls: number }>();
      const proto = Object.getPrototypeOf(kernel) as Record<string, unknown>;
      const originals = new Map<string, unknown>();
      for (const name of Object.getOwnPropertyNames(proto)) {
        const fn = proto[name];
        if (name === 'constructor' || typeof fn !== 'function') continue;
        originals.set(name, fn);
        proto[name] = function (this: unknown, ...args: unknown[]) {
          const start = performance.now();
          try {
            return (fn as (...a: unknown[]) => unknown).apply(this, args);
          } finally {
            const caller = new Error().stack?.split('\n')[2]?.trim().split(' ')[1] ?? '?';
            const k = name === 'distance' ? `${name}<${caller}>` : name;
            const entry = spent.get(k) ?? { ms: 0, calls: 0 };
            entry.ms += performance.now() - start;
            entry.calls++;
            spent.set(k, entry);
          }
        };
      }
      const engine = new RecomputeEngine(kernel, testFeatures().registry, { strictLeaks: true });
      const start = performance.now();
      let result: RecomputeResult | undefined;
      try {
        result = await engine.recompute({ doc: testDocument(testCase.features) });
      } finally {
        engine.clear();
        for (const [name, fn] of originals) proto[name] = fn;
      }
      const ms = Math.round(performance.now() - start);
      const patternStatus =
        result?.status === 'done'
          ? result.features[
              (testCase.features[testCase.features.length - 1] as Feature).id as never
            ]?.status
          : result?.status;
      const top = [...spent]
        .sort((a, b) => b[1].ms - a[1].ms)
        .slice(0, 8)
        .map(([name, { ms: t, calls }]) => `${name} ${Math.round(t)}ms(${calls})`);
      table.push(`${key}: ${testCase.name}\n    ${ms} ms, ${patternStatus}\n    ${top.join('; ')}`);
    }
    // The report is the failure message (Vitest can swallow console output).
    expect(table.join('\n')).toBe('');
  });
});
