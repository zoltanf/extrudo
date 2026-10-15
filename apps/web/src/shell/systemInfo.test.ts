import { describe, expect, it } from 'vitest';
import { formatBytes, formatDuration } from './systemInfo';

const MIN = 60_000;

describe('formatDuration', () => {
  it('rounds down to whole minutes and drops zero parts', () => {
    expect(formatDuration(59_999)).toBe('under a minute');
    expect(formatDuration(MIN)).toBe('1 min');
    expect(formatDuration(59 * MIN + 59_999)).toBe('59 min');
    expect(formatDuration(60 * MIN)).toBe('1 h');
    expect(formatDuration(72 * MIN)).toBe('1 h 12 min');
    expect(formatDuration(24 * 60 * MIN)).toBe('1 d');
    expect(formatDuration((51 * 60 + 30) * MIN)).toBe('2 d 3 h');
  });
});

describe('formatBytes', () => {
  it('picks kB, MB or GB', () => {
    expect(formatBytes(72 * 1024)).toBe('72 kB');
    expect(formatBytes(27 * 1024 * 1024)).toBe('27 MB');
    expect(formatBytes(2.8 * 1024 ** 3)).toBe('2.8 GB');
  });
});
