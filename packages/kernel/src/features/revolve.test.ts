// The revolve feature (P2-07, ADR-0029) through the recompute engine with
// real OCCT: every axis kind of FR-FT-02, full and partial turns, the
// directions, the names it gives (ADR-0005), its errors and warnings.
// `golden/revolve-options.json` is the golden table of every direction ×
// operation × angle combination (a Vitest file snapshot); rewrite it with
// `pnpm vitest run -u packages/kernel/src/features/revolve` and review the diff.
import {
  type ExtrudoDocument,
  extrudeInputs,
  type Feature,
  type FeatureId,
  FeatureRegistry,
  type FeatureStatus,
  type GeomRef,
  originAxisRef,
  originPlaneRef,
  type RevolveDirection,
  type RevolveInputOptions,
  type RevolveOperation,
  revolveInputs,
  type SketchData,
  sketchInputs,
} from '@extrudo/core';
import { SketchBuilder } from '@extrudo/sketch/fixtures';
import { detectProfiles, type Profile, profileCentroid } from '@extrudo/sketch/profiles';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { SubShapeKind } from '../history';
import { Kernel, type ShapeHandle } from '../kernel';
import { loadOcct } from '../occt/load';
import { RecomputeEngine } from '../recompute/engine';
import { testDocument, testFeature, testFeatures } from '../recompute/testing';
import type { FeatureOutput, KernelFeatureDefinition, RecomputeResult } from '../recompute/types';
import type { RevolveOutputData } from './revolve';

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
type Plane = 'origin:xy' | 'origin:xz' | 'origin:yz';

// ------------------------------------------------------------------ helpers

function rect(b: SketchBuilder, x: number, y: number, w: number, h: number): string[] {
  return [
    b.line(x, y, x + w, y).id,
    b.line(x + w, y, x + w, y + h).id,
    b.line(x + w, y + h, x, y + h).id,
    b.line(x, y + h, x, y).id,
  ];
}

function sketch(id: string, data: SketchData, plane: Plane = 'origin:xy'): Feature {
  return { ...testFeature(id, 'sketch'), inputs: sketchInputs(originPlaneRef(plane), data) };
}

/** A profile of `data` as a reference: the largest, or the one `pick` chooses. */
function profile(
  sketchId: string,
  data: SketchData,
  pick: (profiles: Profile[]) => Profile | undefined = (p) => p[0],
): GeomRef {
  const found = pick(detectProfiles(data).sort((a, b) => b.area - a.area));
  if (!found) throw new Error('no profile');
  return { kind: 'profile', id: `${sketchId}/${found.id}` };
}

const near =
  (x: number, y: number) =>
  (profiles: Profile[]): Profile | undefined =>
    [...profiles].sort((a, b) => dist(a, x, y) - dist(b, x, y))[0];
const dist = (p: Profile, x: number, y: number) => {
  const [cx, cy] = profileCentroid(p);
  return Math.hypot(cx - x, cy - y);
};

const line = (sketchId: string, entity: string): GeomRef => ({
  kind: 'sketchEntity',
  id: `${sketchId}/${entity}`,
});

function revolve(
  id: string,
  profiles: GeomRef[],
  axis: GeomRef | undefined,
  options: RevolveInputOptions = {},
): Feature {
  return { ...testFeature(id, 'revolve'), inputs: revolveInputs(profiles, axis, options) };
}

function extrude(id: string, profiles: GeomRef[], distance: string, symmetric = false): Feature {
  return {
    ...testFeature(id, 'extrude'),
    inputs: extrudeInputs(profiles, { distance, ...(symmetric && { direction: 'symmetric' }) }),
  };
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

async function outputData(doc: ExtrudoDocument): Promise<RevolveOutputData> {
  ok(await fresh(doc));
  const data = seen.get('V')?.data as RevolveOutputData | undefined;
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

// ------------------------------------------------------------------ scenes

/** A 3 × 4 rectangle from x = 5 on XY, beside the Y axis: a ring of radii 5 and 8 when turned. */
function ringProfile(id = 'S') {
  const b = new SketchBuilder();
  const lines = rect(b, 5, 0, 3, 4);
  return { data: b.sketch, lines, feature: sketch(id, b.sketch) };
}

/** The ring's volume for a turn of `degrees`. */
const ring = (degrees: number) => ((Math.PI * (64 - 25) * 4) / 360) * degrees;

/** A 40 × 30 block from z = −10 to 10 (body `B:0`), from a rectangle on XY. */
function block() {
  const b = new SketchBuilder();
  const [bottom, right, top, left] = rect(b, 0, 0, 40, 30) as [string, string, string, string];
  const data = b.sketch;
  return {
    data,
    lines: { bottom, right, top, left },
    features: [sketch('SB', data), extrude('B', [profile('SB', data)], '20 mm', true)],
  };
}

describe('revolve', { timeout: 120_000 }, () => {
  it('a full turn about an origin axis: a ring with no caps, a face per curve', async () => {
    const p = ringProfile();
    const result = ok(
      await runWithShapes(
        testDocument([p.feature, revolve('V', [profile('S', p.data)], originAxisRef('origin:y'))]),
      ),
    );
    expect(result.bodies.map((b) => b.id)).toEqual(['V:0']);
    const m = measure(result, 'V:0');
    close(m.volume, ring(360));
    expect(m.valid).toBe(true);
    expect(box(m.bbox)).toEqual([-8, 0, -8, 8, 4, 8]);
    expect([...m.names].sort()).toEqual(p.lines.map((l) => `revolve:V:side:${l}`).sort());
    const data = await outputData(
      testDocument([p.feature, revolve('V', [profile('S', p.data)], originAxisRef('origin:y'))]),
    );
    expect(data).toMatchObject({ full: true, angles: [360, 0] });
    expect(data.origin.map((v) => round(v))).toEqual([6.5, 2, 0]);
    expect(data.axis.direction).toEqual([0, 1, 0]);
  });

  it('partial turns: caps where it starts and ends, the angle and flip set the way round', async () => {
    const p = ringProfile();
    const y = originAxisRef('origin:y');
    // About +Y, a positive angle turns +X towards −Z.
    for (const [options, zMin, zMax, angles] of [
      [{ angle: '90 deg' }, -8, 0, [90, 0]],
      [{ angle: '-90 deg' }, 0, 8, [-90, 0]],
      [{ angle: '90 deg', flip: true }, 0, 8, [90, 0]],
      [{ angle: '90 deg', direction: 'symmetric' }, -5.66, 5.66, [45, 45]],
      [{ angle: '90 deg', direction: 'two-sides', angle2: '30 deg' }, -8, 4, [90, 30]],
    ] as [RevolveInputOptions, number, number, [number, number]][]) {
      const doc = testDocument([p.feature, revolve('V', [profile('S', p.data)], y, options)]);
      const result = ok(await runWithShapes(doc));
      const m = measure(result, 'V:0');
      const total = Math.abs(angles[0]) + angles[1];
      close(m.volume, ring(total));
      expect(m.valid, JSON.stringify(options)).toBe(true);
      expect(m.solids).toBe(1);
      expect(Math.abs((m.bbox.min[2] as number) - zMin)).toBeLessThan(0.05);
      expect(Math.abs((m.bbox.max[2] as number) - zMax)).toBeLessThan(0.05);
      expect([...m.names].sort()).toEqual(
        [
          'revolve:V:cap:end',
          'revolve:V:cap:start',
          ...p.lines.map((l) => `revolve:V:side:${l}`),
        ].sort(),
      );
      const data = await outputData(doc);
      expect(data.angles).toEqual(angles);
      expect(data.full).toBe(false);
      expect(data.axis.direction.map((v) => round(v))).toEqual(
        options.flip ? [0, -1, 0] : [0, 1, 0],
      );
    }
  });

  it('a profile with an edge on the axis makes a solid of revolution (a cylinder, a cone)', async () => {
    const b = new SketchBuilder();
    const base = b.line(0, 0, 5, 0).id;
    const slant = b.line(5, 0, 0, 6).id;
    b.line(0, 6, 0, 0); // on the Y axis: sweeps into nothing
    const cone = ok(
      await runWithShapes(
        testDocument([
          sketch('S', b.sketch),
          revolve('V', [profile('S', b.sketch)], originAxisRef('origin:y')),
        ]),
      ),
    );
    const m = measure(cone, 'V:0');
    close(m.volume, (Math.PI * 25 * 6) / 3);
    expect([...m.names].sort()).toEqual(
      [`revolve:V:side:${base}`, `revolve:V:side:${slant}`].sort(),
    );
    const half = ok(
      await runWithShapes(
        testDocument([
          sketch('S', b.sketch),
          revolve('V', [profile('S', b.sketch)], originAxisRef('origin:y'), { angle: '180 deg' }),
        ]),
      ),
    );
    close(measure(half, 'V:0').volume, (Math.PI * 25 * 6) / 6);
    expect(measure(half, 'V:0').valid).toBe(true);
  });

  it('turns about a sketch line, construction or not, from its start to its end', async () => {
    // A construction line at x = 2 from (2, 0) to (2, 10): the rectangle from x = 5 is 3 to 6 from it.
    const b = new SketchBuilder();
    rect(b, 5, 0, 3, 4);
    const axis = b.line(2, 0, 2, 10, true).id;
    const down = b.line(-20, 10, -20, 0).id; // the other way round
    const data = b.sketch;
    const doc = (a: GeomRef, options: RevolveInputOptions = {}) =>
      testDocument([sketch('S', data), revolve('V', [profile('S', data)], a, options)]);
    const full = ok(await runWithShapes(doc(line('S', axis))));
    const m = measure(full, 'V:0');
    close(m.volume, Math.PI * (36 - 9) * 4);
    expect(box(m.bbox)).toEqual([-4, 0, -6, 8, 4, 6]);
    const data1 = await outputData(doc(line('S', axis), { angle: '90 deg' }));
    expect(data1.axis.origin).toEqual([2, 0, 0]);
    expect(data1.axis.direction).toEqual([0, 1, 0]);
    // A line drawn downwards turns the other way.
    const quarter = ok(await runWithShapes(doc(line('S', axis), { angle: '90 deg' })));
    expect(measure(quarter, 'V:0').bbox.max[2]).toBeLessThan(0.05);
    const other = await outputData(doc(line('S', down), { angle: '90 deg' }));
    expect(other.axis.direction.map((v) => round(v))).toEqual([0, -1, 0]);

    // A sketch on XZ turned about a line of another sketch: placed by its sketch's frame.
    const xz = new SketchBuilder();
    rect(xz, 5, 0, 3, 4); // x 5..8, z 0..4 at y = 0
    const onXy = new SketchBuilder();
    const xLine = onXy.line(-10, 0, 10, 0, true).id; // the world X axis
    const across = ok(
      await runWithShapes(
        testDocument([
          sketch('A', onXy.sketch),
          sketch('S', xz.sketch, 'origin:xz'),
          revolve('V', [profile('S', xz.sketch)], line('A', xLine)),
        ]),
      ),
    );
    const n = measure(across, 'V:0');
    close(n.volume, 3 * Math.PI * 16);
    expect(box(n.bbox)).toEqual([5, -4, -4, 8, 4, 4]);
  });

  it('turns about a straight edge of a body, and turns a flat face (join)', async () => {
    const base = block();
    const first = ok(await run(testDocument(base.features)));
    // The block's top front edge: along X at y = 0, z = 10, in the XZ plane.
    const edgeName = `e[extrude:B:cap:end|extrude:B:side:${base.lines.bottom}]`;
    const edge = refTo(first, 'edge', edgeName);
    const s = new SketchBuilder();
    rect(s, 0, 12, 10, 4); // x 0..10, z 12..16: 2 to 6 mm above the edge
    const result = ok(
      await runWithShapes(
        testDocument([
          ...base.features,
          sketch('S', s.sketch, 'origin:xz'),
          revolve('V', [profile('S', s.sketch)], edge, { angle: '90 deg' }),
        ]),
      ),
    );
    expect(result.bodies.map((b) => b.id)).toEqual(['B:0', 'V:0']);
    close(measure(result, 'V:0').volume, (Math.PI * (36 - 4) * 10) / 4);

    // The top face turned about that edge, up out of the block: a quarter cylinder joined on.
    const top = refTo(first, 'face', 'extrude:B:cap:end');
    for (const angle of ['90 deg', '-90 deg']) {
      const joined = ok(
        await runWithShapes(
          testDocument([...base.features, revolve('V', [top], edge, { angle, operation: 'join' })]),
        ),
      );
      expect(joined.bodies.map((b) => b.id)).toEqual(['B:0']);
      const m = measure(joined, 'B:0');
      expect(m.valid).toBe(true);
      // Up: a quarter cylinder of radius 30 and length 40 on top. Down it turns into
      // the block, and only the part below its bottom (10 mm under it) adds: half a
      // circular segment of radius 30, 20 from the centre, 40 long.
      const up = m.bbox.max[2] > 11;
      const segment = 900 * Math.acos(20 / 30) - 20 * Math.sqrt(900 - 400);
      expect(up).toBe(angle === '90 deg');
      close(m.volume, 40 * 30 * 20 + (up ? (Math.PI * 900 * 40) / 4 : (segment / 2) * 40));
    }
  });

  it('joins, cuts and intersects the bodies it touches, and offers the tool for previews', async () => {
    const base = block();
    // A 10 × 10 square on XZ from x = 10, z = 5: half in the block, turned about Z into it.
    const s = new SketchBuilder();
    rect(s, 10, 5, 10, 10);
    const groove = [...base.features, sketch('S', s.sketch, 'origin:xz')];
    const cut = ok(
      await runWithShapes(
        testDocument([
          ...groove,
          revolve('V', [profile('S', s.sketch)], originAxisRef('origin:z'), {
            angle: '90 deg',
            operation: 'cut',
          }),
        ]),
      ),
    );
    const quarterRing = (Math.PI * (400 - 100) * 5) / 4; // the part inside the block (z 5..10)
    close(measure(cut, 'B:0').volume, 40 * 30 * 20 - quarterRing);
    expect(seen.get('V')?.previewTools?.map((t) => t.style)).toEqual(['cut']);
    const join = ok(
      await runWithShapes(
        testDocument([
          ...groove,
          revolve('V', [profile('S', s.sketch)], originAxisRef('origin:z'), {
            angle: '90 deg',
            operation: 'join',
          }),
        ]),
      ),
    );
    close(measure(join, 'B:0').volume, 40 * 30 * 20 + quarterRing);
    const intersect = ok(
      await runWithShapes(
        testDocument([
          ...groove,
          revolve('V', [profile('S', s.sketch)], originAxisRef('origin:z'), {
            angle: '90 deg',
            operation: 'intersect',
          }),
        ]),
      ),
    );
    close(measure(intersect, 'B:0').volume, quarterRing);
    // Turned the other way it only touches the block's front face.
    const missed = await run(
      testDocument([
        ...groove,
        revolve('V', [profile('S', s.sketch)], originAxisRef('origin:z'), {
          angle: '-90 deg',
          operation: 'cut',
        }),
      ]),
    );
    expect(status(missed, 'V')).toEqual({
      status: 'error',
      message: "The cut doesn't remove anything. Check its axis and angle.",
    });
    const alone = await run(
      testDocument([
        ringProfile().feature,
        revolve('V', [profile('S', ringProfile().data)], originAxisRef('origin:y'), {
          operation: 'join',
        }),
      ]),
    );
    expect(status(alone, 'V')).toEqual({
      status: 'warning',
      message: 'Nothing to join to, so the revolve made a new body.',
    });
  });

  it('revolves several profiles at once, on one side of the axis', async () => {
    const b = new SketchBuilder();
    rect(b, 5, 0, 3, 4);
    b.circle(20, 10, 2);
    const data = b.sketch;
    const result = ok(
      await runWithShapes(
        testDocument([
          sketch('S', data),
          revolve(
            'V',
            [profile('S', data, near(6.5, 2)), profile('S', data, near(20, 10))],
            originAxisRef('origin:y'),
            { angle: '90 deg', direction: 'symmetric' },
          ),
        ]),
      ),
    );
    expect(result.bodies).toHaveLength(2);
    const volumes = result.bodies
      .map((body) => measure(result, body.id).volume)
      .sort((a, c) => a - c);
    close(volumes[0] as number, ring(90));
    close(volumes[1] as number, (2 * Math.PI * 20 * Math.PI * 4) / 4); // Pappus: a quarter torus
  });

  it('tells the user what is wrong', async () => {
    const p = ringProfile();
    const pick = profile('S', p.data);
    const y = originAxisRef('origin:y');
    const crossing = new SketchBuilder();
    rect(crossing, -2, 0, 5, 4);
    const both = new SketchBuilder();
    rect(both, 5, 0, 3, 4);
    rect(both, -8, 0, 3, 4);
    const curves = new SketchBuilder();
    const circle = curves.circle(-10, -10, 1).id;
    const cases: [Feature[], string][] = [
      [[p.feature, revolve('V', [], y)], 'Pick at least one profile or face to revolve.'],
      [[p.feature, revolve('V', [pick], undefined)], 'Pick an axis to revolve about.'],
      [
        [p.feature, revolve('V', [pick], originAxisRef('origin:z'))],
        "The axis doesn't lie in the profile's plane. Pick an axis in that plane.",
      ],
      [
        [sketch('C', crossing.sketch), revolve('V', [profile('C', crossing.sketch)], y)],
        'The profile crosses the axis. Pick an axis beside the profile, not through it.',
      ],
      [
        [
          sketch('C', both.sketch),
          revolve(
            'V',
            [profile('C', both.sketch, near(6.5, 2)), profile('C', both.sketch, near(-6.5, 2))],
            y,
          ),
        ],
        'The profiles lie on both sides of the axis. Pick profiles on one side of it.',
      ],
      [
        [p.feature, revolve('V', [pick], y, { angle: '0 deg' })],
        'The angle is 0. Enter an angle other than 0.',
      ],
      [
        [p.feature, revolve('V', [pick], y, { angle: '400 deg' })],
        'The angle must be between -360° and 360°.',
      ],
      [
        [p.feature, revolve('V', [pick], y, { direction: 'symmetric', angle: '0 deg' })],
        'The angle is 0. Enter an angle other than 0.',
      ],
      [
        [
          p.feature,
          revolve('V', [pick], y, { direction: 'two-sides', angle: '30 deg', angle2: '-30 deg' }),
        ],
        'The two sides cancel each other out, so the revolve has no angle. Change an angle.',
      ],
      [
        [
          p.feature,
          revolve('V', [pick], y, { direction: 'two-sides', angle: '300 deg', angle2: '90 deg' }),
        ],
        'The two sides add up to more than a full turn. Make the angles smaller.',
      ],
      [
        [
          p.feature,
          revolve('V', [pick], y, { direction: 'two-sides', angle: '30 deg', angle2: '370 deg' }),
        ],
        'The angle of side 2 must be between -360° and 360°.',
      ],
      [
        [p.feature, revolve('V', [pick], { kind: 'axis', id: 'origin:w' })],
        "Can't find the axis to revolve about. Pick it again.",
      ],
      [
        [p.feature, revolve('V', [pick], line('S', 'gone'))],
        "Can't find the axis line any more: an earlier change to its sketch removed it. Edit the revolve and pick another axis.",
      ],
      [
        [p.feature, sketch('K', curves.sketch), revolve('V', [pick], line('K', circle))],
        "Can't find the axis line any more: an earlier change to its sketch removed it. Edit the revolve and pick another axis.",
      ],
      [
        [p.feature, revolve('V', [{ kind: 'profile', id: 'S/gone' }], y)],
        "Can't find one of its profiles any more: an earlier change to the sketch removed it. Edit the revolve and pick it again.",
      ],
      [
        [p.feature, revolve('V', [pick], y, { operation: 'cut', bodies: ['X:0'] })],
        'One of the bodies to cut no longer exists. Edit the revolve and pick the bodies again.',
      ],
    ];
    for (const [features, message] of cases) {
      const result = await run(testDocument(features));
      // Lost references are listed too (ADR-0033); the lost-reference tests check them.
      const { refs: _, ...plain } = status(result, 'V');
      expect(plain, message).toEqual({ status: 'error', message });
    }
    const lostAxis = await run(testDocument([p.feature, revolve('V', [pick], line('S', 'gone'))]));
    expect(status(lostAxis, 'V').refs).toEqual([
      { ref: { kind: 'sketchEntity', id: 'S/gone' }, state: 'lost' },
    ]);

    // A curved edge as the axis, a curved face to revolve.
    const c = new SketchBuilder();
    const rim = c.circle(10, 10, 5).id;
    const cylinder = [sketch('C', c.sketch), extrude('E', [profile('C', c.sketch)], '5 mm')];
    const first = ok(await run(testDocument(cylinder)));
    const circleEdge = refTo(first, 'edge', `e[extrude:E:cap:end|extrude:E:side:${rim}]`);
    const curved = await run(
      testDocument([...cylinder, p.feature, revolve('V', [pick], circleEdge)]),
    );
    expect(status(curved, 'V')).toEqual({
      status: 'error',
      message:
        'Can only revolve about a straight edge. Pick a straight edge, a sketch line or an origin axis.',
    });
    const side = refTo(first, 'face', `extrude:E:side:${rim}`);
    const face = await run(testDocument([...cylinder, revolve('V', [side], y)]));
    expect(status(face, 'V')).toEqual({
      status: 'error',
      message: 'Can only revolve flat faces. Pick a flat face or a sketch profile.',
    });
  });

  it('keeps its names when the angle changes, and references to its faces through edits', async () => {
    const p = ringProfile();
    const doc = (angle: string, extra: Feature[] = []) =>
      testDocument([
        p.feature,
        revolve('V', [profile('S', p.data)], originAxisRef('origin:y'), {
          angle,
          direction: 'symmetric',
        }),
        ...extra,
      ]);
    const quarter = ok(await run(doc('90 deg')));
    const wider = ok(await run(doc('150 deg')));
    expect(wider.bodies[0]?.mesh?.faceIds).toEqual(quarter.bodies[0]?.mesh?.faceIds);
    const edgeName = `e[revolve:V:cap:end|revolve:V:side:${p.lines[2]}]`;
    const edge = refTo(quarter, 'edge', edgeName);
    const fillet = testFeature(
      'F',
      'test-fillet',
      { radius: '0.5 mm' },
      { edges: { kind: 'ref', refs: [edge] } },
    );
    const filleted = ok(await run(doc('150 deg', [fillet])));
    expect(filleted.bodies[0]?.mesh?.faceIds).toContain(`fillet:F:from:(${edgeName})`);
  });

  it('golden table of every option combination', async () => {
    const base = block();
    // A 10 × 10 square on XZ from x = 10, z = 5, half in the block, turned about Z.
    const s = new SketchBuilder();
    rect(s, 10, 5, 10, 10);
    const features = [...base.features, sketch('S', s.sketch, 'origin:xz')];
    const pick = profile('S', s.sketch);
    const table: Record<string, unknown> = {};
    const directions: RevolveDirection[] = ['one-side', 'symmetric', 'two-sides'];
    const operations: RevolveOperation[] = ['new-body', 'join', 'cut', 'intersect'];
    for (const direction of directions) {
      for (const operation of operations) {
        for (const angle of ['90 deg', '-60 deg', '360 deg']) {
          const options: RevolveInputOptions = { direction, angle, angle2: '30 deg', operation };
          const key = `${direction} ${operation} angle ${angle}`;
          const result = await runWithShapes(
            testDocument([...features, revolve('V', [pick], originAxisRef('origin:z'), options)]),
          );
          const st = status(result, 'V');
          if (st.status === 'error') {
            table[key] = { error: st.message };
            continue;
          }
          table[key] = {
            ...(st.status === 'warning' ? { warning: st.message } : {}),
            bodies: Object.fromEntries(
              result.bodies.map((body) => {
                const m = measure(result, body.id);
                return [
                  body.id,
                  {
                    volume: round(m.volume, 2),
                    area: round(m.area, 2),
                    bbox: [...m.bbox.min, ...m.bbox.max].map((v) => round(v, 2)),
                    faces: m.faces,
                    edges: m.edges,
                    vertices: m.vertices,
                    valid: m.valid,
                    revolveFaces: m.names.filter((n) => n.includes(':V:')).sort(),
                  },
                ];
              }),
            ),
          };
        }
      }
    }
    await expect(`${JSON.stringify(table, null, 1)}\n`).toMatchFileSnapshot(
      './golden/revolve-options.json',
    );
  });
});
