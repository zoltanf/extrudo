// The primitives (P2-10, ADR-0032, FR-FT-03) through the recompute engine
// with real OCCT: box, cylinder, sphere and torus on origin planes and on
// faces, their placement, the names they give (ADR-0005), the body
// operations and the errors. `golden/primitive-options.json` is the golden
// table of every type × placement × operation (a Vitest file snapshot);
// rewrite it with `pnpm vitest run -u packages/kernel/src/features/primitives`
// and review the diff.
import {
  type ExtrudoDocument,
  extrudeInputs,
  type Feature,
  type FeatureId,
  FeatureRegistry,
  type FeatureStatus,
  type GeomRef,
  originPlaneRef,
  type PrimitiveInputOptions,
  type PrimitiveOperation,
  type PrimitiveType,
  primitiveInputs,
  type SketchData,
  sketchInputs,
} from '@extrudo/core';
import { SketchBuilder } from '@extrudo/sketch/fixtures';
import { detectProfiles } from '@extrudo/sketch/profiles';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { SubShapeKind } from '../history';
import { Kernel, type ShapeHandle } from '../kernel';
import { loadOcct } from '../occt/load';
import { RecomputeEngine } from '../recompute/engine';
import { testDocument, testFeature, testFeatures } from '../recompute/testing';
import type { FeatureOutput, KernelFeatureDefinition, RecomputeResult } from '../recompute/types';
import type { PrimitiveOutputData } from './primitives';

let kernel: Kernel;
let engine: RecomputeEngine;
/** The output of each feature's latest evaluation (see `fresh`). */
const seen = new Map<string, FeatureOutput>();

beforeAll(async () => {
  kernel = new Kernel(await loadOcct());
});

beforeEach(() => {
  engine?.clear();
  expect(kernel.stats().liveShapes).toBe(0);
  const registry = new FeatureRegistry<KernelFeatureDefinition>();
  for (const definition of testFeatures().registry.list()) {
    registry.register({
      ...definition,
      evaluate(ctx) {
        const output = definition.evaluate(ctx);
        seen.set(ctx.feature.id, output);
        return output;
      },
    });
  }
  engine = new RecomputeEngine(kernel, registry, { strictLeaks: true });
});

afterAll(() => {
  engine.clear();
  expect(kernel.stats().liveShapes).toBe(0);
});

type Done = Extract<RecomputeResult, { status: 'done' }>;

// ------------------------------------------------------------------ helpers

function primitive(id: string, type: PrimitiveType, options: PrimitiveInputOptions = {}): Feature {
  return { ...testFeature(id, type), inputs: primitiveInputs(type, options) };
}

function rect(b: SketchBuilder, x: number, y: number, w: number, h: number): string[] {
  return [
    b.line(x, y, x + w, y).id,
    b.line(x + w, y, x + w, y + h).id,
    b.line(x + w, y + h, x, y + h).id,
    b.line(x, y + h, x, y).id,
  ];
}

function sketch(id: string, data: SketchData): Feature {
  return {
    ...testFeature(id, 'sketch'),
    inputs: sketchInputs(originPlaneRef('origin:xy'), data),
  };
}

/**
 * A 60 × 40 block, x 0…60, y 0…40, z 0…`height` (body `B:0`), from a
 * rectangle on XY: its top face is `extrude:B:cap:end`.
 */
function block(height = '10 mm'): Feature[] {
  const b = new SketchBuilder();
  rect(b, 0, 0, 60, 40);
  const [profile] = detectProfiles(b.sketch);
  if (!profile) throw new Error('no profile');
  const ref: GeomRef = { kind: 'profile', id: `SB/${profile.id}` };
  return [
    sketch('SB', b.sketch),
    { ...testFeature('B', 'extrude'), inputs: extrudeInputs([ref], { distance: height }) },
  ];
}

const TOP: GeomRef = { kind: 'face', id: 'extrude:B:cap:end' };

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

/** The body shapes of the last `runWithShapes`. */
let bodyShapes = new Map<string, ShapeHandle>();

/** A recompute that also captures the body shapes (through a spy on the kernel's mesh call). */
async function runWithShapes(doc: ExtrudoDocument): Promise<Done> {
  bodyShapes = new Map();
  const shapes: ShapeHandle[] = [];
  const mesh = kernel.mesh.bind(kernel);
  kernel.mesh = (shape, options) => {
    shapes.push(shape);
    return mesh(shape, options);
  };
  try {
    const result = await run(doc);
    result.bodies.forEach((b, i) => {
      const shape = shapes[i];
      if (shape !== undefined) bodyShapes.set(b.id, shape);
    });
    return result;
  } finally {
    kernel.mesh = mesh;
  }
}

function measure(result: Done, body: string) {
  const found = result.bodies.find((b) => b.id === body);
  const shape = bodyShapes.get(body) as ShapeHandle | undefined;
  if (!found || shape === undefined) throw new Error(`no body ${body}`);
  const m = kernel.measure(shape);
  const solids = kernel.solids(shape);
  kernel.release(...solids);
  return {
    volume: m.volume,
    area: m.area,
    bbox: m.bbox,
    faces: kernel.count(shape, 'face'),
    edges: kernel.count(shape, 'edge'),
    vertices: kernel.count(shape, 'vertex'),
    solids: solids.length,
    valid: kernel.isValid(shape),
    names: found.mesh?.faceIds ?? [],
  };
}

/** A recompute from an empty cache, so `seen` holds this document's outputs. */
async function fresh(doc: ExtrudoDocument): Promise<Done> {
  engine.clear();
  seen.clear();
  return run(doc);
}

async function outputData(doc: ExtrudoDocument, id = 'P'): Promise<PrimitiveOutputData> {
  ok(await fresh(doc));
  const data = seen.get(id)?.data as PrimitiveOutputData | undefined;
  if (!data) throw new Error('no data');
  return data;
}

/** A reference, with its fingerprint, to the sub-shape named `id` in the last recompute. */
function refTo(result: Done, kind: SubShapeKind, id: string): GeomRef {
  for (const body of result.bodies) {
    const list =
      kind === 'face'
        ? body.mesh?.faceIds
        : kind === 'edge'
          ? body.mesh?.edgeIds
          : body.mesh?.vertexIds;
    const index = list?.indexOf(id) ?? -1;
    if (index < 0) continue;
    const ref = engine.reference(body.id, kind, index);
    if (ref) return ref;
  }
  throw new Error(`no ${kind} named ${id}`);
}

const close = (a: number, b: number, tolerance = 1e-3) =>
  expect(Math.abs(a - b), `${a} ≈ ${b}`).toBeLessThanOrEqual(tolerance * Math.max(1, Math.abs(b)));

const round = (x: number, digits = 3) => {
  const r = Number(x.toFixed(digits));
  return Object.is(r, -0) ? 0 : r;
};

/** A bounding box as [min, max] rounded to 0.1 mm (OCCT pads boxes by the tolerance, more on curves). */
const box = (b: { min: readonly number[]; max: readonly number[] }) =>
  [...b.min, ...b.max].map((v) => round(v, 1));

/** The tight box of a body's shape, from the exact geometry (`Kernel.properties`). */
function tightBox(body: string) {
  const shape = bodyShapes.get(body);
  if (!shape) throw new Error(`no body ${body}`);
  return kernel.properties(shape).bbox;
}

/** Where a face's centroid is, by name, in the last `runWithShapes` (first body that has it). */
function faceCentroid(result: Done, name: string): number[] {
  for (const body of result.bodies) {
    const index = body.mesh?.faceIds?.indexOf(name) ?? -1;
    const shape = bodyShapes.get(body.id);
    if (index < 0 || shape === undefined) continue;
    const face = kernel.describe(shape).faces[index];
    if (face) return face.centroid.map((v) => round(v, 3));
  }
  throw new Error(`no face ${name}`);
}

const PI = Math.PI;

// ------------------------------------------------------------------ tests

describe('primitives', { timeout: 120_000 }, () => {
  it('a box with no inputs: a 20 mm cube on XY, centred on the origin, every face named', async () => {
    const result = ok(await runWithShapes(testDocument([primitive('P', 'box')])));
    expect(result.bodies.map((b) => b.id)).toEqual(['P:0']);
    const m = measure(result, 'P:0');
    close(m.volume, 8000);
    expect(m.valid).toBe(true);
    expect([m.faces, m.edges, m.vertices, m.solids]).toEqual([6, 12, 8, 1]);
    expect(box(m.bbox)).toEqual([-10, -10, 0, 10, 10, 20]);
    expect([...m.names].sort()).toEqual(
      [
        'box:P:cap:end',
        'box:P:cap:start',
        'box:P:side:back',
        'box:P:side:front',
        'box:P:side:left',
        'box:P:side:right',
      ].sort(),
    );
    // The sides face the frame's −Y, +X, +Y and −X; the start cap lies on the plane.
    expect(faceCentroid(result, 'box:P:side:front')).toEqual([0, -10, 10]);
    expect(faceCentroid(result, 'box:P:side:right')).toEqual([10, 0, 10]);
    expect(faceCentroid(result, 'box:P:side:back')).toEqual([0, 10, 10]);
    expect(faceCentroid(result, 'box:P:side:left')).toEqual([-10, 0, 10]);
    expect(faceCentroid(result, 'box:P:cap:start')).toEqual([0, 0, 0]);
    expect(faceCentroid(result, 'box:P:cap:end')).toEqual([0, 0, 20]);
    const data = await outputData(testDocument([primitive('P', 'box')]));
    expect(data.frame).toEqual({
      origin: [0, 0, 0],
      x: [1, 0, 0],
      y: [0, 1, 0],
      normal: [0, 0, 1],
    });
    expect(data.numbers).toEqual({
      length: 20,
      width: 20,
      height: 20,
      x: 0,
      y: 0,
      offset: 0,
      rotation: 0,
    });
  });

  it('places a box by x, y, offset and rotation in its plane’s frame, on every origin plane', async () => {
    const numbers = { length: '30 mm', width: '10 mm', height: '5 mm', x: '20 mm', y: '-5 mm' };
    const cases: [PrimitiveInputOptions, number[]][] = [
      [{ numbers }, [5, -10, 0, 35, 0, 5]],
      [{ numbers: { ...numbers, offset: '7 mm' } }, [5, -10, 7, 35, 0, 12]],
      // A negative height goes below the plane.
      [{ numbers: { ...numbers, height: '-5 mm' } }, [5, -10, -5, 35, 0, 0]],
      // Turned a quarter about +Z: the length runs along Y.
      [{ numbers: { ...numbers, rotation: '90 deg' } }, [15, -20, 0, 25, 10, 5]],
      // XZ: X along X, Y up Z, the normal towards −Y.
      [{ numbers, plane: originPlaneRef('origin:xz') }, [5, -5, -10, 35, 0, 0]],
      // YZ: X along Y, Y up Z, the normal towards +X.
      [{ numbers, plane: originPlaneRef('origin:yz') }, [0, 5, -10, 5, 35, 0]],
    ];
    for (const [options, expected] of cases) {
      const result = ok(await runWithShapes(testDocument([primitive('P', 'box', options)])));
      const m = measure(result, 'P:0');
      close(m.volume, 1500);
      expect(m.valid, JSON.stringify(options)).toBe(true);
      expect(box(m.bbox), JSON.stringify(options)).toEqual(expected);
    }
    // Turned 30°, the front still faces the turned frame's −Y.
    const turned = ok(
      await runWithShapes(
        testDocument([primitive('P', 'box', { numbers: { length: '20 mm', rotation: '30 deg' } })]),
      ),
    );
    const front = faceCentroid(turned, 'box:P:side:front');
    expect(front).toEqual([round(10 * Math.sin(PI / 6)), round(-10 * Math.cos(PI / 6)), 10]);
    const data = await outputData(
      testDocument([primitive('P', 'box', { numbers: { rotation: '90 deg', offset: '3 mm' } })]),
    );
    expect(data.frame.origin).toEqual([0, 0, 3]);
    expect(data.frame.x.map((v) => round(v))).toEqual([0, 1, 0]);
    expect(data.frame.y.map((v) => round(v))).toEqual([-1, 0, 0]);
  });

  it('a cylinder: a disc swept along the normal, caps and a wall', async () => {
    const doc = testDocument([
      primitive('P', 'cylinder', {
        numbers: { diameter: '10 mm', height: '30 mm', x: '5 mm' },
        plane: originPlaneRef('origin:yz'),
      }),
    ]);
    const result = ok(await runWithShapes(doc));
    const m = measure(result, 'P:0');
    close(m.volume, PI * 25 * 30);
    expect(m.valid).toBe(true);
    expect(m.faces).toBe(3);
    expect(box(m.bbox)).toEqual([0, 0, -5, 30, 10, 5]);
    expect([...m.names].sort()).toEqual(
      ['cylinder:P:cap:end', 'cylinder:P:cap:start', 'cylinder:P:side:wall'].sort(),
    );
    const edges = result.bodies[0]?.mesh?.edgeIds ?? [];
    expect(edges).toContain('e[cylinder:P:cap:end|cylinder:P:side:wall]');
    expect(edges).toContain('e[cylinder:P:side:wall]');
  });

  it('a sphere: a half disc turned about the normal, one face, poles on the normal', async () => {
    const doc = testDocument([
      primitive('P', 'sphere', { numbers: { diameter: '30 mm', x: '10 mm', offset: '15 mm' } }),
    ]);
    const result = ok(await runWithShapes(doc));
    const m = measure(result, 'P:0');
    close(m.volume, (4 / 3) * PI * 15 ** 3);
    close(m.area, 4 * PI * 15 ** 2);
    expect(m.valid).toBe(true);
    expect([m.faces, m.solids]).toEqual([1, 1]);
    expect(box(m.bbox)).toEqual([-5, -15, 0, 25, 15, 30]);
    expect(m.names).toEqual(['sphere:P:side:surface']);
  });

  it('a torus: a circle turned about the normal, one face', async () => {
    const doc = testDocument([
      primitive('P', 'torus', {
        numbers: { diameter: '40 mm', tube: '10 mm' },
        plane: originPlaneRef('origin:xz'),
      }),
    ]);
    const result = ok(await runWithShapes(doc));
    const m = measure(result, 'P:0');
    close(m.volume, 2 * PI ** 2 * 20 * 25);
    close(m.area, 4 * PI ** 2 * 20 * 5);
    expect(m.valid).toBe(true);
    expect([m.faces, m.solids]).toEqual([1, 1]);
    // About −Y (the XZ plane's normal): a ring in XZ, 10 mm thick along Y.
    expect(box(m.bbox)).toEqual([-25, -5, -25, 25, 5, 25]);
    expect(m.names).toEqual(['torus:P:side:surface']);
  });

  it('a torus with Axis X or Y stands on edge: the tube across the axis, the ring over the plane', async () => {
    for (const axis of ['x', 'y'] as const) {
      const doc = testDocument([
        primitive('P', 'torus', {
          numbers: { diameter: '40 mm', tube: '10 mm' },
          axis,
        }),
      ]);
      const result = ok(await runWithShapes(doc));
      const m = measure(result, 'P:0');
      close(m.volume, 2 * PI ** 2 * 20 * 25);
      expect(m.valid, axis).toBe(true);
      expect([m.faces, m.solids], axis).toEqual([1, 1]);
      expect(m.names, axis).toEqual(['torus:P:side:surface']);
      // The surface is an exact torus: the axis along the plane's X (Y),
      // the radii as entered, the centre on the plane's origin.
      const shape = bodyShapes.get('P:0');
      if (!shape) throw new Error('no shape');
      const g = kernel.surfaceGeometry(shape, 0);
      expect(g.type, axis).toBe('torus');
      expect(g.direction, `${axis} axis`).toEqual(axis === 'x' ? [1, 0, 0] : [0, 1, 0]);
      expect(g.radius, `${axis} R`).toBe(20);
      expect(g.minorRadius, `${axis} r`).toBe(5);
      expect(g.origin, `${axis} centre`).toEqual([0, 0, 0]);
      // Its box follows from the surface: the tube across the axis, the
      // ring's diameter + tube across the plane and up its normal (the
      // shape's own box is that within OCCT's 1e-7 shape tolerance).
      const t = tightBox('P:0');
      const span = (i: 0 | 1 | 2) => (t.max[i] as number) - (t.min[i] as number);
      const want: readonly [number, number, number] = axis === 'x' ? [10, 50, 50] : [50, 10, 50];
      expect(span(0), `${axis} x`).toBeCloseTo(want[0], 6);
      expect(span(1), `${axis} y`).toBeCloseTo(want[1], 6);
      expect(span(2), `${axis} z`).toBeCloseTo(want[2], 6);
      for (const i of [0, 1, 2] as const) {
        expect(((t.min[i] as number) + (t.max[i] as number)) / 2, `${axis} mid ${i}`).toBeCloseTo(
          0,
          6,
        );
      }
    }
  });

  it('a torus with Seat "On the plane" rests on the plane: its lowest point at offset', async () => {
    for (const axis of ['normal', 'x'] as const) {
      for (const offset of ['0 mm', '3 mm']) {
        const doc = testDocument([
          primitive('P', 'torus', {
            numbers: { diameter: '40 mm', tube: '10 mm', offset },
            seat: 'plane',
            ...(axis === 'x' ? { axis } : {}),
          }),
        ]);
        const result = ok(await runWithShapes(doc));
        const m = measure(result, 'P:0');
        close(m.volume, 2 * PI ** 2 * 20 * 25);
        expect(m.valid, `${axis} ${offset}`).toBe(true);
        // The surface's centre sits at the seat's lift above the plane
        // exactly (the tube's radius with the axis along the normal, the
        // ring's radius + the tube's with it in the plane), so the lowest
        // point is at `offset`.
        const shape = bodyShapes.get('P:0');
        if (!shape) throw new Error('no shape');
        const g = kernel.surfaceGeometry(shape, 0);
        const at = Number.parseFloat(offset);
        const lift = axis === 'normal' ? 5 : 25;
        expect(g.type, `${axis} ${offset} surface`).toBe('torus');
        expect(g.origin?.[2], `${axis} ${offset} centre z`).toBeCloseTo(at + lift, 9);
        const t = tightBox('P:0');
        expect(t.min[2] as number, `${axis} ${offset} min z`).toBeCloseTo(at, 6);
        expect(t.max[2] as number, `${axis} ${offset} max z`).toBeCloseTo(
          at + (axis === 'normal' ? 10 : 50),
          6,
        );
      }
    }
  });

  it('refuses sizes it can’t build, with a message for each', async () => {
    const cases: [PrimitiveType, PrimitiveInputOptions, string][] = [
      ['box', { numbers: { length: '0 mm' } }, 'The length must be greater than 0.'],
      ['box', { numbers: { width: '-3 mm' } }, 'The width must be greater than 0.'],
      ['box', { numbers: { height: '0 mm' } }, 'The height is 0. Enter a height other than 0.'],
      ['cylinder', { numbers: { diameter: '0 mm' } }, 'The diameter must be greater than 0.'],
      [
        'cylinder',
        { numbers: { height: '0 mm' } },
        'The height is 0. Enter a height other than 0.',
      ],
      ['sphere', { numbers: { diameter: '-1 mm' } }, 'The diameter must be greater than 0.'],
      ['torus', { numbers: { tube: '0 mm' } }, 'The tube diameter must be greater than 0.'],
      [
        'torus',
        { numbers: { diameter: '20 mm', tube: '20 mm' } },
        'The tube is as thick as the torus: make the tube diameter smaller than the diameter.',
      ],
      [
        'box',
        { plane: { kind: 'plane', id: 'plane:nowhere' } },
        "Can't find the plane the box sits on. Edit the box and pick another.",
      ],
      [
        'sphere',
        { plane: { kind: 'face', id: 'extrude:gone:cap:end' } },
        "Can't find the face the sphere sits on any more: an earlier change removed it. Edit the feature and pick it again.",
      ],
    ];
    for (const [type, options, message] of cases) {
      const result = await fresh(testDocument([primitive('P', type, options)]));
      const { refs, ...plain } = status(result, 'P');
      expect(plain, `${type} ${JSON.stringify(options)}`).toEqual({ status: 'error', message });
      // A lost plane or face is listed for "Fix References" (ADR-0033).
      const lost = (options as { plane?: { kind: string; id: string } }).plane;
      expect(refs).toEqual(
        lost ? [{ ref: { kind: lost.kind, id: lost.id }, state: 'lost' }] : undefined,
      );
      expect(result.bodies).toEqual([]);
    }
  });

  it('sits on a flat face in the face’s sketch frame, and follows the face', async () => {
    const first = ok(await runWithShapes(testDocument(block())));
    const top = refTo(first, 'face', TOP.id);
    const on = (height: string, options: PrimitiveInputOptions) =>
      testDocument([
        ...block(height),
        primitive('P', 'cylinder', { plane: top, operation: 'join', ...options }),
      ]);
    const numbers = { diameter: '10 mm', height: '5 mm', x: '30 mm', y: '20 mm' };
    const joined = ok(await runWithShapes(on('10 mm', { numbers })));
    // Joined into the block: one body, the block's.
    expect(joined.bodies.map((b) => b.id)).toEqual(['B:0']);
    const m = measure(joined, 'B:0');
    close(m.volume, 60 * 40 * 10 + PI * 25 * 5);
    expect(m.valid).toBe(true);
    expect(box(m.bbox)).toEqual([0, 0, 0, 60, 40, 15]);
    expect(m.names).toContain('cylinder:P:cap:end');
    expect(m.names).toContain('cylinder:P:side:wall');
    // The frame is the face's sketch frame (X along world X), lifted to the top.
    const data = await outputData(on('10 mm', { numbers }));
    expect(data.frame).toEqual({
      origin: [30, 20, 10],
      x: [1, 0, 0],
      y: [0, 1, 0],
      normal: [0, 0, 1],
    });
    // A taller block: the cylinder rides up with its top face.
    const taller = ok(await runWithShapes(on('25 mm', { numbers })));
    expect(box(measure(taller, 'B:0').bbox)).toEqual([0, 0, 0, 60, 40, 30]);
  });

  it('cuts into a face with a negative height, and names the hole’s faces', async () => {
    const first = ok(await runWithShapes(testDocument(block())));
    const top = refTo(first, 'face', TOP.id);
    const doc = testDocument([
      ...block(),
      primitive('P', 'box', {
        plane: top,
        numbers: { length: '10 mm', width: '10 mm', height: '-4 mm', x: '10 mm', y: '10 mm' },
        operation: 'cut',
      }),
    ]);
    const result = ok(await runWithShapes(doc));
    const m = measure(result, 'B:0');
    close(m.volume, 60 * 40 * 10 - 400);
    expect(m.valid).toBe(true);
    // The pocket's floor is the box's end cap, its walls the box's sides.
    for (const name of ['cap:end', 'side:front', 'side:right', 'side:back', 'side:left']) {
      expect(m.names).toContain(`box:P:${name}`);
    }
    expect(faceCentroid(result, 'box:P:cap:end')).toEqual([10, 10, 6]);
  });

  it('a sphere on a wall; intersect keeps the overlap; a new body off the face', async () => {
    const first = ok(await runWithShapes(testDocument(block())));
    // The block's front wall (y = 0): its frame's Y runs up the wall, the normal towards −Y.
    const wall = refTo(
      first,
      'face',
      (first.bodies[0]?.mesh?.faceIds ?? []).find(
        (name) => faceCentroid(first, name)[1] === 0 && name.includes('side'),
      ) as string,
    );
    const sphere = (operation: PrimitiveOperation) =>
      testDocument([
        ...block(),
        primitive('P', 'sphere', {
          plane: wall,
          numbers: { diameter: '8 mm', x: '30 mm', y: '5 mm' },
          operation,
        }),
      ]);
    const dome = ok(await runWithShapes(sphere('join')));
    const m = measure(dome, 'B:0');
    close(m.volume, 60 * 40 * 10 + ((4 / 3) * PI * 64) / 2, 1e-3);
    expect(box(m.bbox)).toEqual([0, -4, 0, 60, 40, 10]);
    const overlap = ok(await runWithShapes(sphere('intersect')));
    close(measure(overlap, 'B:0').volume, ((4 / 3) * PI * 64) / 2, 1e-3);
    const apart = ok(await runWithShapes(sphere('new-body')));
    expect(apart.bodies.map((b) => b.id)).toEqual(['B:0', 'P:0']);
    close(measure(apart, 'P:0').volume, (4 / 3) * PI * 64, 1e-3);
  });

  it('a join that touches nothing makes a new body and warns; a cut that misses fails', async () => {
    const join = await fresh(
      testDocument([
        ...block(),
        primitive('P', 'torus', { numbers: { offset: '100 mm' }, operation: 'join' }),
      ]),
    );
    expect(status(join, 'P')).toEqual({
      status: 'warning',
      message: 'Nothing to join to, so the torus made a new body.',
    });
    expect(join.bodies.map((b) => b.id)).toEqual(['B:0', 'P:0']);
    const cut = await fresh(
      testDocument([
        ...block(),
        primitive('P', 'box', { numbers: { offset: '100 mm' }, operation: 'cut' }),
      ]),
    );
    expect(status(cut, 'P')).toEqual({
      status: 'error',
      message: "The cut doesn't touch any body. Check its size and where it sits.",
    });
  });

  it('names don’t change with sizes or placement, and a later feature finds them', async () => {
    const names = async (options: PrimitiveInputOptions) => {
      const result = ok(await runWithShapes(testDocument([primitive('P', 'box', options)])));
      return {
        faces: [...(result.bodies[0]?.mesh?.faceIds ?? [])].sort(),
        edges: [...(result.bodies[0]?.mesh?.edgeIds ?? [])].sort(),
      };
    };
    const a = await names({});
    const b = await names({
      numbers: { length: '50 mm', height: '-3 mm', x: '7 mm', rotation: '45 deg' },
      plane: originPlaneRef('origin:xz'),
    });
    expect(b).toEqual(a);
    // A box on the first box's top: resolves by name after the first box grows.
    const doc = (height: string) =>
      testDocument([
        primitive('P', 'box', { numbers: { height } }),
        primitive('Q', 'cylinder', {
          plane: { kind: 'face', id: 'box:P:cap:end' },
          numbers: { diameter: '4 mm', height: '2 mm' },
        }),
      ]);
    const low = ok(await runWithShapes(doc('10 mm')));
    expect(box(measure(low, 'Q:0').bbox)).toEqual([-2, -2, 10, 2, 2, 12]);
    const high = ok(await runWithShapes(doc('30 mm')));
    expect(box(measure(high, 'Q:0').bbox)).toEqual([-2, -2, 30, 2, 2, 32]);
  });

  it('refuses a curved face to sit on', async () => {
    const doc = testDocument([
      primitive('C', 'cylinder'),
      primitive('P', 'box', { plane: { kind: 'face', id: 'cylinder:C:side:wall' } }),
    ]);
    const result = await fresh(doc);
    expect(status(result, 'P')).toEqual({
      status: 'error',
      message: "The face the box sits on isn't flat. Edit the box and pick a flat face or a plane.",
    });
  });

  it('golden table of every type, placement and operation', async () => {
    const first = ok(await runWithShapes(testDocument(block())));
    const top = refTo(first, 'face', TOP.id);
    const table: Record<string, unknown> = {};
    const types: [PrimitiveType, Record<string, string>][] = [
      ['box', { length: '16 mm', width: '12 mm', height: '8 mm', rotation: '30 deg' }],
      ['cylinder', { diameter: '12 mm', height: '-6 mm' }],
      ['sphere', { diameter: '14 mm' }],
      ['torus', { diameter: '20 mm', tube: '6 mm', offset: '2 mm' }],
    ];
    const placements: [string, PrimitiveInputOptions][] = [
      ['on XY at (20, 15)', { numbers: { x: '20 mm', y: '15 mm' } }],
      ['on the top face at (30, 20)', { plane: top, numbers: { x: '30 mm', y: '20 mm' } }],
    ];
    const operations: PrimitiveOperation[] = ['new-body', 'join', 'cut', 'intersect'];
    const row = (key: string, type: PrimitiveType, options: PrimitiveInputOptions) =>
      runWithShapes(testDocument([...block(), primitive('P', type, options)])).then((result) => {
        const st = status(result, 'P');
        if (st.status === 'error') {
          table[key] = { error: st.message };
          return;
        }
        table[key] = {
          ...(st.status === 'warning' ? { warning: st.message } : {}),
          bodies: Object.fromEntries(
            result.bodies.map((body) => {
              const m = measure(result, body.id);
              return [
                body.id,
                {
                  volume: round(m.volume, 1),
                  area: round(m.area, 1),
                  bbox: box(m.bbox),
                  counts: [m.faces, m.edges, m.vertices, m.solids],
                  valid: m.valid,
                  names: m.names.filter((n) => n.startsWith(`${type}:`)).sort(),
                },
              ];
            }),
          ),
        };
      });
    for (const [type, sizes] of types) {
      for (const [where, place] of placements) {
        for (const operation of operations) {
          const options = {
            ...place,
            numbers: { ...sizes, ...place.numbers },
            operation,
          };
          await row(`${type} ${where} ${operation}`, type, options);
        }
      }
    }
    // The torus's axis and seat (P4-12's amendment), on XY in the same sizes:
    // each option alone, then together.
    const torusSizes = { diameter: '20 mm', tube: '6 mm', offset: '2 mm' };
    const torusRows: [string, PrimitiveInputOptions][] = [
      ['axis x', { numbers: torusSizes, axis: 'x' }],
      ['axis y', { numbers: torusSizes, axis: 'y' }],
      ['seat plane', { numbers: torusSizes, seat: 'plane' }],
      ['axis x seat plane', { numbers: torusSizes, axis: 'x', seat: 'plane' }],
    ];
    for (const [where, options] of torusRows) {
      await row(`torus ${where} new-body`, 'torus', options);
    }
    await expect(`${JSON.stringify(table, null, 1)}\n`).toMatchFileSnapshot(
      './golden/primitive-options.json',
    );
  });
});
