/**
 * Mirror and pattern operands on hand-built records: what a mirror or
 * pattern copies (features, bodies or faces), a mirror's plane, a pattern's
 * directions turned the way their group points, and its counts.
 */
import { describe, expect, it } from 'vitest';
import { Reader } from '../bytes';
import type { Segment } from '../segment';
import { BODY } from './body';
import { readCopied, readDirections, readMirrorPlane } from './copies';
import { EDGE_OPERAND, OPERAND_GROUP } from './edges';
import { HOLE_PLACEMENT, MODEL_PLANE } from './hole';
import { BODY_LINK, BODY_OPERAND, RECORD_REF } from './pattern';
import { GEOMETRY_OPERAND, MODEL_LINE } from './revolve';
import type { Scope } from './scope';

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
  const seg = {
    typeOf: (id: number) => (records[id] ? { guid: records[id].guid } : undefined),
    reader: (id: number) => new Reader(new Uint8Array(records[id]?.bytes ?? [])),
    has: (id: number) => id in records,
  } as unknown as Segment;
  const inside = (id: number) => records[id]?.refs ?? [];
  const scope = (refs: number[]) => ({ refs }) as unknown as Scope;
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
});
