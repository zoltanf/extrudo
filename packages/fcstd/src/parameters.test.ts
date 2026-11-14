/**
 * Parameters and expressions (P6-25 S10, ADR-0144): the eleven parts FreeCAD
 * made for this slice (`parameter-fixtures.ts`) through `importFcstd` with a
 * kernel in Node and the real solver. Every expression's outcome is asserted;
 * a kept one evaluates in `@extrudo/core` to what the file stores, and the
 * design is live: a parameter changed through the Parameters panel's command
 * (`updateParameter`, the sketches settled as the app's `apply` does) changes
 * the rebuilt body as the changed FreeCAD model would.
 */
import {
  type ExtrudoDocument,
  evaluateParameters,
  setSketchGeometry,
  updateParameter,
} from '@extrudo/core';
import { loadPlanegcs, type PlanegcsModule, SketchSolver } from '@extrudo/sketch';
import { settleSketches } from '@extrudo/sketch/inference';
import { beforeAll, describe, expect, it } from 'vitest';
import { type FcstdImportOptions, type FcstdImportResult, importFcstd } from './import';
import { nodeImportKernel } from './node-kernel-test-support';
import { PARAM_CASES, PARAM_TRUTH } from './parameter-fixtures';
import { PARAM_PARTS, type ParamPartOptions, paramFile, sheetObject } from './parameter-parts';

let planegcs: PlanegcsModule;
let kernel: ReturnType<typeof nodeImportKernel>;
beforeAll(async () => {
  planegcs = await loadPlanegcs();
  kernel = nodeImportKernel();
});

async function run(
  name: string,
  part: ParamPartOptions = {},
  options: Partial<FcstdImportOptions> = {},
) {
  return importFcstd(paramFile(name, part), 'Parts', {
    kernel,
    solver: new SketchSolver(planegcs),
    ...options,
  });
}

/** Each expression's outcome, by `<object>.<path>`. */
const outcomes = (r: FcstdImportResult) =>
  Object.fromEntries(
    r.report.parameters.expressions.map((e) => [`${e.object}.${e.path}`, e.outcome]),
  );
const texts = (r: FcstdImportResult) =>
  Object.fromEntries(
    r.report.parameters.expressions
      .filter((e) => e.text !== undefined)
      .map((e) => [`${e.object}.${e.path}`, e.text]),
  );
const params = (r: FcstdImportResult) =>
  r.design.doc.parameters.map((p) => [p.name, p.unit, p.expression, p.group ?? '']);

/** Every parameter, dimension and input evaluates in core without an error. */
function evaluatesCleanly(doc: ExtrudoDocument) {
  const e = evaluateParameters(doc);
  const bad = [...e.parameters.values()].filter((p) => !p.result.ok).map((p) => p.name);
  for (const m of e.inputs.values()) for (const [k, v] of m) if (!v.ok) bad.push(k);
  for (const m of e.dimensions.values()) for (const [k, v] of m) if (!v.ok) bad.push(k);
  return bad;
}

/**
 * Changes a user parameter as the Parameters panel does (`updateParameter`
 * through the shell's `apply`, which settles the sketches it moves in the
 * same undo step), then rebuilds: the bodies' volume, mm³.
 */
async function change(r: FcstdImportResult, name: string, expression: string): Promise<number> {
  const d = r.design;
  const p = d.doc.parameters.find((x) => x.name === name);
  if (!p) throw new Error(`no parameter ${name}`);
  const before = d.doc;
  d.state.beginTransaction(`Edit ${name}`);
  d.state.dispatch(updateParameter({ id: p.id, changes: { expression } }));
  for (const c of settleSketches({ solver: new SketchSolver(planegcs), before, after: d.doc }))
    d.state.dispatch(setSketchGeometry({ feature: c.feature, points: c.points, radii: c.radii }));
  d.state.commitTransaction();
  return volume(r);
}

async function volume(r: FcstdImportResult): Promise<number> {
  const rebuilt = await kernel.rebuild(r.design.toJSON(), new Map(r.files), []);
  expect(rebuilt.failed).toEqual([]);
  return Object.values(rebuilt.bodies).reduce((a, m) => a + m.volume, 0);
}

const HALF_HOLE = (Math.PI * 9 * 4) / 2;

/** The names of a sketch's dimensions. */
function dimensionNames(r: FcstdImportResult, sketch: string): (string | undefined)[] {
  const f = r.design.doc.features.find((x) => x.name === sketch);
  const input = f?.inputs.sketch;
  if (input?.kind !== 'sketchData') return [];
  return Object.values(input.sketch.dimensions).map((d) => d.paramName);
}

describe('the parameter parts (ADR-0144 S10)', () => {
  it('come in with their whole history, all eleven', async () => {
    for (const name of PARAM_PARTS) {
      const r = await run(name);
      const [b] = r.report.bodies;
      expect(b?.outcome, name).toBe('history');
      expect(b?.stop, name).toBeUndefined();
      expect(b?.mapped.length, name).toBe(b?.features);
      expect(evaluatesCleanly(r.design.doc), name).toEqual([]);
    }
  }, 300_000);

  it('sheet_plate: the sheets’ cells as parameters, every expression live', async () => {
    const r = await run('sheet_plate');
    expect(params(r)).toEqual([
      ['width', 'length', '40 mm', 'Params'],
      ['depth', 'length', '20 mm', 'Params'],
      ['height', 'length', '10 mm', 'Params'],
      ['inset', 'length', 'width / 4', 'Params'],
      ['count', 'unitless', '3', 'Params'],
      ['Params_B6', 'unitless', 'count - 1', 'Params'],
      ['hole_d', 'length', '6 mm', 'Params'],
      ['pitch', 'length', 'inset * 0.8', 'Params'],
      ['unused_one', 'unitless', '12.5', 'Params'],
      ['half_depth', 'length', 'depth / 2', 'Derived'],
      ['pocket_depth', 'length', 'height - 6 mm', 'Derived'],
    ]);
    expect(texts(r)).toEqual({
      'Sketch..Constraints.Wide': 'width',
      'Sketch.Constraints[11]': 'depth',
      'Pad.Length': 'height',
      'PocketSketch..AttachmentOffset.Base.z': 'height',
      'PocketSketch..Constraints.FromAxis': 'half_depth',
      'PocketSketch.Constraints[0]': 'inset',
      'PocketSketch.Constraints[2]': 'hole_d',
      'Pocket.Length': 'pocket_depth',
      'LinearPattern.Length': 'pitch * Params_B6',
      'LinearPattern.Occurrences': 'count',
    });
    expect(Object.values(outcomes(r)).every((o) => o === 'kept')).toBe(true);
    // FreeCAD's own values of the cells (not in the file) are Extrudo's.
    const values = evaluateParameters(r.design.doc).parameters;
    for (const sheet of PARAM_CASES.sheet_plate?.outside ?? [])
      for (const [address, v] of sheet.computed ?? []) {
        if (typeof v !== 'number') continue;
        const p = r.report.parameters.parameters.find(
          (x) => x.object === sheet.object && x.at === address,
        );
        if (!p) continue;
        const got = values.get(p.name)?.result;
        expect(got?.ok && got.value, `${sheet.object}.${address}`).toBeCloseTo(v, 9);
      }
    expect(r.report.parameters.renames).toEqual([]);
  }, 120_000);

  it('sheet_plate is live: width 40 → 50, then count 3 → 4', async () => {
    const r = await run('sheet_plate');
    expect(await volume(r)).toBeCloseTo(8000 - 3 * HALF_HOLE, 6);
    // 50 × 20 × 10, three half holes 10 mm apart (pitch = width / 4 * 0.8).
    expect(await change(r, 'width', '50 mm')).toBeCloseTo(10000 - 3 * HALF_HOLE, 6);
    // Back to 40 wide, four half holes 8 mm apart.
    await change(r, 'width', '40 mm');
    expect(await change(r, 'count', '4')).toBeCloseTo(8000 - 4 * HALF_HOLE, 6);
  }, 120_000);

  it('varset_part: the variable set’s numbers as parameters; the bool stays out', async () => {
    const r = await run('varset_part');
    expect(params(r)).toEqual([
      ['Count', 'unitless', '4', 'Vars'],
      ['Height', 'length', '10 mm', 'Vars'],
      ['Ratio', 'unitless', '0.5', 'Vars'],
      ['Shift', 'length', '-12 mm', 'Vars'],
      ['Sweep', 'angle', '360 deg', 'Vars'],
    ]);
    expect(r.design.doc.parameters.find((p) => p.name === 'Height')?.comment).toBe(
      'the plate thickness',
    );
    expect(r.report.parameters.leftOut.map((x) => [x.at, x.reason])).toEqual([
      ['Flag', 'type'],
      ['Note', 'type'],
    ]);
    expect(outcomes(r)).toEqual({
      'Pad.Length': 'kept',
      'PocketSketch.Constraints[0]': 'kept',
      'Pocket.Length': 'kept',
      'Pocket.Reversed': 'target',
      'PolarPattern.Angle': 'kept',
      'PolarPattern.Occurrences': 'kept',
    });
    expect(texts(r)['PocketSketch.Constraints[0]']).toBe('-Shift');
    expect(texts(r)['Pocket.Length']).toBe('Height * Ratio');
  }, 120_000);

  it('varset_part is live: the height 10 → 12 deepens the plate and its holes', async () => {
    const r = await run('varset_part');
    const hole = (h: number) => Math.PI * 4 * h * 0.5;
    expect(await volume(r)).toBeCloseTo(1600 * 10 - 4 * hole(10), 6);
    expect(await change(r, 'Height', '12 mm')).toBeCloseTo(1600 * 12 - 4 * hole(12), 6);
  }, 120_000);

  it('model_refs: dimensions and inputs that read other model values, named', async () => {
    const r = await run('model_refs');
    expect(Object.values(outcomes(r)).every((o) => o === 'kept')).toBe(true);
    const t = texts(r);
    expect(t['Sketch.Constraints[11]']).toBe('Width / 2');
    expect(t['Pad.Length']).toBe('Width / 4');
    expect(t['PocketSketch.Constraints[0]']).toBe('Width / 8');
    // An indexed constraint and a feature's input read by another get Extrudo's own names.
    expect(t['PocketSketch.Constraints[2]']).toMatch(/^d\d+ \/ 10$/);
    expect(t['Pocket.Length']).toMatch(/^d\d+ \/ 2$/);
    expect(t['Boss.Length']).toMatch(/^d\d+ \+ 1 mm$/);
    expect(t['Boss.Length2']).toMatch(/^d\d+ \/ 2$/);
    // The timeline: sketch, pad, the pocket's sketch on its plane, pocket, sketch, boss.
    expect(dimensionNames(r, 'Sketch')).toContain('Width');
    expect(r.design.doc.features.map((f) => f.type)).toEqual([
      'sketch',
      'extrude',
      'offsetPlane',
      'sketch',
      'extrude',
      'sketch',
      'extrude',
    ]);
    // The pad's length follows the width: Width / 4.
    const pad = r.design.doc.features.find((f) => f.name === 'Pad');
    const padLength = (pad?.inputs as Record<string, { paramName?: string }> | undefined)?.distance
      ?.paramName;
    expect(padLength).toBeDefined();
    expect(t['Pocket.Length']).toBe(`${padLength} / 2`);
  }, 120_000);

  it('the truth table: every row has an outcome, a kept row evaluates to FreeCAD’s value', async () => {
    const r = await run('functions_table');
    const o = outcomes(r);
    const numbers: Record<string, string> = {
      'trunc(7.9)': 'function',
      'exp(2)': 'function',
      'log(100)': 'function',
      'log10(1000)': 'function',
      'atan2(1; 1) / 5 deg': 'function',
      'atan2(1; 1)': 'function',
      '1 > 0 ? 7 : 9': 'operator',
      '(2 == 3) ? 7 : 9': 'operator',
    };
    const evaluation = evaluateParameters(r.design.doc);
    const sketch = r.design.doc.features.find((f) => f.type === 'sketch');
    const values = evaluation.dimensions.get(sketch?.id as never);
    const sk = r.report.bodies[0]?.sketches[0];
    let kept = 0;
    for (const [kind, index, typed, accepted, , stored] of PARAM_TRUTH) {
      const key = `Sketch.Constraints[${index}]`;
      if (!accepted) {
        // FreeCAD refused it: the file has no expression there.
        expect(o[key], typed).toBeUndefined();
        continue;
      }
      const why = numbers[typed];
      expect(o[key], typed).toBe(why ?? 'kept');
      if (why) continue;
      kept++;
      const dimension = sk?.bindings.find((b) => b.index === index)?.dimension;
      const got = values?.get(dimension as string);
      const want = kind === 'angle' ? (stored * 180) / Math.PI : stored;
      expect(got?.ok, typed).toBe(true);
      expect(Math.abs((got as { value: number }).value - want), typed).toBeLessThanOrEqual(
        1e-9 * Math.max(1, Math.abs(want)),
      );
    }
    expect(kept).toBe(73);
    expect(params(r)).toEqual([
      ['n', 'unitless', '30', 'Spreadsheet'],
      ['len_mm', 'length', '8 mm', 'Spreadsheet'],
      ['ang', 'angle', '60 deg', 'Spreadsheet'],
      ['ratio', 'unitless', '0.25', 'Spreadsheet'],
      ['neg', 'length', '-9 mm', 'Spreadsheet'],
    ]);
  }, 120_000);

  it('the bound parts: every input kind this import maps takes its cell', async () => {
    const want: Record<string, Record<string, string>> = {
      bound_pad_pocket: {
        'Pad.Length': 'thick',
        'BossSketch..AttachmentOffset.Base.z': 'thick',
        'Boss.Length': 'up',
        'Boss.Length2': 'down',
        'PocketSketch..AttachmentOffset.Base.z': 'thick',
        'PocketSketch.Constraints[2]': 'r',
        'Pocket.Length': 'cut',
      },
      bound_dressups: { 'Fillet.Radius': 'round_1', 'Chamfer.Size': 'bevel' },
      bound_patterns: {
        'LinearPattern.Length': 'span',
        'LinearPattern.Occurrences': 'n',
        'PolarPattern.Angle': 'sweep',
        'PolarPattern.Occurrences': 'around',
      },
      bound_revolve: { 'Revolution.Angle': 'turn', 'Groove.Angle': 'notch' },
      bound_hole: { 'Hole.Depth': 'deep', 'Hole.Diameter': 'bore' },
      bound_datum_upto: { 'DatumPlane..AttachmentOffset.Base.z': 'level', 'Boss.Offset': 'past' },
    };
    for (const [name, t] of Object.entries(want)) {
      const r = await run(name);
      expect(texts(r), name).toEqual(t);
      expect(
        Object.values(outcomes(r)).every((o) => o === 'kept'),
        name,
      ).toBe(true);
    }
  }, 300_000);

  it('bound_pad_pocket is live: a plane offset and lengths follow the thickness', async () => {
    const r = await run('bound_pad_pocket');
    const v = await volume(r);
    // The boss and the pocket sit on planes at the pad's thickness: thicker, everything moves up.
    const thicker = await change(r, 'thick', '12 mm');
    expect(thicker - v).toBeCloseTo(2 * 40 * 20, 6);
  }, 120_000);

  it('bound_patterns is live: a count', async () => {
    const r = await run('bound_patterns');
    const v = await volume(r);
    const ring = await change(r, 'around', '6');
    expect(v - ring).toBeCloseTo(2 * Math.PI * 1.5 * 1.5 * 4, 6);
  }, 120_000);

  it('bound_datum_upto is live: the datum plane’s offset and the up-to offset', async () => {
    const r = await run('bound_datum_upto');
    const v = await volume(r);
    const higher = await change(r, 'level', '20 mm');
    expect(higher).toBeGreaterThan(v);
  }, 120_000);

  it('names: reserved words renamed, cases kept, a constraint’s name after an alias', async () => {
    const r = await run('names');
    expect(params(r)).toEqual([
      ['Width', 'length', '40 mm', 'Maße #1'],
      ['width', 'length', '20 mm', 'Maße #1'],
      ['d', 'length', '10 mm', 'Maße #1'],
      ['sin_', 'length', '2 mm', 'Maße #1'],
      ['cos_1', 'length', '3 mm', 'Maße #1'],
      ['max_1', 'length', '4 mm', 'Maße #1'],
      ['in_', 'unitless', '7', 'Maße #1'],
      ['e1', 'unitless', '8', 'Maße #1'],
      ['round_1', 'unitless', '11', 'Maße #1'],
      ['x1', 'unitless', '14', 'Maße #1'],
      ['A1x', 'unitless', '15', 'Maße #1'],
      ['Pad', 'unitless', '17', 'Maße #1'],
    ]);
    expect(r.report.parameters.renames.map((c) => [c.from, c.to, c.what, c.why])).toEqual([
      ['cos', 'cos_1', 'alias', 'reserved'],
      ['max', 'max_1', 'alias', 'reserved'],
      ['round', 'round_1', 'alias', 'reserved'],
      ['width', 'width_1', 'constraint', 'taken'],
      ['d', 'd_1', 'constraint', 'taken'],
    ]);
    expect(texts(r)).toEqual({
      'Sketch..Constraints.d': 'width',
      'Sketch..Constraints.width': 'Width',
      'Pad.Length': 'd',
      'PocketSketch.Constraints[0]': 'max_1 + 1 mm',
      'PocketSketch.Constraints[2]': 'sin_',
      'Pocket.Length': 'cos_1',
    });
    expect(dimensionNames(r, 'Sketch')).toEqual(expect.arrayContaining(['width_1', 'd_1', 'W']));
  }, 120_000);
});

describe('the wrong cases (ADR-0144 S10)', () => {
  const editCell = (address: string, content: string) => (object: string, xml: string) =>
    object === 'Spreadsheet'
      ? xml.replace(new RegExp(`(<Cell address="${address}" content=")[^"]*"`), `$1${content}"`)
      : xml;

  it('a cell whose value disagrees with what the file stores: the stored numbers come in', async () => {
    // The sketch's Wide stores 40, but the cell now says 41: Extrudo computes 41.
    const r = await run('sheet_plate', { edit: editCell('B1', '41') });
    const o = outcomes(r);
    expect(o['Sketch..Constraints.Wide']).toBe('differs');
    expect(o['PocketSketch.Constraints[0]']).toBe('differs'); // inset = width / 4 = 10.25
    expect(o['LinearPattern.Length']).toBe('differs'); // pitch reads inset
    expect(o['Pad.Length']).toBe('kept');
    expect(r.report.bodies[0]?.outcome).toBe('history');
    expect(evaluatesCleanly(r.design.doc)).toEqual([]);
  }, 120_000);

  it('a reference to a cell that isn’t there', async () => {
    const r = await run('sheet_plate', {
      edit: (o, xml) =>
        o === 'Pad'
          ? xml.replace('&lt;&lt;Params&gt;&gt;.height', '&lt;&lt;Params&gt;&gt;.nothere')
          : xml,
    });
    expect(outcomes(r)['Pad.Length']).toBe('reference');
  }, 120_000);

  it('a cycle between two cells, and between a cell and a constraint', async () => {
    const r = await run('sheet_plate', {
      edit: (o, xml) =>
        o === 'Spreadsheet'
          ? xml
              .replace(
                'content="10" displayUnit="mm" alias="height"',
                'content="=loop + 1" alias="height"',
              )
              .replace('content="12.5" alias="unused_one"', 'content="=height - 1" alias="loop"')
              // A cell that reads the constraint that reads it.
              .replace(
                'content="20" alias="depth"',
                'content="=Sketch.Constraints[11]" alias="depth"',
              )
          : xml,
    });
    const o = outcomes(r);
    // height and loop read each other: height isn't proven by Pad.Length alone? It is: Pad.Length = height.
    const height = r.report.parameters.parameters.find((p) => p.name === 'height');
    expect(height?.from).toBe('proven');
    expect(r.report.parameters.leftOut.find((x) => x.at === 'B9')?.reason).toBe('cycle');
    // depth reads a model value: proven by the constraint that reads it, then a plain number.
    expect(r.report.parameters.parameters.find((p) => p.name === 'depth')).toMatchObject({
      from: 'proven',
      expression: '20 mm',
    });
    expect(o['Sketch.Constraints[11]']).toBe('kept');
    expect(o['Pad.Length']).toBe('kept');
    expect(evaluatesCleanly(r.design.doc)).toEqual([]);
  }, 120_000);

  it('a formula that doesn’t translate: a number where a property proves it, else out', async () => {
    const r = await run('sheet_plate', {
      edit: (o, xml) =>
        o === 'Spreadsheet'
          ? xml
              .replace('content="40" alias="width"', 'content="=trunc(40.5)" alias="width"')
              .replace(
                'content="12.5" alias="unused_one"',
                'content="=trunc(7.9)" alias="unused_one"',
              )
          : xml,
    });
    expect(r.report.parameters.parameters.find((p) => p.name === 'width')).toMatchObject({
      from: 'proven',
      expression: '40 mm',
    });
    expect(r.report.parameters.leftOut.find((x) => x.at === 'B9')).toMatchObject({
      reason: 'function',
    });
    expect(outcomes(r)['Sketch..Constraints.Wide']).toBe('kept');
  }, 120_000);

  it('a name clash in each order: the alias keeps its name, the constraint takes the next', async () => {
    for (const first of ['sheet', 'sketch'] as const) {
      const r = await run('sheet_plate', {
        edit: (o, xml) =>
          o === 'Spreadsheet' ? xml.replace('alias="unused_one"', 'alias="Wide"') : xml,
        outsideFirst: first === 'sheet',
      });
      expect(r.report.parameters.renames).toEqual([
        { from: 'Wide', to: 'Wide_1', what: 'constraint', why: 'taken' },
      ]);
      expect(texts(r)['Sketch..Constraints.Wide']).toBe('width');
    }
  }, 120_000);

  it('the same alias in two sheets: the second is renamed, and read by its new name', async () => {
    const r = await run('sheet_plate', {
      edit: (o, xml) =>
        o === 'Spreadsheet001'
          ? xml.replace('alias="half_depth"', 'alias="width"')
          : o === 'PocketSketch'
            ? xml.replace('&lt;&lt;Derived&gt;&gt;.half_depth', '&lt;&lt;Derived&gt;&gt;.width')
            : xml,
    });
    expect(r.report.parameters.renames).toEqual([
      { from: 'width', to: 'width_1', what: 'alias', why: 'taken' },
    ]);
    expect(texts(r)['PocketSketch..Constraints.FromAxis']).toBe('width_1');
  }, 120_000);

  it('JavaScript’s own property names come in working', async () => {
    const names = ['__proto__', 'constructor', 'toString', 'hasOwnProperty'];
    const r = await run('sheet_plate', {
      extra: [
        sheetObject(
          'Spreadsheet002',
          'Proto',
          names.map((n, i) => [`A${i + 1}`, `${10 + i}`, n] as const),
        ),
      ],
      edit: (o, xml) =>
        o === 'Pad'
          ? xml.replace('&lt;&lt;Params&gt;&gt;.height', '&lt;&lt;Proto&gt;&gt;.__proto__')
          : xml,
    });
    for (const n of names)
      expect(
        r.design.doc.parameters.some((p) => p.name === n),
        n,
      ).toBe(true);
    expect(texts(r)['Pad.Length']).toBe('__proto__');
    const e = evaluateParameters(r.design.doc).parameters;
    expect(e.get('__proto__')?.result).toMatchObject({ ok: true, value: 10 });
    expect(e.get('constructor')?.result).toMatchObject({ ok: true, value: 11 });
    expect(evaluatesCleanly(r.design.doc)).toEqual([]);
  }, 120_000);
});
