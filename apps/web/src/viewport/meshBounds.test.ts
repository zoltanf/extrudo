/**
 * Each mesh's bounds worked out once (ADR-0102 §9): the same numbers as walking every node each
 * time, bit for bit, and one walk per positions array.
 */
import type { BodyMesh } from '@extrudo/kernel';
import { Box3, Sphere } from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { boundsOf } from './bodyGeometry';
import { meshSize } from './meshBounds';

const mesh = (positions: ArrayLike<number> & object): BodyMesh =>
  ({ positions, faceRanges: new Uint32Array() }) as unknown as BodyMesh;

/** `boundsOf` as it was: every node of every mesh walked on every call. */
function walkedBounds(meshes: readonly BodyMesh[]) {
  const box = new Box3();
  for (const m of meshes) {
    if (m.positions.length >= 3) box.union(new Box3().setFromArray(m.positions));
  }
  if (box.isEmpty()) return undefined;
  const sphere = box.getBoundingSphere(new Sphere());
  return {
    center: [sphere.center.x, sphere.center.y, sphere.center.z],
    radius: sphere.radius,
    box: { min: box.min.toArray(), max: box.max.toArray() },
  };
}

/** `data-bodies`' size as it was. */
function walkedSize(p: ArrayLike<number>) {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i++) {
    const k = i % 3;
    const v = p[i] ?? 0;
    if (v < (lo[k] ?? 0)) lo[k] = v;
    if (v > (hi[k] ?? 0)) hi[k] = v;
  }
  return [0, 1, 2].map((k) => Math.round(((hi[k] ?? 0) - (lo[k] ?? 0)) * 10) / 10 + 0).join(',');
}

/** Every number as its bits, so `-0` and `0`, and NaNs, are told apart. */
const bits = (value: unknown): unknown => {
  if (typeof value === 'number') {
    const view = new DataView(new ArrayBuffer(8));
    view.setFloat64(0, value);
    return view.getBigUint64(0).toString(16);
  }
  if (Array.isArray(value)) return value.map(bits);
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, bits(v)]));
  return value;
};

/** A seeded generator (mulberry32): the same meshes on every run. */
function random(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function cases(): (ArrayLike<number> & object)[] {
  const r = random(7);
  const big = (n: number, scale: number, shift: number) =>
    new Float32Array(Array.from({ length: 3 * n }, () => (r() - 0.5) * scale + shift));
  return [
    new Float32Array(),
    new Float32Array([1, 2]),
    new Float32Array([3, -4, 5]),
    new Float32Array([1, 1, 1, 1, 1, 1, 1, 1, 1]),
    new Float32Array([0, 0, 0, 10, 0, 0, 0, 20, 0]),
    new Float32Array([-0, -0, -0, -0, 5, -0]),
    new Float32Array([0, -0, 0, -0, 0, -0]),
    new Float32Array([Number.NaN, 1, 2, 3, Number.NaN, 4, 5, 6, Number.NaN]),
    new Float32Array([1, 2, 3, 4]),
    new Float32Array([Infinity, -Infinity, 0, 1, 2, 3]),
    new Float64Array([0.05, 0.15, 0.25, -0.05, -0.15, -0.25]),
    big(1, 1e6, 0),
    big(500, 100, 0),
    big(500, 0.001, 1e5),
    big(2000, 1e4, -3e4),
  ];
}

afterEach(() => vi.restoreAllMocks());

describe('meshBounds (ADR-0102 §9)', () => {
  it('gives the bounds and sizes walking every node gave, bit for bit, cached or not', () => {
    const all = cases();
    for (const positions of all) {
      for (let pass = 0; pass < 2; pass++) {
        expect(bits(boundsOf([mesh(positions)]))).toEqual(bits(walkedBounds([mesh(positions)])));
        expect(meshSize(positions)).toBe(walkedSize(positions));
      }
    }
    // Every case together, and in another order: the union is the same either way.
    const meshes = all.map(mesh);
    expect(bits(boundsOf(meshes))).toEqual(bits(walkedBounds(meshes)));
    expect(bits(boundsOf([...meshes].reverse()))).toEqual(
      bits(walkedBounds([...meshes].reverse())),
    );
    expect(boundsOf([])).toBeUndefined();
    expect(boundsOf([mesh(new Float32Array()), mesh(new Float32Array([1, 2]))])).toBeUndefined();
  });

  it('walks a mesh once: a change of one body among 20 walks that body alone', () => {
    // A positions array that counts the walks over it (each walk reads its first number once).
    let walks = 0;
    const counted = (positions: Float32Array) =>
      new Proxy(positions, {
        get(target, key) {
          if (key === '0') walks++;
          const value = Reflect.get(target, key, target);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
    const r = random(3);
    const plate = () => counted(new Float32Array(Array.from({ length: 300 }, () => r() * 50)));
    const bodies = Array.from({ length: 20 }, plate);
    const bounds = boundsOf(bodies.map(mesh));
    for (const p of bodies) meshSize(p);
    expect(walks).toBe(40);
    walks = 0;
    // The same arrays again, in new mesh objects (as a new list of bodies brings them): no walk.
    expect(boundsOf(bodies.map(mesh))).toEqual(bounds);
    for (const p of bodies) meshSize(p);
    expect(walks).toBe(0);
    // One body changes: its new array is walked, once for the box and once for the size.
    bodies[7] = plate();
    boundsOf(bodies.map(mesh));
    for (const p of bodies) meshSize(p);
    expect(walks).toBe(2);
  });
});
