// Simplify for Print (ADR-0141, #79) through the recompute engine with real
// OCCT: small fillets, chamfers and small through and blind holes found and
// removed, large ones kept, a hole's rounded mouth taken with it, a round that can't be removed reported while the rest go,
// and the limits' toggles. The detection rule's split-wall ring is also
// tested on a hand-built description, without WASM.
import {
  type BodyId,
  chamferInputs,
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
  type SimplifyInputOptions,
  type SimplifyReport,
  type SketchData,
  simplifyForPrintInputs,
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
import { findSimplifyGroups, type SimplifySurface } from './simplify-for-print';

// ------------------------------------------------------------ plain data

describe('the Simplify for Print detection rule (plain data)', () => {
  const Z: Vec3 = [0, 0, 1];
  const half = (radius: number): SimplifySurface => ({
    type: 'cylinder',
    radius,
    axis: { origin: [0, 0, 0], direction: Z },
    inside: true,
    whole: false,
  });
  /** A plate (top 0, bottom 1) with a through hole whose wall is two halves (2, 3) on two seams. */
  function splitHole(): ShapeDescription {
    const face = (type: ShapeDescription['faces'][number]['type'], direction?: Vec3) => ({
      type,
      area: 1,
      centroid: [0, 0, 0] as Vec3,
      ...(direction && { direction }),
    });
    const edge = (at: Vec3, faces: number[]) => ({
      type: 'line' as const,
      length: 1,
      midpoint: at,
      faces,
    });
    return {
      faces: [face('plane', Z), face('plane', [0, 0, -1]), face('cylinder'), face('cylinder')],
      edges: [
        edge([20, 0, 10], [0]),
        edge([20, 0, 0], [1]),
        edge([1.5, 0, 10], [0, 2]),
        edge([-1.5, 0, 10], [0, 3]),
        edge([1.5, 0, 0], [1, 2]),
        edge([-1.5, 0, 0], [1, 3]),
        edge([0, 1.5, 5], [2, 3]),
        edge([0, -1.5, 5], [2, 3]),
      ],
      vertices: [],
    };
  }
  const surfaceOf = (face: number) => (face >= 2 ? half(1.5) : undefined);

  it('two coaxial halves closing a ring are a hole, not a round', () => {
    const groups = findSimplifyGroups(splitHole(), surfaceOf, {
      maxRoundRadius: 5,
      maxHoleDiameter: 3,
    });
    expect(groups).toEqual([{ kind: 'hole', faces: [2, 3], size: 3 }]);
  });

  it('a hole over the limit stays, and its halves are no round either', () => {
    const limits = { maxRoundRadius: 5, maxHoleDiameter: 2.9 };
    expect(findSimplifyGroups(splitHole(), surfaceOf, limits)).toEqual([]);
  });

  it('one half alone (an open arc) is a round', () => {
    const open = splitHole();
    open.edges = open.edges.slice(0, 7);
    const groups = findSimplifyGroups(open, surfaceOf, {
      maxRoundRadius: 2,
      maxHoleDiameter: undefined,
    });
    expect(groups).toEqual([{ kind: 'round', faces: [2, 3], size: 1.5 }]);
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
const S0 = 'S:0' as BodyId;
const BOX = 40 * 30 * 10;
const TOP: GeomRef = { kind: 'face', id: 'extrude:B:cap:end' };

function sketch(id: string, data: SketchData): Feature {
  return { ...testFeature(id, 'sketch'), inputs: sketchInputs(originPlaneRef('origin:xy'), data) };
}

function extruded(id: string, b: SketchBuilder, distance = '10 mm', join = false): Feature[] {
  const [profile] = detectProfiles(b.sketch);
  if (!profile) throw new Error('no profile');
  const ref: GeomRef = { kind: 'profile', id: `S${id}/${profile.id}` };
  return [
    sketch(`S${id}`, b.sketch),
    {
      ...testFeature(id, 'extrude'),
      inputs: extrudeInputs([ref], { distance, ...(join && { operation: 'join' as const }) }),
    },
  ];
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
  return { lines, features: extruded('B', b) };
}

/** A 2 mm wide, 10 mm tall stadium wall (body `S:0`) beside the block: its round ends have parallel neighbours. */
function stadium(): Feature[] {
  const b = new SketchBuilder();
  b.line(50, 0, 70, 0);
  b.arc(70, 1, 1, -90, 90);
  b.line(70, 2, 50, 2);
  b.arc(50, 1, 1, 90, 270);
  return extruded('S', b);
}

/** The same wall as a fin joined to the block, standing 5 mm out of its top. */
function fin(): Feature[] {
  const b = new SketchBuilder();
  b.line(10, 14, 25, 14);
  b.arc(25, 15, 1, -90, 90);
  b.line(25, 16, 10, 16);
  b.arc(10, 15, 1, 90, 270);
  return extruded('J', b, '15 mm', true);
}

const side = (line: string) => `extrude:B:side:${line}`;

function hole(id: string, options: HoleInputOptions): Feature {
  return { ...testFeature(id, HOLE_TYPE), inputs: holeInputs({ plane: TOP, ...options }) };
}

function simplify(bodies: string[], options: SimplifyInputOptions): Feature {
  return {
    ...testFeature('P', 'simplifyForPrint'),
    inputs: simplifyForPrintInputs(bodies, options),
  };
}

let bodyShapes = new Map<string, ShapeHandle>();

/** A recompute that also captures the body shapes (through a spy on the kernel's mesh call). */
async function run(doc: ExtrudoDocument): Promise<Done> {
  const shapes: ShapeHandle[] = [];
  const mesh = kernel.mesh.bind(kernel);
  kernel.mesh = (shape, options) => {
    shapes.push(shape);
    return mesh(shape, options);
  };
  try {
    const result = await engine.recompute({ doc });
    if (result.status !== 'done') throw new Error('cancelled');
    bodyShapes = new Map();
    // Meshes are made for the bodies the caller doesn't hold, in the result's order.
    const meshed = result.bodies.filter((b) => b.mesh);
    for (const [i, body] of meshed.entries()) {
      const shape = shapes[i];
      if (shape !== undefined) bodyShapes.set(body.id, shape);
    }
    return result;
  } finally {
    kernel.mesh = mesh;
  }
}

const status = (result: Done, id: string): FeatureStatus =>
  result.features[id as FeatureId] ?? { status: 'ok' };

const report = (result: Done) => result.reports['P' as FeatureId] as SimplifyReport | undefined;

function volume(body: BodyId): number {
  const shape = bodyShapes.get(body);
  if (shape === undefined) throw new Error(`no shape for ${body}`);
  expect(kernel.isValid(shape)).toBe(true);
  return kernel.measure(shape).volume;
}

const faceNames = (result: Done, body: BodyId) =>
  result.bodies.find((b) => b.id === body)?.mesh?.faceIds ?? [];

const relative = (a: number, b: number) => Math.abs(a - b) / Math.abs(b);

/** The front verticals rounded at r 1, the back ones at r 3. */
function filleted(): Feature[] {
  const base = block();
  const { front, right, back, left } = base.lines;
  const edge = (a: string, b: string): GeomRef => ({
    kind: 'edge',
    id: edgeName([side(a), side(b)]),
  });
  return [
    ...base.features,
    {
      ...testFeature('F', 'fillet'),
      inputs: filletInputs([
        { edges: [edge(left, front), edge(front, right)], radius: '1 mm' },
        { edges: [edge(right, back), edge(back, left)], radius: '3 mm' },
      ]),
    },
  ];
}

/** A round of radius r along a 10 mm edge takes r² (1 − π/4) × 10 of the block. */
const roundLoss = (r: number) => 2 * r * r * (1 - Math.PI / 4) * 10;

describe('simplify for print', { timeout: 120_000 }, () => {
  it('(a) removes the rounds under the radius and keeps the larger ones', async () => {
    const result = await run(
      testDocument([...filleted(), simplify(['B:0'], { maxRoundRadius: '2 mm' })]),
    );
    expect(status(result, 'P')).toMatchObject({ status: 'ok' });
    expect(report(result)?.groups).toEqual([
      { kind: 'round', body: 'B:0', size: expect.closeTo(1, 6), faces: 1, removed: true },
      { kind: 'round', body: 'B:0', size: expect.closeTo(1, 6), faces: 1, removed: true },
    ]);
    // Only the two r 3 rounds are left.
    expect(relative(volume(B0), BOX - roundLoss(3))).toBeLessThan(1e-6);
    expect(faceNames(result, B0).filter((n) => n.startsWith('fillet:'))).toHaveLength(2);
    // Every limit up: all four go, the block is sharp again.
    const all = await run(
      testDocument([...filleted(), simplify(['B:0'], { maxRoundRadius: '3 mm' })]),
    );
    expect(report(all)?.groups).toHaveLength(4);
    expect(relative(volume(B0), BOX)).toBeLessThan(1e-6);
    expect(faceNames(all, B0)).toHaveLength(6);
  });

  it('(b) removes small through and blind holes, keeps a large one and the top face', async () => {
    const features = [
      ...block().features,
      hole('H1', { extent: 'through', numbers: { diameter: '3 mm', x: '8 mm', y: '8 mm' } }),
      hole('H2', {
        numbers: { diameter: '4 mm', depth: '5 mm', tipAngle: '0 deg', x: '32 mm', y: '8 mm' },
      }),
      hole('H3', { extent: 'through', numbers: { diameter: '10 mm', x: '20 mm', y: '20 mm' } }),
    ];
    const result = await run(
      testDocument([...features, simplify(['B:0'], { maxHoleDiameter: '5 mm' })]),
    );
    expect(status(result, 'P')).toMatchObject({ status: 'ok' });
    const groups = report(result)?.groups ?? [];
    expect(groups.map((g) => [g.kind, Number(g.size.toFixed(6)), g.faces, g.removed])).toEqual([
      ['hole', 3, 1, true],
      ['hole', 4, 2, true],
    ]);
    expect(relative(volume(B0), BOX - Math.PI * 25 * 10)).toBeLessThan(1e-6);
    const names = faceNames(result, B0);
    expect(names).toContain('extrude:B:cap:end');
    expect(names.filter((n) => n.startsWith('hole:'))).toEqual(['hole:H3:side:wall']);
  });

  it('(c) a round that can not be removed is reported; the rest still go', async () => {
    const features = [...filleted(), ...stadium()];
    const result = await run(
      testDocument([...features, simplify(['B:0', 'S:0'], { maxRoundRadius: '2 mm' })]),
    );
    const own = status(result, 'P');
    expect(own.status).toBe('warning');
    expect(own.message).toContain("2 of the 4 found couldn't be removed");
    const groups = report(result)?.groups ?? [];
    expect(groups.map((g) => [g.body, g.removed])).toEqual([
      ['B:0', true],
      ['B:0', true],
      ['S:0', false],
      ['S:0', false],
    ]);
    expect(relative(volume(B0), BOX - roundLoss(3))).toBeLessThan(1e-6);
    // The wall is as it was: 20 × 2 and two half discs of r 1, 10 mm tall.
    expect(relative(volume(S0), (20 * 2 + Math.PI) * 10)).toBeLessThan(1e-6);
  });

  it("(c2) on one body: the fin's ends stay, the corner rounds go one by one", async () => {
    const result = await run(
      testDocument([...filleted(), ...fin(), simplify(['B:0'], { maxRoundRadius: '2 mm' })]),
    );
    const own = status(result, 'P');
    expect(own.status).toBe('warning');
    const groups = report(result)?.groups ?? [];
    expect(groups.filter((g) => g.removed)).toHaveLength(2);
    expect(groups.filter((g) => !g.removed)).toHaveLength(2);
    // The fin is 15 × 2 plus two half discs of r 1, 5 mm above the top.
    const finVolume = (15 * 2 + Math.PI) * 5;
    expect(relative(volume(B0), BOX - roundLoss(3) + finVolume)).toBeLessThan(1e-6);
  });

  it('(d) a limit that is off finds nothing of its kind; nothing found is a warning', async () => {
    const features = [
      ...filleted(),
      hole('H1', { extent: 'through', numbers: { diameter: '3 mm', x: '20 mm', y: '15 mm' } }),
    ];
    const holesOnly = await run(
      testDocument([...features, simplify(['B:0'], { maxHoleDiameter: '5 mm' })]),
    );
    expect(report(holesOnly)?.groups.map((g) => g.kind)).toEqual(['hole']);
    const none = await run(
      testDocument([...features, simplify(['B:0'], { maxRoundRadius: '0.5 mm' })]),
    );
    expect(status(none, 'P')).toMatchObject({
      status: 'warning',
      message: 'Nothing under the limits: the body is unchanged.',
    });
    const off = await run(testDocument([...features, simplify(['B:0'], {})]));
    expect(status(off, 'P')).toMatchObject({
      status: 'error',
      message: 'Turn on rounds, chamfers or holes to simplify.',
    });
  });

  const cap = 'extrude:B:cap:end';
  const bottom = 'extrude:B:cap:start';
  const topEdge = (line: string): GeomRef => ({ kind: 'edge', id: edgeName([cap, side(line)]) });
  const bottomEdge = (line: string): GeomRef => ({
    kind: 'edge',
    id: edgeName([bottom, side(line)]),
  });
  const chamfered = (sets: Parameters<typeof chamferInputs>[0]): Feature[] => [
    ...block().features,
    { ...testFeature('C', 'chamfer'), inputs: chamferInputs(sets) },
  ];

  it('(e) removes the chamfers up to their longer leg; the face between two is none', async () => {
    const { front, back } = block().lines;
    const features = chamfered([
      { edges: [topEdge(front)], distance: '1 mm' },
      { edges: [topEdge(back)], mode: 'two-distances', distance: '1 mm', distanceB: '2 mm' },
      { edges: [bottomEdge(front)], distance: '3 mm' },
    ]);
    const result = await run(
      testDocument([...features, simplify(['B:0'], { maxChamferSize: '2 mm' })]),
    );
    expect(status(result, 'P')).toMatchObject({ status: 'ok' });
    const groups = report(result)?.groups ?? [];
    expect(
      groups.map((g) => [g.kind, Number(g.size.toFixed(6)), g.faces, g.removed]).sort(),
    ).toEqual([
      ['chamfer', 1, 1, true],
      ['chamfer', 2, 1, true],
    ]);
    // A chamfer of legs a and b along the 40 mm edge takes a b / 2 × 40; the 3 mm one stays.
    expect(relative(volume(B0), BOX - 4.5 * 40)).toBeLessThan(1e-6);
    // The limit over all three: the front face between two chamfers is no chamfer itself.
    const all = await run(
      testDocument([...features, simplify(['B:0'], { maxChamferSize: '5 mm' })]),
    );
    expect(report(all)?.groups.map((g) => g.faces)).toEqual([1, 1, 1]);
    expect(relative(volume(B0), BOX)).toBeLessThan(1e-6);
  });

  it('(e2) every edge chamfered: one chamfer, corner patches and all', async () => {
    const { front, right, back, left } = block().lines;
    const loop = [front, right, back, left];
    const vertical = loop.map(
      (line, i): GeomRef => ({
        kind: 'edge',
        id: edgeName([side(line), side(loop[(i + 1) % 4] ?? '')]),
      }),
    );
    const features = chamfered([
      { edges: [...loop.map(topEdge), ...loop.map(bottomEdge), ...vertical], distance: '1 mm' },
    ]);
    const result = await run(
      testDocument([...features, simplify(['B:0'], { maxChamferSize: '1 mm' })]),
    );
    expect(status(result, 'P')).toMatchObject({ status: 'ok' });
    const groups = report(result)?.groups ?? [];
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ kind: 'chamfer', faces: 20, removed: true });
    expect(relative(volume(B0), BOX)).toBeLessThan(1e-6);
    expect(faceNames(result, B0)).toHaveLength(6);
  });

  it('(e3) unequal chamfers: the curved corner patch goes too, the large ones stay', async () => {
    const { front, right, back, left } = block().lines;
    const vertical = (a: string, b: string): GeomRef => ({
      kind: 'edge',
      id: edgeName([side(a), side(b)]),
    });
    // Where the 1 mm top chamfers meet the 0.5 mm verticals, OCCT's corner patch is a B-spline.
    const features = chamfered([
      { edges: [front, right, back, left].map(topEdge), distance: '1 mm' },
      { edges: [vertical(left, front), vertical(front, right)], distance: '0.5 mm' },
      { edges: [vertical(right, back), vertical(back, left)], distance: '3 mm' },
    ]);
    const result = await run(
      testDocument([...features, simplify(['B:0'], { maxChamferSize: '1 mm' })]),
    );
    expect(status(result, 'P')).toMatchObject({ status: 'ok' });
    expect(report(result)?.groups.every((g) => g.kind === 'chamfer' && g.removed)).toBe(true);
    // The block with its two 3 mm verticals (3 × 3 / 2 × 10 each) and nothing else.
    expect(relative(volume(B0), BOX - 90)).toBeLessThan(1e-6);
    expect(faceNames(result, B0)).toHaveLength(8);
  });

  it("(f) a countersink is a chamfer with holes off, and the hole's with them on", async () => {
    const features = [
      ...block().features,
      hole('H1', {
        extent: 'through',
        type: 'countersink',
        numbers: {
          diameter: '3 mm',
          csDiameter: '6 mm',
          csAngle: '90 deg',
          x: '20 mm',
          y: '15 mm',
        },
      }),
    ];
    const chamferOnly = await run(
      testDocument([...features, simplify(['B:0'], { maxChamferSize: '2 mm' })]),
    );
    expect(report(chamferOnly)?.groups).toEqual([
      { kind: 'chamfer', body: 'B:0', size: expect.closeTo(1.5, 6), faces: 1, removed: true },
    ]);
    // A plain Ø3 hole is left.
    expect(relative(volume(B0), BOX - Math.PI * 1.5 ** 2 * 10)).toBeLessThan(1e-6);
    const both = await run(
      testDocument([
        ...features,
        simplify(['B:0'], { maxChamferSize: '2 mm', maxHoleDiameter: '5 mm' }),
      ]),
    );
    expect(report(both)?.groups).toEqual([
      { kind: 'hole', body: 'B:0', size: expect.closeTo(3, 6), faces: 2, removed: true },
    ]);
    expect(relative(volume(B0), BOX)).toBeLessThan(1e-6);
  });

  it("(g) a hole's rounded mouth goes with the hole, whatever the round limit", async () => {
    const features = [
      ...block().features,
      hole('H1', { extent: 'through', numbers: { diameter: '3 mm', x: '20 mm', y: '15 mm' } }),
      {
        ...testFeature('F', 'fillet'),
        inputs: filletInputs([
          {
            edges: [{ kind: 'edge', id: edgeName([cap, 'hole:H1:side:wall']) }],
            radius: '1 mm',
          },
        ]),
      },
    ];
    const result = await run(
      testDocument([
        ...features,
        simplify(['B:0'], { maxRoundRadius: '0.5 mm', maxHoleDiameter: '5 mm' }),
      ]),
    );
    expect(status(result, 'P')).toMatchObject({ status: 'ok' });
    expect(report(result)?.groups).toEqual([
      { kind: 'hole', body: 'B:0', size: expect.closeTo(3, 6), faces: 2, removed: true },
    ]);
    expect(relative(volume(B0), BOX)).toBeLessThan(1e-6);
  });
});
