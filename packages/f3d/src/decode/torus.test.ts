import { describe, expect, it } from 'vitest';
import type { Scope } from './scope';
import { Bytes, segment } from './test-segment';
import { readTorusHead, TORUS, torusPlacement } from './torus';

const f64s = (...v: number[]) => [...new Uint8Array(new Float64Array(v).buffer)];
/** Row-major, cm: no turn, moved along the plane's y. */
const MOVED = [1, 0, 0, 0, 0, 1, 0, 7.5, 0, 0, 1, 0, 0, 0, 0, 1];

/** A torus record: prologue, operation, a byte, four references, a byte, the matrix. */
function torus(operation: number, matrix: number[]) {
  const b = new Bytes().u8(0).u8(0).u32(operation).u8(1);
  for (const id of [2, 3, 4, 5]) b.ref(id);
  b.u8(0).raw(f64s(...matrix));
  const others = [2, 3, 4, 5].map((id) => ({
    guid: 'D91D429C-1BB5-4640-B49F-69AF14F463E9',
    id,
    body: [0, 0],
  }));
  const seg = segment([{ guid: TORUS, id: 1, body: b.out }, ...others]);
  return { seg, scope: { id: 1 } as Scope };
}

describe('readTorusHead', () => {
  it('reads the operation and the matrix in the plane’s frame', () => {
    const { seg, scope } = torus(1, MOVED);
    expect(readTorusHead(seg, scope)).toEqual({ operation: 'join', matrix: MOVED });
    const cut = torus(2, MOVED);
    expect(readTorusHead(cut.seg, cut.scope).operation).toBe('cut');
  });

  it('refuses an unknown operation and a matrix whose last row is not 0 0 0 1', () => {
    const a = torus(9, MOVED);
    expect(() => readTorusHead(a.seg, a.scope)).toThrow(/operation/);
    const b = torus(4, [...MOVED.slice(0, 15), 2]);
    expect(() => readTorusHead(b.seg, b.scope)).toThrow(/matrix/);
    const c = torus(4, [...MOVED.slice(0, 3), Number.NaN, ...MOVED.slice(4)]);
    expect(() => readTorusHead(c.seg, c.scope)).toThrow(/matrix/);
  });
});

describe('torusPlacement', () => {
  // The YZ plane: x × y is +X.
  const yz = {
    origin: [0, 0, 0] as [number, number, number],
    x: [0, 1, 0] as [number, number, number],
    y: [0, 0, 1] as [number, number, number],
  };

  it('takes the centre and axis from the plane’s frame into the model', () => {
    expect(torusPlacement(yz, MOVED)).toEqual({ centre: [0, 0, 7.5], axis: [1, 0, 0] });
    // Turned a quarter about the frame's x: the axis goes to −y of the frame.
    const turned = [1, 0, 0, 1, 0, 0, -1, 0, 0, 1, 0, 2, 0, 0, 0, 1];
    const moved = { ...yz, origin: [1, 1, 1] as [number, number, number] };
    expect(torusPlacement(moved, turned)).toEqual({ centre: [3, 2, 1], axis: [0, 0, -1] });
  });

  it('gives nothing for a degenerate plane or axis', () => {
    expect(torusPlacement({ ...yz, y: [0, 1, 0] }, MOVED)).toBeUndefined();
    expect(torusPlacement(yz, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1])).toBeUndefined();
  });
});
