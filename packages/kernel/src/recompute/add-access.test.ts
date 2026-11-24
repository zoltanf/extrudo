// `add` body access (ADR-0024's amendment on `add` access): a feature that only adds bodies sees
// none and keys none. The proof: seeded random edits of several designs, and after every step the
// engine that kept its cache (and the meshes it sent, like the Recomputer) gives exactly what an
// engine with a cleared cache gives for the same document: statuses and errors, origins, reports,
// body IDs and their order, and every array and name of every mesh. Real OCCT, strict leaks, no
// clock. Plus negative controls that must make the comparison fail, and counters.
//
// "Through all" is not among the edits: its length comes from `measure`'s box, which today depends
// on whether the bodies were meshed for display (ADR-0035: the box uses a face's triangulation
// when it has one, curved or flat), so a cached recompute (bodies drawn) and a cleared one
// (nothing drawn) differ there with or without `add`. The extent edit switches the direction (one
// side, symmetric) instead. Designs that start with a "through all" feature keep it as it is.
import {
  type AttachmentId,
  applyCommand,
  type ComponentId,
  createDocument,
  type ExtrudeInputs,
  type ExtrudoDocument,
  extrudeInputs,
  type Feature,
  type FeatureId,
  FeatureRegistry,
  insertDesign,
  insertDesignPayload,
  loadDocument,
  originPlaneRef,
  profileRefId,
  sketchInputs,
} from '@extrudo/core';
import { SketchBuilder } from '@extrudo/sketch/fixtures';
import { detectProfiles } from '@extrudo/sketch/profiles';
import { strFromU8, unzipSync } from 'fflate';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import b2 from '../../../../fixtures/benchmarks/b2-storage-box.extrudo?url&inline';
import b3 from '../../../../fixtures/benchmarks/b3-phone-stand.extrudo?url&inline';
import b4 from '../../../../fixtures/benchmarks/b4-box-with-lid.extrudo?url&inline';
import hinge from '../../../../fixtures/components/hinge.extrudo?url&inline';
import { addsOnly } from '../features/extrude';
import { kernelFeatures } from '../features/index';
import { Kernel } from '../kernel';
import { type BodyMesh, sameMesh } from '../mesh';
import { loadOcct } from '../occt/load';
import { RecomputeEngine } from './engine';
import type { KernelFeatureDefinition, RecomputeRequest, RecomputeResult } from './types';

type Done = Extract<RecomputeResult, { status: 'done' }>;
type Engine = Pick<RecomputeEngine, 'recompute' | 'clear'>;

let kernel: Kernel;
beforeAll(async () => {
  kernel = new Kernel(await loadOcct());
});
afterAll(() => {
  expect(kernel.stats().liveShapes).toBe(0);
});

// ------------------------------------------------------------------------------- designs

function fixture(dataUrl: string): ExtrudoDocument {
  const binary = atob(dataUrl.slice(dataUrl.indexOf(',') + 1));
  const files = unzipSync(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
  const json = files['document.json'];
  if (!json) throw new Error('no document.json');
  return loadDocument(JSON.parse(strFromU8(json))).doc;
}

/** A 60 × 40 mm plate at `x`, with two holes (curved walls) or none. */
function plateSketch(x: number, holes = true) {
  const y = 0;
  const b = new SketchBuilder();
  b.line(x, y, x + 60, y);
  b.line(x + 60, y, x + 60, y + 40);
  b.line(x + 60, y + 40, x, y + 40);
  b.line(x, y + 40, x, y);
  if (holes) {
    b.circle(x + 15, y + 20, 5);
    b.circle(x + 45, y + 20, 5);
  }
  return b.sketch;
}

function plateFeatures(i: number, x: number, distance: string, holes = true): Feature[] {
  const data = plateSketch(x, holes);
  const regions = detectProfiles(data);
  const outer = regions.reduce((a, r) => ((r.holes?.length ?? 0) > (a.holes?.length ?? 0) ? r : a));
  return [
    {
      id: `sk${i}` as FeatureId,
      type: 'sketch',
      name: `Sketch${i + 1}`,
      suppressed: false,
      inputs: sketchInputs(originPlaneRef('origin:xy'), data),
    },
    {
      id: `ex${i}` as FeatureId,
      type: 'extrude',
      name: `Extrude${i + 1}`,
      suppressed: false,
      inputs: extrudeInputs(
        [{ kind: 'profile', id: profileRefId(`sk${i}` as FeatureId, outer.id) }],
        {
          distance,
        },
      ),
    },
  ];
}

/** `n` plates side by side (`gap` apart; under 60 they overlap), some lengths from a parameter. */
function plates(n: number, gap = 80, holes = true): ExtrudoDocument {
  const features = Array.from({ length: n }, (_, i) =>
    plateFeatures(i, i * gap, i % 2 ? 't' : `${3 + i} mm`, holes),
  ).flat();
  return {
    ...createDocument({ name: `plates ${n}` }),
    parameters: [{ id: 'p-t', name: 't', expression: '4 mm', unit: 'length' }],
    features,
    timelineMarker: features.length,
  } as ExtrudoDocument;
}

/** Overlapping plates (with holes or flat) and a slot cut through all of them. */
function platesCut(holes = true): ExtrudoDocument {
  const doc = plates(4, 45, holes);
  const b = new SketchBuilder();
  b.line(-10, 18, 220, 18);
  b.line(220, 18, 220, 22);
  b.line(220, 22, -10, 22);
  b.line(-10, 22, -10, 18);
  const [region] = detectProfiles(b.sketch);
  const features: Feature[] = [
    ...doc.features,
    {
      id: 'skc' as FeatureId,
      type: 'sketch',
      name: 'SlotSketch',
      suppressed: false,
      inputs: sketchInputs(originPlaneRef('origin:xy'), b.sketch),
    },
    {
      id: 'cut' as FeatureId,
      type: 'extrude',
      name: 'Slot',
      suppressed: false,
      inputs: extrudeInputs(
        [{ kind: 'profile', id: profileRefId('skc' as FeatureId, region?.id ?? '') }],
        {
          direction: 'symmetric',
          distance: '30 mm',
          operation: 'cut',
        },
      ),
    },
  ];
  return { ...doc, features, timelineMarker: features.length };
}

/** Plates with a copy of a small plates design inserted (an isolated expansion, ADR-0140 §3). */
function withInsert(): ExtrudoDocument {
  const host = plates(3);
  const payload = insertDesignPayload(
    host,
    plates(2, 70),
    {
      feature: 'ins' as FeatureId,
      component: 'cmp-ins' as ComponentId,
      attachment: () => 'att-ins' as AttachmentId,
    },
    'Part',
  );
  const doc = applyCommand(host, insertDesign(payload)).doc;
  // A plate after the insert, so edits before and after it both happen.
  const features = [...doc.features, ...plateFeatures(9, 400, '6 mm')];
  return { ...doc, features, timelineMarker: features.length };
}

/** Plates with a feature that fails (its profile gone) and one the person stopped. */
function withFailures(): ExtrudoDocument {
  const doc = plates(4);
  const features = doc.features.map(
    (f): Feature =>
      f.id === 'ex1'
        ? {
            ...f,
            inputs: {
              ...f.inputs,
              profiles: {
                kind: 'ref' as const,
                refs: [{ kind: 'profile' as const, id: 'sk1/gone' }],
              },
            },
          }
        : f,
  );
  return { ...doc, features };
}

// ------------------------------------------------------------------------------- comparison

/** An engine with the meshes it was sent, held by version like the Recomputer holds them. */
function client(engine: Engine, stopped: readonly FeatureId[] = []) {
  let held = new Map<string, { version: string; mesh: BodyMesh }>();
  return {
    async run(doc: ExtrudoDocument) {
      const have = Object.fromEntries([...held].map(([id, h]) => [id, h.version]));
      const request: RecomputeRequest = { doc, have, ...(stopped.length > 0 && { stopped }) };
      const result = await engine.recompute(request);
      if (result.status !== 'done') throw new Error(result.status);
      const now = new Map<string, { version: string; mesh: BodyMesh }>();
      for (const body of result.bodies) {
        const kept = held.get(body.id);
        const mesh = body.mesh ?? (kept?.version === body.version ? kept.mesh : undefined);
        // The engine left out a mesh the caller doesn't hold: `have` and the versions disagree.
        if (!mesh) throw new Error(`no mesh for ${body.id}`);
        now.set(body.id, { version: body.version, mesh });
      }
      held = now;
      return { result, held: now, sent: result.bodies.filter((b) => b.mesh).length };
    },
  };
}

/** What differs between a result and the one from a cleared engine. */
function differences(
  a: { result: Done; held: Map<string, { mesh: BodyMesh }> },
  b: { result: Done; held: Map<string, { mesh: BodyMesh }> },
): string[] {
  const out: string[] = [];
  if (JSON.stringify(a.result.features) !== JSON.stringify(b.result.features)) out.push('statuses');
  if (JSON.stringify(a.result.origins) !== JSON.stringify(b.result.origins)) out.push('origins');
  if (JSON.stringify(a.result.reports) !== JSON.stringify(b.result.reports)) out.push('reports');
  const ids = (r: Done) => r.bodies.map((x) => x.id).join(',');
  if (ids(a.result) !== ids(b.result)) out.push(`bodies ${ids(a.result)} vs ${ids(b.result)}`);
  for (const [id, { mesh }] of b.held) {
    const mine = a.held.get(id)?.mesh;
    if (mine && !sameMesh(mine, mesh)) out.push(`mesh ${id}`);
  }
  return out;
}

// ------------------------------------------------------------------------------- edits

/** A seeded generator (mulberry32). */
function random(seed: number) {
  let s = seed;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const KINDS = [
  'length',
  'suppress',
  'marker',
  'operation',
  'extent',
  'profile',
  'reorder',
  'delete',
  'insert',
  'undo',
  'parameter',
] as const;
type Kind = (typeof KINDS)[number];

/** One edit of `kind` to `doc`, or undefined when the design has nothing it applies to. */
function edit(
  kind: Kind,
  doc: ExtrudoDocument,
  rand: () => number,
  history: readonly ExtrudoDocument[],
  deleted: Feature[],
): ExtrudoDocument | undefined {
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)];
  const set = (id: string, change: (f: Feature) => Feature) => ({
    ...doc,
    features: doc.features.map((f) => (f.id === id ? change(f) : f)),
  });
  const extrudes = doc.features.filter((f) => f.type === 'extrude');
  switch (kind) {
    case 'length': {
      const f = pick(
        doc.features.filter((x) =>
          Object.values(x.inputs).some((v) => v?.kind === 'expr' && v.unit === 'length'),
        ),
      );
      if (!f) return undefined;
      const [name, input] = Object.entries(f.inputs).find(
        ([, v]) => v?.kind === 'expr' && v.unit === 'length',
      ) as [string, { kind: 'expr'; expr: string; unit: 'length' }];
      const factor = pick([0.8, 1.1, 1.25, 0.95]);
      return set(f.id, (x) => ({
        ...x,
        inputs: { ...x.inputs, [name]: { ...input, expr: `(${input.expr}) * ${factor}` } },
      }));
    }
    case 'suppress': {
      const f = pick(doc.features);
      return f && set(f.id, (x) => ({ ...x, suppressed: !x.suppressed }));
    }
    case 'marker':
      return { ...doc, timelineMarker: 1 + Math.floor(rand() * doc.features.length) };
    case 'operation': {
      const f = pick(extrudes);
      const op = pick(['new-body', 'join', 'cut', 'intersect', 'new-body'] as const) ?? 'new-body';
      return (
        f &&
        set(f.id, (x) => ({
          ...x,
          inputs: { ...x.inputs, operation: { kind: 'enum', value: op } },
        }))
      );
    }
    case 'extent': {
      // Not "through all" (see the top of the file): the direction.
      const f = pick(extrudes);
      const direction = pick(['one-side', 'symmetric'] as const) ?? 'one-side';
      return (
        f &&
        set(f.id, (x) => ({
          ...x,
          inputs: { ...x.inputs, direction: { kind: 'enum', value: direction } },
        }))
      );
    }
    case 'profile': {
      // Another region of the same sketch: a hole instead of the plate, or the reverse.
      const f = pick(
        extrudes.filter((x) => {
          const ref = (x.inputs as ExtrudeInputs).profiles?.refs[0];
          return (
            ref?.kind === 'profile' &&
            doc.features.some((s) => s.id === (ref.id.split('/')[0] as string))
          );
        }),
      );
      if (!f) return undefined;
      const ref = (f.inputs as ExtrudeInputs).profiles?.refs[0];
      const sketchId = (ref?.id.split('/')[0] ?? '') as FeatureId;
      const sketch = doc.features.find((s) => s.id === sketchId);
      const data = (sketch?.inputs.sketch as { data?: unknown } | undefined)?.data;
      if (!data) return undefined;
      const regions = detectProfiles(data as never);
      const other = pick(regions.filter((r) => profileRefId(sketchId, r.id) !== ref?.id));
      if (!other) return undefined;
      return set(f.id, (x) => ({
        ...x,
        inputs: {
          ...x.inputs,
          profiles: {
            kind: 'ref',
            refs: [{ kind: 'profile', id: profileRefId(sketchId, other.id) }],
          },
        },
      }));
    }
    case 'reorder': {
      const at = Math.floor(rand() * doc.features.length);
      const to = Math.floor(rand() * doc.features.length);
      const features = doc.features.filter((_, i) => i !== at);
      features.splice(to, 0, doc.features[at] as Feature);
      return { ...doc, features };
    }
    case 'delete': {
      const at = Math.floor(rand() * doc.features.length);
      const gone = doc.features[at];
      if (!gone || doc.features.length < 3) return undefined;
      deleted.push(gone);
      const features = doc.features.filter((_, i) => i !== at);
      return { ...doc, features, timelineMarker: Math.min(doc.timelineMarker, features.length) };
    }
    case 'insert': {
      const back = deleted.pop();
      const features = [...doc.features];
      const at = Math.floor(rand() * (features.length + 1));
      if (back) features.splice(at, 0, back);
      else features.push(...plateFeatures(50 + history.length, 600 + 70 * history.length, '5 mm'));
      return { ...doc, features, timelineMarker: features.length };
    }
    case 'undo':
      return history.length > 1 ? pick(history.slice(0, -1)) : undefined;
    case 'parameter': {
      if (!doc.parameters?.length) {
        return {
          ...doc,
          parameters: [{ id: 'p-t', name: 't', expression: '4 mm', unit: 'length' }],
        } as ExtrudoDocument;
      }
      return {
        ...doc,
        parameters: doc.parameters.map((p, i) =>
          i === 0 ? { ...p, expression: `(${p.expression}) * ${pick([0.9, 1.2])}` } : p,
        ),
      };
    }
  }
}

interface Run {
  steps: number;
  compared: number;
  problems: string[];
  /** Feature evaluations of the cached engine, and of the cleared one. */
  evaluated: [number, number];
  /** The features in error before any edit (a design meant to compute has none). */
  initialErrors: string[];
  kinds: Set<Kind>;
}

/** `steps` edits of `doc` (each kind at least once), each checked against a cleared engine. */
async function differential(
  doc: ExtrudoDocument,
  steps: number,
  seed: number,
  options: {
    registry?: () => FeatureRegistry<KernelFeatureDefinition>;
    engine?: typeof RecomputeEngine;
    stopped?: readonly FeatureId[];
  } = {},
): Promise<Run> {
  // The engine under test (with a fault, for the negative controls) and the reference, always the
  // kernel's own engine and features with a cleared cache.
  const Make = options.engine ?? RecomputeEngine;
  const registry = options.registry ?? kernelFeatures;
  const cached = new Make(kernel, registry(), { strictLeaks: true });
  const cleared = new RecomputeEngine(kernel, kernelFeatures(), { strictLeaks: true });
  const run: Run = {
    steps: 0,
    compared: 0,
    problems: [],
    evaluated: [0, 0],
    kinds: new Set(),
    initialErrors: [],
  };
  const rand = random(seed);
  const history: ExtrudoDocument[] = [doc];
  const deleted: Feature[] = [];
  const a = client(cached, options.stopped);
  try {
    let current = doc;
    for (let step = 0; step <= steps; step++) {
      if (step > 0) {
        let kind = (KINDS[step - 1] ?? KINDS[Math.floor(rand() * KINDS.length)]) as Kind;
        let next = edit(kind, current, rand, history, deleted);
        // The first pass gives each kind a few tries (a random pick may find nothing to edit);
        // after that, or when the design has nothing for it, another kind: every step edits.
        for (let tries = 0; !next && step <= KINDS.length && tries < 5; tries++) {
          next = edit(kind, current, rand, history, deleted);
        }
        for (let tries = 0; !next && tries < 20; tries++) {
          kind = KINDS[Math.floor(rand() * KINDS.length)] as Kind;
          next = edit(kind, current, rand, history, deleted);
        }
        if (!next) throw new Error(`step ${step}: no edit applies`);
        current = next;
        history.push(current);
        run.kinds.add(kind);
      }
      const mine = await a.run(current);
      cleared.clear();
      const fresh = await client(cleared, options.stopped).run(current);
      if (step === 0) {
        run.initialErrors = Object.entries(mine.result.features)
          .filter(([, status]) => status.status === 'error')
          .map(([id]) => id);
      }
      run.evaluated[0] += mine.result.stats.evaluated.length;
      run.evaluated[1] += fresh.result.stats.evaluated.length;
      for (const d of differences(mine, fresh)) run.problems.push(`step ${step}: ${d}`);
      run.compared++;
      run.steps = step;
    }
  } finally {
    cached.clear();
    cleared.clear();
  }
  return run;
}

// ------------------------------------------------------------------------------- the proof

/** A design, how to make it, the features stopped in it, and the ones in error before any edit. */
const DESIGNS: [string, () => ExtrudoDocument, FeatureId[], string[]][] = [
  ['plates with a parameter', () => plates(5), [], []],
  ['overlapping plates and a cut through them', () => platesCut(), [], []],
  ['b2 storage box', () => fixture(b2), [], []],
  ['b3 phone stand', () => fixture(b3), [], []],
  ['b4 box with lid', () => fixture(b4), [], []],
  ['the hinge (components)', () => fixture(hinge), [], []],
  ['plates and an inserted design (an isolated expansion)', withInsert, [], []],
  ['a failed feature and a stopped one', withFailures, ['ex2' as FeatureId], ['ex1', 'ex2']],
];

describe('add access: the cached engine gives what a cleared one gives (ADR-0024, `add` access)', () => {
  it.each(DESIGNS)(
    '%s, 40 seeded edits',
    { timeout: 900_000 },
    async (_n, make, stopped, errors) => {
      const run = await differential(make(), 40, 2511, { stopped });
      expect(run.initialErrors.sort()).toEqual(errors);
      expect(run.problems).toEqual([]);
      // Every kind of edit happened: an extrude's operation and direction where the design has
      // extrudes (b4 and the hinge get theirs only from inserted plates), a profile switched where
      // a sketch has another region; and the cache saved work.
      const own: Kind[] = ['operation', 'extent', 'profile'];
      const extrudes = make().features.some((f) => f.type === 'extrude');
      for (const kind of KINDS.filter((k) => !own.includes(k))) expect(run.kinds).toContain(kind);
      if (extrudes)
        for (const kind of ['operation', 'extent'] as const) expect(run.kinds).toContain(kind);
      expect(run.compared).toBe(41);
      expect(run.evaluated[0]).toBeLessThan(run.evaluated[1]);
    },
  );
});

// ------------------------------------------------------------------------------- negative controls

/** The kernel's features, with the extrude's `bodyAccess` replaced. */
function withExtrudeAccess(access: (inputs: ExtrudeInputs) => 'add' | 'write') {
  return () => {
    const registry = new FeatureRegistry<KernelFeatureDefinition>();
    for (const definition of kernelFeatures().list()) {
      registry.register(
        definition.type === 'extrude'
          ? ({ ...definition, bodyAccess: access } as unknown as KernelFeatureDefinition)
          : definition,
      );
    }
    return registry;
  };
}

/**
 * The engine with one deliberate fault: `fault` (a line of `engine.ts`) replaced by `by`. Made from
 * the engine's own source in a temporary file (its imports pointed back at the repository), so the
 * engine itself has no switch for it.
 */
async function faultyEngine(
  fault: string,
  by: string,
): Promise<{ engine: typeof RecomputeEngine; remove: () => void }> {
  // Node's own modules, untyped: this package's sources don't take Node's types.
  const load = (name: string) => import(/* @vite-ignore */ name);
  const fs = await load('node:fs');
  const os = await load('node:os');
  const path = await load('node:path');
  const url = await load('node:url');
  const here: string = path.dirname(url.fileURLToPath(import.meta.url));
  let source: string = fs.readFileSync(path.join(here, 'engine.ts'), 'utf8');
  if (!source.includes(fault)) throw new Error(`"${fault}" moved: update this control`);
  source = source.replace(fault, by);
  source = source.replace(
    /from '(\.\.?\/[^']+)'/g,
    (_m: string, to: string) => `from '${path.join(here, to)}'`,
  );
  source = source.replace(/from '@extrudo\/([a-z]+)'/g, (_m: string, name: string) => {
    return `from '${path.join(here, '../../..', name, 'src/index.ts')}'`;
  });
  const file: string = path.join(os.tmpdir(), `extrudo-engine-fault-${crypto.randomUUID()}.ts`);
  fs.writeFileSync(file, source);
  const module = (await import(/* @vite-ignore */ file)) as {
    RecomputeEngine: typeof RecomputeEngine;
  };
  return { engine: module.RecomputeEngine, remove: () => fs.rmSync(file, { force: true }) };
}

describe('the comparison catches a wrong `add` (negative controls)', () => {
  it('the body set not chained after an `add` fails it', { timeout: 600_000 }, async () => {
    const broken = await faultyEngine(
      "bodiesKey = hashOf('add', bodiesKey, key);",
      '// (chain left out)',
    );
    try {
      const run = await differential(platesCut(), 20, 3, { engine: broken.engine });
      expect(run.problems.length).toBeGreaterThan(0);
    } finally {
      broken.remove();
    }
  });

  it('the extrude saying `add` for a join fails it', { timeout: 600_000 }, async () => {
    // A join finds the bodies it touches by going through them all, which the fall-back doesn't
    // notice (a look-up by ID it does, a counter below): the comparison must.
    const doc = platesCut();
    const joined = {
      ...doc,
      features: doc.features.map((f) =>
        f.id === 'ex1'
          ? {
              ...f,
              inputs: { ...f.inputs, operation: { kind: 'enum' as const, value: 'join' as const } },
            }
          : f,
      ),
    };
    const run = await differential(joined, 10, 7, {
      registry: withExtrudeAccess((inputs) => {
        const operation = (inputs as ExtrudeInputs).operation?.value ?? 'new-body';
        return operation === 'join' || operation === 'new-body' ? 'add' : 'write';
      }),
    });
    expect(run.problems.length).toBeGreaterThan(0);
  });
});

// ------------------------------------------------------------------------------- counters

describe('add access: what an edit costs', () => {
  it('an edit of the first of six independent plates evaluates one feature and sends one mesh', {
    timeout: 120_000,
  }, async () => {
    const engine = new RecomputeEngine(kernel, kernelFeatures(), { strictLeaks: true });
    try {
      const c = client(engine);
      const doc = plates(6);
      await c.run(doc);
      const edited = {
        ...doc,
        features: doc.features.map((f) =>
          f.id === 'ex0'
            ? {
                ...f,
                inputs: {
                  ...f.inputs,
                  distance: { kind: 'expr' as const, expr: '9 mm', unit: 'length' as const },
                },
              }
            : f,
        ),
      };
      const after = await c.run(edited);
      expect(after.result.stats.evaluated).toEqual(['ex0']);
      expect(after.sent).toBe(1);
    } finally {
      engine.clear();
    }
  });

  it('edits the predicate leaves out still run every feature they reach', {
    timeout: 120_000,
  }, async () => {
    const engine = new RecomputeEngine(kernel, kernelFeatures(), { strictLeaks: true });
    try {
      const c = client(engine);
      const doc = plates(4);
      await c.run(doc);
      const set = (id: string, more: Feature['inputs']): ExtrudoDocument => ({
        ...doc,
        features: doc.features.map((f) =>
          f.id === id ? { ...f, inputs: { ...f.inputs, ...more } } : f,
        ),
      });
      // A join, "through all", or picked bodies on the first plate: it reads the bodies before it,
      // so it and every later plate run again (their keys hold the body set).
      for (const [edited, label] of [
        [set('ex0', { operation: { kind: 'enum', value: 'join' } }), 'join'],
        [set('ex0', { extent: { kind: 'enum', value: 'through-all' } }), 'through all'],
        [
          set('ex1', { bodies: { kind: 'ref', refs: [{ kind: 'body', id: 'ex0:0' }] } }),
          'picked body',
        ],
      ] as const) {
        const r = await c.run(edited);
        expect(r.result.stats.evaluated.length, label).toBeGreaterThan(0);
        await c.run(doc);
      }
      expect(addsOnly(doc.features[1]?.inputs as ExtrudeInputs)).toBe(true);
      expect(
        addsOnly(
          set('ex0', { operation: { kind: 'enum', value: 'join' } }).features[1]
            ?.inputs as ExtrudeInputs,
        ),
      ).toBe(false);
    } finally {
      engine.clear();
    }
  });

  it('a feature that says `add` and reads a body runs again as `write`, with the same result', {
    timeout: 120_000,
  }, async () => {
    // The extrude says `add` even for a join: its `get` of a body is noticed.
    const registry = withExtrudeAccess(() => 'add');
    const wrong = new RecomputeEngine(kernel, registry(), { strictLeaks: true });
    const right = new RecomputeEngine(kernel, kernelFeatures(), { strictLeaks: true });
    try {
      const doc = plates(2);
      const join = {
        ...doc,
        features: doc.features.map((f) =>
          f.id === 'ex1'
            ? {
                ...f,
                inputs: {
                  ...f.inputs,
                  bodies: { kind: 'ref' as const, refs: [{ kind: 'body' as const, id: 'ex0:0' }] },
                  operation: { kind: 'enum' as const, value: 'join' as const },
                },
              }
            : f,
        ),
      };
      const a = await client(wrong).run(join);
      const b = await client(right).run(join);
      expect(differences(a, b)).toEqual([]);
      // ex1 was evaluated twice: once as `add` (it read a body), once as `write`.
      expect(a.result.stats.evaluated.filter((id) => id === 'ex1')).toHaveLength(2);
      // The second time the same inputs come, it runs as `write` straight away (cache hit).
      const again = await client(wrong).run(join);
      expect(again.result.stats.evaluated).toEqual([]);
    } finally {
      wrong.clear();
      right.clear();
    }
  });
});
