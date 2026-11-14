/**
 * The caps of S7 at their worst (P6-25, ADR-0144's S7 amendment): the
 * slowest rebuild a file can ask for within them, measured on this machine
 * with `BENCH=1` (numbers in the amendment). Without it only the caps' own
 * values are checked.
 */
import { MAX_PATTERN_INSTANCES } from '@extrudo/core';
import { loadPlanegcs, type PlanegcsModule, SketchSolver } from '@extrudo/sketch';
import { beforeAll, describe, expect, it } from 'vitest';
import { MAX_TRANSFORM_INSTANCES } from './features';
import { MAX_HOLE_CENTRES } from './holes';
import { importFcstd } from './import';
import { nodeImportKernel } from './node-kernel-test-support';
import { P, type PartChange, type PartOptions, partFile } from './pattern-parts';
import { circle } from './sketch-fixtures';

const bench = process.env.BENCH === '1';

it("the instance cap is within Extrudo's own pattern's", () => {
  expect(MAX_TRANSFORM_INSTANCES).toBeLessThanOrEqual(MAX_PATTERN_INSTANCES);
});

describe.skipIf(!bench)('the slowest rebuild at each cap (BENCH=1)', () => {
  let planegcs: PlanegcsModule;
  beforeAll(async () => {
    planegcs = await loadPlanegcs();
  });
  const time = async (what: string, name: string, change: PartChange, part: PartOptions = {}) => {
    const t = performance.now();
    const r = await importFcstd(partFile(name, change, part), 'Bench', {
      kernel: nodeImportKernel(),
      solver: new SketchSolver(planegcs),
    });
    const ms = performance.now() - t;
    const [body] = r.report.bodies;
    console.log(
      what,
      `${(ms / 1000).toFixed(1)} s`,
      body?.stop?.reason ?? 'held',
      body?.stop?.detail ?? '',
    );
    return { ms, body };
  };
  const integer = (v: number) => P.raw(`<Integer value="${v}"/>`);
  const float = (v: number) => P.raw(`<Float value="${v}"/>`);

  it('a 25 × 20 grid of pockets that overlap their neighbours', async () => {
    const { body } = await time('grid 25 x 20, overlapping', 'linear_two_directions', {
      LinearPattern: {
        props: {
          Occurrences: integer(25),
          Occurrences2: integer(20),
          Length: float(27.3),
          Length2: float(7.2),
        },
      },
    });
    expect(body?.stop?.reason).not.toBe('kernel');
  }, 600_000);

  it('a 25 × 20 grid of pockets apart', async () => {
    const { body } = await time('grid 25 x 20, apart', 'linear_two_directions', {
      LinearPattern: {
        props: {
          Occurrences: integer(25),
          Occurrences2: integer(20),
          Length: float(390),
          Length2: float(240),
        },
      },
    });
    expect(body?.stop?.reason).not.toBe('kernel');
  }, 600_000);

  it('500 pockets round a turn, overlapping', async () => {
    const { body } = await time('polar 500', 'polar_full', {
      PolarPattern: { props: { Occurrences: integer(MAX_TRANSFORM_INSTANCES) } },
    });
    expect(body?.stop?.reason).not.toBe('kernel');
  }, 600_000);

  it('200 holes, counterbored, through', async () => {
    const many = Array.from({ length: MAX_HOLE_CENTRES }, (_, i) =>
      circle(-19 + (i % 20) * 2, -9 + Math.floor(i / 20) * 1.9, 0.4),
    );
    const { body } = await time(
      'holes 200',
      'hole_counterbore',
      {
        Hole: {
          props: { Diameter: float(0.5), HoleCutDiameter: float(0.9), HoleCutDepth: float(1) },
        },
      },
      { sketchGeometry: { HoleSketch: many } },
    );
    expect(body?.stop?.reason).not.toBe('kernel');
  }, 600_000);
});
