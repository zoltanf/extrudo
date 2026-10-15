import { describe, expect, it } from 'vitest';
import type { Segment } from '../segment';
import { readExtrudeHead } from './extrude';
import type { Scope } from './scope';

describe('readExtrudeHead', () => {
  /** A record payload: the prologue (no leading block, an empty property block), then `rest`. */
  const head = (rest: number[]) => {
    const block = [4, 0, 0, 0, 1, 0, 0, 0, 2, 0, 0, 0, 0, 1, 0]; // new body, one side, solid
    const bytes = new Uint8Array([0, 1, 0, 0, 0, 0, ...rest, ...block, ...new Array(16).fill(0)]);
    const seg = { bulk: bytes } as unknown as Segment;
    return readExtrudeHead(seg, { id: 1, start: 0, end: bytes.length } as unknown as Scope);
  };

  it('finds the operation block after a leading reference that carries its type GUID', () => {
    const guid = [...new TextEncoder().encode('2CA5A1CD-C99B-4C9B-91AF-57989148E841')];
    // 01, u64 id, u32 36 and the GUID, then two bytes: the block starts at 57.
    const ref = [1, 0x66, 4, 0, 0, 0, 0, 0, 0, 36, 0, 0, 0, ...guid, 0, 0];
    expect(6 + ref.length).toBe(57);
    expect(head(ref)).toEqual({
      operation: 'new-body',
      direction: 'one-side',
      reversed: false,
      solid: true,
      start: 'profile-plane',
    });
  });

  it('still reads the block right after a null reference', () => {
    expect(head([0]).operation).toBe('new-body');
  });
});
