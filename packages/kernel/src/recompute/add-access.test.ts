// `add` body access (ADR-0024's amendment on `add` access): a feature that only adds bodies sees
// none and keys none. The proof: seeded random edits of several designs, and after every step the
// engine that kept its cache (and the meshes it sent, like the Recomputer) gives exactly what an
// engine with a cleared cache gives for the same document: statuses and errors, origins, reports,
// body IDs and their order, and every array and name of every mesh. Real OCCT, strict leaks, no
// clock. Plus negative controls that must make the comparison fail, and counters.
//
// The edits take every term of the extrude's predicate (`addsOnly`) both ways, "through all" and
// "to object" included. That holds because the boxes features read don't depend on whether a body
// was meshed (ADR-0035's amendment of 2026-11-24): the cached engine's bodies have been meshed for
// the meshes it sent, a cleared engine's haven't. `through all over cached bodies` below is that
// case by name.
import {
  type AttachmentId,
  applyCommand,
  type ComponentId,
  constructionRef,
  createDocument,
  type ExtrudeInputs,
  type ExtrudoDocument,
  extrudeInputs,
  type Feature,
  type FeatureId,
  type GeomRef,
  insertDesign,
  insertDesignPayload,
  loftInputs,
  originPlaneRef,
  primitiveInputs,
  profileRefId,
  sketchInputs,
} from '@extrudo/core';
import { BUNDLED_FONTS, DEFAULT_FONT } from '@extrudo/fonts';
import { SketchBuilder } from '@extrudo/sketch/fixtures';
import { detectProfiles } from '@extrudo/sketch/profiles';
import { loadFont } from '@extrudo/sketch/text';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import b2 from '../../../../fixtures/benchmarks/b2-storage-box.extrudo?url&inline';
import b3 from '../../../../fixtures/benchmarks/b3-phone-stand.extrudo?url&inline';
import b4 from '../../../../fixtures/benchmarks/b4-box-with-lid.extrudo?url&inline';
import hinge from '../../../../fixtures/components/hinge.extrudo?url&inline';
import interRegular from '../../../fonts/fonts/inter-regular.ttf?url&inline';
import { addsOnly } from '../features/extrude';
import { kernelFeatures } from '../features/index';
import { Kernel } from '../kernel';
import { loadOcct } from '../occt/load';
import {
  bytesOf,
  choice,
  client,
  type Done,
  differences,
  differential as differentialOf,
  type Edited,
  extrudeFeature,
  faultyEngine,
  fixture,
  type GenericKind,
  genericEdit,
  length,
  type PairOptions,
  pair as pairOf,
  plateFeatures,
  plates,
  refs,
  sequence as sequenceOf,
  setInputs,
  sketchFeature,
  withAccess,
} from './add-access-test-support';
import { RecomputeEngine } from './engine';

let kernel: Kernel;
beforeAll(async () => {
  kernel = new Kernel(await loadOcct());
  expect(BUNDLED_FONTS.find((f) => f.id === DEFAULT_FONT)?.file).toBe('inter-regular.ttf');
  loadFont(DEFAULT_FONT, bytesOf(interRegular));
});
afterAll(() => {
  expect(kernel.stats().liveShapes).toBe(0);
});

// ------------------------------------------------------------------------------- designs

/** A disc's sketch and a New Body extrude of it, "through all" by default (a `write`). */
function discFeatures(id: string, x: number, options: Parameters<typeof extrudeInputs>[1] = {}) {
  const b = new SketchBuilder();
  b.circle(x, 20, 30);
  const [region] = detectProfiles(b.sketch);
  const sketch = `s${id}` as FeatureId;
  return [
    sketchFeature(sketch, b.sketch),
    extrudeFeature(
      id,
      extrudeInputs([{ kind: 'profile', id: profileRefId(sketch, region?.id ?? '') }], {
        extent: 'through-all',
        ...options,
      }),
    ),
  ];
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
    sketchFeature('skc', b.sketch),
    extrudeFeature(
      'cut',
      extrudeInputs([{ kind: 'profile', id: profileRefId('skc' as FeatureId, region?.id ?? '') }], {
        direction: 'symmetric',
        distance: '30 mm',
        operation: 'cut',
      }),
    ),
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

/** A torus (one toroidal face) on XY, centred at the origin: ring Ø40, tube Ø10. */
function torusFeature(id: string): Feature {
  return {
    id: id as FeatureId,
    type: 'torus',
    name: `Torus ${id}`,
    suppressed: false,
    inputs: primitiveInputs('torus', {
      numbers: { diameter: '40 mm', tube: '10 mm' },
      plane: originPlaneRef('origin:xy'),
    }),
  };
}

/** A closed spline round (x…x+20, 0…20) extruded 10 mm: a B-spline side face and two flat caps. */
function splineFeatures(id: string, x: number): Feature[] {
  const b = new SketchBuilder();
  b.spline([
    [x, 0],
    [x + 20, 0],
    [x + 20, 20],
    [x, 20],
    [x, 0],
  ]);
  const [region] = detectProfiles(b.sketch);
  const sketch = `s${id}` as FeatureId;
  return [
    sketchFeature(sketch, b.sketch),
    extrudeFeature(
      id,
      extrudeInputs([{ kind: 'profile', id: profileRefId(sketch, region?.id ?? '') }], {
        distance: '10 mm',
      }),
    ),
  ];
}

/** A hole Ø`d` at (x, y) cut `distance` up from XY. */
function holeFeatures(id: string, x: number, y: number, d: number, distance: string): Feature[] {
  const b = new SketchBuilder();
  b.circle(x, y, d / 2);
  const [region] = detectProfiles(b.sketch);
  const sketch = `s${id}` as FeatureId;
  return [
    sketchFeature(sketch, b.sketch),
    extrudeFeature(
      id,
      extrudeInputs([{ kind: 'profile', id: profileRefId(sketch, region?.id ?? '') }], {
        distance,
        operation: 'cut',
      }),
    ),
  ];
}

/** A smooth loft from a 20 mm square on XY through a circle 10 mm up to a 10 mm square 20 mm up. */
function loftFeatures(id: string, x: number): Feature[] {
  const plane = (pid: string, distance: string): Feature => ({
    id: pid as FeatureId,
    type: 'offsetPlane',
    name: `Plane ${pid}`,
    suppressed: false,
    inputs: { plane: refs([originPlaneRef('origin:xy')]), distance: length(distance) },
  });
  const onPlane = (sid: string, pid: string, draw: (b: SketchBuilder) => void): Feature => {
    const b = new SketchBuilder();
    draw(b);
    return {
      ...sketchFeature(sid, b.sketch),
      inputs: sketchInputs(
        constructionRef(features.find((f) => f.id === pid) as Feature) as GeomRef,
        b.sketch,
      ),
    };
  };
  const square = (b: SketchBuilder, cx: number, cy: number, h: number) => {
    b.line(cx - h, cy - h, cx + h, cy - h);
    b.line(cx + h, cy - h, cx + h, cy + h);
    b.line(cx + h, cy + h, cx - h, cy + h);
    b.line(cx - h, cy + h, cx - h, cy - h);
  };
  const bottom = new SketchBuilder();
  square(bottom, x, 10, 10);
  const features: Feature[] = [sketchFeature(`${id}s1`, bottom.sketch), plane(`${id}p1`, '10 mm')];
  features.push(onPlane(`${id}s2`, `${id}p1`, (b) => b.circle(x, 10, 6)));
  features.push(plane(`${id}p2`, '20 mm'));
  features.push(onPlane(`${id}s3`, `${id}p2`, (b) => square(b, x, 10, 5)));
  const ref = (sid: string) => {
    const f = features.find((g) => g.id === sid) as Feature;
    const data = (f.inputs.sketch as { sketch: Parameters<typeof detectProfiles>[0] }).sketch;
    const [region] = detectProfiles(data);
    return { kind: 'profile', id: profileRefId(sid as FeatureId, region?.id ?? '') } as GeomRef;
  };
  features.push({
    id: id as FeatureId,
    type: 'loft',
    name: `Loft ${id}`,
    suppressed: false,
    inputs: loftInputs([ref(`${id}s1`), ref(`${id}s2`), ref(`${id}s3`)]),
  });
  return features;
}

/**
 * Curved bodies with cuts and joins over them: a torus, a spline extrude and a smooth loft
 * (B-spline faces), a plate joined to the torus with a hole cut in the plate away from it, a hole
 * through the spline body's caps clear of its side, and a plate over the spline body and the loft.
 */
function curved(): ExtrudoDocument {
  const join = plateFeatures('j', 15, '3 mm', false);
  const features: Feature[] = [
    torusFeature('tor'),
    ...splineFeatures('spl', 40),
    ...loftFeatures('lof', 80),
    ...join.map((f) =>
      f.type === 'extrude' ? { ...f, inputs: { ...f.inputs, operation: choice('join') } } : f,
    ),
    ...holeFeatures('hj', 60, 20, 6, '3 mm'),
    ...holeFeatures('hs', 50, 10, 4, '10 mm'),
    ...plateFeatures('c', 35, '4 mm'),
  ];
  return {
    ...createDocument({ name: 'curved' }),
    parameters: [{ id: 'p-t', name: 't', expression: '4 mm', unit: 'length' }],
    features,
    timelineMarker: features.length,
  } as ExtrudoDocument;
}

/**
 * The design with plates after it until it holds five extrudes that answer `add`: the edits that
 * take an extrude from `add` to `write` each need one (b4 and the hinge have no extrude at all).
 */
function withPlates(doc: ExtrudoDocument): ExtrudoDocument {
  const features = [...doc.features];
  const adds = () => features.filter((f) => accessOf(f) === 'add').length;
  for (let i = 0; adds() < 5; i++) features.push(...plateFeatures(`p${i}`, 1000 + 80 * i, '4 mm'));
  return { ...doc, features, timelineMarker: features.length };
}

/** The label sketch the `text` edit adds: the text "T1" below the plates. */
function labelSketch(): { feature: Feature; text: string } {
  const b = new SketchBuilder();
  const anchor = b.point(0, -30);
  const top = b.point(0, -20);
  const text = b.id('t');
  b.entities[text] = {
    type: 'text',
    anchor,
    top,
    text: 'T1',
    font: DEFAULT_FONT,
    align: 'left',
    construction: false,
  } as never;
  return { feature: sketchFeature('skl', b.sketch), text };
}

/** What the extrude answers for a feature's inputs; other features `other`. */
function accessOf(f: Feature | undefined): 'add' | 'write' | 'other' {
  if (f?.type !== 'extrude') return 'other';
  return addsOnly(f.inputs as ExtrudeInputs) ? 'add' : 'write';
}

/** The end cap of an extrude's first body: a flat face to extrude from or extrude up to. */
const capOf = (id: string): GeomRef => ({ kind: 'face', id: `extrude:${id}:cap:end` });

// ------------------------------------------------------------------------------- comparison

const pair = (options: PairOptions = {}) => pairOf(kernel, options);
const sequence = (docs: readonly ExtrudoDocument[], options: PairOptions = {}) =>
  sequenceOf(kernel, docs, options);

// ------------------------------------------------------------------------------- edits

// The first pass takes them in this order: `insert` first (b4 and the hinge get an extrude), then
// one edit per term of the extrude's predicate, each on an extrude that answers `add`.
const KINDS = [
  'insert',
  'through-all',
  'to-object',
  'face',
  'bodies',
  'two-sides',
  'symmetric',
  'taper',
  'text',
  'adds',
  'operation',
  'region',
  'length',
  'suppress',
  'marker',
  'reorder',
  'delete',
  'undo',
  'parameter',
] as const;
type Kind = (typeof KINDS)[number];

/** Edits of one term of the predicate, and the access they must leave the extrude with. */
const TERMS: [Kind, 'add' | 'write'][] = [
  ['through-all', 'write'],
  ['to-object', 'write'],
  ['face', 'write'],
  ['bodies', 'write'],
  ['two-sides', 'write'],
  ['symmetric', 'add'],
  ['taper', 'add'],
  ['text', 'add'],
];

/** One edit of `kind` to `doc`, or undefined when the design has nothing it applies to. */
function edit(
  kind: Kind,
  doc: ExtrudoDocument,
  rand: () => number,
  history: readonly ExtrudoDocument[],
  deleted: Feature[],
): Edited | undefined {
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)];
  const extrudes = doc.features.filter((f) => f.type === 'extrude');
  // The extrude a term's edit changes: one that answers `add`, so the edit shows what the term
  // does; with `after`, one with such an extrude before it (whose cap or body it can refer to).
  const isAdd = (x: Feature) => accessOf(x) === 'add' && !x.suppressed;
  const before = (f: Feature) => extrudes.slice(0, extrudes.indexOf(f)).filter(isAdd);
  const adding = (after = false) =>
    pick(extrudes.filter((f) => isAdd(f) && (!after || before(f).length > 0))) ??
    pick(extrudes.filter(isAdd));
  // Another extrude, an earlier one that answers `add` where there is one.
  const other = (f: Feature) => pick(before(f)) ?? pick(extrudes.filter((x) => x !== f)) ?? f;
  const change = (f: Feature | undefined, more: (f: Feature) => Feature['inputs']) =>
    f && { doc: setInputs(doc, f.id, more(f)), feature: f.id };
  switch (kind) {
    case 'through-all':
      return change(adding(), () => ({ extent: choice('through-all') }));
    case 'to-object':
      return change(adding(true), (f) => ({
        extent: choice('to-object'),
        toObject: refs([
          rand() < 0.5 ? capOf(other(f).id) : { kind: 'body', id: `${other(f).id}:0` },
        ]),
      }));
    case 'face':
      return change(adding(true), (f) => ({ profiles: refs([capOf(other(f).id)]) }));
    case 'bodies':
      return change(adding(true), (f) => ({
        bodies: refs([{ kind: 'body', id: `${other(f).id}:0` }]),
      }));
    case 'two-sides':
      // Side 2 "through all"; two sides by distances stay `add` (the predicate's own test).
      return change(adding(), () => ({
        direction: choice('two-sides'),
        extent2: choice('through-all'),
        // Side 2 up, where the bodies are.
        flip: { kind: 'bool', value: true },
      }));
    case 'symmetric':
      return change(adding(), () => ({ direction: choice('symmetric') }));
    case 'taper':
      return change(adding(), () => ({
        taper: { kind: 'expr', expr: pick(['3 deg', '-2 deg', '5 deg']) ?? '3 deg', unit: 'angle' },
      }));
    case 'text': {
      // The text of a label sketch (added at the start if the design has none) as the profile.
      const f = adding();
      if (!f) return undefined;
      const label = labelSketch();
      const has = doc.features.some((x) => x.id === 'skl');
      const edited = setInputs(doc, f.id, {
        profiles: refs([{ kind: 'sketchEntity', id: `skl/${label.text}` }]),
      });
      if (has) return { doc: edited, feature: f.id };
      return {
        doc: {
          ...edited,
          features: [label.feature, ...edited.features],
          timelineMarker: edited.timelineMarker + 1,
        },
        feature: f.id,
      };
    }
    case 'adds': {
      // Back to `add`: one side by a distance, a new body, nothing picked.
      const f = pick(extrudes.filter((x) => accessOf(x) === 'write' && !hasFaceProfile(x)));
      if (!f) return undefined;
      const { toObject: _o, bodies: _b, extent2: _e, ...rest } = f.inputs as ExtrudeInputs;
      const inputs: ExtrudeInputs = {
        ...rest,
        direction: choice('one-side'),
        extent: choice('distance'),
        operation: choice('new-body'),
        distance: rest.distance ?? length('5 mm'),
      };
      return {
        doc: { ...doc, features: doc.features.map((x) => (x === f ? { ...x, inputs } : x)) },
        feature: f.id,
      };
    }
    case 'operation': {
      const op = pick(['new-body', 'join', 'cut', 'intersect', 'new-body'] as const) ?? 'new-body';
      return change(pick(extrudes), () => ({ operation: choice(op) }));
    }
    case 'region': {
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
      const data = (sketch?.inputs.sketch as { sketch?: unknown } | undefined)?.sketch;
      if (!data) return undefined;
      const regions = detectProfiles(data as never);
      const next = pick(regions.filter((r) => profileRefId(sketchId, r.id) !== ref?.id));
      if (!next) return undefined;
      return change(f, () => ({
        profiles: refs([{ kind: 'profile', id: profileRefId(sketchId, next.id) }]),
      }));
    }
    default:
      return genericEdit(kind as GenericKind, doc, rand, history, deleted);
  }
}

function hasFaceProfile(f: Feature): boolean {
  return (f.inputs as ExtrudeInputs).profiles?.refs.some((r) => r.kind === 'face') ?? false;
}

/** `steps` edits of `doc` (each kind at least once), each checked against a cleared engine. */
function differential(
  doc: ExtrudoDocument,
  steps: number,
  seed: number,
  options: PairOptions = {},
) {
  return differentialOf(kernel, doc, steps, seed, {
    ...options,
    kinds: KINDS,
    edit,
    access: accessOf,
  });
}

// ------------------------------------------------------------------------------- the proof

/** A design, how to make it, the features stopped in it, and the ones in error before any edit. */
const DESIGNS: [string, () => ExtrudoDocument, FeatureId[], string[]][] = [
  ['plates with a parameter', () => plates(5), [], []],
  ['overlapping plates and a cut through them', () => withPlates(platesCut()), [], []],
  ['b2 storage box', () => withPlates(fixture(b2)), [], []],
  ['b3 phone stand', () => withPlates(fixture(b3)), [], []],
  ['b4 box with lid', () => withPlates(fixture(b4)), [], []],
  ['the hinge (components)', () => withPlates(fixture(hinge)), [], []],
  ['plates and an inserted design (an isolated expansion)', () => withPlates(withInsert()), [], []],
  ['curved bodies with cuts and joins over them', () => withPlates(curved()), [], []],
  [
    'a failed feature and a stopped one',
    () => withPlates(withFailures()),
    ['ex2' as FeatureId],
    ['ex1', 'ex2'],
  ],
];

describe('add access: the cached engine gives what a cleared one gives (ADR-0024, `add` access)', () => {
  const computed = new Map<string, Set<Kind>>();
  afterAll(() => {
    if (computed.size < DESIGNS.length) return; // a filtered run
    const any = new Set([...computed.values()].flatMap((kinds) => [...kinds]));
    for (const [kind] of TERMS) expect(any, kind).toContain(kind);
  });
  it.each(DESIGNS)(
    '%s, 40 seeded edits',
    { timeout: 900_000 },
    async (_n, make, stopped, errors) => {
      const run = await differential(make(), 40, 2511, { stopped });
      expect(run.initialErrors.sort()).toEqual(errors);
      expect(run.problems).toEqual([]);
      // No `add` evaluation read a body (none ran again as `write`).
      expect(run.fallbacks).toEqual([]);
      // Every kind of edit happened, and each term of the predicate did what it must to an
      // extrude that answered `add`; an extrude came back to `add`; the cache saved work.
      for (const kind of KINDS) expect(run.kinds).toContain(kind);
      for (const [kind, access] of TERMS) expect(run.flips).toContain(`${kind}: add→${access}`);
      expect(run.flips).toContain('adds: write→add');
      // The edited extrude computed, not only failed the same way in both engines: these in
      // every design, every term in at least one (checked after the last design).
      for (const kind of [
        'through-all',
        'two-sides',
        'symmetric',
        'taper',
        'bodies',
        'adds',
      ] as const)
        expect(run.computed).toContain(kind);
      computed.set(_n, run.computed);
      expect(run.compared).toBe(41);
      expect(run.evaluated[0]).toBeLessThan(run.evaluated[1]);
    },
  );

  it('through all over cached bodies: a write after adds, an earlier body edited', {
    timeout: 120_000,
  }, async () => {
    // P1–P3: New Body extrudes (`add`) of circles on the XZ plane, so cylinders lying along y with
    // curved tops; then T, a New Body disc "through all" up and down over them (a `write`).
    // Editing P1 keeps P2 and P3 cached, and meshed for the meshes sent; T runs again and its
    // length comes from their boxes. With boxes from triangulations (before ADR-0035's amendment
    // of 2026-11-24) T differs from a cleared engine's here.
    const lying = (i: number): Feature[] => {
      const b = new SketchBuilder();
      b.circle(i * 25, 10, 8);
      const [region] = detectProfiles(b.sketch);
      const sketch = `sk${i}` as FeatureId;
      return [
        {
          ...sketchFeature(sketch, b.sketch),
          inputs: sketchInputs(originPlaneRef('origin:xz'), b.sketch),
        },
        extrudeFeature(
          `ex${i}`,
          extrudeInputs([{ kind: 'profile', id: profileRefId(sketch, region?.id ?? '') }], {
            distance: `${20 + 5 * i} mm`,
          }),
        ),
      ];
    };
    const features = [
      ...[0, 1, 2].flatMap(lying),
      ...discFeatures('T', 25, { direction: 'symmetric' }),
    ];
    const first = { ...plates(0), features, timelineMarker: features.length };
    const edited = setInputs(first, 'ex0', { distance: length('9 mm') });
    expect(features.map(accessOf)).toEqual([
      'other',
      'add',
      'other',
      'add',
      'other',
      'add',
      'other',
      'write',
    ]);
    const [a, b] = await sequence([first, edited]);
    for (const step of [a, b]) {
      expect(Object.values(step?.result.features ?? {}).map((f) => f.status)).toEqual(
        Array(8).fill('ok'),
      );
    }
    expect(a?.problems).toEqual([]);
    expect(b?.evaluated).toEqual(['ex0', 'T']);
    expect(b?.problems).toEqual([]);
  });
});

// ------------------------------------------------------------------------------- the predicate

describe("the extrude's predicate, term by term", () => {
  it('answers `add` only for a new body of sketch profiles or text by distances', () => {
    const base = extrudeInputs([{ kind: 'profile', id: 'sk/r' }], { distance: '5 mm' });
    const cases: [string, Parameters<typeof extrudeInputs>[1], GeomRef[] | undefined, boolean][] = [
      ['one side by a distance', {}, undefined, true],
      ['two sides by distances', { direction: 'two-sides', distance2: '3 mm' }, undefined, true],
      [
        'two sides, side 2 through all',
        { direction: 'two-sides', extent2: 'through-all' },
        undefined,
        false,
      ],
      [
        'two sides, side 2 to an object',
        { direction: 'two-sides', extent2: 'to-object', toObject2: capOf('x') },
        undefined,
        false,
      ],
      ['symmetric', { direction: 'symmetric' }, undefined, true],
      ['tapered', { taper: '5 deg' }, undefined, true],
      ['text', {}, [{ kind: 'sketchEntity', id: 'sk/t' }], true],
      ['a face', {}, [capOf('x')], false],
      ['picked bodies', { bodies: ['x:0'] }, undefined, false],
      ['through all', { extent: 'through-all' }, undefined, false],
      ['to an object', { extent: 'to-object', toObject: capOf('x') }, undefined, false],
      ['join', { operation: 'join' }, undefined, false],
      ['cut', { operation: 'cut' }, undefined, false],
      ['intersect', { operation: 'intersect' }, undefined, false],
    ];
    for (const [name, options, profiles, add] of cases) {
      const inputs = extrudeInputs(profiles ?? base.profiles?.refs ?? [], {
        distance: '5 mm',
        ...options,
      });
      expect(addsOnly(inputs), name).toBe(add);
    }
  });
});

// ------------------------------------------------------------------------------- negative controls

/** The kernel's features, with the extrude's `bodyAccess` replaced. */
const withExtrudeAccess = (access: (inputs: ExtrudeInputs) => 'add' | 'write') =>
  withAccess('extrude', access as (inputs: never) => 'add' | 'write');

const atStep = (problems: readonly string[], step: number) =>
  problems.filter((p) => p.startsWith(`step ${step}:`));

describe('the comparison catches a wrong `add` (negative controls)', () => {
  it('the body set not chained after an `add`: right at first, wrong after edits', {
    timeout: 600_000,
  }, async () => {
    const broken = await faultyEngine([
      "bodiesKey = hashOf('add', bodiesKey, key);",
      '// (chain left out)',
    ]);
    try {
      const run = await differential(platesCut(), 20, 3, { engine: broken.engine });
      // Nothing is cached yet at step 0: only a stale cache entry can make a difference.
      expect(atStep(run.problems, 0)).toEqual([]);
      expect(run.problems.length).toBeGreaterThan(0);
    } finally {
      broken.remove();
    }
  });

  it('a join that says `add` gives other content at once (step 0)', {
    timeout: 600_000,
  }, async () => {
    // A join finds the bodies it touches by going through them all, which the fall-back doesn't
    // notice (a look-up by ID it does, a counter below): it finds none, so its own body is new.
    const joined = setInputs(platesCut(), 'ex1', { operation: choice('join') });
    const run = await differential(joined, 10, 7, {
      registry: withExtrudeAccess((inputs) => {
        const operation = (inputs as ExtrudeInputs).operation?.value ?? 'new-body';
        return operation === 'join' || operation === 'new-body' ? 'add' : 'write';
      }),
    });
    expect(atStep(run.problems, 0).length).toBeGreaterThan(0);
  });

  it('"through all" that says `add` and sees the bodies: right at first, stale after an edit', {
    timeout: 120_000,
  }, async () => {
    // The engine hands `add` features the bodies (the evaluation is right) but still keys them
    // without: only the cache is wrong. After P1 grows, T's entry is found by its `add` key.
    const broken = await faultyEngine(['? new NoBodies()', '? bodies']);
    try {
      const doc = plates(3, 45);
      const features = [...doc.features, ...discFeatures('T', 60)];
      const first = { ...doc, features, timelineMarker: features.length };
      const edited = setInputs(first, 'ex0', { distance: length('20 mm') });
      const [a, b] = await sequence([first, edited], {
        engine: broken.engine,
        registry: withExtrudeAccess((inputs) => {
          const { operation, extent } = inputs as ExtrudeInputs;
          return (operation?.value ?? 'new-body') === 'new-body' &&
            (extent?.value === 'through-all' || addsOnly(inputs))
            ? 'add'
            : 'write';
        }),
      });
      expect(a?.problems).toEqual([]);
      expect(b?.evaluated).toEqual(['ex0']);
      expect(b?.problems).toContain('mesh T:0');
    } finally {
      broken.remove();
    }
  });
});

// ------------------------------------------------------------------------------- cases by name

describe('add access: cases by name', () => {
  it.each([
    [
      'a hole through a spline body clear of its B-spline side',
      () => [...splineFeatures('spl', 40), ...holeFeatures('hs', 50, 10, 4, '10 mm')],
      'hs',
      '12 mm',
    ],
    [
      'a hole in a plate joined to a torus, away from the torus',
      () => [
        torusFeature('tor'),
        ...plateFeatures('j', 15, '3 mm', false).map((f) =>
          f.type === 'extrude' ? { ...f, inputs: { ...f.inputs, operation: choice('join') } } : f,
        ),
        ...holeFeatures('hj', 60, 20, 6, '3 mm'),
      ],
      'hj',
      '2 mm',
    ],
  ] as const)(
    "%s: the cut over the cached, meshed body gives a cleared engine's mesh",
    {
      timeout: 120_000,
    },
    async (_name, make, cut, distance) => {
      // The body under the cut comes from the cache with the triangulation its display mesh left;
      // the cut keeps its untouched faces (the B-spline side, the toroidal pieces), and the
      // result's mesh must be the one a cleared engine makes from nothing meshed.
      const features = make();
      const first = { ...plates(0), features, timelineMarker: features.length };
      const edited = setInputs(first, cut, { distance: length(distance) });
      const [a, b] = await sequence([first, edited]);
      for (const step of [a, b]) {
        for (const [id, status] of Object.entries(step?.result.features ?? {})) {
          expect(status.status, id).toBe('ok');
        }
      }
      expect(a?.problems).toEqual([]);
      expect(b?.evaluated).toEqual([cut]);
      expect(b?.problems).toEqual([]);
    },
  );

  it('a finer triangulation left on the cached body shows in the cut (the comparison sees it)', {
    timeout: 120_000,
  }, async () => {
    // First the spline body alone: the cached body is the body shown, so it can be meshed in
    // place; then a hole is cut through it, over that cached body.
    const body = splineFeatures('spl', 40);
    const first = { ...plates(0), features: body, timelineMarker: body.length };
    const features = [...body, ...holeFeatures('hs', 50, 10, 4, '10 mm')];
    const edited = { ...plates(0), features, timelineMarker: features.length };
    const p = pair();
    try {
      expect((await p.step(first)).problems).toEqual([]);
      // Finer than the view meshes it: the cut keeps the B-spline side with that triangulation.
      const cached = p.cached.latestBody('spl:0' as never);
      expect(cached).toBeDefined();
      kernel.mesh(cached as never, { linearDeflection: 0.005, angularDeflection: 0.1 });
      expect((await p.step(edited)).problems).toEqual(['mesh spl:0', 'write: mesh spl:0']);
    } finally {
      p.close();
    }
  });

  it('a new body of several separate profiles (`<feature>:0`, `:1`), edited', {
    timeout: 120_000,
  }, async () => {
    const two = new SketchBuilder();
    for (const x of [200, 270]) {
      two.line(x, 0, x + 40, 0);
      two.line(x + 40, 0, x + 40, 30);
      two.line(x + 40, 30, x, 30);
      two.line(x, 30, x, 0);
    }
    const regions = detectProfiles(two.sketch);
    expect(regions).toHaveLength(2);
    const both = regions.map((r) => ({
      kind: 'profile' as const,
      id: profileRefId('skm' as FeatureId, r.id),
    }));
    const doc = plates(2);
    const features = [
      ...doc.features.slice(0, 2),
      sketchFeature('skm', two.sketch),
      extrudeFeature('M', extrudeInputs(both, { distance: '6 mm' })),
      ...doc.features.slice(2),
    ];
    const first = { ...doc, features, timelineMarker: features.length };
    expect(accessOf(features[3])).toBe('add');
    const steps = [
      first,
      setInputs(first, 'ex0', { distance: length('9 mm') }),
      setInputs(first, 'M', { distance: length('7 mm') }),
      setInputs(first, 'M', { profiles: refs([both[1] as GeomRef]) }),
      first,
    ];
    const p = pair();
    try {
      const out = [];
      for (const doc of steps) out.push(await p.step(doc));
      expect(out[0]?.mine.result.bodies.map((b) => b.id)).toEqual(['ex0:0', 'M:0', 'M:1', 'ex1:0']);
      expect(out[1]?.mine.result.stats.evaluated).toEqual(['ex0']);
      expect(out[3]?.mine.result.bodies.map((b) => b.id)).toEqual(['ex0:0', 'M:0', 'ex1:0']);
      for (const step of out) expect(step.problems).toEqual([]);
    } finally {
      p.close();
    }
  });

  it("a body with the feature's own ID prefix before it: `write`, the same result", {
    timeout: 120_000,
  }, async () => {
    // A feature `ex0:a` makes `ex0:a:0`, which starts with `ex0:`: so `ex0` runs as `write`, and
    // an edit of `ex0:a` runs it again.
    const doc = plates(1);
    const features = [...plateFeatures('0:a', 100, '3 mm'), ...doc.features];
    expect(features.map((f) => f.id)).toEqual(['sk0:a', 'ex0:a', 'sk0', 'ex0']);
    const first = { ...doc, features, timelineMarker: features.length };
    const out = await sequence([first, setInputs(first, 'ex0:a', { distance: length('8 mm') })]);
    expect(out[0]?.problems).toEqual([]);
    expect(out[1]?.problems).toEqual([]);
    expect(out[1]?.evaluated).toEqual(['ex0:a', 'ex0']);
  });
});

// ------------------------------------------------------------------------------- counters

describe('add access: what an edit costs', () => {
  it('an edit of the first of six independent plates evaluates one feature and sends one mesh', {
    timeout: 120_000,
  }, async () => {
    const engine = new RecomputeEngine(kernel, kernelFeatures(), { strictLeaks: true });
    try {
      const c = client(kernel, engine);
      const doc = plates(6);
      await c.run(doc);
      const after = await c.run(setInputs(doc, 'ex0', { distance: length('9 mm') }));
      expect(after.result.stats.evaluated).toEqual(['ex0']);
      expect(after.sent).toBe(1);
    } finally {
      engine.clear();
    }
  });

  it('an edit to an input the predicate leaves out runs that feature and the readers after it', {
    timeout: 300_000,
  }, async () => {
    const engine = new RecomputeEngine(kernel, kernelFeatures(), { strictLeaks: true });
    try {
      const c = client(kernel, engine);
      // Four overlapping plates and a cut through them: the cut reads every body.
      const doc = platesCut();
      await c.run(doc);
      // The plates after the edited one answer `add` and don't run; the cut keys the body set.
      for (const [label, edited] of [
        ['join', setInputs(doc, 'ex1', { operation: choice('join') })],
        ['through all', setInputs(doc, 'ex1', { extent: choice('through-all') })],
        [
          'to object',
          setInputs(doc, 'ex1', { extent: choice('to-object'), toObject: refs([capOf('ex0')]) }),
        ],
        ['face profile', setInputs(doc, 'ex1', { profiles: refs([capOf('ex0')]) })],
        ['picked body', setInputs(doc, 'ex2', { bodies: refs([{ kind: 'body', id: 'ex0:0' }]) })],
        [
          'side 2 through all',
          // Flipped: side 2 goes up, through the plates (down there is nothing in the way).
          setInputs(doc, 'ex1', {
            direction: choice('two-sides'),
            extent2: choice('through-all'),
            flip: { kind: 'bool', value: true },
          }),
        ],
      ] as const) {
        const edit = (label === 'picked body' ? 'ex2' : 'ex1') as FeatureId;
        const r = await c.run(edited);
        expect(r.result.stats.evaluated, label).toEqual([edit, 'cut']);
        expect(r.result.features[edit]?.status, label).toBe('ok');
        await c.run(doc);
      }
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
      const join = joinDoc();
      const a = await client(kernel, wrong).run(join);
      const b = await client(kernel, right).run(join);
      expect(differences(a, b)).toEqual([]);
      // ex1 was evaluated twice: once as `add` (it read a body), once as `write`.
      expect(a.result.stats.evaluated).toEqual(['sk0', 'ex0', 'sk1', 'ex1', 'ex1']);
      // The second time the same inputs come, it runs as `write` straight away (cache hit).
      const again = await client(kernel, wrong).run(join);
      expect(again.result.stats.evaluated).toEqual([]);
      // A cleared engine forgets that too: `add` is tried again.
      wrong.clear();
      const cleared = await client(kernel, wrong).run(join);
      expect(cleared.result.stats.evaluated).toEqual(['sk0', 'ex0', 'sk1', 'ex1', 'ex1']);
    } finally {
      wrong.clear();
      right.clear();
    }
  });

  it('the keys that read a body are as many as the cache holds at most, the oldest go first', {
    timeout: 120_000,
  }, async () => {
    const registry = withExtrudeAccess(() => 'add');
    const engine = new RecomputeEngine(kernel, registry(), { strictLeaks: true, maxEntries: 1 });
    try {
      const a = joinDoc();
      const b = setInputs(a, 'ex1', { distance: length('6 mm') });
      const ex1 = async (doc: ExtrudoDocument) =>
        ((await engine.recompute({ doc })) as Done).stats.evaluated.filter((id) => id === 'ex1');
      expect(await ex1(a)).toHaveLength(2);
      expect(await ex1(b)).toHaveLength(2);
      // `a`'s key went to make room for `b`'s (and the cache dropped `a`'s entry): `add` again.
      expect(await ex1(a)).toHaveLength(2);
    } finally {
      engine.clear();
    }
  });

  it('a `write` result another walk made meanwhile counts as reused', {
    timeout: 120_000,
  }, async () => {
    // A recompute and a preview of the same document, side by side: both find ex1 not yet known
    // to read a body; the recompute falls back first, the preview then finds its `write` entry.
    const registry = withExtrudeAccess(() => 'add');
    const engine = new RecomputeEngine(kernel, registry(), { strictLeaks: true });
    try {
      const doc = joinDoc();
      const last = doc.features.length - 1;
      const [r, p] = (await Promise.all([
        engine.recompute({ doc }),
        engine.preview({ doc, draft: doc.features[last] as Feature, index: last }),
      ])) as [Done, Done];
      expect(r.stats.evaluated).toEqual(['sk0', 'ex0', 'sk1', 'ex1', 'ex1']);
      expect(p.stats.evaluated).toEqual(['ex1']);
      expect(p.stats.reused).toBe(4);
    } finally {
      engine.endPreview();
      engine.clear();
    }
  });
});

/** Two plates, the second joined to the first (picked): a `get` of the first body. */
function joinDoc(): ExtrudoDocument {
  return setInputs(plates(2), 'ex1', {
    bodies: refs([{ kind: 'body', id: 'ex0:0' }]),
    operation: choice('join'),
  });
}
