// The chamfer feature (P3-02, ADR-0043) through the recompute engine with
// real OCCT: edge sets with their own type (equal distance, two distances,
// distance and angle), tangent chains, the names chamfer faces get
// (ADR-0005), lost references, and the messages of failed chamfers with the
// suggested maximum distance (FR-UX-06).
// `golden/chamfer-options.json` is a golden table of cases (a Vitest file
// snapshot); rewrite it with `pnpm vitest run -u packages/kernel/src/features/chamfer`
// and review the diff.
import {
  type ChamferSetSpec,
  chamferInputs,
  type ExtrudoDocument,
  extrudeInputs,
  type Feature,
  type FeatureId,
  FeatureRegistry,
  type FeatureStatus,
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

function chamfer(id: string, sets: ChamferSetSpec[]): Feature {
  return { ...testFeature(id, 'chamfer'), inputs: chamferInputs(sets) };
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

/** The area of the face named `name` in the last recompute's first body, from its mesh. */
function faceArea(result: Done, name: string): number {
  const mesh = result.bodies[0]?.mesh;
  const at = mesh?.faceIds?.indexOf(name) ?? -1;
  if (!mesh || at < 0) throw new Error(`no face named ${name}`);
  const first = mesh.faceRanges[2 * at] as number;
  const count = mesh.faceRanges[2 * at + 1] as number;
  let area = 0;
  for (let t = first; t < first + count; t++) {
    const p = [0, 1, 2].map((k) => {
      const i = (mesh.indices[3 * t + k] as number) * 3;
      return [mesh.positions[i], mesh.positions[i + 1], mesh.positions[i + 2]] as number[];
    }) as [number[], number[], number[]];
    const u = [0, 1, 2].map((k) => (p[1][k] as number) - (p[0][k] as number));
    const v = [0, 1, 2].map((k) => (p[2][k] as number) - (p[0][k] as number));
    const cross = [
      (u[1] as number) * (v[2] as number) - (u[2] as number) * (v[1] as number),
      (u[2] as number) * (v[0] as number) - (u[0] as number) * (v[2] as number),
      (u[0] as number) * (v[1] as number) - (u[1] as number) * (v[0] as number),
    ];
    area += 0.5 * Math.hypot(...(cross as [number, number, number]));
  }
  return area;
}

const CAP_AREA = BOX.w * BOX.d;

/** A block, its front top edge as a reference and the chain-making helpers. */
async function withFrontEdge() {
  const base = block();
  const edge = between(cap, side(base.lines.bottom));
  const first = ok(await run(testDocument(base.features)));
  return { base, edge, ref: refTo(first, 'edge', edge), first };
}

describe('chamfer', { timeout: 120_000 }, () => {
  it('equal distance on one edge: a chamfer face named after it, the body a little smaller', async () => {
    const { base, edge, ref } = await withFrontEdge();
    const result = ok(
      await runWithShapes(
        testDocument([...base.features, chamfer('F', [{ edges: [ref], distance: '3 mm' }])]),
      ),
    );
    const m = measure('B:0');
    expect(m.faces).toBe(7);
    expect(m.valid).toBe(true);
    // A right triangle with 3 mm legs off the edge's 40 mm length.
    expect(m.volume).toBeCloseTo(BOX_VOLUME - 0.5 * 9 * 40, 2);
    expect(result.bodies[0]?.mesh?.faceIds).toContain(`chamfer:F:from:(${edge})`);
    // The cap loses 3 mm along the edge.
    expect(faceArea(result, cap)).toBeCloseTo(CAP_AREA - 3 * 40, 2);
  });

  it('two distances: distance 1 on one face, distance 2 on the other, and Flip swaps them', async () => {
    const { base, ref } = await withFrontEdge();
    const at = async (flip: boolean) =>
      ok(
        await runWithShapes(
          testDocument([
            ...base.features,
            chamfer('F', [
              { edges: [ref], mode: 'two-distances', distance: '2 mm', distanceB: '6 mm', flip },
            ]),
          ]),
        ),
      );
    const plain = await at(false);
    expect(measure('B:0').volume).toBeCloseTo(BOX_VOLUME - 0.5 * 2 * 6 * 40, 2);
    expect(measure('B:0').valid).toBe(true);
    const flipped = await at(true);
    expect(measure('B:0').volume).toBeCloseTo(BOX_VOLUME - 0.5 * 2 * 6 * 40, 2);
    // The cap gives up 2 mm along the edge one way, 6 mm the other.
    const areas = [faceArea(plain, cap), faceArea(flipped, cap)].sort((a, b) => a - b);
    expect(areas[0]).toBeCloseTo(CAP_AREA - 6 * 40, 2);
    expect(areas[1]).toBeCloseTo(CAP_AREA - 2 * 40, 2);
  });

  it('distance and angle: the angle is measured to the face that takes the distance', async () => {
    const { base, ref } = await withFrontEdge();
    const at = async (angle: string, flip: boolean) =>
      ok(
        await runWithShapes(
          testDocument([
            ...base.features,
            chamfer('F', [{ edges: [ref], mode: 'distance-angle', distance: '4 mm', angle, flip }]),
          ]),
        ),
      );
    // 45° is the equal-distance chamfer.
    await at('45 deg', false);
    expect(measure('B:0').volume).toBeCloseTo(BOX_VOLUME - 0.5 * 16 * 40, 2);
    // 30°: legs 4 mm and 4·tan 30° on the other face.
    const other = 4 * Math.tan(Math.PI / 6);
    const plain = await at('30 deg', false);
    expect(measure('B:0').volume).toBeCloseTo(BOX_VOLUME - 0.5 * 4 * other * 40, 2);
    expect(measure('B:0').valid).toBe(true);
    const flipped = await at('30 deg', true);
    const areas = [faceArea(plain, cap), faceArea(flipped, cap)].sort((a, b) => a - b);
    expect(areas[0]).toBeCloseTo(CAP_AREA - 4 * 40, 2);
    expect(areas[1]).toBeCloseTo(CAP_AREA - other * 40, 2);
  });

  it('two edge sets, each with its own type', async () => {
    const base = block();
    const a = between(cap, side(base.lines.bottom));
    const b = between(cap, side(base.lines.top));
    const c = between(cap, side(base.lines.left));
    const first = ok(await run(testDocument(base.features)));
    const doc = testDocument([
      ...base.features,
      chamfer('F', [
        { edges: [refTo(first, 'edge', a)], distance: '1 mm' },
        {
          edges: [refTo(first, 'edge', b)],
          mode: 'two-distances',
          distance: '3 mm',
          distanceB: '2 mm',
        },
        {
          edges: [refTo(first, 'edge', c)],
          mode: 'distance-angle',
          distance: '2 mm',
          angle: '45 deg',
        },
      ]),
    ]);
    const result = ok(await runWithShapes(doc));
    expect(measure('B:0').faces).toBe(9);
    expect(measure('B:0').valid).toBe(true);
    // Two 40 mm edges (1 mm and 3 × 2 mm legs) and one 30 mm edge (2 mm).
    const off = 0.5 * 1 * 40 + 0.5 * 3 * 2 * 40 + 0.5 * 4 * 30;
    // The chamfers meet at corners and share a little of that volume: within 2 %.
    expect(Math.abs(measure('B:0').volume - (BOX_VOLUME - off))).toBeLessThan(0.02 * off);
    for (const edge of [a, b, c]) {
      expect(result.bodies[0]?.mesh?.faceIds).toContain(`chamfer:F:from:(${edge})`);
    }
  });

  it('keeps its face names when a distance changes', async () => {
    const { base, ref } = await withFrontEdge();
    const at = (distance: string) =>
      run(testDocument([...base.features, chamfer('F', [{ edges: [ref], distance }])]));
    const small = ok(await at('1 mm'));
    const large = ok(await at('4 mm'));
    expect(large.bodies[0]?.mesh?.faceIds).toEqual(small.bodies[0]?.mesh?.faceIds);
  });

  it('bevels the whole tangent chain of a picked edge', async () => {
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
    const rounded: Feature = {
      ...testFeature('R', 'fillet'),
      inputs: {
        edges: { kind: 'ref', refs: corners.map((name) => refTo(first, 'edge', name)) },
        radius: { kind: 'expr', expr: '5 mm', unit: 'length' },
      },
    };
    const second = ok(await run(testDocument([...base.features, rounded])));
    const rim = refTo(second, 'edge', between(cap, side(l.bottom)));
    for (const set of [
      { edges: [rim], distance: '1 mm' },
      { edges: [rim], mode: 'two-distances', distance: '1 mm', distanceB: '2 mm' },
      { edges: [rim], mode: 'distance-angle', distance: '1 mm', angle: '30 deg' },
    ] satisfies ChamferSetSpec[]) {
      const result = ok(
        await runWithShapes(testDocument([...base.features, rounded, chamfer('F', [set])])),
      );
      const names = result.bodies[0]?.mesh?.faceIds ?? [];
      // 8 chamfer faces along the whole rim.
      expect(
        names.filter((n) => n.startsWith('chamfer:F:from:')),
        set.mode,
      ).toHaveLength(8);
      expect(measure('B:0').valid).toBe(true);
    }
  });

  it('chamfers each body on its own', async () => {
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
        testDocument([...features, chamfer('F', [{ edges: [inB, inC], distance: '1 mm' }])]),
      ),
    );
    expect(result.bodies.map((body) => body.id)).toEqual(['B:0', 'C:0']);
    expect(measure('B:0').faces).toBe(7);
    expect(measure('C:0').faces).toBe(7);
  });

  it('too large a distance says which edge and how large it may be, and that maximum works', async () => {
    const { base, ref } = await withFrontEdge();
    const failed = await run(
      testDocument([...base.features, chamfer('F', [{ edges: [ref], distance: '50 mm' }])]),
    );
    const st = status(failed, 'F');
    expect(st.status).toBe('error');
    const match = /^Distance 50 mm is too large for edge (\d+) \(max ≈ ([\d.]+) mm\)\.$/.exec(
      st.message ?? '',
    );
    expect(match, st.message).not.toBeNull();
    const max = Number(match?.[2]);
    // The block's edge is bounded by its 20 mm side: a bit under.
    expect(max).toBeGreaterThan(15);
    expect(max).toBeLessThanOrEqual(20);
    const again = await run(
      testDocument([...base.features, chamfer('F', [{ edges: [ref], distance: `${max} mm` }])]),
    );
    expect(status(again, 'F').status).toBe('ok');
  });

  it('two distances and distance and angle say their maximum too, and it works', async () => {
    const { base, ref } = await withFrontEdge();
    const two = await run(
      testDocument([
        ...base.features,
        chamfer('F', [
          { edges: [ref], mode: 'two-distances', distance: '50 mm', distanceB: '10 mm' },
        ]),
      ]),
    );
    const m2 =
      /^Distances 50 mm and 10 mm are too large for edge \d+\. Try up to ([\d.]+) mm and ([\d.]+) mm\.$/.exec(
        status(two, 'F').message ?? '',
      );
    expect(m2, status(two, 'F').message).not.toBeNull();
    const fits = await run(
      testDocument([
        ...base.features,
        chamfer('F', [
          {
            edges: [ref],
            mode: 'two-distances',
            distance: `${m2?.[1]} mm`,
            distanceB: `${m2?.[2]} mm`,
          },
        ]),
      ]),
    );
    expect(status(fits, 'F').status).toBe('ok');

    const angled = await run(
      testDocument([
        ...base.features,
        chamfer('F', [
          { edges: [ref], mode: 'distance-angle', distance: '60 mm', angle: '30 deg' },
        ]),
      ]),
    );
    const m3 = /^Distance 60 mm at 30° is too large for edge \d+ \(max ≈ ([\d.]+) mm\)\.$/.exec(
      status(angled, 'F').message ?? '',
    );
    expect(m3, status(angled, 'F').message).not.toBeNull();
    const angledFits = await run(
      testDocument([
        ...base.features,
        chamfer('F', [
          {
            edges: [ref],
            mode: 'distance-angle',
            distance: `${m3?.[1]} mm`,
            angle: '30 deg',
          },
        ]),
      ]),
    );
    expect(status(angledFits, 'F').status).toBe('ok');
  });

  it('edges of one tangent chain with two settings: says they take one', async () => {
    const base = block();
    const l = base.lines;
    const corners = [
      between(side(l.bottom), side(l.right)),
      between(side(l.right), side(l.top)),
      between(side(l.top), side(l.left)),
      between(side(l.left), side(l.bottom)),
    ];
    const first = ok(await run(testDocument(base.features)));
    const rounded: Feature = {
      ...testFeature('R', 'fillet'),
      inputs: {
        edges: { kind: 'ref', refs: corners.map((name) => refTo(first, 'edge', name)) },
        radius: { kind: 'expr', expr: '5 mm', unit: 'length' },
      },
    };
    const second = ok(await run(testDocument([...base.features, rounded])));
    const a = refTo(second, 'edge', between(cap, side(l.bottom)));
    const b = refTo(second, 'edge', between(cap, side(l.top)));
    const result = await run(
      testDocument([
        ...base.features,
        rounded,
        chamfer('F', [
          { edges: [a], distance: '1 mm' },
          { edges: [b], distance: '2 mm' },
        ]),
      ]),
    );
    const st = status(result, 'F');
    expect(st.status).toBe('error');
    expect(st.message).toMatch(/one chain of tangent edges, so they take one setting/);
  });

  it('the same edge in two sets with different settings is refused', async () => {
    const { base, ref } = await withFrontEdge();
    const result = await run(
      testDocument([
        ...base.features,
        chamfer('F', [
          { edges: [ref], distance: '1 mm' },
          { edges: [ref], distance: '2 mm' },
        ]),
      ]),
    );
    expect(status(result, 'F').message).toMatch(/is in edge sets 1 and 2 with different settings/);
  });

  it('asks for edges, for values above zero and for what the type needs', async () => {
    const { base, ref } = await withFrontEdge();
    const messageOf = async (sets: ChamferSetSpec[]) =>
      status(await run(testDocument([...base.features, chamfer('F', sets)])), 'F').message;
    expect(await messageOf([])).toBe('Pick at least one edge to chamfer.');
    expect(await messageOf([{ edges: [ref], distance: '0 mm' }])).toBe(
      'The distance of edge set 1 is 0 mm. Enter one greater than 0.',
    );
    expect(await messageOf([{ edges: [ref], mode: 'two-distances', distance: '1 mm' }])).toBe(
      'Enter a second distance for edge set 1.',
    );
    expect(await messageOf([{ edges: [ref], mode: 'distance-angle', distance: '1 mm' }])).toBe(
      'Enter an angle for edge set 1.',
    );
    expect(
      await messageOf([
        { edges: [ref], mode: 'distance-angle', distance: '1 mm', angle: '90 deg' },
      ]),
    ).toBe('The angle of edge set 1 is 90°. Enter an angle between 0° and 90°.');
  });

  it('a lost edge is a lost reference the timeline can fix', async () => {
    const base = block();
    const gone: GeomRef = { kind: 'edge', id: 'e[nothing:here|nor:there]' };
    const result = await run(
      testDocument([...base.features, chamfer('F', [{ edges: [gone], distance: '1 mm' }])]),
    );
    const st = status(result, 'F');
    expect(st.status).toBe('error');
    expect(st.message).toMatch(/Can't find an edge to chamfer any more/);
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
    type Case = Omit<ChamferSetSpec, 'edges'> & { edges: (keyof typeof edges)[] };
    const cases: Record<string, Case[]> = {
      'equal 0.5': [{ edges: ['front'], distance: '0.5 mm' }],
      'equal 5': [{ edges: ['front'], distance: '5 mm' }],
      'equal 18': [{ edges: ['front'], distance: '18 mm' }],
      'equal 25 too large': [{ edges: ['front'], distance: '25 mm' }],
      'two 2 and 6': [
        { edges: ['front'], mode: 'two-distances', distance: '2 mm', distanceB: '6 mm' },
      ],
      'two 2 and 6 flipped': [
        {
          edges: ['front'],
          mode: 'two-distances',
          distance: '2 mm',
          distanceB: '6 mm',
          flip: true,
        },
      ],
      'two 30 and 1 too large': [
        { edges: ['front'], mode: 'two-distances', distance: '30 mm', distanceB: '1 mm' },
      ],
      'angle 5 at 30': [
        { edges: ['front'], mode: 'distance-angle', distance: '5 mm', angle: '30 deg' },
      ],
      'angle 5 at 60 flipped': [
        {
          edges: ['front'],
          mode: 'distance-angle',
          distance: '5 mm',
          angle: '60 deg',
          flip: true,
        },
      ],
      'angle 5 at 89': [
        { edges: ['front'], mode: 'distance-angle', distance: '5 mm', angle: '89 deg' },
      ],
      'angle 40 at 30 too large': [
        { edges: ['front'], mode: 'distance-angle', distance: '40 mm', angle: '30 deg' },
      ],
      'vertical corner 8': [{ edges: ['corner'], distance: '8 mm' }],
      'two edges one set': [{ edges: ['front', 'back'], distance: '2 mm' }],
      'two sets, two types': [
        { edges: ['front'], distance: '1 mm' },
        {
          edges: ['back', 'left'],
          mode: 'two-distances',
          distance: '2 mm',
          distanceB: '3 mm',
        },
      ],
      'three edges meet at a corner': [{ edges: ['front', 'left', 'corner'], distance: '2 mm' }],
      'three edges meet 16': [{ edges: ['front', 'left', 'corner'], distance: '16 mm' }],
      'three edges meet, too large': [{ edges: ['front', 'left', 'corner'], distance: '25 mm' }],
    };
    const table: Record<string, unknown> = {};
    for (const [key, sets] of Object.entries(cases)) {
      const feature = chamfer(
        'F',
        sets.map(({ edges: names, ...rest }) => ({
          ...rest,
          edges: names.map((name) => edges[name]),
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
        chamferFaces: (result.bodies[0]?.mesh?.faceIds ?? [])
          .filter((n) => n.startsWith('chamfer:F:'))
          .sort(),
      };
    }
    await expect(`${JSON.stringify(table, null, 1)}\n`).toMatchFileSnapshot(
      './golden/chamfer-options.json',
    );
  });
});
