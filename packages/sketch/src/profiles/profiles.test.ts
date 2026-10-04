import {
  conicPoint,
  curvePolyline,
  type SketchData,
  type SketchEntityId,
  type SketchSpline,
  type Vec2,
} from '@extrudo/core';
import { describe, expect, it } from 'vitest';
import { gear, SketchBuilder } from '../fixtures';
import { detectProfiles, type Profile, profileAt } from './profiles';

const PI = Math.PI;

function rect(b: SketchBuilder, x: number, y: number, w: number, h: number) {
  return [
    b.line(x, y, x + w, y),
    b.line(x + w, y, x + w, y + h),
    b.line(x + w, y + h, x, y + h),
    b.line(x, y + h, x, y),
  ].map((l) => l.id);
}

const areas = (profiles: readonly Profile[]) => profiles.map((p) => p.area);
const ids = (profiles: readonly Profile[]) => profiles.map((p) => p.id).sort();

/** Moves every point of a sketch by (dx, dy) and scales it about the origin. */
function transformed(data: SketchData, k: number, dx: number, dy: number): SketchData {
  const entities = Object.fromEntries(
    Object.entries(data.entities).map(([id, e]) => [
      id,
      e.type === 'point'
        ? { ...e, x: e.x * k + dx, y: e.y * k + dy }
        : e.type === 'circle'
          ? { ...e, radius: e.radius * k }
          : e,
    ]),
  );
  return { ...data, entities } as SketchData;
}

describe('detectProfiles', () => {
  it('finds nothing in an empty sketch or open curves', () => {
    expect(detectProfiles(new SketchBuilder().sketch)).toEqual([]);
    const b = new SketchBuilder();
    b.line(0, 0, 10, 0);
    b.line(10, 0, 10, 10);
    b.arc(0, 0, 5, 90, 180);
    expect(detectProfiles(b.sketch)).toEqual([]);
  });

  it('finds a rectangle whose corners only meet by position', () => {
    const b = new SketchBuilder();
    const sides = rect(b, 0, 0, 20, 10);
    const [p] = detectProfiles(b.sketch) as [Profile];
    expect(p.area).toBeCloseTo(200, 9);
    expect(p.holes).toEqual([]);
    expect(p.outer.edges.map((e) => e.curve).sort()).toEqual([...sides].sort());
    expect(p.outer.edges.every((e) => !e.reversed)).toBe(true);
    expect(p.outer.area).toBeGreaterThan(0);
  });

  it('finds a rectangle drawn clockwise, its edges reversed', () => {
    const b = new SketchBuilder();
    b.line(0, 0, 0, 10);
    b.line(0, 10, 20, 10);
    b.line(20, 10, 20, 0);
    b.line(20, 0, 0, 0);
    const [p] = detectProfiles(b.sketch) as [Profile];
    expect(p.area).toBeCloseTo(200, 9);
    expect(p.outer.edges.every((e) => e.reversed)).toBe(true);
  });

  it('finds a circle, an ellipse and a slot', () => {
    const b = new SketchBuilder();
    b.circle(0, 0, 5);
    b.ellipse(50, 0, 8, 3, 30);
    // A slot: two lines and two half circles.
    b.line(100, 0, 120, 0);
    b.arc(120, 5, 5, -90, 90);
    b.line(120, 10, 100, 10);
    b.arc(100, 5, 5, 90, 270);
    const profiles = detectProfiles(b.sketch);
    expect(profiles).toHaveLength(3);
    const [slot, circle, ellipse] = areas(profiles) as [number, number, number];
    expect(circle).toBeCloseTo(PI * 25, 9);
    // The ellipse is its 96-segment polyline.
    expect(ellipse / (PI * 24)).toBeCloseTo(1, 2);
    expect(slot).toBeCloseTo(200 + PI * 25, 4);
  });

  it('closes a loop with a spline', () => {
    const b = new SketchBuilder();
    b.line(0, 0, 30, 0);
    b.spline([
      [30, 0],
      [20, 10],
      [10, 8],
      [0, 0],
    ]);
    const profiles = detectProfiles(b.sketch);
    expect(profiles).toHaveLength(1);
    expect((profiles[0] as Profile).area).toBeGreaterThan(100);
  });

  it('closes a loop with a control-point spline or a conic (P4-05)', () => {
    // The area the polyline a curve draws and the line closing it enclose.
    // (Profile detection works on polylines, so this is the area it can see.)
    const areaUnder = (curve: Vec2[]): number => {
      const out = [...curve, [0, 0] as Vec2];
      let area = 0;
      for (let i = 1; i < out.length; i++) {
        const a = out[i - 1] as Vec2;
        const b = out[i] as Vec2;
        area += (a[0] + b[0]) * (b[1] - a[1]);
      }
      return Math.abs(area / 2);
    };
    const poles: [number, number][] = [
      [0, 0],
      [10, 20],
      [25, 12],
      [30, 0],
    ];
    for (const [mode, rho] of [
      ['control', undefined],
      ['conic', 0.4],
    ] as const) {
      const b = new SketchBuilder();
      const curve = b.spline(
        mode === 'control'
          ? poles
          : ([
              [0, 0],
              [15, 20],
              [30, 0],
            ] as [number, number][]),
        { mode: mode as 'control' | 'conic', rho },
      );
      // A line from the curve's end back to its start closes the loop.
      b.line(30, 0, 0, 0);
      const profiles = detectProfiles(b.sketch);
      expect(profiles).toHaveLength(1);
      const profile = profiles[0] as Profile;
      expect(profile.area).toBeGreaterThan(100);
      // The polyline the detector walks is the one the curve draws, chords and
      // all, so the area is the area of that polyline.
      const entity = b.sketch.entities[curve.id as SketchEntityId] as SketchSpline;
      const drawn = curvePolyline(b.sketch, entity) as Vec2[];
      expect(profile.area).toBeCloseTo(areaUnder(drawn), 6);
      expect(curve.points).toHaveLength(mode === 'control' ? 4 : 3);
      // A conic's profile follows the exact conic, to within the polyline the
      // detector samples it with.
      if (mode === 'conic') {
        const dense: Vec2[] = [];
        for (let i = 0; i <= 4000; i++)
          dense.push(conicPoint([0, 0], [15, 20], [30, 0], 0.4, i / 4000));
        const exact = areaUnder(dense);
        expect(profile.area).toBeGreaterThan(exact * 0.99);
        expect(profile.area).toBeLessThan(exact * 1.01);
      }
    }
  });

  it('leaves out construction geometry and points', () => {
    const b = new SketchBuilder();
    rect(b, 0, 0, 10, 10);
    b.line(0, 0, 10, 10, true);
    b.point(5, 5);
    expect(areas(detectProfiles(b.sketch))).toEqual([expect.closeTo(100, 9)]);
  });

  it('splits a rectangle where a line crosses it', () => {
    const b = new SketchBuilder();
    rect(b, 0, 0, 20, 10);
    b.line(5, -5, 5, 15);
    expect(areas(detectProfiles(b.sketch))).toEqual([
      expect.closeTo(150, 9),
      expect.closeTo(50, 9),
    ]);
  });

  it('ignores a dangling line inside a region', () => {
    const b = new SketchBuilder();
    rect(b, 0, 0, 20, 10);
    b.line(0, 5, 8, 5);
    b.line(8, 5, 8, 2);
    expect(areas(detectProfiles(b.sketch))).toEqual([expect.closeTo(200, 9)]);
  });

  it('finds three regions where two rectangles overlap', () => {
    const b = new SketchBuilder();
    rect(b, 0, 0, 20, 10);
    rect(b, 10, 5, 20, 10);
    expect(areas(detectProfiles(b.sketch))).toEqual([
      expect.closeTo(150, 9),
      expect.closeTo(150, 9),
      expect.closeTo(50, 9),
    ]);
  });

  it('finds three regions where two circles overlap, each with its own ID', () => {
    const b = new SketchBuilder();
    b.circle(0, 0, 10);
    b.circle(10, 0, 10);
    const profiles = detectProfiles(b.sketch);
    expect(profiles).toHaveLength(3);
    // The lens: 2r²·acos(d/2r) − (d/2)·√(4r² − d²).
    const lens = 2 * 100 * Math.acos(0.5) - 5 * Math.sqrt(400 - 100);
    const lune = PI * 100 - lens;
    expect(areas(profiles)).toEqual([
      expect.closeTo(lune, 3),
      expect.closeTo(lune, 3),
      expect.closeTo(lens, 3),
    ]);
    expect(new Set(ids(profiles)).size).toBe(3);
  });

  it('makes a circle inside a rectangle a hole, and a region of its own', () => {
    const b = new SketchBuilder();
    rect(b, 0, 0, 40, 20);
    const hole = b.circle(10, 10, 5);
    const [plate, disc] = detectProfiles(b.sketch) as [Profile, Profile];
    expect(plate.area).toBeCloseTo(800 - PI * 25, 4);
    expect(plate.holes).toHaveLength(1);
    expect(plate.holes[0]?.edges.map((e) => e.curve)).toEqual([hole.id]);
    expect(plate.holes[0]?.area).toBeLessThan(0);
    expect(disc.area).toBeCloseTo(PI * 25, 9);
    expect(disc.holes).toEqual([]);
  });

  it('nests three deep: each region holds only the one directly inside', () => {
    const b = new SketchBuilder();
    rect(b, -50, -50, 100, 100);
    b.circle(0, 0, 30);
    rect(b, -5, -5, 10, 10);
    const [outer, ring, inner] = detectProfiles(b.sketch) as [Profile, Profile, Profile];
    expect(outer.holes).toHaveLength(1);
    expect(outer.area).toBeCloseTo(10000 - PI * 900, 3);
    expect(ring.holes).toHaveLength(1);
    expect(ring.area).toBeCloseTo(PI * 900 - 100, 3);
    expect(inner.area).toBeCloseTo(100, 9);
  });

  it('keeps side-by-side holes in one region', () => {
    const b = new SketchBuilder();
    rect(b, 0, 0, 60, 20);
    b.circle(10, 10, 4);
    b.circle(30, 10, 4);
    rect(b, 45, 5, 10, 10);
    const [plate] = detectProfiles(b.sketch) as [Profile];
    expect(plate.holes).toHaveLength(3);
    expect(plate.area).toBeCloseTo(1200 - 2 * PI * 16 - 100, 3);
  });

  it('keeps a hole that a line joins to the outline (a bridge bounds nothing)', () => {
    const b = new SketchBuilder();
    rect(b, 0, 0, 40, 40);
    rect(b, 10, 10, 20, 20);
    b.line(0, 20, 10, 20);
    const [plate, inner] = detectProfiles(b.sketch) as [Profile, Profile];
    expect(plate.area).toBeCloseTo(1600 - 400, 9);
    expect(plate.holes).toHaveLength(1);
    expect(inner.area).toBeCloseTo(400, 9);
  });

  it('makes a circle touching a side from inside part of the outline', () => {
    const b = new SketchBuilder();
    rect(b, 0, 0, 40, 20);
    b.circle(25, 8, 8);
    const profiles = detectProfiles(b.sketch);
    expect(areas(profiles)).toEqual([expect.closeTo(800 - PI * 64, 9), expect.closeTo(PI * 64, 9)]);
    // Touching makes it part of the outline, not a hole.
    expect(profiles.every((p) => p.holes.length === 0)).toBe(true);
  });

  it('orders tangent circles by curvature: a circle inside another, touching it', () => {
    const b = new SketchBuilder();
    b.circle(0, 0, 10);
    b.circle(5, 0, 5);
    expect(areas(detectProfiles(b.sketch))).toEqual([
      expect.closeTo(PI * 75, 3),
      expect.closeTo(PI * 25, 3),
    ]);
  });

  it('finds both circles of a figure eight', () => {
    const b = new SketchBuilder();
    b.circle(0, 0, 5);
    b.circle(10, 0, 5);
    expect(areas(detectProfiles(b.sketch))).toEqual([
      expect.closeTo(PI * 25, 3),
      expect.closeTo(PI * 25, 3),
    ]);
  });

  it('takes a T-junction where a line ends on another', () => {
    const b = new SketchBuilder();
    rect(b, 0, 0, 20, 10);
    b.line(8, 0, 8, 10);
    expect(areas(detectProfiles(b.sketch))).toEqual([
      expect.closeTo(120, 9),
      expect.closeTo(80, 9),
    ]);
  });

  it('keeps one of two overlapping collinear lines', () => {
    const b = new SketchBuilder();
    rect(b, 0, 0, 20, 10);
    b.line(-5, 0, 25, 0);
    expect(areas(detectProfiles(b.sketch))).toEqual([expect.closeTo(200, 9)]);
  });

  it('finds a gear outline as one region', () => {
    const { builder } = gear({ teeth: 24 });
    const profiles = detectProfiles(builder.sketch);
    expect(profiles).toHaveLength(1);
    const area = (profiles[0] as Profile).area;
    expect(area).toBeGreaterThan(PI * 34 * 34);
    expect(area).toBeLessThan(PI * 40 * 40);
  });

  it('merges a circle cut at one point into one edge', () => {
    const b = new SketchBuilder();
    b.circle(0, 0, 10);
    b.line(10, 0, 20, 0);
    b.line(20, 0, 20, 10);
    b.line(20, 10, 10, 0.0);
    const profiles = detectProfiles(b.sketch);
    const circle = profiles.find((p) => p.outer.edges.length === 1) as Profile;
    expect(circle.area).toBeCloseTo(PI * 100, 3);
  });
});

describe('profile IDs', () => {
  const plate = () => {
    const b = new SketchBuilder();
    rect(b, 0, 0, 40, 20);
    b.circle(10, 10, 5);
    b.circle(30, 10, 5);
    return b;
  };

  it('are the same after moving and resizing the geometry', () => {
    const data = plate().sketch;
    expect(ids(detectProfiles(transformed(data, 2.5, 17, -3)))).toEqual(ids(detectProfiles(data)));
  });

  it("don't change when unrelated geometry is added", () => {
    const b = plate();
    const before = ids(detectProfiles(b.sketch));
    b.circle(100, 100, 3);
    const after = ids(detectProfiles(b.sketch));
    expect(after).toHaveLength(4);
    expect(after).toEqual(expect.arrayContaining(before));
  });

  it("don't depend on the order the entities were stored in", () => {
    const data = plate().sketch;
    const reversed = {
      ...data,
      entities: Object.fromEntries(Object.entries(data.entities).reverse()),
    } as SketchData;
    expect(ids(detectProfiles(reversed))).toEqual(ids(detectProfiles(data)));
  });

  it('keep the outer region when a hole is added (the hole changes its shape)', () => {
    const b = new SketchBuilder();
    rect(b, 0, 0, 40, 20);
    const [before] = ids(detectProfiles(b.sketch));
    b.circle(10, 10, 5);
    expect(ids(detectProfiles(b.sketch))).toContain(before);
  });

  it('differ between regions bounded by the same curves', () => {
    const b = new SketchBuilder();
    rect(b, 0, 0, 30, 10);
    // Two lines across make three regions; the middle one has both lines.
    b.line(10, -5, 10, 15);
    b.line(20, -5, 20, 15);
    expect(new Set(ids(detectProfiles(b.sketch))).size).toBe(3);
  });

  it('number regions that share their curves and directions', () => {
    const b = new SketchBuilder();
    b.line(0, 0, 40, 0);
    b.spline([
      [0, 0],
      [10, 5],
      [20, -5],
      [30, 5],
      [40, 0],
    ]);
    // Crossing twice: two regions above the line (line forwards, spline back), one below.
    const profiles = detectProfiles(b.sketch);
    expect(profiles).toHaveLength(3);
    expect(new Set(ids(profiles)).size).toBe(3);
  });
});

describe('profileAt', () => {
  it('finds the region under a point, not inside its holes', () => {
    const b = new SketchBuilder();
    rect(b, 0, 0, 40, 20);
    b.circle(10, 10, 5);
    const profiles = detectProfiles(b.sketch);
    const [plate, disc] = profiles as [Profile, Profile];
    expect(profileAt(profiles, [30, 10])?.id).toBe(plate.id);
    expect(profileAt(profiles, [10, 10])?.id).toBe(disc.id);
    expect(profileAt(profiles, [50, 10])).toBeUndefined();
  });

  it('works with entity IDs as given', () => {
    const b = new SketchBuilder();
    const [bottom] = rect(b, 0, 0, 10, 10) as [string];
    const [p] = detectProfiles(b.sketch) as [Profile];
    expect(p.outer.edges.some((e) => e.curve === (bottom as SketchEntityId))).toBe(true);
  });
});
