/**
 * Fusion's region pieces on hand-built sketches: each curve cut by the
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
