import { describe, expect, it } from 'vitest';
import type { LengthUnit, UnitKind } from '../schema';
import { evaluateExpression, type Quantity } from './evaluate';
import { formatQuantity } from './format';
import { parse, references, tokenize } from './parser';
import { ANGLE, type Dim, LENGTH, UNITLESS } from './units';

const AREA: Dim = { length: 2, angle: 0 };
const VOLUME: Dim = { length: 3, angle: 0 };
const PER_LENGTH: Dim = { length: -1, angle: 0 };

/** Parameters in scope for these tests, in base units (mm, deg). */
const VALUES = new Map<string, Quantity>([
  ['width', { value: 40, dim: LENGTH }],
  ['wall', { value: 3, dim: LENGTH }],
  ['tilt', { value: 30, dim: ANGLE }],
  ['count', { value: 4, dim: UNITLESS }],
  ['ratio', { value: 0.5, dim: UNITLESS }],
]);

function value(source: string, kind?: UnitKind, lengthUnit: LengthUnit = 'mm') {
  const result = evaluateExpression(source, { values: VALUES, kind, lengthUnit });
  if (!result.ok) throw new Error(`${source}: ${result.error.message}`);
  return result;
}

function error(source: string, kind?: UnitKind) {
  const result = evaluateExpression(source, { values: VALUES, kind });
  if (result.ok) throw new Error(`${source}: expected an error, got ${result.value}`);
  return result.error;
}

describe('numbers and arithmetic', () => {
  it.each<[string, number]>([
    ['0', 0],
    ['42', 42],
    ['3.25', 3.25],
    ['.5', 0.5],
    ['7.', 7],
    ['1e3', 1000],
    ['1.5e-3', 0.0015],
    ['2E2', 200],
    ['1 + 2', 3],
    ['5 - 8', -3],
    ['2 * 3', 6],
    ['7 / 2', 3.5],
    ['2 ^ 10', 1024],
    ['1 + 2 * 3', 7],
    ['(1 + 2) * 3', 9],
    ['10 - 4 - 3', 3],
    ['64 / 4 / 2', 8],
    ['2 ^ 3 ^ 2', 512],
    ['(2 ^ 3) ^ 2', 64],
    ['-2 ^ 2', -4],
    ['(-2) ^ 2', 4],
    ['2 ^ -1', 0.5],
    ['-3', -3],
    ['+3', 3],
    ['--3', 3],
    ['-(1 + 2)', -3],
    ['2 * -3', -6],
    ['1 - -1', 2],
    ['  1+2*3  ', 7],
    ['((((5))))', 5],
    ['9 ^ 0.5', 3],
    ['2 * 3 ^ 2', 18],
    ['-2 * -2', 4],
    ['8 / 2 * 4', 16],
    ['1 / 4 + 1 / 4', 0.5],
  ])('%s = %d', (source, expected) => {
    const result = value(source);
    expect(result.value).toBeCloseTo(expected, 12);
    expect(result.dim).toEqual(UNITLESS);
  });
});

describe('units', () => {
  it.each<[string, number, Dim]>([
    ['10 mm', 10, LENGTH],
    ['10mm', 10, LENGTH],
    ['2 cm', 20, LENGTH],
    ['1.5 m', 1500, LENGTH],
    ['1 in', 25.4, LENGTH],
    ['2in', 50.8, LENGTH],
    ['1 ft', 304.8, LENGTH],
    ['1e-3 m', 1, LENGTH],
    ['90 deg', 90, ANGLE],
    ['1 rad', 180 / Math.PI, ANGLE],
    ['10 mm + 2 cm', 30, LENGTH],
    ['1 in - 0.4 mm', 25, LENGTH],
    ['1 ft / 12', 25.4, LENGTH],
    ['3 * 5 mm', 15, LENGTH],
    ['5 mm * 3', 15, LENGTH],
    ['10 mm / 4 mm', 2.5, UNITLESS],
    ['2 mm * 3 mm', 6, AREA],
    ['(2 mm) ^ 3', 8, VOLUME],
    ['1 / 2 mm', 0.5, PER_LENGTH],
    ['4 mm ^ 2 / 2 mm', 8, LENGTH],
    ['45 deg + 1 rad', 45 + 180 / Math.PI, ANGLE],
    ['-5 mm', -5, LENGTH],
    ['(1 + 1) * 1 cm', 20, LENGTH],
    ['90 deg / 2', 45, ANGLE],
  ])('%s', (source, expected, dim) => {
    const result = value(source);
    expect(result.value).toBeCloseTo(expected, 10);
    expect(result.dim).toEqual(dim);
  });
});

describe('parameters', () => {
  it.each<[string, number, Dim]>([
    ['width', 40, LENGTH],
    ['width / 2', 20, LENGTH],
    ['width - 2 * wall', 34, LENGTH],
    ['width * count', 160, LENGTH],
    ['width * ratio', 20, LENGTH],
    ['width / wall', 40 / 3, UNITLESS],
    ['tilt * 2', 60, ANGLE],
    ['count ^ 2', 16, UNITLESS],
    ['count + 1', 5, UNITLESS],
    ['width * width', 1600, AREA],
  ])('%s', (source, expected, dim) => {
    const result = value(source);
    expect(result.value).toBeCloseTo(expected, 10);
    expect(result.dim).toEqual(dim);
  });
});

describe('plain numbers take the unit of their context', () => {
  it.each<[string, number, Dim]>([
    ['width + 2', 42, LENGTH],
    ['2 + width', 42, LENGTH],
    ['width - 1 * 2', 38, LENGTH],
    ['tilt + 15', 45, ANGLE],
    ['max(width, 50)', 50, LENGTH],
    ['min(5, width)', 5, LENGTH],
  ])('%s', (source, expected, dim) => {
    const result = value(source);
    expect(result.value).toBeCloseTo(expected, 10);
    expect(result.dim).toEqual(dim);
  });

  it('uses the document length unit', () => {
    expect(value('width + 1', undefined, 'in').value).toBeCloseTo(65.4);
    expect(value('2', 'length', 'cm').value).toBe(20);
    expect(value('2', 'length').value).toBe(2);
  });

  it('means degrees in angle context', () => {
    expect(value('15', 'angle')).toEqual({ ok: true, value: 15, dim: ANGLE });
  });

  it('but a unitless parameter stays a number', () => {
    expect(error('width + count').message).toBe("Can't add a length and a number.");
    expect(error('count', 'length').message).toBe(
      'This is a number, but a length is needed. Multiply by a unit, like `… * 1 mm`.',
    );
  });
});

describe('functions', () => {
  it.each<[string, number, Dim]>([
    ['sin(30 deg)', 0.5, UNITLESS],
    ['sin(30)', 0.5, UNITLESS],
    ['sin(tilt)', 0.5, UNITLESS],
    ['sin(pi / 6)', 0.5, UNITLESS],
    ['cos(60 deg)', 0.5, UNITLESS],
    ['cos(0)', 1, UNITLESS],
    ['tan(45 deg)', 1, UNITLESS],
    ['tan(pi / 4)', 1, UNITLESS],
    ['asin(0.5)', 30, ANGLE],
    ['acos(0.5)', 60, ANGLE],
    ['atan(1)', 45, ANGLE],
    ['atan(wall / wall)', 45, ANGLE],
    ['sqrt(16)', 4, UNITLESS],
    ['sqrt(9 mm * 4 mm)', 6, LENGTH],
    ['sqrt(width ^ 2 + 30 mm ^ 2)', 50, LENGTH],
    ['abs(-3 mm)', 3, LENGTH],
    ['abs(2)', 2, UNITLESS],
    ['min(3, 1, 2)', 1, UNITLESS],
    ['max(3 mm, 1 cm)', 10, LENGTH],
    ['min(width)', 40, LENGTH],
    ['round(2.5)', 3, UNITLESS],
    ['round(2.4 mm)', 2, LENGTH],
    ['floor(2.9)', 2, UNITLESS],
    ['ceil(2.1)', 3, UNITLESS],
    ['floor(-2.5)', -3, UNITLESS],
    ['ceil(width / 7 mm)', 6, UNITLESS],
    ['pi', Math.PI, UNITLESS],
    ['2 * pi', 2 * Math.PI, UNITLESS],
    ['sin(asin(0.25))', 0.25, UNITLESS],
    ['max(min(1, 2), 0)', 1, UNITLESS],
  ])('%s', (source, expected, dim) => {
    const result = value(source);
    expect(result.value).toBeCloseTo(expected, 10);
    expect(result.dim).toEqual(dim);
  });

  it('round in the document unit and in degrees', () => {
    expect(value('round(1.3 in)', undefined, 'in').value).toBeCloseTo(25.4);
    expect(value('round(44.6 deg)').value).toBe(45);
  });
});

describe('expected kinds', () => {
  it.each<[string, UnitKind, number, Dim]>([
    ['10 mm', 'length', 10, LENGTH],
    ['10', 'length', 10, LENGTH],
    ['2 * 3', 'length', 6, LENGTH],
    ['width / 2', 'length', 20, LENGTH],
    ['45 deg', 'angle', 45, ANGLE],
    ['45', 'angle', 45, ANGLE],
    ['atan(1)', 'angle', 45, ANGLE],
    ['count * 2', 'unitless', 8, UNITLESS],
    ['width / wall', 'unitless', 40 / 3, UNITLESS],
  ])('%s as %s', (source, kind, expected, dim) => {
    const result = value(source, kind);
    expect(result.value).toBeCloseTo(expected, 10);
    expect(result.dim).toEqual(dim);
  });

  it.each<[string, UnitKind, string]>([
    ['10 deg', 'length', 'This is an angle, but a length is needed.'],
    ['width', 'angle', 'This is a length, but an angle is needed.'],
    ['width', 'unitless', 'This is a length, but a number is needed.'],
    ['width * wall', 'length', 'This is an area (length²), but a length is needed.'],
    [
      'sin(tilt)',
      'length',
      'This is a number, but a length is needed. Multiply by a unit, like `… * 1 mm`.',
    ],
    [
      'pi',
      'angle',
      'This is a number, but an angle is needed. Multiply by a unit, like `… * 1 deg`.',
    ],
  ])('%s as %s is an error', (source, kind, message) => {
    expect(error(source, kind).message).toBe(message);
  });
});

describe('unit errors', () => {
  it.each<[string, string]>([
    ['10 mm + 5 deg', "Can't add a length and an angle."],
    ['5 deg + 10 mm', "Can't add an angle and a length."],
    ['10 mm - 5 deg', "Can't subtract an angle from a length."],
    ['width + tilt', "Can't add a length and an angle."],
    ['width + pi', "Can't add a length and a number."],
    ['width + width * width', "Can't add a length and an area (length²)."],
    ['1 mm + 1 / 1 mm', "Can't add a length and a value in length⁻¹."],
    ['tilt * width + 1 mm', "Can't add a value in length·angle and a length."],
    ['sin(width)', '`sin` needs an angle, not a length.'],
    ['cos(1 mm)', '`cos` needs an angle, not a length.'],
    ['asin(30 deg)', '`asin` needs a number, not an angle.'],
    ['asin(2)', '`asin` needs a value between -1 and 1.'],
    ['acos(-1.5)', '`acos` needs a value between -1 and 1.'],
    ['sqrt(width)', "Can't take the square root of a length."],
    ['sqrt(-4)', "Can't take the square root of a negative number."],
    ['max(width, tilt)', "`max` can't compare an angle with a length."],
    ['min(1 mm, pi)', "`min` can't compare a number with a length."],
    ['2 ^ width', 'The exponent must be a number, not a length.'],
    ['width ^ 0.5', "Can't raise a length to the power 0.5."],
    ['(-8) ^ (1 / 3)', "Can't raise a negative number to the power 0.3333333333333333."],
    ['1 / 0', 'Division by zero.'],
    ['width / (wall - 3 mm)', 'Division by zero.'],
    ['10 ^ 400', 'The result is too large to use.'],
  ])('%s', (source, message) => {
    expect(error(source).message).toBe(message);
  });
});

describe('name errors', () => {
  it.each<[string, string]>([
    ['widht', 'Unknown name `widht`. Did you mean `width`?'],
    ['Width', 'Unknown name `Width`. Did you mean `width`?'],
    ['walls * 2', 'Unknown name `walls`. Did you mean `wall`?'],
    ['depth', 'Unknown name `depth`.'],
    ['sin', '`sin` is a function: write `sin(…)`.'],
    ['sine(30)', 'Unknown function `sine`. Did you mean `sin`?'],
    ['foo(1)', 'Unknown function `foo`.'],
    ['width(2)', "`width` isn't a function."],
    ['pi(2)', "`pi` isn't a function."],
    ['sqrt(1, 2)', '`sqrt` takes 1 value, not 2.'],
    ['sin()', '`sin` takes 1 value, not 0.'],
    ['max()', '`max` needs at least one value.'],
  ])('%s', (source, message) => {
    expect(error(source).message).toBe(message);
  });
});

describe('syntax errors', () => {
  it.each<[string, string, [number, number]]>([
    ['', 'Enter a value or an expression.', [0, 0]],
    ['   ', 'Enter a value or an expression.', [0, 3]],
    ['1 +', 'Expected a value after `+`.', [2, 3]],
    ['2 * (3 + 4', 'Missing a closing `)`.', [4, 10]],
    ['(1', 'Missing a closing `)`.', [0, 2]],
    ['1 + 2)', 'There is a `)` without a matching `(`.', [5, 6]],
    ['1 2', 'Missing an operator before `2`.', [2, 3]],
    ['2 width', 'Missing an operator before `width`.', [2, 7]],
    ['2(3)', 'Missing an operator before `(`.', [1, 2]],
    ['10 mm mm', 'Missing an operator before `mm`.', [6, 8]],
    ['3x', "`x` isn't a unit. Units: mm, cm, m, in, ft, deg, rad.", [1, 2]],
    ['2e', "`e` isn't a unit. Units: mm, cm, m, in, ft, deg, rad.", [1, 2]],
    ['10kg', "`kg` isn't a unit. Units: mm, cm, m, in, ft, deg, rad.", [2, 4]],
    ['mm', 'A unit needs a number before it, like `1 mm`.', [0, 2]],
    ['width * deg', 'A unit needs a number before it, like `1 deg`.', [8, 11]],
    ['1 + * 2', 'Expected a value, found `*`.', [4, 5]],
    ['* 2', 'Expected a value, found `*`.', [0, 1]],
    ['()', 'Expected a value, found `)`.', [1, 2]],
    ['1 % 2', 'Unexpected character `%`.', [2, 3]],
    ['width = 2', 'Unexpected character `=`.', [6, 7]],
    ['max(1, )', 'Expected a value, found `)`.', [7, 8]],
    ['max(1 2)', 'Missing an operator before `2`.', [6, 7]],
    ['sqrt(4', 'Missing a closing `)` for `sqrt(`.', [0, 6]],
    ['1,2', 'Unexpected `,`.', [1, 2]],
    ['2 ^', 'Expected a value after `^`.', [2, 3]],
    ['-', 'Expected a value after `-`.', [0, 1]],
  ])('%j', (source, message, [start, end]) => {
    const e = error(source);
    expect(e.message).toBe(message);
    expect(e.span).toEqual({ start, end });
  });
});

describe('the parser', () => {
  it('records source spans for underlining', () => {
    const node = parse('width + 10 mm');
    expect(node).toMatchObject({
      kind: 'binary',
      span: { start: 0, end: 13 },
      left: { kind: 'ref', span: { start: 0, end: 5 } },
      right: { kind: 'num', value: 10, unit: 'mm', span: { start: 8, end: 13 } },
    });
  });

  it('marks the unknown name, not the whole expression', () => {
    expect(error('2 * widht + 1').span).toEqual({ start: 4, end: 9 });
  });

  it('lists referenced names once, in order', () => {
    expect(references(parse('a + sin(b) * a / max(c, pi)'))).toEqual(['a', 'b', 'c', 'pi']);
  });

  it('tokenizes numbers, names and operators', () => {
    expect(tokenize('1.5e3mm+x_1').map((t) => t.text)).toEqual(['1.5e3', 'mm', '+', 'x_1', '']);
  });
});

describe('formatQuantity', () => {
  const mm = { units: 'mm' as const, precision: 2 };
  it.each<[number, Dim, { units: LengthUnit; precision: number }, string]>([
    [40, LENGTH, mm, '40.00 mm'],
    [25.4, LENGTH, { units: 'in', precision: 3 }, '1.000 in'],
    [1500, LENGTH, { units: 'm', precision: 1 }, '1.5 m'],
    [45, ANGLE, mm, '45.00°'],
    [0.5, UNITLESS, mm, '0.50'],
    [600, AREA, { units: 'cm', precision: 0 }, '6 cm²'],
    [-0.001, LENGTH, mm, '0.00 mm'],
  ])('%d', (v, dim, settings, expected) => {
    expect(formatQuantity(v, dim, settings)).toBe(expected);
  });
});
