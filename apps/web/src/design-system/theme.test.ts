import { describe, expect, it } from 'vitest';
import { DEFAULT_THEME, resolveTheme } from './theme';

describe('resolveTheme', () => {
  it('uses the choice, or the system theme for "system"', () => {
    expect(resolveTheme('dark', 'light')).toBe('dark');
    expect(resolveTheme('light', 'dark')).toBe('light');
    expect(resolveTheme('system', 'light')).toBe('light');
    expect(resolveTheme('system', 'dark')).toBe('dark');
  });
});

describe('the default theme', () => {
  it('follows the system until a choice is stored', () => {
    expect(DEFAULT_THEME).toBe('system');
  });
});
