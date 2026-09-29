// The fillet feature (P3-01, ADR-0038) through the recompute engine with
// real OCCT: edge sets with their own radii, tangent chains, the names
// fillet faces get (ADR-0005), lost references, and the messages of failed
// fillets with the suggested maximum radius (FR-UX-06).
// `golden/fillet-options.json` is a golden table of cases (a Vitest file
// snapshot); rewrite it with `pnpm vitest run -u packages/kernel/src/features/fillet`
// and review the diff.
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

function fillet(id: string, sets: { edges: GeomRef[]; radius: string }[]): Feature {
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
  };
}

const round = (x: number, digits = 3) => {
  const r = Number(x.toFixed(digits));
  return Object.is(r, -0) ? 0 : r;
};

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
const side = (line: string) => `extrude:B:side:${line}`;

describe('fillet', { timeout: 120_000 }, () => {
  it('rounds one edge: a fillet face named after it, the body a little smaller', async () => {
    const base = block();
    const edge = between(cap, side(base.lines.bottom));
    const first = ok(await run(testDocument(base.features)));
    const ref = refTo(first, 'edge', edge);
    const result = ok(
      await runWithShapes(
        testDocument([...base.features, fillet('F', [{ edges: [ref], radius: '2 mm' }])]),
      ),
    );
    const m = measure('B:0');
    expect(m.faces).toBe(7);
    expect(m.valid).toBe(true);
    // A quarter of a 2 mm circle's area off the edge's 40 mm length.
    expect(m.volume).toBeCloseTo(BOX_VOLUME - (4 - Math.PI) * 40, 2);
    expect(result.bodies[0]?.mesh?.faceIds).toContain(`fillet:F:from:(${edge})`);
  });

  it('two edge sets, each with its own radius', async () => {
    const base = block();
    const a = between(cap, side(base.lines.bottom));
    const b = between(cap, side(base.lines.top));
    const first = ok(await run(testDocument(base.features)));
    const doc = testDocument([
      ...base.features,
      fillet('F', [
        { edges: [refTo(first, 'edge', a)], radius: '1 mm' },
        { edges: [refTo(first, 'edge', b)], radius: '3 mm' },
      ]),
    ]);
    const result = ok(await runWithShapes(doc));
    expect(measure('B:0').faces).toBe(8);
    expect(measure('B:0').valid).toBe(true);
    // (1 − π/4) r² off each 40 mm edge, for r = 1 and r = 3.
    const off = (1 - Math.PI / 4) * 40 * (1 + 9);
    expect(measure('B:0').volume).toBeCloseTo(BOX_VOLUME - off, 2);
    expect(result.bodies[0]?.mesh?.faceIds).toContain(`fillet:F:from:(${a})`);
    expect(result.bodies[0]?.mesh?.faceIds).toContain(`fillet:F:from:(${b})`);
  });

  it('keeps its face names when the radius changes', async () => {
    const base = block();
    const edge = between(cap, side(base.lines.bottom));
    const first = ok(await run(testDocument(base.features)));
    const ref = refTo(first, 'edge', edge);
    const at = (radius: string) =>
      run(testDocument([...base.features, fillet('F', [{ edges: [ref], radius }])]));
    const small = ok(await at('1 mm'));
    const large = ok(await at('4 mm'));
    expect(large.bodies[0]?.mesh?.faceIds).toEqual(small.bodies[0]?.mesh?.faceIds);
  });

  it('rounds the whole tangent chain of a picked edge, and unites it with the arcs', async () => {
    const base = block();
    // Round the four vertical edges first: the top outline becomes a chain of 8 tangent edges.
    const l = base.lines;
    const corners = [
      between(side(l.bottom), side(l.right)),
      between(side(l.right), side(l.top)),
      between(side(l.top), side(l.left)),
      between(side(l.left), side(l.bottom)),
    ];
    const first = ok(await run(testDocument(base.features)));
    const rounded = fillet('F1', [
      { edges: corners.map((name) => refTo(first, 'edge', name)), radius: '5 mm' },
    ]);
    const second = ok(await run(testDocument([...base.features, rounded])));
    const rim = refTo(second, 'edge', between(cap, side(l.bottom)));
    const result = ok(
      await runWithShapes(
        testDocument([...base.features, rounded, fillet('F2', [{ edges: [rim], radius: '1 mm' }])]),
      ),
    );
    const names = result.bodies[0]?.mesh?.faceIds ?? [];
    // 4 flat sides, 4 corners, the top and bottom, and 8 fillet faces along the whole rim.
    expect(names.filter((n) => n.startsWith('fillet:F2:from:'))).toHaveLength(8);
    expect(measure('B:0').faces).toBe(18);
    expect(measure('B:0').valid).toBe(true);
  });

  it('fillets each body on its own', async () => {
    const one = block();
    const b = new SketchBuilder();
    const l = rect(b, 100, 0, 10, 10);
    const features = [
      ...one.features,
      sketch('SC', b.sketch),
      extrude('C', 'SC', b.sketch, '10 mm'),
    ];
    const first = ok(await run(testDocument(features)));
    const inB = refTo(first, 'edge', between(cap, side(one.lines.bottom)));
    const inC = refTo(first, 'edge', between('extrude:C:cap:end', `extrude:C:side:${l.bottom}`));
    const result = ok(
      await runWithShapes(
        testDocument([...features, fillet('F', [{ edges: [inB, inC], radius: '1 mm' }])]),
      ),
    );
    expect(result.bodies.map((body) => body.id)).toEqual(['B:0', 'C:0']);
    expect(measure('B:0').faces).toBe(7);
    expect(measure('C:0').faces).toBe(7);
  });

  it('too large a radius says which edge and how large it may be, and that maximum works', async () => {
    const base = block();
    const edge = between(cap, side(base.lines.bottom));
    const first = ok(await run(testDocument(base.features)));
    const ref = refTo(first, 'edge', edge);
    const failed = await run(
      testDocument([...base.features, fillet('F', [{ edges: [ref], radius: '50 mm' }])]),
    );
    const st = status(failed, 'F');
    expect(st.status).toBe('error');
    const match = /^Radius 50 mm is too large for edge (\d+) \(max ≈ ([\d.]+) mm\)\.$/.exec(
      st.message ?? '',
    );
    expect(match, st.message).not.toBeNull();
    const max = Number(match?.[2]);
    // The block's edge is bounded by its 20 mm side: a bit under.
    expect(max).toBeGreaterThan(15);
    expect(max).toBeLessThanOrEqual(20);
    const again = await run(
      testDocument([...base.features, fillet('F', [{ edges: [ref], radius: `${max} mm` }])]),
    );
    expect(status(again, 'F').status).toBe('ok');
  });

  it('edges of one tangent chain with two radii: says they take one', async () => {
    const base = block();
    const l = base.lines;
    const corners = [
      between(side(l.bottom), side(l.right)),
      between(side(l.right), side(l.top)),
      between(side(l.top), side(l.left)),
      between(side(l.left), side(l.bottom)),
    ];
    const first = ok(await run(testDocument(base.features)));
    const rounded = fillet('F1', [
      { edges: corners.map((name) => refTo(first, 'edge', name)), radius: '5 mm' },
    ]);
    const second = ok(await run(testDocument([...base.features, rounded])));
    const a = refTo(second, 'edge', between(cap, side(l.bottom)));
    const b = refTo(second, 'edge', between(cap, side(l.top)));
    const result = await run(
      testDocument([
        ...base.features,
        rounded,
        fillet('F2', [
          { edges: [a], radius: '1 mm' },
          { edges: [b], radius: '2 mm' },
        ]),
      ]),
    );
    const st = status(result, 'F2');
    expect(st.status).toBe('error');
    expect(st.message).toMatch(/one chain of tangent edges, so they take one radius/);
  });

  it('the same edge in two sets with different radii is refused', async () => {
    const base = block();
    const first = ok(await run(testDocument(base.features)));
    const ref = refTo(first, 'edge', between(cap, side(base.lines.bottom)));
    const result = await run(
      testDocument([
        ...base.features,
        fillet('F', [
          { edges: [ref], radius: '1 mm' },
          { edges: [ref], radius: '2 mm' },
        ]),
      ]),
    );
    expect(status(result, 'F').message).toMatch(/is in edge sets 1 and 2 with different radii/);
  });

  it('asks for edges and for a radius above zero', async () => {
    const base = block();
    const first = ok(await run(testDocument(base.features)));
    const ref = refTo(first, 'edge', between(cap, side(base.lines.bottom)));
    const none = await run(testDocument([...base.features, fillet('F', [])]));
    expect(status(none, 'F').message).toBe('Pick at least one edge to fillet.');
    const zero = await run(
      testDocument([...base.features, fillet('F', [{ edges: [ref], radius: '0 mm' }])]),
    );
    expect(status(zero, 'F').message).toBe(
      'The radius of edge set 1 is 0 mm. Enter a radius greater than 0.',
    );
  });

  it('a lost edge is a lost reference the timeline can fix', async () => {
    const base = block();
    const gone: GeomRef = { kind: 'edge', id: 'e[nothing:here|nor:there]' };
    const result = await run(
      testDocument([...base.features, fillet('F', [{ edges: [gone], radius: '1 mm' }])]),
    );
    const st = status(result, 'F');
    expect(st.status).toBe('error');
    expect(st.message).toMatch(/Can't find an edge to fillet any more/);
    expect(st.refs).toEqual([{ ref: { kind: 'edge', id: gone.id }, state: 'lost' }]);
  });

  it('golden table of cases', async () => {
    const base = block();
    const l = base.lines;
    const first = ok(await run(testDocument(base.features)));
    const edges = {
      front: refTo(first, 'edge', between(cap, side(l.bottom))),
      back: refTo(first, 'edge', between(cap, side(l.top))),
      left: refTo(first, 'edge', between(cap, side(l.left))),
      corner: refTo(first, 'edge', between(side(l.bottom), side(l.right))),
    };
    const cases: Record<string, { edges: (keyof typeof edges)[]; radius: string }[]> = {
      'one edge 0.5': [{ edges: ['front'], radius: '0.5 mm' }],
      'one edge 5': [{ edges: ['front'], radius: '5 mm' }],
      'one edge 18': [{ edges: ['front'], radius: '18 mm' }],
      'one edge 25 too large': [{ edges: ['front'], radius: '25 mm' }],
      'vertical corner 8': [{ edges: ['corner'], radius: '8 mm' }],
      'two edges one set': [{ edges: ['front', 'back'], radius: '2 mm' }],
      'two sets': [
        { edges: ['front'], radius: '1 mm' },
        { edges: ['back', 'left'], radius: '2 mm' },
      ],
      'three edges meet at a corner': [{ edges: ['front', 'left', 'corner'], radius: '2 mm' }],
      'three edges meet 16': [{ edges: ['front', 'left', 'corner'], radius: '16 mm' }],
      'three edges meet, too large': [{ edges: ['front', 'left', 'corner'], radius: '25 mm' }],
    };
    const table: Record<string, unknown> = {};
    for (const [key, sets] of Object.entries(cases)) {
      const feature = fillet(
        'F',
        sets.map(({ edges: names, radius }) => ({
          edges: names.map((name) => edges[name]),
          radius,
        })),
      );
      const result = await runWithShapes(testDocument([...base.features, feature]));
      const st = status(result, 'F');
      if (st.status === 'error') {
        table[key] = { error: st.message };
        continue;
      }
      const m = measure('B:0');
      table[key] = {
        volume: round(m.volume, 2),
        faces: m.faces,
        valid: m.valid,
        filletFaces: (result.bodies[0]?.mesh?.faceIds ?? [])
          .filter((n) => n.startsWith('fillet:F:'))
          .sort(),
      };
    }
    await expect(`${JSON.stringify(table, null, 1)}\n`).toMatchFileSnapshot(
      './golden/fillet-options.json',
    );
  });
});
