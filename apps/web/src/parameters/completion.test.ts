import { describe, expect, it } from 'vitest';
import { matching, wordAt } from './completion';

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
