// The variable-radius fillet (P4-10, ADR-0064 §2) through the recompute engine
// with real OCCT: an end radius per edge set, `swap`, the two radii of a chain,
// the messages of a taper that is too large, and the two builds the evaluator
// picks between (a constant document still takes the constant `fillet`, so it
// computes exactly as before).
import {
  type ExtrudoDocument,
  extrudeInputs,
  type Feature,
  type FeatureId,
  FeatureRegistry,
  type FeatureStatus,
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

const status = (result: Done, id: string): FeatureStatus =>
  result.features[id as FeatureId] ?? { status: 'ok' };

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
const BOX_VOLUME = BOX.w * BOX.d * BOX.h;

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

/** What a round of radius r takes off a right-angled edge of the block's length. */
const taken = (r: number) => (1 - Math.PI / 4) * r * r * BOX.w;

/** The B-rep vertices of a measurement, as points. */
function points(vertices: Float32Array): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (let i = 0; i + 2 < vertices.length; i += 3) {
    out.push([vertices[i] ?? 0, vertices[i + 1] ?? 0, vertices[i + 2] ?? 0]);
  }
  return out;
}

/** Whether one of the points is within `tol` of `at`. */
function near(points: readonly [number, number, number][], at: Vec3, tol = 0.05): boolean {
  return points.some(
    (p) =>
      Math.abs(p[0] - at[0]) < tol && Math.abs(p[1] - at[1]) < tol && Math.abs(p[2] - at[2]) < tol,
  );
}

/** Where the round meets the block's top face at x: its radius back from the edge. */
const onTop = (x: number, radius: number): Vec3 => [x, radius, BOX.h];

describe('the variable-radius fillet', { timeout: 180_000 }, () => {
  it('takes an end radius along one edge: a fillet face named after it, between the two flat volumes', async () => {
    const base = block();
    const edge = between(cap, side(base.lines.bottom));
    const first = ok(await run(testDocument(base.features)));
    const ref = refTo(first, 'edge', edge);
    const flat2 = ok(
      await runWithShapes(
        testDocument([...base.features, fillet('F', [{ edges: [ref], radius: '2 mm' }])]),
      ),
    );
    expect(measure('B:0').volume).toBeCloseTo(BOX_VOLUME - taken(2), 2);
    const flat5 = ok(
      await runWithShapes(
        testDocument([...base.features, fillet('F', [{ edges: [ref], radius: '5 mm' }])]),
      ),
    );
    expect(measure('B:0').volume).toBeCloseTo(BOX_VOLUME - taken(5), 2);
    const result = ok(
      await runWithShapes(
        testDocument([
          ...base.features,
          fillet('F', [{ edges: [ref], radius: '2 mm', radiusEnd: '5 mm' }]),
        ]),
      ),
    );
    const m = measure('B:0');
    expect(m.faces).toBe(7);
    expect(m.valid).toBe(true);
    expect(m.volume).toBeLessThan(BOX_VOLUME - taken(2));
    expect(m.volume).toBeGreaterThan(BOX_VOLUME - taken(5));
    // Near the linear taper's volume, within the easing OCCT's law does at both ends.
    expect(m.volume).toBeGreaterThan(BOX_VOLUME - taken(2) - taken(5) / 2);
    expect(result.bodies[0]?.mesh?.faceIds).toContain(`fillet:F:from:(${edge})`);
    expect(flat2.bodies[0]?.mesh?.faceIds).toEqual(flat5.bodies[0]?.mesh?.faceIds);
    // The round is 2 mm at one end of the edge and 5 mm at the other: the body's
    // own vertices say so, where the fillet meets each face.
    expect(near(points(m.vertices), onTop(0, 2)) || near(points(m.vertices), onTop(0, 5))).toBe(
      true,
    );
    expect(
      near(points(m.vertices), onTop(BOX.w, 5)) || near(points(m.vertices), onTop(BOX.w, 2)),
    ).toBe(true);
  });

  it('two equal radii are the constant fillet', async () => {
    const base = block();
    const edge = between(cap, side(base.lines.bottom));
    const first = ok(await run(testDocument(base.features)));
    const ref = refTo(first, 'edge', edge);
    await runWithShapes(
      testDocument([...base.features, fillet('F', [{ edges: [ref], radius: '2 mm' }])]),
    );
    const flat = measure('B:0').volume;
    await runWithShapes(
      testDocument([
        ...base.features,
        fillet('F', [{ edges: [ref], radius: '2 mm', radiusEnd: '2 mm' }]),
      ]),
    );
    expect(measure('B:0').volume).toBeCloseTo(flat, 4);
  });

  it('swap puts the end radius at the other end, and takes off the same amount', async () => {
    const base = block();
    const edge = between(cap, side(base.lines.bottom));
    const first = ok(await run(testDocument(base.features)));
    const ref = refTo(first, 'edge', edge);
    const tapered = ok(
      await runWithShapes(
        testDocument([
          ...base.features,
          fillet('F', [{ edges: [ref], radius: '2 mm', radiusEnd: '5 mm' }]),
        ]),
      ),
    );
    const before = measure('B:0');
    const swapped = ok(
      await runWithShapes(
        testDocument([
          ...base.features,
          fillet('F', [{ edges: [ref], radius: '2 mm', radiusEnd: '5 mm', swap: true }]),
        ]),
      ),
    );
    const after = measure('B:0');
    expect(after.volume).toBeCloseTo(before.volume, 4);
    expect(after.faces).toBe(before.faces);
    expect(swapped.bodies[0]?.mesh?.faceIds).toEqual(tapered.bodies[0]?.mesh?.faceIds);
    // The 5 mm end is at the other vertex now: at one end the round reaches
    // 5 mm into both faces, at the other 2 mm.
    const big = (v: Float32Array, x: number) => near(points(v), onTop(x, 5));
    const small = (v: Float32Array, x: number) => near(points(v), onTop(x, 2));
    const beforeAtZero = big(before.vertices, 0);
    expect(big(after.vertices, 0)).toBe(!beforeAtZero);
    expect(big(after.vertices, BOX.w)).toBe(beforeAtZero);
    expect(small(after.vertices, 0)).toBe(beforeAtZero);
  });

  it('a chain of three tangent edges tapers along the whole chain', async () => {
    const base = block();
    const l = base.lines;
    // Round the one upright edge at the (0, 0) corner: the bottom outline around
    // it is a chain of the two lines and the arc between them.
    const uprights = [between(side(l.bottom), side(l.left))];
    const first = ok(await run(testDocument(base.features)));
    const rounded = fillet('F1', [
      { edges: uprights.map((name) => refTo(first, 'edge', name)), radius: '2 mm' },
    ]);
    const second = ok(await runWithShapes(testDocument([...base.features, rounded])));
    // The arc is an edge of the bottom face and of F1's fillet face.
    const ids = second.bodies[0]?.mesh?.edgeIds ?? [];
    const arc = ids.findIndex(
      (name) => name.includes(capBottom) && name.includes('fillet:F1:from:('),
    );
    expect(arc).toBeGreaterThanOrEqual(0);
    const bodyId = second.bodies[0]?.id;
    if (!bodyId) throw new Error('no body');
    const shape = bodyShapes.get('B:0') as ShapeHandle;
    const chain = kernel.tangentChain(shape, arc);
    expect(chain).toHaveLength(3);
    const refs = chain.map((index) => {
      const ref = engine.reference(bodyId, 'edge', index);
      if (!ref) throw new Error(`no edge ${index}`);
      return ref;
    });
    ok(
      await runWithShapes(
        testDocument([...base.features, rounded, fillet('F2', [{ edges: refs, radius: '1 mm' }])]),
      ),
    );
    const flat1Volume = measure('B:0').volume;
    ok(
      await runWithShapes(
        testDocument([...base.features, rounded, fillet('F2', [{ edges: refs, radius: '3 mm' }])]),
      ),
    );
    const flat3Volume = measure('B:0').volume;
    expect(flat1Volume).toBeGreaterThan(flat3Volume);
    const tapered = ok(
      await runWithShapes(
        testDocument([
          ...base.features,
          rounded,
          fillet('F2', [{ edges: refs, radius: '1 mm', radiusEnd: '3 mm' }]),
        ]),
      ),
    );
    const m = measure('B:0');
    expect(m.valid).toBe(true);
    expect(m.volume).toBeLessThan(flat1Volume);
    expect(m.volume).toBeGreaterThan(flat3Volume);
    // All three edges of the chain are rounded, as with a constant fillet.
    expect(
      (tapered.bodies[0]?.mesh?.faceIds ?? []).filter((n) => n.startsWith('fillet:F2:from:(')),
    ).toHaveLength(3);
  });

  it('a set of two sets: the constant one and the variable one both round', async () => {
    const base = block();
    const l = base.lines;
    const first = ok(await run(testDocument(base.features)));
    const front = refTo(first, 'edge', between(cap, side(l.bottom)));
    const back = refTo(first, 'edge', between(cap, side(l.top)));
    const result = ok(
      await runWithShapes(
        testDocument([
          ...base.features,
          fillet('F', [
            { edges: [front], radius: '2 mm' },
            { edges: [back], radius: '1 mm', radiusEnd: '3 mm' },
          ]),
        ]),
      ),
    );
    const m = measure('B:0');
    expect(m.faces).toBe(8);
    expect(m.valid).toBe(true);
    // The two rounds are on different faces, so the second one's volume lies
    // between a 1 mm and a 3 mm round of that edge, on top of the first one's.
    expect(m.volume).toBeLessThan(BOX_VOLUME - taken(2) - (1 - Math.PI / 4) * BOX.w);
    expect(m.volume).toBeGreaterThan(BOX_VOLUME - taken(2) - (1 - Math.PI / 4) * BOX.w * 9);
    expect(result.bodies[0]?.mesh?.faceIds).toContain(
      `fillet:F:from:(${between(cap, side(l.bottom))})`,
    );
    expect(result.bodies[0]?.mesh?.faceIds).toContain(
      `fillet:F:from:(${between(cap, side(l.top))})`,
    );
  });

  it('a taper that is too large says how far every radius can be scaled down', async () => {
    const base = block();
    const edge = between(cap, side(base.lines.bottom));
    const first = ok(await run(testDocument(base.features)));
    const ref = refTo(first, 'edge', edge);
    const result = await run(
      testDocument([
        ...base.features,
        fillet('F', [{ edges: [ref], radius: '2 mm', radiusEnd: '60 mm' }]),
      ]),
    );
    const st = status(result, 'F');
    expect(st.status).toBe('error');
    const match =
      /^These fillets can't all be built where they meet\. Try radii up to about ([\d.]+) mm, or fewer edges at once\.$/.exec(
        st.message ?? '',
      );
    expect(match, st.message).not.toBeNull();
    // The block's edge is bounded by its 20 mm side: what scales 60 mm down to it
    // works, and a little more than a constant 19 mm fillet does not.
    const largest = Number(match?.[1]);
    expect(largest).toBeGreaterThan(15);
    expect(largest).toBeLessThanOrEqual(20);
    const again = await run(
      testDocument([
        ...base.features,
        fillet('F', [{ edges: [ref], radius: '2 mm', radiusEnd: `${largest} mm` }]),
      ]),
    );
    expect(status(again, 'F').status).toBe('ok');
  });

  it('asks for an end radius above zero', async () => {
    const base = block();
    const first = ok(await run(testDocument(base.features)));
    const ref = refTo(first, 'edge', between(cap, side(base.lines.bottom)));
    const zero = await run(
      testDocument([
        ...base.features,
        fillet('F', [{ edges: [ref], radius: '2 mm', radiusEnd: '0 mm' }]),
      ]),
    );
    expect(status(zero, 'F').message).toBe(
      'The end radius of edge set 1 is 0 mm. Enter a radius greater than 0.',
    );
  });

  it('the same edge in a constant set and a variable one is refused', async () => {
    const base = block();
    const first = ok(await run(testDocument(base.features)));
    const ref = refTo(first, 'edge', between(cap, side(base.lines.bottom)));
    const result = await run(
      testDocument([
        ...base.features,
        fillet('F', [
          { edges: [ref], radius: '2 mm' },
          { edges: [ref], radius: '2 mm', radiusEnd: '5 mm' },
        ]),
      ]),
    );
    expect(status(result, 'F').message).toMatch(/is in edge sets 1 and 2 with different radii/);
  });

  it('builds a constant fillet with fillet, and a variable one with filletVariable', async () => {
    const base = block();
    const edge = between(cap, side(base.lines.bottom));
    const first = ok(await run(testDocument(base.features)));
    const ref = refTo(first, 'edge', edge);
    const filletCalls: number[][] = [];
    const variableCalls: number[][] = [];
    const flat = kernel.fillet.bind(kernel);
    const tapered = kernel.filletVariable.bind(kernel);
    kernel.fillet = (shape, edges, radius) => {
      filletCalls.push([...edges]);
      return flat(shape, edges, radius);
    };
    kernel.filletVariable = (shape, edges, radii) => {
      variableCalls.push([...edges]);
      return tapered(shape, edges, radii);
    };
    try {
      ok(
        await run(
          testDocument([...base.features, fillet('F', [{ edges: [ref], radius: '2 mm' }])]),
        ),
      );
      expect(filletCalls).toHaveLength(1);
      expect(variableCalls).toHaveLength(0);
      filletCalls.length = 0;
      ok(
        await run(
          testDocument([
            ...base.features,
            fillet('F', [{ edges: [ref], radius: '2 mm', radiusEnd: '5 mm' }]),
          ]),
        ),
      );
      expect(variableCalls).toHaveLength(1);
      expect(filletCalls).toHaveLength(0);
    } finally {
      kernel.fillet = flat;
      kernel.filletVariable = tapered;
    }
  });
});
