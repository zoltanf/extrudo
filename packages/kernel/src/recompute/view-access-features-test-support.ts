/**
 * Test support for `view` access beyond the fillet and the chamfer (ADR-0024's amendment on
 * `view` access): faces picked by geometry, a design built step by step with references from a
 * recompute, the edits that take each term of the rule both ways and the features' own inputs,
 * the seeded proof and the counters every feature's file runs. Not part of the app.
 */
import {
  type BodyId,
  constructionRef,
  type EnumInput,
  type ExtrudoDocument,
  type Feature,
  type FeatureId,
  filletInputs,
  type GeomRef,
  type Input,
  originPlaneRef,
  type RefInput,
} from '@extrudo/core';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { Kernel } from '../kernel';
import { loadManifold } from '../manifold';
import type { ShapeDescription } from '../naming/description';
import { loadOcct } from '../occt/load';
import {
  choice,
  differential as differentialOf,
  type Edited,
  fallbacks,
  GENERIC_KINDS,
  genericEdit,
  type PairOptions,
  sequence as sequenceOf,
  setInputs,
} from './add-access-test-support';
import { RecomputeEngine } from './engine';
import type { BodyAccess } from './types';
import { accessOf, plate, twinRegistry } from './view-access-test-support';

let kernel: Kernel;

/** The kernel every helper here uses: loaded before a file's tests, its shapes checked after. */
export function useKernel() {
  beforeAll(async () => {
    kernel = new Kernel(await loadOcct());
    kernel.enableMeshes(await loadManifold());
  }, 120_000);
  afterAll(() => {
    expect(kernel.stats().liveShapes).toBe(0);
  });
}

export const TYPES = ['shell', 'draft', 'offsetFace', 'removeFaces', 'thread'] as const;

// ------------------------------------------------------------------------------- designs

export type Pick = (d: ShapeDescription) => number[];
export type Face = ShapeDescription['faces'][number];

export const up = (f: Face) => f.type === 'plane' && (f.direction?.[2] ?? 0) > 0.99;
export const down = (f: Face) => f.type === 'plane' && (f.direction?.[2] ?? 0) < -0.99;
export const side = (f: Face) => f.type === 'plane' && Math.abs(f.direction?.[2] ?? 1) < 0.01;
/** The faces `test` picks, in index order. */
export const faces =
  (test: (f: Face) => boolean): Pick =>
  (d) =>
    d.faces.flatMap((f, i) => (test(f) ? [i] : []));
/** The top face: flat, facing up, the highest. */
export const top: Pick = (d) => {
  const all = faces(up)(d);
  const z = (i: number) => d.faces[i]?.centroid[2] ?? 0;
  return all.sort((a, b) => z(b) - z(a)).slice(0, 1);
};

export interface Step {
  /** The feature, inserted after `after`. */
  id: string;
  after: string;
  /** Its inputs from the face references `refs` gives at the end of the design so far. */
  make(refs: (body: string, pick: Pick) => GeomRef[]): Feature;
}

/** `doc` with each step's feature added in turn, its references taken from a recompute before it. */
export async function build(doc: ExtrudoDocument, steps: Step[]): Promise<ExtrudoDocument> {
  let current = doc;
  for (const step of steps) {
    const engine = new RecomputeEngine(kernel, twinRegistry()(), { strictLeaks: true });
    try {
      const done = await engine.recompute({ doc: current });
      if (done.status !== 'done') throw new Error('cancelled');
      const refs = (body: string, pick: Pick) => {
        const shape = engine.latestBody(body as BodyId);
        if (shape === undefined) throw new Error(`no body ${body}`);
        return pick(kernel.describe(shape)).map((i) => {
          const ref = engine.reference(body as BodyId, 'face', i);
          if (!ref) throw new Error(`no face ${i} on ${body}`);
          return ref;
        });
      };
      const feature = step.make(refs);
      const features = [...current.features];
      features.splice(features.findIndex((f) => f.id === step.after) + 1, 0, feature);
      current = { ...current, features, timelineMarker: features.length };
    } finally {
      engine.clear();
    }
  }
  return current;
}

export const feature = (id: string, type: string, inputs: Feature['inputs']): Feature => ({
  id: id as FeatureId,
  type,
  name: `${type} ${id}`,
  suppressed: false,
  inputs,
});

/** A fillet of the edges `pick` gives (by index) on `body`, from a recompute. */
export async function filletAfter(
  doc: ExtrudoDocument,
  id: string,
  after: string,
  body: string,
  radius = '1 mm',
) {
  const engine = new RecomputeEngine(kernel, twinRegistry()(), { strictLeaks: true });
  try {
    await engine.recompute({ doc });
    const shape = engine.latestBody(body as BodyId);
    if (shape === undefined) throw new Error(`no body ${body}`);
    // The top face's straight edges.
    const d = kernel.describe(shape);
    const [topFace] = top(d);
    const edges = d.edges.flatMap((e, i) =>
      e.type === 'line' && topFace !== undefined && e.faces.includes(topFace) ? [i] : [],
    );
    const refs = edges.map((i) => engine.reference(body as BodyId, 'edge', i) as GeomRef);
    const features = [...doc.features];
    features.splice(
      features.findIndex((f) => f.id === after) + 1,
      0,
      feature(id, 'fillet', filletInputs([{ edges: refs, radius }])),
    );
    return { ...doc, features, timelineMarker: features.length };
  } finally {
    engine.clear();
  }
}

// ------------------------------------------------------------------------------- edits

/**
 * The terms of the rule for a view, each both ways, on the design's first feature of `TYPES`: a
 * face no body has by its name and back (`lose`, `find`), no faces and back (`empty`, `fill`);
 * per design: a body picked to hollow and back, one that doesn't exist and back (`pick-body`,
 * `unpick-body`, `lose-body`, `found-body`); the neutral plane cycling XY, a construction plane
 * and a face of the plate (`plane`); the twins swapping places and one suppressed and back. Then
 * the features' own inputs and the generic edits.
 */
export const RULE = ['lose', 'find', 'empty', 'fill'] as const;
export type Kind =
  | (typeof RULE)[number]
  | 'pick-body'
  | 'unpick-body'
  | 'lose-body'
  | 'found-body'
  | 'plane'
  | 'flip'
  | 'keep'
  | 'hand'
  | 'extent'
  | 'swap'
  | 'twin-off'
  | 'twin-on'
  | 'operation'
  | (typeof GENERIC_KINDS)[number];

export const LOST: GeomRef = { kind: 'face', id: 'f[nowhere]' };

export function edit(
  kind: Kind,
  doc: ExtrudoDocument,
  rand: () => number,
  history: readonly ExtrudoDocument[],
  deleted: Feature[],
  original: ExtrudoDocument,
  targetId?: string,
): Edited | undefined {
  const pickOne = <T>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)];
  const target = original.features.find((f) =>
    targetId === undefined ? (TYPES as readonly string[]).includes(f.type) : f.id === targetId,
  );
  const now = target && doc.features.find((f) => f.id === target.id);
  const list = now && (now.inputs.faces as RefInput | undefined)?.refs;
  const own = target && (target.inputs.faces as RefInput | undefined)?.refs;
  const set = (more: Feature['inputs']): Edited | undefined =>
    now && { doc: setInputs(doc, now.id, more), feature: now.id };
  const of = (type: string) => doc.features.filter((f) => f.type === type);
  switch (kind) {
    case 'lose':
      if (!list?.length || list[0]?.id === LOST.id) return undefined;
      return set({ faces: { kind: 'ref', refs: [LOST, ...list.slice(1)] } });
    case 'find':
      if (!own || !list || JSON.stringify(list) === JSON.stringify(own)) return undefined;
      return set({ faces: { kind: 'ref', refs: own } });
    case 'empty':
      return list?.length ? set({ faces: { kind: 'ref', refs: [] } }) : undefined;
    case 'fill':
      return own && list && list.length === 0
        ? set({ faces: { kind: 'ref', refs: own } })
        : undefined;
    case 'pick-body':
    case 'unpick-body':
    case 'lose-body':
    case 'found-body': {
      if (now?.type !== 'shell') return undefined;
      const bodies = (now.inputs.bodies as RefInput | undefined)?.refs ?? [];
      const ids = bodies.map((r) => r.id);
      const want =
        kind === 'pick-body'
          ? ids.length === 0 && ['ex1:0']
          : kind === 'unpick-body'
            ? ids.length > 0 && ids[0] !== 'gone:0' && []
            : kind === 'lose-body'
              ? ids.length === 0 && ['gone:0']
              : ids[0] === 'gone:0' && [];
      if (!want) return undefined;
      return set({ bodies: { kind: 'ref', refs: want.map((id) => ({ kind: 'body', id })) } });
    }
    case 'plane': {
      if (now?.type !== 'draft') return undefined;
      const at = (now.inputs.plane as RefInput).refs[0];
      const next: GeomRef =
        at?.kind === 'face'
          ? originPlaneRef('origin:xy')
          : at?.id === 'origin:xy'
            ? (constructionRef({ id: 'cp' as FeatureId, type: 'offsetPlane' }) as GeomRef)
            : // The plate's bottom face, a face reference: its body is in the view.
              { kind: 'face', id: bottomOf(original, now.id) };
      return set({ plane: { kind: 'ref', refs: [next] } });
    }
    case 'flip': {
      const f = pickOne(of('draft'));
      if (!f) return undefined;
      const on = (f.inputs.flip as { value?: boolean } | undefined)?.value === true;
      return { doc: setInputs(doc, f.id, { flip: { kind: 'bool', value: !on } }), feature: f.id };
    }
    case 'keep': {
      const f = pickOne(of('offsetFace'));
      if (!f) return undefined;
      const on = (f.inputs.keepRounds as { value?: boolean } | undefined)?.value === true;
      return {
        doc: setInputs(doc, f.id, { keepRounds: { kind: 'bool', value: !on } }),
        feature: f.id,
      };
    }
    case 'hand':
    case 'extent': {
      const f = pickOne(of('thread'));
      if (!f) return undefined;
      const was = (f.inputs[kind] as EnumInput | undefined)?.value;
      const next =
        kind === 'hand' ? (was === 'left' ? 'right' : 'left') : was === 'full' ? 'length' : 'full';
      return { doc: setInputs(doc, f.id, { [kind]: choice(next) }), feature: f.id };
    }
    case 'swap': {
      const a = doc.features.find((f) => f.id === 'ta');
      const b = doc.features.find((f) => f.id === 'tb');
      if (!a || !b) return undefined;
      const swapped = setInputs(setInputs(doc, 'ta', { x: b.inputs.x as Input }), 'tb', {
        x: a.inputs.x as Input,
      });
      return { doc: swapped, feature: 'st' as FeatureId };
    }
    case 'twin-off':
    case 'twin-on': {
      const b = doc.features.find((f) => f.id === 'tb');
      if (!b || b.suppressed === (kind === 'twin-off')) return undefined;
      return {
        doc: {
          ...doc,
          features: doc.features.map((f) => (f === b ? { ...f, suppressed: !f.suppressed } : f)),
        },
        feature: 'st' as FeatureId,
      };
    }
    case 'operation': {
      const f = pickOne(doc.features.filter((x) => x.type === 'extrude' && /^ex\d+$/.test(x.id)));
      if (!f) return undefined;
      const was = (f.inputs.operation as EnumInput | undefined)?.value ?? 'new-body';
      const next = was === 'new-body' ? 'join' : was === 'join' ? 'cut' : 'new-body';
      return { doc: setInputs(doc, f.id, { operation: choice(next) }), feature: f.id };
    }
    default:
      return genericEdit(kind, doc, rand, history, deleted, (n, x) => plate(n, x, '5 mm', 5, 200));
  }
}

/** The name of the bottom face of the body a draft's first face is on, as the design has it. */
export const bottoms = new Map<string, string>();
export function bottomOf(doc: ExtrudoDocument, draft: string): string {
  const name = bottoms.get(`${doc.name}/${draft}`);
  if (name === undefined) throw new Error(`no bottom face recorded for ${draft}`);
  return name;
}

/** Records each draft's plate's bottom face name (for the `plane` edit). */
export async function withBottoms(doc: ExtrudoDocument): Promise<ExtrudoDocument> {
  const engine = new RecomputeEngine(kernel, twinRegistry()(), { strictLeaks: true });
  try {
    await engine.recompute({ doc });
    for (const f of doc.features.filter((x) => x.type === 'draft')) {
      const body = `ex${f.id.slice(2)}:0`;
      const shape = engine.latestBody(body as BodyId);
      if (shape === undefined) continue;
      const [i] = faces(down)(kernel.describe(shape));
      const ref = i === undefined ? undefined : engine.reference(body as BodyId, 'face', i);
      if (ref) bottoms.set(`${doc.name}/${f.id}`, ref.id);
    }
    return doc;
  } finally {
    engine.clear();
  }
}

export interface Design {
  name: string;
  make: () => Promise<ExtrudoDocument>;
  /** The kinds of edit, in the order of the first pass. */
  kinds: Kind[];
  /** Flips that must happen, besides the rule's four. */
  flips: string[];
  /** The feature the rule's edits go to (default: the first of the five). */
  target?: string;
}

export const BASE = [...RULE] as Kind[];
export const AFTER = ['operation', ...GENERIC_KINDS] as Kind[];

export const OPTIONS: PairOptions = {
  exact: true,
  registry: twinRegistry(),
  reference: twinRegistry(),
};

export function differential(
  design: Design,
  doc: ExtrudoDocument,
  steps: number,
  seed: number,
  options: PairOptions = {},
) {
  return differentialOf(kernel, doc, steps, seed, {
    ...OPTIONS,
    ...options,
    kinds: design.kinds,
    edit: (kind, current, rand, history, deleted) =>
      edit(kind, current, rand, history, deleted, doc, design.target),
    access: (f) => (f && (TYPES as readonly string[]).includes(f.type) ? 'view' : 'other'),
  });
}

export const sequence = (docs: readonly ExtrudoDocument[]) => sequenceOf(kernel, docs, OPTIONS);

/** The kernel's features (and `test-twin`) with the five features as `write`. */
export const fiveWrite = () =>
  accessOf(twinRegistry(), Object.fromEntries(TYPES.map((t) => [t, 'write' as BodyAccess])));

/**
 * Each design's proof: 40 seeded edits against a cleared engine and an all-`write` one, every term
 * flipped both ways, no fall-back; then 15 with the five as `write` in the engine under test.
 */
export function proveDesigns(designs: Design[]) {
  it.each(designs.map((d) => [d.name, d] as const))(
    '%s, 40 seeded edits',
    { timeout: 900_000 },
    async (_name, design) => {
      const doc = await design.make();
      const run = await differential(design, doc, 40, 5309);
      expect(run.initialErrors).toEqual([]);
      expect(run.problems).toEqual([]);
      expect(run.fallbacks).toEqual([]);
      for (const kind of design.kinds) expect(run.kinds).toContain(kind);
      const views = [...run.views].join('; ');
      for (const flip of [
        'lose: view→write',
        'find: write→view',
        'empty: view→write',
        'fill: write→view',
        ...design.flips,
      ]) {
        expect(run.views, views).toContain(flip);
      }
      expect(run.evaluated[0]).toBeLessThan(run.evaluated[1]);
    },
  );

  it.each(designs.map((d) => [d.name, d] as const))(
    '%s: the same with the five as `write` in the engine under test',
    { timeout: 900_000 },
    async (_name, design) => {
      const run = await differential(design, await design.make(), 15, 77, {
        registry: fiveWrite(),
        exact: false,
      });
      expect(run.problems).toEqual([]);
    },
  );
}

/** A row of the counters: the design, an input edit of one body, its feature and its number. */
export type CountRow = readonly [
  string,
  () => Promise<ExtrudoDocument> | ExtrudoDocument,
  string,
  Feature['inputs'],
  string,
  Feature['inputs'] | undefined,
];

/** Exact counters: an edit of one body evaluates it, its feature (and a later cut), one mesh. */
export function countEdits(rows: readonly CountRow[]) {
  it.each(rows)(
    '%s: an edit of one body evaluates it and its feature, one mesh',
    { timeout: 300_000 },
    async (_name, make, body, size, own, number) => {
      const doc = await make();
      const docs = [doc, setInputs(doc, body, size as Feature['inputs'])];
      if (number) docs.push(doc, setInputs(doc, own, number as Feature['inputs']));
      const steps = await sequence(docs);
      for (const step of steps) {
        expect(step.problems).toEqual([]);
        expect(fallbacks(step.result, doc)).toEqual([]);
        expect(step.result.stats.viewed).toContain(own);
      }
      const [first, sized, , numbered] = steps;
      const later = doc.features.some((f) => f.id === 'cut') ? ['cut'] : [];
      expect(sized?.evaluated).toEqual([body, own, ...later]);
      expect(first?.result.features[own as FeatureId]?.status).toBe('ok');
      if (numbered) expect(numbered.evaluated).toEqual([own, ...later]);
      const sent = (s: typeof sized) => s?.result.bodies.filter((b) => b.mesh).map((b) => b.id);
      if (later.length === 0) {
        expect(sent(sized)).toEqual([`${body}:0`]);
        if (numbered) expect(sent(numbered)).toEqual([`${body}:0`]);
      }
    },
  );
}
