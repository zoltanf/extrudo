// The Remove Faces feature (ADR-0099) through the recompute engine with real
// OCCT: holes (through, blind, counterbored, countersunk) and fillet runs
// removed, the pick rule (`removeFacesPick`) on real bodies, names kept by
// the extended neighbours, refusals and their messages. The pick rule's
// geometry is also tested on hand-built descriptions, without WASM.
import {
  type BodyId,
  type ExtrudoDocument,
  extrudeInputs,
  type Feature,
  type FeatureId,
  FeatureRegistry,
  type FeatureStatus,
  filletInputs,
  type GeomRef,
  HOLE_TYPE,
  type HoleInputOptions,
  holeInputs,
  originPlaneRef,
  removeFacesInputs,
  type SketchData,
  sketchInputs,
} from '@extrudo/core';
import { SketchBuilder } from '@extrudo/sketch/fixtures';
import { detectProfiles } from '@extrudo/sketch/profiles';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Kernel, type ShapeHandle, type Vec3 } from '../kernel';
import { edgeName } from '../naming';
import type { ShapeDescription } from '../naming/description';
import { loadOcct } from '../occt/load';
import { RecomputeEngine } from '../recompute/engine';
import { testDocument, testFeature, testFeatures } from '../recompute/testing';
import type { KernelFeatureDefinition, RecomputeResult } from '../recompute/types';
import { type PickSurface, refusalMessage, removeFacesPick } from './remove-faces';

// ------------------------------------------------------------ pure picks

/** A hand-built description: faces by type (and a plane's normal), edges and vertices by their faces. */
function described(
  faces: { type: ShapeDescription['faces'][number]['type']; direction?: Vec3 }[],
  edges: { at: Vec3; faces: number[] }[],
  vertices: { at: Vec3; faces: number[] }[] = [],
): ShapeDescription {
  return {
    faces: faces.map((f) => ({
      type: f.type,
      area: 1,
      centroid: [0, 0, 0],
      direction: f.direction,
    })),
    edges: edges.map((e) => ({ type: 'line', length: 1, midpoint: e.at, faces: e.faces })),
    vertices: vertices.map((v) => ({ point: v.at, faces: v.faces })),
  };
}

const Z: Vec3 = [0, 0, 1];
const axisAt = (x = 0, y = 0): PickSurface['axis'] => ({ origin: [x, y, 0], direction: Z });
const wall = (x = 0): PickSurface => ({ axis: axisAt(x), inside: true, whole: true });

/**
 * A 40 × 30 plate (top 0, bottom 1, sides 2–5) with a counterbored blind hole on
 * the z axis: narrow wall 6 (r 3), step 7, wide wall 8 (r 5.5), floor 9.
 */
function counterbore(wideOffset = 0) {
  const description = described(
    [
      { type: 'plane', direction: Z },
      { type: 'plane', direction: [0, 0, -1] },
      { type: 'plane', direction: [1, 0, 0] },
      { type: 'plane', direction: [1, 0, 0] },
      { type: 'plane', direction: [0, 1, 0] },
      { type: 'plane', direction: [0, 1, 0] },
      { type: 'cylinder' },
      { type: 'plane', direction: Z },
      { type: 'cylinder' },
      { type: 'plane', direction: Z },
    ],
    [
      // The plate's top edges, far out.
      { at: [20, 0, 10], faces: [0, 2] },
      { at: [-20, 0, 10], faces: [0, 3] },
      { at: [0, 15, 10], faces: [0, 4] },
      { at: [0, -15, 10], faces: [0, 5] },
      { at: [20, 0, 0], faces: [1, 2] },
      // The hole's circles and seams.
      { at: [5.5, 0, 10], faces: [0, 8] },
      { at: [5.5, 0, 7], faces: [8, 7] },
      { at: [3, 0, 7], faces: [7, 6] },
      { at: [3, 0, 2], faces: [6, 9] },
      { at: [3, 0, 4.5], faces: [6] },
      { at: [5.5, 0, 8.5], faces: [8] },
    ],
    [
      { at: [20, 15, 10], faces: [0, 2, 4] },
      { at: [5.5, 0, 10], faces: [0, 8] },
      { at: [5.5, 0, 7], faces: [7, 8] },
      { at: [3, 0, 7], faces: [6, 7] },
      { at: [3, 0, 2], faces: [6, 9] },
    ],
  );
  const surfaces = new Map<number, PickSurface>([
    [6, wall()],
    [8, { ...wall(), axis: axisAt(wideOffset) }],
  ]);
  return { description, surface: (face: number) => surfaces.get(face) };
}

const noChain = (face: number) => [face];

describe('the Remove Faces pick rule (plain data)', () => {
  it('takes a whole counterbored hole from its narrow wall, not the face it opens onto', () => {
    const { description, surface } = counterbore();
    expect(removeFacesPick([6], description, surface, noChain).sort()).toEqual([6, 7, 8, 9]);
    expect(removeFacesPick([8], description, surface, noChain).sort()).toEqual([6, 7, 8, 9]);
  });

  it('keeps faces on axes 2e-4 mm off, takes them 0.5e-4 mm off', () => {
    const off = counterbore(2e-4);
    // The wide wall is off the axis, so the step (out to r 5.5) is past the hole's radius.
    expect(removeFacesPick([6], off.description, off.surface, noChain)).toEqual([6, 9]);
    const near = counterbore(0.5e-4);
    expect(removeFacesPick([6], near.description, near.surface, noChain).sort()).toEqual([
      6, 7, 8, 9,
    ]);
  });

  it('a wall that is not all the way round, or a shaft, is not a hole', () => {
    const { description } = counterbore();
    const half = (face: number) =>
      face === 6 ? { ...wall(), whole: false } : face === 8 ? wall() : undefined;
    expect(removeFacesPick([6], description, half, noChain)).toEqual([6]);
    const shaft = (face: number) => (face === 6 ? { ...wall(), inside: false } : undefined);
    expect(removeFacesPick([6], description, shaft, noChain)).toEqual([6]);
  });

  it('a round takes its smooth chain through curved faces only', () => {
    // Plane 0 – round 1 – round 2 – plane 3, all one smooth chain, round 4 apart.
    const description = described(
      [
        { type: 'plane', direction: Z },
        { type: 'cylinder' },
        { type: 'torus' },
        { type: 'plane', direction: [1, 0, 0] },
        { type: 'cylinder' },
      ],
      [
        { at: [0, 0, 0], faces: [0, 1] },
        { at: [1, 0, 0], faces: [1, 2] },
        { at: [2, 0, 0], faces: [2, 3] },
        { at: [3, 0, 0], faces: [3, 4] },
      ],
    );
    const chain = (face: number) => (face === 4 ? [4, 3] : [0, 1, 2, 3]);
    const surface = () => ({ axis: axisAt(), inside: false, whole: false });
    expect(removeFacesPick([1], description, surface, chain)).toEqual([1, 2]);
    expect(removeFacesPick([4], description, surface, chain)).toEqual([4]);
    // A plane is itself; several starts give the union, starts first, no duplicates.
    expect(removeFacesPick([0], description, surface, chain)).toEqual([0]);
    expect(removeFacesPick([3, 2, 1], description, surface, chain)).toEqual([3, 2, 1]);
    expect(removeFacesPick([4, 1], description, surface, chain)).toEqual([4, 1, 2]);
  });

  it('words the refusal by the faces counted', () => {
    expect(refusalMessage(1, 1)).toBe(
      "Remove Faces can't close the gap this face leaves. Pick the rest of the round or hole too (1 more face), or fewer faces.",
    );
    expect(refusalMessage(2, 3)).toBe(
      "Remove Faces can't close the gap these 2 faces leave. Pick the rest of the round or hole too (3 more faces), or fewer faces.",
    );
    expect(refusalMessage(2, 0)).toBe(
      "Remove Faces can't close the gap these 2 faces leave: the faces around them can't be extended to meet. Pick fewer faces, or the whole round or hole.",
    );
  });
});

// ------------------------------------------------------------- with OCCT

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

type Done = Extract<RecomputeResult, { status: 'done' }>;

const B0 = 'B:0' as BodyId;
const BOX = 40 * 30 * 10;
const TOP: GeomRef = { kind: 'face', id: 'extrude:B:cap:end' };
const cap = 'extrude:B:cap:end';

function sketch(id: string, data: SketchData): Feature {
  return { ...testFeature(id, 'sketch'), inputs: sketchInputs(originPlaneRef('origin:xy'), data) };
}

/** A 40 × 30 × 10 block (body `B:0`) on XY from z = 0 up, and its side lines. */
function block() {
  const b = new SketchBuilder();
  const lines = {
    front: b.line(0, 0, 40, 0).id,
    right: b.line(40, 0, 40, 30).id,
    back: b.line(40, 30, 0, 30).id,
    left: b.line(0, 30, 0, 0).id,
  };
  const [profile] = detectProfiles(b.sketch);
  if (!profile) throw new Error('no profile');
  const ref: GeomRef = { kind: 'profile', id: `SB/${profile.id}` };
  return {
    lines,
    features: [
      sketch('SB', b.sketch),
      { ...testFeature('B', 'extrude'), inputs: extrudeInputs([ref], { distance: '10 mm' }) },
    ],
  };
}

const side = (line: string) => `extrude:B:side:${line}`;

function hole(id: string, options: HoleInputOptions): Feature {
  return {
    ...testFeature(id, HOLE_TYPE),
    inputs: holeInputs({
      plane: TOP,
      ...options,
      numbers: { x: '20 mm', y: '15 mm', ...options.numbers },
    }),
  };
}

function removeFaces(id: string, faces: GeomRef[]): Feature {
  return { ...testFeature(id, 'removeFaces'), inputs: removeFacesInputs(faces) };
}

async function run(doc: ExtrudoDocument): Promise<Done> {
  const result = await engine.recompute({ doc });
  if (result.status !== 'done') throw new Error('cancelled');
  return result;
}

const status = (result: Done, id: string): FeatureStatus =>
  result.features[id as FeatureId] ?? { status: 'ok' };

function ok(result: Done): Done {
  for (const [id, s] of Object.entries(result.features)) {
    if (s.status !== 'ok') throw new Error(`${id}: ${s.status} ${s.message ?? ''}`);
  }
  return result;
}

const faceNames = (result: Done) => result.bodies[0]?.mesh?.faceIds ?? [];

/** A reference to the face named `id` in the last recompute. */
function faceRef(result: Done, id: string): GeomRef {
  const index = faceNames(result).indexOf(id);
  const ref = index < 0 ? undefined : engine.reference(B0, 'face', index);
  if (!ref) throw new Error(`no face named ${id}`);
  return ref;
}

/** The names of the faces the pick rule takes for a click on the face named `id`. */
function pick(result: Done, id: string): string[] {
  const names = faceNames(result);
  const picked = engine.removeFacesPick(B0, [names.indexOf(id)]);
  if (!picked) throw new Error(`no pick for ${id}`);
  return picked.map((face) => names[face] ?? '?');
}

let bodyShapes: ShapeHandle[] = [];

/** A recompute that also captures the body shapes (through a spy on the kernel's mesh call). */
async function runWithShapes(doc: ExtrudoDocument): Promise<Done> {
  bodyShapes = [];
  const mesh = kernel.mesh.bind(kernel);
  kernel.mesh = (shape, options) => {
    bodyShapes.push(shape);
    return mesh(shape, options);
  };
  try {
    return await run(doc);
  } finally {
    kernel.mesh = mesh;
  }
}

function measure() {
  const shape = bodyShapes[0] as ShapeHandle;
  const solids = kernel.solids(shape);
  kernel.release(...solids);
  return {
    volume: kernel.measure(shape).volume,
    solids: solids.length,
    valid: kernel.isValid(shape),
  };
}

const relative = (a: number, b: number) => Math.abs(a - b) / Math.abs(b);
const holeFaces = (names: readonly string[]) => names.filter((n) => n.startsWith('hole:')).sort();

/** Removes `faces` (names) after `features` and checks the result is the plain block. */
async function removesToBlock(features: Feature[], faces: string[]): Promise<Done> {
  const before = ok(await run(testDocument(features)));
  const refs = faces.map((name) => faceRef(before, name));
  const after = ok(await runWithShapes(testDocument([...features, removeFaces('R', refs)])));
  const m = measure();
  expect(relative(m.volume, BOX)).toBeLessThan(1e-6);
  expect(m.solids).toBe(1);
  expect(m.valid).toBe(true);
  for (const name of faces) expect(faceNames(after)).not.toContain(name);
  return after;
}

describe('remove faces', { timeout: 120_000 }, () => {
  it('(a) closes a through hole: the full block, one valid solid, the hole gone', async () => {
    const features = [
      ...block().features,
      hole('H', { extent: 'through', numbers: { diameter: '6 mm' } }),
    ];
    const before = ok(await run(testDocument(features)));
    expect(holeFaces(faceNames(before))).toEqual(['hole:H:side:wall']);
    expect(pick(before, 'hole:H:side:wall')).toEqual(['hole:H:side:wall']);
    const after = await removesToBlock(features, ['hole:H:side:wall']);
    expect(holeFaces(faceNames(after))).toEqual([]);
    expect(faceNames(after)).toHaveLength(6);
  });

  it('(b) a blind hole needs its floor: the pick takes it, the wall alone is refused', async () => {
    const features = [
      ...block().features,
      hole('H', { numbers: { diameter: '6 mm', depth: '5 mm', tipAngle: '0 deg' } }),
    ];
    const before = ok(await run(testDocument(features)));
    expect(pick(before, 'hole:H:side:wall').sort()).toEqual([
      'hole:H:side:floor',
      'hole:H:side:wall',
    ]);
    const wallRef = faceRef(before, 'hole:H:side:wall');
    await removesToBlock(features, ['hole:H:side:floor', 'hole:H:side:wall']);

    const alone = await run(testDocument([...features, removeFaces('R', [wallRef])]));
    expect(status(alone, 'R')).toMatchObject({
      status: 'error',
      message:
        "Remove Faces can't close the gap this face leaves. Pick the rest of the round or hole too (1 more face), or fewer faces.",
    });
  });

  it('(c) the top face keeps its name, and a fillet on it survives an upstream edit', async () => {
    const base = block();
    const withHole = (diameter: string) => [
      ...base.features,
      hole('H', { extent: 'through', numbers: { diameter } }),
    ];
    const before = ok(await run(testDocument(withHole('6 mm'))));
    const wallRef = faceRef(before, 'hole:H:side:wall');
    const removed = ok(await run(testDocument([...withHole('6 mm'), removeFaces('R', [wallRef])])));
    expect(faceNames(removed)).toContain(cap);
    const edge: GeomRef = { kind: 'edge', id: edgeName([cap, side(base.lines.front)]) };
    const fillet: Feature = {
      ...testFeature('F', 'fillet'),
      inputs: filletInputs([{ edges: [edge], radius: '2 mm' }]),
    };
    for (const diameter of ['6 mm', '8 mm']) {
      ok(
        await runWithShapes(
          testDocument([...withHole(diameter), removeFaces('R', [wallRef]), fillet]),
        ),
      );
      const m = measure();
      // The block less a 2 mm round along the 40 mm front top edge.
      expect(relative(m.volume, BOX - 40 * (4 - Math.PI)), diameter).toBeLessThan(1e-6);
      expect(m.valid).toBe(true);
    }
  });

  it('(d) a fillet run is one pick; removing all four gives the sharp block back', async () => {
    const base = block();
    const { front, right, back, left } = base.lines;
    const vertical = [
      [front, right],
      [right, back],
      [back, left],
      [left, front],
    ].map(([a, b]) => ({ kind: 'edge', id: edgeName([side(a ?? ''), side(b ?? '')]) }) as GeomRef);
    const features = [
      ...base.features,
      {
        ...testFeature('F', 'fillet'),
        inputs: filletInputs([{ edges: vertical, radius: '3 mm' }]),
      },
    ];
    const before = ok(await run(testDocument(features)));
    const rounds = faceNames(before).filter((n) => n.startsWith('fillet:'));
    expect(rounds).toHaveLength(4);
    for (const round of rounds) expect(pick(before, round)).toEqual([round]);
    await removesToBlock(features, rounds);
  });

  it('(e) counterbore and countersink: the pick takes step or cone and floor, not the top', async () => {
    for (const options of [
      {
        type: 'counterbore',
        numbers: {
          diameter: '6 mm',
          depth: '8 mm',
          tipAngle: '0 deg',
          cbDiameter: '11 mm',
          cbDepth: '3 mm',
        },
      },
      {
        type: 'countersink',
        extent: 'through',
        numbers: { diameter: '6 mm', csDiameter: '12 mm', csAngle: '90 deg' },
      },
    ] as HoleInputOptions[]) {
      const features = [...block().features, hole('H', options)];
      const before = ok(await run(testDocument(features)));
      const all = holeFaces(faceNames(before));
      expect(all.length, options.type).toBeGreaterThan(1);
      const picked = pick(before, 'hole:H:side:wall');
      expect(picked.sort(), options.type).toEqual(all);
      expect(picked).not.toContain(cap);
      await removesToBlock(features, all);
    }
  });

  it('(f) every face of the body, and no face, are refused', async () => {
    const features = block().features;
    const before = ok(await run(testDocument(features)));
    const every = faceNames(before).map((name) => faceRef(before, name));
    const whole = await run(testDocument([...features, removeFaces('R', every)]));
    expect(status(whole, 'R')).toMatchObject({
      status: 'error',
      message: 'That would remove the whole body. Use Remove on the body instead.',
    });
    const none = await run(testDocument([...features, removeFaces('R', [])]));
    expect(status(none, 'R').status).toBe('error');
  });
});
