/** The newer sketch text reader on hand-built records (no real file's bytes). */
import { describe, expect, it } from 'vitest';
import { Bytes, SKETCH, segment } from './test-segment';
import { SKETCH_TEXT, sketchText } from './text';

const f64s = (b: Bytes, ...values: number[]) =>
  b.raw([...new Uint8Array(new Float64Array(values).buffer)]);
const wstr = (b: Bytes, s: string) => {
  b.u32(s.length);
  for (const c of s) b.u8(c.charCodeAt(0)).u8(0);
  return b;
};

/** A text with no box lines: the members in order, the text and the owner. */
function record(styleByte: number) {
  const b = new Bytes().u8(1).u32(0).u8(0);
  f64s(b, 0).u8(styleByte).raw([0, 0, 0, 0]).raw(Array(12).fill(0)).raw([0, 0, 0x80, 0x3f]);
  wstr(b, 'Sans');
  f64s(b, 0.5).raw([0, 0]);
  f64s(b, 1, 2).raw(Array(8).fill(0));
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
});
