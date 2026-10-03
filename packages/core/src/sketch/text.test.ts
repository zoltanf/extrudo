import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SketchEntityId } from '../ids';
import type { Vec2 } from './planes';
import type { SketchData } from './schema';
import { type PlacedText, placeText, registerTextShaper, textPolylines } from './text';
import type { TextAlign, TextShaper, UnitContour, UnitLayout } from './text-layout';

const id = 't1' as SketchEntityId;

/** A unit square contour and one quadratic Bézier, as a fake font's layout. */
const square: UnitContour = {
  segments: [
    { kind: 'line', a: [0, 0], b: [1, 0] },
    { kind: 'line', a: [1, 0], b: [1, 1] },
    { kind: 'line', a: [1, 1], b: [0, 1] },
    { kind: 'line', a: [0, 1], b: [0, 0] },
  ],
};
const quad: UnitContour = {
  segments: [
    {
      kind: 'bezier',
      points: [
        [2, 0],
        [2.5, 1],
        [3, 0],
      ],
    },
  ],
};

interface Call {
  font: string;
  text: string;
  align: TextAlign;
}

function fakeShaper(calls: Call[], missing: string[] = []): TextShaper {
  return (font, text, align) => {
    calls.push({ font, text, align });
    if (font === 'gone@1') return undefined;
    if (text.trim() === '') return { contours: [], missing: [] };
    return { contours: [square, quad], missing } satisfies UnitLayout;
  };
}

function sketch(
  anchor: [number, number],
  top: [number, number],
  text = 'Hi',
  overrides: Record<string, unknown> = {},
): SketchData {
  return {
    entities: {
      a: { type: 'point', x: anchor[0], y: anchor[1] },
      t: { type: 'point', x: top[0], y: top[1] },
      t1: {
        type: 'text',
        anchor: 'a',
        top: 't',
        text,
        font: 'fake@1',
        align: 'center',
        construction: false,
        ...overrides,
      },
    },
    constraints: {},
    dimensions: {},
  } as unknown as SketchData;
}

let calls: Call[] = [];

beforeEach(() => {
  calls = [];
  registerTextShaper(fakeShaper(calls));
});

afterEach(() => {
  registerTextShaper(undefined);
});

describe('placeText', () => {
  it('places an upright text: the anchor on the baseline, the height from the points', () => {
    const placed = placeText(sketch([0, 0], [0, 10]), id);
    expect(placed.status).toBe('ok');
    expect(placed.missing).toEqual([]);
    // The square: unit (x, y) → anchor + 10·(x·b + y·u) with u = (0, 1), b = (1, 0).
    expect(placed.curves[0]).toEqual({ id: `${id}.0`, kind: 'line', a: [0, 0], b: [10, 0] });
    expect(placed.curves[1]).toEqual({ id: `${id}.1`, kind: 'line', a: [10, 0], b: [10, 10] });
    expect(placed.curves[2]).toEqual({ id: `${id}.2`, kind: 'line', a: [10, 10], b: [0, 10] });
    expect(placed.curves[3]).toEqual({ id: `${id}.3`, kind: 'line', a: [0, 10], b: [0, 0] });
  });

  it('places the Bézier as a spline with clamped knots', () => {
    const placed = placeText(sketch([0, 0], [0, 10]), id);
    const spline = placed.curves[4];
    expect(spline).toEqual({
      id: `${id}.4`,
      kind: 'spline',
      degree: 2,
      poles: [
        [20, 0],
        [25, 10],
        [30, 0],
      ],
      knots: [0, 0, 0, 1, 1, 1],
    });
  });

  it('rotates with the points: up is anchor → top, the baseline 90° clockwise from it', () => {
    const placed = placeText(sketch([0, 0], [10, 0]), id);
    // up = +x, so b = (0, −1): unit (x, y) → (10y, −10x).
    expect(placed.curves[0]).toEqual({ id: `${id}.0`, kind: 'line', a: [0, 0], b: [0, -10] });
    expect(placed.curves[2]).toEqual({ id: `${id}.2`, kind: 'line', a: [10, -10], b: [10, 0] });
  });

  it('scales with the point distance', () => {
    const placed = placeText(sketch([100, 100], [100, 105]), id);
    expect(placed.curves[0]).toEqual({ id: `${id}.0`, kind: 'line', a: [100, 100], b: [105, 100] });
  });

  it('passes the font, string and alignment to the shaper', () => {
    placeText(sketch([0, 0], [0, 10], 'Extrudo'), id);
    expect(calls).toEqual([{ font: 'fake@1', text: 'Extrudo', align: 'center' }]);
  });

  it('numbers the curves 0, 1, … over all contours in order', () => {
    const placed = placeText(sketch([0, 0], [0, 10]), id);
    expect(placed.curves.map((c) => c.id)).toEqual([
      `${id}.0`,
      `${id}.1`,
      `${id}.2`,
      `${id}.3`,
      `${id}.4`,
    ]);
    expect(placed.contours).toEqual([[`${id}.0`, `${id}.1`, `${id}.2`, `${id}.3`], [`${id}.4`]]);
  });

  it('reports no-font without a shaper or with an unloaded font', () => {
    registerTextShaper(undefined);
    expect(placeText(sketch([0, 0], [0, 10]), id)).toEqual({
      curves: [],
      contours: [],
      status: 'no-font',
      missing: [],
    });
    const data = sketch([0, 0], [0, 10], 'Hi', { font: 'gone@1' });
    expect(placeText(data, id).status).toBe('no-font');
    expect(placeText(data, id).curves).toEqual([]);
  });

  it('reports empty for coincident points and for a layout without contours', () => {
    expect(placeText(sketch([5, 5], [5, 5]), id)).toEqual({
      curves: [],
      contours: [],
      status: 'empty',
      missing: [],
    });
    expect(placeText(sketch([0, 0], [0, 10], ' '), id)).toEqual({
      curves: [],
      contours: [],
      status: 'empty',
      missing: [],
    });
  });

  it('reports missing glyphs and still returns the curves', () => {
    registerTextShaper(fakeShaper(calls, ['漢']));
    const placed = placeText(sketch([0, 0], [0, 10]), id);
    expect(placed.status).toBe('missing-glyphs');
    expect(placed.missing).toEqual(['漢']);
    expect(placed.curves).toHaveLength(5);
  });

  it('says nothing for a missing or non-text entity', () => {
    expect(placeText(sketch([0, 0], [0, 10]), 'n9' as SketchEntityId).status).toBe('empty');
  });

  it('memoises per sketch data object and resets on re-registration', () => {
    const data = sketch([0, 0], [0, 10]);
    const first = placeText(data, id);
    expect(placeText(data, id)).toBe(first);
    expect(placeText(sketch([0, 0], [0, 10]), id)).not.toBe(first);

    const other: TextShaper = () => ({ contours: [square], missing: [] });
    registerTextShaper(other);
    const second = placeText(data, id);
    expect(second).not.toBe(first);
    expect(second.curves).toHaveLength(4);
    expect(placeText(data, id)).toBe(second);
  });
});

describe('textPolylines', () => {
  it('gives one polyline per curve: lines as two points, splines sampled', () => {
    const data = sketch([0, 0], [0, 10]);
    const lines = textPolylines(data, id);
    expect(lines.size).toBe(5);
    expect(lines.get(`${id}.0`)).toEqual([
      [0, 0],
      [10, 0],
    ]);
    const spline = lines.get(`${id}.4`) as Vec2[] | undefined;
    expect(spline?.[0]).toEqual([20, 0]);
    expect(spline?.at(-1)).toEqual([30, 0]);
    expect(spline?.length).toBeGreaterThan(2);
  });

  it('is empty without curves', () => {
    expect(textPolylines(sketch([5, 5], [5, 5]), id).size).toBe(0);
  });

  it('places a placed text again identically', () => {
    const data = sketch([0, 0], [0, 10]);
    const placed: PlacedText = placeText(data, id);
    expect(placeText(data, id)).toEqual(placed);
  });
});
