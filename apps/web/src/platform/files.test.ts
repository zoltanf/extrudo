import { describe, expect, it } from 'vitest';
import { safeFileName } from './files';

describe('safeFileName', () => {
  it.each([
    ['Wall bracket', 'Wall bracket.extrudo'],
    ['a/b\\c:d', 'a b c d.extrudo'],
    ['  lots   of  space ', 'lots of space.extrudo'],
    ['..hidden', 'hidden.extrudo'],
    ['???', 'Untitled.extrudo'],
    ['tab\there', 'tab here.extrudo'],
  ])('%j → %j', (name, file) => {
    expect(safeFileName(name, '.extrudo')).toBe(file);
  });
});
