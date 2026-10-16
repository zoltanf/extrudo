/**
 * Numbers that aren't finite in a record refuse that record, so NaN and
 * infinities never reach the mapping or the kernel (hand-built records).
 */
import { describe, expect, it } from 'vitest';
import { MODEL_PLANE, MODEL_POINT, readModelPlane, readModelPoint } from './hole';
import { PARAMETER_VALUE, parameterValue } from './parameters';
import { MODEL_LINE, readAxis } from './revolve';
import { Bytes, segment } from './test-segment';

const f64s = (b: Bytes, ...values: number[]) => {
  const view = new DataView(new ArrayBuffer(8));
  for (const v of values) {
    view.setFloat64(0, v, true);
    for (let i = 0; i < 8; i++) b.u8(view.getUint8(i));
  }
  return b;
};

describe('finite numbers at decode', () => {
  it('refuses a model plane or point that is not finite', () => {
    const plane = (x: number) =>
      segment([
        {
          guid: MODEL_PLANE,
          id: 1,
          body: f64s(new Bytes().u8(0).u8(0).u8(0), 0, 0, x, 1, 0, 0, 0, 1, 0).out,
        },
      ]);
    expect(readModelPlane(plane(1), 1).origin).toEqual([0, 0, 1]);
    expect(() => readModelPlane(plane(Number.NaN), 1)).toThrow(/Model plane #1/);
    const point = (x: number) =>
      segment([{ guid: MODEL_POINT, id: 2, body: f64s(new Bytes().u8(0).u8(0), x, 0, 0).out }]);
    expect(readModelPoint(point(3), 2)).toEqual([3, 0, 0]);
    expect(() => readModelPoint(point(Number.POSITIVE_INFINITY), 2)).toThrow(/Model point #2/);
  });

  it('takes no axis from a line that is not finite', () => {
    const line = (d: number) =>
      segment([
        { guid: MODEL_LINE, id: 3, body: f64s(new Bytes().u8(0).u8(0), 0, 0, 0, 0, 0, d).out },
      ]);
    expect(readAxis(line(1), [3])?.direction).toEqual([0, 0, 1]);
    // An infinite direction passed the length test.
    expect(readAxis(line(Number.POSITIVE_INFINITY), [3])).toBeUndefined();
    expect(readAxis(line(Number.NaN), [3])).toBeUndefined();
  });

  it('refuses a parameter whose value is not finite', () => {
    const wstr = (b: Bytes, s: string) => {
      b.u32(s.length);
      for (const c of s) b.u8(c.charCodeAt(0)).u8(0);
      return b;
    };
    const record = (value: number) => {
      const b = new Bytes().u8(0).u8(0).u8(0).u32(4);
      wstr(b, '').u8(0).u32(1).u8(0);
      wstr(b, '10 mm').u32(0).raw([0, 0, 0, 0, 0]);
      wstr(b, 'Length');
      wstr(b, '');
      wstr(b, 'mm');
      wstr(b, 'd1');
      f64s(b, value).u8(0).u8(0);
      return segment([{ guid: PARAMETER_VALUE, version: 7, id: 4, body: b.out }]);
    };
    expect(parameterValue.decode(record(1), 4)).toMatchObject({ name: 'd1', value: 1 });
    expect(() => parameterValue.decode(record(Number.NaN), 4)).toThrow(/Parameter #4/);
    expect(() => parameterValue.decode(record(-Infinity), 4)).toThrow(/Parameter #4/);
  });
});
