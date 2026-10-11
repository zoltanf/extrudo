/** The ellipse and line readers on hand-built records (no real file's bytes). */
import { describe, expect, it } from 'vitest';
import {
  ellipseSweep,
  SKETCH_ELLIPSE,
  SKETCH_LINE_ALT,
  sketchEllipse,
  sketchLine,
} from './sketch-geometry';
import { Bytes, POINT, SKETCH, segment } from './test-segment';

const f64s = (b: Bytes, ...values: number[]) => {
  const view = new DataView(new ArrayBuffer(8));
  for (const v of values) {
    view.setFloat64(0, v, true);
    for (let i = 0; i < 8; i++) b.u8(view.getUint8(i));
  }
  return b;
};

const POINTS = [1, 2, 3].map((id) => ({ guid: POINT, id, body: [0] }));

describe('sketch ellipses', () => {
  it('reads the centre, the axes, the radii, the angles and the points of an arc', () => {
    // No property block; centre, major and minor axes, radii, angles; refs to
    // the centre, end and (after two bytes) start points; flags; the owner.
    const body = f64s(new Bytes().u8(0).u8(0), 1, 2, 0, 0, 1, 0, -1, 0, 0, 3, 2, 0, Math.PI / 2)
      .ref(1)
      .ref(2)
      .raw([0, 0])
      .ref(3)
      .raw([0, 0, 0, 1, 1, 0, 0, 0])
      .ref(50);
    const seg = segment([
      { guid: SKETCH, id: 50, body: [0] },
      ...POINTS,
      { guid: SKETCH_ELLIPSE, version: 2, id: 10, body: body.out },
    ]);
    expect(sketchEllipse.decode(seg, 10)).toEqual({
      id: 10,
      center: [1, 2, 0],
      major: [0, 1, 0],
      minor: [-1, 0, 0],
      majorRadius: 3,
      minorRadius: 2,
      startAngle: 0,
      endAngle: Math.PI / 2,
      centerPoint: 1,
      endPoint: 2,
      startPoint: 3,
      owner: 50,
    });
  });
});

describe('hostile ellipses', () => {
  const record = (numbers: number[]) =>
    segment([
      { guid: SKETCH, id: 50, body: [0] },
      ...POINTS,
      {
        guid: SKETCH_ELLIPSE,
        version: 2,
        id: 10,
        body: f64s(new Bytes().u8(0).u8(0), ...numbers)
          .ref(1)
          .ref(2)
          .raw([0, 0])
          .ref(3)
          .raw([0, 0, 0, 1, 1, 0, 0, 0])
          .ref(50).out,
      },
    ]);
  const ok = [0, 0, 0, 1, 0, 0, 0, 1, 0, 3, 2, 0, 1];

  it('refuses numbers no sketch can hold, so drawing it costs nothing unbounded', () => {
    const bad: [number, number][] = [
      [12, -1e300], // an end angle that would take forever to bring round
      [12, Number.POSITIVE_INFINITY],
      [9, Number.NaN],
      [9, 0], // no radius
      [3, 2], // a major axis that isn't a unit direction
      [6, 1], // a minor axis that isn't square to the major one
    ];
    for (const [at, value] of bad) {
      const numbers = [...ok];
      numbers[at] = value;
      expect(() => sketchEllipse.decode(record(numbers), 10)).toThrow(/not a curve/);
    }
    expect(sketchEllipse.decode(record(ok), 10).majorRadius).toBe(3);
  });

  it('turns an arc by its angles brought into one turn', () => {
    expect(ellipseSweep({ startAngle: 0, endAngle: Math.PI / 2 })).toBeCloseTo(Math.PI / 2, 12);
    expect(ellipseSweep({ startAngle: 3, endAngle: 1 })).toBeCloseTo(2 * Math.PI - 2, 12);
    expect(ellipseSweep({ startAngle: 1, endAngle: 1 })).toBe(2 * Math.PI);
    expect(ellipseSweep({ startAngle: -900, endAngle: 900 })).toBeLessThanOrEqual(2 * Math.PI);
  });
});

describe('sketch line subclass', () => {
  it('reads a line after its incidence reference, as construction', () => {
    const body = f64s(new Bytes().u8(0).u8(0).ref(4), 0, 0, 0, 2, 0, 0, 1, 0, 0)
      .ref(2)
      .ref(1)
      .raw(new Array(49).fill(0))
      .ref(50);
    const seg = segment([
      { guid: SKETCH, id: 50, body: [0] },
      ...POINTS,
      { guid: '362B7EC3-0F09-47C8-A3BE-DC066715CDAE', id: 4, body: [0] },
      { guid: SKETCH_LINE_ALT, id: 11, body: body.out },
    ]);
    expect(sketchLine.decode(seg, 11)).toMatchObject({
      start: [0, 0, 0],
      end: [2, 0, 0],
      startPoint: 1,
      endPoint: 2,
      construction: true,
      owner: 50,
    });
  });
});
