// The emboss facade methods of ADR-0060's second amendment (P4-12, slice S2):
// faceHit (the anchor of "tangent to the face"), faceSlab (what a moved or
// wrapped piece of a several-face emboss is cut to) and projectOnFace's clip.
// Real OCCT in Node, the numbers of the native harness
// (`spikes/p4-12-emboss-faces`, section 6), and no shape left behind by any
// case.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { type HistoryRecord, Kernel, type ShapeHandle, type Vec3 } from './index';
import { loadOcct } from './occt/load';
import type { PlanarCurve, PlanarFrame, Vec2 } from './planar';

let kernel: Kernel;
/** Everything a case made, released after it. */
let made: ShapeHandle[] = [];

beforeAll(async () => {
  kernel = new Kernel(await loadOcct());
});

afterEach(() => {
  kernel.release(...made);
  made = [];
  expect(kernel.stats().liveShapes).toBe(0);
});

afterAll(() => {
  expect(kernel.stats().liveShapes).toBe(0);
});

const R = 20;
const ALPHA = (20 * Math.PI) / 180;

function keep<T extends ShapeHandle>(shape: T): T {
  made.push(shape);
  return shape;
}

/** The faces of `shape` whose surface is `type`, by index. */
function facesOf(shape: ShapeHandle, type: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < kernel.count(shape, 'face'); i++) {
    if (kernel.surfaceGeometry(shape, i).type === type) out.push(i);
  }
  return out;
}

/** The flat face of `shape` whose outward normal is `normal`, at `normal · x = at`. */
function flatFace(shape: ShapeHandle, normal: Vec3, at: number): number {
  const found = facesOf(shape, 'plane').find((i) => {
    const { origin, direction } = kernel.surfaceGeometry(shape, i);
    if (!origin || !direction) return false;
    const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    return dot(direction, normal) > 1 - 1e-9 && Math.abs(dot(origin, normal) - at) < 1e-9;
  });
  if (found === undefined) throw new Error('no such face');
  return found;
}

function lines(...corners: Vec2[]): PlanarCurve[] {
  return corners.map(
    (a, i) => ({ kind: 'line', a, b: corners[(i + 1) % corners.length] }) as PlanarCurve,
  );
}

/** The one face `curves` bound in `frame`. */
function profile(curves: PlanarCurve[], frame: PlanarFrame): ShapeHandle {
  const { faces } = kernel.planarFaces(curves, frame, 1e-6);
  for (const f of faces) keep(f.shape);
  expect(faces).toHaveLength(1);
  return (faces[0] as { shape: ShapeHandle }).shape;
}

/** The plane z = at, X along world X. */
const atZ = (at: number): PlanarFrame => ({ origin: [0, 0, at], x: [1, 0, 0], normal: [0, 0, 1] });
/** The plane y = 0, its X along world X and its Y along world Z. */
const XZ: PlanarFrame = { origin: [0, 0, 0], x: [1, 0, 0], normal: [0, -1, 0] };
const Z_AXIS = { origin: [0, 0, 0] as Vec3, direction: [0, 0, 1] as Vec3 };

/** A shape turned a whole way round Z from a profile in the XZ plane. */
function turned(curves: PlanarCurve[]): ShapeHandle {
  return keep(kernel.revolve(profile(curves, XZ), Z_AXIS, 2 * Math.PI).shape);
}

const box = () => keep(kernel.box([40, 40, 10]));
const cylinder = () => keep(kernel.cylinder(R, 10));
/** The frustum of the 20° cone through radius 20 at z = 0, from z = -8 to 8. */
const R0 = R - 8 * Math.tan(ALPHA);
const R1 = R + 8 * Math.tan(ALPHA);
const cone = () => turned(lines([0, -8], [R0, -8], [R1, 8], [0, 8]));
/** The Sphere primitive's shape: a half disc turned about Z. */
const ball = () =>
  turned([
    { kind: 'arc', center: [0, 0], radius: R, from: -Math.PI / 2, sweep: Math.PI },
    { kind: 'line', a: [0, R], b: [0, -R] },
  ]);

function volume(shape: ShapeHandle): number {
  return kernel.measure(shape).volume;
}

/** How far `got` is from `want`, relative. */
function off(got: number, want: number): number {
  return Math.abs(got / want - 1);
}

/** The records of one relation. */
function records(history: HistoryRecord[], relation: HistoryRecord['relation']): HistoryRecord[] {
  return history.filter((r) => r.relation === relation);
}

function expectNear(got: Vec3, want: Vec3) {
  for (let k = 0; k < 3; k++)
    expect(Math.abs((got[k] as number) - (want[k] as number))).toBeLessThan(1e-9);
}

/** The column of radius `a` between two concentric spheres of radii r0 < r1. */
function column(a: number, r0: number, r1: number): number {
  const cap = (r: number) => ((2 * Math.PI) / 3) * (r ** 3 - (r * r - a * a) ** 1.5);
  return cap(r1) - cap(r0);
}

describe('faceHit', () => {
  it('a plane: the hit and its normal, whichever way the line points', () => {
    const b = box();
    const top = flatFace(b, [0, 0, 1], 10);
    for (const d of [
      [0, 0, 1],
      [0, 0, -1],
    ] as Vec3[]) {
      const hit = kernel.faceHit(b, top, [5, 5, 30], d);
      expect(hit).toBeDefined();
      expectNear(hit?.point ?? [0, 0, 0], [5, 5, 10]);
      expectNear(hit?.normal ?? [0, 0, 0], [0, 0, 1]);
    }
  });

  it('a cylinder: the nearer of the two hits, ahead or behind, and a tie the way d points', () => {
    const c = cylinder();
    const [side] = facesOf(c, 'cylinder') as [number];
    const cases: [Vec3, Vec3, Vec3, Vec3][] = [
      [
        [0, 25, 5],
        [0, -1, 0],
        [0, 20, 5],
        [0, 1, 0],
      ],
      [
        [0, 25, 5],
        [0, 1, 0],
        [0, 20, 5],
        [0, 1, 0],
      ],
      [
        [0, -15, 5],
        [0, 1, 0],
        [0, -20, 5],
        [0, -1, 0],
      ],
      [
        [0, 0, 5],
        [0, 1, 0],
        [0, 20, 5],
        [0, 1, 0],
      ],
      [
        [0, 0, 5],
        [0, -1, 0],
        [0, -20, 5],
        [0, -1, 0],
      ],
    ];
    for (const [p, d, point, normal] of cases) {
      const hit = kernel.faceHit(c, side, p, d);
      expectNear(hit?.point ?? [0, 0, 0], point);
      expectNear(hit?.normal ?? [0, 0, 0], normal);
    }
  });

  it("a sphere's pole: the normal from the second derivatives", () => {
    const s = ball();
    const [face] = facesOf(s, 'sphere') as [number];
    const hit = kernel.faceHit(s, face, [0, 0, 30], [0, 0, -1]);
    expectNear(hit?.point ?? [0, 0, 0], [0, 0, R]);
    expectNear(hit?.normal ?? [0, 0, 0], [0, 0, 1]);
  });

  it('a miss is undefined, not a throw; so is a line past the bounded face', () => {
    const c = cylinder();
    const [side] = facesOf(c, 'cylinder') as [number];
    expect(kernel.faceHit(c, side, [100, 100, 5], [0, 0, 1])).toBeUndefined();
    const b = box();
    expect(kernel.faceHit(b, flatFace(b, [0, 0, 1], 10), [50, 50, 30], [0, 0, 1])).toBeUndefined();
  });
});

describe('faceSlab', () => {
  it('a plane face: area × depth, the copy first, the offset last, a wall per edge', () => {
    for (const outward of [true, false]) {
      const b = box();
      const top = flatFace(b, [0, 0, 1], 10);
      const slab = kernel.faceSlab(b, top, 1, outward);
      keep(slab.shape);
      expect(kernel.isValid(slab.shape)).toBe(true);
      expect(off(volume(slab.shape), 1600)).toBeLessThan(1e-9);
      expect(kernel.count(slab.shape, 'face')).toBe(6);
      const first = records(slab.history, 'first');
      const last = records(slab.history, 'last');
      expect(first.map((r) => r.from)).toEqual([{ kind: 'face', index: top }]);
      expect(last.map((r) => r.from)).toEqual([{ kind: 'face', index: top }]);
      const walls = records(slab.history, 'generated');
      expect(walls).toHaveLength(4);
      expect(walls.every((r) => r.from.kind === 'edge' && r.to.length === 1)).toBe(true);
      const named = [...first, ...last, ...walls].map((r) => r.to[0]?.index);
      expect(new Set(named).size).toBe(6);
    }
  });

  it('a cylinder face: A d (R ± d/2) / R', () => {
    for (const outward of [true, false]) {
      const c = cylinder();
      const [side] = facesOf(c, 'cylinder') as [number];
      const slab = keep(kernel.faceSlab(c, side, 1, outward).shape);
      expect(kernel.isValid(slab)).toBe(true);
      const want = (2 * Math.PI * R * 10 * (R + (outward ? 0.5 : -0.5))) / R;
      expect(off(volume(slab), want)).toBeLessThan(1e-9);
    }
  });

  it("a cone face: the frustum side's slab (Pappus), and a wrap common it is the wrap", () => {
    for (const outward of [true, false]) {
      const k = cone();
      const [side] = facesOf(k, 'cone') as [number];
      const slab = keep(kernel.faceSlab(k, side, 1, outward).shape);
      expect(kernel.isValid(slab)).toBe(true);
      const slant = 16 / Math.cos(ALPHA);
      const want =
        2 * Math.PI * slant * ((R0 + R1) / 2 + ((outward ? 1 : -1) * Math.cos(ALPHA)) / 2);
      expect(off(volume(slab), want)).toBeLessThan(1e-9);
    }
  });

  it('refuses a depth of 0', () => {
    const b = box();
    expect(() => kernel.faceSlab(b, 0, 0)).toThrow(/depth/);
  });
});

describe('projectOnFace with clip', () => {
  it('stops a rectangle that overhangs a flat face at its edge; without clip it is refused', () => {
    for (const outward of [true, false]) {
      const b = box();
      const top = flatFace(b, [0, 0, 1], 10);
      const rect = profile(lines([30, 10], [50, 10], [50, 20], [30, 20]), atZ(30));
      const piece = kernel.projectOnFace(rect, b, top, 1, outward, true);
      keep(piece.shape);
      expect(kernel.isValid(piece.shape)).toBe(true);
      expect(off(volume(piece.shape), 100)).toBeLessThan(1e-9);
      expect(kernel.count(piece.shape, 'face')).toBe(6);
      // The wall past the face's edge is the slab's, so it has no record.
      expect(records(piece.history, 'generated')).toHaveLength(3);
      expect(() => kernel.projectOnFace(rect, b, top, 1, outward)).toThrow(/edge/);
    }
  });

  it('changes nothing on the Sphere primitive: 28.4274498, as without it', () => {
    for (const outward of [true, false]) {
      const s = ball();
      const [face] = facesOf(s, 'sphere') as [number];
      const circle = profile(
        [{ kind: 'arc', center: [0, 0], radius: 3, from: 0, sweep: 2 * Math.PI }],
        atZ(30),
      );
      const plain = keep(kernel.projectOnFace(circle, s, face, 1, outward).shape);
      const clipped = keep(kernel.projectOnFace(circle, s, face, 1, outward, true).shape);
      expect(volume(clipped)).toBe(volume(plain));
      expect(kernel.count(clipped, 'face')).toBe(kernel.count(plain, 'face'));
      const want = outward ? column(3, R, R + 1) : column(3, R - 1, R);
      // Measure integrates to a looser tolerance than the harness (1e-12): 1.5e-9 here.
      expect(off(volume(clipped), want)).toBeLessThan(1e-8);
    }
  });
});
