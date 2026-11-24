/**
 * The parameters slice's caps measured (P6-25 S10, ADR-0144): run with
 * `BENCH=1`. A design with `n` user parameters (a chain of cells, each the
 * one before plus one, and the plate's own), what it costs to import, to
 * evaluate and to open; a sheet of a million cells; an expression of 1 MB.
 */
import { evaluateParameters, loadDocument } from '@extrudo/core';
import { loadPlanegcs, SketchSolver } from '@extrudo/sketch';
import { describe, expect, it } from 'vitest';
import { importFcstd } from './import';
import { nodeImportKernel } from './node-kernel-test-support';
import { paramFile, sheetObject } from './parameter-parts';

const chain = (n: number) =>
  sheetObject(
    'Chain',
    'Chain',
    Array.from({ length: n }, (_, i): [string, string, string] =>
      i === 0 ? ['A1', '1', 'v_0'] : [`A${i + 1}`, `=v_${i - 1} + 1`, `v_${i}`],
    ),
  );

describe.skipIf(!process.env.BENCH)('S10 caps, measured', () => {
  it.each([100, 1_000, 10_000])(
    'a chain of %i parameters',
    async (n) => {
      const planegcs = await loadPlanegcs();
      let t = performance.now();
      const r = await importFcstd(paramFile('sheet_plate', { extra: [chain(n)] }), 'Parts', {
        kernel: nodeImportKernel(),
        solver: new SketchSolver(planegcs),
        maxParameters: 20_000,
      });
      const imported = performance.now() - t;
      const doc = r.design.toJSON();
      t = performance.now();
      const e = evaluateParameters(doc);
      const evaluated = performance.now() - t;
      t = performance.now();
      loadDocument(JSON.parse(JSON.stringify(doc)));
      const opened = performance.now() - t;
      expect(e.parameters.get(`v_${n - 1}`)?.result).toMatchObject({ ok: true, value: n });
      console.log(
        `${n} parameters: import ${Math.round(imported)} ms, evaluate ${evaluated.toFixed(1)} ms, open ${opened.toFixed(1)} ms, rule rounds ${r.report.parameters.rounds}, heap ${Math.round(process.memoryUsage().heapUsed / 2 ** 20)} MB`,
      );
    },
    600_000,
  );

  it('a sheet of 900,000 cells (the XML reader reads a million elements)', async () => {
    const cells = Array.from({ length: 900_000 }, (_, i): [string, string] => [`A${i + 1}`, '1']);
    const file = paramFile('sheet_plate', { extra: [sheetObject('Big', 'Big', cells)] });
    const planegcs = await loadPlanegcs();
    const t = performance.now();
    const r = await importFcstd(file, 'Parts', {
      kernel: nodeImportKernel(),
      solver: new SketchSolver(planegcs),
    });
    console.log(
      `900,000 cells (${Math.round(file.length / 1024)} KB zipped): import ${Math.round(performance.now() - t)} ms, ${r.report.parameters.leftOut
        .filter((x) => x.object === 'Big')
        .map((x) => x.detail)
        .join('; ')}`,
    );
  }, 600_000);

  it('an expression of 1 MB', async () => {
    const planegcs = await loadPlanegcs();
    const t = performance.now();
    const r = await importFcstd(
      paramFile('sheet_plate', {
        edit: (o, xml) =>
          o === 'Pad' ? xml.replace('&lt;&lt;Params&gt;&gt;.height', '1+'.repeat(512 * 1024)) : xml,
      }),
      'Parts',
      { kernel: nodeImportKernel(), solver: new SketchSolver(planegcs) },
    );
    const pad = r.report.parameters.expressions.find((e) => e.object === 'Pad');
    console.log(
      `1 MB expression: import ${Math.round(performance.now() - t)} ms, ${pad?.outcome}: ${pad?.detail}`,
    );
  }, 600_000);
});
