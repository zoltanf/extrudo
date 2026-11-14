/**
 * Hostile parameters and expressions (P6-25 S10, ADR-0144): everything in an
 * expression, a cell, an alias, a label or a property name is the file's.
 * One test per limit, each a clean outcome with its reason, never a throw out
 * of the import; and the cases a file can hold that FreeCAD itself would
 * refuse or never write. Each import is the small `sheet_plate` part (or
 * `model_refs`) with one thing changed.
 */
import { type ExtrudoDocument, evaluateParameters } from '@extrudo/core';
import { loadPlanegcs, type PlanegcsModule, SketchSolver } from '@extrudo/sketch';
import { beforeAll, describe, expect, it } from 'vitest';
import { MAX_EXPRESSION_LENGTH } from './fc-expr';
import { type FcstdImportOptions, type FcstdImportResult, importFcstd } from './import';
import { nodeImportKernel } from './node-kernel-test-support';
import { type ParamPartOptions, paramFile, type RawObject, sheetObject } from './parameter-parts';
import {
  MAX_GROUP_LENGTH,
  MAX_IMPORT_PARAMETERS,
  MAX_OBJECT_EXPRESSIONS,
  MAX_PARAMETER_NAME,
  MAX_RENAME_TRIES,
  MAX_SHEET_CELLS,
  Names,
} from './params';

let planegcs: PlanegcsModule;
let kernel: ReturnType<typeof nodeImportKernel>;
beforeAll(async () => {
  planegcs = await loadPlanegcs();
  kernel = nodeImportKernel();
});

const run = (
  name: string,
  part: ParamPartOptions = {},
  options: Partial<FcstdImportOptions> = {},
) =>
  importFcstd(paramFile(name, part), 'Parts', {
    kernel,
    solver: new SketchSolver(planegcs),
    ...options,
  });

const outcome = (r: FcstdImportResult, key: string) =>
  r.report.parameters.expressions.find((e) => `${e.object}.${e.path}` === key);
const param = (r: FcstdImportResult, name: string) =>
  r.design.doc.parameters.find((p) => p.name === name);
const bad = (doc: ExtrudoDocument) => {
  const e = evaluateParameters(doc);
  const out = [...e.parameters.values()].filter((p) => !p.result.ok).map((p) => p.name);
  for (const m of [...e.inputs.values(), ...e.dimensions.values()])
    for (const [k, v] of m) if (!v.ok) out.push(k);
  return out;
};
const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** `sheet_plate` with the pad's length bound to `expression` instead. */
const padReads = (expression: string): ParamPartOptions => ({
  edit: (o, xml) =>
    o === 'Pad' ? xml.replace('&lt;&lt;Params&gt;&gt;.height', esc(expression)) : xml,
});
/** `sheet_plate` with one more sheet. */
const withSheet = (sheet: RawObject, expression?: string): ParamPartOptions => ({
  extra: [sheet],
  ...(expression ? padReads(expression) : {}),
});

describe('S10 limits, each a clean outcome', () => {
  it('an expression past its length, its tokens, its depth: a number (limit)', async () => {
    for (const text of [
      `1 + ${'1'.repeat(MAX_EXPRESSION_LENGTH)}`,
      'x'.repeat(1024 * 1024),
      `${'('.repeat(100_000)}10${')'.repeat(100_000)}`,
      Array(600).fill('1').join(' + '),
    ]) {
      const r = await run('sheet_plate', padReads(text));
      expect(outcome(r, 'Pad.Length')?.outcome).toBe('limit');
      expect(r.report.bodies[0]?.outcome).toBe('history');
    }
  }, 120_000);

  it('more expressions on one object than it reads: the rest are numbers (limit)', async () => {
    const many = Array.from(
      { length: MAX_OBJECT_EXPRESSIONS + 5 },
      (_, i) => `<Expression path="Dummy${i}" expression="1"/>`,
    ).join('');
    const r = await run('sheet_plate', {
      edit: (o, xml) =>
        o === 'Pad'
          ? xml.replace(/<ExpressionEngine count="1">/, `<ExpressionEngine count="999">${many}`)
          : xml,
    });
    const pad = r.report.parameters.expressions.filter((e) => e.object === 'Pad');
    expect(pad).toHaveLength(MAX_OBJECT_EXPRESSIONS + 6);
    expect(pad.filter((e) => e.outcome === 'limit')).toHaveLength(6);
    expect(r.report.bodies[0]?.outcome).toBe('history');
  }, 120_000);

  it('more expressions in the file than an import reads, and more parameters', async () => {
    const r = await run('sheet_plate', {}, { maxExpressions: 3, maxParameters: 2 });
    const limited = r.report.parameters.expressions.filter((e) => e.outcome === 'limit');
    expect(limited).toHaveLength(7);
    expect(r.design.doc.parameters.map((p) => p.name)).toEqual(['width', 'depth']);
    // The unaliased B6 is read only by an expression past the cap: it isn't wanted at all.
    expect(r.report.parameters.leftOut.filter((x) => x.reason === 'limit')).toHaveLength(8);
    expect(bad(r.design.doc)).toEqual([]);
  }, 120_000);

  it('a sheet of more cells than it reads: the rest are not read', async () => {
    const cells: [string, string, string?][] = Array.from(
      { length: MAX_SHEET_CELLS + 10 },
      (_, i) => [`A${i + 1}`, `${i}`],
    );
    cells.push(['B1', '7', 'late']);
    const r = await run('sheet_plate', withSheet(sheetObject('Big', 'Big', cells), '<<Big>>.late'));
    expect(outcome(r, 'Pad.Length')?.outcome).toBe('reference');
    expect(
      r.report.parameters.leftOut.some((x) => x.object === 'Big' && x.reason === 'limit'),
    ).toBe(true);
  }, 120_000);

  it('a name past its length is cut; a group past its length is cut', async () => {
    const long = `w${'x'.repeat(200)}`;
    const label = `G${'y'.repeat(100)}`;
    const r = await run(
      'sheet_plate',
      withSheet(sheetObject('Long', label, [['A1', '10', long]]), `<<${label}>>.${long}`),
    );
    const p = r.design.doc.parameters.at(-1);
    expect(p?.name).toBe(long.slice(0, MAX_PARAMETER_NAME));
    expect(p?.group).toBe(label.slice(0, MAX_GROUP_LENGTH));
    expect(r.report.parameters.renames).toContainEqual({
      from: long,
      to: p?.name,
      what: 'alias',
      why: 'long',
    });
    expect(outcome(r, 'Pad.Length')).toMatchObject({ outcome: 'kept', text: p?.name });
  }, 120_000);

  it('a name with no free number left: it doesn’t come in (limit)', () => {
    const names = new Names({ parameters: [], features: [] } as unknown as ExtrudoDocument);
    for (let k = 1; k <= MAX_RENAME_TRIES; k++) names.taken.add(`cos_${k}`);
    expect(names.fit('cos', 'alias')).toBeUndefined();
    expect(names.fit('cosine', 'alias')).toBe('cosine');
  });

  it('a chain of cells past the cap: the kinds and the order in bounded time, the rest out', async () => {
    const n = MAX_IMPORT_PARAMETERS;
    const cells: [string, string, string?][] = Array.from({ length: n }, (_, i) =>
      i === 0 ? ['A1', '1', 'v_0'] : [`A${i + 1}`, `=v_${i - 1} + 1`, `v_${i}`],
    );
    const t = performance.now();
    const r = await run('sheet_plate', withSheet(sheetObject('Chain', 'Chain', cells)));
    expect(performance.now() - t).toBeLessThan(60_000);
    // The plate's ten aliases come first, then the chain's: its last ten are past the cap, and
    // so is the plate's unaliased B6 (named after every alias).
    expect(r.design.doc.parameters).toHaveLength(MAX_IMPORT_PARAMETERS);
    const last = n - 11;
    expect(param(r, `v_${last}`)?.expression).toBe(`v_${last - 1} + 1`);
    expect(r.report.parameters.leftOut.filter((x) => x.object === 'Chain')).toHaveLength(10);
    expect(r.report.parameters.leftOut.find((x) => x.object === 'Chain')?.reason).toBe('limit');
    expect(bad(r.design.doc)).toEqual([]);
  }, 120_000);
});

describe('S10 hostile values and names', () => {
  it('numbers that aren’t finite, a result too large, a division by zero', async () => {
    const r = await run(
      'sheet_plate',
      withSheet(
        sheetObject('Odd', 'Odd', [
          ['A1', '1e999', 'huge'],
          ['A2', '=1e300 * 1e300', 'over'],
          ['A3', '=1 / 0', 'zero'],
          ['A4', '=0 / 0', 'nan'],
        ]),
      ),
    );
    const left = Object.fromEntries(
      r.report.parameters.leftOut.filter((x) => x.object === 'Odd').map((x) => [x.at, x.reason]),
    );
    expect(left).toEqual({ A1: 'limit', A2: 'differs', A3: 'differs', A4: 'differs' });
    expect(bad(r.design.doc)).toEqual([]);
    // Read by a property, a formula that Extrudo can't compute takes the property's number.
    const read = await run(
      'sheet_plate',
      withSheet(sheetObject('Odd', 'Odd', [['A1', '=1 / 0', 'zero']]), '<<Odd>>.zero'),
    );
    expect(param(read, 'zero')?.expression).toBe('10 mm');
    expect(outcome(read, 'Pad.Length')?.outcome).toBe('kept');
  }, 120_000);

  it('a parameter that would read itself through a rename reads the other cell', async () => {
    const r = await run(
      'sheet_plate',
      withSheet(
        sheetObject('R', 'R', [
          ['A1', '=cos_1 + 1', 'cos'],
          ['A2', '9', 'cos_1'],
        ]),
        '<<R>>.cos',
      ),
    );
    expect(param(r, 'cos_1')?.expression).toBe('cos_1_1 + 1 mm');
    expect(param(r, 'cos_1_1')?.expression).toBe('9 mm');
    expect(outcome(r, 'Pad.Length')?.outcome).toBe('kept');
    expect(bad(r.design.doc)).toEqual([]);
  }, 120_000);

  it('an alias that is a cell address is no alias', async () => {
    const r = await run(
      'sheet_plate',
      withSheet(
        sheetObject('Q', 'Q', [
          ['A1', '10', 'B2'],
          ['B2', '3'],
        ]),
        '<<Q>>.B2',
      ),
    );
    // `<<Q>>.B2` is the cell B2 (3), as FreeCAD reads it, not A1.
    expect(outcome(r, 'Pad.Length')?.outcome).toBe('differs');
    expect(r.design.doc.parameters.some((p) => p.name === 'B2')).toBe(false);
  }, 120_000);

  it('two sheets with one label, and a label that is another object’s name: unresolved', async () => {
    const twin = await run(
      'sheet_plate',
      withSheet(sheetObject('Twin', 'Params', [['A1', '10', 'height']])),
    );
    expect(outcome(twin, 'Pad.Length')?.outcome).toBe('reference');
    // Read by name, the first sheet is still found.
    expect(outcome(twin, 'Sketch.Constraints[11]')?.outcome).toBe('kept');
    const named = await run('model_refs', {
      extra: [sheetObject('S', 'Pad', [['A1', '1', 'Length']])],
    });
    expect(outcome(named, 'Pocket.Length')?.outcome).toBe('reference');
  }, 120_000);

  it('two inputs of one feature that read each other: both numbers (cycle)', async () => {
    const r = await run('model_refs', {
      edit: (o, xml) => (o === 'Boss' ? xml.replace('Pocket.Length + 1 mm', 'Length2 * 2') : xml),
    });
    expect(outcome(r, 'Boss.Length')?.outcome).toBe('cycle');
    expect(outcome(r, 'Boss.Length2')?.outcome).toBe('cycle');
    expect(bad(r.design.doc)).toEqual([]);
  }, 120_000);

  it('JavaScript’s own names as variables and constraints', async () => {
    const names = ['__proto__', 'constructor', 'toString', 'hasOwnProperty'];
    const props = names.map(
      (n, i) =>
        `<Property name="${n}" type="App::PropertyLength" group="G" doc="${n}" attr="0" ro="0" hide="0" status="2097152"><Float value="${10 + i}"/></Property>`,
    );
    const varset: RawObject = {
      name: 'VarSet',
      type: 'App::VarSet',
      xml: `<Object name="VarSet"><Properties Count="${props.length + 1}" TransientCount="0"><Property name="Label" type="App::PropertyString"><String value="V"/></Property>${props.join('')}</Properties></Object>`,
    };
    const r = await run('sheet_plate', {
      extra: [varset],
      edit: (o, xml) =>
        o === 'Pad'
          ? xml.replace('&lt;&lt;Params&gt;&gt;.height', 'VarSet.__proto__')
          : o === 'Sketch'
            ? xml
                .replace('Name="Wide"', 'Name="constructor"')
                .replace('.Constraints.Wide', '.Constraints.constructor')
            : xml,
    });
    // The variables came first: the constraint takes the next name.
    expect(r.report.parameters.renames).toContainEqual({
      from: 'constructor',
      to: 'constructor_1',
      what: 'constraint',
      why: 'taken',
    });
    for (const n of names) expect(param(r, n)?.comment, n).toBe(n);
    expect(outcome(r, 'Pad.Length')).toMatchObject({ outcome: 'kept', text: '__proto__' });
    expect(outcome(r, 'Sketch..Constraints.constructor')).toMatchObject({
      outcome: 'kept',
      text: 'width',
    });
    expect(bad(r.design.doc)).toEqual([]);
  }, 120_000);

  it('a label with control characters makes a clean group', async () => {
    const r = await run(
      'sheet_plate',
      withSheet(sheetObject('C', 'A\t\tB\n C ', [['A1', '1', 'ctl']])),
    );
    expect(param(r, 'ctl')?.group).toBe('A B C');
  }, 120_000);
});
