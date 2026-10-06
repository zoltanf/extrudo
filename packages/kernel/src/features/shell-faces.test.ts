// A shell with a thickness per face (P4-12, ADR-0046's amendment) through
// the recompute engine with real OCCT and strict leaks: wall sets (a thicker
// floor, a thinner side), inside and outside, closed, several sets, a
// cylinder, a body with rounded edges, the refusals (a face in two sets, a
// removed face, a face of another body, a body whose smooth chains have a
// sharp edge inside, which OCCT's per-face offset traps on) and the
// diagnosis of walls that are too thick, with every thickness scaled.
import {
  type ExtrudoDocument,
  extrudeInputs,
  type Feature,
  type FeatureId,
  FeatureRegistry,
  type FeatureStatus,
  type GeomRef,
  originPlaneRef,
  type ShellInputOptions,
  type SketchData,
  shellInputs,
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

function shell(
  id: string,
  faces: GeomRef[],
  thickness: string,
  options: ShellInputOptions = {},
): Feature {
  return { ...testFeature(id, 'shell'), inputs: shellInputs(faces, thickness, options) };
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

function refTo(result: Done, kind: SubShapeKind, id: string): GeomRef {
  for (const body of result.bodies) {
    const list = kind === 'face' ? body.mesh?.faceIds : body.mesh?.edgeIds;
    const index = list?.indexOf(id) ?? -1;
    if (index < 0) continue;
    const ref = engine.reference(body.id, kind, index);
    if (ref) return ref;
  }
  throw new Error(`no ${kind} named ${id}`);
}

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
  const { volume, bbox } = kernel.measure(shape);
  return { volume, bbox, faces: kernel.count(shape, 'face'), valid: kernel.isValid(shape) };
}

const W = 40;
const D = 30;
const H = 20;
const VOLUME = W * D * H;

const cap = 'extrude:B:cap:end';
const floor = 'extrude:B:cap:start';
const side = (line: string) => `extrude:B:side:${line}`;
const faceNames = (result: Done, body = 0) => result.bodies[body]?.mesh?.faceIds ?? [];

/** A 40 × 30 × 20 mm block (body `B:0`) and references to its faces. */
async function withBlock() {
  const b = new SketchBuilder();
  const lines = rect(b, 0, 0, W, D);
  const features = [sketch('SB', b.sketch), extrude('B', 'SB', b.sketch, `${H} mm`)];
  const first = ok(await run(testDocument(features)));
  return {
    features,
    lines,
    first,
    top: refTo(first, 'face', cap),
    bottom: refTo(first, 'face', floor),
    front: refTo(first, 'face', side(lines.bottom)),
  };
}

/** Block B with some of its edges rounded with 5 mm (`which` picks the edges by their two faces). */
async function roundedBlock(which: 'vertical' | 'top') {
  const block = await withBlock();
  const l = block.lines;
  const sides = [l.bottom, l.right, l.top, l.left].map(side);
  const edges =
    which === 'vertical'
      ? sides.map((s, i) => edgeName([s, sides[(i + 1) % 4] as string]))
      : sides.map((s) => edgeName([s, cap]));
  const rounded: Feature = {
    ...testFeature('R', 'fillet'),
    inputs: {
      edges: { kind: 'ref', refs: edges.map((name) => refTo(block.first, 'edge', name)) },
      radius: { kind: 'expr', expr: '5 mm', unit: 'length' },
    },
  };
  const features = [...block.features, rounded];
  const first = ok(await run(testDocument(features)));
  return { ...block, features, first };
}

/** The area of a W × D rectangle less `inset` all round, its corners rounded with r. */
const roundedArea = (inset: number, r: number) =>
  (W - 2 * inset) * (D - 2 * inset) - 4 * r * r * (1 - Math.PI / 4);

describe('shell with a thickness per face', { timeout: 120_000 }, () => {
  it('a thicker floor: the volume is exact and the names are the plain shell’s', async () => {
    const { features, top, bottom, lines } = await withBlock();
    const walls = [{ faces: [bottom], thickness: '4 mm' }];
    const result = ok(
      await runWithShapes(testDocument([...features, shell('S', [top], '2 mm', { walls })])),
    );
    const m = measure('B:0');
    expect(m.valid).toBe(true);
    expect(m.faces).toBe(11);
    expect(m.volume).toBeCloseTo(VOLUME - (W - 4) * (D - 4) * (H - 4), 2);
    expect(m.bbox.min.map((x) => Math.round(x * 10) / 10 + 0)).toEqual([0, 0, 0]);
    const names = faceNames(result);
    expect(names).toContain(floor);
    expect(names).toContain(`shell:S:inner:(${floor})`);
    expect(names).toContain(`shell:S:rim:(${cap})`);
    for (const line of Object.values(lines)) {
      expect(names).toContain(side(line));
      expect(names).toContain(`shell:S:inner:(${side(line)})`);
    }
    expect(new Set(names).size).toBe(names.length);
    // The same names as without the wall set: a later reference survives adding one.
    const plain = ok(await run(testDocument([...features, shell('S', [top], '2 mm')])));
    expect([...names].sort()).toEqual([...faceNames(plain)].sort());
  });

  it('outside: the floor grows 4 mm down, the sides 2 mm out, the corners sharp', async () => {
    const { features, top, bottom } = await withBlock();
    const walls = [{ faces: [bottom], thickness: '4 mm' }];
    const result = ok(
      await runWithShapes(
        testDocument([...features, shell('S', [top], '2 mm', { walls, direction: 'outside' })]),
      ),
    );
    const m = measure('B:0');
    expect(m.valid).toBe(true);
    expect(m.faces).toBe(11);
    expect(m.volume).toBeCloseTo((W + 4) * (D + 4) * (H + 4) - VOLUME, 2);
    expect(m.bbox.min.map((x) => Math.round(x * 10) / 10 + 0)).toEqual([-2, -2, -4]);
    expect(m.bbox.max.map((x) => Math.round(x * 10) / 10 + 0)).toEqual([W + 2, D + 2, H]);
    const names = faceNames(result);
    // Outside the offset faces are the outer skin and keep the names.
    expect(names).toContain(floor);
    expect(names).toContain(`shell:S:inner:(${floor})`);
    expect(names.some((n) => n.startsWith('shell:S:round:'))).toBe(false);
  });

  it('two sets, and a closed body with a thicker lid', async () => {
    const { features, top, bottom, front } = await withBlock();
    ok(
      await runWithShapes(
        testDocument([
          ...features,
          shell('S', [top], '2 mm', {
            walls: [
              { faces: [bottom], thickness: '4 mm' },
              { faces: [front], thickness: '3 mm' },
            ],
          }),
        ]),
      ),
    );
    expect(measure('B:0').volume).toBeCloseTo(VOLUME - (W - 4) * (D - 5) * (H - 4), 2);
    ok(
      await runWithShapes(
        testDocument([
          ...features,
          shell('S', [], '2 mm', { bodies: ['B:0'], walls: [{ faces: [top], thickness: '5 mm' }] }),
        ]),
      ),
    );
    const m = measure('B:0');
    expect(m.valid).toBe(true);
    expect(m.faces).toBe(12);
    expect(m.volume).toBeCloseTo(VOLUME - (W - 4) * (D - 4) * (H - 7), 2);
  });

  it('a cylinder with a thicker floor', async () => {
    const b = new SketchBuilder();
    b.circle(0, 0, 10);
    const features = [sketch('SB', b.sketch), extrude('B', 'SB', b.sketch, '20 mm')];
    const first = ok(await run(testDocument(features)));
    const top = refTo(first, 'face', cap);
    const bottom = refTo(first, 'face', floor);
    ok(
      await runWithShapes(
        testDocument([
          ...features,
          shell('S', [top], '2 mm', { walls: [{ faces: [bottom], thickness: '5 mm' }] }),
        ]),
      ),
    );
    const m = measure('B:0');
    expect(m.valid).toBe(true);
    expect(m.volume).toBeCloseTo(Math.PI * (100 * 20 - 64 * 15), 2);
  });

  it('a body with rounded vertical edges, a thicker floor', async () => {
    const { features, first, lines } = await roundedBlock('vertical');
    // References read from the last recompute's meshes, so all of them before the shells run.
    const top = refTo(first, 'face', cap);
    const bottom = refTo(first, 'face', floor);
    const front = refTo(first, 'face', side(lines.bottom));
    ok(
      await runWithShapes(
        testDocument([
          ...features,
          shell('S', [top], '2 mm', { walls: [{ faces: [bottom], thickness: '4 mm' }] }),
        ]),
      ),
    );
    const m = measure('B:0');
    expect(m.valid).toBe(true);
    expect(m.volume).toBeCloseTo(roundedArea(0, 5) * H - roundedArea(2, 3) * (H - 4), 1);
    // A side runs smoothly into the rounds and the other sides: the whole ring takes 3 mm.
    ok(
      await runWithShapes(
        testDocument([
          ...features,
          shell('S', [top], '2 mm', { walls: [{ faces: [front], thickness: '3 mm' }] }),
        ]),
      ),
    );
    expect(measure('B:0').volume).toBeCloseTo(
      roundedArea(0, 5) * H - roundedArea(3, 2) * (H - 2),
      1,
    );
  });

  it('refuses a face in two sets, a removed face and a face of another body', async () => {
    const { features, top, bottom, front } = await withBlock();
    const messageOf = async (feature: Feature, more: Feature[] = []) =>
      status(await run(testDocument([...features, ...more, feature])), 'S').message;
    expect(
      await messageOf(
        shell('S', [top], '2 mm', {
          walls: [
            { faces: [bottom], thickness: '4 mm' },
            { faces: [front, bottom], thickness: '3 mm' },
          ],
        }),
      ),
    ).toMatch(/^Face \d+ is in wall sets 1 and 2\. A face takes one thickness/);
    expect(
      await messageOf(shell('S', [top], '2 mm', { walls: [{ faces: [top], thickness: '4 mm' }] })),
    ).toMatch(/^Face \d+ is removed, so it has no wall: take it out of wall set 1\./);
    // A second block, C, that the shell doesn't hollow.
    const b = new SketchBuilder();
    rect(b, 100, 0, 30, 30);
    const more = [sketch('SC', b.sketch), extrude('C', 'SC', b.sketch, '20 mm')];
    const both = ok(await run(testDocument([...features, ...more])));
    const topC = refTo(both, 'face', 'extrude:C:cap:end');
    expect(
      await messageOf(
        shell('S', [top], '2 mm', { walls: [{ faces: [topC], thickness: '4 mm' }] }),
        more,
      ),
    ).toMatch(/^Wall set 1 has a face of a body this shell doesn't hollow/);
  });

  it('a wall set needs a thickness above zero', async () => {
    const { features, top, bottom } = await withBlock();
    const inputs = shellInputs([top], '2 mm', { walls: [{ faces: [bottom], thickness: '0 mm' }] });
    const zero: Feature = { ...testFeature('S', 'shell'), inputs };
    expect(status(await run(testDocument([...features, zero])), 'S').message).toBe(
      "Wall set 1's thickness is 0 mm. Enter a thickness greater than 0.",
    );
    const without = Object.fromEntries(
      Object.entries(inputs).filter(([key]) => key !== 'wallThickness'),
    ) as typeof inputs;
    const missing: Feature = { ...testFeature('S', 'shell'), inputs: without };
    expect(status(await run(testDocument([...features, missing])), 'S').message).toBe(
      'Wall set 1 has faces but no thickness. Enter its thickness.',
    );
  });

  it('walls too thick say how far every thickness has to shrink', async () => {
    const { features, top, bottom } = await withBlock();
    const failed = await run(
      testDocument([
        ...features,
        shell('S', [top], '2 mm', { walls: [{ faces: [bottom], thickness: '25 mm' }] }),
      ]),
    );
    const st = status(failed, 'S');
    expect(st.status).toBe('error');
    // The floor may take a little under 20 mm, so everything scales by about 0.79.
    expect(st.message).toMatch(
      /^Walls of 2 mm, 25 mm are too thick for this body \(max ≈ 1\.\d+ mm, 19 mm, all scaled together\)\. Try thinner walls\.$/,
    );
  });

  it('a body whose smooth chain has a sharp edge inside is refused before OCCT runs', async () => {
    const { features, first, lines } = await roundedBlock('top');
    const bottom = refTo(first, 'face', floor);
    const front = refTo(first, 'face', side(lines.bottom));
    const failed = await run(
      testDocument([
        ...features,
        shell('S', [bottom], '2 mm', { walls: [{ faces: [front], thickness: '3 mm' }] }),
      ]),
    );
    expect(status(failed, 'S').message).toMatch(
      /^This body has rounded edges that meet at a sharp corner/,
    );
  });

  it('faces that run into each other take one thickness', async () => {
    const { features, first, lines } = await roundedBlock('vertical');
    const top = refTo(first, 'face', cap);
    const front = refTo(first, 'face', side(lines.bottom));
    const right = refTo(first, 'face', side(lines.right));
    const failed = await run(
      testDocument([
        ...features,
        shell('S', [top], '2 mm', {
          walls: [
            { faces: [front], thickness: '3 mm' },
            { faces: [right], thickness: '2.5 mm' },
          ],
        }),
      ]),
    );
    expect(status(failed, 'S').message).toMatch(
      /^Face \d+ runs smoothly into a face with another wall thickness/,
    );
  });
});
