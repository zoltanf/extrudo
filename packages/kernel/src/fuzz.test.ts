// Robustness fuzzing (P3-13): random parameter, dimension and feature
// expression changes on the benchmark fixtures (`fixtures/benchmarks/`),
// recomputed headless with the real kernel, as the app would: a change that
// moves sketch geometry is solved first (the sketch host's `apply`), and a
// solve that fails or collapses a curve refuses the change. The engine keeps
// its cache between steps like the app's `Recomputer` and runs with
// `strictLeaks`. Errors on features are allowed (a 0 mm extrude is one);
// what fails the test is a crash (an exception out of the engine, a WASM
// abort), an "Internal error" (an evaluator threw something that isn't a
// `KernelError`), a leaked shape, a step that takes too long, or a warm
// result that differs from a cold recompute of the same document.
//
// The seed is fixed, so a failure reproduces. `FUZZ_STEPS=2000 pnpm vitest
// run packages/kernel/src/fuzz.test.ts` runs longer; `FUZZ_SEED` picks
// another sequence.
import {
  applyCommand,
  type DimensionId,
  dimensionUnit,
  type ExtrudoDocument,
  evaluateParameters,
  type Feature,
  type FeatureId,
  type FeatureInputs,
  loadDocument,
  moveTimelineMarker,
  type ParameterEvaluation,
  projectionSync,
  readSketch,
  type SketchData,
  type SketchEntityId,
  type SketchReport,
  setFeatureSuppressed,
  setSketchGeometry,
  syncProjections,
  updateFeatureInputs,
  updateParameter,
  updateSketchDimension,
} from '@extrudo/core';
import { loadPlanegcs, type SketchSolution, SketchSolver } from '@extrudo/sketch';
import { solveGradually } from '@extrudo/sketch/inference';
import { strFromU8, unzipSync } from 'fflate';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import b1 from '../../../fixtures/benchmarks/b1-plate.extrudo?url&inline';
import b2 from '../../../fixtures/benchmarks/b2-storage-box.extrudo?url&inline';
import b3 from '../../../fixtures/benchmarks/b3-phone-stand.extrudo?url&inline';
import b4 from '../../../fixtures/benchmarks/b4-box-with-lid.extrudo?url&inline';
import b5 from '../../../fixtures/benchmarks/b5-pcb-enclosure.extrudo?url&inline';
import b6 from '../../../fixtures/benchmarks/b6-wall-hook.extrudo?url&inline';
import b7 from '../../../fixtures/benchmarks/b7-knurled-knob.extrudo?url&inline';
import { kernelFeatures } from './features';
import { Kernel } from './kernel';
import { loadOcct } from './occt/load';
import { RecomputeEngine } from './recompute/engine';
import type { RecomputeResult } from './recompute/types';

// The kernel's tsconfig has no Node types; Vitest runs in Node all the same.
const env =
  (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const STEPS = Number(env.FUZZ_STEPS ?? 200);
const SEED = Number(env.FUZZ_SEED ?? 20260930);
/** Longest a single recompute may take before it counts as a hang. */
const STEP_LIMIT_MS = 20_000;
/** Every so many steps the warm result is compared with a cold recompute. */
const COMPARE_EVERY = 10;

/** mulberry32: a small seeded PRNG, so a failing sequence can be replayed. */
function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function bytesOf(dataUrl: string): Uint8Array {
  const binary = atob(dataUrl.slice(dataUrl.indexOf(',') + 1));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

function load(dataUrl: string): ExtrudoDocument {
  const json = unzipSync(bytesOf(dataUrl))['document.json'];
  if (!json) throw new Error('no document.json');
  return loadDocument(JSON.parse(strFromU8(json))).doc;
}

/**
 * Factors a value is scaled by: mostly plausible edits, then the edges a
 * user reaches by typing (zero, negative, tiny, huge).
 */
const FACTORS = [0.5, 0.8, 0.9, 1.1, 1.25, 1.5, 2, 3, 0, -1, -0.5, 1e-4, 0.01, 10, 100, 1e4];

type Mutation =
  | { kind: 'parameter'; name: string; expr: string }
  | { kind: 'dimension'; feature: FeatureId; id: DimensionId; expr: string }
  | { kind: 'input'; feature: FeatureId; input: string; expr: string }
  | { kind: 'suppress'; feature: FeatureId; suppressed: boolean }
  | { kind: 'marker'; index: number };

/** The places an expression can be changed, with the fixture's original text. */
interface Target {
  mutate(factor: string): Mutation;
}

function targetsOf(doc: ExtrudoDocument): Target[] {
  const targets: Target[] = [];
  // The document's parameters are the user's; model parameters (d1…) are the inputs and dimensions below.
  for (const p of doc.parameters) {
    targets.push({
      mutate: (f) => ({ kind: 'parameter', name: p.name, expr: `(${p.expression}) * ${f}` }),
    });
  }
  for (const feature of doc.features) {
    const view = readSketch(feature);
    for (const [id, d] of Object.entries(view?.data.dimensions ?? {})) {
      if (d.driven) continue;
      targets.push({
        mutate: (f) => ({
          kind: 'dimension',
          feature: feature.id,
          id: id as DimensionId,
          expr: `(${d.expr}) * ${f}`,
        }),
      });
    }
    for (const [input, value] of Object.entries(feature.inputs)) {
      if (value.kind !== 'expr') continue;
      targets.push({
        mutate: (f) => ({
          kind: 'input',
          feature: feature.id,
          input,
          expr: `(${value.expr}) * ${f}`,
        }),
      });
    }
  }
  return targets;
}

/** The solver values of a sketch's driving dimensions (the app's `dimensionValues`). */
function dimensionValues(
  data: SketchData,
  evaluation: ParameterEvaluation,
  feature: FeatureId,
): Record<string, number> {
  const known = evaluation.dimensions.get(feature);
  const values: Record<string, number> = {};
  for (const [id, d] of Object.entries(data.dimensions)) {
    if (d.driven) continue;
    const result = known?.get(id) ?? evaluation.evaluate(d.expr, dimensionUnit(d));
    if (result.ok) values[id] = result.value;
  }
  return values;
}

/** Whether a solve shrinks a line, arc or circle below 1 µm (the host refuses those). */
function collapses(data: SketchData, solution: SketchSolution): boolean {
  const at = (id: SketchEntityId) => {
    const moved = solution.points[id];
    const p = data.entities[id];
    return moved ?? (p?.type === 'point' ? p : undefined);
  };
  for (const [id, e] of Object.entries(data.entities)) {
    if (e.type === 'line') {
      const a = at(e.start);
      const b = at(e.end);
      if (a && b && Math.hypot(b.x - a.x, b.y - a.y) < 1e-3) return true;
    } else if (e.type === 'circle') {
      if ((solution.radii[id as SketchEntityId] ?? e.radius) < 1e-3) return true;
    }
  }
  return false;
}

let kernel: Kernel;
let solver: SketchSolver;

beforeAll(async () => {
  kernel = new Kernel(await loadOcct());
  solver = new SketchSolver(await loadPlanegcs());
});

afterAll(() => {
  solver?.dispose();
});

/**
 * Applies a mutation and solves every sketch whose dimension values changed,
 * as the sketch host does. Returns undefined when the app would refuse it.
 */
function apply(doc: ExtrudoDocument, m: Mutation): ExtrudoDocument | undefined {
  let next: ExtrudoDocument;
  try {
    switch (m.kind) {
      case 'parameter': {
        const p = doc.parameters.find((q) => q.name === m.name);
        if (!p) return undefined;
        next = applyCommand(
          doc,
          updateParameter({ id: p.id, changes: { expression: m.expr } }),
        ).doc;
        break;
      }
      case 'dimension':
        next = applyCommand(
          doc,
          updateSketchDimension({ feature: m.feature, id: m.id, changes: { expr: m.expr } }),
        ).doc;
        break;
      case 'input': {
        const feature = doc.features.find((f) => f.id === m.feature);
        const value = feature?.inputs[m.input];
        if (value?.kind !== 'expr') return undefined;
        const inputs: FeatureInputs = { [m.input]: { ...value, expr: m.expr } };
        next = applyCommand(doc, updateFeatureInputs({ id: m.feature, inputs })).doc;
        break;
      }
      case 'suppress':
        next = applyCommand(
          doc,
          setFeatureSuppressed({ id: m.feature, suppressed: m.suppressed }),
        ).doc;
        break;
      case 'marker':
        next = applyCommand(doc, moveTimelineMarker({ index: m.index })).doc;
        break;
    }
  } catch (error) {
    // A refused command (a cycle, an unknown name) is the app saying no.
    if (error instanceof Error && error.name === 'CommandError') return undefined;
    throw error;
  }
  return settle(doc, next);
}

/**
 * Solves every sketch of `next` whose dimension values differ from `before`
 * (or every one listed in `force`), as the sketch host's `settle` does, and
 * stores the solved geometry. Undefined when a solve fails or collapses a curve.
 */
function settle(
  before: ExtrudoDocument,
  after: ExtrudoDocument,
  force: ReadonlySet<FeatureId> = new Set(),
): ExtrudoDocument | undefined {
  let next = after;
  const was = evaluateParameters(before);
  const now = evaluateParameters(next);
  for (const feature of next.features) {
    const view = readSketch(feature);
    if (!view) continue;
    const old = before.features.find((f) => f.id === feature.id);
    const oldView = old && readSketch(old);
    const values = dimensionValues(view.data, now, feature.id);
    const oldValues = oldView ? dimensionValues(oldView.data, was, feature.id) : {};
    if (!force.has(feature.id) && JSON.stringify(values) === JSON.stringify(oldValues)) continue;
    const result = oldView
      ? solveGradually(solver, oldView.data, view.data, oldValues, values)
      : solver.solve(view.data, values);
    if (!result.ok || collapses(view.data, result.solution)) return undefined;
    const points: Record<SketchEntityId, { x: number; y: number }> = {};
    const radii: Record<SketchEntityId, number> = {};
    for (const [key, p] of Object.entries(result.solution.points)) {
      const e = view.data.entities[key as SketchEntityId];
      if (e?.type === 'point' && (e.x !== p.x || e.y !== p.y)) points[key as SketchEntityId] = p;
    }
    for (const [key, r] of Object.entries(result.solution.radii)) {
      const e = view.data.entities[key as SketchEntityId];
      if (e?.type === 'circle' && e.radius !== r) radii[key as SketchEntityId] = r;
    }
    next = applyCommand(next, setSketchGeometry({ feature: feature.id, points, radii })).doc;
  }
  return next;
}

/**
 * What the app does after a recompute (`ToolHost.syncProjections`): brings
 * each sketch's projected curves in line with the kernel's report and solves
 * the sketch again. Undefined when nothing changed.
 */
function syncSketches(
  doc: ExtrudoDocument,
  reports: Record<string, unknown>,
  newId: () => string,
): ExtrudoDocument | undefined {
  let next = doc;
  const synced = new Set<FeatureId>();
  for (const feature of doc.features) {
    const view = readSketch(feature);
    const report = reports[feature.id] as SketchReport | undefined;
    if (!view?.data.projections || !report) continue;
    const change = projectionSync(view.data, report, newId);
    if (!change) continue;
    next = applyCommand(next, syncProjections({ feature: feature.id, ...change })).doc;
    synced.add(feature.id);
  }
  if (synced.size === 0) return undefined;
  // A solve that fails keeps the synced curves where the kernel put them.
  return settle(doc, next, synced) ?? next;
}

type Done = Extract<RecomputeResult, { status: 'done' }>;

/** What a recompute made, comparable between a warm and a cold engine. */
function summary(engine: RecomputeEngine, result: Done) {
  return {
    features: Object.fromEntries(Object.entries(result.features).map(([id, s]) => [id, s.status])),
    bodies: result.bodies.map(({ id }) => {
      const shape = engine.latestBody(id);
      if (!shape) return [id, 'missing'];
      const { volume } = kernel.measure(shape);
      return [id, Number(volume.toFixed(2))];
    }),
  };
}

/** Internal errors are evaluator bugs; kernel errors are the user's to fix. */
function internalErrors(result: Done, doc: ExtrudoDocument): string[] {
  return Object.entries(result.features)
    .filter(([, s]) => s.status === 'error' && s.message?.startsWith('Internal error'))
    .map(([id, s]) => `${doc.features.find((f) => f.id === id)?.name}: ${s.message}`);
}

async function recompute(engine: RecomputeEngine, doc: ExtrudoDocument): Promise<Done> {
  const started = performance.now();
  const result = await engine.recompute({ doc });
  const took = performance.now() - started;
  expect(took, 'a recompute that long is a hang').toBeLessThan(STEP_LIMIT_MS);
  if (result.status !== 'done') throw new Error(`recompute ${result.status}`);
  return result;
}

function pickMutation(doc: ExtrudoDocument, targets: Target[], random: () => number): Mutation {
  const roll = random();
  const features: Feature[] = doc.features;
  if (roll < 0.05 && features.length > 1) {
    return { kind: 'marker', index: Math.floor(random() * (features.length + 1)) };
  }
  if (roll < 0.1 && features.length > 1) {
    const feature = features[Math.floor(random() * features.length)] as Feature;
    return { kind: 'suppress', feature: feature.id, suppressed: !feature.suppressed };
  }
  const target = targets[Math.floor(random() * targets.length)] as Target;
  // Plausible factors three times as often as the edge cases.
  const plausible = FACTORS.slice(0, 8);
  const pool = random() < 0.75 ? plausible : FACTORS.slice(8);
  return target.mutate(String(pool[Math.floor(random() * pool.length)]));
}

/** Recomputes, then syncs projections and recomputes again as the app does after one. */
async function recomputeAndSync(
  engine: RecomputeEngine,
  doc: ExtrudoDocument,
  newId: () => string,
): Promise<{ doc: ExtrudoDocument; result: Done }> {
  let result = await recompute(engine, doc);
  for (let round = 0; round < 3; round++) {
    const synced = syncSketches(doc, result.reports, newId);
    if (!synced) break;
    doc = synced;
    result = await recompute(engine, doc);
  }
  return { doc, result };
}

/** Fresh IDs for projection syncs, deterministic like the rest of a run. */
function idSource() {
  let ids = 0;
  return () => `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`;
}

async function fuzz(name: string, dataUrl: string, seed: number, steps = STEPS) {
  const random = prng(seed);
  const newId = idSource();
  const original = load(dataUrl);
  const targets = targetsOf(original);
  expect(targets.length).toBeGreaterThan(0);
  const baseline = kernel.stats().liveShapes;
  const engine = new RecomputeEngine(kernel, kernelFeatures(), { strictLeaks: true });
  // `messages` counts feature messages (numbers as N) for `FUZZ_REPORT=1`.
  const stats = { applied: 0, refused: 0, errors: 0, messages: {} as Record<string, number> };
  // Warm recompute times of the edits (ms), for `FUZZ_REPORT=1`.
  const times: number[] = [];
  let doc = original;
  try {
    await recompute(engine, doc);
    for (let step = 1; step <= steps; step++) {
      // Now and then start again from the fixture, so edits don't pile up forever.
      if (random() < 0.08) doc = original;
      const mutation = pickMutation(doc, targets, random);
      const next = apply(doc, mutation);
      if (!next) {
        stats.refused++;
        continue;
      }
      stats.applied++;
      const at = `${name} step ${step} (seed ${seed}) after ${JSON.stringify(mutation)}`;
      let result: Done;
      try {
        const started = performance.now();
        ({ doc, result } = await recomputeAndSync(engine, next, newId));
        times.push(performance.now() - started);
      } catch (error) {
        throw new Error(`${at} crashed: ${error}`);
      }
      expect(internalErrors(result, doc), at).toEqual([]);
      if (Object.values(result.features).some((s) => s.status === 'error')) stats.errors++;
      for (const s of Object.values(result.features)) {
        if (s.status === 'ok') continue;
        const key = `${s.status}: ${(s.message ?? '').replace(/-?[\d.]+/g, 'N')}`;
        stats.messages[key] = (stats.messages[key] ?? 0) + 1;
      }
      if (step % COMPARE_EVERY === 0) {
        const cold = new RecomputeEngine(kernel, kernelFeatures(), { strictLeaks: true });
        try {
          const fresh = await recompute(cold, doc);
          expect(summary(engine, result), `${at}: warm vs cold`).toEqual(summary(cold, fresh));
        } finally {
          cold.clear();
        }
      }
    }
  } finally {
    engine.clear();
  }
  expect(kernel.stats().liveShapes, `${name}: shapes left after clearing`).toBe(baseline);
  const sorted = times.sort((a, b) => a - b);
  const at = (q: number) => Math.round(sorted[Math.floor(q * (sorted.length - 1))] ?? 0);
  return { ...stats, ms: { median: at(0.5), p95: at(0.95), max: at(1) } };
}

describe('fuzzing the benchmark fixtures', () => {
  const cases: [string, string][] = [
    ['B1', b1],
    ['B2', b2],
    ['B3', b3],
    ['B4', b4],
    ['B5', b5],
    ['B6', b6],
    ['B7', b7],
  ];
  for (const [name, dataUrl] of cases) {
    it(`${name}: random edits never crash, leak or disagree with a cold recompute`, {
      timeout: 60_000 + STEPS * 2_000,
    }, async () => {
      const stats = await fuzz(name, dataUrl, SEED + name.charCodeAt(1));
      if (env.FUZZ_REPORT) expect.soft(stats, `${name} (report)`).toBeUndefined();
      // Most edits must go through, or the fuzzer tests nothing.
      expect(stats.applied).toBeGreaterThan(STEPS / 3);
    });
  }
});

// P3-17: two more sequences on B5, the fixture with the pattern: `FUZZ_SEED=7` and `FUZZ_SEED=2026`
// at 1000 steps are where a pattern of 2 x 20 instances once took 55 s to recompute (the target
// filter measured every body against the whole merged tool). Here as the effective seeds
// (`SEED + '5'.charCodeAt(0)`), at a CI-sized length.
describe('B5 again, other sequences', () => {
  for (const seed of [7, 2026]) {
    it(`B5: seed ${seed}, ${STEPS + 100} steps never crash, leak or hang`, {
      timeout: 60_000 + (STEPS + 100) * 2_000,
    }, async () => {
      const stats = await fuzz('B5', b5, seed + '5'.charCodeAt(0), STEPS + 100);
      expect(stats.applied).toBeGreaterThan(STEPS / 3);
    });
  }
});

describe('what the fuzzer found', () => {
  it('B5 recomputes a pattern of 2 x 20 instances in seconds (target filter per solid)', async () => {
    // Rectangular Pattern1's second count x 10: the posts and their holes. 20 of the 40 posts
    // stand outside the tray, so they are bodies of their own, and every later feature asks
    // which bodies it touches. One exact distance from each body to the whole merged tool took
    // 55 s; boxes first and solid by solid it takes about 2 s (`pattern-bench.test.ts`).
    const engine = new RecomputeEngine(kernel, kernelFeatures(), { strictLeaks: true });
    try {
      const original = load(b5);
      const pattern = original.features.find((f) => f.name === 'Rectangular Pattern1') as Feature;
      const count2 = pattern.inputs.count2;
      if (count2?.kind !== 'expr') throw new Error('no count2');
      const doc = apply(original, {
        kind: 'input',
        feature: pattern.id,
        input: 'count2',
        expr: `(${count2.expr}) * 10`,
      });
      if (!doc) throw new Error('count2 refused');
      const started = performance.now();
      const result = await recompute(engine, doc);
      expect(performance.now() - started).toBeLessThan(15_000);
      expect(result.features[pattern.id]?.status).toBe('warning');
      expect(result.features[pattern.id]?.message).toMatch(/separate bodies/);
      expect(internalErrors(result, doc)).toEqual([]);
    } finally {
      engine.clear();
    }
  });

  it('B4 refuses a fillet that runs into a wall instead of trapping OCCT', async () => {
    // The lid's fillet on the top edges, radius 3 mm, with the lip made 10 % too long and the
    // wall 0 (Shell1 fails): the lip sticks out of the lid's side faces, so those faces have
    // a step 3 mm below the edge. A round of 3 mm (or 4, 6) used to trap OCCT in
    // `Geom2dAdaptor_Curve::EvalD1` ("null function or function signature mismatch").
    const engine = new RecomputeEngine(kernel, kernelFeatures(), { strictLeaks: true });
    try {
      const original = load(b4);
      const lip = original.features.find((f) => f.name === 'Box3') as Feature;
      const fillet = original.features.find((f) => f.name === 'Fillet1') as Feature;
      let doc: ExtrudoDocument | undefined = original;
      for (const m of [
        {
          kind: 'input',
          feature: lip.id,
          input: 'length',
          expr: '(length - 2 * (wall + clearance)) * 1.1',
        },
        { kind: 'parameter', name: 'wall', expr: '(2 mm) * 0' },
        { kind: 'input', feature: fillet.id, input: 'radius', expr: '(rounding) * 2' },
      ] as Mutation[]) {
        doc = doc && apply(doc, m);
        if (!doc) throw new Error(`${JSON.stringify(m)} refused`);
      }
      const result = await recompute(engine, doc);
      const status = result.features[fillet.id];
      expect(status?.status).toBe('error');
      expect(status?.message).toMatch(/^Radius 3 mm is too large for edge \d+ \(max ≈ 2\.9 mm\)\./);
      // Smaller radii still round it.
      const fine = apply(doc, {
        kind: 'input',
        feature: fillet.id,
        input: 'radius',
        expr: '2.5 mm',
      });
      if (!fine) throw new Error('2.5 mm refused');
      expect((await recompute(engine, fine)).features[fillet.id]?.status).toMatch(/^(ok|warning)$/);
    } finally {
      engine.clear();
    }
  });

  it('B5 releases the shapes of a pattern whose second round fails', async () => {
    // Rectangular Pattern1 repeats Cylinder1 (a join) and Hole1 (a cut). Moving the hole off
    // the post (x 0, y -37.5 mm) makes the cut miss every body, after the join of the first
    // round had kept its shapes: they were never released (strict leaks: "left 2 shapes").
    const engine = new RecomputeEngine(kernel, kernelFeatures(), { strictLeaks: true });
    try {
      const original = load(b5);
      const hole = original.features.find((f) => f.name === 'Hole1') as Feature;
      const pattern = original.features.find((f) => f.name === 'Rectangular Pattern1') as Feature;
      let doc: ExtrudoDocument | undefined = original;
      for (const m of [
        { kind: 'input', feature: hole.id, input: 'x', expr: '(-px) * 0' },
        { kind: 'input', feature: hole.id, input: 'y', expr: '(-py) * 1.25' },
      ] as Mutation[]) {
        doc = doc && apply(doc, m);
        if (!doc) throw new Error(`${JSON.stringify(m)} refused`);
      }
      const result = await recompute(engine, doc);
      expect(result.features[pattern.id]?.status).toBe('error');
      expect(result.features[pattern.id]?.message).toMatch(/^The cut doesn't touch any body/);
    } finally {
      engine.clear();
    }
  });

  it('B2 keeps its cut when the box gets much shallower than its walls are thick', async () => {
    // Sketch2 sits on the box's top and holds the inner outline 3 mm inside
    // the projected edges. Solved in one go, depth 60 -> 30 moved the far edge
    // 30 mm and the inner line landed 3 mm outside it, so Extrude2 lost its
    // profile. Solved in steps (`solveGradually`), it stays inside.
    const engine = new RecomputeEngine(kernel, kernelFeatures(), { strictLeaks: true });
    try {
      const newId = idSource();
      let doc = load(b2);
      await recompute(engine, doc);
      for (const depth of ['30 mm', '12 mm', '90 mm']) {
        const next = apply(doc, { kind: 'parameter', name: 'depth', expr: depth });
        if (!next) throw new Error(`depth ${depth} refused`);
        const { doc: synced, result } = await recomputeAndSync(engine, next, newId);
        doc = synced;
        expect(Object.values(result.features).map((f) => f.message ?? f.status)).toEqual([
          'ok',
          'ok',
          'ok',
          'ok',
        ]);
        const d = Number.parseFloat(depth);
        const [box] = result.bodies;
        const shape = box && engine.latestBody(box.id);
        if (!shape) throw new Error('no box');
        expect(kernel.measure(shape).volume).toBeCloseTo(80 * d * 40 - 74 * (d - 6) * 36, 3);
      }
    } finally {
      engine.clear();
    }
  });
});

// P3-13 (ADR-0029's open item): the WASM heap over a long scripted editing
// session with a warm cache, as in the app. Measurement only:
// `FUZZ_HEAP=3000 pnpm vitest run packages/kernel/src/fuzz.test.ts -t heap`
// reports the heap every 250 steps of B3 and B2 edits.
describe.runIf(env.FUZZ_HEAP)('heap over a long editing session', () => {
  it('heap', { timeout: 3_600_000 }, async () => {
    const steps = Number(env.FUZZ_HEAP);
    const report: Record<string, number[]> = {};
    for (const [name, dataUrl] of [
      ['B3', b3],
      ['B2', b2],
    ] as const) {
      const random = prng(SEED);
      const newId = idSource();
      const original = load(dataUrl);
      const targets = targetsOf(original);
      const engine = new RecomputeEngine(kernel, kernelFeatures());
      const samples: number[] = [];
      let doc = original;
      try {
        await recompute(engine, doc);
        for (let step = 1; step <= steps; step++) {
          if (random() < 0.08) doc = original;
          const next = apply(doc, pickMutation(doc, targets, random));
          if (next) ({ doc } = await recomputeAndSync(engine, next, newId));
          if (step % 250 === 0) samples.push(Math.round(kernel.stats().heapTop / 2 ** 17) / 8);
        }
      } finally {
        engine.clear();
      }
      report[`${name} heap top (MB) every 250 steps`] = samples;
    }
    expect.soft(report).toBeUndefined();
  });
});
