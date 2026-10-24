import { afterEach, describe, expect, it } from 'vitest';
import { memoryPreferences } from '../platform/preferences';
import { keymapOverrides, keysFor, setKeymapOverrides, subscribeKeymap } from './keymap';
import {
  cleanOverrides,
  conflictsFor,
  isReserved,
  KEYMAP_PREFERENCE,
  type KeymapEntry,
  keymapStore,
} from './keymapStore';

afterEach(() => setKeymapOverrides({}));

describe('keymap overrides', () => {
  it('tells its subscribers after every change, with a new overrides object (ADR-0102 §5)', () => {
    const store = keymapStore(memoryPreferences());
    const seen: ReturnType<typeof keymapOverrides>[] = [];
    const unsubscribe = subscribeKeymap(() => seen.push(keymapOverrides()));
    const before = keymapOverrides();
    store.set('trim', ['Shift+R']);
    expect(seen).toHaveLength(1);
    expect(seen[0]).not.toBe(before);
    expect(seen[0]?.trim).toEqual(['Shift+R']);
    unsubscribe();
    store.reset('trim');
    expect(seen).toHaveLength(1);
  });

  it('keysFor follows an override, else the default', () => {
    const store = keymapStore(memoryPreferences());
    expect(keysFor('trim')).toEqual(['T']);
    store.set('trim', ['Shift+R']);
    expect(keysFor('trim')).toEqual(['Shift+R']);
    store.set('horizontal', ['H']);
    expect(keysFor('horizontal')).toEqual(['H']);
    store.reset('trim');
    expect(keysFor('trim')).toEqual(['T']);
  });

  it('an empty list takes the key away', () => {
    keymapStore(memoryPreferences()).set('trim', []);
    expect(keysFor('trim')).toEqual([]);
  });

  it('writes only what differs from the default', () => {
    const preferences = memoryPreferences();
    const store = keymapStore(preferences);
    store.set('line', ['L']);
    store.set('circle', ['Shift+C']);
    expect(preferences.get(KEYMAP_PREFERENCE, {})).toEqual({ circle: ['Shift+C'] });
    store.resetAll();
    expect(preferences.get(KEYMAP_PREFERENCE, {})).toEqual({});
  });

  it('reads the stored preference when created, and tells subscribers', () => {
    const preferences = memoryPreferences();
    preferences.set(KEYMAP_PREFERENCE, { fit: ['F'] });
    const store = keymapStore(preferences);
    expect(keysFor('fit')).toEqual(['F']);
    let calls = 0;
    const off = store.subscribe(() => calls++);
    store.setMany({ fit: ['F6'], extrude: ['Shift+E'] });
    off();
    store.reset('extrude');
    expect(calls).toBe(1);
    expect(store.get()).toEqual({});
  });

  it('drops stored values that are not lists of keys', () => {
    expect(cleanOverrides({ a: 'X', b: [1], c: ['K H'], d: [''], line: ['L'] })).toEqual({
      c: ['K H'],
    });
    expect(cleanOverrides(['X'])).toEqual({});
    expect(cleanOverrides(null)).toEqual({});
  });
});

describe('reserved keys', () => {
  it('refuses the keys dialogs and the browser own', () => {
    expect(isReserved('Escape')).toBe(true);
    expect(isReserved('Mod+W')).toBe(true);
    expect(isReserved('K Escape')).toBe(true);
    expect(isReserved('Mod+Shift+K')).toBe(false);
    expect(isReserved('K H')).toBe(false);
  });
});

describe('conflictsFor', () => {
  const both = new Set(['model', 'sketch'] as const);
  const sketch = new Set(['sketch'] as const);
  const model = new Set(['model'] as const);
  const entries: KeymapEntry[] = [
    { id: 'hole', label: 'Hole', keys: ['H'], modes: model },
    { id: 'trim', label: 'Trim', keys: ['T'], modes: sketch },
    { id: 'tangent', label: 'Tangent', keys: ['K T'], modes: sketch },
    { id: 'horizontal', label: 'Horizontal', keys: [], modes: sketch },
    { id: 'fit', label: 'Fit', keys: ['F6'], modes: both },
  ];

  it('blocks a key another command uses in the same mode', () => {
    expect(conflictsFor('horizontal', 'T', entries)).toEqual({
      blocking: [{ id: 'trim', label: 'Trim', keys: 'T' }],
      shared: [],
    });
    expect(conflictsFor('horizontal', 'F6', entries).blocking.map((c) => c.id)).toEqual(['fit']);
  });

  it('allows a key shared across modes, as a note', () => {
    expect(conflictsFor('horizontal', 'H', entries)).toEqual({
      blocking: [],
      shared: [{ id: 'hole', label: 'Hole', keys: 'H' }],
    });
  });

  it("blocks a single key that is a chord's first key, and the other way round", () => {
    expect(conflictsFor('horizontal', 'K', entries).blocking.map((c) => c.id)).toEqual(['tangent']);
    expect(conflictsFor('horizontal', 'T X', entries).blocking.map((c) => c.id)).toEqual(['trim']);
    expect(conflictsFor('horizontal', 'K H', entries).blocking).toEqual([]);
  });
});
