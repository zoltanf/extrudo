/**
 * The two loops over components that were quadratic (ADR-0083, 2026-11-15):
 * the parents from the occurrence lists (`setParents`) and the unique component
 * names (`uniqueName`). The functions before the change are kept here as the
 * reference: on seeded random inputs with many collisions the new ones give the
 * same output, and 20,000 components of one name or 20,000 occurrences take a
 * number of steps linear in that. Synthetic inputs only.
 */
import { describe, expect, it } from 'vitest';
import { uniqueName } from './components';
import { type F3dComponent, setParents } from './decode/component';

/** A small seeded generator (mulberry32), so a failure can be replayed. */
function random(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** `readComponents`' parent loop before the change. */
function oldSetParents(
  components: Map<number, F3dComponent>,
  lists: [owner: number, occurrences: number[]][],
): void {
  for (const [owner, occurrences] of lists)
    for (const occ of occurrences) {
      const child = [...components.values()].find((c) => c.occurrences.some((o) => o.id === occ));
      if (child && child.id !== owner) child.parent = owner;
    }
}

/** `uniqueName` before the change. */
function oldUniqueName(name: string, taken: Set<string>): string {
  const base = name.trim().slice(0, 90).trim();
  let chosen = base || 'Component1';
  for (let n = 2; taken.has(chosen.toLowerCase()); n++)
    chosen = base ? `${base} (${n})` : `Component${n}`;
  taken.add(chosen.toLowerCase());
  return chosen;
}

const component = (id: number, occurrences: number[]): F3dComponent => ({
  id,
  name: `C${id}`,
  root: false,
  visible: true,
  occurrences: occurrences.map((o) => ({ id: o, ordinal: 1 })),
});

describe('setParents', () => {
  it('gives every component the parent the old loop gave it, on random inputs', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const next = random(seed);
      const pick = (n: number) => Math.floor(next() * n);
      const count = 1 + pick(30);
      const pool = 1 + pick(40);
      const spec: [number, number[]][] = [];
      for (let i = 0; i < count; i++) {
        // Ids out of order; occurrences shared between components (the first in order has it).
        const id = 1 + pick(60);
        spec.push([id, Array.from({ length: pick(5) }, () => 1 + pick(pool))]);
      }
      const lists: [number, number[]][] = Array.from({ length: pick(8) }, () => [
        1 + pick(70),
        Array.from({ length: pick(12) }, () => 1 + pick(pool + 5)),
      ]);
      const build = () => {
        const m = new Map<number, F3dComponent>();
        for (const [id, occ] of spec) m.set(id, component(id, occ));
        return m;
      };
      const before = build();
      const after = build();
      oldSetParents(before, lists);
      setParents(after, lists);
      const parents = (m: Map<number, F3dComponent>) =>
        [...m.values()].map((c) => [c.id, c.parent]);
      expect([seed, parents(after)]).toEqual([seed, parents(before)]);
    }
  });

  it('reads each component’s occurrences once for 20,000 occurrences', () => {
    const N = 20_000;
    let reads = 0;
    const components = new Map<number, F3dComponent>();
    for (let i = 0; i < N; i++) {
      const c = component(i + 2, [N + i]);
      const occurrences = c.occurrences;
      Object.defineProperty(c, 'occurrences', {
        get: () => {
          reads++;
          return occurrences;
        },
      });
      components.set(c.id, c);
    }
    const t = performance.now();
    setParents(components, [[1, Array.from({ length: N }, (_, i) => N + i)]]);
    const ms = performance.now() - t;
    expect(reads).toBe(N);
    expect([...components.values()].every((c) => c.parent === 1)).toBe(true);
    expect(ms).toBeLessThan(2_000);
  });
});

describe('uniqueName', () => {
  it('chooses the names the old search chose, on random inputs with heavy collisions', () => {
    const names = [
      '',
      '  ',
      'Lid',
      'lid',
      ' Lid ',
      'LID',
      'Lid (2)',
      'lid (3)',
      'Lid (2) (2)',
      'Lid (10)',
      'Component1',
      'component2',
      'Component3 ',
      'Component',
      'Component (2)',
      `${'x'.repeat(90)}a`,
      `${'X'.repeat(90)}b`,
      `${'x'.repeat(89)} y`,
      `${'x'.repeat(90)} (2)`,
      'Box',
    ];
    for (let seed = 1; seed <= 200; seed++) {
      const next = random(seed);
      const sequence = Array.from(
        { length: 1 + Math.floor(next() * 400) },
        () => names[Math.floor(next() * names.length)] as string,
      );
      const oldTaken = new Set<string>();
      const taken = new Set<string>();
      const counters = new Map<string, number>();
      const before = sequence.map((n) => oldUniqueName(n, oldTaken));
      const after = sequence.map((n) => uniqueName(n, taken, counters));
      expect([seed, after]).toEqual([seed, before]);
    }
  });

  it('looks up a number of names linear in 20,000 components of one name', () => {
    const N = 20_000;
    for (const name of ['Bracket', '']) {
      let lookups = 0;
      class Counted extends Set<string> {
        override has(v: string): boolean {
          lookups++;
          return super.has(v);
        }
      }
      const taken = new Counted();
      const counters = new Map<string, number>();
      // A literal that equals a generated name, in the middle of the run.
      const sequence = Array.from({ length: N }, (_, i) =>
        i === N / 2 ? (name ? `${name} (${N / 2 + 100})` : `Component${N / 2 + 100}`) : name,
      );
      const t = performance.now();
      const chosen = sequence.map((n) => uniqueName(n, taken, counters));
      const ms = performance.now() - t;
      expect(new Set(chosen.map((c) => c.toLowerCase())).size).toBe(N);
      expect(chosen.at(-1)).toBe(name ? `${name} (${N})` : `Component${N}`);
      expect(lookups).toBeLessThanOrEqual(2 * N + 2);
      expect(ms).toBeLessThan(2_000);
    }
  });
});
