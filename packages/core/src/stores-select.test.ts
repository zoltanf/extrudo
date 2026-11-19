import { describe, expect, it } from 'vitest';
import { createSessionStore, type SelectionItem, type SelectMode } from './stores';

/** The rules before ADR-0156, scanning the list per item: the reference. */
function byScan(
  current: readonly SelectionItem[],
  items: readonly SelectionItem[],
  mode: SelectMode,
): SelectionItem[] {
  const same = (a: SelectionItem, b: SelectionItem) => a.kind === b.kind && a.id === b.id;
  if (mode === 'replace') {
    return items.filter((item, i) => !items.slice(0, i).some((s) => same(s, item)));
  }
  const result = [...current];
  for (const item of items) {
    const index = result.findIndex((s) => same(s, item));
    if (index < 0) result.push(item);
    else if (mode === 'toggle') result.splice(index, 1);
  }
  return result;
}

function random(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const KINDS = ['face', 'edge', 'profile', 'sketchEntity'] as const;

describe('select (ADR-0156: one pass)', () => {
  it('gives what the list scan gave, duplicates and order included', () => {
    const r = random(3);
    const item = (): SelectionItem => ({
      kind: KINDS[Math.floor(r() * KINDS.length)] as SelectionItem['kind'],
      id: `x${Math.floor(r() * 12)}`,
    });
    for (let k = 0; k < 600; k++) {
      const mode = (['replace', 'add', 'toggle'] as const)[k % 3] as SelectMode;
      const items = Array.from({ length: Math.floor(r() * 14) }, item);
      // Every fifth case starts from a selection holding an item twice (only a store's own
      // rules make selections, which never do, but the old rules still apply then).
      const current =
        k % 5 === 0
          ? Array.from({ length: 1 + Math.floor(r() * 8) }, item)
          : byScan([], Array.from({ length: Math.floor(r() * 8) }, item), 'replace');
      const store = createSessionStore();
      store.setState({ selection: current });
      store.getState().select(items, mode);
      expect(store.getState().selection).toEqual(byScan(current, items, mode));
    }
  });

  it('reads each item a bounded number of times, however many are picked', () => {
    let reads = 0;
    const counted = (kind: SelectionItem['kind'], id: string): SelectionItem => ({
      get kind() {
        reads++;
        return kind;
      },
      get id() {
        return id;
      },
    });
    const n = 20_000;
    const items = Array.from({ length: n }, (_, i) => counted('profile', `s/${i % (n / 2)}`));
    const store = createSessionStore();
    for (const mode of ['replace', 'add', 'toggle'] as const) {
      reads = 0;
      store.getState().select(items, mode);
      // The list scan read about n² / 4 kinds here (100 million).
      expect(reads).toBeLessThanOrEqual(3 * n);
    }
    expect(store.getState().selection).toHaveLength(n / 2);
  });
});
