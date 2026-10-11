// The facade's pose proximity (P6-05 J3, ADR-0081's J3 amendment) against
// `closestPoints` on a transformed copy, with real OCCT and strict leaks: the
// hinge fixture and the ribbed hinge of the benchmark at random poses (apart,
// touching, overlapping and beyond the search distance), the points and faces
// it reports, no leak over 200 poses (with a leak control that must grow), and
// a cancelled check closing its sessions.
import type { BodyId, ExtrudoDocument, JointReport } from '@extrudo/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { kernelFeatures } from '../features';
import { compose, IDENTITY, type Matrix12, rotation, translation } from '../features/matrix';
import { Kernel, type ShapeHandle, type Vec3 } from '../kernel';
import { loadOcct } from '../occt/load';
import { RecomputeEngine } from '../recompute/engine';
import type { RecomputeResult } from '../recompute/types';
import { CancelledError, checkJoint, jointSearch } from './check';
import { HINGE, hingeDocument } from './testing';

let kernel: Kernel;
let engine: RecomputeEngine;

beforeAll(async () => {
  kernel = new Kernel(await loadOcct());
  engine = new RecomputeEngine(kernel, kernelFeatures(), { strictLeaks: true });
});

afterAll(() => {
  engine.clear();
  expect(kernel.stats().liveShapes).toBe(0);
  expect(kernel.proximitySessions()).toBe(0);
});

type Done = Extract<RecomputeResult, { status: 'done' }>;

const LEAF = 'LeafPlate:0' as BodyId;
const BASE = 'BasePlate:0' as BodyId;
const SEARCH = jointSearch(0.2);

async function hinge(doc: ExtrudoDocument = hingeDocument()) {
  const result = (await engine.recompute({ doc })) as Done;
  if (result.status !== 'done') throw new Error('cancelled');
  const report = result.joints?.[HINGE.id] as JointReport;
  return {
    report,
    leaf: engine.latestBody(LEAF) as ShapeHandle,
    base: engine.latestBody(BASE) as ShapeHandle,
  };
}

/** The benchmark's ribbed plate: 22 ribs fused across its top. Release it. */
function ribbed(shape: ShapeHandle, y0: number): ShapeHandle {
  using scope = kernel.scope();
  const ribs = [];
  for (let i = 0; i < 22; i++) {
    ribs.push(scope.track(kernel.box([0.8, 20, 1], [-19.5 + i * 1.8, y0, 4])));
  }
  const tool = scope.track(kernel.compound(ribs));
  return kernel.fuse(shape, tool).shape;
}

/** A small seeded generator (mulberry32), so a failure repeats. */
function random(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 50 poses: as built, turns about the hinge's axis (apart, and past 140° into
 * the base), turns with a small shift (touching and overlapping) and with a
 * large one (beyond the search distance).
 */
function poses(report: JointReport, seed: number): Matrix12[] {
  const next = random(seed);
  const { origin, direction } = report.axis as { origin: Vec3; direction: Vec3 };
  const out: Matrix12[] = [IDENTITY];
  for (let i = 1; i < 50; i++) {
    const turn = rotation(origin, direction, (next() * 2 - 1) * Math.PI);
    const kind = i % 5;
    if (kind <= 1) {
      out.push(turn);
      continue;
    }
    const dir: Vec3 = [next() * 2 - 1, next() * 2 - 1, next() * 2 - 1];
    const length = Math.hypot(...dir) || 1;
    const by = kind === 4 ? 12 + next() * 8 : next() * 1.5;
    out.push(compose(translation(dir.map((c) => (c / length) * by) as unknown as Vec3), turn));
  }
  return out;
}

const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** How far a point is from a shape (a 0.2 µm cube stands for the point). */
function offShape(shape: ShapeHandle, p: Vec3): number {
  using scope = kernel.scope();
  const h = 1e-7;
  const dot = scope.track(kernel.box([2 * h, 2 * h, 2 * h], [p[0] - h, p[1] - h, p[2] - h]));
  return kernel.distance(dot, shape);
}

/** Compares every pose with `closestPoints` on a moved copy; returns the counts seen. */
function compare(leaf: ShapeHandle, base: ShapeHandle, matrices: readonly Matrix12[]) {
  const seen = { contact: 0, apart: 0, beyond: 0, samePoints: 0 };
  using session = kernel.proximity(leaf, base, SEARCH);
  for (const [i, matrix] of matrices.entries()) {
    using scope = kernel.scope();
    const placed = scope.track(kernel.transform(leaf, matrix)).shape;
    const old = kernel.closestPoints(placed, base);
    const pose = session.pose(matrix);
    const where = `pose ${i}: old ${old.distance}, new ${pose.distance}`;
    if (old.distance >= SEARCH) {
      seen.beyond++;
      expect(pose.distance, where).toBe(SEARCH);
      expect(pose.from, where).toBeUndefined();
      continue;
    }
    expect(Math.abs(pose.distance - old.distance), where).toBeLessThan(1e-6);
    const from = pose.from as Vec3;
    const to = pose.to as Vec3;
    expect(from, where).toBeDefined();
    if (old.distance <= 1e-7) {
      seen.contact++;
      continue;
    }
    seen.apart++;
    // The points: as far apart as the distance, on the placed leaf and the base.
    expect(Math.abs(dist(from, to) - pose.distance), where).toBeLessThan(1e-6);
    expect(offShape(placed, from), where).toBeLessThan(1e-6);
    expect(offShape(base, to), where).toBeLessThan(1e-6);
    // The faces: the two the points are on, and as far apart as the distance.
    const [fa, fb] = pose.faces as [number, number];
    const faceA = scope.track(kernel.subShape(placed, 'face', fa));
    const faceB = scope.track(kernel.subShape(base, 'face', fb));
    expect(offShape(faceA, from), where).toBeLessThan(1e-6);
    expect(offShape(faceB, to), where).toBeLessThan(1e-6);
    expect(Math.abs(kernel.distance(faceA, faceB) - pose.distance), where).toBeLessThan(1e-6);
    // Where the minimum is unique the points are closestPoints' own: where
    // they differ, both are minima (checked above), so it isn't unique (the
    // pin in its hole is a whole cylinder of them).
    if (dist(from, old.from) < 1e-6 && dist(to, old.to) < 1e-6) seen.samePoints++;
  }
  return seen;
}

describe('pose proximity', { timeout: 300_000 }, () => {
  it('equals closestPoints on a moved copy at 50 poses of the hinge fixture', async () => {
    const { report, leaf, base } = await hinge();
    const seen = compare(leaf, base, poses(report, 1));
    expect(seen.contact).toBeGreaterThan(0);
    expect(seen.apart).toBeGreaterThan(0);
    expect(seen.beyond).toBeGreaterThan(0);
    expect(seen.samePoints).toBeGreaterThan(0);
  });

  it('equals closestPoints at 50 poses of the ribbed hinge', async () => {
    const { report, leaf, base } = await hinge();
    const busyLeaf = ribbed(leaf, 5.5);
    const busyBase = ribbed(base, -25.5);
    try {
      const seen = compare(busyLeaf, busyBase, poses(report, 2));
      expect(seen.contact).toBeGreaterThan(0);
      expect(seen.apart).toBeGreaterThan(0);
      expect(seen.beyond).toBeGreaterThan(0);
    } finally {
      kernel.release(busyLeaf, busyBase);
    }
  });

  it('touching exactly: the pin with no clearance', async () => {
    const doc = hingeDocument();
    const touching: ExtrudoDocument = {
      ...doc,
      parameters: doc.parameters.map((p) =>
        p.name === 'clearance' ? { ...p, expression: '0 mm' } : p,
      ),
    };
    const { report, leaf, base } = await hinge(touching);
    const seen = compare(leaf, base, poses(report, 3).slice(0, 20));
    expect(seen.contact).toBeGreaterThan(0);
  });

  it('a solid inside another is at 0', async () => {
    using scope = kernel.scope();
    const big = scope.track(kernel.box([40, 40, 40], [-20, -20, -20]));
    const small = scope.track(kernel.box([2, 2, 2], [-1, -1, -1]));
    using session = kernel.proximity(small, big, 5);
    expect(session.pose(IDENTITY).distance).toBe(0);
    expect(session.pose(translation([5, 0, 0])).distance).toBe(0);
    expect(session.pose(translation([16, 0, 0])).distance).toBe(0);
    expect(session.pose(translation([20, 0, 0])).distance).toBeCloseTo(0, 9);
    expect(session.pose(translation([22, 0, 0])).distance).toBeCloseTo(1, 9);
    expect(session.pose(translation([60, 0, 0])).distance).toBe(5);
    using inverse = kernel.proximity(big, small, 5);
    expect(inverse.pose(translation([1, 2, 3])).distance).toBe(0);
  });

  it('open, 200 poses, close leaves the shapes and the heap as they were', async () => {
    // A kernel of its own, so the heap's top moves as soon as its small slack
    // is used up (the memory test's way: a leak-free loop plateaus after the
    // warm-up, a leak moves it steadily).
    const own = new Kernel(await loadOcct());
    const ownEngine = new RecomputeEngine(own, kernelFeatures(), { strictLeaks: true });
    try {
      const result = (await ownEngine.recompute({ doc: hingeDocument() })) as Done;
      const report = result.joints?.[HINGE.id] as JointReport;
      const leaf = ownEngine.latestBody(LEAF) as ShapeHandle;
      const base = ownEngine.latestBody(BASE) as ShapeHandle;
      const matrices = [...poses(report, 4), ...poses(report, 5), ...poses(report, 6)];
      const at = (i: number) => matrices[i % matrices.length] as Matrix12;
      const round = (count: number) => {
        using session = own.proximity(leaf, base, SEARCH);
        for (let i = 0; i < count; i++) session.pose(at(i));
      };
      const SESSIONS = 120;
      const LIMIT = 1 << 20;
      for (let i = 0; i < 3; i++) round(200);
      const before = own.stats();
      round(200);
      for (let i = 0; i < SESSIONS; i++) round(1);
      const after = own.stats();
      expect(after.liveShapes).toBe(before.liveShapes);
      expect(own.proximitySessions()).toBe(0);
      expect(after.heapTop - before.heapTop).toBeLessThan(LIMIT);

      // The leak control: the same sessions left open must move the top.
      const leaked = [];
      for (let i = 0; i < SESSIONS; i++) {
        const session = own.proximity(leaf, base, SEARCH);
        session.pose(at(i));
        leaked.push(session);
      }
      expect(own.proximitySessions()).toBe(SESSIONS);
      expect(own.stats().heapTop - after.heapTop).toBeGreaterThan(LIMIT);
      for (const session of leaked) session.close();
      expect(own.proximitySessions()).toBe(0);
    } finally {
      ownEngine.clear();
    }
  });

  it('a cancelled check closes its sessions', async () => {
    const { report, leaf, base } = await hinge();
    let calls = 0;
    const stop = async () => ++calls < 10;
    await expect(
      checkJoint(
        kernel,
        new Map([
          [LEAF, leaf],
          [BASE, base],
        ]),
        report,
        { joint: HINGE, moving: [LEAF], others: [BASE], range: { min: 0, max: 180 }, minGap: 0.2 },
        stop,
      ),
    ).rejects.toBeInstanceOf(CancelledError);
    expect(calls).toBe(10);
    expect(kernel.proximitySessions()).toBe(0);
  });
});
