/**
 * A hand-built design segment for the decoder tests: a type table, the record
 * indexes and records with the members a test gives (no real file's bytes).
 */
import { Segment } from '../segment';

const enc = new TextEncoder();

export class Bytes {
  readonly out: number[] = [];
  u8(v: number) {
    this.out.push(v & 0xff);
    return this;
  }
  u32(v: number) {
    for (let i = 0; i < 4; i++) this.out.push((v >>> (8 * i)) & 0xff);
    return this;
  }
  u64(v: number) {
    return this.u32(v).u32(0);
  }
  str8(s: string) {
    const b = [...enc.encode(s)];
    this.u32(b.length);
    this.out.push(...b);
    return this;
  }
  /** A local reference: marker, id, no type GUID, not cross-document, no segment. */
  ref(id: number) {
    return this.u8(1).u64(id).u8(0).u8(0);
  }
  raw(bytes: number[]) {
    for (const b of bytes) this.out.push(b);
    return this;
  }
}

export const POINT = 'C2CEDAE7-1716-47C1-B7B1-07B70081D0FB';
export const LINE = 'DCA267ED-D615-4934-B64F-AD805E8003E2';
export const SKETCH = '44A64366-4BD3-4B24-881A-F94C206E8F2D';

/** A segment of the given records (type GUID, base GUID, id, members). */
export function segment(
  records: { guid: string; base?: string; version?: number; id: number; body: number[] }[],
): Segment {
  const types = [...new Set(records.map((r) => r.guid))];
  const bulk = new Bytes();
  const offsets: [number, number][] = [];
  for (const r of records) {
    offsets.push([r.id, bulk.out.length]);
    bulk
      .str8(String(256 + types.indexOf(r.guid)))
      .u64(r.id)
      .str8('')
      .raw(r.body);
  }
  const meta = new Bytes()
    .str8('Design1')
    .u32(1)
    .u32(0) // asset GUID (empty)
    .u32(0)
    .u32(0) // serializer magic, reserved
    .str8('')
    .str8('')
    .u32(0)
    .u32(0)
    .u32(types.length);
  for (const guid of types) {
    const of = records.filter((r) => r.guid === guid);
    meta
      .str8(guid)
      .str8(of[0]?.base ?? '')
      .u32(of[0]?.version ?? 0)
      .str8('MSketch')
      .u32(of.length);
    for (const r of of) meta.u64(r.id);
  }
  meta.u32(0).u32(offsets.length);
  for (const [id, at] of offsets) meta.u64(id).u64(at);
  meta.u32(0);
  return new Segment(new Uint8Array(meta.out), new Uint8Array(bulk.out));
}
