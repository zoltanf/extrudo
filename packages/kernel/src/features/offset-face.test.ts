// The Offset Face feature (P3-08, ADR-0051) through the recompute engine with
// real OCCT: planar faces pulled out and pushed in, a cylinder's wall (a
// radius change), faces that run smoothly into each other moving together,
// faces keeping their names (a fillet after an offset survives the distance
// changing), several bodies, lost references, and the messages of offsets that
// can't be built with the largest distance that works (FR-UX-06).
// `golden/offset-face-options.json` is a golden table of cases (a Vitest file
// snapshot); rewrite it with `pnpm vitest run -u packages/kernel/src/features/offset-face`
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
  offsetFaceInputs,
  originPlaneRef,
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

function offset(id: string, faces: GeomRef[], distance: string): Feature {
  return { ...testFeature(id, 'offsetFace'), inputs: offsetFaceInputs(faces, distance) };
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
  const { volume, bbox } = kernel.measure(shape);
  return {
    volume,
    bbox: [...bbox.min, ...bbox.max].map((x) => round(x, 2)),
    faces: kernel.count(shape, 'face'),
    valid: kernel.isValid(shape),
  };
}

const round = (x: number, digits = 3) => {
  const r = Number(x.toFixed(digits));
  return Object.is(r, -0) ? 0 : r;
};

const faceNames = (result: Done, body = 0) => result.bodies[body]?.mesh?.faceIds ?? [];

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

/** A cylinder of radius 10 and height 20 (body `B:0`). */
function cylinder() {
  const b = new SketchBuilder();
  const c = b.circle(0, 0, 10);
  return {
    wall: `extrude:B:side:${c.id}`,
    features: [sketch('SB', b.sketch), extrude('B', 'SB', b.sketch, '20 mm')],
  };
}

const cap = 'extrude:B:cap:end';
const floor = 'extrude:B:cap:start';
const side = (line: string) => `extrude:B:side:${line}`;
const between = (a: string, b: string) => edgeName([a, b]);

async function withBlock() {
  const base = block();
  const first = ok(await run(testDocument(base.features)));
  return {
    base,
    top: refTo(first, 'face', cap),
    bottom: refTo(first, 'face', floor),
    front: refTo(first, 'face', side(base.lines.bottom)),
    right: refTo(first, 'face', side(base.lines.right)),
  };
}

describe('offset face', { timeout: 120_000 }, () => {
  it('pulls the top face out and pushes it in, and every face keeps its name', async () => {
    const { base, top } = await withBlock();
    const before = faceNames(ok(await run(testDocument(base.features))));
    const out = ok(
      await runWithShapes(testDocument([...base.features, offset('O', [top], '5 mm')])),
    );
    let m = measure('B:0');
    expect(m.valid).toBe(true);
    expect(m.faces).toBe(6);
    expect(m.volume).toBeCloseTo(BOX_VOLUME + 5 * BOX.w * BOX.d, 2);
    expect(m.bbox).toEqual([0, 0, 0, BOX.w, BOX.d, BOX.h + 5]);
    expect([...faceNames(out)].sort()).toEqual([...before].sort());
    const inward = ok(
      await runWithShapes(testDocument([...base.features, offset('O', [top], '-5 mm')])),
    );
    m = measure('B:0');
    expect(m.volume).toBeCloseTo(BOX_VOLUME - 5 * BOX.w * BOX.d, 2);
    expect(m.bbox).toEqual([0, 0, 0, BOX.w, BOX.d, BOX.h - 5]);
    expect([...faceNames(inward)].sort()).toEqual([...before].sort());
  });

  it('moves a side face along its outward normal, and two faces at once', async () => {
    const { base, front, right, top } = await withBlock();
    ok(await runWithShapes(testDocument([...base.features, offset('O', [front], '4 mm')])));
    // The front face looks along -Y: growing it takes the body's y from 0 to -4.
    expect(measure('B:0').bbox).toEqual([0, -4, 0, BOX.w, BOX.d, BOX.h]);
    ok(await runWithShapes(testDocument([...base.features, offset('O', [right, top], '3 mm')])));
    expect(measure('B:0').bbox).toEqual([0, 0, 0, BOX.w + 3, BOX.d, BOX.h + 3]);
  });

  it('changes the radius of a cylinder’s wall, and a hole’s wall closes in when it grows', async () => {
    const c = cylinder();
    const first = ok(await run(testDocument(c.features)));
    const wall = refTo(first, 'face', c.wall);
    ok(await runWithShapes(testDocument([...c.features, offset('O', [wall], '3 mm')])));
    let m = measure('B:0');
    expect(m.valid).toBe(true);
    expect(m.volume).toBeCloseTo(Math.PI * 13 * 13 * 20, 1);
    // The box round a curved body is a little loose.
    expect(m.bbox.map((v) => Math.round(v) + 0)).toEqual([-13, -13, 0, 13, 13, 20]);
    ok(await runWithShapes(testDocument([...c.features, offset('O', [wall], '-4 mm')])));
    m = measure('B:0');
    expect(m.volume).toBeCloseTo(Math.PI * 6 * 6 * 20, 1);
  });

  it('keeps the faces findable: a fillet on an edge of the offset face survives a change of distance', async () => {
    const { base, top } = await withBlock();
    const first = ok(await run(testDocument([...base.features, offset('O', [top], '5 mm')])));
    const rim = between(cap, side(base.lines.bottom));
    const fillet: Feature = {
      ...testFeature('R', 'fillet'),
      inputs: filletInputs([{ edges: [refTo(first, 'edge', rim)], radius: '2 mm' }]),
    };
    ok(await run(testDocument([...base.features, offset('O', [top], '5 mm'), fillet])));
    const more = ok(
      await run(testDocument([...base.features, offset('O', [top], '12 mm'), fillet])),
    );
    expect(faceNames(more).some((n) => n.startsWith('fillet:R:'))).toBe(true);
    const less = ok(
      await run(testDocument([...base.features, offset('O', [top], '-8 mm'), fillet])),
    );
    expect(faceNames(less).some((n) => n.startsWith('fillet:R:'))).toBe(true);
  });

  it('moves the faces that run smoothly into a picked face along with it', async () => {
    // A cylinder with its top edge rounded: the top, the rounded band and the wall are one
    // smooth chain. Pulling the top 2 mm out grows the whole pad, radius and height; the
    // floor, which meets the wall at a crease, stays.
    const c = cylinder();
    const first = ok(await run(testDocument(c.features)));
    const round: Feature = {
      ...testFeature('R', 'fillet'),
      inputs: filletInputs([
        { edges: [refTo(first, 'edge', between(cap, c.wall))], radius: '3 mm' },
      ]),
    };
    const rounded = ok(await run(testDocument([...c.features, round])));
    const top = refTo(rounded, 'face', cap);
    const result = ok(
      await runWithShapes(testDocument([...c.features, round, offset('O', [top], '2 mm')])),
    );
    expect(measure('B:0')).toMatchObject({ valid: true, faces: 4 });
    expect(measure('B:0').bbox.map((v) => Math.round(v) + 0)).toEqual([-12, -12, 0, 12, 12, 22]);
    expect(faceNames(result).filter((n) => n.startsWith('fillet:R:'))).toHaveLength(1);
    // The kernel says which faces move together, and the floor stands alone.
    const shape = bodyShapes.get('B:0') as ShapeHandle;
    expect(kernel.tangentFaces(shape, faceNames(result).indexOf(cap))).toHaveLength(3);
    expect(kernel.tangentFaces(shape, faceNames(result).indexOf(floor))).toHaveLength(1);
  });

  it('refuses a body whose rounded edges meet at a sharp corner, before OCCT can trap on it', async () => {
    const base = block();
    const first = ok(await run(testDocument(base.features)));
    const l = base.lines;
    // Three top edges rounded: two corners where fillets meet with no blend between them.
    const edges = [l.bottom, l.right, l.top].map((line) =>
      refTo(first, 'edge', between(cap, side(line))),
    );
    const round: Feature = {
      ...testFeature('R', 'fillet'),
      inputs: filletInputs([{ edges, radius: '3 mm' }]),
    };
    const rounded = ok(await run(testDocument([...base.features, round])));
    for (const face of [cap, floor]) {
      const failed = await run(
        testDocument([
          ...base.features,
          round,
          offset('O', [refTo(rounded, 'face', face)], '2 mm'),
        ]),
      );
      expect(status(failed, 'O').status).toBe('error');
      expect(status(failed, 'O').message).toMatch(/rounded edges that meet at a sharp corner/);
    }
  });

  it('offsets faces of several bodies, each on its own', async () => {
    const one = block();
    const b = new SketchBuilder();
    rect(b, 100, 0, 30, 30);
    const features = [
      ...one.features,
      sketch('SC', b.sketch),
      extrude('C', 'SC', b.sketch, '20 mm'),
    ];
    const first = ok(await run(testDocument(features)));
    const topB = refTo(first, 'face', cap);
    const topC = refTo(first, 'face', 'extrude:C:cap:end');
    ok(await runWithShapes(testDocument([...features, offset('O', [topB, topC], '5 mm')])));
    expect(measure('B:0').bbox[5]).toBe(25);
    expect(measure('C:0').bbox[5]).toBe(25);
  });

  it('too far says how far it may go, and that maximum works', async () => {
    const { base, top } = await withBlock();
    const failed = await run(testDocument([...base.features, offset('O', [top], '-25 mm')]));
    const st = status(failed, 'O');
    expect(st.status).toBe('error');
    const match =
      /can't move in by 25 mm: that is too far for this body \(max ≈ ([\d.]+) mm\)\./.exec(
        st.message ?? '',
      );
    expect(match, st.message).not.toBeNull();
    const max = Number(match?.[1]);
    // The block is 20 mm high: the top can go down almost all the way.
    expect(max).toBeGreaterThanOrEqual(18);
    expect(max).toBeLessThan(20);
    const again = await run(testDocument([...base.features, offset('O', [top], `-${max} mm`)]));
    expect(status(again, 'O').status).toBe('ok');
    // Pulling out has no such limit.
    const out = await run(testDocument([...base.features, offset('O', [top], '500 mm')]));
    expect(status(out, 'O').status).toBe('ok');
  });

  it('a wall pushed past the axis is refused, not built inside out', async () => {
    // OCCT itself gives a valid junk cylinder of radius 2 for this.
    const c = cylinder();
    const first = ok(await run(testDocument(c.features)));
    const wall = refTo(first, 'face', c.wall);
    const failed = await run(testDocument([...c.features, offset('O', [wall], '-12 mm')]));
    expect(status(failed, 'O').message).toMatch(/too far for this body \(max ≈ (9\.\d|10)/);
  });

  it('a solid with a sealed void is refused with a reason', async () => {
    const { base, top } = await withBlock();
    const hollow: Feature = {
      ...testFeature('H', 'shell'),
      inputs: shellInputs([], '2 mm', { bodies: ['B:0'] }),
    };
    const failed = await run(testDocument([...base.features, hollow, offset('O', [top], '1 mm')]));
    const st = status(failed, 'O');
    expect(st.status).toBe('error');
    expect(st.message).toMatch(/sealed cavity inside/);
  });

  it('asks for a face and a distance other than zero, and for faces that exist', async () => {
    const { base, top } = await withBlock();
    const messageOf = async (feature: Feature) =>
      status(await run(testDocument([...base.features, feature])), 'O').message;
    expect(await messageOf(offset('O', [], '2 mm'))).toBe('Pick a face to offset.');
    expect(await messageOf(offset('O', [top], '0 mm'))).toBe(
      'The offset distance is 0 mm, so nothing moves. Enter a distance other than 0.',
    );
  });

  it('a lost face is a lost reference the timeline can fix', async () => {
    const base = block();
    const gone: GeomRef = { kind: 'face', id: 'extrude:B:cap:nowhere' };
    const result = await run(testDocument([...base.features, offset('O', [gone], '1 mm')]));
    const st = status(result, 'O');
    expect(st.status).toBe('error');
    expect(st.message).toMatch(/Can't find a face to offset any more/);
    expect(st.refs).toEqual([{ ref: { kind: 'face', id: gone.id }, state: 'lost' }]);
  });

  it('golden table of cases', async () => {
    const { base, top, bottom, front, right } = await withBlock();
    const c = cylinder();
    const cFirst = ok(await run(testDocument(c.features)));
    const wall = refTo(cFirst, 'face', c.wall);
    const cTop = refTo(cFirst, 'face', cap);
    type Case = { features: Feature[]; faces: GeomRef[]; distance: string };
    const cases: Record<string, Case> = {
      'top +5': { features: base.features, faces: [top], distance: '5 mm' },
      'top -5': { features: base.features, faces: [top], distance: '-5 mm' },
      'top -19': { features: base.features, faces: [top], distance: '-19 mm' },
      'top -20 (nothing left)': { features: base.features, faces: [top], distance: '-20 mm' },
      'top -25 too far': { features: base.features, faces: [top], distance: '-25 mm' },
      'bottom +3': { features: base.features, faces: [bottom], distance: '3 mm' },
      'front +4': { features: base.features, faces: [front], distance: '4 mm' },
      'front -10': { features: base.features, faces: [front], distance: '-10 mm' },
      'right and top +2': { features: base.features, faces: [right, top], distance: '2 mm' },
      'cylinder wall +3': { features: c.features, faces: [wall], distance: '3 mm' },
      'cylinder wall -9': { features: c.features, faces: [wall], distance: '-9 mm' },
      'cylinder wall -12 too far': { features: c.features, faces: [wall], distance: '-12 mm' },
      'cylinder top +6': { features: c.features, faces: [cTop], distance: '6 mm' },
    };
    const table: Record<string, unknown> = {};
    for (const [key, one] of Object.entries(cases)) {
      const result = await runWithShapes(
        testDocument([...one.features, offset('O', one.faces, one.distance)]),
      );
      const st = status(result, 'O');
      if (st.status === 'error') {
        table[key] = { error: st.message };
        continue;
      }
      const m = measure('B:0');
      table[key] = {
        volume: round(m.volume, 2),
        bbox: m.bbox,
        faces: m.faces,
        valid: m.valid,
        names: [...faceNames(result)].sort(),
      };
    }
    await expect(`${JSON.stringify(table, null, 1)}\n`).toMatchFileSnapshot(
      './golden/offset-face-options.json',
    );
  });
});
