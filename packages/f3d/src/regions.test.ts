/**
 * The file's region pieces on hand-built sketches: each curve cut by the
 * region's other curves, the pieces of an open curve counted from its start,
 * those of a closed one by where they end.
 */
import { describe, expect, it } from 'vitest';
import type { RegionPiece } from './decode/extrude';
import type { SketchCircular, SketchLine, Vec3 } from './decode/sketch-geometry';
import type { F3dSketch } from './model';
import { insidePieces, regionPieces, sketchPieces } from './regions';

function line(tag: bigint, start: [number, number], end: [number, number]): SketchLine {
  return {
    id: Number(tag),
    tag,
    secondary: 0n,
    start: [...start, 0] as Vec3,
    end: [...end, 0] as Vec3,
    startPoint: -1,
    endPoint: -1,
    construction: false,
  };
}

function circle(tag: bigint, radius: number): SketchCircular {
  return {
    id: Number(tag),
    tag,
    secondary: 0n,
    center: [0, 0, 0],
    normal: [0, 0, 1],
    xAxis: [1, 0, 0],
    radius,
    startAngle: 0,
    endAngle: 2 * Math.PI,
    centerPoint: -1,
    construction: false,
  };
}

function sketch(lines: SketchLine[], circulars: SketchCircular[] = []): F3dSketch {
  return { id: 1, frame: [], points: [], lines, circulars, splines: [], texts: [] };
}

const p = (tag: bigint, piece: number, of: number): RegionPiece => ({
  tag,
  secondary: 0n,
  piece,
  of,
});

describe('regionPieces', () => {
  // A 4 × 2 rectangle and a vertical line through it at x = 2, sticking out.
  const halves = sketch([
    line(1n, [0, 0], [4, 0]),
    line(2n, [4, 0], [4, 2]),
    line(3n, [4, 2], [0, 2]),
    line(4n, [0, 2], [0, 0]),
    line(5n, [2, -1], [2, 3]),
  ]);

  it('counts an open curve from its start, cut by the region’s other curves', () => {
    const pieces = sketchPieces(halves, new Set());
    // The left half: the bottom's first piece, the top's second, the middle of the line.
    const left = regionPieces(pieces, [[p(4n, 1, 1), p(1n, 1, 2), p(5n, 2, 3), p(3n, 2, 2)]]);
    expect(left).toBeDefined();
    expect(insidePieces(left ?? [], [1, 1])).toBe(true);
    expect(insidePieces(left ?? [], [3, 1])).toBe(false);
    // The whole rectangle: the line is not one of its curves, so nothing is cut.
    const whole = regionPieces(pieces, [[p(1n, 1, 1), p(2n, 1, 1), p(3n, 1, 1), p(4n, 1, 1)]]);
    expect(insidePieces(whole ?? [], [3, 1])).toBe(true);
  });

  it('refuses pieces that do not match the sketch any more', () => {
    const pieces = sketchPieces(halves, new Set());
    expect(regionPieces(pieces, [[p(4n, 1, 1), p(1n, 1, 3), p(5n, 2, 3), p(3n, 2, 2)]])).toBe(
      undefined,
    );
    expect(regionPieces(pieces, [[p(9n, 1, 1)]])).toBe(undefined);
  });

  it('counts a closed curve’s pieces by where they end', () => {
    // A circle cut by a line through its centre at angles π and 2π: piece 1
    // runs from 0 to π (the upper half), piece 2 from π to 2π.
    const pieces = sketchPieces(sketch([line(2n, [-2, 0], [2, 0])], [circle(1n, 1)]), new Set());
    const upper = regionPieces(pieces, [[p(1n, 1, 2), p(2n, 2, 3)]]);
    expect(insidePieces(upper ?? [], [0, 0.5])).toBe(true);
    expect(insidePieces(upper ?? [], [0, -0.5])).toBe(false);
  });

  it('drops a slit the boundary runs along on both sides', () => {
    // The rectangle's outline walked round the line's middle piece twice.
    const pieces = sketchPieces(halves, new Set());
    const outline = regionPieces(pieces, [
      [p(1n, 1, 2), p(1n, 2, 2), p(2n, 1, 1), p(3n, 1, 2), p(3n, 2, 2), p(4n, 1, 1)],
      [p(5n, 2, 3), p(5n, 2, 3)],
    ]);
    expect(outline).toBeDefined();
    expect(insidePieces(outline ?? [], [1, 1])).toBe(true);
    expect(insidePieces(outline ?? [], [3, 1])).toBe(true);
  });
});

describe('touches', () => {
  /** An arc of the circle about (0, 0), from one angle to another. */
  const arc = (tag: bigint, radius: number, from: number, to: number): SketchCircular => ({
    ...circle(tag, radius),
    startAngle: from,
    endAngle: to,
  });

  it('takes a line tangent to an arc as one touch, not a crossing', () => {
    // A quarter disc whose top runs off the arc's end tangentially, a hair
    // inside the circle (as a rounded corner's numbers come out): the two
    // roots are a fraction of the tolerance apart, and the one inside the
    // arc must not cut it.
    const y = 1 - 1e-13;
    const pieces = sketchPieces(
      sketch(
        [line(1n, [0, y], [-1, y]), line(2n, [-1, y], [-1, 0]), line(3n, [-1, 0], [1, 0])],
        [arc(4n, 1, 0, Math.PI / 2)],
      ),
      new Set(),
    );
    const region = regionPieces(pieces, [[p(1n, 1, 1), p(2n, 1, 1), p(3n, 1, 1), p(4n, 1, 1)]]);
    expect(region).toBeDefined();
    expect(insidePieces(region ?? [], [0.5, 0.5])).toBe(true);
    expect(insidePieces(region ?? [], [-0.5, 0.5])).toBe(true);
  });

  it('still cuts an arc a line crosses close to its end', () => {
    // The same line lowered to cross the circle 0.1 mm from the arc's end.
    const y = Math.cos(0.01);
    const pieces = sketchPieces(
      sketch([line(1n, [0.5, y], [-1, y])], [arc(4n, 1, 0, Math.PI / 2)]),
      new Set(),
    );
    expect(pieces.byKey.get('4:0')?.hits.length).toBe(1);
  });

  it('cuts two coincident circles where each one starts, counted first', () => {
    // Two copies of one circle and two lines from the centre to it, at 270°
    // and 280°. Each circle is cut at the other's start (0°) and at the two
    // line ends: three pieces, the third the short arc between the lines.
    const end = (deg: number): [number, number] => [
      Math.cos((deg * Math.PI) / 180),
      Math.sin((deg * Math.PI) / 180),
    ];
    const pieces = sketchPieces(
      sketch(
        [line(1n, [0, 0], end(270)), line(2n, [0, 0], end(280))],
        [circle(3n, 1), circle(4n, 1)],
      ),
      new Set(),
    );
    const sliver = regionPieces(pieces, [[p(1n, 1, 1), p(2n, 1, 1), p(3n, 3, 3), p(4n, 3, 3)]]);
    expect(sliver).toBeDefined();
    const inside = end(275).map((v) => v * 0.9) as [number, number];
    expect(insidePieces(sliver ?? [], inside)).toBe(true);
    expect(insidePieces(sliver ?? [], [0, 0.5])).toBe(false);
  });
});

describe('hostile arcs', () => {
  it('brings a huge start angle round in one step, not one turn at a time', () => {
    // An open arc whose angles sit far out (the loop of turns took seconds at
    // 1e10 and never ended past 1e17), crossed by a line.
    for (const from of [1e10, 1e17, -1e300]) {
      const arc = { ...circle(2n, 1), startAngle: from, endAngle: from + 3 };
      const t = performance.now();
      sketchPieces(sketch([line(1n, [-2, 0], [2, 0])], [arc]), new Set());
      expect(performance.now() - t).toBeLessThan(1000);
    }
  });
});
