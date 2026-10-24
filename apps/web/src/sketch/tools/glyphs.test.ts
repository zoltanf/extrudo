import type { SketchData, Vec2 } from '@extrudo/core';
import { describe, expect, it } from 'vitest';
import { GLYPH_SIZE, glyphAnchors, glyphCurves, layoutGlyphs } from './glyphs';

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
    // On the circle's centre, but free: the Fix on the circle holds `cc`.
    lone: { type: 'point', x: 50, y: 0 },
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
    level: { type: 'horizontal', a: 'p1', b: 'lone' },
    plumb: { type: 'vertical', a: 'q2', b: 'q3' },
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

  it('shows a horizontal or vertical between two points once, halfway, with its own icon', () => {
    expect(of('level')).toEqual([['p1', [25, 0], [0, 1]]]);
    expect(of('plumb')).toEqual([['q2', [20, 5], [1, -0]]]);
    const face = (id: string) =>
      anchors.filter((a) => a.constraint === id).map((a) => [a.icon, a.label]);
    expect(face('level')).toEqual([['horizontal-points', 'Horizontal (points)']]);
    expect(face('plumb')).toEqual([['vertical-points', 'Vertical (points)']]);
    expect(face('h')).toEqual([['horizontal', 'Horizontal']]);
    expect(face('v')).toEqual([['vertical', 'Vertical']]);
    expect(face('corner')).toEqual([['coincident', 'Coincident']]);
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

  it("puts a point pair's glyph above the midpoint, carrying its face", () => {
    const [g] = placed.filter((p) => p.constraint === 'level');
    expect(g?.x).toBeCloseTo(350);
    expect(g?.y).toBeCloseTo(300 - 14);
    expect([g?.icon, g?.label]).toEqual(['horizontal-points', 'Horizontal (points)']);
    // A vertical pair's glyph sits to the right of its midpoint (20, 5).
    expect(at('plumb')).toEqual([[300 + 14, 250]]);
  });

  it('leaves out anchors that do not project', () => {
    expect(layoutGlyphs(glyphAnchors(sketch), () => undefined)).toEqual([]);
  });
});

describe('a point pair next to curves', () => {
  const project = (p: Vec2) => [p[0] * 10, -p[1] * 10] as const;
  const pair = (type: 'horizontal' | 'vertical', pts: Record<string, Vec2>, b = 'b') =>
    ({
      entities: Object.fromEntries(
        Object.entries(pts).map(([k, [x, y]]) => [k, { type: 'point', x, y }]),
      ),
      constraints: { c: { type, a: 'a', b } },
      dimensions: {},
    }) as unknown as SketchData;
  const horizontal = pair('horizontal', { a: [-30, -10], b: [30, -10] });

  it('puts a Horizontal pair straight above the midpoint', () => {
    const [g] = layoutGlyphs(glyphAnchors(horizontal), project, []);
    expect([g?.x, g?.y]).toEqual([0, 100 - 14]);
  });

  it('steps below the line when a curve passes just above the midpoint', () => {
    const curve: Vec2[] = [
      [-30, -9],
      [30, -9],
    ];
    const [g] = layoutGlyphs(glyphAnchors(horizontal), project, [curve]);
    expect([g?.x, g?.y]).toEqual([0, 100 + 14]);
  });

  it('keeps the normal side when the curve is clear', () => {
    const curve: Vec2[] = [
      [-30, 10],
      [30, 10],
    ];
    const [g] = layoutGlyphs(glyphAnchors(horizontal), project, [curve]);
    expect(g?.y).toBe(100 - 14);
  });

  it('puts a Vertical pair to the right', () => {
    const v = pair('vertical', { a: [0, 0], b: [0, 20] });
    const [g] = layoutGlyphs(glyphAnchors(v), project, []);
    expect([g?.x, g?.y]).toEqual([14, -100]);
  });

  it('sits beside the free point when the other end is projected', () => {
    const s = {
      entities: {
        a: { type: 'point', x: 0, y: 0 },
        b: { type: 'point', x: 0, y: 60 },
        e: { type: 'point', x: 20, y: 60 },
        l: { type: 'line', start: 'b', end: 'e' },
      },
      constraints: { c: { type: 'vertical', a: 'b', b: 'a' } },
      dimensions: {},
      projections: { p: { ref: { kind: 'face', id: 'f' }, curves: { k: 'l' } } },
    } as unknown as SketchData;
    const anchors = glyphAnchors(s);
    const [anchor] = anchors;
    expect([anchor?.entity, anchor?.at, anchor?.pair]).toEqual(['a', [0, 0], undefined]);
    const [g] = layoutGlyphs(anchors, project, []);
    expect([g?.x, g?.y]).toEqual([14 * Math.SQRT1_2, -14 * Math.SQRT1_2]);
    expect(g?.icon).toBe('vertical-points');
  });

  it('sits beside the free point when a Fix holds the other', () => {
    const s = {
      entities: { a: { type: 'point', x: 0, y: 0 }, b: { type: 'point', x: 50, y: 0 } },
      constraints: { c: { type: 'horizontal', a: 'a', b: 'b' }, f: { type: 'fix', entity: 'a' } },
      dimensions: {},
    } as unknown as SketchData;
    const pairs = glyphAnchors(s).filter((g) => g.constraint === 'c');
    expect(pairs.map((g) => [g.entity, g.at])).toEqual([['b', [50, 0]]]);
  });

  it('stays halfway when both ends are fixed', () => {
    const s = {
      entities: { a: { type: 'point', x: 0, y: 0 }, b: { type: 'point', x: 50, y: 0 } },
      constraints: {
        c: { type: 'horizontal', a: 'a', b: 'b' },
        f: { type: 'fix', entity: 'a' },
        g: { type: 'fix', entity: 'b' },
      },
      dimensions: {},
    } as unknown as SketchData;
    const pair = glyphAnchors(s).find((g) => g.constraint === 'c');
    expect([pair?.at, pair?.pair]).toEqual([[25, 0], true]);
  });

  it('gives two pairs that share a point their own glyphs', () => {
    const s = {
      entities: {
        a: { type: 'point', x: 0, y: 0 },
        b: { type: 'point', x: 20, y: 0 },
        c: { type: 'point', x: 0, y: 20 },
      },
      constraints: {
        h: { type: 'horizontal', a: 'a', b: 'b' },
        v: { type: 'vertical', a: 'a', b: 'c' },
      },
      dimensions: {},
    } as unknown as SketchData;
    const placed = layoutGlyphs(glyphAnchors(s), project, []);
    expect(placed.map((g) => [g.x, g.y])).toEqual([
      [100, -14],
      [14, -100],
    ]);
  });
});

describe('glyphCurves', () => {
  it('skips points and a datum axis, keeps a construction line', () => {
    const s = {
      entities: {
        p1: { type: 'point', x: 0, y: 0 },
        p2: { type: 'point', x: 10, y: 0 },
        p3: { type: 'point', x: 0, y: 5 },
        p4: { type: 'point', x: 10, y: 5 },
        guide: { type: 'line', start: 'p1', end: 'p2', construction: true },
        axis: { type: 'line', start: 'p3', end: 'p4', construction: true },
      },
      constraints: {},
      dimensions: {},
      projections: { p1: { ref: { kind: 'axis', id: 'origin:x' }, curves: { axis: 'axis' } } },
    } as unknown as SketchData;
    expect(glyphCurves(s)).toEqual([
      [
        [0, 0],
        [10, 0],
      ],
    ]);
  });
});
