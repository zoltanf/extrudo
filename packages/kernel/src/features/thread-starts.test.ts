// Multi-start threads (P4-12, ADR-0056's second amendment) through the
// recompute engine with real OCCT: `starts` helices, a lead of
// `starts × pitch`, one tooth per start, names with `s<j>.`, the limits.
import {
  CYLINDER_TYPE,
  type ExtrudoDocument,
  type Feature,
  type FeatureId,
  FeatureRegistry,
  type FeatureStatus,
  type GeomRef,
  primitiveInputs,
  THREAD_TYPE,
  type ThreadInputOptions,
  threadInputs,
} from '@extrudo/core';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Kernel, type ShapeHandle } from '../kernel';
import { loadOcct } from '../occt/load';
import { RecomputeEngine } from '../recompute/engine';
import { testDocument, testFeature, testFeatures } from '../recompute/testing';
import type { KernelFeatureDefinition, RecomputeResult } from '../recompute/types';
import { MAX_TURNS } from './thread';

let kernel: Kernel;
let engine: RecomputeEngine;

beforeAll(async () => {
  kernel = new Kernel(await loadOcct());
});

beforeEach(() => {
  engine?.clear();
  expect(kernel.stats().liveShapes).toBe(0);
  const registry = new FeatureRegistry<KernelFeatureDefinition>();
  for (const definition of testFeatures().registry.list()) registry.register(definition);
  engine = new RecomputeEngine(kernel, registry, { strictLeaks: true });
});

afterAll(() => {
  engine.clear();
  expect(kernel.stats().liveShapes).toBe(0);
});

const wall: GeomRef = { kind: 'face', id: 'cylinder:C:side:wall' };

function cylinder(diameter: number, height: number): Feature {
  return {
    ...testFeature('C', CYLINDER_TYPE),
    inputs: primitiveInputs('cylinder', {
      numbers: { diameter: `${diameter} mm`, height: `${height} mm` },
    }),
  };
}

const thread = (options: Partial<ThreadInputOptions>): Feature => ({
  ...testFeature('T', THREAD_TYPE),
  inputs: threadInputs({ faces: [wall], ...options }),
});

const M20 = { diameter: '20 mm', pitch: '2.5 mm' };

interface Result {
  status: FeatureStatus;
  volume: number;
  faces: number;
  names: string[];
  valid: boolean;
}

/** Computes a cylinder with a thread and measures body `C:0`. */
async function build(diameter: number, height: number, options: Partial<ThreadInputOptions>) {
  engine.clear();
  const doc: ExtrudoDocument = testDocument([cylinder(diameter, height), thread(options)]);
  const shapes: ShapeHandle[] = [];
  const mesh = kernel.mesh.bind(kernel);
  kernel.mesh = (shape, o) => {
    shapes.push(shape);
    return mesh(shape, o);
  };
  let result: RecomputeResult;
  try {
    result = await engine.recompute({ doc });
  } finally {
    kernel.mesh = mesh;
  }
  if (result.status !== 'done') throw new Error('cancelled');
  const status = result.features['T' as FeatureId] ?? { status: 'ok' };
  const index = result.bodies.findIndex((b) => b.id === 'C:0');
  const shape = shapes[index];
  if (status.status === 'error' || shape === undefined) {
    return { status, volume: 0, faces: 0, names: [], valid: false } satisfies Result;
  }
  return {
    status,
    volume: kernel.properties(shape).volume,
    faces: kernel.count(shape, 'face'),
    names: result.bodies[index]?.mesh?.faceIds ?? [],
    valid: kernel.isValid(shape),
  } satisfies Result;
}

const crests = (r: Result) => r.names.filter((n) => /\.crest(#\d+)?$/.test(n));
const removed = (r: Result, diameter: number, height: number) =>
  Math.PI * (diameter / 2) ** 2 * height - r.volume;

describe('multi-start threads', { timeout: 120_000 }, () => {
  it('cuts one helix per start, named per start', async () => {
    const one = await build(20, 20, { numbers: M20 });
    const two = await build(20, 20, { numbers: M20, starts: '2' });
    expect(one.status.status).toBe('ok');
    expect(two.status.status).toBe('ok');
    expect(two.valid).toBe(true);
    // Two helices of half the turns each: about as many crest faces in all
    // (a run of the tooth is one face per turn), each start with its own.
    const perStart = (r: Result, j: number) =>
      crests(r).filter((n) => n.startsWith(`thread:T:side:f0.s${j}.crest`)).length;
    expect(perStart(two, 0)).toBeGreaterThan(0);
    expect(perStart(two, 1)).toBeGreaterThan(0);
    expect(Math.abs(crests(two).length - crests(one).length)).toBeLessThanOrEqual(2);
    const bare = (names: string[]) => new Set(names.map((n) => n.replace(/#\d+$/, '')));
    expect(bare(two.names).has('thread:T:side:f0.s0.crest')).toBe(true);
    expect(bare(two.names).has('thread:T:side:f0.s1.crest')).toBe(true);
    expect(bare(two.names).has('thread:T:side:f0.crest')).toBe(false);
    expect(bare(one.names).has('thread:T:side:f0.crest')).toBe(true);
    console.log('faces', one.faces, two.faces, 'crests', crests(one).length, crests(two).length);
  });

  it('removes as much material as one start does, whatever the starts', async () => {
    const one = await build(20, 20, { numbers: M20 });
    const base = removed(one, 20, 20);
    const lines: string[] = [`1 start: ${base.toFixed(2)} mm³`];
    for (const starts of ['2', '3']) {
      const r = await build(20, 20, { numbers: M20, starts });
      expect(r.status.status).toBe('ok');
      expect(r.valid).toBe(true);
      const v = removed(r, 20, 20);
      lines.push(`${starts} starts: ${v.toFixed(2)} mm³ (${((v / base - 1) * 100).toFixed(2)} %)`);
      expect(Math.abs(v / base - 1)).toBeLessThan(0.02);
    }
    console.log(lines.join('; '));
  });

  it('computes a stored 1 exactly as no starts at all', async () => {
    const absent = await build(20, 20, { numbers: M20 });
    const stored = await build(20, 20, { numbers: M20, starts: '1' });
    expect(stored.volume).toBe(absent.volume);
    expect(stored.faces).toBe(absent.faces);
    expect(stored.names).toEqual(absent.names);
  });

  it.each(['0', '9', '2.5', '-1'])('refuses %s starts', async (starts) => {
    const r = await build(20, 20, { numbers: M20, starts });
    expect(r.status.status).toBe('error');
    expect(r.status.message).toBe('Starts must be a whole number from 1 to 8.');
  });

  it('counts MAX_TURNS per helix', async () => {
    const numbers = { diameter: '4 mm', pitch: '0.25 mm' };
    // 40 mm at 0.25 mm: 160 turns for one start, 80 for each of two.
    expect(40 / 0.25).toBeGreaterThan(MAX_TURNS);
    const one = await build(4, 40, { numbers });
    expect(one.status.status).toBe('error');
    expect(one.status.message).toContain('160 turns');
    const t0 = Date.now();
    const two = await build(4, 40, { numbers, starts: '2' });
    console.log(`2 starts × 80 turns: ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    expect(two.status.status).toBe('ok');
    expect(two.valid).toBe(true);
  });
});
