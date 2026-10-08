import { describe, expect, it } from 'vitest';
import { DOT_WIDTH, TITLE_GAP, titleFit } from './titleFit';

describe('titleFit', () => {
  const name = 120;
  const status = 60;
  it('keeps everything while it fits, to the pixel', () => {
    expect(titleFit(1000, name, status)).toBe('full');
    expect(titleFit(name + TITLE_GAP + status, name, status)).toBe('full');
  });
  it('drops the save state word first, keeping the dot', () => {
    expect(titleFit(name + TITLE_GAP + status - 1, name, status)).toBe('dot');
    expect(titleFit(name + TITLE_GAP + DOT_WIDTH, name, status)).toBe('dot');
  });
  it('then truncates the name', () => {
    expect(titleFit(name + TITLE_GAP + DOT_WIDTH - 1, name, status)).toBe('truncate');
    expect(titleFit(0, name, status)).toBe('truncate');
  });
  it('takes a custom dot width', () => {
    expect(titleFit(100, 90, 50, 5)).toBe('dot');
    expect(titleFit(100, 90, 50, 8)).toBe('truncate');
  });
});
