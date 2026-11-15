/**
 * The reals of the STEP text the B-rep writer makes (`stepReal`): the exponent
 * form gets its decimal point, everything else prints as it did, and a body
 * with a coordinate that once printed as `1e-7` comes out of the kernel where
 * it should. Synthetic numbers and a hand-built box only.
 */
import { Kernel } from '@extrudo/kernel';
import { loadOcct } from '@extrudo/kernel/node';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AsmBodyEdge, AsmBodyFace, AsmBodyLoop, AsmBodySolid } from './asm-body';
import { solidStep, solidToStep, stepReal, UnsupportedGeometry } from './brep-step';

type V = [number, number, number];

/** The writer's form before 2026-11-15, the reference for every value it already wrote well. */
function oldReal(v: number): string {
  return Number.isFinite(v) ? Number.parseFloat(v.toPrecision(9)).toString() : '0';
}

/** A STEP real (digits, a point, an optional `E` exponent), or an integer, which the reader takes as a real. */
const SYNTAX = /^-?(\d+|\d+\.\d*(E-?\d+)?)$/;

/** A small seeded generator (mulberry32), so a failure can be replayed. */
function random(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('stepReal', () => {
  it('writes the exponent form with a point and a capital E, and the rest as before', () => {
    const cases: [number, string][] = [
      [0, '0'],
      [-0, '0'],
      [1, '1'],
      [-7, '-7'],
      [10, '10'],
      [123456, '123456'],
      [0.5, '0.5'],
      [0.000001, '0.000001'],
      [1e-7, '1.E-7'],
      [-1e-7, '-1.E-7'],
      [1.5e-10, '1.5E-10'],
      [1e21, '1.E21'],
      [-2.5e22, '-2.5E22'],
      [123456789012345680000, '123456789000000000000'],
      [5e-324, '5.E-324'],
      [Number.MAX_VALUE, '1.79769313E308'],
      [1 / 3, '0.333333333'],
    ];
    for (const [v, text] of cases) expect([v, stepReal(v)]).toEqual([v, text]);
  });

  it('matches the syntax and reads back as the nine-digit double it writes, over a spread of values', () => {
    const next = random(20261115);
    const values = [0, -0, 5e-324, -5e-324, Number.MAX_VALUE, -Number.MAX_VALUE, 1e21, 1e-7];
    for (let i = 0; i < 20000; i++) {
      const magnitude = 10 ** (Math.floor(next() * 680) - 340);
      const sign = next() < 0.5 ? -1 : 1;
      values.push(sign * next() * magnitude);
      values.push(Math.round(sign * next() * 10 ** Math.floor(next() * 25)));
      values.push(sign * (Math.floor(next() * 200000) / 1000));
    }
    let exponents = 0;
    for (const v of values) {
      if (!Number.isFinite(v)) continue;
      const text = stepReal(v);
      expect(text).toMatch(SYNTAX);
      expect(Number(text)).toBe(Number.parseFloat(v.toPrecision(9)) || 0);
      const before = oldReal(v);
      if (before.includes('e')) exponents++;
      // What was written without an exponent is written the same, byte for byte.
      else expect(text).toBe(before);
    }
    expect(exponents).toBeGreaterThan(1000);
  });

  it('refuses a number that is not finite, and the body with it', () => {
    for (const v of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])
      expect(() => stepReal(v)).toThrow(UnsupportedGeometry);
    expect(solidStep(box(1, [Number.NaN, 0, 0]))).toEqual({
      reason: 'unsupported geometry (a number that is not finite)',
    });
  });
});

/** A box of side `size` cm at `at`, as the writer reads a solid. */
function box(size: number, at: V = [0, 0, 0]): AsmBodySolid {
  const p = (x: number, y: number, z: number): V => [
    x * size + at[0],
    y * size + at[1],
    z * size + at[2],
  ];
  const [V0, V1, V2, V3, V4, V5, V6, V7] = [
    p(0, 0, 0),
    p(1, 0, 0),
    p(1, 1, 0),
    p(0, 1, 0),
    p(0, 0, 1),
    p(1, 0, 1),
    p(1, 1, 1),
    p(0, 1, 1),
  ] as V[] as [V, V, V, V, V, V, V, V];
  const edges = new Map<string, AsmBodyEdge>();
  const edge = (a: V, b: V): AsmBodyEdge => {
    const key = [a.join(','), b.join(',')].sort().join('|');
    let e = edges.get(key);
    if (!e) {
      const direction: V = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      e = {
        id: edges.size,
        curve: { kind: 'line', point: a, direction },
        start: a,
        end: b,
        reversed: false,
      };
      edges.set(key, e);
    }
    return e;
  };
  const quad = (...q: V[]): AsmBodyLoop => ({
    outer: true,
    coedges: q.map((u, i) => {
      const e = edge(u, q[(i + 1) % q.length] as V);
      return { forward: e.start === u, edge: e };
    }),
  });
  const face = (point: V, normal: V, loop: AsmBodyLoop): AsmBodyFace => ({
    surface: { kind: 'plane', point, normal },
    reversed: false,
    loops: [loop],
  });
  return {
    faces: [
      face(V0, [0, 0, -1], quad(V0, V3, V2, V1)),
      face(V4, [0, 0, 1], quad(V4, V5, V6, V7)),
      face(V0, [0, -1, 0], quad(V0, V1, V5, V4)),
      face(V3, [0, 1, 0], quad(V3, V7, V6, V2)),
      face(V0, [-1, 0, 0], quad(V0, V4, V7, V3)),
      face(V1, [1, 0, 0], quad(V1, V2, V6, V5)),
    ],
  };
}

describe('a small coordinate through the kernel', () => {
  let kernel: Kernel;
  beforeAll(async () => {
    kernel = new Kernel(await loadOcct());
  });
  afterAll(() => {
    kernel.dispose();
  });

  it('puts a box whose corner is 1e-7 mm off the origin there, not at the origin', () => {
    // 1e-8 cm is 1e-7 mm: written `1e-7` before, which the reader took as 0.
    const step = solidToStep(box(1, [1e-8, 1e-8, 1e-8]));
    expect(step).toContain("CARTESIAN_POINT('',(1.E-7,1.E-7,1.E-7))");
    const shape = kernel.readStep(step);
    const { volume, bbox } = kernel.properties(shape);
    kernel.release(shape);
    expect(volume).toBeCloseTo(1000, 6);
    for (const v of bbox.min) expect(v).toBeCloseTo(1e-7, 10);
    for (const v of bbox.max) expect(v).toBeCloseTo(10.0000001, 8);
  });
});
