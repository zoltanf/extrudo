/**
 * The design segment reader against crafted records that cost more than their
 * size: a record that makes the operation-table search quadratic, and ids
 * repeated so a decode would run again for each (hand-built, no real file's bytes).
 */
import { describe, expect, it } from 'vitest';
import { Bytes, segment } from './decode/test-segment';
import { TIMELINE } from './decode/timeline';
import { OPERATION_TABLE, readSegment } from './model';
import { Segment } from './segment';

const OTHER = '0A0B0C0D-0000-4000-8000-000000000001';

describe('hostile segments', () => {
  it('gives up the operation-table search within a budget', () => {
    // Every offset reads as a count of about a thirty-second of the record,
    // whose entries name no record: each offset reads a quarter of them.
    const L = 256 * 1024;
    const n = L / 32;
    const body: number[] = [];
    while (body.length < L) body.push(n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, 0);
    const seg = segment([{ guid: OPERATION_TABLE, id: 1, body }]);
    const t = performance.now();
    const design = readSegment(seg);
    expect(performance.now() - t).toBeLessThan(1000);
    expect(design.problems).toEqual([
      'operation table #1: the operation table takes too long to find',
    ]);
  });

  it('reads a timeline item once however often the file repeats it', () => {
    const body = new Bytes().u8(0).u8(0).ref(2).u32(100_000);
    for (let i = 0; i < 100_000; i++) body.ref(3);
    const seg = segment([
      { guid: TIMELINE, id: 1, body: body.out },
      { guid: OTHER, id: 2, body: [0] },
      { guid: OTHER, id: 3, body: [0, 0] },
    ]);
    const t = performance.now();
    const design = readSegment(seg);
    expect(performance.now() - t).toBeLessThan(1000);
    expect(design.features.map((f) => f.id)).toEqual([3]);
  });

  it('lists a record once in the type table however often the file repeats it', () => {
    const meta = new Bytes().str8('Design1').u32(1).u32(0).u32(0).u32(0).str8('').str8('');
    meta.u32(0).u32(0).u32(2);
    meta.str8(OTHER).str8('').u32(0).str8('M').u32(10_000);
    for (let i = 0; i < 10_000; i++) meta.u64(7);
    meta.str8(TIMELINE).str8('').u32(0).str8('M').u32(1).u64(7);
    meta.u32(0).u32(1).u64(7).u64(0).u32(0);
    const bulk = new Bytes().str8('256').u64(7).str8('').u8(0);
    const seg = new Segment(new Uint8Array(meta.out), new Uint8Array(bulk.out));
    expect(seg.idsOf(OTHER)).toEqual([7]);
    expect(seg.idsOf(TIMELINE)).toEqual([]);
    expect(seg.typeOf(7)?.guid).toBe(OTHER);
  });
});
