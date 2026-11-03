import { describe, expect, it } from 'vitest';
import { defaultInUnit } from './default-unit';

describe('defaultInUnit', () => {
  it.each([
    ['0 mm', '0 in'],
    ['0.01 mm', '0.001 in'],
    ['1 mm', '0.03125 in'],
    ['2 mm', '0.0625 in'],
    ['4 mm', '0.125 in'],
    ['5 mm', '0.1875 in'],
    ['10 mm', '0.375 in'],
    ['20 mm', '0.75 in'],
    ['40 mm', '1.5 in'],
  ])('gives the inch size a US user would pick: %s → %s', (mm, inch) => {
    expect(defaultInUnit(mm, 'in')).toBe(inch);
  });

  it('converts a size outside the table exactly', () => {
    expect(defaultInUnit('25.4 mm', 'in')).toBe('1 in');
    expect(defaultInUnit('3 mm', 'cm')).toBe('0.3 cm');
    expect(defaultInUnit('10 mm', 'm')).toBe('0.01 m');
  });

  it('leaves mm designs, other units and expressions alone', () => {
    expect(defaultInUnit('10 mm', 'mm')).toBe('10 mm');
    expect(defaultInUnit('360 deg', 'in')).toBe('360 deg');
    expect(defaultInUnit('1', 'in')).toBe('1');
    expect(defaultInUnit('wall * 2', 'in')).toBe('wall * 2');
  });
});
