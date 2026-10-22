/**
 * Combine and Move on hand-built records: a combine's target and tools from
 * its lists, its operation only where the bytes read as the joins seen; a
 * move's bodies and matrix.
 */
import { describe, expect, it } from 'vitest';
import { F3dFormatError, Reader } from '../bytes';
import type { Segment } from '../segment';
import { BODY } from './body';
import { MOVE_TRANSFORM, readCombine, readMove } from './combine';
import { OPERAND_GROUP } from './edges';
import { BODY_LINK, BODY_OPERAND } from './pattern';
import type { Scope } from './scope';
import { Bytes } from './test-segment';

const STATE = '2E3AC990-483D-4A55-8662-C064B976A957';

interface Rec {
  guid: string;
  bytes?: number[];
  refs?: number[];
}

/** A segment over records by id; `inside` from their listed references. */
function fixture(records: Record<number, Rec>) {
  const frames = new Map<number, { start: number; end: number }>();
  const all: number[] = [];
  for (const [id, rec] of Object.entries(records)) {
    frames.set(Number(id), { start: all.length, end: all.length + (rec.bytes?.length ?? 0) });
    all.push(...(rec.bytes ?? []));
  }
  const bulk = new Uint8Array(all);
  const seg = {
    bulk,
    frame: (id: number) => frames.get(id),
    typeOf: (id: number) => (records[id] ? { guid: records[id].guid } : undefined),
    reader: (id: number) => {
      const f = frames.get(id) ?? { start: 0, end: 0 };
      return new Reader(bulk, f.start, f.end);
    },
    has: (id: number) => id in records,
  } as unknown as Segment;
  const inside = (id: number) => records[id]?.refs ?? [];
  const scope = (id: number, refs: number[]) => {
    const f = frames.get(id) ?? { start: 0, end: 0 };
    return { id, refs, start: f.start, tableAt: f.end } as unknown as Scope;
  };
  return { seg, inside, scope };
}

/** Two bodies, each named by an operand group: 1 → body 50 (target), 2 and 3 → 60 and 70 (tools). */
const BODIES: Record<number, Rec> = {
  1: { guid: OPERAND_GROUP, refs: [11] },
  11: { guid: BODY_OPERAND, refs: [21] },
  21: { guid: BODY_LINK, refs: [50] },
  50: { guid: BODY },
  2: { guid: OPERAND_GROUP, refs: [12] },
  12: { guid: BODY_OPERAND, refs: [22] },
  22: { guid: BODY_LINK, refs: [60] },
  60: { guid: BODY },
  3: { guid: OPERAND_GROUP, refs: [13] },
  13: { guid: BODY_OPERAND, refs: [23] },
  23: { guid: BODY_LINK, refs: [70] },
  70: { guid: BODY },
  9: { guid: STATE },
};

/** A combine's own members: state, operation id, tool groups, 8 bytes, tool links, target group, GUID. */
function combineBytes(opts: { tools?: number[]; links?: number[]; gap?: number[] } = {}): number[] {
  const tools = opts.tools ?? [2, 3];
  const links = opts.links ?? [22, 23];
  const b = new Bytes().u8(0).u8(1).raw(new Array(14).fill(0));
  b.u32(1).ref(9).u64(376);
  b.u32(tools.length);
  for (const t of tools) b.ref(t);
  b.raw(opts.gap ?? new Array(8).fill(0));
  b.u32(links.length);
  for (const l of links) b.ref(l);
  b.u32(1).ref(1);
  return b.str8('0').out;
}

describe('readCombine', () => {
  it('reads the target, the tools and a join', () => {
    const { seg, inside, scope } = fixture({
      ...BODIES,
      100: { guid: 'C', bytes: combineBytes() },
    });
    expect(readCombine(seg, scope(100, [2, 3, 1]), inside)).toEqual({
      target: 50,
      tools: [60, 70],
      operation: 'join',
    });
  });

  it('reads no operation where the bytes a join keeps zero are not', () => {
    const { seg, inside, scope } = fixture({
      ...BODIES,
      100: { guid: 'C', bytes: combineBytes({ gap: [1, 0, 0, 0, 0, 0, 0, 0] }) },
    });
    expect(readCombine(seg, scope(100, []), inside)).toEqual({ target: 50, tools: [60, 70] });
  });

  it('refuses tool lists that disagree, and a combine with no tool links', () => {
    const disagree = fixture({
      ...BODIES,
      100: { guid: 'C', bytes: combineBytes({ links: [21] }) },
    });
    expect(() => readCombine(disagree.seg, disagree.scope(100, []), disagree.inside)).toThrow(
      F3dFormatError,
    );
    const none = fixture({ ...BODIES, 100: { guid: 'C', bytes: combineBytes({ links: [] }) } });
    expect(() => readCombine(none.seg, none.scope(100, []), none.inside)).toThrow(/no tool bodies/);
  });
});

describe('readMove', () => {
  const transform = (matrix: number[]) => {
    const b = new Bytes().raw(new Array(24).fill(0)).u32(5).u8(0);
    const view = new DataView(new ArrayBuffer(8));
    for (const v of matrix) {
      view.setFloat64(0, v, true);
      b.raw([...new Uint8Array(view.buffer)]);
    }
    return b.out;
  };

  it('reads the bodies it moves and its matrix', () => {
    const m = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0.05, 0, 0, 0, 1];
    const { seg, inside, scope } = fixture({
      ...BODIES,
      40: { guid: MOVE_TRANSFORM, bytes: transform(m) },
    });
    expect(readMove(seg, scope(100, [40, 2, 3]), inside)).toEqual({ bodies: [60, 70], matrix: m });
  });

  it('refuses a matrix with a number that is not finite, and a move with no transform', () => {
    const m = [1, 0, 0, Number.NaN, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    const { seg, inside, scope } = fixture({
      ...BODIES,
      40: { guid: MOVE_TRANSFORM, bytes: transform(m) },
    });
    expect(() => readMove(seg, scope(100, [40, 2]), inside)).toThrow(F3dFormatError);
    expect(() => readMove(seg, scope(100, [2]), inside)).toThrow(/no transform/);
  });
});
