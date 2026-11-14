/**
 * The references slice's caps measured (P6-25 S9, ADR-0144): run with
 * `BENCH=1`. A body of `n` pockets, each up to a datum plane of its own (the
 * fixture `pad_up_to_datum_plane`'s boss repeated: each joins the same solid, so each holds), brings
 * in `n` datums.
 */
import { loadPlanegcs, SketchSolver } from '@extrudo/sketch';
import { describe, expect, it } from 'vitest';
import { importFcstd } from './import';
import { nodeImportKernel } from './node-kernel-test-support';
import type { FixtureProp, PatternFixtureCase, PatternFixtureObject } from './pattern-fixtures';
import { partFile } from './pattern-parts';
import { REF_BREP, REF_CASES, REF_PROPS } from './reference-fixtures';
import { MAX_DATUMS } from './transforms';

/** `n` pads after the fixture's own, each up to a datum plane of its own. */
export function manyDatums(n: number): Uint8Array {
  const c = REF_CASES.pad_up_to_datum_plane as PatternFixtureCase;
  const of = (name: string) => c.objects.find((o) => o.object === name) as PatternFixtureObject;
  const [datum, sketch, pocket] = [of('DatumPlane'), of('BossSketch'), of('Boss')];
  const props: (readonly FixtureProp[])[] = [...REF_PROPS];
  const objects = [...c.objects];
  const group = [...c.group];
  let previous = 'Boss';
  for (let i = 1; i <= n; i++) {
    const [d, s, p] = [`DatumPlane${i}`, `BossSketch${i}`, `Boss${i}`];
    objects.push({ ...datum, object: d }, { ...sketch, object: s });
    props.push(
      (REF_PROPS[pocket.props as number] as readonly FixtureProp[]).map(
        (x): FixtureProp =>
          x[0] === 'UpToFace'
            ? [x[0], x[1], { sub: [d, ['']] }]
            : x[0] === 'Profile'
              ? [x[0], x[1], { sub: [s, []] }]
              : x[0] === 'BaseFeature'
                ? [x[0], x[1], { link: previous }]
                : x,
      ),
    );
    objects.push({ ...pocket, object: p, props: props.length - 1 });
    group.push(d, s, p);
    previous = p;
  }
  const cases = { many: { ...c, objects, group, tip: previous } };
  return partFile('many', {}, { fixtures: { cases, brep: REF_BREP, props } });
}

describe.skipIf(!process.env.BENCH)('S9 caps, measured', () => {
  // The fixture's own datum and `n` more: at `MAX_DATUMS - 1` the import brings in the most it may.
  it.each([10, 50, MAX_DATUMS - 1, MAX_DATUMS])(
    '%i pads, each up to its own datum plane',
    async (n) => {
      const planegcs = await loadPlanegcs();
      const t = performance.now();
      const r = await importFcstd(manyDatums(n), 'Parts', {
        kernel: nodeImportKernel(),
        solver: new SketchSolver(planegcs),
        maxBodyFeatures: 2_000,
      });
      const ms = performance.now() - t;
      const body = r.report.bodies[0];
      console.log(
        `S9TIME ${n} datums: ${Math.round(ms)} ms, ${body?.mapped.length} held, stop ${body?.stop?.reason ?? 'none'}`,
      );
      if (n < MAX_DATUMS) expect(body?.stop).toBeUndefined();
      else expect(body?.stop).toMatchObject({ reason: 'limit' });
    },
    600_000,
  );
});
