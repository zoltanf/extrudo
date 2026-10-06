// Extrude and revolve "to object" on curved faces and bodies, with an offset
// (P4-12, ADR-0028's and ADR-0029's amendments), through the recompute engine
// with real OCCT and strict leaks: the extrusion ends on a cylinder's wall,
// a sphere, a fillet's round and a body, `offset` moves the end along the
// sweep, a target that the sweep misses is an error, and the revolve turns
// until it first meets a plane, a face or a body.
import {
  type BodyId,
  type ExtrudeInputOptions,
  type ExtrudoDocument,
  extrudeInputs,
  type Feature,
  type FeatureId,
  FeatureRegistry,
  type FeatureStatus,
  filletInputs,
  type GeomRef,
  originAxisRef,
  originPlaneRef,
  type PrimitiveType,
  primitiveInputs,
  type RevolveInputOptions,
  revolveInputs,
  type SketchData,
  sketchInputs,
  z,
} from '@extrudo/core';
import { SketchBuilder } from '@extrudo/sketch/fixtures';
import { detectProfiles } from '@extrudo/sketch/profiles';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Kernel, type ShapeHandle } from '../kernel';
import { loadManifold } from '../manifold';
import { loadOcct } from '../occt/load';
import { RecomputeEngine } from '../recompute/engine';
import { testDocument, testFeature } from '../recompute/testing';
import type { KernelFeatureDefinition, RecomputeResult } from '../recompute/types';
import { kernelFeatures } from '.';

let kernel: Kernel;
let engine: RecomputeEngine;

/** A 40 mm mesh cube from z = 30 (the only way to a mesh body without a file). */
const meshBox: KernelFeatureDefinition = {
  type: 'meshBox',
  label: 'meshBox',
  category: 'create',
  icon: 'box',
  inputsSchema: z.strictObject({}),
  bodyAccess: () => 'write',
  evaluate(ctx) {
    // biome-ignore format: corners
    const positions = new Float64Array([
      -20, -20, 30, 20, -20, 30, 20, 20, 30, -20, 20, 30,
      -20, -20, 70, 20, -20, 70, 20, 20, 70, -20, 20, 70,
    ]);
    // biome-ignore format: two triangles per side
    const indices = new Uint32Array([
      0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 2, 3, 7, 2, 7, 6, 1, 2, 6, 1, 6, 5,
      3, 0, 4, 3, 4, 7,
    ]);
    const bodies = new Map(ctx.bodies);
    bodies.set(ctx.bodyId(0), ctx.kernel.meshFrom({ positions, indices }));
    return { bodies };
  },
};

beforeAll(async () => {
  kernel = new Kernel(await loadOcct());
  kernel.enableMeshes(await loadManifold());
});

beforeEach(() => {
  engine?.clear();
  expect(kernel.stats().liveShapes).toBe(0);
  const registry = new FeatureRegistry<KernelFeatureDefinition>();
  for (const definition of kernelFeatures().list()) registry.register(definition);
  registry.register(meshBox);
  engine = new RecomputeEngine(kernel, registry, { strictLeaks: true });
});

afterAll(() => {
  engine.clear();
  expect(kernel.stats().liveShapes).toBe(0);
});

type Done = Extract<RecomputeResult, { status: 'done' }>;
type Plane = 'origin:xy' | 'origin:xz' | 'origin:yz';

// ------------------------------------------------------------------ helpers

/** A w × h rectangle from (x, y) in sketch mm, on `plane`. */
function rectangle(id: string, x: number, y: number, w: number, h: number, plane: Plane) {
  const b = new SketchBuilder();
  b.line(x, y, x + w, y);
  b.line(x + w, y, x + w, y + h);
  b.line(x + w, y + h, x, y + h);
  b.line(x, y + h, x, y);
  return { data: b.sketch, feature: sketch(id, b.sketch, plane) };
}

function sketch(id: string, data: SketchData, plane: Plane): Feature {
  return { ...testFeature(id, 'sketch'), inputs: sketchInputs(originPlaneRef(plane), data) };
}

function profileOf(id: string, data: SketchData): GeomRef {
  const found = detectProfiles(data)[0];
  if (!found) throw new Error('no profile');
  return { kind: 'profile', id: `${id}/${found.id}` };
}

function primitive(id: string, type: PrimitiveType, numbers: Record<string, string>): Feature {
  return { ...testFeature(id, type), inputs: primitiveInputs(type, { numbers }) };
}

function extrude(profiles: GeomRef[], options: ExtrudeInputOptions): Feature {
  return { ...testFeature('E', 'extrude'), inputs: extrudeInputs(profiles, options) };
}

function revolve(profiles: GeomRef[], options: RevolveInputOptions): Feature {
  return {
    ...testFeature('V', 'revolve'),
    inputs: revolveInputs(profiles, originAxisRef('origin:z'), options),
  };
}

const body = (id: string): GeomRef => ({ kind: 'body', id });

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

/** The body shapes of the last `runWithShapes`, by body ID. */
let shapes = new Map<string, ShapeHandle>();

/** A recompute that also captures the body shapes (through a spy on the kernel's mesh call). */
async function runWithShapes(doc: ExtrudoDocument): Promise<Done> {
  shapes = new Map();
  const meshed: ShapeHandle[] = [];
  const mesh = kernel.mesh.bind(kernel);
  kernel.mesh = (shape, options) => {
    meshed.push(shape);
    return mesh(shape, options);
  };
  try {
    const result = await run(doc);
    result.bodies.forEach((b, i) => {
      const shape = meshed[i];
      if (shape !== undefined) shapes.set(b.id, shape);
    });
    return result;
  } finally {
    kernel.mesh = mesh;
  }
}

/** The exact volume of a body of the last `runWithShapes`. */
function volume(id: string): number {
  const shape = shapes.get(id);
  if (shape === undefined) throw new Error(`no body ${id}`);
  return kernel.properties(shape).volume;
}

const names = (result: Done, id: string) =>
  result.bodies.find((b) => b.id === id)?.mesh?.faceIds ?? [];

/** Relative closeness, 1e-3 by default (the task's bar; the trims are exact to ~1e-12). */
const close = (a: number, b: number, tolerance = 1e-3) =>
  expect(Math.abs(a - b), `${a} ≈ ${b}`).toBeLessThanOrEqual(tolerance * Math.max(1, Math.abs(b)));

/** ∫ from −a to a of √(R² − t²) dt. */
const chord = (a: number, r: number) => a * Math.sqrt(r * r - a * a) + r * r * Math.asin(a / r);

// ------------------------------------------------------------------ scenes

/**
 * A 10 × 10 profile on XZ (x −5…5, z 0…10; the plane's normal is −Y) and a
 * Ø40 cylinder 20 mm high standing at (0, −30): the extrusion runs along −Y
 * and ends on the cylinder's wall, y = −30 + √(400 − x²).
 */
function besideCylinder() {
  const p = rectangle('S', -5, 0, 10, 10, 'origin:xz');
  return {
    profile: profileOf('S', p.data),
    features: [
      primitive('C', 'cylinder', { diameter: '40 mm', height: '20 mm', y: '-30 mm' }),
      p.feature,
    ],
    // 10 mm high × ∫(30 − √(400 − x²)) dx over −5…5.
    volume: 10 * (10 * 30 - chord(5, 20)),
  };
}

/** A 10 × 10 profile on XY at the origin and a 40 × 40 × 20 box from z = 30. */
function underBox(offset = '30 mm') {
  const p = rectangle('S', -5, -5, 10, 10, 'origin:xy');
  return {
    profile: profileOf('S', p.data),
    features: [
      primitive('B', 'box', { length: '40 mm', width: '40 mm', height: '20 mm', offset }),
      p.feature,
    ],
  };
}

/** The face of a body of the last recompute whose name is `name`, as a reference. */
function faceRef(result: Done, name: string): GeomRef {
  for (const b of result.bodies) {
    const index = b.mesh?.faceIds?.indexOf(name) ?? -1;
    if (index < 0) continue;
    const ref = engine.reference(b.id, 'face', index);
    if (ref) return ref;
  }
  throw new Error(`no face named ${name}`);
}

/** The edge of a body of the last `runWithShapes` whose middle is at `at`, as a reference. */
function edgeAt(result: Done, id: string, at: [number, number, number]): GeomRef {
  const shape = shapes.get(id) as ShapeHandle;
  const index = kernel
    .describe(shape)
    .edges.findIndex((e) => Math.hypot(...e.midpoint.map((v, i) => v - (at[i] as number))) < 1e-6);
  const ref = index >= 0 ? engine.reference(id as BodyId, 'edge', index) : undefined;
  if (!ref) throw new Error(`no edge at ${at} in ${result.bodies.map((b) => b.id)}`);
  return ref;
}

describe('extrude to object (P4-12)', { timeout: 120_000 }, () => {
  it("ends on a cylinder's curved wall, picked as a face or as the body", async () => {
    const scene = besideCylinder();
    const first = ok(await run(testDocument(scene.features)));
    const wall = faceRef(first, 'cylinder:C:side:wall');
    for (const toObject of [wall, body('C:0')]) {
      const result = ok(
        await runWithShapes(
          testDocument([
            ...scene.features,
            extrude([scene.profile], { extent: 'to-object', toObject }),
          ]),
        ),
      );
      close(volume('E:0'), scene.volume);
      expect(names(result, 'E:0')).toContain('extrude:E:cap:end');
      expect(names(result, 'E:0')).not.toContain('extrude:E:cap:far');
    }
  });

  it('moves the end along the sweep by the offset, on a curved wall too', async () => {
    const scene = besideCylinder();
    const first = ok(await run(testDocument(scene.features)));
    const wall = faceRef(first, 'cylinder:C:side:wall');
    for (const [offset, extra] of [
      ['2 mm', 200],
      ['-2 mm', -200],
    ] as const) {
      ok(
        await runWithShapes(
          testDocument([
            ...scene.features,
            extrude([scene.profile], { extent: 'to-object', toObject: wall, offset }),
          ]),
        ),
      );
      close(volume('E:0'), scene.volume + extra);
    }
  });

  it('ends on a sphere', async () => {
    const p = rectangle('S', -5, 0, 10, 10, 'origin:xz');
    // A Ø40 sphere at (0, −40, 5): the profile's middle faces its centre.
    const features = [
      primitive('P', 'sphere', { diameter: '40 mm', y: '-40 mm', offset: '5 mm' }),
      p.feature,
    ];
    let exact = 0;
    const n = 400;
    const h = 10 / n;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const x = -5 + (i + 0.5) * h;
        const zz = (j + 0.5) * h - 5;
        exact += (40 - Math.sqrt(400 - x * x - zz * zz)) * h * h;
      }
    }
    const first = ok(await run(testDocument(features)));
    for (const toObject of [faceRef(first, 'sphere:P:side:surface'), body('P:0')]) {
      ok(
        await runWithShapes(
          testDocument([
            ...features,
            extrude([profileOf('S', p.data)], { extent: 'to-object', toObject }),
          ]),
        ),
      );
      close(volume('E:0'), exact, 1e-5);
    }
  });

  it("ends on a fillet's round", async () => {
    // A 40 mm cube from z = −60 to −20, its edge at x = 20, z = −20 rounded by
    // 10 mm; a 6 × 10 profile on XY above the round (x 12…18), swept down.
    const cube = primitive('B', 'box', {
      length: '40 mm',
      width: '40 mm',
      height: '40 mm',
      offset: '-60 mm',
    });
    const cubeRun = ok(await runWithShapes(testDocument([cube])));
    const edge = edgeAt(cubeRun, 'B:0', [20, 0, -20]);
    const fillet: Feature = {
      ...testFeature('F', 'fillet'),
      inputs: filletInputs([{ edges: [edge], radius: '10 mm' }]),
    };
    const p = rectangle('S', 12, -5, 6, 10, 'origin:xy');
    const base = [cube, fillet, p.feature];
    const rounded = ok(await run(testDocument(base)));
    const round = rounded.bodies[0]?.mesh?.faceIds?.find((n) => n.startsWith('fillet:F:'));
    if (!round) throw new Error('no round');
    const arc = (t: number) => (t / 2) * Math.sqrt(100 - t * t) + 50 * Math.asin(t / 10);
    const exact = 10 * (6 * 30 - (arc(8) - arc(2)));
    for (const toObject of [faceRef(rounded, round), body('B:0')]) {
      ok(
        await runWithShapes(
          testDocument([
            ...base,
            // Behind the profile: one side turns round to reach it, as for planes.
            extrude([profileOf('S', p.data)], { extent: 'to-object', toObject }),
          ]),
        ),
      );
      close(volume('E:0'), exact);
    }
  });

  it('a body with an offset of +2 and −2 mm differs by exactly the area × 2', async () => {
    const scene = underBox();
    const volumes: number[] = [];
    for (const offset of ['0 mm', '2 mm', '-2 mm']) {
      ok(
        await runWithShapes(
          testDocument([
            ...scene.features,
            extrude([scene.profile], { extent: 'to-object', toObject: body('B:0'), offset }),
          ]),
        ),
      );
      volumes.push(volume('E:0'));
    }
    close(volumes[0] as number, 3000, 1e-9);
    close((volumes[1] as number) - (volumes[0] as number), 200, 1e-9);
    close((volumes[0] as number) - (volumes[2] as number), 200, 1e-9);
  });

  it('a target the sweep misses, or only partly meets, is a named error', async () => {
    const p = rectangle('S', -5, -5, 10, 10, 'origin:xy');
    const aside = primitive('B', 'box', {
      length: '20 mm',
      width: '20 mm',
      height: '20 mm',
      x: '100 mm',
      offset: '30 mm',
    });
    const missed = await run(
      testDocument([
        aside,
        p.feature,
        extrude([profileOf('S', p.data)], { extent: 'to-object', toObject: body('B:0') }),
      ]),
    );
    expect(status(missed, 'E')).toMatchObject({
      status: 'error',
      message: expect.stringMatching(/^E doesn't reach that body along its direction/),
    });
    const half = primitive('B', 'box', {
      length: '20 mm',
      width: '20 mm',
      height: '20 mm',
      x: '10 mm',
      offset: '30 mm',
    });
    const partly = await run(
      testDocument([
        half,
        p.feature,
        extrude([profileOf('S', p.data)], { extent: 'to-object', toObject: body('B:0') }),
      ]),
    );
    expect(status(partly, 'E').message).toMatch(/^Part of the profile passes beside that body/);
    // An offset that takes the end back past the profile.
    const scene = underBox();
    const short = await run(
      testDocument([
        ...scene.features,
        extrude([scene.profile], { extent: 'to-object', toObject: body('B:0'), offset: '-40 mm' }),
      ]),
    );
    expect(status(short, 'E').status).toBe('error');
  });

  it('a target behind the profile: one side turns round, side 2 of two sides reaches it', async () => {
    const scene = underBox('-50 mm');
    ok(
      await runWithShapes(
        testDocument([
          ...scene.features,
          extrude([scene.profile], { extent: 'to-object', toObject: body('B:0') }),
        ]),
      ),
    );
    close(volume('E:0'), 3000, 1e-9);
    const result = ok(
      await runWithShapes(
        testDocument([
          ...scene.features,
          extrude([scene.profile], {
            direction: 'two-sides',
            distance: '5 mm',
            extent2: 'to-object',
            toObject2: body('B:0'),
            offset2: '1 mm',
          }),
        ]),
      ),
    );
    close(volume('E:0'), 100 * (5 + 31), 1e-9);
    // Side 2's end is named as side 2's far cap always is.
    expect(names(result, 'E:0')).toContain('extrude:E:cap:start');
    expect(names(result, 'E:0')).toContain('extrude:E:cap:end');
  });

  it('joins, cuts and intersects with the trimmed sweep', async () => {
    const scene = underBox();
    // A 40 × 40 slab from z = 10 to 20, across the sweep's way.
    const slab = primitive('L', 'box', {
      length: '40 mm',
      width: '40 mm',
      height: '10 mm',
      offset: '10 mm',
    });
    const features = [...scene.features, slab];
    const run3 = async (operation: 'join' | 'cut' | 'intersect', bodies: string[]) =>
      ok(
        await runWithShapes(
          testDocument([
            ...features,
            extrude([scene.profile], {
              extent: 'to-object',
              toObject: body('B:0'),
              operation,
              bodies,
            }),
          ]),
        ),
      );
    let result = await run3('join', ['B:0']);
    close(volume('B:0'), 32000 + 3000, 1e-9);
    result = await run3('cut', ['L:0']);
    close(volume('L:0'), 16000 - 1000, 1e-9);
    result = await run3('intersect', ['L:0']);
    close(volume('L:0'), 1000, 1e-9);
    expect(result.bodies.map((b) => b.id).sort()).toEqual(['B:0', 'L:0']);
  });

  it("names the end cap:end, and a fillet on the end's edge resolves", async () => {
    const scene = besideCylinder();
    const first = ok(await run(testDocument(scene.features)));
    const wall = faceRef(first, 'cylinder:C:side:wall');
    const doc = [
      ...scene.features,
      extrude([scene.profile], { extent: 'to-object', toObject: wall }),
    ];
    const result = ok(await runWithShapes(testDocument(doc)));
    const faceIds = names(result, 'E:0');
    expect(faceIds.filter((n) => n.startsWith('extrude:E:cap:end'))).toEqual(['extrude:E:cap:end']);
    // The edge between the curved end and the wall from the profile's top line (z = 10).
    const edges = result.bodies.find((b) => b.id === 'E:0')?.mesh?.edgeIds ?? [];
    const endEdge = edges.find((n) => n.includes('extrude:E:cap:end') && n.includes('side'));
    if (!endEdge) throw new Error(`no end edge in ${edges}`);
    const index = edges.indexOf(endEdge);
    const ref = engine.reference('E:0' as BodyId, 'edge', index);
    if (!ref) throw new Error('no reference');
    const fillet: Feature = {
      ...testFeature('F', 'fillet'),
      inputs: filletInputs([{ edges: [ref], radius: '1 mm' }]),
    };
    const filleted = await runWithShapes(testDocument([...doc, fillet]));
    expect(status(filleted, 'F')).toEqual({ status: 'ok' });
    expect(volume('E:0')).toBeLessThan(scene.volume);
  });

  it('refuses a mesh body as the target', async () => {
    const p = rectangle('S', -5, -5, 10, 10, 'origin:xy');
    const result = await run(
      testDocument([
        testFeature('M', 'meshBox'),
        p.feature,
        extrude([profileOf('S', p.data)], { extent: 'to-object', toObject: body('M:0') }),
      ]),
    );
    expect(status(result, 'E')).toMatchObject({
      status: 'error',
      message:
        'Extrude to object needs a solid body: this body is a mesh (imported, or combined with a mesh).',
    });
  });
});

describe('revolve to object (P4-12)', { timeout: 120_000 }, () => {
  // A 10 × 10 profile on XZ from x = 10 to 20 (z 0…10), turned about Z: side
  // 1 turns from +X towards +Y. Up to the YZ plane it is a quarter ring.
  const quarter = (Math.PI / 2) * ((20 * 20 - 10 * 10) / 2) * 10;
  const p = rectangle('S', 10, 0, 10, 10, 'origin:xz');
  // A box over x −40…0 (it fills the turn from 90° to 270°).
  const block = primitive('B', 'box', {
    length: '40 mm',
    width: '80 mm',
    height: '40 mm',
    x: '-20 mm',
    offset: '-10 mm',
  });

  it('turns until the YZ plane, a flat face or a body', async () => {
    const first = ok(await run(testDocument([block, p.feature])));
    // The box's +X side, at x = 0.
    const targets: GeomRef[] = [
      originPlaneRef('origin:yz'),
      body('B:0'),
      faceRef(first, 'box:B:side:right'),
    ];
    for (const toObject of targets) {
      const result = ok(
        await runWithShapes(
          testDocument([
            block,
            p.feature,
            revolve([profileOf('S', p.data)], { extent: 'to-object', toObject }),
          ]),
        ),
      );
      close(volume('V:0'), quarter, 1e-9);
      expect(names(result, 'V:0')).toContain('revolve:V:cap:end');
      expect(names(result, 'V:0')).toContain('revolve:V:cap:start');
    }
    // Flipped, it turns the other way and meets the body at 270°.
    ok(
      await runWithShapes(
        testDocument([
          block,
          p.feature,
          revolve([profileOf('S', p.data)], {
            extent: 'to-object',
            toObject: body('B:0'),
            flip: true,
          }),
        ]),
      ),
    );
    close(volume('V:0'), quarter, 1e-9);
  });

  it('refuses two sides, and a revolve that never meets its target', async () => {
    const two = await run(
      testDocument([
        block,
        p.feature,
        revolve([profileOf('S', p.data)], {
          extent: 'to-object',
          toObject: body('B:0'),
          direction: 'two-sides',
        }),
      ]),
    );
    expect(status(two, 'V').message).toMatch(/turns one side/);
    const far = primitive('B', 'box', {
      length: '10 mm',
      width: '10 mm',
      height: '10 mm',
      offset: '100 mm',
    });
    const missed = await run(
      testDocument([
        far,
        p.feature,
        revolve([profileOf('S', p.data)], { extent: 'to-object', toObject: body('B:0') }),
      ]),
    );
    expect(status(missed, 'V').message).toMatch(/^V doesn't reach that body/);
  });
});
