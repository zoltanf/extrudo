/**
 * Base features on a hand-built segment: the two body records a base feature
 * names, told apart by their property block, and the body index read behind
 * that block (the 2018–19 layout). Synthetic bytes only.
 */
import { describe, expect, it } from 'vitest';
import { refsIn } from '../model';
import { BASE_FEATURE, readBase } from './base';
import { BODY, baseBodyRole, readBody } from './body';
import { Bytes, segment } from './test-segment';

/** A base feature's body: its role, a reference to the other body (with its type GUID), then the index. */
function baseBody(key: string, other: number, index: number, shown: boolean, extra = 0): number[] {
  const b = new Bytes().u8(0).u8(1).u32(1).str8(key).str8('PassiveRefMetaType');
  b.u8(1).u64(other).str8(BODY).u8(0).u8(0);
  for (let i = 0; i < extra; i++) b.u32(0);
  return b
    .u32(2)
    .u32(index)
    .u32(0)
    .u32(0x222f90)
    .u8(1)
    .u8(shown ? 1 : 0)
    .raw(new Array(24).fill(0)).out;
}

const seg = segment([
  { guid: BASE_FEATURE, id: 40, body: new Bytes().ref(50).ref(51).ref(50).ref(60).u32(0).out },
  { guid: BODY, id: 50, body: baseBody('BASEFEAT_PM_BODY_REF', 51, 1, false) },
  { guid: BODY, id: 51, body: baseBody('BASEFEAT_DM_BODY_REF', 50, 3, true, 1) },
  // A body that is no base feature's: no property block.
  { guid: BODY, id: 60, body: new Bytes().u8(0).u8(0).raw(new Array(40).fill(0)).out },
  // A crafted property block: a key longer than the record.
  { guid: BODY, id: 70, body: new Bytes().u8(0).u8(1).u32(1).u32(0xffffffff).out },
]);

describe('base features', () => {
  it('tells the body it keeps from the design body it made', () => {
    const f = seg.frame(40);
    expect(readBase(seg, 40, refsIn(seg, f.start, f.end))).toEqual({ id: 40, kept: 50, made: 51 });
    expect(baseBodyRole(seg, 50)?.role).toBe('kept');
    expect(baseBodyRole(seg, 51)?.role).toBe('made');
    expect(baseBodyRole(seg, 60)).toBeUndefined();
  });

  it('holds no body when it names none', () => {
    expect(readBase(seg, 40, [60])).toEqual({ id: 40 });
  });

  it("reads a base feature's body index behind its property block", () => {
    expect(readBody(seg, 50)).toEqual({ index: 1, visible: false });
    // A u32 more before the 2 (another generation of the reference).
    expect(readBody(seg, 51)).toEqual({ index: 3, visible: true });
  });

  it('refuses a crafted property block without throwing', () => {
    expect(baseBodyRole(seg, 70)).toBeUndefined();
    expect(readBody(seg, 70)).toBeUndefined();
  });
});
