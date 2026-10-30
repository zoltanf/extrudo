import { describe, expect, it } from 'vitest';
import { isBareNumber, spellOutUnit } from './spell-unit';

describe('isBareNumber', () => {
  it('is true for literals and arithmetic of literals without a unit', () => {
    for (const e of ['10', ' 2.5 ', '-3', '1e-3', '10 / 2', '(2 + 3) * 4', '2^3']) {
      expect(isBareNumber(e), e).toBe(true);
    }
  });
  it('is false once a unit, a parameter or a function is involved, or it does not parse', () => {
    for (const e of ['10 mm', '2 in', 'width', 'width + 2', 'sqrt(4)', '10 +', '']) {
      expect(isBareNumber(e), e).toBe(false);
    }
  });
});

describe('spellOutUnit', () => {
  it('appends the unit to a plain number', () => {
    expect(spellOutUnit('10', 'mm')).toBe('10 mm');
    expect(spellOutUnit(' -2.5 ', 'in')).toBe('-2.5 in');
    expect(spellOutUnit('1e-3', 'm')).toBe('1e-3 m');
  });
  it('multiplies arithmetic of literals by one unit', () => {
    expect(spellOutUnit('10 / 2', 'mm')).toBe('(10 / 2) * 1 mm');
  });
  it('leaves everything else as it is', () => {
    for (const e of ['10 mm', '2 in', 'width', 'width + 2', 'sqrt(4)', '10 +']) {
      expect(spellOutUnit(e, 'in')).toBe(e);
    }
  });
});
