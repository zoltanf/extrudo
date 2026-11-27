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
  primitiveInputs,
  type RefInput,
  type SketchDataInput,
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
import { plate, twinRegistry } from './view-access-test-support';

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

export const TYPES = [
  'shell',
  'draft',
  'offsetFace',
  'removeFaces',
  'thread',
  'move',
  'scale',
  'mirror',
  'remove',
  'combine',
  'rectangularPattern',
  'circularPattern',
  'pathPattern',
  'splitBody',
] as const;

// ------------------------------------------------------------------------------- designs

export type FacePick = (d: ShapeDescription) => number[];
export type Face = ShapeDescription['faces'][number];

export const up = (f: Face) => f.type === 'plane' && (f.direction?.[2] ?? 0) > 0.99;
export const down = (f: Face) => f.type === 'plane' && (f.direction?.[2] ?? 0) < -0.99;
export const side = (f: Face) => f.type === 'plane' && Math.abs(f.direction?.[2] ?? 1) < 0.01;
/** The faces `test` picks, in index order. */
export const faces =
  (test: (f: Face) => boolean): FacePick =>
  (d) =>
    d.faces.flatMap((f, i) => (test(f) ? [i] : []));
/** The top face: flat, facing up, the highest. */
export const top: FacePick = (d) => {
  const all = faces(up)(d);
  const z = (i: number) => d.faces[i]?.centroid[2] ?? 0;
  return all.sort((a, b) => z(b) - z(a)).slice(0, 1);
};

export interface Step {
  /** The feature, inserted after `after`. */
  id: string;
  after: string;
  /** Its inputs from the face references `refs` gives at the end of the design so far. */
  make(refs: (body: string, pick: FacePick) => GeomRef[]): Feature;
}

/** `use` of an engine that has computed `doc` (cleared after). */
export async function computed<T>(
  doc: ExtrudoDocument,
  use: (engine: RecomputeEngine) => T,
): Promise<T> {
  const engine = new RecomputeEngine(kernel, twinRegistry()(), { strictLeaks: true });
  try {
    const done = await engine.recompute({ doc });
    if (done.status !== 'done') throw new Error('cancelled');
    return use(engine);
  } finally {
    engine.clear();
  }
}

/** The references of the faces `pick` gives on `body`, in an engine that computed the design. */
export function faceRefs(engine: RecomputeEngine, body: string, pick: FacePick): GeomRef[] {
  const shape = engine.latestBody(body as BodyId);
  if (shape === undefined) throw new Error(`no body ${body}`);
  return pick(kernel.describe(shape)).map((i) => {
    const ref = engine.reference(body as BodyId, 'face', i);
    if (!ref) throw new Error(`no face ${i} on ${body}`);
    return ref;
  });
}

/** The references of the edges `pick` gives on `body`, in an engine that computed the design. */
export function edgeRefs(
  engine: RecomputeEngine,
  body: string,
  pick: (d: ShapeDescription) => number[],
): GeomRef[] {
  const shape = engine.latestBody(body as BodyId);
  if (shape === undefined) throw new Error(`no body ${body}`);
  return pick(kernel.describe(shape)).map((i) => {
    const ref = engine.reference(body as BodyId, 'edge', i);
    if (!ref) throw new Error(`no edge ${i} on ${body}`);
    return ref;
  });
}

/** The reference of vertex `index` of `body`, in an engine that computed the design. */
export function vertexRef(engine: RecomputeEngine, body: string, index: number): GeomRef {
  const ref = engine.reference(body as BodyId, 'vertex', index);
  if (!ref) throw new Error(`no vertex ${index} on ${body}`);
  return ref;
}

/** A 10 mm box centred at `x`, `y` on XY, a new body `<id>:0`. */
export const box = (id: string, x: number, y = 0): Feature =>
  feature(
    id,
    'box',
    primitiveInputs('box', {
      numbers: { length: '10 mm', width: '10 mm', height: '10 mm', x: `${x} mm`, y: `${y} mm` },
    }),
  );

/**
 * `doc` with each step's feature added in turn, its references taken from a recompute before it.
 */
export async function build(doc: ExtrudoDocument, steps: Step[]): Promise<ExtrudoDocument> {
  let current = doc;
  for (const step of steps) {
    const made = await computed(current, (engine) =>
      step.make((body, pick) => faceRefs(engine, body, pick)),
    );
    const features = [...current.features];
    features.splice(features.findIndex((f) => f.id === step.after) + 1, 0, made);
    current = { ...current, features, timelineMarker: features.length };
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
  const refs = await computed(doc, (engine) => {
    const shape = engine.latestBody(body as BodyId);
    if (shape === undefined) throw new Error(`no body ${body}`);
    // The top face's straight edges.
    const d = kernel.describe(shape);
    const [topFace] = top(d);
    const edges = d.edges.flatMap((e, i) =>
      e.type === 'line' && topFace !== undefined && e.faces.includes(topFace) ? [i] : [],
    );
    return edges.map((i) => engine.reference(body as BodyId, 'edge', i) as GeomRef);
  });
  const features = [...doc.features];
  features.splice(
    features.findIndex((f) => f.id === after) + 1,
    0,
    feature(id, 'fillet', filletInputs([{ edges: refs, radius }])),
  );
  return { ...doc, features, timelineMarker: features.length };
}

// ------------------------------------------------------------------------------- edits

/**
 * The edits, each applied to the design's target (`Design.target`, by default its first feature
 * of `TYPES`) unless it says otherwise. The rule's terms: the first reference of `Design.refsKey`
 * (default `faces`) made one no body has (a face name, or a `body` reference to no body) and back
 * (`lose`, `find`), no references and back (`empty`, `fill`), the first one picked twice and back
 * (`twice`, `untwice`). The shell's: a body picked to hollow and back, one that doesn't exist and
 * back (`pick-body`, `unpick-body`, `lose-body`, `found-body`). The draft's neutral plane cycling
 * XY, a construction plane and a named face (`plane`). Move, Scale and Mirror: the copy on and off
 * (`copy`), Move's mode cycling free, about the named axis, from and to the named points
 * (`mode`), the mirror plane between the YZ plane and a named face (`mirror-plane`). Combine: the
 * operation cycling (`combine-op`), the tools kept and not (`keep-tools`), the target picked as a
 * tool and back (`tool-is-target`, `tool-not-target`). The twins swapping places (`swap`), one
 * suppressed and back (`twin-off`, `twin-on`). A random draft's flip, offset's kept rounds,
 * thread's hand or extent, extrude's operation; then the generic edits.
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
  | 'copy'
  | 'mode'
  | 'twice'
  | 'mirror-plane'
  | 'combine-op'
  | 'keep-tools'
  | 'tool-is-target'
  | 'tool-not-target'
  | 'untwice'
  | 'join'
  | 'size-face'
  | 'size-before'
  | 'size-between'
  | 'size-after'
  | 'reshape'
  | 'project'
  | 'unproject'
  | 'op-cycle'
  | 'reach'
  | (typeof GENERIC_KINDS)[number];

export const LOST: GeomRef = { kind: 'face', id: 'f[nowhere]' };
/** A body reference to no body. */
export const LOST_BODY: GeomRef = { kind: 'body', id: 'gone:0' };

export function edit(
  kind: Kind,
  doc: ExtrudoDocument,
  rand: () => number,
  history: readonly ExtrudoDocument[],
  deleted: Feature[],
  original: ExtrudoDocument,
  named: Record<string, GeomRef>,
  targetId?: string,
  key = 'faces',
): Edited | undefined {
  const pickOne = <T>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)];
  const target = original.features.find((f) =>
    targetId === undefined ? (TYPES as readonly string[]).includes(f.type) : f.id === targetId,
  );
  const now = target && doc.features.find((f) => f.id === target.id);
  const list = now && (now.inputs[key] as RefInput | undefined)?.refs;
  const own = target && (target.inputs[key] as RefInput | undefined)?.refs;
  const lost = own?.[0]?.kind === 'body' ? LOST_BODY : LOST;
  const refs = (list: GeomRef[]) => ({ [key]: { kind: 'ref' as const, refs: list } });
  const set = (more: Feature['inputs']): Edited | undefined =>
    now && { doc: setInputs(doc, now.id, more), feature: now.id };
  const of = (type: string) => doc.features.filter((f) => f.type === type);
  switch (kind) {
    case 'lose':
      if (!list?.length || list[0]?.id === lost.id) return undefined;
      return set(refs([lost, ...list.slice(1)]));
    case 'find':
      if (!own || !list || JSON.stringify(list) === JSON.stringify(own)) return undefined;
      return set(refs(own));
    case 'empty':
      return list?.length ? set(refs([])) : undefined;
    case 'fill':
      return own && list && list.length === 0 ? set(refs(own)) : undefined;
    case 'twice':
      // The first reference picked a second time.
      if (!list?.length || list.length > new Set(list.map((r) => r.id)).size) return undefined;
      return set(refs([...list, list[0] as GeomRef]));
    case 'untwice':
      // Each reference once again.
      if (!list || list.length === new Set(list.map((r) => r.id)).size) return undefined;
      return set(refs(list.filter((r, i) => list.findIndex((x) => x.id === r.id) === i)));
    case 'copy': {
      if (!now) return undefined;
      const on = (now.inputs.copy as { value?: boolean } | undefined)?.value;
      // A mirror copies unless told not to.
      const copying = on ?? now.type === 'mirror';
      return set({ copy: { kind: 'bool', value: !copying } });
    }
    case 'mode': {
      if (now?.type !== 'move') return undefined;
      const was = (now.inputs.mode as EnumInput | undefined)?.value ?? 'free';
      if (was === 'free') {
        return set({
          mode: choice('rotate'),
          axis: { kind: 'ref', refs: [named.axis as GeomRef] },
          angle: { kind: 'expr', expr: '15 deg', unit: 'angle' },
        });
      }
      if (was === 'rotate') {
        return set({
          mode: choice('point-to-point'),
          from: { kind: 'ref', refs: [named.from as GeomRef] },
          to: { kind: 'ref', refs: [named.to as GeomRef] },
        });
      }
      return set({ mode: choice('free') });
    }
    case 'mirror-plane': {
      if (now?.type !== 'mirror') return undefined;
      const at = (now.inputs.plane as RefInput).refs[0];
      const next: GeomRef =
        at?.kind === 'face' ? originPlaneRef('origin:yz') : (named['mirror face'] as GeomRef);
      return set({ plane: { kind: 'ref', refs: [next] } });
    }
    case 'combine-op': {
      if (now?.type !== 'combine') return undefined;
      const was = (now.inputs.operation as EnumInput | undefined)?.value ?? 'join';
      return set({
        operation: choice(was === 'join' ? 'cut' : was === 'cut' ? 'intersect' : 'join'),
      });
    }
    case 'size-face':
    case 'size-before':
    case 'size-between':
    case 'size-after': {
      // A `read` design's boxes by role: the one its face is on (`fb`), one nothing refers to
      // before it (`o0`), between it and the target (`o1`), after the target (`o2`). Its length
      // 10 mm ↔ 12 mm; the change is the target's, for its flips.
      const id = {
        'size-face': 'fb',
        'size-before': 'o0',
        'size-between': 'o1',
        'size-after': 'o2',
      }[kind];
      const box = doc.features.find((f) => f.id === id);
      if (!box || !targetId) return undefined;
      const was = (box.inputs.length as { expr?: string } | undefined)?.expr;
      const next = was === '10 mm' ? '12 mm' : '10 mm';
      return {
        doc: setInputs(doc, box.id, { length: { kind: 'expr', expr: next, unit: 'length' } }),
        feature: targetId as FeatureId,
      };
    }
    case 'reshape':
    case 'project':
    case 'unproject': {
      // The target sketch's circles 3 mm ↔ 2.5 mm; or a projection `pj` of `named.edge` (an edge
      // of another box) added, and taken out again.
      const input = now?.inputs.sketch as SketchDataInput | undefined;
      if (!now || input?.kind !== 'sketchData') return undefined;
      const sketch = input.sketch;
      const projected = (sketch.projections ?? {}) as Record<string, unknown>;
      const has = projected.pj !== undefined;
      if (kind === 'reshape') {
        const entities = Object.fromEntries(
          Object.entries(sketch.entities).map(([id, e]) => [
            id,
            e.type === 'circle' ? { ...e, radius: e.radius === 3 ? 2.5 : 3 } : e,
          ]),
        );
        return set({ sketch: { ...input, sketch: { ...sketch, entities } } });
      }
      if ((kind === 'project') === has || !named.edge) return undefined;
      const { pj: _gone, ...rest } = projected;
      const projections =
        kind === 'project' ? { ...rest, pj: { ref: named.edge, curves: {} } } : rest;
      return set({ sketch: { ...input, sketch: { ...sketch, projections } as never } });
    }
    case 'op-cycle':
    case 'reach': {
      // The target extrude's operation cut → intersect → join → new body → cut; or its first
      // side's extent distance ↔ through-all.
      if (now?.type !== 'extrude') return undefined;
      if (kind === 'reach') {
        const was = (now.inputs.extent as EnumInput | undefined)?.value ?? 'distance';
        return set({ extent: choice(was === 'distance' ? 'through-all' : 'distance') });
      }
      const was = (now.inputs.operation as EnumInput | undefined)?.value ?? 'new-body';
      const next = { cut: 'intersect', intersect: 'join', join: 'new-body', 'new-body': 'cut' }[
        was as 'cut'
      ];
      return set({ operation: choice(next) });
    }
    case 'join': {
      // A mirror's or a pattern's join of each copy into its original, on and off.
      if (now?.type !== 'mirror' && !now?.type.endsWith('Pattern')) return undefined;
      const on = (now.inputs.join as { value?: boolean } | undefined)?.value === true;
      return set({ join: { kind: 'bool', value: !on } });
    }
    case 'keep-tools': {
      if (now?.type !== 'combine') return undefined;
      const on = (now.inputs.keepTools as { value?: boolean } | undefined)?.value === true;
      return set({ keepTools: { kind: 'bool', value: !on } });
    }
    case 'tool-is-target':
    case 'tool-not-target': {
      // The target picked as a tool too (an error under both), and taken out of the tools again.
      if (now?.type !== 'combine' || !list) return undefined;
      const target = (now.inputs.target as RefInput).refs[0] as GeomRef;
      const has = list.some((r) => r.id === target.id);
      if (has === (kind === 'tool-is-target')) return undefined;
      return set(refs(has ? list.filter((r) => r.id !== target.id) : [...list, target]));
    }
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
            : // A face of another plate (`named['plane face']`): it brings its body into the view.
              (named['plane face'] as GeomRef);
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
      return { doc: swapped, feature: (targetId ?? 'st') as FeatureId };
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
        feature: (targetId ?? 'st') as FeatureId,
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

export interface Design {
  name: string;
  make: () => Promise<ExtrudoDocument>;
  /** The kinds of edit, in the order of the first pass. */
  kinds: Kind[];
  /** Flips that must happen, besides the rule's four. */
  flips: string[];
  /** The feature the rule's edits go to (default: the design's first feature of `TYPES`). */
  target?: string;
  /** Kinds of edit that must never take a view from their feature (no `<kind>: view→write`). */
  steady?: Kind[];
  /** Seeded edits (default 40). */
  steps?: number;
  /**
   * References some edits use, from the design as made: the draft's `plane face`, the mirror's
   * `mirror face`, Move's `axis`, `from` and `to`.
   */
  named?: (doc: ExtrudoDocument) => Promise<Record<string, GeomRef>>;
  /** The input whose references the rule's edits change (default `faces`). */
  refsKey?: string;
  /** The rule's flips that must happen (default: each of `lose`, `find`, `empty`, `fill`). */
  rule?: string[];
  /** Features that may fall back to `write` after trying a view. */
  fallBackOk?: string[];
}

export const BASE = [...RULE] as Kind[];
export const AFTER = ['operation', ...GENERIC_KINDS] as Kind[];

export const OPTIONS: PairOptions = {
  exact: true,
  registry: twinRegistry(),
  reference: twinRegistry(),
};

export async function differential(
  design: Design,
  doc: ExtrudoDocument,
  steps: number,
  seed: number,
  options: PairOptions = {},
) {
  const named = (await design.named?.(doc)) ?? {};
  return differentialOf(kernel, doc, steps, seed, {
    ...OPTIONS,
    ...options,
    kinds: design.kinds,
    edit: (kind, current, rand, history, deleted) =>
      edit(kind, current, rand, history, deleted, doc, named, design.target, design.refsKey),
    access: (f) => (f && (TYPES as readonly string[]).includes(f.type) ? 'view' : 'other'),
  });
}

export const sequence = (docs: readonly ExtrudoDocument[], more: PairOptions = {}) =>
  sequenceOf(kernel, docs, { ...OPTIONS, ...more });

/**
 * Each design's proof: seeded edits (40 unless the design says) against a cleared engine
 * (versions and `measure` boxes too) and an engine that runs every feature as `write` (all but
 * versions), every term flipped both ways, no fall-back.
 */
export function proveDesigns(designs: Design[]) {
  it.each(designs.map((d) => [d.name, d] as const))(
    '%s, seeded edits',
    { timeout: 900_000 },
    async (_name, design) => {
      const doc = await design.make();
      const run = await differential(design, doc, design.steps ?? 40, 5309);
      expect(run.initialErrors).toEqual([]);
      expect(run.problems).toEqual([]);
      // A feature the design names may run as `write` after a view try (its new bodies' places
      // can't be told without bodies outside the view): the comparison still holds at every step.
      const allowed = design.fallBackOk ?? [];
      expect(run.fallbacks.filter((f) => !allowed.some((id) => f.endsWith(`: ${id}`)))).toEqual([]);
      for (const kind of design.kinds) expect(run.kinds).toContain(kind);
      const views = [...run.views].join('; ');
      for (const flip of [
        ...(design.rule ?? [
          'lose: view→write',
          'find: write→view',
          'empty: view→write',
          'fill: write→view',
        ]),
        ...design.flips,
      ]) {
        expect(run.views, views).toContain(flip);
      }
      for (const kind of design.steady ?? []) {
        expect(
          [...run.views].filter((v) => v === `${kind}: view→write`),
          views,
        ).toEqual([]);
      }
      expect(run.evaluated[0]).toBeLessThan(run.evaluated[1]);
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
  /** The meshes each edit sends, when not the edited body's alone (`[]`: it is removed). */
  (readonly string[])?,
];

/** Exact counters: an edit of one body evaluates it, its feature (and a later cut), one mesh. */
export function countEdits(rows: readonly CountRow[]) {
  it.each(rows.map((row) => [row[0], row] as const))(
    '%s: an edit of one body evaluates it and its feature, one mesh',
    { timeout: 300_000 },
    async (_name, row) => {
      const [, make, body, size, own, number, meshes] = row;
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
        const expected = meshes ?? [`${body}:0`];
        expect(sent(sized)).toEqual(expected);
        if (numbered) expect(sent(numbered)).toEqual(expected);
      }
    },
  );
}
