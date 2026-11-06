// Booleans where a side of the tool runs along a rounded face of the body
// (ADR-0051, 2026-11-06): a plate with a rounded end (an arc, so the end is a
// cylinder face) and a prism that overlaps that end, its far side tangent to
// the cylinder (1.65e-6 mm inside it) and its top within 5e-6 mm of the
// plate's top, tilted across it. OCCT's plain boolean splits the plate's
// faces there but classifies the overlap as outside: the cut removes
// nothing, the intersection is empty and the join leaves the tool out. The
// facade notices (the shapes met, the result shows no overlap) and builds the
// boolean again with a fuzzy value. Synthetic shapes only.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Kernel, type ShapeHandle, type Vec3 } from './kernel';
import { type NamedShape, namedBoolean, namedPrism } from './naming/ops';
import { loadOcct } from './occt/load';
import type { PlanarCurve, PlanarFrame } from './planar';

let kernel: Kernel;
const live: ShapeHandle[] = [];

beforeAll(async () => {
  kernel = new Kernel(await loadOcct());
});

afterAll(() => {
  kernel.release(...live);
  expect(kernel.stats().liveShapes).toBe(0);
});

// The plate: x 0…xs straight, then an arc about (CX, 20) of radius R up to
// x = CX + R = 74, meeting y = 0 and y = 40 at x = xs; z 0…15.
const R = 20.4723602484;
const CX = 74 - R;
const D = Math.sqrt(R * R - 400);
const XS = CX + D;
const H = 15;
// The tool, in the xz plane: x 59.9…X1, from z 3 up to a top that runs from
// 15 + 4.96e-6 (at x 59.9) to 15 − 3.4e-7 (at X1); extruded along y 0…42.
const X0 = 59.9;
const X1 = CX + R - 1.654e-6;
const T0 = H + 4.96e-6;
const T1 = H - 3.4e-7;

const XY: PlanarFrame = { origin: [0, 0, 0], x: [1, 0, 0], normal: [0, 0, 1] };
// Local y is world z.
const XZ: PlanarFrame = { origin: [0, 0, 0], x: [1, 0, 0], normal: [0, -1, 0] };

function prism(
  feature: string,
  curves: PlanarCurve[],
  frame: PlanarFrame,
  vector: Vec3,
): NamedShape {
  const { faces } = kernel.planarFaces(curves, frame, 1e-7);
  const [face, ...rest] = faces;
  if (!face || rest.length > 0) throw new Error('expected one face');
  const named = namedPrism(kernel, {
    shape: face.shape,
    edgeSources: face.edges.map((i) => `c${i}`),
    feature,
    vector,
  });
  kernel.release(face.shape);
  live.push(named.shape);
  return named;
}

const plate = () =>
  prism(
    'P',
    [
      { kind: 'line', a: [0, 0], b: [XS, 0] },
      // From the bottom chord end, counter-clockwise through x = 74 to the top one.
      {
        kind: 'arc',
        center: [CX, 20],
        radius: R,
        from: -Math.atan2(20, D),
        sweep: 2 * Math.atan2(20, D),
      },
      { kind: 'line', a: [XS, 40], b: [0, 40] },
      { kind: 'line', a: [0, 40], b: [0, 0] },
    ],
    XY,
    [0, 0, H],
  );

/** A quadrilateral in the xz plane through these (x, z) points, extruded along y 0…42. */
const tool = (feature: string, points: [number, number][]) =>
  prism(
    feature,
    points.map((a, i) => ({
      kind: 'line',
      a,
      b: points[(i + 1) % points.length] as [number, number],
    })),
    XZ,
    [0, 42, 0],
  );

// ∫ 2√(R² − u²) du and ∫ 2u√(R² − u²) du, u = x − CX.
const F0 = (u: number) => u * Math.sqrt(R * R - u * u) + R * R * Math.asin(u / R);
const F1 = (u: number) => (-2 / 3) * (R * R - u * u) ** 1.5;
/** ∫ chord(x)·(α + βx) dx from x = p to q, chord(x) the plate's width at x. */
const integral = (p: number, q: number, alpha: number, beta: number) =>
  (alpha + beta * CX) * (F0(q - CX) - F0(p - CX)) + beta * (F1(q - CX) - F1(p - CX));

const PLATE = H * (XS * 40 + R * R * Math.acos(D / R) - 20 * D);
/** The plate ∩ tool: the width times the height between z 3 and min(15, top). */
const OVERLAP = (() => {
  const slope = (T1 - T0) / (X1 - X0);
  const xc = X0 + (H - T0) / slope; // where the top crosses z 15
  return integral(X0, xc, H - 3, 0) + integral(xc, X1, T0 - slope * X0 - 3, slope);
})();

const volume = (s: NamedShape) => kernel.properties(s.shape).volume;
const close = (actual: number, expected: number) =>
  expect(Math.abs(actual - expected) / expected).toBeLessThan(1e-6);
const keep = (s: NamedShape) => {
  live.push(s.shape);
  return s;
};
const options = { feature: 'K', op: 'extrude' };
const solidCount = (s: NamedShape) => {
  const solids = kernel.solids(s.shape);
  kernel.release(...solids);
  return solids.length;
};

describe('a tool side along a rounded face', { timeout: 60_000 }, () => {
  it('cuts what the tool overlaps', () => {
    const p = plate();
    const t = tool('T', [
      [X0, 3],
      [X1, 3],
      [X1, T1],
      [X0, T0],
    ]);
    expect(volume(p)).toBeCloseTo(PLATE, 6);
    const cut = keep(namedBoolean(kernel, 'cut', p, t, options));
    close(volume(cut), PLATE - OVERLAP);
    expect(kernel.isValid(cut.shape)).toBe(true);
    // The plate's faces keep their names; the tool's walls inside it carry the tool's.
    const faces = new Set(cut.names.faces);
    expect(faces).toContain('extrude:P:cap:start');
    expect(faces).toContain('extrude:P:side:c1');
    expect([...faces].filter((n) => n.startsWith('extrude:T:'))).toEqual(
      expect.arrayContaining(['extrude:T:side:c0', 'extrude:T:side:c3']),
    );
    expect(cut.names.faces.length).toBe(kernel.count(cut.shape, 'face'));
    expect(cut.names.edges.length).toBe(kernel.count(cut.shape, 'edge'));
    expect(cut.names.edges.every((n) => n.length > 0)).toBe(true);
  });

  it('intersects and joins it too', () => {
    const p = plate();
    const t = tool('T', [
      [X0, 3],
      [X1, 3],
      [X1, T1],
      [X0, T0],
    ]);
    const common = keep(namedBoolean(kernel, 'common', p, t, options));
    close(volume(common), OVERLAP);
    expect(kernel.isValid(common.shape)).toBe(true);
    const fuse = keep(namedBoolean(kernel, 'fuse', p, t, options));
    close(volume(fuse), PLATE + volume(t) - OVERLAP);
    expect(solidCount(fuse)).toBe(1);
    expect(kernel.isValid(fuse.shape)).toBe(true);
  });

  it('cuts with a tool of two prisms, one of them along the rounded end', () => {
    // As an extrude of two profiles cuts: one boolean with both solids. The first
    // try cuts the ordinary one and misses the other.
    const p = plate();
    const t = tool('T', [
      [X0, 3],
      [X1, 3],
      [X1, T1],
      [X0, T0],
    ]);
    const other = tool('U', [
      [10, 3],
      [20, 3],
      [20, H],
      [10, H],
    ]);
    const both = kernel.compound([t.shape, other.shape]);
    live.push(both);
    const cut = kernel.cut(p.shape, both);
    live.push(cut.shape);
    close(kernel.properties(cut.shape).volume, PLATE - OVERLAP - 10 * 12 * 40);
    expect(kernel.isValid(cut.shape)).toBe(true);
  });

  it('removes nothing with a tool that only touches the rounded end from outside', () => {
    const p = plate();
    // Its near side on the tangent line x = 74, the rest beyond the plate.
    const t = tool('T', [
      [CX + R, 3],
      [86, 3],
      [86, H],
      [CX + R, H],
    ]);
    const cut = keep(namedBoolean(kernel, 'cut', p, t, options));
    close(volume(cut), PLATE);
    expect(kernel.isValid(cut.shape)).toBe(true);
    const common = keep(namedBoolean(kernel, 'common', p, t, options));
    expect(solidCount(common)).toBe(0);
  });
});
