/**
 * The feature-tail scan (M3): a normal record's tail sits at its end and is
 * found; a record with the tail buried more than the scan window from its end
 * is refused instead of searched byte by byte.
 */
import { describe, expect, it } from 'vitest';
import type { Segment } from '../segment';
import { readScope } from './scope';

function u32(v: number): number[] {
  return [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
}

/** u32 L + L UTF-16LE letters. */
function kind(s: string): number[] {
  const units = [...s].map((c) => c.charCodeAt(0));
  return [...u32(units.length), ...units.flatMap((u) => [u & 0xff, (u >>> 8) & 0xff])];
}

/** An empty reference table, the state, the kind and the ordinal. */
function tail(k = 'Sketch', ordinal = 3): number[] {
  return [...u32(0), ...u32(5), ...kind(k), ...u32(ordinal)];
}

function segment(bulk: Uint8Array): Segment {
  return {
    bulk,
    frame: () => ({ start: 0, end: bulk.length }),
    has: () => true,
  } as unknown as Segment;
}

describe('readScope (M3)', () => {
  it('reads a tail at the end of the record', () => {
    const bulk = new Uint8Array(tail());
    const scope = readScope(segment(bulk), 1);
    expect(scope.kind).toBe('Sketch');
    expect(scope.ordinal).toBe(3);
    expect(scope.state).toBe(5);
    expect(scope.refs).toEqual([]);
  });

  it('does not scan past the last 64 kB of a record', () => {
    // The tail is valid but buried under 100 kB of padding: before the window
    // the scan found it; now it is out of range and the record is refused.
    const bulk = new Uint8Array([...tail(), ...new Array<number>(100 * 1024).fill(0)]);
    expect(() => readScope(segment(bulk), 1)).toThrow(/no feature tail found/);
  });
});
