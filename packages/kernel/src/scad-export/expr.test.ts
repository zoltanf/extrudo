// The expression translator against the real OpenSCAD compiler (P6-09,
// ADR-0088 §6): every successful row must echo, in OpenSCAD, the value
// Extrudo evaluates.
import {
  createDocument,
  type ExtrudoDocument,
  evaluateExpression,
  evaluateParameters,
  type LengthUnit,
  type Parameter,
  type ParameterId,
  type Quantity,
  type UnitKind,
} from '@extrudo/core';
import type { ScadCompiler } from '@extrudo/openscad';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type ExprContext, scadNames, translateExpression } from './expr';
import { parameterBlock } from './params';

// The Node compiler is `@extrudo/openscad/node`, which needs Node's types; the
// kernel's program has none (it runs in a worker), so the entry is loaded
// through a name the type checker doesn't follow.
const NODE_ENTRY = '@extrudo/openscad/node';

let compiler: ScadCompiler;
beforeAll(async () => {
  const { createNodeCompiler } = (await import(/* @vite-ignore */ NODE_ENTRY)) as {
    createNodeCompiler(): ScadCompiler;
  };
  compiler = createNodeCompiler();
});
afterAll(() => compiler.dispose());

const pid = (id: string) => id as ParameterId;

type RowParam = [name: string, expression: string, unit?: UnitKind];

interface Row {
  name: string;
  source: string;
  kind?: UnitKind;
  units?: LengthUnit;
  params?: RowParam[];
  /** The expected code; the row fails to translate when absent. */
  expected?: string;
}

const rows: Row[] = [
  { name: 'a length with its unit', source: '10 mm', kind: 'length', expected: '10' },
  { name: 'inches fold to millimetres', source: '1 in', kind: 'length', expected: '25.4' },
  {
    name: 'a bare length takes the document unit',
    source: '2',
    kind: 'length',
    units: 'in',
    expected: '50.8',
  },
  {
    name: 'a bare number beside a parameter, mm',
    source: 'width + 2',
    params: [['width', '80 mm']],
    expected: 'width + 2',
  },
  {
    name: 'a bare number beside a parameter, cm',
    source: 'width + 2',
    units: 'cm',
    params: [['width', '80 mm']],
    expected: 'width + 20',
  },
  {
    name: 'multiplication takes no factor',
    source: '2 * width',
    units: 'cm',
    params: [['width', '80 mm']],
    expected: '2 * width',
  },
  {
    name: 'a bare trig argument is degrees',
    source: 'sin(30)',
    kind: 'unitless',
    expected: 'sin(30)',
  },
  {
    name: 'an angle argument is degrees',
    source: 'sin(30 deg)',
    kind: 'unitless',
    expected: 'sin(30)',
  },
  {
    name: 'a named number is radians',
    source: 'sin(pi / 6)',
    kind: 'unitless',
    expected: 'sin((PI / 6) * 180 / PI)',
  },
  { name: 'inverse trig stays degrees', source: 'asin(0.5)', expected: 'asin(0.5)' },
  { name: 'a power is pow', source: '2 ^ 3', kind: 'length', expected: 'pow(2, 3)' },
  {
    name: 'rounding runs in display units',
    source: 'round(width)',
    units: 'cm',
    params: [['width', '257 mm']],
    expected: 'round(width / 10) * 10',
  },
  {
    name: 'a compound divisor gets its own pair of parentheses',
    source: 'width / round(width)',
    kind: 'unitless',
    units: 'cm',
    params: [['width', '40 mm']],
    expected: 'width / (round(width / 10) * 10)',
  },
  {
    name: 'a compound multiplier gets its own pair of parentheses',
    source: 'width * round(width)',
    units: 'cm',
    params: [['width', '40 mm']],
    expected: 'width * (round(width / 10) * 10)',
  },
  {
    name: 'a negated multiplier gets its own pair of parentheses',
    source: '2 * -width',
    kind: 'length',
    params: [['width', '40 mm']],
    expected: '2 * (-width)',
  },
  {
    name: 'a negated subtrahend needs no parentheses',
    source: 'width - -width',
    kind: 'length',
    params: [['width', '40 mm']],
    expected: 'width - -width',
  },
  {
    name: 'a bare max argument takes the other side, mm',
    source: 'max(width, 5)',
    params: [['width', '80 mm']],
    expected: 'max(width, 5)',
  },
  {
    name: 'a bare max argument takes the other side, in',
    source: 'max(width, 5)',
    units: 'in',
    params: [['width', '2 in']],
    expected: 'max(width, 127)',
  },
  { name: 'an unknown name is untranslatable', source: 'nonsense + 1', params: [] },
  { name: 'a parse error is untranslatable', source: '1 +', params: [] },
  { name: 'a division by zero is untranslatable', source: '5 / 0', params: [] },
];

const docOf = (params: RowParam[], units: LengthUnit = 'mm'): ExtrudoDocument => {
  const doc = {
    ...createDocument({ now: '2026-09-25T10:00:00.000Z' }),
    parameters: params.map<Parameter>(([name, expression, unit]) => ({
      id: pid(`id-${name}`),
      name,
      expression,
      unit: unit ?? 'length',
    })),
  };
  doc.settings.units = units;
  return doc;
};

const ctxOf = (doc: ExtrudoDocument): ExprContext => {
  const evaluation = evaluateParameters(doc);
  return { evaluation, lengthUnit: doc.settings.units, names: scadNames(evaluation) };
};

/** The number OpenSCAD echoes for `v`, as the compiler's warnings say it. */
async function echoed(code: string, block: string): Promise<number> {
  const result = await compiler.compile({
    fileName: 'expr-check.scad',
    source: new TextEncoder().encode(`${block}echo(v = ${code});\ncube(1);\n`),
  });
  if (!result.ok) throw new Error(result.error);
  const values = result.warnings
    .map((w) => /^expr-check\.scad echoes v = (.+)\.$/.exec(w)?.[1])
    .filter((v): v is string => v !== undefined);
  expect(values).toHaveLength(1);
  return Number(values[0]);
}

describe('translateExpression', { timeout: 180_000 }, () => {
  it.each(rows)('$name', async ({ source, kind, units, params, expected }) => {
    const doc = docOf(params ?? [], units);
    const ctx = ctxOf(doc);
    const t = translateExpression(source, kind, ctx);
    if (expected === undefined) {
      expect(t).toBeUndefined();
      return;
    }
    expect(t?.code).toBe(expected);

    // The translated expression evaluates in OpenSCAD to what Extrudo evaluates.
    // `evaluation.evaluate` coerces to a unit by default, so this runs
    // `evaluateExpression` against the same values, without a unit unless the
    // row has one.
    const values = new Map<string, Quantity>();
    for (const [name, p] of ctx.evaluation.parameters) {
      if (p.result.ok) values.set(name, { value: p.result.value, dim: p.result.dim });
    }
    const value = evaluateExpression(source, { kind, values, lengthUnit: ctx.lengthUnit });
    expect(value).toMatchObject({ ok: true });
    if (!value.ok) return;
    const block = parameterBlock(doc, ctx, {
      used: (params ?? []).map(([name]) => name),
    }).code;
    const said = await echoed(t?.code as string, block);
    expect(Math.abs(said - value.value)).toBeLessThanOrEqual(Math.abs(value.value) * 1e-9);
  });

  it('collects the names a code refers to, once, in first-use order', () => {
    const doc = docOf([
      ['width', '80 mm'],
      ['extra', '5 mm'],
    ]);
    expect(translateExpression('width * 2 + extra', undefined, ctxOf(doc))?.refs).toEqual([
      'width',
      'extra',
    ]);
  });
});

describe('scadNames', () => {
  it('suffixes a name OpenSCAD reserves, and leaves the rest alone', () => {
    const one = scadNames(
      evaluateParameters(
        docOf([
          ['cube', '1 mm'],
          ['len', '2 mm'],
          ['sided', '3 mm'],
        ]),
      ),
    );
    expect([...one.values()]).toEqual(['cube_', 'len_', 'sided']);
  });

  it('leaves later parameter names free', () => {
    const two = scadNames(
      evaluateParameters(
        docOf([
          ['cube', '1 mm'],
          ['cube_', '2 mm'],
        ]),
      ),
    );
    expect(two.get('cube')).toBe('cube__');
    expect(two.get('cube_')).toBe('cube_');
  });
});
