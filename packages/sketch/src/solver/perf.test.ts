/**
 * P1-03's performance criteria (ADR-0002, ADR-0011):
 * - a drag step in a 200-entity sketch of independent components: < 8 ms;
 * - a drag step in one component of up to 100 entities: < 16 ms;
 * - the gear outline (one closed loop of 104 curves): measured and recorded.
 *
 * The pointer moves off the path the point can follow (as a real pointer
 * does), which is what makes planegcs's drag solve iterate.
 *
 * Always runs as a regression guard, with slack for CI runners and parallel
 * test files. `BENCH=1 pnpm vitest run packages/sketch/src/solver/perf.test.ts`
 * takes more samples, drags the gear too (seconds per step), and writes
 * `packages/sketch/bench/results.json`, the numbers ADR-0011 records.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { type SketchData, SketchDataSchema } from '@extrudo/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { gear, plate, type SketchBuilder } from '../fixtures';
import { loadPlanegcs, type PlanegcsModule } from './module';
import { SketchSolver } from './solver';

const BENCH = process.env.BENCH === '1';
/** Budgets hold on the reference laptop; the guard allows this much more. */
const SLACK = BENCH ? 1 : process.env.CI ? 4 : 2;

let module: PlanegcsModule;
beforeAll(async () => {
  module = await loadPlanegcs();
});

interface Stats {
  median: number;
  p95: number;
  max: number;
}
interface Measured {
  entities: number;
  components: number;
  dof: number;
  /** Opening: build and solve every component from a perturbed start. */
  open: number;
  /** One drag step: move the pointer, solve the dragged component, read it back. */
  drag?: Stats & { steps: number; failed: number };
  /** A dimension value change: its component re-solves, no rebuild (includes mapping the whole sketch). */
  dimension: number;
  /** Test-solve of a constraint that fits (the dragged point's missing dimension). */
  check: number;
  /** Test-solve of one that conflicts (fixing the dragged point): planegcs's slow path. */
  checkConflict: number;
}
const results: Record<string, Measured> = {};

const time = (fn: () => void) => {
  const start = performance.now();
  fn();
  return performance.now() - start;
};

const stats = (samples: number[]): Stats => {
  const s = [...samples].sort((a, b) => a - b);
  const at = (q: number) => s[Math.min(s.length - 1, Math.floor(q * s.length))] ?? 0;
  return { median: at(0.5), p95: at(0.95), max: s.at(-1) ?? 0 };
};

type Pointer = (i: number, start: { x: number; y: number }) => { x: number; y: number };

function measure(
  name: string,
  builder: SketchBuilder,
  entities: number,
  dragPoint: string,
  steps: number,
  pointer: Pointer,
): Measured {
  const solver = new SketchSolver(module);
  try {
    const sketch = SketchDataSchema.parse(builder.sketch);
    let result = solver.solve(sketch, builder.values);
    const open = time(() => {
      // A second solver measures opening from scratch (the first warmed the module up).
      using fresh = new SketchSolver(module);
      result = fresh.solve(sketch, builder.values);
    });
    expect(result.ok).toBe(true);
    const solved = result.solution;
    const start = solved.points[dragPoint] as { x: number; y: number };

    let drag: Measured['drag'];
    if (steps > 0) {
      expect(solver.beginDrag(dragPoint)).toBe(true);
      const samples: number[] = [];
      let failed = 0;
      for (let i = 1; i <= steps; i++) {
        const { x, y } = pointer(i, start);
        samples.push(
          time(() => {
            if (!solver.drag(x, y).ok) failed++;
          }),
        );
      }
      solver.endDrag();
      drag = { ...stats(samples), steps, failed };
    }
    solver.solve(sketch, builder.values);

    // Medians of a few samples: single ones are dominated by the JIT warming up.
    const median = (n: number, fn: (i: number) => void) =>
      stats(Array.from({ length: n }, (_, i) => time(() => fn(i)))).median;
    const dimensionId = Object.keys(builder.values).at(-1) as string;
    const dimension = median(9, (i) => {
      solver.solve(sketch, {
        ...builder.values,
        [dimensionId]: (builder.values[dimensionId] as number) * (i % 2 ? 1 : 1.01),
      });
    });

    // The curve that owns the dragged point lacks one dimension: add it back.
    const [ownerId, owner] = Object.entries(sketch.entities).find(
      ([, e]) => (e.type === 'line' || e.type === 'arc') && e.end === dragPoint,
    ) as [string, SketchData['entities'][keyof SketchData['entities']]];
    const p = (id: string) => solved.points[id] as { x: number; y: number };
    const fits =
      owner.type === 'line'
        ? {
            dimension: { type: 'distance', orientation: 'aligned', a: ownerId },
            value: Math.hypot(p(owner.end).x - p(owner.start).x, p(owner.end).y - p(owner.start).y),
          }
        : owner.type === 'arc'
          ? {
              dimension: { type: 'radius', curve: ownerId },
              value: Math.hypot(
                p(owner.end).x - p(owner.center).x,
                p(owner.end).y - p(owner.center).y,
              ),
            }
          : undefined;
    if (!fits) throw new Error(`${name}: the dragged point has no owner curve`);
    const withDimension = {
      ...sketch,
      dimensions: {
        ...sketch.dimensions,
        dprobe: { ...fits.dimension, expr: '', driven: false },
      },
    } as SketchData;
    let accepted = false;
    const check = median(3, () => {
      accepted = solver.check(
        withDimension,
        { ...builder.values, dprobe: fits.value },
        'dprobe',
      ).accepted;
    });
    expect(accepted).toBe(true);

    const withFix = {
      ...sketch,
      constraints: { ...sketch.constraints, kprobe: { type: 'fix', entity: dragPoint } },
    } as SketchData;
    const checkConflict = time(() => {
      accepted = solver.check(withFix, builder.values, 'kprobe').accepted;
    });
    expect(accepted).toBe(false);

    const measured: Measured = {
      entities,
      components: result.components.length,
      dof: result.dof,
      open,
      ...(drag ? { drag } : {}),
      dimension,
      check,
      checkConflict,
    };
    results[name] = measured;
    return measured;
  } finally {
    solver.dispose();
  }
}

describe('solver performance', { timeout: 600_000 }, () => {
  it('drags at 200 entities in independent components in < 8 ms', () => {
    const { builder, entities, dragPoint } = plate({
      entities: 200,
      layout: 'anchored',
      noise: 2,
      freeLastHeight: true,
    });
    const m = measure('anchored-198', builder, entities, dragPoint, BENCH ? 400 : 60, (i, s) => ({
      x: s.x + 3,
      y: s.y + 10 * Math.sin(i / 10),
    }));
    expect(m.components).toBe(22);
    expect(m.drag?.failed).toBe(0);
    expect(m.drag?.median).toBeLessThan(8 * SLACK);
  });

  it('drags one component of 100 entities in < 16 ms', () => {
    const { builder, entities, dragPoint } = plate({
      entities: 100,
      layout: 'chained',
      noise: 2,
      freeLastHeight: true,
    });
    const m = measure('chained-99', builder, entities, dragPoint, BENCH ? 400 : 30, (i, s) => ({
      x: s.x + 3,
      y: s.y + 10 * Math.sin(i / 10),
    }));
    expect(m.components).toBe(1);
    expect(m.drag?.failed).toBe(0);
    expect(m.drag?.median).toBeLessThan(16 * SLACK);
  });

  // The 104-curve gear takes seconds per drag step and ~10 s to test a conflict: benchmark only.
  for (const teeth of BENCH ? [13, 26] : [13]) {
    it(`measures a gear outline (one loop of ${4 * teeth} curves)`, () => {
      const { builder, entities, dragPoint } = gear({ teeth, noise: 0.2, freeTip: true });
      // Pull the tip corner inward and a little sideways: it can only move along one path.
      const pointer: Pointer = (i, s) => {
        const k = 1 - 0.02 * (1 - Math.cos(i / 4));
        return { x: s.x * k + 0.3, y: s.y * k };
      };
      const m = measure(`gear-${4 * teeth}`, builder, entities, dragPoint, BENCH ? 20 : 0, pointer);
      expect(m.components).toBe(1);
      expect(m.dof).toBe(1);
    });
  }
});

afterAll(() => {
  if (!BENCH) return;
  const dir = new URL('../../bench/', import.meta.url);
  mkdirSync(dir, { recursive: true });
  const round = (v: unknown): unknown =>
    typeof v === 'number'
      ? Math.round(v * 100) / 100
      : v && typeof v === 'object'
        ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, round(x)]))
        : v;
  const report = {
    note: 'Milliseconds. Node, main thread, our planegcs build (packages/sketch/planegcs). See ADR-0011.',
    date: new Date().toISOString().slice(0, 10),
    node: process.version,
    results: round(results),
  };
  writeFileSync(new URL('results.json', dir), `${JSON.stringify(report, null, 2)}\n`);
  console.table(
    Object.fromEntries(
      Object.entries(results).map(([k, m]) => [
        k,
        {
          components: m.components,
          open: m.open.toFixed(1),
          'drag median': m.drag?.median.toFixed(2),
          'drag p95': m.drag?.p95.toFixed(2),
          'drag failed': m.drag ? `${m.drag.failed}/${m.drag.steps}` : '',
          dimension: m.dimension.toFixed(1),
          check: m.check.toFixed(1),
          'check (conflict)': m.checkConflict.toFixed(0),
        },
      ]),
    ),
  );
});
