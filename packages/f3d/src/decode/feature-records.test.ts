import { describe, expect, it } from 'vitest';
import {
  allParticipants,
  FEATURE_RECORDS,
  readFeatureRecords,
  timelineFeature,
} from './feature-records';
import { Bytes, segment } from './test-segment';

const wstr = (b: Bytes, s: string) => {
  b.u32(s.length);
  for (const ch of s) b.u8(ch.charCodeAt(0)).u8(0);
  return b;
};
const G1 = '11111111-0000-0000-0000-000000000000';
const G2 = '22222222-0000-0000-0000-000000000000';
const EXTRUDE = 'DD405BC2-D673-44F0-8833-5CB2A1C186C7';

/** Two features: #10 with a further record #11, #20 alone. */
function records() {
  const b = new Bytes().u8(0).u8(0).u32(2);
  wstr(b, G1).ref(10);
  wstr(b, G2).ref(20);
  b.u32(2);
  wstr(b, G1).u32(2).ref(10).ref(11);
  wstr(b, G2).u32(1).ref(20);
  b.ref(5);
  return segment([
    { guid: FEATURE_RECORDS, id: 1, body: b.out },
    ...[5, 10, 11, 20].map((id) => ({ guid: EXTRUDE, id, body: [0, 0] })),
  ]);
}

describe('readFeatureRecords', () => {
  it("maps each further record to the feature's first", () => {
    expect([...readFeatureRecords(records(), 1)]).toEqual([[11, 10]]);
  });

  it('refuses a count larger than the record', () => {
    const b = new Bytes().u8(0).u8(0).u32(1_000_000);
    const seg = segment([{ guid: FEATURE_RECORDS, id: 1, body: b.out }]);
    expect(() => readFeatureRecords(seg, 1)).toThrow(/features/);
  });
});

describe('timelineFeature', () => {
  const first = new Map([[11, 10]]);
  it('takes the record on the timeline, else the timeline feature a further record belongs to', () => {
    expect(timelineFeature([11, 10], new Set([10]), first)).toBe(10);
    expect(timelineFeature([11], new Set([10]), first)).toBe(10);
    // Its first record not on the timeline either: the record itself.
    expect(timelineFeature([11], new Set([30]), first)).toBe(11);
    expect(timelineFeature(undefined, new Set([10]), first)).toBeUndefined();
  });
});

describe('allParticipants', () => {
  it('adds the bodies the further records name, but keeps none named as none', () => {
    expect(allParticipants([1], [[2, 1], [3]])).toEqual([1, 2, 3]);
    expect(allParticipants([], [[2]])).toEqual([]);
  });
});
