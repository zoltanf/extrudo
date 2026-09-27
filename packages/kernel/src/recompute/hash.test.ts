import { describe, expect, it } from 'vitest';
import { canonicalJson, hashOf, hashString } from './hash';

describe('canonicalJson', () => {
  it('sorts object keys at every level and drops undefined', () => {
    expect(canonicalJson({ b: 1, a: { d: [2, { f: 1, e: 0 }], c: undefined } })).toBe(
      '{"a":{"d":[2,{"e":0,"f":1}]},"b":1}',
    );
  });

  it('keeps non-finite numbers apart from null and each other', () => {
    const forms = [null, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];
    expect(new Set(forms.map(canonicalJson)).size).toBe(4);
  });
});

describe('hashString', () => {
  it('gives 32 hex digits, the same for the same text', () => {
    expect(hashString('extrude')).toMatch(/^[0-9a-f]{32}$/);
    expect(hashString('extrude')).toBe(hashString('extrude'));
  });

  it('changes with a one-character edit, including the empty string', () => {
    const texts = ['', 'a', 'b', 'ab', 'ba', '{"x":1}', '{"x":2}', '{"x":10}'];
    expect(new Set(texts.map(hashString)).size).toBe(texts.length);
  });

  it('shows no collisions over 100 000 near-identical keys', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 100_000; i++) seen.add(hashOf({ distance: i / 1000 }, 'upstream'));
    expect(seen.size).toBe(100_000);
  });
});

describe('hashOf', () => {
  it('ignores key order but not array order', () => {
    expect(hashOf({ a: 1, b: 2 })).toBe(hashOf({ b: 2, a: 1 }));
    expect(hashOf([1, 2])).not.toBe(hashOf([2, 1]));
    expect(hashOf('a', 'b')).not.toBe(hashOf('ab'));
  });
});
