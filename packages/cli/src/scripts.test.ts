// The Script feature end to end (P5-02 slice 2, ADR-0070): the runner from
// `@extrudo/script` injected into the real engine with the real OCCT build,
// as the app's worker and the CLI inject it. This package is the one that may
// hold both (the kernel never imports the runner, and the runner never imports
// the kernel), which is why these tests live here.
//
// Every engine runs with `strictLeaks`, so a shape left behind by a generated
// feature — on success, on failure, on a cancel or on a cache hit — fails the
// test that made it; and every QuickJS handle a run makes is freed before the
// run returns (QuickJS aborts the process otherwise).

import { Design, edgeName, type SketchHandle } from '@extrudo/api';
import {
  documentFeatures,
  type ExtrudoDocument,
  type FeatureId,
  type FeatureStatus,
  faceRoleIssues,
  updateFeatureInputs,
} from '@extrudo/core';
import { Kernel, NO_SCRIPT_HOST, type RecomputeResult } from '@extrudo/kernel';
import { kernelFeatures, loadOcct, RecomputeEngine } from '@extrudo/kernel/node';
import { loadScriptHost, type ScriptHostAdapter } from '@extrudo/script';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { HOLE_RING, holeRing } from '../../../docs/api/examples/script-hole-ring';
import { SHELF, shelf } from '../../../docs/api/examples/script-shelf';

type Done = Extract<RecomputeResult, { status: 'done' }>;

let kernel: Kernel;
let host: ScriptHostAdapter;
const engines: RecomputeEngine[] = [];

beforeAll(async () => {
  kernel = new Kernel(await loadOcct());
  host = await loadScriptHost();
});

afterEach(() => {
  // Everything an engine held goes back; nothing else may be alive.
  for (const engine of engines.splice(0)) engine.clear();
  expect(kernel.stats().liveShapes).toBe(0);
});

afterAll(() => {
  kernel.dispose();
});

/** An engine with the runner (or without one), leaks strict. */
function engineOf(withRunner = true): RecomputeEngine {
  const engine = new RecomputeEngine(kernel, kernelFeatures(), {
    strictLeaks: true,
    scripts: () => (withRunner ? host : undefined),
  });
  engines.push(engine);
  return engine;
}

async function compute(engine: RecomputeEngine, doc: ExtrudoDocument): Promise<Done> {
  const result = await engine.recompute({ doc });
  if (result.status !== 'done') throw new Error('The recompute was cancelled.');
  return result;
}

/** Every body's exact volume, box and face names, in creation order. */
function bodiesOf(engine: RecomputeEngine, result: Done) {
  return result.bodies.map((body) => {
    const shape = engine.latestBody(body.id);
    if (shape === undefined) throw new Error(`No body ${body.id}.`);
    const { volume, bbox } = kernel.properties(shape);
    return { id: body.id, volume, bbox, faces: [...(body.mesh?.faceIds ?? [])] };
  });
}

const statusOf = (result: Done, id: string): FeatureStatus | undefined =>
  result.features[id as FeatureId];

/** A plate with `count` through holes along X, as the script and the hand build it. */
const PLATE = `
const plate = design.box({ length: '80 mm', width: '20 mm', height: '5 mm' });
for (let i = 0; i < params.count; i++) {
  design.hole({
    plane: plate.face('cap:end'),
    x: -30 + i * 10,
    y: 0,
    diameter: '4 mm',
    extent: 'through',
  });
}
`;

/** The design of `PLATE`: a parameter `count`, then the script (ID `f1`). */
function plateDesign(count = 4): Design {
  const d = Design.create({ name: 'Plate', now: '2026-10-05T00:00:00.000Z' });
  d.parameter('count', String(count));
  d.script({ code: PLATE });
  return d;
}

const doc = (d: Design): ExtrudoDocument => d.toJSON();

/** A copy of a document with one parameter's expression changed, as the app's command does. */
function withParameter(source: ExtrudoDocument, name: string, expression: string): ExtrudoDocument {
  const d = Design.from(source);
  d.setParameter(name, expression);
  return d.toJSON();
}

describe('a script in the engine', () => {
  it('makes a plate with holes from a loop, equal to the same features made by hand', async () => {
    const scripted = engineOf();
    const result = await compute(scripted, doc(plateDesign(4)));
    expect(statusOf(result, 'f1')).toMatchObject({ status: 'ok' });
    // The script made a box and four holes, named after itself.
    expect(statusOf(result, 'f1')?.script?.generated.map((g) => [g.id, g.name])).toEqual([
      ['f1.f1', 'Script1 › Box1'],
      ['f1.f2', 'Script1 › Hole1'],
      ['f1.f3', 'Script1 › Hole2'],
      ['f1.f4', 'Script1 › Hole3'],
      ['f1.f5', 'Script1 › Hole4'],
    ]);
    // A script's features are its own: the result lists the script, not them.
    expect(Object.keys(result.features)).toEqual(['f1']);

    const hand = Design.create({ name: 'Plate', now: '2026-10-05T00:00:00.000Z' });
    hand.parameter('count', '4');
    const plate = hand.box({ length: '80 mm', width: '20 mm', height: '5 mm' });
    for (let i = 0; i < 4; i++) {
      hand.hole({
        plane: plate.face('cap:end'),
        x: -30 + i * 10,
        y: 0,
        diameter: '4 mm',
        extent: 'through',
      });
    }
    const byHand = engineOf();
    const reference = await compute(byHand, doc(hand));

    const ours = bodiesOf(scripted, result);
    const theirs = bodiesOf(byHand, reference);
    expect(ours).toHaveLength(1);
    expect(theirs).toHaveLength(1);
    const [a, b] = [ours[0], theirs[0]];
    if (!a || !b) throw new Error('No body.');
    expect(a.id).toBe('f1.f1:0');
    expect(b.id).toBe('f1:0');
    expect(a.volume).toBeCloseTo(80 * 20 * 5 - 4 * Math.PI * 2 * 2 * 5, 6);
    expect(a.volume).toBeCloseTo(b.volume, 9);
    expect(a.bbox).toEqual(b.bbox);
    // The face names are the hand-made ones with the script's ID in front.
    expect(a.faces.map((name) => name.replaceAll('f1.f', 'f'))).toEqual(b.faces);
    expect(a.faces).toContain('box:f1.f1:cap:end');
    expect(a.faces.some((name) => name.startsWith('hole:f1.f2:side:wall'))).toBe(true);
    // Each generated feature names its faces with its own type's roles
    // (ADR-0068 §4), under its own ID: what `handle.face(role)` builds in a script.
    for (const made of statusOf(result, 'f1')?.script?.generated ?? []) {
      const roles = documentFeatures().get(made.type)?.faceRoles;
      expect(faceRoleIssues(roles, made.id, a.faces), made.id).toEqual([]);
    }
  });

  it('lets a later fillet use an edge of its body, before and after the count changes', async () => {
    const d = plateDesign(4);
    const box = 'box:f1.f1';
    d.fillet({
      edges: d.ref('edge', edgeName([`${box}:cap:end`, `${box}:side:front`])),
      radius: '1 mm',
    });
    const engine = engineOf();
    const before = await compute(engine, doc(d));
    // Resolved exactly: a guess would be a warning.
    expect(statusOf(before, 'f2')).toEqual({ status: 'ok' });
    const [four] = bodiesOf(engine, before);
    expect(four?.faces.some((name) => name.startsWith('fillet:f2:'))).toBe(true);

    const six = withParameter(doc(d), 'count', '6');
    const after = await compute(engine, six);
    expect(statusOf(after, 'f1')?.script?.generated).toHaveLength(7);
    expect(statusOf(after, 'f2')).toEqual({ status: 'ok' });
    const [body] = bodiesOf(engine, after);
    // Two more holes: two more walls.
    expect(body?.faces.length).toBe((four?.faces.length ?? 0) + 2);
  });

  it('evaluates again only the generated features a parameter change reaches', async () => {
    const d = Design.create({ name: 'Two parts', now: '2026-10-05T00:00:00.000Z' });
    d.parameter('len', '40 mm');
    d.parameter('tall', '10 mm');
    d.script({
      code: `
        design.box({ length: params.len, width: 20, height: 5 });
        design.cylinder({ diameter: 10, height: params.tall, x: 60 });
      `,
    });
    const engine = engineOf();
    const first = await compute(engine, doc(d));
    expect(first.stats.evaluated).toEqual(['f1', 'f1.f1', 'f1.f2']);

    // The same document again: the run and both features come from the cache.
    const again = await compute(engine, doc(d));
    expect(again.stats.evaluated).toEqual([]);

    // Only the cylinder reads `tall`: the script runs again (it reads every
    // parameter), the box is the one it was.
    const taller = await compute(engine, withParameter(doc(d), 'tall', '15 mm'));
    expect(taller.stats.evaluated).toEqual(['f1', 'f1.f2']);

    // A change after the script doesn't run it again.
    const later = Design.from(withParameter(doc(d), 'tall', '15 mm'));
    later.box({ length: 5, width: 5, height: 5, x: -60 });
    const added = await compute(engine, later.toJSON());
    expect(added.stats.evaluated).toEqual(['f2']);
  });

  it('says on which line a script failed, and leaves the bodies before it alone', async () => {
    const d = Design.create({ name: 'Broken', now: '2026-10-05T00:00:00.000Z' });
    d.box({ length: 10, width: 10, height: 10 });
    d.script({ code: 'design.box({ length: 5 });\nconst x = ;\n' });
    d.script({ code: "design.box({ x: 30 });\n\nthrow new Error('no luck');\n", language: 'js' });
    const engine = engineOf();
    const result = await compute(engine, doc(d));

    const syntax = statusOf(result, 'f2');
    expect(syntax?.status).toBe('error');
    expect(syntax?.message).toMatch(/^Line 2: /);
    expect(syntax?.script).toMatchObject({ generated: [], line: 2 });

    const runtime = statusOf(result, 'f3');
    expect(runtime?.status).toBe('error');
    expect(runtime?.message).toBe('Line 3: Error: no luck');
    expect(runtime?.script?.line).toBe(3);
    // A failed run makes nothing, not even what came before the throw.
    expect(result.bodies.map((b) => b.id)).toEqual(['f1:0']);
    const [box] = bodiesOf(engine, result);
    expect(box?.volume).toBeCloseTo(1000, 6);
  });

  it("names the generated feature that failed, and keeps the others' bodies", async () => {
    const d = Design.create({ name: 'Too round', now: '2026-10-05T00:00:00.000Z' });
    d.script({
      code: `
        const b = design.box({ length: 20, width: 20, height: 20 });
        design.fillet({
          edges: b.edge([b.faceName('cap:end'), b.faceName('side:front')]),
          radius: '50 mm',
        });
        console.log('done');
      `,
    });
    const engine = engineOf();
    const result = await compute(engine, doc(d));
    const status = statusOf(result, 'f1');
    expect(status?.status).toBe('error');
    expect(status?.message).toMatch(/^Script1 › Fillet1: Radius 50 mm is too large/);
    expect(status?.script?.generated.map((g) => g.status)).toEqual(['ok', 'error']);
    expect(status?.script?.log).toEqual(['done']);
    // No "Fix References" for references only the code can change.
    expect(status?.refs).toBeUndefined();
    expect(result.bodies.map((b) => b.id)).toEqual(['f1.f1:0']);
  });

  it('refuses a script inside a script, by its line', async () => {
    const d = Design.create({ name: 'Nested', now: '2026-10-05T00:00:00.000Z' });
    d.script({ code: "design.box({});\ndesign.script({ code: 'design.box({})' });\n" });
    const result = await compute(engineOf(), doc(d));
    expect(statusOf(result, 'f1')).toMatchObject({
      status: 'error',
      message: "Line 2: A script can't add a script.",
    });
  });

  it('is an error, not a crash, in a kernel that has no runner', async () => {
    const result = await compute(engineOf(false), doc(plateDesign(2)));
    expect(statusOf(result, 'f1')).toMatchObject({ status: 'error', message: NO_SCRIPT_HOST });
    expect(result.bodies).toEqual([]);
    // The same engine, given a runner later (`enableScripts`), runs it: a
    // missing runner is not remembered as the script's answer.
    let later: ScriptHostAdapter | undefined;
    const engine = new RecomputeEngine(kernel, kernelFeatures(), {
      strictLeaks: true,
      scripts: () => later,
    });
    engines.push(engine);
    expect(statusOf(await compute(engine, doc(plateDesign(2))), 'f1')?.status).toBe('error');
    later = host;
    expect(statusOf(await compute(engine, doc(plateDesign(2))), 'f1')?.status).toBe('ok');
  });

  it('stops between generated features when a newer recompute comes, and leaks nothing', async () => {
    const engine = engineOf();
    const four = doc(plateDesign(4));
    let newer: Promise<RecomputeResult> | undefined;
    const first = engine.recompute({ doc: four }, (feature) => {
      // The script is about to run: a newer request arrives meanwhile, and the
      // walk stops at the yield before the first feature it made.
      if (feature === 'f1' && !newer) {
        newer = engine.recompute({ doc: withParameter(four, 'count', '3') });
      }
    });
    expect((await first).status).toBe('cancelled');
    const second = await newer;
    expect(second?.status).toBe('done');
    if (second?.status !== 'done') return;
    expect(statusOf(second, 'f1')?.script?.generated).toHaveLength(4);
  });

  it('gives a body to every generated feature under its own ID, the same every run', async () => {
    const d = Design.create({ name: 'Two scripts', now: '2026-10-05T00:00:00.000Z' });
    d.box({ length: 10, width: 10, height: 10 });
    d.script({ code: 'design.box({ x: 30 }); design.box({ x: 60 });' });
    d.script({ code: 'design.box({ y: 30 });' });
    const engine = engineOf();
    const result = await compute(engine, doc(d));
    const ids = result.bodies.map((b) => b.id);
    expect(ids).toEqual(['f1:0', 'f2.f1:0', 'f2.f2:0', 'f3.f1:0']);
    // Another engine, another run: the same IDs and versions.
    const other = await compute(engineOf(), doc(d));
    expect(other.bodies.map((b) => [b.id, b.version])).toEqual(
      result.bodies.map((b) => [b.id, b.version]),
    );
  });

  it("refers a missing generated feature's dependants to the script", async () => {
    // A later extrude on a profile of a sketch the script makes: when the
    // script fails, the extrude says which feature it needs.
    const good = Design.create({ name: 'Profile', now: '2026-10-05T00:00:00.000Z' });
    good.script({
      code: 'design.sketch(design.origin.xy, (k) => { k.rectangle([0, 0], [20, 10]); });',
    });
    const engine = engineOf();
    const made = host.run({
      code: 'design.sketch(design.origin.xy, (k) => { k.rectangle([0, 0], [20, 10]); });',
      language: 'ts',
      doc: Design.create({ now: '2026-10-05T00:00:00.000Z' }).toJSON(),
      featureId: 'f1' as FeatureId,
      featureName: 'Script1',
      params: {},
    });
    if (!made.ok) throw new Error(made.error.message);
    const sketchId = made.features[0]?.id;
    expect(sketchId).toBe('f1.f1');
    // The profile's reference, as a person would pick it in the app.
    const profiles = (
      Design.from({ ...good.toJSON(), features: [...made.features] }).feature(
        sketchId as string,
      ) as SketchHandle
    ).profiles();
    good.extrude({ profiles, distance: '5 mm' });
    const ok = await compute(engine, good.toJSON());
    expect(statusOf(ok, 'f2')).toEqual({ status: 'ok' });
    expect(ok.bodies.map((b) => b.id)).toEqual(['f2:0']);

    const broken = Design.from(good.toJSON());
    broken.state.dispatch(
      updateFeatureInputs({
        id: 'f1' as FeatureId,
        inputs: { code: { kind: 'code', value: 'throw new Error("nothing today");' } },
      }),
    );
    const failed = await compute(engine, broken.toJSON());
    expect(statusOf(failed, 'f2')).toEqual({
      status: 'error',
      message: 'Needs Script1, which has an error.',
    });
  });
});

describe('the examples (docs/api/examples/script-*.ts)', () => {
  it('drills a ring of holes, and as many as the parameter says', async () => {
    const d = holeRing();
    expect(d.doc.features[0]?.inputs.code).toEqual({ kind: 'code', value: HOLE_RING });
    const engine = engineOf();
    const result = await compute(engine, d.toJSON());
    const ring = statusOf(result, 'f1');
    expect(ring?.status).toBe('ok');
    expect(ring?.script?.log).toEqual(['8 holes on a 44 mm circle']);
    const [flange] = bodiesOf(engine, result);
    const disc = Math.PI * 30 * 30 * 5;
    const hole = Math.PI * 2.5 * 2.5 * 5;
    expect(flange?.volume).toBeCloseTo(disc - 8 * hole, 4);

    const twelve = await compute(engine, withParameter(d.toJSON(), 'holes', '12'));
    const [more] = bodiesOf(engine, twelve);
    expect(more?.volume).toBeCloseTo(disc - 12 * hole, 4);
    expect(statusOf(twelve, 'f1')?.script?.generated).toHaveLength(13);
  });

  it('builds a shelf of N compartments as one body', async () => {
    const d = shelf();
    expect(d.doc.features[0]?.inputs.code).toEqual({ kind: 'code', value: SHELF });
    const engine = engineOf();
    const volume = (n: number) => 250 * 18 * (2 * 600 + (n + 1) * (300 - 2 * 18));
    const three = await compute(engine, d.toJSON());
    expect(statusOf(three, 'f1')).toMatchObject({ status: 'ok' });
    const [body] = bodiesOf(engine, three);
    expect(three.bodies).toHaveLength(1);
    expect(body?.volume).toBeCloseTo(volume(3), 3);
    expect(body?.bbox.min[0]).toBeCloseTo(-300, 6);
    expect(body?.bbox.max[2]).toBeCloseTo(300, 6);

    const five = await compute(engine, withParameter(d.toJSON(), 'compartments', '5'));
    const [wider] = bodiesOf(engine, five);
    expect(five.bodies).toHaveLength(1);
    expect(wider?.volume).toBeCloseTo(volume(5), 3);
  });
});

/**
 * The fuzzer's idea (ADR-0050 §1) for scripts: seeded random parameter values
 * on the script designs — 0, negative, huge, fractional counts — recomputed warm
 * on one engine and, every few steps, cold on a new one, which must agree body
 * for body; no run may end in an "Internal error", and strict leaks hold
 * throughout. The kernel's own fuzzer (`packages/kernel/src/fuzz.test.ts`)
 * can't do this: its tests may not load the runner (the package boundary), and
 * this package is the one that holds both.
 */
describe('random parameter edits on the script designs', () => {
  /** Lengths scale by these; counts take one of `COUNTS` (a count × 100 is minutes of booleans). */
  const FACTORS = [0, -1, 0.5, 0.9, 1.5, 2, 3, 1e-3, 10, 100];
  const COUNTS = [0, -1, 1, 2, 2.5, 5, 12];
  const STEPS = 16;

  function prng(seed: number) {
    let state = seed >>> 0;
    return () => {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** Every status message of a result, the generated features' included. */
  function messages(result: Done): string[] {
    return Object.values(result.features).flatMap((status) => [
      status.message ?? '',
      ...(status.script?.generated.map((g) => g.message ?? '') ?? []),
    ]);
  }

  const designs: [string, () => Design][] = [
    ['the plate', () => plateDesign(4)],
    ['the hole ring', holeRing],
    ['the shelf', shelf],
  ];

  for (const [name, make] of designs) {
    it(`keeps ${name} sound under random values`, { timeout: 120_000 }, async () => {
      const random = prng(20261005);
      const start = make().toJSON();
      const values = new Map(
        Design.from(start)
          .toJSON()
          .parameters.map((p) => [p.name, Number.parseFloat(p.expression)]),
      );
      const units = new Map(start.parameters.map((p) => [p.name, p.unit]));
      const warm = engineOf();
      let current = start;
      for (let step = 0; step < STEPS; step++) {
        const names = [...values.keys()];
        const pick = names[Math.floor(random() * names.length)] as string;
        const length = units.get(pick) === 'length';
        const factor = FACTORS[Math.floor(random() * FACTORS.length)] as number;
        const count = COUNTS[Math.floor(random() * COUNTS.length)] as number;
        const value = length ? Number(((values.get(pick) ?? 1) * factor).toFixed(3)) : count;
        const unit = length ? ' mm' : '';
        current = withParameter(current, pick, `${value}${unit}`);
        const result = await compute(warm, current);
        expect(
          messages(result).filter((m) => m.includes('Internal error')),
          `step ${step}: ${pick} = ${value}`,
        ).toEqual([]);
        if (step % 5 === 4) {
          const cold = await compute(engineOf(), current);
          expect(cold.bodies.map((b) => [b.id, b.version])).toEqual(
            result.bodies.map((b) => [b.id, b.version]),
          );
          expect(cold.features).toEqual(result.features);
        }
      }
    });
  }
});
