// `view` body access (ADR-0024's amendment on `view` access): a fillet or a chamfer sees and keys
// only the bodies its references name, and its result goes back in their places. The proof, as
// for `add`: seeded random edits of designs with fillets and chamfers, and after every step the
// engine that kept its cache gives exactly what a cleared engine gives (statuses, origins,
// reports, body IDs and order, meshes and names bit for bit, versions and `measure` boxes). The
// edits take every term of the engine's rule for a view both ways. Then: a view's result equals
// the same feature run as `write`; reads outside a view are caught (the fall-back); the counters;
// negative controls. Real OCCT and manifold, strict leaks, no clock.
import {
  type AttachmentId,
  applyCommand,
  type BodyId,
  type ComponentId,
  chamferInputs,
  type EnumInput,
  EnumInputSchema,
  type ExtrudoDocument,
  type Feature,
  type FeatureId,
  filletInputs,
  type GeomRef,
  type Input,
  insertDesign,
  insertDesignPayload,
  primitiveInputs,
  type RefInput,
  RefInputSchema,
  SKIP_LOST_EDGES_KEY,
  z,
} from '@extrudo/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import b4 from '../../../../fixtures/benchmarks/b4-box-with-lid.extrudo?url&inline';
import b6 from '../../../../fixtures/benchmarks/b6-wall-hook.extrudo?url&inline';
import b7 from '../../../../fixtures/benchmarks/b7-knurled-knob.extrudo?url&inline';
import simplifyDemo from '../../../../fixtures/demos/simplifyForPrint.extrudo?url&inline';
import { kernelFeatures } from '../features/index';
import { Kernel, KernelError } from '../kernel';
import { loadManifold } from '../manifold';
import type { ShapeDescription } from '../naming/description';
import { loadOcct } from '../occt/load';
import {
  accessOf,
  atStep,
  choice,
  client,
  differences,
  differential as differentialOf,
  type Edited,
  fallbacks,
  faultyEngine,
  fixture,
  GENERIC_KINDS,
  genericEdit,
  length,
  type PairOptions,
  sequence as sequenceOf,
  setInputs,
} from './add-access-test-support';
import { RecomputeEngine } from './engine';
import { type EvalContext, type KernelFeatureDefinition, OutsideError } from './types';
import { document, plate, platesOf, slot, twin, twinRegistry } from './view-access-test-support';

let kernel: Kernel;
beforeAll(async () => {
  kernel = new Kernel(await loadOcct());
  kernel.enableMeshes(await loadManifold());
}, 120_000);
afterAll(() => {
  expect(kernel.stats().liveShapes).toBe(0);
});

const ROUNDS = new Set(['fillet', 'chamfer']);

// ------------------------------------------------------------------------------- designs

interface Round {
  id: string;
  type: 'fillet' | 'chamfer';
  /** Inserted after this feature. */
  after: string;
  /** Edges by body and index, at the end of the design before this round is added. */
  edges: [string, number][];
  /** Or the indices of the edges of a body that `along` picks from its description. */
  along?: [string, (d: ShapeDescription) => number[]];
  size?: string;
  /** A chamfer's set: `two-distances` takes the first edge's first face as its reference face. */
  mode?: 'equal' | 'two-distances' | 'distance-angle';
}

/** `doc` with `rounds` added, their references taken from a recompute of `doc` as it is. */
async function withRounds(doc: ExtrudoDocument, rounds: Round[]): Promise<ExtrudoDocument> {
  const engine = new RecomputeEngine(kernel, kernelFeatures(), { strictLeaks: true });
  try {
    const done = await engine.recompute({ doc });
    if (done.status !== 'done') throw new Error('cancelled');
    let features = [...doc.features];
    for (const round of rounds) {
      const picked = round.along;
      const shape = picked && engine.latestBody(picked[0] as BodyId);
      const all: [string, number][] =
        picked && shape !== undefined
          ? picked[1](kernel.describe(shape)).map((i) => [picked[0], i] as [string, number])
          : round.edges;
      const edges = all.map(([body, index]) => {
        const ref = engine.reference(body as BodyId, 'edge', index);
        if (!ref) throw new Error(`no edge ${index} on ${body}`);
        return ref;
      });
      let face: GeomRef | undefined;
      if (round.mode === 'two-distances') {
        const [body, index] = round.edges[0] as [string, number];
        const shape = engine.latestBody(body as BodyId);
        const faces = shape === undefined ? [] : (kernel.describe(shape).edges[index]?.faces ?? []);
        face = engine.reference(body as BodyId, 'face', faces[0] ?? 0);
      }
      const inputs =
        round.type === 'fillet'
          ? filletInputs([{ edges, radius: round.size ?? '0.5 mm' }])
          : chamferInputs([
              {
                edges,
                distance: round.size ?? '0.5 mm',
                mode: round.mode ?? 'equal',
                ...(round.mode === 'two-distances' && { distanceB: '0.8 mm', face }),
                ...(round.mode === 'distance-angle' && { angle: '30 deg' }),
              },
            ]);
      const at = features.findIndex((f) => f.id === round.after) + 1;
      features.splice(at, 0, {
        id: round.id as FeatureId,
        type: round.type,
        name: `${round.type} ${round.id}`,
        suppressed: false,
        inputs,
      });
    }
    features = features.filter(Boolean);
    return { ...doc, features, timelineMarker: features.length };
  } finally {
    engine.clear();
  }
}

/** A fillet of four edges after every plate. */
async function platesWithFillets(n = 5, gap = 80) {
  const doc = document(`${n} plates, each with a fillet`, platesOf(n, gap));
  return withRounds(
    doc,
    Array.from({ length: n }, (_, i) => ({
      id: `fi${i}`,
      type: 'fillet' as const,
      after: `ex${i}`,
      edges: [0, 1, 2, 3].map((e) => [`ex${i}:0`, e] as [string, number]),
    })),
  );
}

/** Plates overlapping their neighbours, a fillet after each, and a slot cut through all of them. */
async function overlapping() {
  const doc = await platesWithFillets(5, 50);
  const features = [...doc.features, ...slot('cut', [-10, 18, 300, 22])];
  return { ...doc, features, timelineMarker: features.length };
}

/** Plates with chamfers of each mode. */
function chamfers() {
  const doc = document('plates with chamfers', platesOf(4));
  return withRounds(doc, [
    { id: 'ch0', type: 'chamfer', after: 'ex0', edges: [['ex0:0', 0]] },
    { id: 'ch1', type: 'chamfer', after: 'ex1', edges: [['ex1:0', 1]], mode: 'two-distances' },
    { id: 'ch2', type: 'chamfer', after: 'ex2', edges: [['ex2:0', 2]], mode: 'distance-angle' },
    {
      id: 'ch3',
      type: 'chamfer',
      after: 'ex3',
      edges: [
        ['ex3:0', 0],
        ['ex3:0', 2],
      ],
    },
  ]);
}

/**
 * A plate with two fillets, the second on edges the first left (named after it), and plates
 * beside.
 */
async function twoFillets() {
  const doc = document('a body with two fillets', [
    ...plate(0, 0, '5 mm'),
    ...platesOf(3).slice(2),
  ]);
  const first = await withRounds(doc, [
    { id: 'fa', type: 'fillet', after: 'ex0', edges: [0, 1].map((e) => ['ex0:0', e]) },
  ]);
  return withRounds(first, [
    { id: 'fb', type: 'fillet', after: 'fa', edges: [8, 9].map((e) => ['ex0:0', e]) },
  ]);
}

/**
 * A plate, a groove cut across its top (a box, suppressed: `split` turns it on), then a fillet of
 * the plate's two short top edges. The groove splits the top face in two, so those edges, named
 * by the top face and a side, are then found by a related name only (`e[top|side]` →
 * `e[top#1|side]`).
 */
async function splitter() {
  const features = [...plate(0, 0, '5 mm'), ...platesOf(3).slice(2)];
  const base = document('a fillet whose edges a cut splits', features);
  const rounded = await withRounds(base, [
    {
      id: 'fs',
      type: 'fillet',
      after: 'ex0',
      edges: [],
      along: [
        'ex0:0',
        (d) =>
          d.edges.flatMap((e, i) =>
            e.type === 'line' &&
            Math.abs(e.direction?.[1] ?? 0) > 0.99 &&
            e.length > 39 &&
            e.midpoint[2] > 4.9
              ? [i]
              : [],
          ),
      ],
    },
  ]);
  const groove: Feature = {
    id: 'cs' as FeatureId,
    type: 'box',
    name: 'Groove',
    suppressed: true,
    inputs: primitiveInputs('box', {
      numbers: {
        length: '4 mm',
        width: '50 mm',
        height: '2 mm',
        x: '30 mm',
        y: '20 mm',
        offset: '4 mm',
      },
      operation: 'cut',
    }),
  };
  const at = rounded.features.findIndex((f) => f.id === 'fs');
  const all = [...rounded.features];
  all.splice(at, 0, groove);
  return { ...rounded, features: all, timelineMarker: all.length };
}

/** One fillet of edges on two plates. */
function acrossTwo() {
  const doc = document('one fillet across two bodies', platesOf(3));
  return withRounds(doc, [
    {
      id: 'fx',
      type: 'fillet',
      after: 'ex2',
      edges: [
        ['ex0:0', 0],
        ['ex0:0', 1],
        ['ex1:0', 0],
      ],
    },
  ]);
}

/** Plates with fillets and a copy of a small one inserted (an isolated expansion: `write` there). */
async function inserted() {
  const host = await platesWithFillets(2);
  const source = await platesWithFillets(2, 70);
  const payload = insertDesignPayload(
    host,
    source,
    {
      feature: 'ins' as FeatureId,
      component: 'cmp-ins' as ComponentId,
      attachment: () => 'att-ins' as AttachmentId,
    },
    'Part',
  );
  const doc = applyCommand(host, insertDesign(payload)).doc;
  const after = await withRounds(
    {
      ...doc,
      features: [...doc.features, ...plate(9, 400, '6 mm')],
      timelineMarker: doc.features.length + 2,
    },
    [{ id: 'fi9', type: 'fillet', after: 'ex9', edges: [['ex9:0', 0]] }],
  );
  return after;
}

/**
 * Two twin boxes (the same names) and a fillet of an edge named on both, taken from the first:
 * `closest` picks the twin whose geometry matches the reference's fingerprint. Plates beside.
 */
async function twins(): Promise<ExtrudoDocument> {
  const features = [twin('ta', '0 mm'), twin('tb', '30 mm'), ...platesOf(2)];
  const doc = document('twin bodies and a fillet named on both', features);
  const engine = new RecomputeEngine(kernel, twinRegistry()(), { strictLeaks: true });
  try {
    await engine.recompute({ doc });
    const edge = engine.reference('ta:0' as BodyId, 'edge', 0) as GeomRef;
    const fillet: Feature = {
      id: 'ft' as FeatureId,
      type: 'fillet',
      name: 'Fillet on a twin',
      suppressed: false,
      inputs: filletInputs([{ edges: [edge], radius: '1 mm' }]),
    };
    const all = [...features.slice(0, 2), fillet, ...features.slice(2)];
    return { ...doc, features: all, timelineMarker: all.length };
  } finally {
    engine.clear();
  }
}

const DESIGNS: [string, () => Promise<ExtrudoDocument> | ExtrudoDocument][] = [
  ['plates, each with a fillet', () => platesWithFillets()],
  ['overlapping plates with fillets and a cut through them', overlapping],
  ['plates with chamfers of each mode', chamfers],
  ['a body with two fillets, the first edited', twoFillets],
  ['a fillet whose edges a cut splits, and back', splitter],
  ['one fillet across two bodies', acrossTwo],
  ['plates with fillets and an inserted design', inserted],
  ['twin bodies and a fillet named on both', twins],
  ['b4 box with lid', () => fixture(b4)],
  ['b6 wall hook', () => fixture(b6)],
  ['b7 knurled knob', () => fixture(b7)],
  ['the simplify-for-print demo', () => fixture(simplifyDemo)],
];

// ------------------------------------------------------------------------------- edits

/**
 * The terms of the engine's rule for a view, each both ways, made to the design's first fillet or
 * chamfer: `lose` (an edge no body has by its name) and `find` (its own edge again); `empty` (no
 * edges) and `fill`; `split` (the slot cut before it on, so its edges are found by related names
 * only) and `unsplit`. Then `size` (a radius or distance of any round), `skip` (its lost edges
 * left out), `operation` (a plate's extrude cycles New Body, join, cut). Inside an isolated
 * expansion a round runs as `write` (the inserted design; that term changes only by inserting).
 */
// The first pass takes them in this order, so each term goes both ways on the round as it was;
// `split` and `unsplit` change nothing in a design without the groove.
const KINDS = [
  'lose',
  'find',
  'empty',
  'fill',
  'split',
  'unsplit',
  'swap',
  'twin-off',
  'twin-on',
  'size',
  'skip',
  'operation',
  ...GENERIC_KINDS,
] as const;
type Kind = (typeof KINDS)[number];

const LOST: GeomRef = { kind: 'edge', id: 'e[nowhere|nothing]' };

function edit(
  kind: Kind,
  doc: ExtrudoDocument,
  rand: () => number,
  history: readonly ExtrudoDocument[],
  deleted: Feature[],
  original: ExtrudoDocument,
): Edited | undefined {
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)];
  const target = original.features.find((f) => ROUNDS.has(f.type));
  const now = target && doc.features.find((f) => f.id === target.id);
  const edges = (f: Feature) => f.inputs.edges as RefInput | undefined;
  const set = (refs: GeomRef[]): Edited | undefined =>
    now && {
      doc: setInputs(doc, now.id, { edges: { kind: 'ref', refs } }),
      feature: now.id,
    };
  switch (kind) {
    case 'lose': {
      const list = now && edges(now)?.refs;
      if (!list?.length || list[0]?.id === LOST.id) return undefined;
      return set([LOST, ...list.slice(1)]);
    }
    case 'find': {
      const list = now && edges(now)?.refs;
      const own = target && edges(target)?.refs;
      if (!own || !list || JSON.stringify(list) === JSON.stringify(own)) return undefined;
      return set(own);
    }
    case 'empty': {
      const list = now && edges(now)?.refs;
      return list?.length ? set([]) : undefined;
    }
    case 'fill': {
      const list = now && edges(now)?.refs;
      const own = target && edges(target)?.refs;
      return list && own && list.length === 0 ? set(own) : undefined;
    }
    case 'swap': {
      // The twins change places: the other one now matches the fillet's fingerprint.
      const a = doc.features.find((f) => f.id === 'ta');
      const b = doc.features.find((f) => f.id === 'tb');
      if (!original.features.some((f) => f.id === 'ta')) return { doc };
      if (!a || !b) return undefined;
      const swapped = setInputs(setInputs(doc, 'ta', { x: b.inputs.x as Input }), 'tb', {
        x: a.inputs.x as Input,
      });
      return { doc: swapped, feature: 'ft' as FeatureId };
    }
    case 'twin-off':
    case 'twin-on': {
      const b = doc.features.find((f) => f.id === 'tb');
      if (!original.features.some((f) => f.id === 'tb')) return { doc };
      if (!b || b.suppressed === (kind === 'twin-off')) return undefined;
      return {
        doc: {
          ...doc,
          features: doc.features.map((f) => (f === b ? { ...f, suppressed: !f.suppressed } : f)),
        },
        feature: 'ft' as FeatureId,
      };
    }
    case 'split':
    case 'unsplit': {
      const cut = doc.features.find((f) => f.id === 'cs');
      if (!original.features.some((f) => f.id === 'cs')) return { doc };
      if (!cut || cut.suppressed === (kind === 'unsplit')) return undefined;
      return {
        doc: {
          ...doc,
          features: doc.features.map((f) => (f === cut ? { ...f, suppressed: !f.suppressed } : f)),
        },
        feature: 'fs' as FeatureId,
      };
    }
    case 'size': {
      const f = pick(doc.features.filter((x) => ROUNDS.has(x.type)));
      const name = f && (f.type === 'fillet' ? 'radius' : 'distance');
      const input = f && name ? f.inputs[name] : undefined;
      if (!f || !name || input?.kind !== 'expr') return undefined;
      const factor = pick([0.8, 1.2, 0.9]);
      return {
        doc: setInputs(doc, f.id, { [name]: { ...input, expr: `(${input.expr}) * ${factor}` } }),
        feature: f.id,
      };
    }
    case 'skip': {
      if (!now) return undefined;
      const on = (now.inputs[SKIP_LOST_EDGES_KEY] as { value?: boolean } | undefined)?.value;
      return {
        doc: setInputs(doc, now.id, { [SKIP_LOST_EDGES_KEY]: { kind: 'bool', value: !on } }),
        feature: now.id,
      };
    }
    case 'operation': {
      const f = pick(doc.features.filter((x) => x.type === 'extrude' && /^ex\d+$/.test(x.id)));
      if (!f) return undefined;
      const was = (f.inputs.operation as EnumInput | undefined)?.value ?? 'new-body';
      const next = was === 'new-body' ? 'join' : was === 'join' ? 'cut' : 'new-body';
      return { doc: setInputs(doc, f.id, { operation: choice(next) }), feature: f.id };
    }
    default:
      return genericEdit(kind, doc, rand, history, deleted, (n, x) => plate(n, x, '5 mm', 5, 200));
  }
}

/** `steps` edits of `doc` (each kind at least once), each checked against a cleared engine. */
function differential(
  doc: ExtrudoDocument,
  steps: number,
  seed: number,
  options: PairOptions = {},
) {
  return differentialOf(kernel, doc, steps, seed, {
    exact: true,
    registry: twinRegistry(),
    reference: twinRegistry(),
    ...options,
    kinds: KINDS,
    edit: (kind, current, rand, history, deleted) =>
      edit(kind, current, rand, history, deleted, doc),
    access: (f) => (f && ROUNDS.has(f.type) ? 'view' : 'other'),
  });
}

const sequence = (docs: readonly ExtrudoDocument[], options: PairOptions = {}) =>
  sequenceOf(kernel, docs, {
    exact: true,
    registry: twinRegistry(),
    reference: twinRegistry(),
    ...options,
  });

/** The kernel's features with the fillet and the chamfer as `write` (as before this change). */
const roundsWrite = () => accessOf(twinRegistry(), { fillet: 'write', chamfer: 'write' });

// ------------------------------------------------------------------------------- the proof

describe('view access: the cached engine gives what a cleared one gives (ADR-0024, `view` access)', () => {
  it.each(DESIGNS)('%s, 40 seeded edits', { timeout: 900_000 }, async (_name, make) => {
    const doc = await make();
    const run = await differential(doc, 40, 4127);
    expect(run.initialErrors).toEqual([]);
    expect(run.problems).toEqual([]);
    // No view evaluation looked outside its view (none ran again as `write`).
    expect(run.fallbacks).toEqual([]);
    const plates = doc.features.some((f) => /^ex\d+$/.test(f.id));
    for (const kind of KINDS) {
      if (kind === 'split' || kind === 'unsplit') continue;
      if (kind === 'operation' && !plates) continue;
      expect(run.kinds).toContain(kind);
    }
    // Every term of the rule, both ways, on a round the engine took with a view.
    expect(run.views, [...run.views].join('; ')).toContain('lose: view→write');
    expect(run.views).toContain('find: write→view');
    expect(run.views).toContain('empty: view→write');
    expect(run.views).toContain('fill: write→view');
    if (doc.features.some((f) => f.id === 'cs')) {
      expect(run.views, [...run.views].join('; ')).toContain('split: view→write');
      expect(run.views).toContain('unsplit: write→view');
    }
    // An edited round computed with its view.
    // (The twins' fillet computes with a warning: `closest` guessed between two exact names.)
    const built = (kind: Kind) =>
      run.computed.has(kind) ||
      (run.outcomes.get(kind) ?? []).some((said) => / warning: /.test(said));
    expect(built('size'), [...run.views].join('; ')).toBe(true);
    expect(built('find')).toBe(true);
    // The cache saved work.
    expect(run.evaluated[0]).toBeLessThan(run.evaluated[1]);
  });

  it('a view result is what the same round gives as `write`: order, IDs, names, reports', {
    timeout: 900_000,
  }, async () => {
    // The engine under test runs the fillet and chamfer as `write`; the cleared one with views.
    for (const [name, make] of DESIGNS) {
      const run = await differential(await make(), 15, 77, {
        registry: roundsWrite(),
        exact: false,
      });
      expect(run.problems, name).toEqual([]);
    }
  });

  it('inside an inserted design a fillet runs as `write`; the host’s fillets with views', {
    timeout: 120_000,
  }, async () => {
    const doc = await inserted();
    const [step] = await sequence([doc]);
    const viewed = step?.result.stats.viewed ?? [];
    expect(viewed.sort()).toEqual(['fi0', 'fi1', 'fi9']);
    // The inserted design's fillets were evaluated (as `write`).
    const own = new Set(doc.features.map((f) => f.id as string));
    const outside = (step?.evaluated ?? []).filter((id) => !own.has(id));
    expect(outside.length).toBeGreaterThan(0);
  });
});

// ------------------------------------------------------------------------------- reads outside

/**
 * `test-view-probe`, a `view` feature that rounds nothing: it resolves its `edges`, then does what
 * `mode` says with `other` (a body ID) or `otherEdge` (an edge name of that body), and returns
 * the bodies it saw.
 */
function probeRegistry() {
  return () => {
    const registry = kernelFeatures();
    registry.register({
      type: 'test-view-probe',
      label: 'test-view-probe',
      category: 'modify',
      icon: 'test',
      inputsSchema: z.strictObject({
        edges: RefInputSchema,
        mode: EnumInputSchema,
        other: EnumInputSchema,
        otherEdge: EnumInputSchema,
        guess: EnumInputSchema,
      }),
      bodyAccess: () => 'view',
      evaluate(ctx: EvalContext) {
        const value = (name: string) => (ctx.inputs[name] as EnumInput).value;
        const other = value('other') as BodyId;
        for (const ref of (ctx.inputs.edges as RefInput).refs) ctx.resolve(ref);
        const out = new Map(ctx.bodies);
        switch (value('mode')) {
          case 'get':
            if (ctx.bodies.get(other) === undefined) throw new KernelError('no such body');
            break;
          case 'has':
            if (!ctx.bodies.has(other)) throw new KernelError('no such body');
            break;
          case 'size':
            if (ctx.bodies.size < 2) throw new KernelError('too few bodies');
            break;
          case 'names':
            ctx.names(other);
            break;
          case 'resolve-other':
            ctx.resolve({ kind: 'edge', id: value('otherEdge') });
            break;
          case 'resolve-lost':
            ctx.resolve(LOST);
            break;
          case 'resolve-guess':
            ctx.resolve(JSON.parse(value('guess')) as GeomRef);
            break;
          case 'new':
            out.set(ctx.bodyId(), ctx.kernel.box([1, 1, 1], [0, 0, 50]));
            break;
          case 'stray':
            out.set(other, ctx.kernel.box([1, 1, 1], [0, 0, 50]));
            break;
          case 'reorder': {
            // The view's first body deleted and set again: under `write` it goes to the end.
            const [first] = [...out.keys()];
            const shape = first === undefined ? undefined : out.get(first);
            if (first !== undefined && shape !== undefined) {
              out.delete(first);
              out.set(first, shape);
            }
            break;
          }
          case 'outside':
            // A cause outside the document (`OUTSIDE`), to try again once the bodies change.
            if (OUTSIDE.on) throw new OutsideError('The cause is outside the document.', 'bodies');
            // Without it, a new shape (the same place) of each body its edges are on, as a fillet.
            for (const ref of (ctx.inputs.edges as RefInput).refs) {
              const hit = ctx.resolve(ref);
              const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
              out.set(hit.body, ctx.kernel.transform(hit.shape, identity).shape);
            }
            break;
          case 'iterate':
            for (const [id, shape] of ctx.bodies) {
              const moved = ctx.kernel.transform(shape, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 30]);
              out.set(id, moved.shape);
            }
            break;
        }
        return { bodies: out };
      },
    } as unknown as KernelFeatureDefinition);
    return registry;
  };
}

/** Three plates and a probe after them on an edge of the middle one. */
/** Whether the `outside` probe's cause outside the document is there. */
const OUTSIDE = { on: true };

async function probed(mode: string): Promise<ExtrudoDocument> {
  const doc = document('a probe', platesOf(3));
  const engine = new RecomputeEngine(kernel, kernelFeatures(), { strictLeaks: true });
  try {
    await engine.recompute({ doc });
    const edge = engine.reference('ex1:0' as BodyId, 'edge', 0) as GeomRef;
    const otherEdge = (engine.reference('ex2:0' as BodyId, 'edge', 0) as GeomRef).id;
    // An edge of the middle plate by its fingerprint only (its name gone): found by geometry.
    const guess = { ...(engine.reference('ex1:0' as BodyId, 'edge', 1) as GeomRef), id: 'e[gone]' };
    const features: Feature[] = [
      ...doc.features,
      {
        id: 'probe' as FeatureId,
        type: 'test-view-probe',
        name: 'Probe',
        suppressed: false,
        inputs: {
          // `reorder` takes an edge of the first plate too: a view of two bodies.
          edges: {
            kind: 'ref',
            refs:
              mode === 'reorder'
                ? [engine.reference('ex0:0' as BodyId, 'edge', 0) as GeomRef, edge]
                : [edge],
          },
          mode: choice(mode),
          other: choice('ex2:0'),
          otherEdge: choice(otherEdge),
          guess: choice(JSON.stringify(guess)),
        },
      },
    ];
    return { ...doc, features, timelineMarker: features.length };
  } finally {
    engine.clear();
  }
}

/** The probe forced to `write`. */
const probeWrite = () => accessOf(probeRegistry(), { 'test-view-probe': 'write' });

describe('view access: a read outside the view is caught (the fall-back)', () => {
  it.each([
    ['a look-up of another body (`get`)', 'get'],
    ['`has` of another body', 'has'],
    ['the number of bodies (`size`)', 'size'],
    ['`names` of another body', 'names'],
    ['a reference resolved in another body', 'resolve-other'],
    ['a reference no body has', 'resolve-lost'],
    ['a reference found by its fingerprint only (in the view)', 'resolve-guess'],
    ['a result with a view body deleted and set again (out of the view’s order)', 'reorder'],
    ['a result that replaces a body outside the view by its ID', 'stray'],
    ['a result with a new body', 'new'],
    ['an error to try again once the bodies change (`OutsideError`, `bodies`)', 'outside'],
  ])('%s: dropped, run as `write`, remembered', { timeout: 120_000 }, async (_n, mode) => {
    const doc = await probed(mode);
    // The last plate is in no probe's view (it is the `other` body some probes look up).
    const other = setInputs(doc, 'ex2', { distance: length('7 mm') });
    // The probe as `view` against the same probe as `write` (cleared each step).
    const viewEngine = new RecomputeEngine(kernel, probeRegistry()(), { strictLeaks: true });
    const writeEngine = new RecomputeEngine(kernel, probeWrite()(), { strictLeaks: true });
    try {
      const mine = client(kernel, viewEngine);
      for (const [n, d] of [doc, other].entries()) {
        const a = await mine.run(d);
        writeEngine.clear();
        const b = await client(kernel, writeEngine).run(d);
        expect(differences(a, b), `step ${n}`).toEqual([]);
        expect(a.result.stats.viewed ?? []).not.toContain('probe');
        const times = a.result.stats.evaluated.filter((id) => id === 'probe').length;
        // First the view's try and the `write` run; after an edit outside the view, `write` at once.
        expect(times, `step ${n}`).toBe(n === 0 ? 2 : 1);
      }
    } finally {
      viewEngine.clear();
      writeEngine.clear();
    }
  });

  it('an error to try again once the bodies change, its cause then gone: the same content, other versions', {
    timeout: 120_000,
  }, async () => {
    // The engine that kept its memory runs the probe as `write` at once; a cleared one takes the
    // view again, which now computes. What they make is the same; the version of the probe's body
    // (a version is the key that made it) is not.
    const doc = await probed('outside');
    const other = setInputs(doc, 'ex0', { distance: length('7 mm') });
    const viewEngine = new RecomputeEngine(kernel, probeRegistry()(), { strictLeaks: true });
    const fresh = new RecomputeEngine(kernel, probeRegistry()(), { strictLeaks: true });
    try {
      OUTSIDE.on = true;
      const mine = client(kernel, viewEngine);
      await mine.run(doc);
      OUTSIDE.on = false;
      const a = await mine.run(other);
      const b = await client(kernel, fresh).run(other);
      expect(a.result.features['probe' as FeatureId]?.status).toBe('ok');
      expect(differences(a, b)).toEqual([]);
      expect(a.result.stats.viewed).not.toContain('probe');
      expect(b.result.stats.viewed).toContain('probe');
      const version = (r: typeof a, id: string) =>
        r.result.bodies.find((x) => x.id === id)?.version;
      expect(version(a, 'ex1:0')).not.toBe(version(b, 'ex1:0'));
      expect(version(a, 'ex2:0')).toBe(version(b, 'ex2:0'));
    } finally {
      OUTSIDE.on = true;
      viewEngine.clear();
      fresh.clear();
    }
  });

  it('a copy of the view (what a fillet does) is not a read', { timeout: 120_000 }, async () => {
    const [step] = await sequence([await probed('copy')], {
      registry: probeRegistry(),
      reference: probeRegistry(),
    });
    expect(step?.result.stats.viewed).toContain('probe');
    expect(step?.evaluated.filter((id) => id === 'probe')).toEqual(['probe']);
  });

  it('iterating is not noticed: a probe that moves every body it sees moves only its view', {
    timeout: 120_000,
  }, async () => {
    // Why each `view` feature is audited: its evaluator may iterate only to copy the map.
    const doc = await probed('iterate');
    const viewEngine = new RecomputeEngine(kernel, probeRegistry()(), { strictLeaks: true });
    const writeEngine = new RecomputeEngine(kernel, probeWrite()(), { strictLeaks: true });
    try {
      const a = await client(kernel, viewEngine).run(doc);
      const b = await client(kernel, writeEngine).run(doc);
      expect(a.result.stats.viewed).toContain('probe');
      // The two plates outside the view stay where they are; the one in it moves in both.
      const found = differences(a, b);
      expect(found).toContain('mesh ex0:0');
      expect(found).toContain('mesh ex2:0');
      expect(found.filter((d) => d.includes('ex1:0'))).toEqual([]);
    } finally {
      viewEngine.clear();
      writeEngine.clear();
    }
  });
});

// ------------------------------------------------------------------------------- counters

describe('view access: twin bodies with the same names', () => {
  it('the fillet follows `closest` from one twin to the other, and to the one left', {
    timeout: 120_000,
  }, async () => {
    const doc = await twins();
    const swap = (d: ExtrudoDocument) => {
      const a = d.features.find((f) => f.id === 'ta')?.inputs.x as Input;
      const b = d.features.find((f) => f.id === 'tb')?.inputs.x as Input;
      return setInputs(setInputs(d, 'ta', { x: b }), 'tb', { x: a });
    };
    const off = {
      ...doc,
      features: doc.features.map((f) => (f.id === 'tb' ? { ...f, suppressed: true } : f)),
    };
    const steps = await sequence([doc, swap(doc), doc, off]);
    const faces = (step: (typeof steps)[number] | undefined, id: string) =>
      step?.result.bodies.find((b) => b.id === id)?.mesh?.faceIds?.length ?? 0;
    // A box has 6 faces; the rounded one 7. Step 2 sends no mesh: both twins as at step 0.
    expect([faces(steps[0], 'ta:0'), faces(steps[0], 'tb:0')]).toEqual([7, 6]);
    expect([faces(steps[1], 'ta:0'), faces(steps[1], 'tb:0')]).toEqual([6, 7]);
    expect(faces(steps[3], 'ta:0')).toBe(7);
    for (const step of steps) {
      expect(step.problems).toEqual([]);
      expect(step.result.stats.viewed).toContain('ft');
    }
    // Both twins are in the fillet's view: it runs again when either changes.
    expect(steps[1]?.evaluated).toEqual(['ta', 'tb', 'ft']);
  });
});

describe('view access: what an edit costs (exact counters)', () => {
  /** Plate `k`'s holes 4 mm instead of 5 mm (its sketch). */
  const holes = (doc: ExtrudoDocument, k: number) => {
    const [sketch] = plate(k, k * 80, '0 mm', 4);
    return {
      ...doc,
      features: doc.features.map((f) => (f.id === `sk${k}` ? { ...f, inputs: sketch?.inputs } : f)),
    } as ExtrudoDocument;
  };

  it.each([0, 2, 5])(
    'six plates with a fillet each: edits of plate %i',
    { timeout: 300_000 },
    async (k) => {
      const doc = await platesWithFillets(6);
      const steps = await sequence([
        doc,
        holes(doc, k),
        doc,
        setInputs(doc, `fi${k}`, { radius: length('0.7 mm') }),
        doc,
        setInputs(doc, `ex${k}`, { distance: length('9 mm') }),
      ]);
      const [first, sketch, , radius, , distance] = steps;
      expect(first?.result.stats.viewed).toEqual(['fi0', 'fi1', 'fi2', 'fi3', 'fi4', 'fi5']);
      expect(sketch?.evaluated).toEqual([`sk${k}`, `ex${k}`, `fi${k}`]);
      expect(radius?.evaluated).toEqual([`fi${k}`]);
      expect(distance?.evaluated).toEqual([`ex${k}`, `fi${k}`]);
      for (const step of [sketch, radius, distance]) {
        expect(step?.result.bodies.filter((b) => b.mesh).map((b) => b.id)).toEqual([`ex${k}:0`]);
        expect(step?.result.stats.viewed).toEqual(['fi0', 'fi1', 'fi2', 'fi3', 'fi4', 'fi5']);
      }
      for (const step of steps) {
        expect(step.problems).toEqual([]);
        expect(fallbacks(step.result, doc)).toEqual([]);
      }
    },
  );

  it('a later `write` feature still keys a fillet it reads: the cut through all plates', {
    timeout: 300_000,
  }, async () => {
    const doc = await overlapping();
    const steps = await sequence([
      doc,
      setInputs(doc, 'fi2', { radius: length('0.7 mm') }),
      doc,
      setInputs(doc, 'ex3', { distance: length('9 mm') }),
    ]);
    const [, radius, , distance] = steps;
    expect(radius?.evaluated).toEqual(['fi2', 'cut']);
    expect(distance?.evaluated).toEqual(['ex3', 'fi3', 'cut']);
    for (const step of steps) expect(step.problems).toEqual([]);
  });

  it('one fillet across two bodies sees both, not the third', { timeout: 120_000 }, async () => {
    const doc = await acrossTwo();
    const steps = await sequence([
      doc,
      setInputs(doc, 'ex2', { distance: length('9 mm') }),
      doc,
      setInputs(doc, 'ex1', { distance: length('9 mm') }),
    ]);
    expect(steps[1]?.evaluated).toEqual(['ex2']);
    expect(steps[3]?.evaluated).toEqual(['ex1', 'fx']);
    for (const step of steps) expect(step.problems).toEqual([]);
  });
});

// ------------------------------------------------------------------------------- negative controls

describe('the comparison catches a wrong `view` (negative controls)', () => {
  // A fault in the key changes the versions it makes (a version is its key's), so these compare
  // everything but versions.
  it('the view’s versions left out of its key: right at first, stale after the plate changes', {
    timeout: 300_000,
  }, async () => {
    const broken = await faultyEngine([
      "const viewKey = looked && keyOf(hashOf('view', looked.versions));",
      "const viewKey = looked && keyOf(hashOf('view', looked.versions.map(([id]) => id)));",
    ]);
    try {
      const doc = await platesWithFillets(3);
      const [a, b] = await sequence([doc, setInputs(doc, 'ex0', { distance: length('9 mm') })], {
        engine: broken.engine,
        exact: false,
      });
      expect(a?.problems).toEqual([]);
      expect(b?.evaluated).toEqual(['ex0']);
      expect(b?.problems).toContain('mesh ex0:0');
    } finally {
      broken.remove();
    }
  });

  it('a view missing one of its bodies: caught by the fall-back at once, the result right', {
    timeout: 120_000,
  }, async () => {
    const broken = await faultyEngine([
      '    if (ids.size === 0) return undefined;\n    const view = new BodyView();',
      '    if (ids.size === 0) return undefined;\n    ids.delete([...ids].at(-1) as BodyId);\n    const view = new BodyView();',
    ]);
    try {
      const doc = await acrossTwo();
      const [a] = await sequence([doc], { engine: broken.engine, exact: false });
      expect(a?.problems).toEqual([]);
      expect(fallbacks(a?.result as NonNullable<typeof a>['result'], doc)).toEqual(['fx']);
    } finally {
      broken.remove();
    }
  });

  it('a view of the first twin only: the comparison sees it once `closest` would pick the other', {
    timeout: 120_000,
  }, async () => {
    // The one term the fall-back can't guard: the evaluator finds the name in the view.
    const broken = await faultyEngine([
      '            ids.add(id);\n            found = true;\n',
      '            ids.add(id);\n            found = true;\n            break;\n',
    ]);
    try {
      const doc = await twins();
      const swapped = setInputs(setInputs(doc, 'ta', { x: length('30 mm') }), 'tb', {
        x: length('0 mm'),
      });
      const [a, b] = await sequence([doc, swapped], { engine: broken.engine, exact: false });
      // The view's one twin resolves without the guess's warning, and then to the wrong twin.
      expect(a?.problems).toContain('statuses');
      expect(b?.problems).toContain('mesh ta:0');
      expect(b?.problems).toContain('mesh tb:0');
    } finally {
      broken.remove();
    }
  });

  it('a view result appended instead of put in place: the body order differs at once', {
    timeout: 120_000,
  }, async () => {
    const broken = await faultyEngine([
      '? mergeInPlace(bodies, view, entry.output.bodies)',
      '? mergeBodies(bodies, new Map(view), entry.output.bodies)',
    ]);
    try {
      // The fillet's bodies are not the last ones: in place they stay first.
      const doc = await acrossTwo();
      const run = await differential(doc, 5, 9, { engine: broken.engine, exact: false });
      expect(atStep(run.problems, 0).some((p) => p.includes('bodies'))).toBe(true);
    } finally {
      broken.remove();
    }
  });
});
