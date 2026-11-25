/**
 * Test support for `add` body access (ADR-0024's amendment on `add` access): the designs' plates,
 * an engine with the meshes it was sent (like the Recomputer), the comparison with a cleared
 * engine, and the seeded differential run with the edits every design takes. Used by
 * `add-access.test.ts` (the extrude) and `add-access-features.test.ts` (the other features that
 * answer `add`). Not part of the app.
 */
import {
  createDocument,
  type ExtrudeInputs,
  type ExtrudoDocument,
  extrudeInputs,
  type Feature,
  type FeatureId,
  FeatureRegistry,
  loadDocument,
  originPlaneRef,
  profileRefId,
  sketchInputs,
} from '@extrudo/core';
import { SketchBuilder } from '@extrudo/sketch/fixtures';
import { detectProfiles } from '@extrudo/sketch/profiles';
import { strFromU8, unzipSync } from 'fflate';
import { kernelFeatures } from '../features/index';
import type { Kernel } from '../kernel';
import { type BodyMesh, sameMesh } from '../mesh';
import { type EngineOptions, RecomputeEngine } from './engine';
import type { KernelFeatureDefinition, RecomputeRequest, RecomputeResult } from './types';

export type Done = Extract<RecomputeResult, { status: 'done' }>;
type Engine = Pick<RecomputeEngine, 'recompute' | 'clear'>;

// ------------------------------------------------------------------------------- designs

export function bytesOf(dataUrl: string): Uint8Array {
  const binary = atob(dataUrl.slice(dataUrl.indexOf(',') + 1));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

export function fixture(dataUrl: string): ExtrudoDocument {
  const files = unzipSync(bytesOf(dataUrl));
  const json = files['document.json'];
  if (!json) throw new Error('no document.json');
  return loadDocument(JSON.parse(strFromU8(json))).doc;
}

/** A 60 × 40 mm plate at `x`, with two holes (curved walls) or none. */
export function plateSketch(x: number, holes = true) {
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

export function sketchFeature(id: string, data: ReturnType<typeof plateSketch>): Feature {
  return {
    id: id as FeatureId,
    type: 'sketch',
    name: `Sketch ${id}`,
    suppressed: false,
    inputs: sketchInputs(originPlaneRef('origin:xy'), data),
  };
}

export function extrudeFeature(id: string, inputs: ExtrudeInputs): Feature {
  return { id: id as FeatureId, type: 'extrude', name: `Extrude ${id}`, suppressed: false, inputs };
}

/** A plate's sketch `sk<i>` and its New Body extrude `ex<i>` (the plate's region, with its holes). */
export function plateFeatures(
  i: number | string,
  x: number,
  distance: string,
  holes = true,
): Feature[] {
  const data = plateSketch(x, holes);
  const regions = detectProfiles(data);
  const outer = regions.reduce((a, r) => ((r.holes?.length ?? 0) > (a.holes?.length ?? 0) ? r : a));
  const sketch = `sk${i}` as FeatureId;
  return [
    sketchFeature(sketch, data),
    extrudeFeature(
      `ex${i}`,
      extrudeInputs([{ kind: 'profile', id: profileRefId(sketch, outer.id) }], { distance }),
    ),
  ];
}

/** `n` plates side by side (`gap` apart; under 60 they overlap), some lengths from a parameter. */
export function plates(n: number, gap = 80, holes = true): ExtrudoDocument {
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

/** `doc` with one feature's inputs changed. */
export function setInputs(
  doc: ExtrudoDocument,
  id: string,
  more: Feature['inputs'],
): ExtrudoDocument {
  return {
    ...doc,
    features: doc.features.map((f) =>
      f.id === id ? { ...f, inputs: { ...f.inputs, ...more } } : f,
    ),
  };
}

export const length = (expr: string) => ({ kind: 'expr' as const, expr, unit: 'length' as const });
export const choice = <T extends string>(value: T) => ({ kind: 'enum' as const, value });
export const refs = <T>(list: T[]) => ({ kind: 'ref' as const, refs: list });

/** The kernel's features, with one feature type's `bodyAccess` replaced. */
export function withAccess(type: string, access: (inputs: never) => 'add' | 'write') {
  return () => {
    const registry = new FeatureRegistry<KernelFeatureDefinition>();
    for (const definition of kernelFeatures().list()) {
      registry.register(
        definition.type === type
          ? ({ ...definition, bodyAccess: access } as unknown as KernelFeatureDefinition)
          : definition,
      );
    }
    return registry;
  };
}

// ------------------------------------------------------------------------------- comparison

/** An engine with the meshes it was sent, held by version like the Recomputer holds them. */
export function client(engine: Engine, stopped: readonly FeatureId[] = []) {
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
export function differences(
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

/**
 * The features one recompute evaluated twice: an `add` evaluation that read a body and ran
 * again as `write` (the fall-back). A right predicate makes none.
 */
export function fallbacks(result: Done): string[] {
  const seen = new Set<string>();
  const twice: string[] = [];
  for (const id of result.stats.evaluated) {
    if (seen.has(id)) twice.push(id);
    seen.add(id);
  }
  return twice;
}

export interface PairOptions {
  registry?: () => FeatureRegistry<KernelFeatureDefinition>;
  engine?: typeof RecomputeEngine;
  stopped?: readonly FeatureId[];
  /** More engine options for both engines (files, the OpenSCAD compiler). */
  options?: Omit<EngineOptions, 'strictLeaks'>;
}

/**
 * The engine under test, keeping its cache (with a fault for the negative controls), and the
 * reference: always the kernel's own engine and features, cleared before every step.
 */
export function pair(kernel: Kernel, options: PairOptions = {}) {
  const Make = options.engine ?? RecomputeEngine;
  const more = options.options ?? {};
  const cached = new Make(kernel, (options.registry ?? kernelFeatures)(), {
    ...more,
    strictLeaks: true,
  });
  const cleared = new RecomputeEngine(kernel, kernelFeatures(), { ...more, strictLeaks: true });
  const a = client(cached, options.stopped);
  return {
    async step(doc: ExtrudoDocument) {
      const mine = await a.run(doc);
      cleared.clear();
      const fresh = await client(cleared, options.stopped).run(doc);
      return { mine, fresh, problems: differences(mine, fresh) };
    },
    close() {
      cached.clear();
      cleared.clear();
    },
    /** The engine under test, for a control that changes what its cache holds. */
    cached: cached as RecomputeEngine,
  };
}

/** Each document in turn through `pair`: the differences and the features evaluated per step. */
export async function sequence(
  kernel: Kernel,
  docs: readonly ExtrudoDocument[],
  options: PairOptions = {},
) {
  const p = pair(kernel, options);
  try {
    const out: { problems: string[]; evaluated: string[]; result: Done }[] = [];
    for (const doc of docs) {
      const { mine, problems } = await p.step(doc);
      out.push({ problems, evaluated: [...mine.result.stats.evaluated], result: mine.result });
    }
    return out;
  } finally {
    p.close();
  }
}

// ------------------------------------------------------------------------------- edits

/** A seeded generator (mulberry32). */
export function random(seed: number) {
  let s = seed;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Edited {
  doc: ExtrudoDocument;
  /** The feature an edit of one of its inputs changed, for the access before and after. */
  feature?: FeatureId;
}

/** The edits every design takes, whatever its features. */
export const GENERIC_KINDS = [
  'insert',
  'length',
  'suppress',
  'marker',
  'reorder',
  'delete',
  'undo',
  'parameter',
] as const;
export type GenericKind = (typeof GENERIC_KINDS)[number];

/**
 * One edit of a generic kind, or undefined when the design has nothing it applies to. `insert`
 * puts back the last feature deleted, or adds what `make(n, x)` makes (by default a plate).
 */
export function genericEdit(
  kind: GenericKind,
  doc: ExtrudoDocument,
  rand: () => number,
  history: readonly ExtrudoDocument[],
  deleted: Feature[],
  make: (n: number, x: number) => Feature[] = (n, x) => plateFeatures(n, x, '5 mm'),
): Edited | undefined {
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)];
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
      return {
        doc: setInputs(doc, f.id, { [name]: { ...input, expr: `(${input.expr}) * ${factor}` } }),
      };
    }
    case 'suppress': {
      const f = pick(doc.features);
      return (
        f && {
          doc: {
            ...doc,
            features: doc.features.map((x) => (x === f ? { ...x, suppressed: !x.suppressed } : x)),
          },
        }
      );
    }
    case 'marker':
      return { doc: { ...doc, timelineMarker: 1 + Math.floor(rand() * doc.features.length) } };
    case 'reorder': {
      const at = Math.floor(rand() * doc.features.length);
      const to = Math.floor(rand() * doc.features.length);
      const features = doc.features.filter((_, i) => i !== at);
      features.splice(to, 0, doc.features[at] as Feature);
      return { doc: { ...doc, features } };
    }
    case 'delete': {
      const at = Math.floor(rand() * doc.features.length);
      const gone = doc.features[at];
      if (!gone || doc.features.length < 3) return undefined;
      deleted.push(gone);
      const features = doc.features.filter((_, i) => i !== at);
      return {
        doc: { ...doc, features, timelineMarker: Math.min(doc.timelineMarker, features.length) },
      };
    }
    case 'insert': {
      const back = deleted.pop();
      const features = [...doc.features];
      const at = Math.floor(rand() * (features.length + 1));
      if (back) features.splice(at, 0, back);
      else features.push(...make(50 + history.length, 600 + 70 * history.length));
      return { doc: { ...doc, features, timelineMarker: features.length } };
    }
    case 'undo': {
      const back = history.length > 1 ? pick(history.slice(0, -1)) : undefined;
      return back && { doc: back };
    }
    case 'parameter': {
      if (!doc.parameters?.length) {
        return {
          doc: {
            ...doc,
            parameters: [{ id: 'p-t', name: 't', expression: '4 mm', unit: 'length' }],
          } as ExtrudoDocument,
        };
      }
      return {
        doc: {
          ...doc,
          parameters: doc.parameters.map((p, i) =>
            i === 0 ? { ...p, expression: `(${p.expression}) * ${pick([0.9, 1.2])}` } : p,
          ),
        },
      };
    }
  }
}

export interface Run<K extends string = string> {
  steps: number;
  compared: number;
  problems: string[];
  /** Feature evaluations of the cached engine, and of the cleared one. */
  evaluated: [number, number];
  /** `step <n>: <feature>` for every feature a recompute evaluated twice (`fallbacks`). */
  fallbacks: string[];
  /** The features in error before any edit (a design meant to compute has none). */
  initialErrors: string[];
  kinds: Set<K>;
  /** `<kind>: <access before>→<access after>` of the feature each input edit changed. */
  flips: Set<string>;
  /** The kinds whose edited feature then computed (status `ok`) at least once. */
  computed: Set<K>;
}

export interface DifferentialOptions<K extends string> extends PairOptions {
  /** The kinds of edit; the first pass takes them in this order. */
  kinds: readonly K[];
  /** One edit of `kind`, or undefined when the design has nothing it applies to. */
  edit(
    kind: K,
    doc: ExtrudoDocument,
    rand: () => number,
    history: readonly ExtrudoDocument[],
    deleted: Feature[],
  ): Edited | undefined;
  /** The access a feature answers, for the flips. */
  access(f: Feature | undefined): string;
}

/** `steps` edits of `doc` (each kind at least once), each checked against a cleared engine. */
export async function differential<K extends string>(
  kernel: Kernel,
  doc: ExtrudoDocument,
  steps: number,
  seed: number,
  options: DifferentialOptions<K>,
): Promise<Run<K>> {
  const { kinds: KINDS, edit, access } = options;
  const p = pair(kernel, options);
  const run: Run<K> = {
    steps: 0,
    compared: 0,
    problems: [],
    evaluated: [0, 0],
    fallbacks: [],
    kinds: new Set(),
    initialErrors: [],
    flips: new Set(),
    computed: new Set(),
  };
  const rand = random(seed);
  const history: ExtrudoDocument[] = [doc];
  const deleted: Feature[] = [];
  try {
    let current = doc;
    let edited: [K, FeatureId] | undefined;
    for (let step = 0; step <= steps; step++) {
      if (step > 0) {
        let kind = (KINDS[step - 1] ?? KINDS[Math.floor(rand() * KINDS.length)]) as K;
        let next = edit(kind, current, rand, history, deleted);
        // The first pass gives each kind a few tries (a random pick may find nothing to edit);
        // after that, or when the design has nothing for it, another kind: every step edits.
        for (let tries = 0; !next && step <= KINDS.length && tries < 5; tries++) {
          next = edit(kind, current, rand, history, deleted);
        }
        for (let tries = 0; !next && tries < 20; tries++) {
          kind = KINDS[Math.floor(rand() * KINDS.length)] as K;
          next = edit(kind, current, rand, history, deleted);
        }
        if (!next) throw new Error(`step ${step}: no edit applies`);
        edited = next.feature === undefined ? undefined : [kind, next.feature];
        if (next.feature !== undefined) {
          const id = next.feature;
          const before = access(current.features.find((f) => f.id === id));
          const after = access(next.doc.features.find((f) => f.id === id));
          run.flips.add(`${kind}: ${before}→${after}`);
        }
        current = next.doc;
        history.push(current);
        run.kinds.add(kind);
      }
      const { mine, fresh, problems } = await p.step(current);
      if (edited && mine.result.features[edited[1]]?.status === 'ok') run.computed.add(edited[0]);
      if (step === 0) {
        run.initialErrors = Object.entries(mine.result.features)
          .filter(([, status]) => status.status === 'error')
          .map(([id]) => id);
      }
      run.evaluated[0] += mine.result.stats.evaluated.length;
      run.evaluated[1] += fresh.result.stats.evaluated.length;
      for (const id of [...fallbacks(mine.result), ...fallbacks(fresh.result)]) {
        run.fallbacks.push(`step ${step}: ${id}`);
      }
      for (const d of problems) run.problems.push(`step ${step}: ${d}`);
      run.compared++;
      run.steps = step;
    }
  } finally {
    p.close();
  }
  return run;
}
