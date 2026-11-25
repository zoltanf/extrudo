// `add` body access beyond the extrude (ADR-0024's amendment on `add` access): the primitives
// (box, cylinder, sphere, torus), revolve, coil, sweep, loft and import answer `add` for the inputs
// their predicates allow. The same proof as `add-access.test.ts`: seeded random edits of a design
// per feature, and after every step the engine that kept its cache gives exactly what a cleared
// engine gives. The edits take every term of the feature's predicate both ways, and back. Then
// each predicate term by term, the counters, and an import's file read. Real OCCT, a real manifold
// module and OpenSCAD's real WASM, strict leaks, no clock.
import {
  type AttachmentId,
  coilInputs,
  constructionRef,
  createDocument,
  type ExtrudoDocument,
  extrudeInputs,
  type Feature,
  type FeatureId,
  type FeatureInputs,
  FeatureRegistry,
  type GeomRef,
  importInputs,
  loftInputs,
  originPlaneRef,
  type PrimitiveInputs,
  type PrimitiveType,
  primitiveInputs,
  profileRefId,
  revolveInputs,
  sketchInputs,
  sweepInputs,
} from '@extrudo/core';
import { DEFAULT_FONT } from '@extrudo/fonts';
import type { ScadCompiler, ScadResult } from '@extrudo/openscad';
import { SketchBuilder } from '@extrudo/sketch/fixtures';
import { detectProfiles } from '@extrudo/sketch/profiles';
import { loadFont } from '@extrudo/sketch/text';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import cubeStl from '../../../../fixtures/imports/cube.stl?url&inline';
import twoParts3mf from '../../../../fixtures/imports/two-parts.3mf?url&inline';
import interRegular from '../../../fonts/fonts/inter-regular.ttf?url&inline';
import { coilAddsOnly } from '../features/coil';
import { kernelFeatures } from '../features/index';
import { loftAddsOnly } from '../features/loft';
import { primitiveAddsOnly } from '../features/primitives';
import { revolveAddsOnly } from '../features/revolve';
import { sweepAddsOnly } from '../features/sweep';
import { Kernel } from '../kernel';
import { loadManifold } from '../manifold';
import { edgeName, vertexName } from '../naming/topo-id';
import { loadOcct } from '../occt/load';
import {
  bytesOf,
  choice,
  client,
  differential,
  type Edited,
  fallbacks,
  GENERIC_KINDS,
  type GenericKind,
  genericEdit,
  length,
  plateFeatures,
  refs,
  sequence,
  setInputs,
  sketchFeature,
  withAccess,
} from './add-access-support';
import { RecomputeEngine } from './engine';
import type { ImportedFile, KernelFeatureDefinition } from './types';

// The Node compiler needs Node's types, which the kernel's program has none of (as in
// `import-scad.test.ts`): loaded through a name the type checker doesn't follow.
const NODE_ENTRY = '@extrudo/openscad/node';

let kernel: Kernel;
let compiler: ScadCompiler;
/** Compiles asked of the compiler (a cached compile isn't asked again). */
let compiles = 0;
const files = new Map<AttachmentId, ImportedFile>();

beforeAll(async () => {
  kernel = new Kernel(await loadOcct());
  kernel.enableMeshes(await loadManifold());
  loadFont(DEFAULT_FONT, bytesOf(interRegular));
  const { createNodeCompiler } = (await import(/* @vite-ignore */ NODE_ENTRY)) as {
    createNodeCompiler(): ScadCompiler;
  };
  const real = createNodeCompiler();
  compiler = {
    compile(request): Promise<ScadResult> {
      compiles++;
      return real.compile(request);
    },
    parameters: (request) => real.parameters(request),
    dispose: () => real.dispose(),
  };
  files.set(STEP, { bytes: threeBoxes(), mediaType: 'model/step', fileName: 'boxes.step' });
  files.set(STL, { bytes: bytesOf(cubeStl), mediaType: 'model/stl', fileName: 'cube.stl' });
  files.set(TMF, { bytes: bytesOf(twoParts3mf), mediaType: 'model/3mf', fileName: 'two.3mf' });
  files.set(SCAD, {
    bytes: new TextEncoder().encode(SCAD_SOURCE),
    mediaType: 'application/x-openscad',
    fileName: 'blocks.scad',
  });
}, 120_000);
afterAll(() => {
  compiler.dispose();
  expect(kernel.stats().liveShapes).toBe(0);
});

/** Both engines read the files and compile with the one compiler. */
const ENGINE = { files: (id: AttachmentId) => files.get(id), openscad: () => compiler };

// ------------------------------------------------------------------------------- features

const feature = (id: string, type: string, inputs: FeatureInputs): Feature => ({
  id: id as FeatureId,
  type,
  name: `${type} ${id}`,
  suppressed: false,
  inputs,
});

const primitive = (
  type: PrimitiveType,
  id: string,
  numbers: Record<string, string>,
  plane?: GeomRef,
): Feature => feature(id, type, primitiveInputs(type, { numbers, ...(plane && { plane }) }));

/** A plane `distance` above XY. */
const offsetPlane = (id: string, distance: string): Feature =>
  feature(id, 'offsetPlane', {
    plane: refs([originPlaneRef('origin:xy')]),
    distance: length(distance),
  });

/** The construction plane `id` as a reference. */
const planeRef = (id: string) =>
  constructionRef({ id: id as FeatureId, type: 'offsetPlane' }) as GeomRef;

/** The base every design starts with: a box B0 (x −75…−45, y 0…10, z 0…5) and a plate ex0. */
function base(): Feature[] {
  return [
    primitive('box', 'B0', {
      length: '30 mm',
      width: '10 mm',
      height: '5 mm',
      x: '-60 mm',
      y: '5 mm',
    }),
    ...plateFeatures(0, -200, '4 mm', false),
  ];
}

/** A slot `x0…x1` × `y0…y1` on a plane, cut symmetric `depth` mm through what is there. */
function slot(id: string, box: [number, number, number, number], depth: string, plane?: GeomRef) {
  const [x0, x1, y0, y1] = box;
  const b = new SketchBuilder();
  b.line(x0, y0, x1, y0);
  b.line(x1, y0, x1, y1);
  b.line(x1, y1, x0, y1);
  b.line(x0, y1, x0, y0);
  const [region] = detectProfiles(b.sketch);
  const sketch = { ...sketchFeature(`s${id}`, b.sketch) };
  if (plane) sketch.inputs = sketchInputs(plane, b.sketch);
  return [
    sketch,
    feature(
      id,
      'extrude',
      extrudeInputs(
        [{ kind: 'profile', id: profileRefId(`s${id}` as FeatureId, region?.id ?? '') }],
        {
          direction: 'symmetric',
          distance: depth,
          operation: 'cut',
        },
      ),
    ),
  ];
}

function doc(name: string, features: Feature[]): ExtrudoDocument {
  return {
    ...createDocument({ name }),
    parameters: [{ id: 'p-t', name: 't', expression: '6 mm', unit: 'length' }],
    features,
    timelineMarker: features.length,
  } as ExtrudoDocument;
}

/** The label sketch the `text` edit adds: "T1" below the X axis, on XY. */
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

// Primitives: one of each, one on a construction plane, a cut through them, a box after it.
function primitivesDesign(): ExtrudoDocument {
  return doc('primitives', [
    ...base(),
    offsetPlane('pl', '8 mm'),
    primitive('box', 'b1', { length: '20 mm', width: '20 mm', height: '10 mm' }),
    primitive('cylinder', 'c1', { diameter: '16 mm', height: 't', x: '40 mm' }),
    primitive('sphere', 's1', { diameter: '16 mm', x: '80 mm' }),
    primitive('torus', 't1', { diameter: '20 mm', tube: '6 mm', x: '120 mm' }),
    primitive('box', 'b2', { x: '160 mm' }, planeRef('pl')),
    primitive('cylinder', 'c2', { diameter: '12 mm', height: '12 mm', x: '200 mm' }),
    ...slot('cut', [-100, 230, -1, 1], '40 mm'),
    primitive('box', 'b3', { length: '10 mm', width: '10 mm', height: '10 mm', x: '260 mm' }),
  ]);
}

/**
 * A revolve's sketch `rs<id>` on XY: a 10 × 7 rectangle at x…x+10, y 5…12, and a construction
 * line along the X axis under it; the revolve `<id>` turns the rectangle about `axis` (the line
 * when `axis` is 'line').
 */
function revolveFeatures(
  id: string,
  x: number,
  axis: GeomRef | 'line',
  options: Parameters<typeof revolveInputs>[2] = {},
): Feature[] {
  const b = new SketchBuilder();
  b.line(x, 5, x + 10, 5);
  b.line(x + 10, 5, x + 10, 12);
  b.line(x + 10, 12, x, 12);
  b.line(x, 12, x, 5);
  const line = b.line(x, 0, x + 10, 0, true);
  if (line.id !== REVOLVE_LINE) throw new Error(`the axis line is ${line.id}`);
  const [region] = detectProfiles(b.sketch);
  const sketch = `rs${id}` as FeatureId;
  const about: GeomRef = axis === 'line' ? revolveLine(id) : axis;
  return [
    sketchFeature(sketch, b.sketch),
    feature(
      id,
      'revolve',
      revolveInputs(
        [{ kind: 'profile', id: profileRefId(sketch, region?.id ?? '') }],
        about,
        options,
      ),
    ),
  ];
}

const X_AXIS: GeomRef = { kind: 'axis', id: 'origin:x' };
/** The construction line of a revolve's sketch (`revolveFeatures`). */
const REVOLVE_LINE = 'l14';
const revolveLine = (id: string): GeomRef => ({
  kind: 'sketchEntity',
  id: `rs${id}/${REVOLVE_LINE}`,
});

// Revolves about the X axis (an origin axis, sketch lines, a construction axis), rings 5…12 mm
// from it; a slot through their tops splits each ring in two; a revolve after it.
function revolveDesign(): ExtrudoDocument {
  const axisSketch = new SketchBuilder();
  const along = axisSketch.line(-300, 0, 700, 0, true);
  return doc('revolves', [
    ...base(),
    sketchFeature('sax', axisSketch.sketch),
    feature('ax', 'axisAlongEdge', {
      edge: refs([{ kind: 'sketchEntity', id: `sax/${along.id}` }]),
    }),
    ...revolveFeatures('r1', 0, X_AXIS),
    ...revolveFeatures('r2', 30, 'line', { angle: '270 deg' }),
    ...revolveFeatures('r3', 60, { kind: 'axis', id: 'ax' }),
    ...revolveFeatures('r4', 90, X_AXIS, { direction: 'symmetric', angle: '180 deg' }),
    ...slot('cut', [-100, 130, 8, 9], '40 mm'),
    ...revolveFeatures('r5', 150, 'line'),
  ]);
}

/** A coil `<id>` at x on `plane` (default XY): Ø12, two turns 8 mm high, a 1.5 mm section. */
const coil = (
  id: string,
  x: number,
  plane?: GeomRef,
  more: Parameters<typeof coilInputs>[0] = {},
) =>
  feature(
    id,
    'coil',
    coilInputs({
      ...more,
      ...(plane && { plane }),
      numbers: {
        diameter: '12 mm',
        revolutions: '2',
        height: '8 mm',
        size: '1.5 mm',
        x: `${x} mm`,
        ...more.numbers,
      },
    }),
  );

// Coils on XY, on a construction plane and on XZ; a slot through them; a coil after it.
function coilDesign(): ExtrudoDocument {
  return doc('coils', [
    ...base(),
    offsetPlane('pl', '8 mm'),
    coil('co1', 0),
    coil('co2', 30, planeRef('pl')),
    coil('co3', 60, originPlaneRef('origin:xz'), { section: 'square' }),
    coil('co4', 90, undefined, { numbers: { height: 't' } }),
    ...slot('cut', [-100, 110, -1, 1], '40 mm'),
    coil('co5', 130),
  ]);
}

/**
 * A sweep `<id>`: a circle r 2 at (x, 0) on XY (sketch `wp<id>`) along a path on XZ (sketch
 * `wq<id>`): two lines up from it, 8 mm and 7 mm.
 */
function sweepFeatures(id: string, x: number, options: Parameters<typeof sweepInputs>[2] = {}) {
  const profile = new SketchBuilder();
  profile.circle(x, 0, 2);
  const [region] = detectProfiles(profile.sketch);
  const path = new SketchBuilder();
  const up = path.line(x, 0, x, 8);
  const on = path.line(x, 8, x, 15);
  const wp = `wp${id}` as FeatureId;
  const wq = `wq${id}` as FeatureId;
  return [
    sketchFeature(wp, profile.sketch),
    {
      ...sketchFeature(wq, path.sketch),
      inputs: sketchInputs(originPlaneRef('origin:xz'), path.sketch),
    },
    feature(
      id,
      'sweep',
      sweepInputs(
        [{ kind: 'profile', id: profileRefId(wp, region?.id ?? '') }],
        [
          { kind: 'sketchEntity', id: `${wq}/${up.id}` },
          { kind: 'sketchEntity', id: `${wq}/${on.id}` },
        ],
        options,
      ),
    ),
  ];
}

// Sweeps side by side; a 1 mm slab cut at z 8…9 through them all; a sweep after it.
function sweepDesign(): ExtrudoDocument {
  return doc('sweeps', [
    ...base(),
    offsetPlane('pl', '8.5 mm'),
    ...sweepFeatures('w1', 0),
    ...sweepFeatures('w2', 30, { twist: '30 deg' }),
    ...sweepFeatures('w3', 60, { scale: '0.5' }),
    ...sweepFeatures('w4', 90),
    ...slot('cut', [-10, 100, -5, 5], '1 mm', planeRef('pl')),
    ...sweepFeatures('w5', 130),
  ]);
}

/** The square of half side `h` around (cx, cy). */
function square(b: SketchBuilder, cx: number, cy: number, h: number) {
  b.line(cx - h, cy - h, cx + h, cy - h);
  b.line(cx + h, cy - h, cx + h, cy + h);
  b.line(cx + h, cy + h, cx - h, cy + h);
  b.line(cx - h, cy + h, cx - h, cy - h);
}

/** The profile of a sketch of one region. */
function profileOf(sketch: Feature): GeomRef {
  const data = (sketch.inputs.sketch as { sketch: Parameters<typeof detectProfiles>[0] }).sketch;
  const [region] = detectProfiles(data);
  return { kind: 'profile', id: profileRefId(sketch.id, region?.id ?? '') };
}

/** The lofts of `loftDesign`, in the order of their tips (sketch points `tips/p0`…`p4`). */
const TIPS = ['lo1', 'lo2', 'lo3', 'lo4', 'lo5'];

/** A loft `<id>` at x: a 20 mm square on XY, a circle on `lp1` (10 mm up), a square on `lp2`. */
function loftFeatures(id: string, x: number, options: Parameters<typeof loftInputs>[1] = {}) {
  const bottom = new SketchBuilder();
  square(bottom, x, 10, 10);
  const middle = new SketchBuilder();
  middle.circle(x, 10, 6);
  const top = new SketchBuilder();
  square(top, x, 10, 5);
  const sketches = [
    sketchFeature(`${id}a`, bottom.sketch),
    {
      ...sketchFeature(`${id}b`, middle.sketch),
      inputs: sketchInputs(planeRef('lp1'), middle.sketch),
    },
    { ...sketchFeature(`${id}c`, top.sketch), inputs: sketchInputs(planeRef('lp2'), top.sketch) },
  ];
  return [...sketches, feature(id, 'loft', loftInputs(sketches.map(profileOf), options))];
}

// Lofts side by side (one ruled), a construction point and sketch points above them for tips; a
// slot cut along their middles; a loft after it.
function loftDesign(): ExtrudoDocument {
  const tips = new SketchBuilder();
  for (const x of [0, 30, 60, 90, 130]) tips.point(x, 10);
  if (TIPS.length !== 5) throw new Error('a tip for each loft');
  return doc('lofts', [
    ...base(),
    offsetPlane('lp1', '10 mm'),
    offsetPlane('lp2', '20 mm'),
    offsetPlane('lp3', '30 mm'),
    { ...sketchFeature('tips', tips.sketch), inputs: sketchInputs(planeRef('lp3'), tips.sketch) },
    feature('cp', 'constructionPoint', {
      x: length('0 mm'),
      y: length('10 mm'),
      z: length('35 mm'),
    }),
    ...loftFeatures('lo1', 0),
    ...loftFeatures('lo2', 30, { ruled: true }),
    ...loftFeatures('lo3', 60),
    ...loftFeatures('lo4', 90),
    ...slot('cut', [-15, 100, 9.5, 10.5], '80 mm'),
    ...loftFeatures('lo5', 130),
  ]);
}

const STEP = 'att-step' as AttachmentId;
const STL = 'att-stl' as AttachmentId;
const TMF = 'att-3mf' as AttachmentId;
const SCAD = 'att-scad' as AttachmentId;

/** Two blocks apart, the first `size` mm (an override follows the parameter `t`). */
const SCAD_SOURCE =
  'size = 10;\ncube([size, size, size]);\ntranslate([20, 0, 0]) cube([5, 5, 5]);\n';

/**
 * Three boxes as one STEP file (three solids, so `splitSolids` makes three bodies), at x 300…370:
 * named, two coloured, the second hidden.
 */
function threeBoxes(): Uint8Array {
  const boxes = [
    kernel.box([10, 10, 10], [300, 0, 0]),
    kernel.box([20, 10, 10], [330, 0, 0]),
    kernel.box([10, 10, 30], [360, 0, 0]),
  ];
  try {
    const text = kernel.writeStep(
      boxes.map((shape, i) => ({
        shape,
        name: `Part${i + 1}`,
        ...(i !== 1 && { color: i === 0 ? '#c81e28' : '#1080ff' }),
      })),
    );
    const solids = [...text.matchAll(/#(\d+)\s*=\s*MANIFOLD_SOLID_BREP/g)].map((m) => m[1]);
    const end = text.lastIndexOf('ENDSEC;');
    const hidden = `#9100 = INVISIBILITY((#${solids[1]}));\n`;
    return new TextEncoder().encode(`${text.slice(0, end)}${hidden}${text.slice(end)}`);
  } finally {
    kernel.release(...boxes);
  }
}

const importFeature = (
  id: string,
  file: AttachmentId,
  options: Omit<Parameters<typeof importInputs>[0], 'file'> = {},
) => feature(id, 'import', importInputs({ file, ...options }));

const ATTACHMENTS = {
  [STEP]: { name: 'boxes', fileName: 'boxes.step', mediaType: 'model/step' },
  [STL]: { name: 'cube', fileName: 'cube.stl', mediaType: 'model/stl' },
  [TMF]: { name: 'two', fileName: 'two.3mf', mediaType: 'model/3mf' },
  [SCAD]: { name: 'blocks', fileName: 'blocks.scad', mediaType: 'application/x-openscad' },
};

function withFiles(d: ExtrudoDocument): ExtrudoDocument {
  const attachments = Object.fromEntries(
    Object.entries(ATTACHMENTS).map(([id, a], i) => [
      id,
      { ...a, sha256: `${i}`.repeat(64), size: files.get(id as AttachmentId)?.bytes.length ?? 0 },
    ]),
  );
  return { ...d, attachments } as ExtrudoDocument;
}

// Imports of every kind (a STEP of three solids with names, colours and a hidden one; an STL; a
// 3MF of two parts; an OpenSCAD file of two blocks with an override), a slot through them, and an
// import after it.
function importDesign(): ExtrudoDocument {
  return withFiles(
    doc('imports', [
      ...base(),
      importFeature('i1', STEP),
      importFeature('i2', STL),
      importFeature('i3', TMF),
      importFeature('i4', SCAD, { overrides: [{ name: 'size', value: 't', unit: 'length' }] }),
      ...slot('cut', [-100, 400, 4, 5], '80 mm'),
      importFeature('i5', STL, { position: 'centre' }),
    ]),
  );
}

// ------------------------------------------------------------------------------- the families

type Access = 'add' | 'write' | 'other';

const REGISTRY = kernelFeatures();

/** What a feature answers: `add`, `write`, or `other` (`none`, `read`, `view`). */
function accessOf(f: Feature | undefined): Access {
  if (!f) return 'other';
  const definition = REGISTRY.get(f.type);
  const access = definition?.bodyAccess?.(f.inputs as never) ?? 'write';
  return access === 'add' || access === 'write' ? access : 'other';
}

interface Term {
  kind: string;
  /** The access the edit must leave a feature that answered `add` with. */
  access: 'add' | 'write';
  /** The features whose body (`<id>:0`) or faces the edit refers to; one before the edited one. */
  refer?: readonly string[];
  change(
    f: Feature,
    other: Feature | undefined,
    pick: <T>(xs: readonly T[]) => T | undefined,
  ): FeatureInputs;
  /** The document besides the change (the text edit adds its label sketch). */
  doc?(d: ExtrudoDocument): ExtrudoDocument;
}

interface Family {
  types: readonly string[];
  terms: readonly Term[];
  /** What `insert` adds when nothing deleted is waiting. */
  make?(n: number, x: number): Feature[];
}

const BODY_TYPES = ['box', 'cylinder', 'sphere', 'torus', 'extrude'] as const;
const FLAT_CAPS = ['box', 'cylinder', 'extrude'] as const;
const capOf = (f: Feature): GeomRef => ({ kind: 'face', id: `${f.type}:${f.id}:cap:end` });
const bodyOf = (f: Feature): GeomRef => ({ kind: 'body', id: `${f.id}:0` });
const box = (f: Feature, face: string) => `box:${f.id}:${face}`;

const operationTerm: Term = {
  kind: 'operation',
  access: 'write',
  change: (_f, _o, pick) => ({
    operation: choice(pick(['join', 'cut', 'intersect'] as const) ?? 'join'),
  }),
};
const bodiesTerm: Term = {
  kind: 'bodies',
  access: 'write',
  refer: BODY_TYPES,
  change: (_f, other) => ({ bodies: refs([bodyOf(other as Feature)]) }),
};

const PLACED_TERMS: readonly Term[] = [
  operationTerm,
  bodiesTerm,
  {
    kind: 'face',
    access: 'write',
    refer: FLAT_CAPS,
    change: (_f, other) => ({ plane: refs([capOf(other as Feature)]) }),
  },
  {
    kind: 'plane',
    access: 'add',
    change: (_f, _o, pick) => ({
      plane: refs([
        pick([originPlaneRef('origin:xz'), originPlaneRef('origin:yz'), planeRef('pl')]) ??
          originPlaneRef('origin:xy'),
      ]),
    }),
  },
  {
    kind: 'offset',
    access: 'add',
    change: (_f, _o, pick) => ({ offset: length(pick(['3 mm', '-2 mm']) ?? '3 mm') }),
  },
];

const PRIMITIVES: Family = {
  types: ['box', 'cylinder', 'sphere', 'torus'],
  terms: [
    ...PLACED_TERMS,
    {
      kind: 'shape',
      access: 'add',
      change: (f): FeatureInputs =>
        f.type === 'box'
          ? { rotation: { kind: 'expr', expr: '30 deg', unit: 'angle' } }
          : f.type === 'torus'
            ? { axis: choice('x'), seat: choice('plane') }
            : { y: length('4 mm') },
    },
  ],
  make: (n, x) => [
    primitive('box', `b${n}`, { length: '10 mm', width: '10 mm', height: '10 mm', x: `${x} mm` }),
  ],
};

const COILS: Family = {
  types: ['coil'],
  terms: [
    ...PLACED_TERMS,
    {
      kind: 'shape',
      access: 'add',
      change: (_f, _o, pick) =>
        pick([{ section: choice('triangle-out') }, { direction: choice('clockwise') }]) ?? {},
    },
  ],
  make: (n, x) => [coil(`co${n}`, x)],
};

const LABEL = labelSketch();

const REVOLVES: Family = {
  types: ['revolve'],
  terms: [
    operationTerm,
    bodiesTerm,
    {
      // The box's bottom face, in XY beside the X axis.
      kind: 'face',
      access: 'write',
      refer: ['box'],
      change: (_f, other) => ({
        profiles: refs([{ kind: 'face', id: box(other as Feature, 'cap:start') }]),
      }),
    },
    {
      // The box's bottom front edge, on the X axis.
      kind: 'edge',
      access: 'write',
      refer: ['box'],
      change: (_f, other) => ({
        axis: refs([
          {
            kind: 'edge',
            id: edgeName([box(other as Feature, 'cap:start'), box(other as Feature, 'side:front')]),
          },
        ]),
      }),
    },
    {
      kind: 'to-object',
      access: 'write',
      refer: BODY_TYPES,
      change: (_f, other, pick) => ({
        direction: choice('one-side'),
        extent: choice('to-object'),
        toObject: refs([pick([originPlaneRef('origin:xz'), bodyOf(other as Feature)]) as GeomRef]),
      }),
    },
    {
      kind: 'axis',
      access: 'add',
      change: (f, _o, pick) => ({
        axis: refs([pick([X_AXIS, { kind: 'axis', id: 'ax' }, revolveLine(f.id)]) as GeomRef]),
      }),
    },
    {
      kind: 'text',
      access: 'add',
      change: () => ({ profiles: refs([{ kind: 'sketchEntity', id: `skl/${LABEL.text}` }]) }),
      doc: (d) =>
        d.features.some((x) => x.id === 'skl')
          ? d
          : {
              ...d,
              features: [LABEL.feature, ...d.features],
              timelineMarker: d.timelineMarker + 1,
            },
    },
    {
      kind: 'angles',
      access: 'add',
      change: (_f, _o, pick) =>
        pick<FeatureInputs>([
          {
            direction: choice('symmetric'),
            angle: { kind: 'expr', expr: '120 deg', unit: 'angle' },
          },
          {
            direction: choice('two-sides'),
            angle: { kind: 'expr', expr: '90 deg', unit: 'angle' },
            angle2: { kind: 'expr', expr: '45 deg', unit: 'angle' },
          },
          {
            flip: { kind: 'bool', value: true },
            angle: { kind: 'expr', expr: '200 deg', unit: 'angle' },
          },
        ]) ?? {},
    },
  ],
  make: (n, x) => revolveFeatures(`r${n}`, x, X_AXIS),
};

const SWEEPS: Family = {
  types: ['sweep'],
  terms: [
    operationTerm,
    bodiesTerm,
    {
      kind: 'face',
      access: 'write',
      refer: FLAT_CAPS,
      change: (_f, other) => ({ profiles: refs([capOf(other as Feature)]) }),
    },
    {
      // The box's front right edge, upright.
      kind: 'edge',
      access: 'write',
      refer: ['box'],
      change: (_f, other) => ({
        path: refs([
          {
            kind: 'edge',
            id: edgeName([
              box(other as Feature, 'side:front'),
              box(other as Feature, 'side:right'),
            ]),
          },
        ]),
      }),
    },
    {
      // The path's first curve alone.
      kind: 'path',
      access: 'add',
      change: (f) => ({ path: refs([(f.inputs.path as { refs: GeomRef[] }).refs[0] as GeomRef]) }),
    },
    {
      kind: 'twist',
      access: 'add',
      change: (_f, _o, pick) =>
        pick<FeatureInputs>([
          { twist: { kind: 'expr', expr: '45 deg', unit: 'angle' } },
          { scale: { kind: 'expr', expr: '0.7', unit: 'unitless' } },
          { orientation: choice('fixed') },
        ]) ?? {},
    },
  ],
  make: (n, x) => sweepFeatures(`w${n}`, x),
};

const LOFTS: Family = {
  types: ['loft'],
  terms: [
    operationTerm,
    bodiesTerm,
    {
      // The first section: a flat cap 4 or 5 mm up.
      kind: 'face',
      access: 'write',
      refer: FLAT_CAPS,
      change: (f, other) => {
        const [, ...rest] = (f.inputs.sections as { refs: GeomRef[] }).refs;
        return { sections: refs([capOf(other as Feature), ...rest]) };
      },
    },
    {
      // A tip at the box's top front right corner.
      kind: 'vertex',
      access: 'write',
      refer: ['box'],
      change: (f, other) => {
        const o = other as Feature;
        const tip = vertexName([box(o, 'cap:end'), box(o, 'side:front'), box(o, 'side:right')]);
        return {
          sections: refs([
            ...(f.inputs.sections as { refs: GeomRef[] }).refs,
            { kind: 'vertex', id: tip },
          ]),
        };
      },
    },
    {
      // A tip over the loft: the construction point for lo1, a sketch point 30 mm up for the others.
      kind: 'point',
      access: 'add',
      change: (f) => {
        const tip: GeomRef =
          f.id === 'lo1'
            ? { kind: 'point', id: 'cp' }
            : { kind: 'sketchEntity', id: `tips/p${TIPS.indexOf(f.id)}` };
        return { sections: refs([...(f.inputs.sections as { refs: GeomRef[] }).refs, tip]) };
      },
    },
    {
      kind: 'ruled',
      access: 'add',
      change: (f) => ({
        ruled: { kind: 'bool', value: !(f.inputs.ruled as { value?: boolean } | undefined)?.value },
      }),
    },
  ],
  make: (n, x) => loftFeatures(`lo${n}`, x),
};

const IMPORTS: Family = {
  types: ['import'],
  terms: [
    {
      kind: 'up',
      access: 'add',
      change: (f) => ({
        up: choice((f.inputs.up as { value?: string } | undefined)?.value === 'y' ? 'z' : 'y'),
      }),
    },
    {
      kind: 'position',
      access: 'add',
      change: (f) => ({
        position: choice(
          (f.inputs.position as { value?: string } | undefined)?.value === 'centre'
            ? 'file'
            : 'centre',
        ),
      }),
    },
    {
      kind: 'units',
      access: 'add',
      change: (_f, _o, pick) => ({ units: choice(pick(['cm', 'mm', 'auto'] as const) ?? 'mm') }),
    },
  ],
  // An STL or a 3MF by turns.
  make: (n) => [importFeature(`i${n}`, n % 2 ? STL : TMF)],
};

/** The kinds of edit for a family: `insert`, its terms, back to `add` (if a term writes), the rest. */
function kindsOf(family: Family): string[] {
  const writes = family.terms.some((t) => t.access === 'write');
  return [
    'insert',
    ...family.terms.map((t) => t.kind),
    ...(writes ? ['adds'] : []),
    ...GENERIC_KINDS.filter((k) => k !== 'insert'),
  ];
}

/** `doc` with one feature's inputs replaced. */
function replaceInputs(d: ExtrudoDocument, id: FeatureId, inputs: FeatureInputs): ExtrudoDocument {
  return { ...d, features: d.features.map((f) => (f.id === id ? { ...f, inputs } : f)) };
}

/** The edit function of a family: its terms, back to `add`, and the generic edits. */
function familyEdit(family: Family, start: ExtrudoDocument) {
  // Every feature's inputs as the design (or `insert`) made them: what `adds` goes back to.
  const original = new Map(start.features.map((f) => [f.id, f.inputs]));
  const make = family.make
    ? (n: number, x: number) => {
        const made = (family.make as NonNullable<Family['make']>)(n, x);
        for (const f of made) original.set(f.id, f.inputs);
        return made;
      }
    : undefined;
  return (
    kind: string,
    d: ExtrudoDocument,
    rand: () => number,
    history: readonly ExtrudoDocument[],
    deleted: Feature[],
  ): Edited | undefined => {
    if ((GENERIC_KINDS as readonly string[]).includes(kind)) {
      return genericEdit(kind as GenericKind, d, rand, history, deleted, make);
    }
    const pick = <T>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)];
    const members = d.features.filter((f) => family.types.includes(f.type) && !f.suppressed);
    if (kind === 'adds') {
      const f = pick(
        members.filter((x) => {
          const back = original.get(x.id);
          return accessOf(x) === 'write' && back && accessOf({ ...x, inputs: back }) === 'add';
        }),
      );
      return (
        f && { doc: replaceInputs(d, f.id, original.get(f.id) as FeatureInputs), feature: f.id }
      );
    }
    const term = family.terms.find((t) => t.kind === kind);
    if (!term) throw new Error(`no term ${kind}`);
    const earlier = (f: Feature) =>
      d.features
        .slice(0, d.features.indexOf(f))
        .filter((x) => !x.suppressed && (term.refer ?? []).includes(x.type));
    const adding = members.filter(
      (x) => accessOf(x) === 'add' && (!term.refer || earlier(x).length > 0),
    );
    const f = pick(adding);
    if (!f) return undefined;
    const other = term.refer ? pick(earlier(f)) : undefined;
    const changed = setInputs(d, f.id, term.change(f, other, pick));
    return { doc: term.doc ? term.doc(changed) : changed, feature: f.id };
  };
}

/** A design, its family, and the kinds whose edited feature must compute at least once. */
const DESIGNS: [string, () => ExtrudoDocument, Family, string[]][] = [
  [
    'primitives (box, cylinder, sphere, torus)',
    primitivesDesign,
    PRIMITIVES,
    ['bodies', 'face', 'plane', 'offset', 'shape', 'adds'],
  ],
  [
    'revolves',
    revolveDesign,
    REVOLVES,
    ['bodies', 'face', 'edge', 'axis', 'text', 'angles', 'adds'],
  ],
  ['coils', coilDesign, COILS, ['bodies', 'face', 'plane', 'offset', 'shape', 'adds']],
  ['sweeps', sweepDesign, SWEEPS, ['bodies', 'path', 'twist', 'adds']],
  ['lofts', loftDesign, LOFTS, ['bodies', 'face', 'point', 'adds']],
  ['imports (STEP, STL, 3MF, OpenSCAD)', importDesign, IMPORTS, ['up', 'position', 'units']],
];

describe('add access beyond the extrude: the cached engine gives what a cleared one gives', () => {
  it.each(DESIGNS)(
    '%s, 40 seeded edits',
    { timeout: 900_000 },
    async (_n, make, family, computes) => {
      const start = make();
      const kinds = kindsOf(family);
      const run = await differential(kernel, start, 40, 2511, {
        kinds,
        edit: familyEdit(family, start),
        access: accessOf,
        options: ENGINE,
      });
      expect(run.initialErrors).toEqual([]);
      expect(run.problems).toEqual([]);
      // No `add` evaluation read a body (none ran again as `write`).
      expect(run.fallbacks).toEqual([]);
      for (const kind of kinds) expect(run.kinds).toContain(kind);
      // Every term did what it must to a feature that answered `add`, and one came back to `add`.
      for (const term of family.terms)
        expect(run.flips).toContain(`${term.kind}: add→${term.access}`);
      if (kinds.includes('adds')) expect(run.flips).toContain('adds: write→add');
      for (const kind of computes) expect(run.computed).toContain(kind);
      expect(run.compared).toBe(41);
      expect(run.evaluated[0]).toBeLessThan(run.evaluated[1]);
      // The design starts with features that answer `add`.
      expect(
        start.features.filter((f) => family.types.includes(f.type)).map(accessOf),
      ).not.toContain('write');
    },
  );
});

// ------------------------------------------------------------------------------- the predicates

describe('the predicates, term by term', () => {
  const profile: GeomRef = { kind: 'profile', id: 'sk/r' };
  const face: GeomRef = { kind: 'face', id: 'box:B:cap:end' };
  const ops = ['join', 'cut', 'intersect'] as const;

  it('a primitive and a coil: a new body on a plane, nothing picked', () => {
    const cases: [string, Parameters<typeof primitiveInputs>[1], boolean][] = [
      ['the default plane', {}, true],
      ['an origin plane', { plane: originPlaneRef('origin:yz') }, true],
      ['a construction plane', { plane: planeRef('pl') }, true],
      ['a face', { plane: face }, false],
      ['picked bodies', { bodies: ['B:0'] }, false],
      ...ops.map((operation): [string, Parameters<typeof primitiveInputs>[1], boolean] => [
        operation,
        { operation },
        false,
      ]),
    ];
    for (const [name, options, add] of cases) {
      for (const type of ['box', 'cylinder', 'sphere', 'torus'] as const) {
        expect(primitiveAddsOnly(primitiveInputs(type, options)), `${type}: ${name}`).toBe(add);
      }
      expect(coilAddsOnly(coilInputs(options)), `coil: ${name}`).toBe(add);
    }
  });

  it('a revolve: a new body of profiles or text by angles about an axis or a sketch line', () => {
    const line: GeomRef = { kind: 'sketchEntity', id: 'sk/l1' };
    const edge: GeomRef = { kind: 'edge', id: 'e[box:B:cap:start|box:B:side:front]' };
    const cases: [
      string,
      GeomRef[],
      GeomRef | undefined,
      Parameters<typeof revolveInputs>[2],
      boolean,
    ][] = [
      ['an origin axis', [profile], X_AXIS, {}, true],
      ['a construction axis', [profile], { kind: 'axis', id: 'ax' }, {}, true],
      ['a sketch line', [profile], line, {}, true],
      ['text', [{ kind: 'sketchEntity', id: 'sk/t' }], X_AXIS, {}, true],
      ['symmetric', [profile], X_AXIS, { direction: 'symmetric', angle: '90 deg' }, true],
      ['two sides', [profile], X_AXIS, { direction: 'two-sides', angle2: '30 deg' }, true],
      ['an object left over, by an angle', [profile], X_AXIS, { toObject: face }, true],
      ['a face profile', [face], X_AXIS, {}, false],
      ['an edge axis', [profile], edge, {}, false],
      ['no axis', [profile], undefined, {}, false],
      [
        'to a plane',
        [profile],
        X_AXIS,
        { extent: 'to-object', toObject: originPlaneRef('origin:xz') },
        false,
      ],
      ['to a face', [profile], X_AXIS, { extent: 'to-object', toObject: face }, false],
      ['picked bodies', [profile], X_AXIS, { bodies: ['B:0'] }, false],
      ...ops.map(
        (operation): [string, GeomRef[], GeomRef, Parameters<typeof revolveInputs>[2], boolean] => [
          operation,
          [profile],
          X_AXIS,
          { operation },
          false,
        ],
      ),
    ];
    for (const [name, profiles, axis, options, add] of cases) {
      expect(revolveAddsOnly(revolveInputs(profiles, axis, options)), name).toBe(add);
    }
  });

  it('a sweep: a new body of profiles along sketch curves', () => {
    const curve: GeomRef = { kind: 'sketchEntity', id: 'sk/l1' };
    const edge: GeomRef = { kind: 'edge', id: 'e[box:B:side:front|box:B:side:right]' };
    const cases: [string, GeomRef[], GeomRef[], Parameters<typeof sweepInputs>[2], boolean][] = [
      ['a profile along a sketch curve', [profile], [curve], {}, true],
      ['twisted, scaled', [profile], [curve], { twist: '30 deg', scale: '0.5' }, true],
      ['fixed', [profile], [curve], { orientation: 'fixed' }, true],
      ['a face profile', [face], [curve], {}, false],
      ['an edge in the path', [profile], [curve, edge], {}, false],
      ['picked bodies', [profile], [curve], { bodies: ['B:0'] }, false],
      ...ops.map(
        (operation): [string, GeomRef[], GeomRef[], Parameters<typeof sweepInputs>[2], boolean] => [
          operation,
          [profile],
          [curve],
          { operation },
          false,
        ],
      ),
    ];
    for (const [name, profiles, path, options, add] of cases) {
      expect(sweepAddsOnly(sweepInputs(profiles, path, options)), name).toBe(add);
    }
  });

  it('a loft: a new body through profiles and points', () => {
    const vertex: GeomRef = {
      kind: 'vertex',
      id: 'v[box:B:cap:end|box:B:side:front|box:B:side:right]',
    };
    const cases: [string, GeomRef[], Parameters<typeof loftInputs>[1], boolean][] = [
      ['profiles', [profile, profile], {}, true],
      ['a construction point', [profile, { kind: 'point', id: 'cp' }], {}, true],
      ['a sketch point', [profile, { kind: 'sketchEntity', id: 'sk/p1' }], {}, true],
      ['ruled, closed', [profile, profile, profile], { ruled: true, closed: true }, true],
      ['a face', [face, profile], {}, false],
      ['a vertex', [profile, vertex], {}, false],
      ['picked bodies', [profile, profile], { bodies: ['B:0'] }, false],
      ...ops.map((operation): [string, GeomRef[], Parameters<typeof loftInputs>[1], boolean] => [
        operation,
        [profile, profile],
        { operation },
        false,
      ]),
    ];
    for (const [name, sections, options, add] of cases) {
      expect(loftAddsOnly(loftInputs(sections, options)), name).toBe(add);
    }
  });

  it('an import: always', () => {
    for (const options of [{}, { up: 'y', position: 'centre', units: 'cm' }] as const) {
      expect(
        REGISTRY.get('import')?.bodyAccess?.(importInputs({ file: STEP, ...options }) as never),
      ).toBe('add');
    }
  });
});

// ------------------------------------------------------------------------------- counters

/** Four separate instances (each with its own sketches) and an edit of the first. */
const SEPARATE: [string, () => ExtrudoDocument, string, FeatureInputs][] = [
  ...(['box', 'cylinder', 'sphere', 'torus'] as const).map(
    (type): [string, () => ExtrudoDocument, string, FeatureInputs] => [
      type,
      () =>
        doc(
          type,
          [0, 1, 2, 3].map((i) => primitive(type, `${type}${i}`, { x: `${40 * i} mm` })),
        ),
      `${type}0`,
      { x: length('-5 mm') },
    ],
  ),
  [
    'revolves',
    () =>
      doc(
        'revolves',
        [0, 1, 2, 3].flatMap((i) => revolveFeatures(`r${i}`, 30 * i, X_AXIS)),
      ),
    'r0',
    { angle: { kind: 'expr', expr: '90 deg', unit: 'angle' } },
  ],
  [
    'coils',
    () =>
      doc(
        'coils',
        [0, 1, 2, 3].map((i) => coil(`co${i}`, 30 * i)),
      ),
    'co0',
    { diameter: length('14 mm') },
  ],
  [
    'sweeps',
    () =>
      doc(
        'sweeps',
        [0, 1, 2, 3].flatMap((i) => sweepFeatures(`w${i}`, 30 * i)),
      ),
    'w0',
    { scale: { kind: 'expr', expr: '0.8', unit: 'unitless' } },
  ],
  [
    'lofts',
    () =>
      doc('lofts', [
        offsetPlane('lp1', '10 mm'),
        offsetPlane('lp2', '20 mm'),
        ...[0, 1, 2, 3].flatMap((i) => loftFeatures(`lo${i}`, 30 * i)),
      ]),
    'lo0',
    { ruled: { kind: 'bool', value: true } },
  ],
  [
    'imports',
    () =>
      withFiles(
        doc('imports', [
          importFeature('i0', STL),
          importFeature('i1', TMF),
          importFeature('i2', STEP),
          importFeature('i3', SCAD),
        ]),
      ),
    'i0',
    { position: choice('centre') },
  ],
];

describe('add access beyond the extrude: what an edit costs', () => {
  it.each(SEPARATE)(
    '%s: an edit of the first of four evaluates it alone and sends one mesh',
    { timeout: 300_000 },
    async (_n, make, first, more) => {
      const engine = new RecomputeEngine(kernel, kernelFeatures(), {
        ...ENGINE,
        strictLeaks: true,
      });
      try {
        const c = client(engine);
        const d = make();
        const before = await c.run(d);
        expect(fallbacks(before.result, d)).toEqual([]);
        for (const [id, status] of Object.entries(before.result.features))
          expect(status, id).toMatchObject({ status: 'ok' });
        const after = await c.run(setInputs(d, first, more));
        expect(after.result.features[first as FeatureId]).toEqual({ status: 'ok' });
        expect(after.result.stats.evaluated).toEqual([first]);
        expect(after.sent).toBe(1);
      } finally {
        engine.clear();
      }
    },
  );

  it.each(DESIGNS)(
    '%s: each term on the first one runs it and the cut, not the ones after',
    { timeout: 600_000 },
    async (_n, make, family) => {
      const d = make();
      // The first of the family after the base (B0 is the box every term can refer to).
      const member = d.features.find(
        (f) => family.types.includes(f.type) && f.id !== 'B0',
      ) as Feature;
      const b0 = d.features.find((f) => f.id === 'B0') as Feature;
      // The last choice: the first is the design's own for some terms (the revolve's axis).
      const pick = <T>(xs: readonly T[]) => xs[xs.length - 1];
      for (const term of family.terms) {
        // A fresh engine for each term: a body set an earlier term left would be a cache hit.
        const engine = new RecomputeEngine(kernel, kernelFeatures(), {
          ...ENGINE,
          strictLeaks: true,
        });
        try {
          const c = client(engine);
          await c.run(d);
          const changed = setInputs(d, member.id, term.change(member, b0, pick));
          const r = await c.run(term.doc ? term.doc(changed) : changed);
          // The cut runs again whether the edited feature computed or failed (its body is gone
          // then). The text edit's label sketch is new, so it runs too.
          expect(
            r.result.stats.evaluated.filter((id) => id !== 'skl'),
            term.kind,
          ).toEqual([member.id, 'cut']);
        } finally {
          engine.clear();
        }
      }
    },
  );

  it('an import after a body with its own ID prefix: `write`, the same result', {
    timeout: 120_000,
  }, async () => {
    // A box `i0:a` makes `i0:a:0`, which starts with `i0:`: the import `i0` runs as `write`, and
    // an edit of the box runs it again.
    const first = withFiles(
      doc('prefix', [primitive('box', 'i0:a', { x: '100 mm' }), importFeature('i0', STEP)]),
    );
    const out = await sequence(
      kernel,
      [first, setInputs(first, 'i0:a', { height: length('12 mm') })],
      { options: ENGINE },
    );
    expect(out[0]?.problems).toEqual([]);
    expect(out[1]?.problems).toEqual([]);
    expect(out[1]?.evaluated).toEqual(['i0:a', 'i0']);
    expect(out[0]?.result.bodies.map((b) => b.id)).toEqual(['i0:a:0', 'i0:0', 'i0:1', 'i0:2']);
  });

  it('an edit before the imports reads no file, parses nothing and compiles nothing', {
    timeout: 300_000,
  }, async () => {
    const counts = { evaluate: 0, prepare: 0, files: 0, compiles: 0 };
    const registry = () => {
      const wrapped = new FeatureRegistry<KernelFeatureDefinition>();
      for (const own of kernelFeatures().list()) {
        wrapped.register(
          own.type !== 'import'
            ? own
            : {
                ...own,
                evaluate: (ctx) => {
                  counts.evaluate++;
                  return own.evaluate(ctx);
                },
                prepare: (ctx) => {
                  counts.prepare++;
                  return (own.prepare as NonNullable<KernelFeatureDefinition['prepare']>)(ctx);
                },
              },
        );
      }
      return wrapped;
    };
    const engine = new RecomputeEngine(kernel, registry(), {
      strictLeaks: true,
      files: (id) => {
        counts.files++;
        return files.get(id);
      },
      openscad: () => compiler,
    });
    try {
      const c = client(engine);
      const d = withFiles(
        doc('imports', [
          ...plateFeatures(0, -200, '4 mm'),
          importFeature('i1', STEP),
          importFeature('i2', STL),
          importFeature('i3', TMF),
          importFeature('i4', SCAD, {
            overrides: [{ name: 'size', value: '8 mm', unit: 'length' }],
          }),
        ]),
      );
      const first = await c.run(d);
      for (const [id, status] of Object.entries(first.result.features))
        expect(status, id).toMatchObject({ status: 'ok' });
      // The STEP file's three solids are three bodies; none of the imports fell back.
      expect(first.result.bodies.map((b) => b.id)).toEqual([
        'ex0:0',
        'i1:0',
        'i1:1',
        'i1:2',
        'i2:0',
        'i3:0',
        'i3:1',
        'i4:0',
        'i4:1',
      ]);
      expect(fallbacks(first.result, d)).toEqual([]);
      expect(counts.evaluate).toBe(4);
      expect(counts.prepare).toBe(4);
      expect(counts.files).toBeGreaterThan(0);
      for (const k of Object.keys(counts) as (keyof typeof counts)[]) counts[k] = 0;
      compiles = 0;
      const after = await c.run(setInputs(d, 'ex0', { distance: length('6 mm') }));
      expect(after.result.stats.evaluated).toEqual(['ex0']);
      expect(after.sent).toBe(1);
      expect({ ...counts, compiles }).toEqual({ evaluate: 0, prepare: 0, files: 0, compiles: 0 });
    } finally {
      engine.clear();
    }
  });
});

// ------------------------------------------------------------------------------- negative control

describe('the comparison catches a wrong `add` here too (negative control)', () => {
  it('a box joined to the box it overlaps, said to be `add`, gives other bodies at once', {
    timeout: 120_000,
  }, async () => {
    // A join finds the bodies it touches by going through them all, which the fall-back doesn't
    // notice: under `add` it finds none and makes a new body. Only the cached engine has the fault.
    const d = doc('join', [
      primitive('box', 'a', {}),
      feature('j', 'box', primitiveInputs('box', { numbers: { x: '10 mm' }, operation: 'join' })),
    ]);
    const [step] = await sequence(kernel, [d], {
      registry: withAccess('box', (inputs: PrimitiveInputs) =>
        (inputs.operation?.value ?? 'new-body') === 'join' || primitiveAddsOnly(inputs)
          ? 'add'
          : 'write',
      ),
    });
    expect(step?.result.bodies.map((b) => b.id)).toEqual(['a:0', 'j:0']);
    expect(step?.problems).toEqual(['statuses', 'reports', 'bodies a:0,j:0 vs a:0', 'mesh a:0']);
    expect(fallbacks(step?.result as never, d)).toEqual([]);
  });
});
