import { readFileSync, writeFileSync } from 'node:fs';
import { fitSpline, splinePoint, type Vec2 } from '@extrudo/core';
import { drawingBounds, flattenContour, writeDxf, writeSvg } from '@extrudo/io';
import { describe, expect, it } from 'vitest';
import { SketchBuilder } from '../fixtures';
import { detectProfiles } from '../profiles';
import { bezierPieces, bezierRange, splineParam } from './bezier';
import { profileDrawing, sketchDrawing } from './export';

/**
 * Golden files: `UPDATE_GOLDEN=1 pnpm vitest run packages/sketch/src/export`
 * rewrites them; review the diff before committing.
 */
function golden(name: string, text: string) {
  const path = new URL(`./golden/${name}`, import.meta.url);
  if (process.env.UPDATE_GOLDEN) writeFileSync(path, text);
  expect(text).toBe(readFileSync(path, 'utf8'));
}

function rect(b: SketchBuilder, x: number, y: number, w: number, h: number) {
  b.line(x, y, x + w, y);
  b.line(x + w, y, x + w, y + h);
  b.line(x + w, y + h, x, y + h);
  b.line(x, y + h, x, y);
}

/** Benchmark B1's shape: a 100 × 60 plate, four Ø6 holes 10 mm in, a construction diagonal. */
function plate() {
  const b = new SketchBuilder();
  rect(b, 0, 0, 100, 60);
  for (const [x, y] of [
    [10, 10],
    [90, 10],
    [90, 50],
    [10, 50],
  ] as const)
    b.circle(x, y, 3);
  b.line(0, 0, 100, 60, true);
  return b.sketch;
}

/** A slot, a rotated ellipse and a spline. */
function curves() {
  const b = new SketchBuilder();
  b.line(0, 0, 20, 0);
  b.arc(20, 5, 5, -90, 90);
  b.line(20, 10, 0, 10);
  b.arc(0, 5, 5, 90, 270);
  b.ellipse(50, 5, 12, 5, 30);
  b.spline([
    [0, 30],
    [15, 40],
    [30, 28],
    [45, 38],
    [60, 30],
  ]);
  return b.sketch;
}

/** How many points the SVG paths name: one `M` for each drawn curve. */
function pointsOf(svg: string): number {
  return (svg.match(/ d="M/g) ?? []).length;
}

describe('sketchDrawing', () => {
  it('matches the golden SVG and DXF of the plate, with and without construction', () => {
    const data = plate();
    golden('plate.svg', writeSvg(sketchDrawing(data, { title: 'Plate' })));
    golden(
      'plate-construction.svg',
      writeSvg(sketchDrawing(data, { title: 'Plate', construction: true })),
    );
    golden('plate.dxf', writeDxf(sketchDrawing(data, { construction: true })));
  });

  it('sizes the plate at 100 × 60 mm', () => {
    const svg = writeSvg(sketchDrawing(plate()));
    expect(svg).toContain('width="100mm" height="60mm" viewBox="0 -60 100 60"');
  });

  it('leaves construction geometry out unless asked', () => {
    expect(sketchDrawing(plate()).shapes).toHaveLength(8);
    const withConstruction = sketchDrawing(plate(), { construction: true });
    expect(withConstruction.shapes).toHaveLength(9);
    expect(withConstruction.shapes.filter((s) => s.layer === 'Construction')).toHaveLength(1);
  });

  it('matches the golden SVG and DXF of arcs, an ellipse and a spline', () => {
    const data = curves();
    golden('curves.svg', writeSvg(sketchDrawing(data, { title: 'Curves' })));
    golden('curves.dxf', writeDxf(sketchDrawing(data)));
  });

  it('writes a control-point spline and a conic as their own curves (P4-05)', () => {
    const poles: [number, number][] = [
      [0, 0],
      [10, 20],
      [25, 12],
      [30, 0],
    ];
    const b = new SketchBuilder();
    b.spline(poles, { mode: 'control' });
    b.spline(
      [
        [0, 30],
        [15, 50],
        [30, 30],
      ],
      { mode: 'conic', rho: 0.5 },
    );
    const shapes = sketchDrawing(b.sketch).shapes;
    expect(shapes).toHaveLength(2);
    // The control spline is written as the Bézier of its own poles: its first
    // segment runs from the first pole, out towards the second.
    const first = shapes[0]?.contours[0];
    expect(first?.start).toEqual([0, 0]);
    expect(first?.segments).toHaveLength(1);
    expect(first?.segments[0]).toEqual({
      type: 'cubic',
      c1: [10, 20],
      c2: [25, 12],
      to: [30, 0],
    });
    // The conic of rho 0.5 is one cubic Bézier: the quadratic of its three
    // points raised to degree 3.
    const second = shapes[1]?.contours[0];
    expect(second?.start).toEqual([0, 30]);
    expect(second?.segments).toEqual([
      {
        type: 'cubic',
        c1: [10, 30 + (2 / 3) * 20],
        c2: [30 - (2 / 3) * 15, 30 + (2 / 3) * 20],
        to: [30, 30],
      },
    ]);
    // Both reach the SVG, in mm with y up.
    const svg = writeSvg(sketchDrawing(b.sketch));
    expect(svg).toContain('width="30mm"');
    expect(pointsOf(svg)).toBe(2);
  });

  it('writes a closed spline as a closed contour and a trimmed one by its own knots (P4-12)', () => {
    const b = new SketchBuilder();
    b.spline(
      [
        [0, 0],
        [30, 0],
        [30, 20],
        [0, 20],
      ],
      { closed: true },
    );
    const knotted = b.spline(
      [
        [0, 40],
        [10, 60],
        [20, 35],
        [30, 55],
        [40, 40],
        [50, 50],
      ],
      { mode: 'control' },
    );
    // Non-uniform, with a knot of multiplicity 3 (a trimmed loop's joint).
    const knots = [0, 0, 0, 0, 0.6, 0.6, 1, 1, 1, 1];
    (b.sketch.entities[knotted.id as never] as unknown as { knots: number[] }).knots = knots;
    const [loop, open] = sketchDrawing(b.sketch).shapes.map((shape) => shape.contours[0]);
    expect(loop?.closed).toBe(true);
    const last = loop?.segments.at(-1) as { to: Vec2 };
    expect(last.to[0]).toBeCloseTo(loop?.start[0] as number, 9);
    expect(last.to[1]).toBeCloseTo(loop?.start[1] as number, 9);
    expect(open?.closed).toBe(false);
    // One Bézier per distinct knot span: [0, 0.6] and [0.6, 1], whatever the multiplicities.
    expect(open?.segments).toHaveLength(2);
    const curve = {
      degree: 3,
      poles: knotted.points.map((p) => {
        const e = b.sketch.entities[p as never] as unknown as { x: number; y: number };
        return [e.x, e.y] as Vec2;
      }),
      knots,
    };
    const joint = (open?.segments[0] as { to: Vec2 } | undefined)?.to ?? [NaN, NaN];
    const q = splinePoint(curve, 0.6);
    expect(joint[0]).toBeCloseTo(q[0], 9);
    expect(joint[1]).toBeCloseTo(q[1], 9);
  });

  it('bounds a rotated ellipse and a spline by their curves', () => {
    const b = new SketchBuilder();
    b.ellipse(0, 0, 10, 4, 90);
    const box = drawingBounds(sketchDrawing(b.sketch));
    expect(box?.maxX).toBeCloseTo(4, 9);
    expect(box?.maxY).toBeCloseTo(10, 9);
  });
});

describe('bezierPieces', () => {
  it('reproduces the B-spline exactly, piece by piece', () => {
    const fit: Vec2[] = [
      [0, 0],
      [10, 8],
      [20, -3],
      [35, 5],
      [40, 20],
      [30, 30],
    ];
    const spline = fitSpline(fit);
    const pieces = bezierPieces(spline);
    expect(pieces).toHaveLength(spline.poles.length - spline.degree);
    for (const piece of pieces) {
      expect(piece.points).toHaveLength(4);
      for (const t of [0, 0.25, 0.5, 0.9, 1]) {
        const [p0, p1, p2, p3] = piece.points as [Vec2, Vec2, Vec2, Vec2];
        const s = 1 - t;
        const x = s ** 3 * p0[0] + 3 * s * s * t * p1[0] + 3 * s * t * t * p2[0] + t ** 3 * p3[0];
        const y = s ** 3 * p0[1] + 3 * s * s * t * p1[1] + 3 * s * t * t * p2[1] + t ** 3 * p3[1];
        const q = splinePoint(spline, piece.u0 + (piece.u1 - piece.u0) * t);
        expect(x).toBeCloseTo(q[0], 9);
        expect(y).toBeCloseTo(q[1], 9);
      }
    }
  });

  it('gives a three-point spline as quadratic pieces and a two-point one as a line', () => {
    expect(
      bezierPieces(
        fitSpline([
          [0, 0],
          [5, 5],
          [10, 0],
        ]),
      )[0]?.points,
    ).toHaveLength(3);
    expect(
      bezierPieces(
        fitSpline([
          [0, 0],
          [10, 0],
        ]),
      )[0]?.points,
    ).toEqual([
      [0, 0],
      [10, 0],
    ]);
  });

  it('cuts a range out of the spline, in either direction', () => {
    const spline = fitSpline([
      [0, 0],
      [10, 10],
      [20, 0],
      [30, 10],
    ]);
    const pieces = bezierPieces(spline);
    const forward = bezierRange(pieces, 0.2, 0.7);
    expect(forward[0]?.[0]?.[0]).toBeCloseTo(splinePoint(spline, 0.2)[0], 9);
    const lastForward = forward[forward.length - 1] as Vec2[];
    expect(lastForward[lastForward.length - 1]?.[1]).toBeCloseTo(splinePoint(spline, 0.7)[1], 9);
    const backward = bezierRange(pieces, 0.7, 0.2);
    expect(backward[0]?.[0]?.[0]).toBeCloseTo(splinePoint(spline, 0.7)[0], 9);
    expect(splineParam(spline, splinePoint(spline, 0.37))).toBeCloseTo(0.37, 6);
  });
});

describe('profileDrawing', () => {
  it('matches the golden SVG and DXF of the plate profile with its holes', () => {
    const data = plate();
    const profiles = detectProfiles(data);
    expect(profiles).toHaveLength(5);
    // The plate with four holes; the holes' own discs are profiles too.
    const outer = profiles.filter((p) => p.holes.length === 4);
    golden('plate-profile.svg', writeSvg(profileDrawing(data, outer, { title: 'Plate' })));
    golden('plate-profile.dxf', writeDxf(profileDrawing(data, outer)));
  });

  it('keeps exact curves along profile edges that curves cut', () => {
    // A rectangle whose top is a spline, crossed by a circle at a corner.
    const b = new SketchBuilder();
    b.line(0, 0, 40, 0);
    b.line(40, 0, 40, 20);
    b.spline([
      [40, 20],
      [20, 30],
      [0, 20],
    ]);
    b.line(0, 20, 0, 0);
    b.circle(40, 0, 5);
    b.ellipse(20, 10, 6, 3);
    const data = b.sketch;
    const profiles = detectProfiles(data);
    golden('mixed-profiles.svg', writeSvg(profileDrawing(data, profiles)));
    const drawing = profileDrawing(data, profiles);
    for (const shape of drawing.shapes) {
      for (const contour of shape.contours) {
        expect(contour.closed).toBe(true);
        const kinds = new Set(contour.segments.map((s) => s.type));
        expect(kinds.has('line') || kinds.has('arc') || kinds.has('ellipse')).toBe(true);
        // Flattened, each contour closes on its start and stays near the profile's area.
        const points = flattenContour(contour, 0.001);
        const [x0, y0] = points[0] as Vec2;
        const [x1, y1] = points[points.length - 1] as Vec2;
        expect(Math.hypot(x1 - x0, y1 - y0)).toBeLessThan(1e-6);
      }
    }
    // Areas of the exact contours agree with profile detection's, which measures ellipses and
    // splines on their polylines: within 0.2 %, and the ellipse's is exactly πab.
    const shoelace = (points: readonly Vec2[]) =>
      points.reduce((s, p, i) => {
        const q = points[(i + 1) % points.length] as Vec2;
        return s + (p[0] * q[1] - q[0] * p[1]) / 2;
      }, 0);
    const areas = drawing.shapes.map((shape) =>
      shape.contours.reduce((s, c) => s + shoelace(flattenContour(c, 0.0001)), 0),
    );
    areas.forEach((area, i) => {
      const detected = profiles[i]?.area ?? 0;
      expect(Math.abs(area - detected) / detected).toBeLessThan(0.002);
    });
    // (Up to the flattening, which cuts about 2 × 10⁻³ mm² off it.)
    expect(areas.some((a) => Math.abs(a - Math.PI * 18) < 5e-3)).toBe(true);
    expect(
      drawing.shapes.some((s) =>
        s.contours.some((c) =>
          c.segments.some((g) => g.type === 'cubic' || g.type === 'quadratic'),
        ),
      ),
    ).toBe(true);
  });
});
