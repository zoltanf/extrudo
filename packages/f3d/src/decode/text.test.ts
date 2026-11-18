/** The newer sketch text reader on hand-built records (no real file's bytes). */
import { describe, expect, it } from 'vitest';
import { Bytes, SKETCH, segment } from './test-segment';
import { MAX_TEXT_HEIGHT, SKETCH_TEXT, sketchText } from './text';

const f64s = (b: Bytes, ...values: number[]) =>
  b.raw([...new Uint8Array(new Float64Array(values).buffer)]);
const wstr = (b: Bytes, s: string) => {
  b.u32(s.length);
  for (const c of s) b.u8(c.charCodeAt(0)).u8(0);
  return b;
};

/** A text with no box lines: the members in order, the text and the owner. */
function record(styleByte: number, { height = 0.5, angle = 0, at = [1, 2] } = {}) {
  const b = new Bytes().u8(1).u32(0).u8(0);
  f64s(b, angle).u8(styleByte).raw([0, 0, 0, 0]).raw(Array(12).fill(0)).raw([0, 0, 0x80, 0x3f]);
  wstr(b, 'Sans');
  f64s(b, height).raw([0, 0]);
  f64s(b, ...at).raw(Array(8).fill(0));
  wstr(b, 'AB').u32(0).ref(50);
  return segment([
    { guid: SKETCH, id: 50, body: [0] },
    { guid: SKETCH_TEXT, version: 3, id: 10, body: b.out },
  ]);
}

describe('sketch text', () => {
  it('reads the family, the size, the corner, the text and the bold byte', () => {
    expect(sketchText.decode(record(1), 10)).toEqual({
      id: 10,
      text: 'AB',
      font: 'Sans',
      height: 0.5,
      angle: 0,
      at: [1, 2],
      width: 0,
      bold: true,
      owner: 50,
    });
    expect(sketchText.decode(record(0), 10)).not.toHaveProperty('bold');
  });

  it('refuses a text whose numbers are not finite or whose height is out of bounds', () => {
    for (const bad of [
      { height: Number.NaN },
      { height: Number.POSITIVE_INFINITY },
      { height: 0 },
      { height: -1 },
      { height: 1e300 },
      { angle: Number.NaN },
      { at: [Number.NEGATIVE_INFINITY, 0] },
    ])
      expect(() => sketchText.decode(record(0, bad), 10)).toThrow(/Sketch text #10/);
    expect(sketchText.decode(record(0, { height: MAX_TEXT_HEIGHT }), 10).height).toBe(
      MAX_TEXT_HEIGHT,
    );
  });
});
