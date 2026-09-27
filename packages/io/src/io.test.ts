import { describe, expect, it } from 'vitest';
import { type Drawing, drawingBounds, flattenContour, type Layer, type Segment } from './drawing';
import { writeDxf } from './dxf';
import { num } from './format';
import { writeSvg } from './svg';

const PI = Math.PI;
const INK: Layer = { name: 'Sketch', color: '#000000', aci: 7 };

function drawing(segments: Segment[], start: [number, number], closed = false): Drawing {
  return { layers: [INK], shapes: [{ layer: 'Sketch', contours: [{ start, segments, closed }] }] };
}

/** DXF text as [code, value] pairs. */
function pairs(dxf: string): [number, string][] {
  const lines = dxf.trimEnd().split('\n');
  const out: [number, string][] = [];
  for (let i = 0; i < lines.length; i += 2) out.push([Number(lines[i]), lines[i + 1] as string]);
  return out;
}

/** The DXF entities as records of their group codes (last value wins). */
function entities(dxf: string): { type: string; codes: Map<number, string[]> }[] {
  const all = pairs(dxf);
  const start = all.findIndex(
    ([c, v], i) => c === 2 && v === 'ENTITIES' && all[i - 1]?.[1] === 'SECTION',
  );
  const out: { type: string; codes: Map<number, string[]> }[] = [];
  for (const [code, value] of all.slice(start + 1)) {
    if (code === 0) {
      if (value === 'ENDSEC') break;
      out.push({ type: value, codes: new Map() });
    } else {
      const codes = out[out.length - 1]?.codes;
      codes?.set(code, [...(codes.get(code) ?? []), value]);
    }
  }
  return out;
}

describe('num', () => {
  it('writes fixed decimals without trailing zeros or -0', () => {
    expect(num(1)).toBe('1');
    expect(num(1.5)).toBe('1.5');
    expect(num(1 / 3)).toBe('0.3333');
    expect(num(-0.00001)).toBe('0');
    expect(num(-2.25)).toBe('-2.25');
    expect(num(100.00004)).toBe('100');
  });
});

describe('drawingBounds', () => {
  it('includes the extremes of arcs, not only their ends', () => {
    // A half circle over the top, from (10, 0) to (-10, 0).
    const box = drawingBounds(
      drawing([{ type: 'arc', center: [0, 0], sweep: PI, to: [-10, 0] }], [10, 0]),
    );
    expect(box?.maxY).toBeCloseTo(10, 9);
    expect(box?.minY).toBeCloseTo(0, 9);
  });

  it('bounds a rotated ellipse tightly', () => {
    const e = { center: [0, 0] as const, rx: 10, ry: 5, rotation: PI / 4 };
    const start: [number, number] = [10 * Math.SQRT1_2, 10 * Math.SQRT1_2];
    const box = drawingBounds(
      drawing([{ type: 'ellipse', ...e, sweep: 2 * PI, to: start }], start, true),
    );
    // Half-width of a rotated ellipse: sqrt(a² cos² + b² sin²).
    const half = Math.sqrt(100 * 0.5 + 25 * 0.5);
    expect(box?.maxX).toBeCloseTo(half, 6);
    expect(box?.minY).toBeCloseTo(-half, 6);
  });

  it('is undefined for an empty drawing', () => {
    expect(drawingBounds({ layers: [], shapes: [] })).toBeUndefined();
  });
});

describe('flattenContour', () => {
  it('keeps every point of a flattened arc within the tolerance', () => {
    const points = flattenContour(
      {
        start: [50, 0],
        segments: [{ type: 'arc', center: [0, 0], sweep: -PI / 2, to: [0, -50] }],
        closed: false,
      },
      0.01,
    );
    for (let i = 1; i < points.length; i++) {
      const [ax, ay] = points[i - 1] as [number, number];
      const [bx, by] = points[i] as [number, number];
      expect(Math.hypot(ax, ay)).toBeCloseTo(50, 9);
      // The chord's midpoint is at most the tolerance inside the arc.
      expect(50 - Math.hypot((ax + bx) / 2, (ay + by) / 2)).toBeLessThanOrEqual(0.01 + 1e-12);
    }
    expect(points[points.length - 1]).toEqual([0, -50]);
  });

  it('flattens a cubic within the tolerance', () => {
    const points = flattenContour(
      {
        start: [0, 0],
        segments: [{ type: 'cubic', c1: [0, 10], c2: [10, 10], to: [10, 0] }],
        closed: false,
      },
      0.001,
    );
    // The curve's midpoint (t = 0.5) is (5, 7.5); the polyline passes close to it.
    const nearest = Math.min(...points.map(([x, y]) => Math.hypot(x - 5, y - 7.5)));
    expect(nearest).toBeLessThan(0.05);
    expect(points[points.length - 1]).toEqual([10, 0]);
  });
});

describe('writeSvg', () => {
  const plate: Drawing = {
    title: 'Plate <A&B>',
    layers: [INK, { name: 'Construction', color: '#888888', aci: 8, dashed: true }],
    shapes: [
      {
        layer: 'Sketch',
        contours: [
          {
            start: [0, 0],
            segments: [
              { type: 'line', to: [100, 0] },
              { type: 'line', to: [100, 60] },
              { type: 'line', to: [0, 60] },
              { type: 'line', to: [0, 0] },
            ],
            closed: true,
          },
        ],
      },
    ],
  };

  it('sizes the page in millimetres with the bounding box as viewBox, y flipped', () => {
    const svg = writeSvg(plate);
    expect(svg).toContain('width="100mm" height="60mm" viewBox="0 -60 100 60"');
    expect(svg).toContain('<path d="M0 0L100 0L100 -60L0 -60L0 0Z"/>');
    expect(svg).toContain('<title>Plate &lt;A&amp;B&gt;</title>');
    // Empty layers are left out.
    expect(svg).not.toContain('Construction');
  });

  it('writes a full circle as two half-turn arcs, counter-clockwise as sweep flag 0', () => {
    const svg = writeSvg(
      drawing([{ type: 'arc', center: [0, 0], sweep: 2 * PI, to: [5, 0] }], [5, 0], true),
    );
    expect(svg).toContain('M5 0A5 5 0 0 0 -5 0A5 5 0 0 0 5 0Z');
    expect(svg).toContain('viewBox="-5 -5 10 10"');
    const cw = writeSvg(
      drawing([{ type: 'arc', center: [0, 0], sweep: -PI / 2, to: [0, -5] }], [5, 0]),
    );
    expect(cw).toContain('M5 0A5 5 0 0 1 0 5');
  });

  it('writes an ellipse with its rotation mirrored for the flipped y', () => {
    const e = { center: [0, 0] as const, rx: 10, ry: 5, rotation: PI / 6 };
    const start: [number, number] = [10 * Math.cos(PI / 6), 10 * Math.sin(PI / 6)];
    const svg = writeSvg(
      drawing([{ type: 'ellipse', ...e, sweep: 2 * PI, to: start }], start, true),
    );
    expect(svg).toMatch(/A10 5 -30 0 0 /);
  });

  it('fills fill layers even-odd with no stroke, and dashes dashed layers', () => {
    const svg = writeSvg({
      layers: [
        { name: 'Profiles', color: '#000000', aci: 7, fill: true },
        { name: 'Construction', color: '#888888', aci: 8, dashed: true },
      ],
      shapes: [
        { layer: 'Profiles', contours: plate.shapes[0]?.contours ?? [] },
        {
          layer: 'Construction',
          contours: [{ start: [0, 0], segments: [{ type: 'line', to: [100, 60] }], closed: false }],
        },
      ],
    });
    expect(svg).toContain('fill="#000000" fill-rule="evenodd" stroke="none"');
    expect(svg).toContain('stroke-dasharray="2 1"');
  });

  it('gives a drawing with no height (one horizontal line) a stroke-high page', () => {
    const svg = writeSvg(drawing([{ type: 'line', to: [10, 0] }], [0, 0]));
    expect(svg).toContain('width="10mm" height="0.1mm" viewBox="0 -0.05 10 0.1"');
  });
});

describe('writeDxf', () => {
  it('writes an R12 file in millimetres with layers and linetypes', () => {
    const dxf = writeDxf({
      layers: [INK, { name: 'Construction', color: '#888888', aci: 8, dashed: true }],
      shapes: [],
    });
    const all = pairs(dxf);
    /** The value after a header variable's name. */
    const value = (name: string) => all[all.findIndex(([, v]) => v === name) + 1]?.[1];
    expect(value('$ACADVER')).toBe('AC1009');
    expect(value('$INSUNITS')).toBe('4');
    expect(dxf).toContain(' 2\nSKETCH\n 70\n0\n 62\n7\n  6\nCONTINUOUS');
    expect(dxf).toContain(' 2\nCONSTRUCTION\n 70\n0\n 62\n8\n  6\nDASHED');
    expect(dxf.endsWith('  0\nEOF\n')).toBe(true);
  });

  it('writes lines, arcs and circles as native entities', () => {
    const dxf = writeDxf({
      layers: [INK],
      shapes: [
        {
          layer: 'Sketch',
          contours: [{ start: [0, 0], segments: [{ type: 'line', to: [10, 5] }], closed: false }],
        },
        {
          layer: 'Sketch',
          contours: [
            {
              start: [3, 0],
              segments: [{ type: 'arc', center: [0, 0], sweep: 2 * PI, to: [3, 0] }],
              closed: true,
            },
          ],
        },
        // Clockwise from 90° to 0°: written counter-clockwise from 0° to 90°.
        {
          layer: 'Sketch',
          contours: [
            {
              start: [0, 2],
              segments: [{ type: 'arc', center: [0, 0], sweep: -PI / 2, to: [2, 0] }],
              closed: false,
            },
          ],
        },
      ],
    });
    const [line, circle, arc] = entities(dxf);
    expect(line?.type).toBe('LINE');
    expect(line?.codes.get(11)).toEqual(['10']);
    expect(line?.codes.get(21)).toEqual(['5']);
    expect(circle?.type).toBe('CIRCLE');
    expect(circle?.codes.get(40)).toEqual(['3']);
    expect(arc?.type).toBe('ARC');
    expect(arc?.codes.get(50)).toEqual(['0']);
    expect(arc?.codes.get(51)).toEqual(['90']);
  });

  it('writes fill contours as closed polylines with bulges', () => {
    // A slot: two lines and two half circles, counter-clockwise.
    const dxf = writeDxf({
      layers: [{ ...INK, name: 'Profiles', fill: true }],
      shapes: [
        {
          layer: 'Profiles',
          contours: [
            {
              start: [0, 0],
              segments: [
                { type: 'line', to: [20, 0] },
                { type: 'arc', center: [20, 5], sweep: PI, to: [20, 10] },
                { type: 'line', to: [0, 10] },
                { type: 'arc', center: [0, 5], sweep: PI, to: [0, 0] },
              ],
              closed: true,
            },
          ],
        },
      ],
    });
    const list = entities(dxf);
    expect(list.map((e) => e.type)).toEqual([
      'POLYLINE',
      'VERTEX',
      'VERTEX',
      'VERTEX',
      'VERTEX',
      'SEQEND',
    ]);
    expect(list[0]?.codes.get(70)).toEqual(['1']);
    expect(list.slice(1, 5).map((v) => v.codes.get(42)?.[0])).toEqual([
      undefined,
      '1',
      undefined,
      '1',
    ]);
  });

  it('flattens ellipses and Béziers into polylines within the tolerance', () => {
    const e = { center: [0, 0] as const, rx: 10, ry: 5, rotation: 0 };
    const dxf = writeDxf(
      drawing([{ type: 'ellipse', ...e, sweep: 2 * PI, to: [10, 0] }], [10, 0], true),
      { tolerance: 0.01 },
    );
    const list = entities(dxf);
    expect(list[0]?.type).toBe('POLYLINE');
    // A closed ring: the start isn't repeated.
    expect(list[0]?.codes.get(70)).toEqual(['1']);
    const vertices = list.filter((v) => v.type === 'VERTEX');
    expect(vertices.length).toBeGreaterThan(40);
    for (const v of vertices) {
      const x = Number(v.codes.get(10)?.[0]);
      const y = Number(v.codes.get(20)?.[0]);
      expect((x / 10) ** 2 + (y / 5) ** 2).toBeCloseTo(1, 5);
    }
  });
});
