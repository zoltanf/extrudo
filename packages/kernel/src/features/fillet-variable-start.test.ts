// The variable-radius fillet (P4-10, ADR-0064 §2) through the recompute engine
// with real OCCT: an end radius per edge set, `swap`, the two radii of a chain,
// the messages of a taper that is too large, and the two builds the evaluator
// picks between (a constant document still takes the constant `fillet`, so it
// computes exactly as before).
import {
  type ExtrudoDocument,
  extrudeInputs,
  type Feature,
  FeatureRegistry,
  filletInputs,
  type GeomRef,
  originPlaneRef,
  type SketchData,
  sketchInputs,
  type Vec3,
} from '@extrudo/core';
import { SketchBuilder } from '@extrudo/sketch/fixtures';
import { detectProfiles } from '@extrudo/sketch/profiles';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { SubShapeKind } from '../history';
import { Kernel, type ShapeHandle } from '../kernel';
import { edgeName } from '../naming';
import { loadOcct } from '../occt/load';
import { RecomputeEngine } from '../recompute/engine';
import { testDocument, testFeature, testFeatures } from '../recompute/testing';
import type { KernelFeatureDefinition, RecomputeResult } from '../recompute/types';

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

// ------------------------------------------------------------------ helpers

function rect(b: SketchBuilder, x: number, y: number, w: number, h: number) {
  return {
    bottom: b.line(x, y, x + w, y).id,
    right: b.line(x + w, y, x + w, y + h).id,
    top: b.line(x + w, y + h, x, y + h).id,
    left: b.line(x, y + h, x, y).id,
  };
}

function sketch(id: string, data: SketchData): Feature {
  return { ...testFeature(id, 'sketch'), inputs: sketchInputs(originPlaneRef('origin:xy'), data) };
}

function extrude(id: string, sketchId: string, data: SketchData, distance: string): Feature {
  const found = detectProfiles(data)[0];
  if (!found) throw new Error('no profile');
  const ref: GeomRef = { kind: 'profile', id: `${sketchId}/${found.id}` };
  return { ...testFeature(id, 'extrude'), inputs: extrudeInputs([ref], { distance }) };
}

interface SetSpec {
  edges: GeomRef[];
  radius: string;
  radiusEnd?: string;
  swap?: boolean;
}

function fillet(id: string, sets: SetSpec[]): Feature {
  return { ...testFeature(id, 'fillet'), inputs: filletInputs(sets) };
}

async function run(doc: ExtrudoDocument): Promise<Done> {
  const result = await engine.recompute({ doc });
  if (result.status !== 'done') throw new Error('cancelled');
  return result;
}

function ok(result: Done): Done {
  for (const [id, s] of Object.entries(result.features)) {
    if (s.status !== 'ok') throw new Error(`${id}: ${s.status} ${s.message ?? ''}`);
  }
  return result;
}

/** A reference, with its fingerprint, to the sub-shape named `id` in the last recompute. */
function refTo(result: Done, kind: SubShapeKind, id: string): GeomRef {
  const body = result.bodies.find((b) => meshIds(b.mesh, kind)?.includes(id));
  const index = meshIds(body?.mesh, kind)?.indexOf(id) ?? -1;
  const ref = index < 0 || !body ? undefined : engine.reference(body.id, kind, index);
  if (!ref) throw new Error(`no ${kind} named ${id}`);
  return ref;
}

function meshIds(mesh: Done['bodies'][number]['mesh'], kind: SubShapeKind): string[] | undefined {
  if (kind === 'face') return mesh?.faceIds;
  if (kind === 'edge') return mesh?.edgeIds;
  return mesh?.vertexIds;
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

function measure(body: string) {
  const shape = bodyShapes.get(body) as ShapeHandle;
  return {
    volume: kernel.measure(shape).volume,
    faces: kernel.count(shape, 'face'),
    valid: kernel.isValid(shape),
    vertices: kernel.mesh(shape, { linearDeflection: 0.05, angularDeflection: 0.4 }).vertices,
  };
}

const BOX = { w: 40, d: 30, h: 20 };

/** A 40 × 30 × 20 mm block (body `B:0`) on XY from z = 0 up. */
function block() {
  const b = new SketchBuilder();
  const lines = rect(b, 0, 0, BOX.w, BOX.d);
  return {
    lines,
    features: [sketch('SB', b.sketch), extrude('B', 'SB', b.sketch, `${BOX.h} mm`)],
  };
}

/** The name of the edge between two faces of block B. */
const between = (a: string, b: string) => edgeName([a, b]);
const cap = 'extrude:B:cap:end';
const capBottom = 'extrude:B:cap:start';
const side = (line: string) => `extrude:B:side:${line}`;

/** The B-rep vertices of a measurement, as points. */
function points(vertices: Float32Array): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (let i = 0; i + 2 < vertices.length; i += 3) {
    out.push([vertices[i] ?? 0, vertices[i + 1] ?? 0, vertices[i + 2] ?? 0]);
  }
  return out;
}

const FLOW = 'Measured for the variable fillet handles (P4-12): which end of a chain gets Radius.';

describe('where a variable fillet starts', { timeout: 300_000 }, () => {
  /** The distance from `q` to the nearest vertex of the filleted body: the radius there. */
  async function radiiAt(feats: Feature[], edge: string, ends: Vec3[]): Promise<number[]> {
    engine.clear();
    const ref = refTo(await run(testDocument(feats)), 'edge', edge);
    ok(
      await runWithShapes(
        testDocument([
          ...feats,
          fillet('F', [{ edges: [ref], radius: '2 mm', radiusEnd: '4 mm' }]),
        ]),
      ),
    );
    const pts = points(measure('B:0').vertices);
    return ends.map((q) =>
      Math.min(...pts.map((v) => Math.hypot(v[0] - q[0], v[1] - q[1], v[2] - q[2]))),
    );
  }

  it(`${FLOW} the end its edges' polylines leave from, whichever edge of the chain is first`, async () => {
    const b = new SketchBuilder();
    b.line(0, 0, 30, 0);
    b.arc(30, 10, 10, -90, 90);
    b.line(30, 20, 0, 20);
    b.line(0, 20, 0, 0);
    const feats = [sketch('SB', b.sketch), extrude('B', 'SB', b.sketch, '20 mm')];
    const first = ok(await run(testDocument(feats)));
    const mesh = first.bodies[0]?.mesh as NonNullable<Done['bodies'][number]['mesh']>;
    const chain: string[] = [];
    (mesh.edgeIds ?? []).forEach((id, e) => {
      const at = (i: number) => mesh.edgePoints[3 * i + 2] as number;
      const f = mesh.edgeRanges[2 * e] as number;
      const c = mesh.edgeRanges[2 * e + 1] as number;
      const x = (i: number) => mesh.edgePoints[3 * i] as number;
      if (at(f) === 20 && at(f + c - 1) === 20 && !(x(f) === 0 && x(f + c - 1) === 0))
        chain.push(id);
    });
    expect(chain).toHaveLength(3);
    for (const id of chain) {
      // The polylines run (0,0) → (30,0) → (30,20) → (0,20): the round starts at (0,0).
      const [start, end] = await radiiAt(feats, id, [
        [0, 0, 20],
        [0, 20, 20],
      ]);
      expect(start).toBeCloseTo(2, 1);
      expect(end).toBeCloseTo(4, 1);
    }
  });

  it(`${FLOW} the start of a box edge's polyline`, async () => {
    const base = block();
    const first = ok(await run(testDocument(base.features)));
    const mesh = first.bodies[0]?.mesh as NonNullable<Done['bodies'][number]['mesh']>;
    const edges = [
      between(cap, side(base.lines.bottom)),
      between(capBottom, side(base.lines.top)),
      between(side(base.lines.right), side(base.lines.top)),
    ];
    for (const id of edges) {
      const e = (mesh.edgeIds ?? []).indexOf(id);
      const f = mesh.edgeRanges[2 * e] as number;
      const c = mesh.edgeRanges[2 * e + 1] as number;
      const p = (i: number): Vec3 => [
        mesh.edgePoints[3 * i] as number,
        mesh.edgePoints[3 * i + 1] as number,
        mesh.edgePoints[3 * i + 2] as number,
      ];
      const [start, end] = await radiiAt(base.features, id, [p(f), p(f + c - 1)]);
      expect(start).toBeCloseTo(2, 1);
      expect(end).toBeCloseTo(4, 1);
    }
  });
});
