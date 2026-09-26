import type { SketchData, Vec2 } from '@extrudo/core';
import { describe, expect, it } from 'vitest';
import { GLYPH_SIZE, glyphAnchors, layoutGlyphs } from './glyphs';

/** A 20 × 10 rectangle whose corners are joined, with a circle and an arc tangent to the top. */
const sketch = {
  entities: {
    p1: { type: 'point', x: 0, y: 0 },
    p2: { type: 'point', x: 20, y: 0 },
    q2: { type: 'point', x: 20, y: 0 },
    q3: { type: 'point', x: 20, y: 10 },
    bottom: { type: 'line', start: 'p1', end: 'p2', construction: false },
    right: { type: 'line', start: 'q2', end: 'q3', construction: false },
    cc: { type: 'point', x: 50, y: 0 },
    circle: { type: 'circle', center: 'cc', radius: 10, construction: false },
    ac: { type: 'point', x: 30, y: 10 },
    as: { type: 'point', x: 20, y: 10 },
    ae: { type: 'point', x: 40, y: 10 },
    arc: { type: 'arc', center: 'ac', start: 'ae', end: 'as', construction: false },
  },
  constraints: {
    h: { type: 'horizontal', a: 'bottom' },
    v: { type: 'vertical', a: 'right' },
    corner: { type: 'coincident', a: 'p2', b: 'q2' },
    perp: { type: 'perpendicular', a: 'bottom', b: 'right' },
    fixed: { type: 'fix', entity: 'circle' },
    joint: { type: 'tangent', a: 'right', b: 'arc' },
    loose: { type: 'tangent', a: 'bottom', b: 'circle' },
    joined: { type: 'coincident', a: 'q3', b: 'as' },
  },
  dimensions: {},
} as unknown as SketchData;

const round = (v: Vec2) => v.map((c) => Math.round(c * 1e6) / 1e6 + 0);

describe('glyphAnchors', () => {
  const anchors = glyphAnchors(sketch);
  const of = (id: string) =>
    anchors.filter((a) => a.constraint === id).map((a) => [a.entity, round(a.at), a.normal]);

  it('puts a line glyph at the middle, on the upper or left side', () => {
    expect(of('h')).toEqual([['bottom', [10, 0], [-0, 1]]]);
    expect(of('v')).toEqual([['right', [20, 5], [-1, 0]]]);
  });

  it('shows a coincidence once, at the point', () => {
    expect(of('corner')).toEqual([['p2', [20, 0], undefined]]);
  });

  it('shows pairs on both entities, circles at 45° facing out', () => {
    expect(of('perp').map(([e]) => e)).toEqual(['bottom', 'right']);
    const [[, at, normal]] = of('fixed') as [[string, Vec2, Vec2]];
    expect(at[0]).toBeCloseTo(50 + 10 * Math.SQRT1_2);
    expect(at[1]).toBeCloseTo(10 * Math.SQRT1_2);
    expect(normal[0]).toBeCloseTo(Math.SQRT1_2);
  });

  it('shows a tangent at the joint when the curves meet, else on both', () => {
    expect(of('joint')).toEqual([['q3', [20, 10], undefined]]);
    expect(of('loose').map(([e]) => e)).toEqual(['bottom', 'circle']);
  });
});

describe('layoutGlyphs', () => {
  // The Top view at 10 px per mm, origin at (100, 300): screen y runs down.
  const project = (p: Vec2) => [100 + p[0] * 10, 300 - p[1] * 10] as const;
  const placed = layoutGlyphs(glyphAnchors(sketch), project);
  const at = (id: string) => placed.filter((g) => g.constraint === id).map((g) => [g.x, g.y]);
  const pitch = GLYPH_SIZE + 2;

  it('moves glyphs off their curve, and rows them up across it', () => {
    // The bottom line carries h, perp and loose: a row above its middle (200, 300).
    const row = [...at('h'), ...at('perp').slice(0, 1), ...at('loose').slice(0, 1)];
    expect(row).toEqual([
      [200 - pitch, 286],
      [200, 286],
      [200 + pitch, 286],
    ]);
    // The right line's glyphs sit to its left, stacked down the screen.
    expect(at('v')).toEqual([[286, 250 - pitch / 2]]);
  });

  it('rows up everything at one point to its upper right, whichever point it names', () => {
    // The joint at (20, 10) holds `joint` (on q3) and `joined` (on q3 as well).
    const x = 300 + 14 * Math.SQRT1_2;
    const y = 200 - 14 * Math.SQRT1_2;
    expect(at('joint')[0]?.[0]).toBeCloseTo(x);
    expect(at('joint')[0]?.[1]).toBeCloseTo(y);
    expect(at('joined')[0]?.[0]).toBeCloseTo(x + pitch);
    expect(at('joined')[0]?.[1]).toBeCloseTo(y);
  });

  it('leaves out anchors that do not project', () => {
    expect(layoutGlyphs(glyphAnchors(sketch), () => undefined)).toEqual([]);
  });
});
