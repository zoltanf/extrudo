import { describe, expect, it } from 'vitest';
import { formatModified } from './time';

const now = new Date(2026, 8, 25, 15, 0, 0);
const ago = (seconds: number) => new Date(now.getTime() - seconds * 1000).toISOString();

describe('formatModified', () => {
  it.each([
    [ago(10), 'Just now'],
    [ago(60), '1 minute ago'],
    [ago(5 * 60), '5 minutes ago'],
    [ago(3 * 3600), '3 hours ago'],
    [new Date(2026, 8, 24, 9, 0).toISOString(), 'Yesterday'],
    [new Date(2026, 8, 21, 9, 0).toISOString(), '4 days ago'],
    [new Date(2026, 8, 12, 9, 0).toISOString(), '12 Sep 2026'],
  ])('%s → %s', (iso, text) => {
    expect(formatModified(iso, now)).toBe(text);
  });

  it('is empty for a bad timestamp', () => {
    expect(formatModified('nope', now)).toBe('');
  });
});
