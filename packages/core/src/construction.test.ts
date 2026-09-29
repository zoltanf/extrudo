import { describe, expect, it } from 'vitest';
import { CommandError } from './commands';
import {
  CONSTRUCTION_FEATURES,
  CONSTRUCTION_TYPES,
  type ConstructionReport,
  constructionAxisLine,
  constructionKindOf,
  constructionPlaneFrame,
  constructionRef,
  isConstructionRef,
  isConstructionReport,
  isConstructionType,
  MidplaneInputsSchema,
  OffsetPlaneInputsSchema,
  PlaneThroughPointsInputsSchema,
  TangentPlaneInputsSchema,
  usesBodies,
} from './construction';
import { createDocument } from './document';
import { removeFeature } from './document-commands';
import type { ExtrudoDocument, Feature, GeomRef } from './schema';
import { redefineSketchPlane } from './sketch/commands';
import { sketchInputs } from './sketch/feature';
import { originPlaneRef, planeFrame } from './sketch/planes';
import { createDocumentStore } from './stores';
import { fid } from './testing';
import { moveFeature, moveProblem, timelineDependencies } from './timeline';

const XY = originPlaneRef('origin:xy');
const plane = (id: string, name: string, source: GeomRef, distance = '10 mm'): Feature => ({
  id: fid(id),
  type: 'offsetPlane',
  name,
  suppressed: false,
  inputs: {
    plane: { kind: 'ref', refs: [source] },
    distance: { kind: 'expr', expr: distance, unit: 'length' },
  },
});
const sketchOn = (id: string, name: string, source: GeomRef): Feature => ({
  id: fid(id),
  type: 'sketch',
  name,
  suppressed: false,
  inputs: sketchInputs(source),
});

/** OP1 (XY + 10) → OP2 (OP1 + 5) → Sketch1 on OP2. */
function timeline(): ExtrudoDocument {
  const features = [
    plane('OP1', 'Offset Plane1', XY),
    plane('OP2', 'Offset Plane2', { kind: 'plane', id: 'OP1' }, '5 mm'),
    sketchOn('S1', 'Sketch1', { kind: 'plane', id: 'OP2' }),
  ];
  return { ...createDocument({ name: 'Construction' }), features, timelineMarker: 3 };
}

describe('construction feature types', () => {
  it('nine types in the Construct category, each with a label and an icon', () => {
    expect(CONSTRUCTION_TYPES).toHaveLength(9);
    for (const type of CONSTRUCTION_TYPES) {
      const feature = CONSTRUCTION_FEATURES[type];
      expect(feature).toMatchObject({ type, category: 'construct' });
      expect(feature.label.length).toBeGreaterThan(0);
      expect(feature.icon.length).toBeGreaterThan(0);
      expect(isConstructionType(type)).toBe(true);
    }
    expect(isConstructionType('extrude')).toBe(false);
  });

  it('says what each makes, and a reference to a feature has its kind and the feature ID', () => {
    const kinds = CONSTRUCTION_TYPES.map((t) => constructionKindOf(t));
    expect(kinds).toEqual([
      'plane',
      'plane',
      'plane',
      'plane',
      'plane',
      'axis',
      'axis',
      'axis',
      'point',
    ]);
    expect(constructionRef({ id: fid('F'), type: 'offsetPlane' })).toEqual({
      kind: 'plane',
      id: 'F',
    });
    expect(constructionRef({ id: fid('F'), type: 'axisAlongEdge' })).toEqual({
      kind: 'axis',
      id: 'F',
    });
    expect(constructionRef({ id: fid('F'), type: 'constructionPoint' })).toEqual({
      kind: 'point',
      id: 'F',
    });
    expect(constructionRef({ id: fid('F'), type: 'extrude' })).toBeUndefined();
    expect(isConstructionRef({ kind: 'plane', id: 'F' })).toBe(true);
    expect(isConstructionRef({ kind: 'plane', id: 'origin:xy' })).toBe(false);
    expect(isConstructionRef({ kind: 'face', id: 'F' })).toBe(false);
  });
});

describe('construction inputs', () => {
  it('every input is optional: a missing pick is the kernel’s to report', () => {
    for (const type of CONSTRUCTION_TYPES) {
      expect(CONSTRUCTION_FEATURES[type].inputsSchema.safeParse({}).success, type).toBe(true);
    }
  });

  it('checks reference kinds and counts', () => {
    const ok = (schema: { safeParse(v: unknown): { success: boolean } }, value: unknown) =>
      schema.safeParse(value).success;
    const refs = (...list: GeomRef[]) => ({ kind: 'ref', refs: list });
    expect(ok(OffsetPlaneInputsSchema, { plane: refs(XY) })).toBe(true);
    expect(ok(OffsetPlaneInputsSchema, { plane: refs({ kind: 'face', id: 'f' }) })).toBe(true);
    expect(ok(OffsetPlaneInputsSchema, { plane: refs({ kind: 'edge', id: 'e' }) })).toBe(false);
    expect(ok(OffsetPlaneInputsSchema, { plane: refs(XY, XY) })).toBe(false);
    expect(ok(MidplaneInputsSchema, { planes: refs(XY, XY) })).toBe(true);
    expect(ok(MidplaneInputsSchema, { planes: refs(XY, XY, XY) })).toBe(false);
    const p = (id: string): GeomRef => ({ kind: 'point', id });
    expect(ok(PlaneThroughPointsInputsSchema, { points: refs(p('a'), p('b'), p('c')) })).toBe(true);
    expect(
      ok(PlaneThroughPointsInputsSchema, { points: refs(p('a'), p('b'), p('c'), p('d')) }),
    ).toBe(false);
    expect(ok(TangentPlaneInputsSchema, { face: refs(XY) })).toBe(false);
    // Numbers are expressions of their unit.
    expect(
      ok(OffsetPlaneInputsSchema, { distance: { kind: 'expr', expr: '5', unit: 'angle' } }),
    ).toBe(false);
  });

  it('a feature uses the bodies when it refers to a face, edge or vertex', () => {
    const refs = (...list: GeomRef[]) => ({ kind: 'ref' as const, refs: list });
    expect(usesBodies({ inputs: { plane: refs(XY) } })).toBe(false);
    expect(usesBodies({ inputs: { plane: refs({ kind: 'plane', id: 'OP1' }) } })).toBe(false);
    expect(usesBodies({ inputs: { plane: refs({ kind: 'face', id: 'f' }) } })).toBe(true);
    expect(usesBodies({ inputs: { points: refs({ kind: 'vertex', id: 'v' }) } })).toBe(true);
    expect(usesBodies({ inputs: {} })).toBe(false);
  });
});

describe('construction reports', () => {
  const frame = {
    origin: [0, 0, 10],
    x: [1, 0, 0],
    y: [0, 1, 0],
    normal: [0, 0, 1],
  } as const;
  const reports = {
    P: { kind: 'plane', frame, anchor: [0, 0, 10] },
    A: { kind: 'axis', origin: [1, 2, 3], direction: [0, 0, 1] },
    Q: { kind: 'point', point: [1, 1, 1] },
  } as const satisfies Record<string, ConstructionReport>;

  it('tells kernel reports apart from sketch reports', () => {
    expect(isConstructionReport(reports.P)).toBe(true);
    expect(isConstructionReport({ frame })).toBe(false);
    expect(isConstructionReport(undefined)).toBe(false);
    expect(isConstructionReport(null)).toBe(false);
  });

  it('gives a construction plane’s frame and axis by reference', () => {
    const map = reports as never;
    expect(constructionPlaneFrame({ kind: 'plane', id: 'P' }, map)).toEqual(frame);
    expect(constructionPlaneFrame({ kind: 'plane', id: 'A' }, map)).toBeUndefined();
    expect(constructionPlaneFrame({ kind: 'plane', id: 'P' }, undefined)).toBeUndefined();
    expect(constructionAxisLine({ kind: 'axis', id: 'A' }, map)).toEqual({
      origin: [1, 2, 3],
      direction: [0, 0, 1],
    });
    expect(constructionAxisLine({ kind: 'axis', id: 'P' }, map)).toBeUndefined();
  });

  it('planeFrame knows origin planes and, with reports, construction planes', () => {
    expect(planeFrame(XY)?.normal).toEqual([0, 0, 1]);
    expect(planeFrame({ kind: 'plane', id: 'P' })).toBeUndefined();
    expect(planeFrame({ kind: 'plane', id: 'P' }, reports as never)).toEqual(frame);
    expect(planeFrame({ kind: 'face', id: 'f' }, reports as never)).toBeUndefined();
  });
});

describe('construction features in the timeline', () => {
  it('depend on the features whose IDs their references carry', () => {
    const deps = timelineDependencies(timeline());
    expect(deps.get(fid('OP1'))).toEqual([]);
    expect(deps.get(fid('OP2'))).toEqual([fid('OP1')]);
    expect(deps.get(fid('S1'))).toEqual([fid('OP2')]);
  });

  it('refuse a move that breaks the order, both ways', () => {
    const doc = timeline();
    expect(moveProblem(doc, fid('OP2'), 0)).toContain(
      "Can't move Offset Plane2 before Offset Plane1",
    );
    expect(moveProblem(doc, fid('OP1'), 2)).toContain('uses Offset Plane1');
    expect(moveProblem(doc, fid('S1'), 1)).toContain("Can't move Sketch1 before Offset Plane2");
    expect(moveProblem(doc, fid('OP1'), 0)).toBeUndefined();
    const store = createDocumentStore(doc);
    expect(() => store.getState().dispatch(moveFeature({ id: fid('OP2'), index: 0 }))).toThrow(
      CommandError,
    );
  });

  it('can’t be deleted while a later feature uses them', () => {
    const store = createDocumentStore(timeline());
    expect(() => store.getState().dispatch(removeFeature({ id: fid('OP1') }))).toThrow(
      /Offset Plane2 uses it/,
    );
    store.getState().dispatch(removeFeature({ id: fid('S1') }));
    store.getState().dispatch(removeFeature({ id: fid('OP2') }));
    store.getState().dispatch(removeFeature({ id: fid('OP1') }));
    expect(store.getState().doc.features).toEqual([]);
  });

  it('a sketch can be redefined onto a construction plane before it, not after it', () => {
    const doc = timeline();
    const features = [
      ...doc.features.slice(0, 2),
      sketchOn('S0', 'Sketch0', XY),
      plane('OP3', 'Offset Plane3', XY),
    ];
    const store = createDocumentStore({ ...doc, features, timelineMarker: 4 });
    store
      .getState()
      .dispatch(redefineSketchPlane({ id: fid('S0'), plane: { kind: 'plane', id: 'OP2' } }));
    expect(() =>
      store
        .getState()
        .dispatch(redefineSketchPlane({ id: fid('S0'), plane: { kind: 'plane', id: 'OP3' } })),
    ).toThrow(/comes after it/);
  });
});
