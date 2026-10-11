/**
 * The relation and dimension readers on a hand-built design segment: a type
 * table, the record indexes and records in the layouts `constraints.ts`
 * describes (no real file's bytes).
 */
import { describe, expect, it } from 'vitest';
import { Segment } from '../segment';
import {
  LINEAR_DIMENSION,
  readSketchConstraints,
  readSketchDimension,
  SKETCH_DIMENSION,
  SKETCH_RELATION,
  sketchRelation,
} from './constraints';
import { PARAMETER_OWNER, type ParameterValue } from './parameters';

const enc = new TextEncoder();

class Bytes {
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
    this.out.push(...bytes);
    return this;
  }
}

const POINT = 'C2CEDAE7-1716-47C1-B7B1-07B70081D0FB';
const LINE = 'DCA267ED-D615-4934-B64F-AD805E8003E2';
const SKETCH = '44A64366-4BD3-4B24-881A-F94C206E8F2D';

/** A segment of the given records (type GUID, base GUID, id, members). */
function segment(records: { guid: string; base?: string; id: number; body: number[] }[]): Segment {
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
      .u32(0)
      .str8('MSketch')
      .u32(of.length);
    for (const r of of) meta.u64(r.id);
  }
  meta.u32(0).u32(offsets.length);
  for (const [id, at] of offsets) meta.u64(id).u64(at);
  meta.u32(0);
  return new Segment(new Uint8Array(meta.out), new Uint8Array(bulk.out));
}

/** A relation: loci with roles, no properties, the sketch, the kind mask, the loci again. */
function relationBody(loci: number[], mask: number, sketch = 50): number[] {
  const b = new Bytes().u8(1).u32(loci.length);
  for (const id of loci) b.ref(id).u32(0);
  b.u8(0).ref(sketch).u32(mask).u32(0).u32(loci.length);
  for (const id of loci) b.ref(id);
  return b.u8(0).out;
}

/** A linear dimension: a null locus and two points, presentation bytes, the parameter owner. */
function dimensionBody(a: number, b: number, owner: number, direction: [number, number]): number[] {
  const out = new Bytes().u8(1).u32(3).ref(0).u32(3).ref(a).u32(1).ref(b).u32(0);
  // Presentation: a double, then the direction pair and five zero bytes.
  out.raw([0, 0, 0, 0, 0, 0, 0xf0, 0x3f, 0, ...direction, 0, 0, 0, 0, 0]);
  out.ref(owner).u32(2).ref(a).ref(b).u8(0);
  return out.out;
}

const BASE = [
  { guid: SKETCH, id: 50, body: [0] },
  { guid: POINT, id: 1, body: [0] },
  { guid: POINT, id: 2, body: [0] },
  { guid: LINE, id: 3, body: [0] },
  { guid: PARAMETER_OWNER, id: 60, body: [0] },
];

const parameter: ParameterValue = {
  id: 61,
  number: 4,
  owner: 60,
  name: 'd4',
  expression: '12 mm',
  kind: 'Linear Dimension-2',
  comment: '',
  user: false,
  unit: 'mm',
  value: 1.2,
};

describe('sketch relations', () => {
  it('reads the loci, the sketch and the kind', () => {
    const seg = segment([
      ...BASE,
      { guid: SKETCH_RELATION, id: 10, body: relationBody([3], 0x40) },
    ]);
    expect(sketchRelation.decode(seg, 10)).toEqual({
      id: 10,
      type: SKETCH_RELATION,
      loci: [{ id: 3, role: 0 }],
      sketch: 50,
      mask: 0x40,
      state: 0,
      kind: 'horizontal',
    });
  });

  it('keeps a relation with a mask it does not know, without a kind', () => {
    const seg = segment([
      ...BASE,
      { guid: SKETCH_RELATION, id: 10, body: relationBody([1, 2], 0x2000) },
    ]);
    expect(sketchRelation.decode(seg, 10).kind).toBeUndefined();
  });
});

describe('sketch dimensions', () => {
  const linear = (direction: [number, number]) =>
    segment([
      ...BASE,
      {
        guid: LINEAR_DIMENSION,
        base: SKETCH_DIMENSION,
        id: 20,
        body: dimensionBody(1, 2, 60, direction),
      },
    ]);
  const read = (seg: Segment) =>
    readSketchDimension(seg, 20, (owner) => (owner === 60 ? parameter : undefined));

  it('reads its loci without the null one and the parameter it drives', () => {
    expect(read(linear([0x40, 0]))).toEqual({
      id: 20,
      kind: 'linear',
      loci: [
        { id: 1, role: 1 },
        { id: 2, role: 0 },
      ],
      orientation: 'aligned',
      parameter,
    });
  });

  it('reads the direction of a linear dimension', () => {
    expect(read(linear([0, 0x40]))?.orientation).toBe('horizontal');
    expect(read(linear([0, 0x80]))?.orientation).toBe('vertical');
  });

  it('groups relations and dimensions by the sketch their geometry is in', () => {
    const seg = segment([
      ...BASE,
      { guid: SKETCH_RELATION, id: 10, body: relationBody([3], 0x80) },
      {
        guid: LINEAR_DIMENSION,
        base: SKETCH_DIMENSION,
        id: 20,
        body: dimensionBody(1, 2, 60, [0, 0x40]),
      },
    ]);
    const problems: string[] = [];
    const out = readSketchConstraints(seg, [parameter], (r) => (r < 10 ? 50 : undefined), problems);
    expect(problems).toEqual([]);
    expect(out.get(50)?.relations.map((r) => r.kind)).toEqual(['vertical']);
    expect(out.get(50)?.dimensions.map((d) => d.parameter.name)).toEqual(['d4']);
  });
});
