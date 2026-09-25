import { describe, expect, it } from 'vitest';
import { memoryPreferences, webPreferences } from './preferences';

function fakeStorage(fail = false): Storage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      if (fail) throw new Error('QuotaExceededError');
      values.set(key, value);
    },
    removeItem: (key) => void values.delete(key),
    clear: () => values.clear(),
    key: (i) => [...values.keys()][i] ?? null,
    get length() {
      return values.size;
    },
  };
}

describe('webPreferences', () => {
  it('stores JSON under a prefixed key', () => {
    const storage = fakeStorage();
    const prefs = webPreferences(storage);
    prefs.set('panel.browser', { size: 300, collapsed: true });
    expect(storage.getItem('extrudo.panel.browser')).toBe('{"size":300,"collapsed":true}');
    expect(prefs.get('panel.browser', {})).toEqual({ size: 300, collapsed: true });
  });

  it('falls back when nothing is stored or the value is not JSON', () => {
    const storage = fakeStorage();
    storage.setItem('extrudo.theme', '{broken');
    const prefs = webPreferences(storage);
    expect(prefs.get('theme', 'dark')).toBe('dark');
    expect(prefs.get('missing', 42)).toBe(42);
  });

  it('ignores storage that refuses writes or does not exist', () => {
    expect(() => webPreferences(fakeStorage(true)).set('theme', 'light')).not.toThrow();
    const none = webPreferences(undefined);
    none.set('theme', 'light');
    expect(none.get('theme', 'dark')).toBe('dark');
  });
});

describe('memoryPreferences', () => {
  it('keeps values in memory', () => {
    const prefs = memoryPreferences({ theme: 'light' });
    expect(prefs.get('theme', 'dark')).toBe('light');
    prefs.set('theme', 'system');
    expect(prefs.get('theme', 'dark')).toBe('system');
  });
});
