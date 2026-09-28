// Sketches on faces and projected geometry (P2-09, FR-SK-01 faces, FR-SK-12,
// ADR-0031) through the recompute engine with real OCCT: the face frame
// follows the face, a lost or curved face fails, projections report where
// their sources are and follow them, and projected curves make profiles.
import {
  type ExtrudoDocument,
  extrudeInputs,
  type Feature,
  type FeatureId,
  FeatureRegistry,
  type GeomRef,
  newId,
  originPlaneRef,
  type ProjectionId,
  projectionSync,
  type SketchData,
  type SketchReport,
  sketchInputs,
} from '@extrudo/core';
import { SketchBuilder } from '@extrudo/sketch/fixtures';
import { detectProfiles } from '@extrudo/sketch/profiles';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { SubShapeKind } from '../history';
import { Kernel } from '../kernel';
import { loadOcct } from '../occt/load';
import { RecomputeEngine } from '../recompute/engine';
import { testDocument, testFeature, testFeatures } from '../recompute/testing';
import type { FeatureOutput, KernelFeatureDefinition, RecomputeResult } from '../recompute/types';
import type { SketchOutputData } from './sketch';

let kernel: Kernel;
let engine: RecomputeEngine;
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

const PLATE = 'S1';
const BOX = 'E';

/** A `width` × 40 rectangle on XY from the origin, extruded `height` up: a box. */
function box(height = 'h', width = 60): { features: Feature[]; data: SketchData } {
  const b = new SketchBuilder();
  b.line(0, 0, width, 0);
  b.line(width, 0, width, 40);
  b.line(width, 40, 0, 40);
  b.line(0, 40, 0, 0);
  const data = b.sketch;
  const profile = detectProfiles(data)[0];
  if (!profile) throw new Error('no profile');
  return {
    data,
    features: [
      { ...testFeature(PLATE, 'sketch'), inputs: sketchInputs(originPlaneRef('origin:xy'), data) },
      {
        ...testFeature(BOX, 'extrude'),
        inputs: extrudeInputs([{ kind: 'profile', id: `${PLATE}/${profile.id}` }], {
          distance: height,
        }),
      },
    ],
  };
}

/** A reference, with its fingerprint, to the sub-shape named `id` in the last recompute. */
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

function sketchOn(id: string, plane: GeomRef, data: SketchData): Feature {
  return { ...testFeature(id, 'sketch'), inputs: sketchInputs(plane, data) };
}

const report = (result: Done, id: string) => result.reports[id as FeatureId] as SketchReport;
function dataOf(id: string): SketchOutputData {
  const data = seen.get(id)?.data as SketchOutputData | undefined;
  if (!data) throw new Error(`no output of ${id}`);
  return data;
}
const frameOf = (id: string) => dataOf(id).frame;

describe('sketch on a face', () => {
  it('sits on the face in a frame that follows it, and a cut through it works', async () => {
    const { features } = box();
    const first = ok(await run(testDocument(features, { h: '15 mm' })));
    const top = refTo(first, 'face', `extrude:${BOX}:cap:end`);
    expect(top.fingerprint?.type).toBe('plane');

    const c = new SketchBuilder();
    c.circle(30, 20, 5);
    const hole = c.sketch;
    const holeProfile = detectProfiles(hole)[0];
    const cut: Feature = {
      ...testFeature('C', 'extrude'),
      inputs: extrudeInputs([{ kind: 'profile', id: `S2/${holeProfile?.id}` }], {
        distance: '-5 mm',
        operation: 'cut',
      }),
    };
    const doc = testDocument([...features, sketchOn('S2', top, hole), cut], { h: '15 mm' });
    const result = ok(await run(doc));
    expect(frameOf('S2')).toEqual({
      origin: [0, 0, 15],
      x: [1, 0, 0],
      y: [0, 1, 0],
      normal: [0, 0, 1],
    });
    expect(report(result, 'S2').frame).toEqual(frameOf('S2'));
    const body = result.bodies[0];
    expect(body?.mesh?.faceIds?.length).toBe(8);

    // A taller box: the sketch moves up with the top face; the hole stays 5 mm deep.
    const taller = ok(await run(testDocument(doc.features, { h: '25 mm' })));
    expect(frameOf('S2').origin).toEqual([0, 0, 25]);
    expect(report(taller, 'S2').frame.origin).toEqual([0, 0, 25]);
  });

  it('takes the Front view frame on a side face', async () => {
    const { features } = box();
    const first = ok(await run(testDocument(features, { h: '15 mm' })));
    // The side swept from the rectangle's bottom line (y = 0) faces −Y.
    const { data } = box();
    const bottomLine = Object.keys(data.entities).find((id) => id.startsWith('l')) as string;
    const side = refTo(first, 'face', `extrude:${BOX}:side:${bottomLine}`);
    const doc = testDocument([...features, sketchOn('S2', side, new SketchBuilder().sketch)], {
      h: '15 mm',
    });
    ok(await run(doc));
    expect(frameOf('S2')).toEqual({
      origin: [0, 0, 0],
      x: [1, 0, 0],
      y: [0, 0, 1],
      normal: [0, -1, 0],
    });
  });

  it('fails in plain words when the face is gone or not flat', async () => {
    const { features } = box();
    const lost = testDocument(
      [
        ...features,
        sketchOn('S2', { kind: 'face', id: 'extrude:nothing:cap:end' }, new SketchBuilder().sketch),
      ],
      { h: '15 mm' },
    );
    const result = await run(lost);
    expect(result.features['S2' as FeatureId]).toEqual({
      status: 'error',
      message: expect.stringMatching(/^Can't find the face to sketch on/),
      // The timeline's "fix references" reads which one (ADR-0033).
      refs: [{ ref: { kind: 'face', id: 'extrude:nothing:cap:end' }, state: 'lost' }],
    });

    // A cylinder's side isn't flat.
    const b = new SketchBuilder();
    const circle = b.circle(0, 0, 10).id;
    const data = b.sketch;
    const profile = detectProfiles(data)[0];
    const cylinder: Feature[] = [
      { ...testFeature('S1', 'sketch'), inputs: sketchInputs(originPlaneRef('origin:xy'), data) },
      {
        ...testFeature('E', 'extrude'),
        inputs: extrudeInputs([{ kind: 'profile', id: `S1/${profile?.id}` }], {
          distance: '10 mm',
        }),
      },
    ];
    const first = ok(await run(testDocument(cylinder)));
    const side = refTo(first, 'face', `extrude:E:side:${circle}`);
    const curved = await run(
      testDocument([...cylinder, sketchOn('S2', side, new SketchBuilder().sketch)]),
    );
    expect(curved.features['S2' as FeatureId]?.message).toMatch(/isn't flat/);
  });
});

describe('projection', () => {
  /** A sketch on XY that projects `refs` (projection IDs P0, P1…), with no curves yet. */
  function projecting(id: string, refs: GeomRef[], data?: SketchData): Feature {
    const sketch: SketchData = data ?? { entities: {}, constraints: {}, dimensions: {} };
    return sketchOn(id, originPlaneRef('origin:xy'), {
      ...sketch,
      projections: Object.fromEntries(refs.map((ref, i) => [`P${i}`, { ref, curves: {} }])),
    });
  }

  it('reports a face outline and a single edge, and follows them', async () => {
    const { features } = box();
    const first = ok(await run(testDocument(features, { h: '15 mm', w: '60 mm' })));
    const top = refTo(first, 'face', `extrude:${BOX}:cap:end`);
    const edge = refTo(
      first,
      'edge',
      first.bodies[0]?.mesh?.edgeIds?.find((e) => e.includes('cap:end')) as string,
    );
    const doc = testDocument([...features, projecting('S3', [top, edge])], { h: '15 mm' });
    const result = ok(await run(doc));
    const r = report(result, 'S3');
    const outline = r.projections?.['P0' as ProjectionId]?.curves ?? {};
    expect(Object.values(outline).map((c) => c.type)).toEqual(['line', 'line', 'line', 'line']);
    const xs = Object.values(outline).flatMap((c) => (c.type === 'line' ? [c.a[0], c.b[0]] : []));
    expect(Math.max(...xs)).toBe(60);
    expect(Object.keys(r.projections?.['P1' as ProjectionId]?.curves ?? {})).toEqual(['edge']);

    // A wider plate (the same sketch entities): the outline follows, under the same keys.
    const wider = box('h', 80).features;
    const next = report(
      ok(await run(testDocument([...wider, doc.features[2] as Feature], { h: '15 mm' }))),
      'S3',
    );
    const moved = next.projections?.['P0' as ProjectionId]?.curves ?? {};
    expect(Object.keys(moved).sort()).toEqual(Object.keys(outline).sort());
    const xs2 = Object.values(moved).flatMap((c) => (c.type === 'line' ? [c.a[0], c.b[0]] : []));
    expect(Math.max(...xs2)).toBe(80);
  });

  it('makes profiles from synced curves, which follow a change of the model', async () => {
    const b = new SketchBuilder();
    b.line(0, 0, 60, 0);
    b.line(60, 0, 60, 40);
    b.line(60, 40, 0, 40);
    b.line(0, 40, 0, 0);
    const data = b.sketch;
    // The same box, its width a parameter the sketch's lines don't know: project the top.
    const plate = sketchOn(PLATE, originPlaneRef('origin:xy'), data);
    const profile = detectProfiles(data)[0];
    const extrude: Feature = {
      ...testFeature(BOX, 'extrude'),
      inputs: extrudeInputs([{ kind: 'profile', id: `${PLATE}/${profile?.id}` }], {
        distance: 'h',
      }),
    };
    const first = ok(await run(testDocument([plate, extrude], { h: '15 mm' })));
    const top = refTo(first, 'face', `extrude:${BOX}:cap:end`);
    let s3 = projecting('S3', [top]);
    let doc = testDocument([plate, extrude, s3], { h: '15 mm' });
    let result = ok(await run(doc));

    // What the app does with the report (`syncProjections`): the curves become entities.
    const synced = (sketch: Feature, r: SketchReport): Feature => {
      const current = (sketch.inputs.sketch as { sketch: SketchData }).sketch;
      const change = projectionSync(current, r, () => newId());
      if (!change) return sketch;
      const entities = { ...current.entities };
      for (const id of change.remove) delete entities[id];
      Object.assign(entities, change.entities);
      for (const [id, p] of Object.entries(change.points)) {
        const e = entities[id as keyof typeof entities];
        if (e?.type === 'point') entities[id as keyof typeof entities] = { ...e, ...p };
      }
      const projections = { ...current.projections };
      for (const [pid, curves] of Object.entries(change.curves)) {
        const p = projections[pid as ProjectionId];
        if (p) projections[pid as ProjectionId] = { ...p, curves };
      }
      return sketchOn(sketch.id, originPlaneRef('origin:xy'), {
        ...current,
        entities,
        projections,
      });
    };
    s3 = synced(s3, report(result, 'S3'));
    doc = testDocument([plate, extrude, s3], { h: '15 mm' });
    result = ok(await run(doc));
    const profiles = dataOf('S3').profiles;
    expect(profiles.map((p) => Math.round(p.area))).toEqual([2400]);
    // Nothing more to sync.
    expect(
      projectionSync(
        (s3.inputs.sketch as { sketch: SketchData }).sketch,
        report(result, 'S3'),
        () => newId(),
      ),
    ).toBeUndefined();
  });

  it('includes a cylinder side seen from the side as its outline', async () => {
    const b = new SketchBuilder();
    const circle = b.circle(20, 0, 5).id;
    const data = b.sketch;
    const profile = detectProfiles(data)[0];
    const features: Feature[] = [
      { ...testFeature('S1', 'sketch'), inputs: sketchInputs(originPlaneRef('origin:xy'), data) },
      {
        ...testFeature('E', 'extrude'),
        inputs: extrudeInputs([{ kind: 'profile', id: `S1/${profile?.id}` }], {
          distance: '12 mm',
        }),
      },
    ];
    const first = ok(await run(testDocument(features)));
    const side = refTo(first, 'face', `extrude:E:side:${circle}`);
    const s3 = sketchOn('S3', originPlaneRef('origin:xz'), {
      entities: {},
      constraints: {},
      dimensions: {},
      projections: { P0: { ref: side, curves: {} } } as SketchData['projections'],
    });
    const result = ok(await run(testDocument([...features, s3])));
    const curves = report(result, 'S3').projections?.['P0' as ProjectionId]?.curves ?? {};
    const lines = Object.entries(curves).map(([key, c]) => {
      if (c.type !== 'line') throw new Error(`${key} is a ${c.type}`);
      const [a, z] = [c.a, c.b].sort((p, q) => p[0] - q[0] || p[1] - q[1]);
      return `${key.startsWith('sil:') ? 'sil' : 'edge'} ${a?.join(',')} ${z?.join(',')}`;
    });
    // The two circles seen edge-on (bottom and top) and two silhouettes, the seam left out.
    expect(lines.sort()).toEqual([
      'edge 15,0 25,0',
      'edge 15,12 25,12',
      'sil 15,0 15,12',
      'sil 25,0 25,12',
    ]);
  });

  it('warns and keeps its curves when the source is gone', async () => {
    const { features } = box();
    const doc = testDocument(
      [...features, projecting('S3', [{ kind: 'edge', id: 'e[extrude:nothing:cap:end]' }])],
      { h: '15 mm' },
    );
    const result = await run(doc);
    expect(result.features['S3' as FeatureId]).toEqual({
      status: 'warning',
      message: expect.stringMatching(/^Lost a projected edge/),
      refs: [{ ref: { kind: 'edge', id: 'e[extrude:nothing:cap:end]' }, state: 'lost' }],
    });
    expect(report(result, 'S3').projections?.['P0' as ProjectionId]).toEqual({ lost: true });
  });
});
