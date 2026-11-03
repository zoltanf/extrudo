import { describe, expect, it } from 'vitest';
import { insertName, matching, matchingBuiltins, newName, wordAt } from './completion';

describe('wordAt', () => {
  it.each<[string, number, string | undefined]>([
    ['cut', 3, 'cut'],
    ['cut', 1, 'cut'],
    ['2 * cut_h', 9, 'cut_h'],
    ['width + ', 8, ''],
    ['', 0, ''],
    ['max(a, b', 8, 'b'],
    ['d1 + 2', 2, 'd1'],
    ['12', 2, undefined],
    ['1e3', 3, undefined],
    ['10 m', 4, undefined],
    ['10mm', 4, undefined],
    ['2.5 ', 4, undefined],
    ['d1 x', 4, 'x'],
  ])('%s at %i', (text, caret, word) => {
    expect(wordAt(text, caret)?.text).toBe(word);
  });

  it('spans the whole word around the caret', () => {
    expect(wordAt('1 + cut_height', 7)).toEqual({ start: 4, end: 14, text: 'cut_height' });
  });
});

describe('matching', () => {
  const entries = [
    { name: 'base_cut', value: '1.00 mm' },
    { name: 'cut_height', value: '12.00 mm' },
    { name: 'width', value: '40.00 mm' },
    { name: 'Cut', value: '2.00' },
    { name: 'cut' },
  ];
  const names = (word: string) => matching(word, entries).map((e) => e.name);

  it('finds names containing the word, ignoring case, exact then prefix matches first', () => {
    expect(names('cut')).toEqual(['cut', 'cut_height', 'Cut', 'base_cut']);
    expect(names('HEIGHT')).toEqual(['cut_height']);
    expect(names('x')).toEqual([]);
  });

  it('offers every name for an empty word, in order', () => {
    expect(names('')).toEqual(entries.map((e) => e.name));
  });
});

describe('matchingBuiltins', () => {
  const names = (word: string) => matchingBuiltins(word).map((e) => e.name);

  it('finds functions and constants by prefix only, the exact name first', () => {
    expect(names('s')).toEqual(['sin', 'sqrt']);
    expect(names('a')).toEqual(['asin', 'acos', 'atan', 'abs']);
    expect(names('SQ')).toEqual(['sqrt']);
    expect(names('in')).toEqual([]);
    expect(names('pi')).toEqual(['pi']);
  });

  it('shows arguments for functions and the value for pi', () => {
    expect(matchingBuiltins('sqrt')).toEqual([{ name: 'sqrt', args: 'x' }]);
    expect(matchingBuiltins('max')).toEqual([{ name: 'max', args: 'a, b, …' }]);
    expect(matchingBuiltins('pi')).toEqual([{ name: 'pi', value: '3.14159' }]);
  });
});

describe('insertName', () => {
  const at = (text: string, caret: number) => wordAt(text, caret) ?? { start: 0, end: 0, text: '' };

  it('replaces the word and puts the caret after it', () => {
    expect(insertName('2 * cu + 1', at('2 * cu + 1', 6), { name: 'cut' })).toEqual({
      text: '2 * cut + 1',
      caret: 7,
    });
  });

  it('gives a function its brackets with the caret inside', () => {
    expect(insertName('2 * sq', at('2 * sq', 6), { name: 'sqrt', args: 'x' })).toEqual({
      text: '2 * sqrt()',
      caret: 9,
    });
  });

  it('reuses brackets that follow already', () => {
    expect(insertName('mi (a, b)', at('mi (a, b)', 2), { name: 'min', args: 'a, b, …' })).toEqual({
      text: 'min (a, b)',
      caret: 5,
    });
  });
});

describe('newName', () => {
  it.each<[string, string | undefined]>([
    ['width', 'width'],
    ['  wall_2 ', 'wall_2'],
    ['2 * width', undefined],
    ['w = 1', undefined],
    ['2w', undefined],
    ['', undefined],
  ])('%j', (text, name) => {
    expect(newName(text)).toBe(name);
  });
});
