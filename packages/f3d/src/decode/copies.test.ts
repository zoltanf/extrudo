/**
 * Mirror and pattern operands on hand-built records: what a mirror or
 * pattern copies (features, bodies or faces), a mirror's plane, a pattern's
 * directions turned the way their group points; a sweep's operation and path.
 */
import { describe, expect, it } from 'vitest';
import { Reader } from '../bytes';
import type { Segment } from '../segment';
import { BODY } from './body';
import {
  cantorPair,
  PATH_PATTERN_DATA,
  PATH_START,
  readCopied,
  readDirections,
  readInstances,
  readMirrorPlane,
  readPathPattern,
} from './copies';
import { EDGE_OPERAND, OPERAND_GROUP } from './edges';
import { SKETCH_PROFILE_OPERAND } from './extrude';
import { HOLE_PLACEMENT, MODEL_PLANE } from './hole';
import { BODY_LINK, BODY_OPERAND, RECORD_REF } from './pattern';
import { GEOMETRY_OPERAND, MODEL_LINE, SKETCH_CURVE_REF } from './revolve';
import type { Scope } from './scope';
import { readPaths, readSweepOperation } from './sweep';

const u32 = (v: number) => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
const u64 = (v: number) => [...u32(v), 0, 0, 0, 0];
const f64s = (...vs: number[]) =>
  vs.flatMap((v) => [...new Uint8Array(new Float64Array([v]).buffer)]);

interface Rec {
  guid: string;
  bytes?: number[];
  refs?: number[];
}

/** A segment over records by id, and `inside` from their listed references. */
function fixture(records: Record<number, Rec>) {
  // Every record's bytes one after another, for readers of whole frames.
  const frames = new Map<number, { start: number; end: number }>();
  const all: number[] = [];
  for (const [id, rec] of Object.entries(records)) {
    frames.set(Number(id), { start: all.length, end: all.length + (rec.bytes?.length ?? 0) });
    all.push(...(rec.bytes ?? []));
  }
  const seg = {
    bulk: new Uint8Array(all),
    frame: (id: number) => frames.get(id),
    typeOf: (id: number) => (records[id] ? { guid: records[id].guid } : undefined),
    reader: (id: number) => new Reader(new Uint8Array(records[id]?.bytes ?? [])),
    has: (id: number) => id in records,
  } as unknown as Segment;
  const inside = (id: number) => records[id]?.refs ?? [];
  const scope = (refs: number[], id = 0) => ({ id, refs }) as unknown as Scope;
  return { seg, inside, scope };
}

describe('copying features', () => {
  it('reads the features a mirror copies, and its plane', () => {
    const { seg, inside, scope } = fixture({
      1: { guid: OPERAND_GROUP, refs: [2, 3] },
      2: { guid: GEOMETRY_OPERAND, refs: [20, 30] },
      3: { guid: GEOMETRY_OPERAND, refs: [21, 30] },
      20: { guid: RECORD_REF, bytes: [0, 0, ...u64(500)] },
      21: { guid: RECORD_REF, bytes: [0, 0, ...u64(501)] },
      30: { guid: BODY_LINK },
      4: { guid: GEOMETRY_OPERAND, refs: [22, 40] },
      22: { guid: RECORD_REF, bytes: [0, 0, ...u64(44)] },
      40: { guid: MODEL_PLANE, bytes: [0, 0, 0, ...f64s(1, 2, 3, 0, 0, 1, 1, 0, 0)] },
    });
    const s = scope([1, 2, 3, 4]);
    expect(readCopied(seg, s, inside)).toEqual({
      objects: 'features',
      features: [500, 501],
      bodies: [],
    });
    expect(readMirrorPlane(seg, s, inside)).toEqual({
      origin: [1, 2, 3],
      x: [0, 0, 1],
      y: [1, 0, 0],
    });
  });

  it('reads the bodies a mirror copies, and that faces are not read', () => {
    const bodies = fixture({
      1: { guid: OPERAND_GROUP, refs: [2] },
      2: { guid: BODY_OPERAND, refs: [3] },
      3: { guid: BODY_LINK, refs: [9, 600] },
      9: { guid: BODY },
    });
    expect(readCopied(bodies.seg, bodies.scope([1]), bodies.inside)).toEqual({
      objects: 'bodies',
      features: [],
      bodies: [9],
    });
    const faces = fixture({
      1: { guid: OPERAND_GROUP, refs: [2] },
      2: { guid: EDGE_OPERAND },
    });
    expect(readCopied(faces.seg, faces.scope([1]), faces.inside).objects).toBe('faces');
  });

  it("turns a pattern direction the way its group's vector points", () => {
    const group = (v: number[]) => [0, 0, ...u32(16), ...f64s(0, 0, 0.175, ...v)];
    const { seg, inside, scope } = fixture({
      1: { guid: HOLE_PLACEMENT, bytes: group([0, 0, -1]), refs: [2] },
      2: { guid: GEOMETRY_OPERAND, refs: [3] },
      3: { guid: MODEL_LINE, bytes: [0, 0, ...f64s(0, 0, 0.175, 0, 0, 2.075)] },
      4: { guid: HOLE_PLACEMENT, bytes: group([2, 0, 0]), refs: [5] },
      5: { guid: GEOMETRY_OPERAND, refs: [6] },
      6: { guid: MODEL_LINE, bytes: [0, 0, ...f64s(0, 0, 0, 1, 0, 0)] },
    });
    expect(readDirections(seg, scope([1, 4]), inside).map((a) => a.direction)).toEqual([
      [-0, -0, -2.075],
      [1, 0, 0],
    ]);
  });

  it("reads a sweep's operation and its path of sketch curves, apart from its profile", () => {
    const { seg, inside, scope } = fixture({
      1: { guid: OPERAND_GROUP, refs: [2] },
      2: { guid: SKETCH_PROFILE_OPERAND },
      3: { guid: OPERAND_GROUP, refs: [4, 5] },
      4: { guid: GEOMETRY_OPERAND, refs: [6] },
      5: { guid: GEOMETRY_OPERAND, refs: [7] },
      6: { guid: SKETCH_CURVE_REF, bytes: [0, 0, ...u64(0), ...u64(1038), ...u64(229)] },
      7: { guid: SKETCH_CURVE_REF, bytes: [0, 0, ...u64(0), ...u64(1038), ...u64(231)] },
    });
    expect(readPaths(seg, scope([1, 3]), inside)).toEqual({
      paths: [
        [
          { sketch: 1038, tag: 229n },
          { sketch: 1038, tag: 231n },
        ],
      ],
      edges: false,
    });
    const head = [0, 1, ...u32(0), ...u32(4), 1, 0, 0, 1, 1, 1];
    const bulk = new Uint8Array(head);
    const record = { bulk } as unknown as Segment;
    expect(readSweepOperation(record, { id: 1, start: 0, end: bulk.length } as Scope)).toBe(
      'new-body',
    );
  });

  it("reads a pattern's instances: operation id → code, from its data record", () => {
    const ref = (id: number) => [1, ...u64(id), 0, 0];
    const { seg, inside, scope } = fixture({
      1: { guid: 'pattern', refs: [10] },
      10: {
        guid: 'data',
        bytes: [
          0,
          0,
          ...ref(20),
          1,
          ...u32(2),
          ...u64(2),
          ...u64(312),
          ...u64(3),
          ...u64(313),
          ...u32(1),
          ...ref(20),
        ],
      },
      20: { guid: 'instance' },
    });
    expect([...readInstances(seg, scope([], 1), inside)]).toEqual([
      [312, 2],
      [313, 3],
    ]);
  });

  it('passes over a 1 byte whose list is not one, at its first bad pair', () => {
    const ref = (id: number) => [1, ...u64(id), 0, 0];
    const { seg, inside, scope } = fixture({
      1: { guid: 'pattern', refs: [10] },
      10: {
        guid: 'data',
        bytes: [
          // A stray 1 announcing two pairs, the first with code 0.
          1,
          ...u32(2),
          ...u64(0),
          ...u64(0),
          1,
          ...u32(1),
          ...u64(2),
          ...u64(312),
          ...u32(1),
          ...ref(20),
        ],
      },
      20: { guid: 'instance' },
    });
    expect([...readInstances(seg, scope([], 1), inside)]).toEqual([[312, 2]]);
  });

  it('reads no flags from a path pattern data record too short to hold them', () => {
    const { seg, inside, scope } = fixture({
      1: { guid: 'pattern', refs: [10] },
      10: { guid: PATH_PATTERN_DATA, bytes: [1, ...u32(2), 0, 0] },
    });
    expect(readPathPattern(seg, scope([], 1), inside)).toEqual({
      path: [],
      extent: true,
      aligned: false,
      flag: 0,
    });
  });

  it("unpairs a rectangular pattern's instance codes", () => {
    // A row: (u, 0) codes u(u + 1) / 2 — 1 the original, 3 the second, 36 the eighth.
    expect([1, 3, 6, 36].map(cantorPair)).toEqual([
      [1, 0],
      [2, 0],
      [3, 0],
      [8, 0],
    ]);
  });

  it("reads a path pattern's path, start point and flags", () => {
    const ref = (id: number) => [1, ...u64(id), 0, 0];
    const data = [1, ...u32(2), ...ref(30), 0, 0, 0, 0, ...ref(31), 0, 0, 0, 0, 0];
    data.push(...f64s(2, 0.3, 0.96), 1, 0, 1, 0);
    const { seg, inside, scope } = fixture({
      1: { guid: 'pattern', refs: [10] },
      10: { guid: PATH_PATTERN_DATA, bytes: data },
      2: { guid: OPERAND_GROUP, refs: [3] },
      3: { guid: GEOMETRY_OPERAND, refs: [4] },
      4: { guid: SKETCH_CURVE_REF, bytes: [0, 0, ...u64(0), ...u64(1037), ...u64(238)] },
      5: { guid: PATH_START, bytes: [...new Array(19).fill(0), ...f64s(2, 0, 0)] },
    });
    expect(readPathPattern(seg, scope([2, 5], 1), inside)).toEqual({
      path: [{ sketch: 1037, tag: 238n }],
      start: [2, 0, 0],
      extent: true,
      aligned: true,
      flag: 0,
    });
  });
});
