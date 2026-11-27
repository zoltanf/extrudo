// `read` features keyed by the bodies their references name (ADR-0024's amendment on `read`
// features): sketches on faces, with a projection of another box's edge, and construction geometry
// on a face and an edge, among boxes no feature refers to before, between and after. The seeded
// proof of `view-access-features-test-support.ts`, the counters of the chains after them (an
// extrude of a new body and a fillet of it; a cut), results that must not be kept when the body a
// reference names changes, and a reference found only by a related name. Real OCCT and manifold,
// strict leaks, no clock.
import {
  type AttachmentId,
  type BodyId,
  canvasInputs,
  type ExtrudoDocument,
  extrudeInputs,
  type Feature,
  type FeatureId,
  filletInputs,
  type GeomRef,
  moveInputs,
  profileRefId,
  sketchInputs,
} from '@extrudo/core';
import { SketchBuilder } from '@extrudo/sketch/fixtures';
import { detectProfiles } from '@extrudo/sketch/profiles';
import { describe, expect, it } from 'vitest';
import { kernelFeatures } from '../features';
import { fallbacks, GENERIC_KINDS, length, setInputs } from './add-access-test-support';
import type { EvalContext, KernelFeatureDefinition } from './types';
import {
  BASE,
  box,
  computed,
  type Design,
  edgeRefs,
  faceRefs,
  feature,
  type Kind,
  proveDesigns,
  sequence,
  top,
  useKernel,
} from './view-access-features-test-support';
import { document, slot, twin } from './view-access-test-support';

useKernel();

/** A sketch `id` on `plane` with one circle of radius 3 mm at the plane's origin. */
function circleSketch(id: string, plane: GeomRef) {
  const b = new SketchBuilder();
  b.circle(0, 0, 3);
  const [region] = detectProfiles(b.sketch);
  const sketch = feature(id, 'sketch', sketchInputs(plane, b.sketch));
  return { sketch, profile: profileRefId(id as FeatureId, region?.id ?? '') };
}

/** An extrude `id` of `profile` by 4 mm: a new body, or a cut through what it meets. */
const extrude = (id: string, profile: string, operation: 'new-body' | 'cut' = 'new-body') =>
  feature(
    id,
    'extrude',
    extrudeInputs([{ kind: 'profile', id: profile }], {
      distance: '4 mm',
      operation,
      ...(operation === 'cut' && { flip: true }),
    }),
  );

/** Boxes: `o0` before, `fb` (the face's), `o1` between, `eb` (an edge's), `o2` after. */
const BOXES = [box('o0', -40), box('fb', 0), box('o1', 30), box('eb', 60)];

/** The top face of `fb` and a top edge of `eb`. */
async function refs() {
  return computed(document('the boxes', BOXES), (engine) => ({
    face: faceRefs(engine, 'fb:0', top)[0] as GeomRef,
    edge: edgeRefs(engine, 'eb:0', (d) =>
      d.edges.flatMap((e, i) => (e.type === 'line' && e.midpoint[2] > 9.9 ? [i] : [])),
    )[0] as GeomRef,
    vertical: edgeRefs(engine, 'fb:0', (d) =>
      d.edges.flatMap((e, i) =>
        e.type === 'line' && Math.abs(e.direction?.[2] ?? 0) > 0.99 ? [i] : [],
      ),
    )[0] as GeomRef,
  }));
}

/**
 * A sketch on `fb`'s top face, a new body extruded from it and a fillet of that body's top edge;
 * then `o2`. With `projected`, the sketch also projects a top edge of `eb`.
 */
async function sketches(projected = false): Promise<ExtrudoDocument> {
  const { face, edge } = await refs();
  const { sketch, profile } = circleSketch('sk', face);
  const sk = projected
    ? setInputs(document('', [sketch]), 'sk', {
        sketch: {
          kind: 'sketchData',
          sketch: {
            ...(sketch.inputs.sketch as { sketch: object }).sketch,
            projections: { pj: { ref: edge, curves: {} } },
          },
        } as never,
      }).features[0]
    : sketch;
  const before = document('a sketch on a face', [...BOXES, sk as Feature, extrude('ek', profile)]);
  const rim = await computed(before, (engine) =>
    edgeRefs(engine, 'ek:0', (d) =>
      d.edges.flatMap((e, i) => (e.type === 'circle' && e.midpoint[2] > 13.9 ? [i] : [])),
    ),
  );
  return document('a sketch on a face, an extrude and a fillet of it', [
    ...before.features,
    feature('fl', 'fillet', filletInputs([{ edges: rim, radius: '0.5 mm' }])),
    box('o2', 100),
  ]);
}

/**
 * A construction plane 5 mm over `fb`'s top face with a sketch on it and a new body extruded from
 * that; a canvas on that face; an axis along a vertical edge of `fb` and a box moved about it;
 * then `o2`.
 */
async function construction(): Promise<ExtrudoDocument> {
  const { face, vertical } = await refs();
  const { sketch, profile } = circleSketch('sc', { kind: 'plane', id: 'cp' });
  return document('construction geometry on a face and an edge', [
    ...BOXES,
    feature('cp', 'offsetPlane', {
      plane: { kind: 'ref', refs: [face] },
      distance: length('5 mm'),
    }),
    sketch,
    extrude('ec', profile),
    feature(
      'cv',
      'canvas',
      canvasInputs({ image: 'att-img' as AttachmentId, plane: face, numbers: { width: '20 mm' } }),
    ),
    feature('ax', 'axisAlongEdge', { edge: { kind: 'ref', refs: [vertical] } }),
    box('mb', 130),
    feature(
      'mv',
      'move',
      moveInputs(['mb:0'], { mode: 'rotate', axis: { kind: 'axis', id: 'ax' }, angle: '20 deg' }),
    ),
    box('o2', 160),
  ]);
}

const SIZES = ['size-face', 'size-before', 'size-between', 'size-after'] as Kind[];

const DESIGNS: Design[] = [
  {
    name: 'a sketch on a face, an extrude and a fillet of it, among boxes nothing refers to',
    make: () => sketches(),
    target: 'sk',
    refsKey: 'plane',
    named: async () => ({ edge: (await refs()).edge }),
    kinds: [
      ...BASE,
      ...SIZES,
      ...SIZES,
      'reshape',
      'reshape',
      'project',
      'unproject',
      ...GENERIC_KINDS,
    ] as Kind[],
    flips: [
      'size-face: view→view',
      'size-before: view→view',
      'size-between: view→view',
      'size-after: view→view',
      'reshape: view→view',
      'project: view→view',
      'unproject: view→view',
    ],
    steps: 28,
  },
  {
    name: 'construction geometry on a face and an edge, among boxes nothing refers to',
    make: construction,
    target: 'cp',
    refsKey: 'plane',
    kinds: [...BASE, ...SIZES, ...SIZES, ...GENERIC_KINDS] as Kind[],
    flips: [
      'size-face: view→view',
      'size-before: view→view',
      'size-between: view→view',
      'size-after: view→view',
    ],
    steps: 24,
  },
];

describe('view access: read features (ADR-0024)', () => {
  proveDesigns(DESIGNS);

  it('counters: a box nothing refers to runs alone; the face’s box runs the chain after it', {
    timeout: 120_000,
  }, async () => {
    const doc = await sketches();
    const steps = await sequence([
      doc,
      setInputs(doc, 'o0', { length: length('12 mm') }),
      doc,
      setInputs(doc, 'o1', { length: length('12 mm') }),
      doc,
      setInputs(doc, 'o2', { length: length('12 mm') }),
      doc,
      setInputs(doc, 'fb', { length: length('12 mm') }),
    ]);
    for (const step of steps) {
      expect(step.problems).toEqual([]);
      expect(fallbacks(step.result, doc)).toEqual([]);
      expect(step.result.stats.viewed).toEqual(['sk', 'fl']);
    }
    const sent = (i: number) => steps[i]?.result.bodies.filter((b) => b.mesh).map((b) => b.id);
    // A box before, between or after: it alone, its mesh alone.
    expect(steps[1]?.evaluated).toEqual(['o0']);
    expect(sent(1)).toEqual(['o0:0']);
    expect(steps[3]?.evaluated).toEqual(['o1']);
    expect(steps[5]?.evaluated).toEqual(['o2']);
    // The face's box: the sketch on it, the extrude from the sketch, the fillet of that body.
    expect(steps[7]?.evaluated).toEqual(['fb', 'sk', 'ek', 'fl']);
    expect(sent(7)).toEqual(['fb:0', 'ek:0']);
    for (const id of ['sk', 'ek', 'fl']) {
      expect(steps[0]?.result.features[id as FeatureId]?.status, id).toBe('ok');
    }
  });

  it('counters: a cut from a sketch on a face keys the bodies it touches; both stay', {
    timeout: 120_000,
  }, async () => {
    const { face } = await refs();
    const { sketch, profile } = circleSketch('sk', face);
    const doc = document('a cut from a sketch on a face', [
      ...BOXES,
      sketch,
      extrude('cut', profile, 'cut'),
      box('o2', 100),
    ]);
    const steps = await sequence([doc, setInputs(doc, 'o0', { length: length('12 mm') })]);
    for (const step of steps) expect(step.problems).toEqual([]);
    expect(steps[0]?.result.stats.viewed).toEqual(['sk', 'cut']);
    // The sketch keys `fb`'s version, the cut the versions of the bodies it touches (`fb`).
    expect(steps[1]?.evaluated).toEqual(['o0']);
  });

  it('construction counters: each piece runs with the box its reference is on', {
    timeout: 120_000,
  }, async () => {
    const doc = await construction();
    const steps = await sequence([
      doc,
      setInputs(doc, 'o0', { length: length('12 mm') }),
      doc,
      setInputs(doc, 'fb', { height: length('12 mm') }),
    ]);
    for (const step of steps) {
      expect(step.problems).toEqual([]);
      expect(fallbacks(step.result, doc)).toEqual([]);
      expect(step.result.stats.viewed).toEqual(['cp', 'cv', 'ax', 'mv']);
    }
    expect(steps[1]?.evaluated).toEqual(['o0']);
    // The plane on its top face and what is built on the plane, the canvas on that face; the axis
    // along its edge and the move about the axis.
    expect(steps[3]?.evaluated).toEqual(['fb', 'cp', 'sc', 'ec', 'cv', 'ax', 'mv']);
    for (const id of ['cp', 'sc', 'ec', 'cv', 'ax', 'mv']) {
      expect(steps[0]?.result.features[id as FeatureId]?.status, id).toBe('ok');
    }
  });

  // Never stale: each step equals a cleared engine (versions and results), where a sketch kept
  // from before its body changed would differ.
  const stale = async (change: (doc: ExtrudoDocument) => ExtrudoDocument, first: string) => {
    const doc = await sketches(true);
    const changed = change(doc);
    const steps = await sequence([doc, changed]);
    for (const step of steps) expect(step.problems).toEqual([]);
    expect(fallbacks(steps[0]?.result as NonNullable<(typeof steps)[0]>['result'], doc)).toEqual(
      [],
    );
    expect(
      fallbacks(steps[1]?.result as NonNullable<(typeof steps)[1]>['result'], changed),
    ).toEqual([]);
    expect(steps[0]?.result.stats.viewed).toContain('sk');
    expect(steps[0]?.result.features['sk' as FeatureId]?.status).toBe('ok');
    expect(steps[1]?.evaluated).toEqual([first, 'sk', 'ek', 'fl']);
    const report = (i: number, key: 'frame' | 'projections') =>
      JSON.stringify(
        (steps[i]?.result.reports['sk' as FeatureId] as Record<string, unknown>)?.[key],
      );
    return {
      moved: report(1, 'frame') !== report(0, 'frame'),
      projected: report(1, 'projections') !== report(0, 'projections'),
    };
  };

  it('never stale: the face’s box taller, the face keeping its name', {
    timeout: 120_000,
  }, async () => {
    const { moved } = await stale((doc) => setInputs(doc, 'fb', { height: length('12 mm') }), 'fb');
    // The sketch's plane rises with the face.
    expect(moved).toBe(true);
  });

  it('never stale: the box whose edge the sketch projects', { timeout: 120_000 }, async () => {
    const { projected } = await stale(
      (doc) => setInputs(doc, 'eb', { width: length('12 mm') }),
      'eb',
    );
    // The projected edge moved with its box's side.
    expect(projected).toBe(true);
  });

  it('never stale: the face’s body replaced by a body of the same ID from another feature', {
    timeout: 120_000,
  }, async () => {
    // A move of `fb:0` before the sketch: `fb:0` is now the move's body, a version of its own.
    const { moved } = await stale(
      (doc) => ({
        ...doc,
        features: doc.features.flatMap((f) =>
          f.id === 'sk' ? [feature('mf', 'move', moveInputs(['fb:0'], { dz: '5 mm' })), f] : [f],
        ),
        timelineMarker: doc.features.length + 1,
      }),
      'mf',
    );
    expect(moved).toBe(true);
  });

  it('a face found only by a related name: keyed by every body, the same result', {
    timeout: 120_000,
  }, async () => {
    // A slot through `fb` before the sketch splits its top face: the sketch's face is found by a
    // related name, so no view is made for it.
    const doc = await sketches();
    const at = doc.features.findIndex((f) => f.id === 'sk');
    const features = [...doc.features];
    features.splice(at, 0, ...slot('gr', [-1, -20, 1, 20]));
    const split = { ...doc, features, timelineMarker: features.length };
    const steps = await sequence([doc, split, setInputs(split, 'o0', { length: length('12 mm') })]);
    for (const step of steps) expect(step.problems).toEqual([]);
    expect(steps[0]?.result.stats.viewed).toContain('sk');
    expect(steps[1]?.result.stats.viewed).not.toContain('sk');
    expect(fallbacks(steps[1]?.result as NonNullable<(typeof steps)[1]>['result'], split)).toEqual(
      [],
    );
    // Keyed by every body: a box nothing refers to runs it again.
    expect(steps[2]?.evaluated).toContain('sk');
  });

  it('a body projected and a body intersected: run with that body, not with an unrelated one', {
    timeout: 120_000,
  }, async () => {
    // A 20 mm tall box `tb` the sketch on `fb`'s top face (z 10) projects whole and cuts through:
    // `bodyShape` looks it up by the `body` reference's ID, which the view holds.
    const { face } = await refs();
    const { sketch } = circleSketch('sb', face);
    const data = (sketch.inputs.sketch as { sketch: object }).sketch;
    const body: GeomRef = { kind: 'body', id: 'tb:0' };
    const tall = feature('tb', 'box', {
      ...box('tb', 90).inputs,
      height: length('20 mm'),
    });
    const doc = document('a body projected and intersected', [
      ...BOXES,
      tall,
      setInputs(document('', [sketch]), 'sb', {
        sketch: {
          kind: 'sketchData',
          sketch: {
            ...data,
            projections: {
              whole: { ref: body, curves: {} },
              cross: { ref: body, curves: {}, mode: 'intersect' },
            },
          },
        } as never,
      }).features[0] as Feature,
    ]);
    const steps = await sequence([
      doc,
      setInputs(doc, 'tb', { width: length('14 mm') }),
      doc,
      setInputs(doc, 'o0', { length: length('12 mm') }),
    ]);
    for (const step of steps) {
      expect(step.problems).toEqual([]);
      expect(fallbacks(step.result, doc)).toEqual([]);
      expect(step.result.stats.viewed).toEqual(['sb']);
    }
    const projections = (i: number) =>
      (steps[i]?.result.reports['sb' as FeatureId] as { projections?: Record<string, unknown> })
        ?.projections;
    expect(Object.keys(projections(0) ?? {}).sort()).toEqual(['cross', 'whole']);
    expect(steps[1]?.evaluated).toEqual(['tb', 'sb']);
    expect(JSON.stringify(projections(1))).not.toEqual(JSON.stringify(projections(0)));
    expect(steps[3]?.evaluated).toEqual(['o0']);
  });

  it('a whole sketch projected: no view, keyed by every body', { timeout: 120_000 }, async () => {
    const doc = await sketches();
    const b = new SketchBuilder();
    b.circle(40, 40, 2);
    const whole = feature(
      'sw',
      'sketch',
      sketchInputs({ kind: 'plane', id: 'origin:xy' }, {
        ...b.sketch,
        projections: { all: { ref: { kind: 'feature', id: 'sk' }, curves: {} } },
      } as never),
    );
    const withWhole = {
      ...doc,
      features: [...doc.features, whole],
      timelineMarker: doc.features.length + 1,
    };
    const steps = await sequence([
      withWhole,
      setInputs(withWhole, 'o0', { length: length('12 mm') }),
    ]);
    for (const step of steps) expect(step.problems).toEqual([]);
    expect(steps[0]?.result.features['sw' as FeatureId]?.status).toBe('ok');
    expect(steps[0]?.result.stats.viewed).toEqual(['sk', 'fl']);
    // A box nothing refers to runs it again: its key holds every body before it.
    expect(steps[1]?.evaluated).toEqual(['o0', 'sw']);
  });

  it('twin bodies with the face’s exact name: both in the view', { timeout: 120_000 }, async () => {
    const parts = document('twins', [twin('ta', '0 mm'), twin('tb', '30 mm')]);
    const face = await computed(parts, (engine) => faceRefs(engine, 'ta:0', top)[0] as GeomRef);
    const { sketch } = circleSketch('st', face);
    const doc = document('a sketch on a face two twins have by name', [
      // The twins are `write` (the test feature's default): a box before them would run them.
      ...parts.features,
      box('o0', -40),
      sketch,
    ]);
    const steps = await sequence([
      doc,
      setInputs(doc, 'tb', { size: length('12 mm') }),
      doc,
      setInputs(doc, 'o0', { length: length('12 mm') }),
    ]);
    for (const step of steps) {
      expect(step.problems).toEqual([]);
      expect(step.result.stats.viewed).toEqual(['st']);
    }
    // The other twin is in the view too (the face's name is on both): it runs the sketch again.
    expect(steps[1]?.evaluated).toEqual(['tb', 'st']);
    expect(steps[3]?.evaluated).toEqual(['o0']);
  });

  it('a read feature that looks outside its view: noticed, keyed by every body, remembered', {
    timeout: 120_000,
  }, async () => {
    // A test-only `read` feature that resolves its face and also looks up `o0:0`, which no
    // reference names.
    const registry = () => {
      const out = kernelFeatures();
      out.register({
        type: 'test-read-peek',
        label: 'test-read-peek',
        category: 'construct',
        icon: 'test',
        inputsSchema: (kernelFeatures().get('canvas') as KernelFeatureDefinition).inputsSchema,
        bodyAccess: () => 'read',
        evaluate(ctx: EvalContext) {
          for (const input of Object.values(ctx.inputs)) {
            if (input?.kind === 'ref') for (const ref of input.refs) ctx.resolve(ref);
          }
          const seen = ctx.bodies.get('o0:0' as BodyId) !== undefined;
          return { report: { seen } as never };
        },
      } as unknown as KernelFeatureDefinition);
      return out;
    };
    const { face } = await refs();
    const doc = document('a read feature that peeks', [
      ...BOXES,
      feature('pk', 'test-read-peek', {
        ...canvasInputs({
          image: 'att-img' as AttachmentId,
          plane: face,
          numbers: { width: '5 mm' },
        }),
      }),
    ]);
    const steps = await sequence([doc, setInputs(doc, 'o0', { length: length('12 mm') }), doc], {
      registry,
      reference: registry,
    });
    for (const step of steps) {
      // Equal to a cleared engine and to `read` keyed by every body, at every step.
      expect(step.problems).toEqual([]);
      expect(step.result.stats.viewed).toEqual([]);
      expect(step.result.features['pk' as FeatureId]?.status).toBe('ok');
      expect((step.result.reports['pk' as FeatureId] as { seen?: boolean })?.seen).toBe(true);
    }
    // Tried with its view, noticed, evaluated keyed by every body.
    expect(fallbacks(steps[0]?.result as NonNullable<(typeof steps)[0]>['result'], doc)).toEqual([
      'pk',
    ]);
    // Remembered: the box it peeks at runs it once, keyed by every body, with no view tried.
    expect(steps[1]?.evaluated).toEqual(['o0', 'pk']);
    expect(steps[2]?.evaluated).toEqual([]);
  });
});
