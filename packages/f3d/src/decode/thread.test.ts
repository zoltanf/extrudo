/** The thread reader on hand-built members (no real file's bytes). */
import { describe, expect, it } from 'vitest';
import type { Segment } from '../segment';
import type { Scope } from './scope';
import { Bytes } from './test-segment';
import { readThreadSpec } from './thread';

const f64s = (b: Bytes, ...values: number[]) =>
  b.raw([...new Uint8Array(new Float64Array(values).buffer)]);
const wstr = (b: Bytes, s: string) => {
  b.u32(s.length);
  for (const c of s) b.u8(c.charCodeAt(0)).u8(0);
  return b;
};

/** A thread's members right after a two-byte prologue (offset 2). */
function thread(major: number, minor: number, pitch: number) {
  const b = new Bytes().u8(0).u8(0);
  f64s(b, 60).u8(1);
  wstr(b, '6g');
  wstr(b, 'M10x1.5');
  wstr(b, '10.0');
  wstr(b, 'ISO Metric profile');
  b.u8(1).u32(1);
  f64s(b, major, minor).u8(0);
  f64s(b, pitch, 0.9);
  const seg = { bulk: new Uint8Array(b.out) } as unknown as Segment;
  const scope = { id: 1, refs: [], start: 0, end: b.out.length } as unknown as Scope;
  return readThreadSpec(seg, scope);
}

describe('thread', () => {
  it('reads the sizes', () => {
    expect(thread(1, 0.84, 0.15)).toMatchObject({ designation: 'M10x1.5', major: 1, pitch: 0.15 });
  });

  it('takes no thread whose major diameter is not finite', () => {
    expect(thread(Number.POSITIVE_INFINITY, 0.84, 0.15)).toBeUndefined();
    expect(thread(Number.NaN, 0.84, 0.15)).toBeUndefined();
  });
});
