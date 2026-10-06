// wrapOnCylinder (P4-04 slice 3, ADR-0060 §3): the tool solid of an emboss
// on a round face. Real OCCT in Node, and the same cases as the native
// harness in `spikes/p4-04-harness` (a rectangle, a circle, a square with a
// square hole, a closed B-spline glyph, the D, and the refusals) plus a letter
// "O" shaped in Inter.
//
// Every case checks the volume against the exact one: a wrapped region of area
// A on radius R stands depth d proud as `A × d × (R ± d/2) / R`, because the
// unrolled sketch keeps its width along the surface. The B-spline walls came to
// within 2 % of it until P4-12 H3 made the integrator work to a tolerance
// (ADR-0060 §3); they are within 1e-5 now.
import type { SketchEntity, SketchEntityId } from '@extrudo/core';
import { DEFAULT_FONT } from '@extrudo/fonts';
import { SketchBuilder } from '@extrudo/sketch/fixtures';
import { loadFont } from '@extrudo/sketch/text';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import interRegular from '../../fonts/fonts/inter-regular.ttf?url&inline';
import { planarCurves } from './features/sketch';
import { type HistoryRecord, Kernel, type ShapeHandle, type WrapFrame } from './index';
import { loadOcct } from './occt/load';
import type { PlanarCurve, PlanarFace, PlanarFrame, Vec2 } from './planar';

/** The bytes of a `data:` URL (Vite's `?url&inline` import of a binary file). */
function bytesOf(dataUrl: string): Uint8Array {
  const binary = atob(dataUrl.slice(dataUrl.indexOf(',') + 1));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

const R = 20;
/** The sketch plane x = R, its `s` along world +Y and its `z` along world +Z. */
const PLANE: PlanarFrame = { origin: [R, 0, 0], x: [0, 1, 0], normal: [1, 0, 0] };
/** The cylinder that plane sits on: the Z axis through the origin, angle zero towards +X. */
const CYLINDER = {
  origin: [0, 0, 0],
  axis: [0, 0, 1],
  reference: [1, 0, 0],
  radius: R,
  corner: [R, 0, 0],
  across: [0, 1, 0],
} as const satisfies WrapFrame;

/** The exact volume of a region of `area` mm² wrapped on radius R, `depth` deep. */
function want(area: number, depth: number, outward = true): number {
  return area * depth * ((outward ? R + depth / 2 : R - depth / 2) / R);
}

function lines(...corners: Vec2[]): PlanarCurve[] {
  return corners.map(
    (a, i) => ({ kind: 'line', a, b: corners[(i + 1) % corners.length] }) as PlanarCurve,
  );
}

function rectangle(s0: number, z0: number, w: number, h: number): PlanarCurve[] {
  return lines([s0, z0], [s0 + w, z0], [s0 + w, z0 + h], [s0, z0 + h]);
}

/** A closed cubic B-spline: a wavy ring, the way a letter's outline comes in. */
function ring(radius: number, wave: number, steps: number, z: number): PlanarCurve {
  const poles: Vec2[] = Array.from({ length: steps + 1 }, (_, i) => {
    const angle = (2 * Math.PI * i) / steps;
    const r = radius + wave * Math.sin(3 * angle);
    return [r * Math.cos(angle), z + r * Math.sin(angle)];
  });
  const knots = [0, 0, 0, 0];
  for (let i = 1; i <= steps - 3; i++) knots.push(i / (steps - 2));
  knots.push(1, 1, 1, 1);
  return { kind: 'spline', degree: 3, poles, knots };
}

/**
 * The face between `curves` to wrap: the largest one, or -- for a letter, whose
 * counter is a region of its own -- the largest one with a hole in it, which is
 * the ink. The caller releases it.
 */
function face(curves: PlanarCurve[], inked = false): PlanarFace {
  const { faces } = kernel.planarFaces(curves, PLANE, 1e-6);
  const sorted = [...faces].sort((a, b) => b.area - a.area);
  const picked = (inked ? (sorted.find((f) => f.holes > 0) ?? sorted[0]) : sorted[0]) as
    | PlanarFace
    | undefined;
  if (!picked) throw new Error('the sketch made no profile');
  kernel.release(...sorted.filter((f) => f !== picked).map((f) => f.shape));
  return picked;
}

/**
 * The volume of a fine tessellation of the shape, its triangles summed as
 * tetrahedra round the origin. This is the reference where the closed form
 * cannot be: a profile bounded by a B-spline has no area OCCT's cheap integral
 * gets past 3e-5 (P4-12 H3 leaves a planar face on the cheap form -- a
 * sketch's profile areas need no more), while the wrap itself is integrated to
 * a tolerance. The mesh has its own error, a chord standing in for the curve,
 * so these cases are held to 1e-4 rather than 1e-5, at 0.0002 mm.
 */
function meshVolume(shape: ShapeHandle): number {
  const mesh = kernel.exportMesh(shape, { linearDeflection: 0.0002, angularDeflection: 0.05 });
  const p = mesh.positions;
  let total = 0;
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const a = (mesh.indices[i] as number) * 3;
    const b = (mesh.indices[i + 1] as number) * 3;
    const c = (mesh.indices[i + 2] as number) * 3;
    const ax = p[a] as number;
    const ay = p[a + 1] as number;
    const az = p[a + 2] as number;
    const bx = p[b] as number;
    const by = p[b + 1] as number;
    const bz = p[b + 2] as number;
    const cx = p[c] as number;
    const cy = p[c + 1] as number;
    const cz = p[c + 2] as number;
    total += ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx);
  }
  return total / 6;
}

/** How far `got` is from `want`, relative. */
function off(got: number, want: number): number {
  return Math.abs(got / want - 1);
}

/** What a wrap came to: the volume, the counts, and the history. */
interface Wrapped {
  volume: number;
  faces: number;
  solids: number;
  history: HistoryRecord[];
}

/** Wraps a profile region and reads the solid back, releasing everything. */
function wrap(curves: PlanarCurve[], depth: number, outward = true): Wrapped {
  const profile = face(curves);
  try {
    const { shape, history } = kernel.wrapOnCylinder(profile.shape, CYLINDER, depth, outward);
    try {
      const solids = kernel.solids(shape);
      try {
        return {
          volume: kernel.measure(shape).volume,
          faces: kernel.count(shape, 'face'),
          solids: solids.length,
          history,
        };
      } finally {
        kernel.release(...solids);
      }
    } finally {
      kernel.release(shape);
    }
  } finally {
    kernel.release(profile.shape);
  }
}

let kernel: Kernel;

beforeAll(async () => {
  kernel = new Kernel(await loadOcct());
  loadFont(DEFAULT_FONT, bytesOf(interRegular));
});

afterAll(() => {
  expect(kernel.stats().liveShapes).toBe(0);
});

describe('wrapOnCylinder', () => {
  it('wraps a rectangle out of the cylinder: the exact annular sector', () => {
    const out = wrap(rectangle(-5, 0, 10, 4), 1);
    expect(out.solids).toBe(1);
    expect(out.faces).toBe(6);
    expect(out.volume).toBeCloseTo(want(40, 1), 6);
    // The history names both caps and one wall per edge of the profile.
    expect(out.history.filter((r) => r.relation === 'generated')).toHaveLength(4);
    expect(out.history.filter((r) => r.relation === 'first')).toHaveLength(1);
    expect(out.history.filter((r) => r.relation === 'last')).toHaveLength(1);
  });

  it('wraps the same rectangle inwards', () => {
    const inward = wrap(rectangle(-5, 0, 10, 4), 1, false);
    expect(inward.faces).toBe(6);
    expect(inward.volume).toBeCloseTo(want(40, 1, false), 6);
  });

  it('wraps a circle: an ellipse on the cylinder, weighted by the radius', () => {
    const circle: PlanarCurve[] = [{ kind: 'ellipse', center: [0, 2], a: 3, b: 3, rotation: 0 }];
    // A curved wall is a B-spline surface, which the volume integrator used to
    // get to about a percent (ADR-0060 §3); it integrates to a tolerance now
    // (P4-12 H3), so these are exact to the same 1e-5 as the straight walls.
    const area = Math.PI * 9;
    const volumeWithin = (got: number, expected: number, tolerance = 1e-5) =>
      expect(Math.abs(got / expected - 1)).toBeLessThan(tolerance);
    volumeWithin(wrap(circle, 1).volume, want(area, 1));
    volumeWithin(wrap(circle, 1, false).volume, want(area, 1, false));
    // A circle off the middle is an ellipse too, and one ring of one wall.
    expect(wrap([{ kind: 'ellipse', center: [3, 6], a: 2, b: 2, rotation: 0 }], 2).faces).toBe(3);
  });

  it('wraps a square with a square hole: one solid, ten faces', () => {
    const curves = [...rectangle(-5, 0, 10, 8), ...rectangle(-2, 3, 4, 2)];
    const profile = face(curves);
    try {
      expect(profile.holes).toBe(1);
      const { shape } = kernel.wrapOnCylinder(profile.shape, CYLINDER, 1.5);
      try {
        expect(kernel.count(shape, 'face')).toBe(10);
        expect(kernel.measure(shape).volume).toBeCloseTo(want(profile.area, 1.5), 6);
      } finally {
        kernel.release(shape);
      }
    } finally {
      kernel.release(profile.shape);
    }
  });

  it('wraps a closed B-spline glyph: its ring comes out whole', () => {
    const curves = [ring(4, 0.8, 12, 2)];
    const profile = face(curves);
    try {
      const { shape } = kernel.wrapOnCylinder(profile.shape, CYLINDER, 0.5);
      try {
        expect(kernel.count(shape, 'face')).toBe(3);
        expect(off(kernel.measure(shape).volume, meshVolume(shape))).toBeLessThan(1e-4);
      } finally {
        kernel.release(shape);
      }
    } finally {
      kernel.release(profile.shape);
    }
  });

  it('wraps an outline of lines and an arc (a letter D)', () => {
    const curves: PlanarCurve[] = [
      { kind: 'line', a: [-4, 0], b: [4, 0] },
      { kind: 'line', a: [4, 0], b: [4, 4] },
      { kind: 'arc', center: [0, 4], radius: 4, from: 0, sweep: Math.PI },
      { kind: 'line', a: [-4, 4], b: [-4, 0] },
    ];
    const out = wrap(curves, 1);
    expect(out.faces).toBe(6);
    // The arc's wall is a B-spline surface: to 1e-5 now the integrator works to
    // a tolerance (P4-12 H3), where before this was 2 %.
    expect(Math.abs(out.volume / want(32 + 8 * Math.PI, 1) - 1)).toBeLessThan(1e-5);
  });

  it('wraps a letter O of Inter: a solid whose counter is a hole', () => {
    // The letter as a sketch: one text entity, whose curves the shaper places
    // exactly (lines and B-splines) once the font is loaded.
    const b = new SketchBuilder();
    const anchor = b.point(-5, -7) as SketchEntityId;
    const top = b.point(-5, 3) as SketchEntityId;
    const id = b.id('o') as SketchEntityId;
    const entity: SketchEntity = {
      type: 'text',
      anchor,
      top,
      text: 'O',
      font: DEFAULT_FONT,
      align: 'left',
      construction: false,
    };
    b.entities[id] = entity;
    const { curves } = planarCurves(b.sketch);
    expect(curves.length).toBeGreaterThan(4);
    // The O's counter is a region of its own, so the ink is the face with a hole.
    const profile = face(curves, true);
    try {
      expect(profile.holes).toBeGreaterThan(0);
      const { shape } = kernel.wrapOnCylinder(profile.shape, CYLINDER, 0.8);
      try {
        const solids = kernel.solids(shape);
        try {
          expect(solids).toHaveLength(1);
        } finally {
          kernel.release(...solids);
        }
        // Two caps and one wall per edge of the profile face, the counter included.
        expect(kernel.count(shape, 'face')).toBe(2 + kernel.count(profile.shape, 'edge'));
        expect(off(kernel.measure(shape).volume, meshVolume(shape))).toBeLessThan(1e-4);
      } finally {
        kernel.release(shape);
      }
    } finally {
      kernel.release(profile.shape);
    }
  });

  it('refuses what it cannot wrap, with a message', () => {
    const profile = face(rectangle(-2, 0, 4, 2));
    const box = kernel.box([10, 10, 10]);
    try {
      expect(() => kernel.wrapOnCylinder(profile.shape, CYLINDER, R, false)).toThrow(/radius/);
      expect(() => kernel.wrapOnCylinder(profile.shape, CYLINDER, -1)).toThrow(/depth/);
      // More than a whole turn round the cylinder (P4-12: up to one turn wraps).
      const wide = face(rectangle(0, 0, 8 * R, 2));
      try {
        expect(() => kernel.wrapOnCylinder(wide.shape, CYLINDER, 1)).toThrow(/circumference/);
      } finally {
        kernel.release(wide.shape);
      }
      // A profile whose plane is square to the axis, not along it: the XY plane.
      const { faces: across } = kernel.planarFaces(
        [
          { kind: 'line', a: [0, 0], b: [10, 0] },
          { kind: 'line', a: [10, 0], b: [10, 4] },
          { kind: 'line', a: [10, 4], b: [0, 0] },
        ],
        { origin: [0, 0, 0], x: [1, 0, 0], normal: [0, 0, 1] },
        1e-6,
      );
      const acrossFace = [...across].sort((a, b) => b.area - a.area)[0];
      if (!acrossFace) throw new Error('the sketch made no profile');
      try {
        expect(() => kernel.wrapOnCylinder(acrossFace.shape, CYLINDER, 1)).toThrow(/parallel/);
      } finally {
        kernel.release(...across.map((f) => f.shape));
      }
      // Not a single face, and not a shape at all.
      expect(() => kernel.wrapOnCylinder(box, CYLINDER, 1)).toThrow(/single face/);
      expect(() => kernel.wrapOnCylinder(99999 as ShapeHandle, CYLINDER, 1)).toThrow(
        /unknown face/,
      );
    } finally {
      kernel.release(profile.shape, box);
    }
  });
});
