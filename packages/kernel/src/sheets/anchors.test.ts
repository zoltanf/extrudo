// A sheet's anchors through the recompute engine (P6-24 S3, ADR-0143's S3
// amendment): what each anchor resolves to on shapes whose sizes are known
// (a box, a cylinder), and on B2 how a dimension follows a parameter, is
// detached when its feature is deleted, suppressed or rolled back (never a
// closest match there, the owner's rule of 2026-11-11) and is attached again
// when it comes back.
import {
  type BodyId,
  type ExtrudoDocument,
  type Feature,
  loadDocument,
  type PrimitiveInputOptions,
  type PrimitiveType,
  primitiveInputs,
  type Sheet,
  type SheetAnchor,
  type SheetDimensionItem,
  type SheetId,
  type SheetItemId,
  type SheetRefAnchor,
  type SheetViewId,
  sheetStandardFrom,
} from '@extrudo/core';
import { strFromU8, unzipSync } from 'fflate';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import b2 from '../../../../fixtures/benchmarks/b2-storage-box.extrudo?url&inline';
import { kernelFeatures } from '../features';
import { Kernel, type Vec3 } from '../kernel';
import { nameRelation } from '../naming/topo-id';
import { loadOcct } from '../occt/load';
import { RecomputeEngine } from '../recompute/engine';
import { testDocument, testFeature } from '../recompute/testing';

let kernel: Kernel;
let engine: RecomputeEngine | undefined;

beforeAll(async () => {
  kernel = new Kernel(await loadOcct());
});
afterEach(() => {
  engine?.clear();
  engine = undefined;
  expect(kernel.stats().liveShapes).toBe(0);
});
afterAll(() => kernel?.dispose());

async function recompute(doc: ExtrudoDocument) {
  engine ??= new RecomputeEngine(kernel, kernelFeatures(), { strictLeaks: true });
  const result = await engine.recompute({ doc });
  if (result.status !== 'done') throw new Error(result.status);
  for (const [id, status] of Object.entries(result.features)) {
    if (status.status === 'error') throw new Error(`${id}: ${status.message}`);
  }
  return result;
}

function primitive(id: string, type: PrimitiveType, options: PrimitiveInputOptions): Feature {
  return { ...testFeature(id, type), inputs: primitiveInputs(type, options) };
}

function shapeOf(body: BodyId) {
  const shape = engine?.latestBody(body);
  if (shape === undefined) throw new Error(`no body ${body}`);
  return shape;
}

const near = (a: readonly number[], b: readonly number[]) =>
  a.every((x, i) => Math.abs(x - (b[i] as number)) < 1e-6);

/** The edge of a body whose middle is at `mid`, as a reference the Dimension tool would store. */
function edgeAt(body: BodyId, mid: Vec3): AnchorRef {
  const shape = engine?.latestBody(body);
  if (shape === undefined) throw new Error(`no body ${body}`);
  const index = kernel.describe(shape).edges.findIndex((e) => near(e.midpoint, mid));
  const ref =
    index < 0 ? undefined : (engine?.reference(body, 'edge', index) as AnchorRef | undefined);
  if (!ref) throw new Error(`no edge at ${mid}`);
  return ref;
}

function faceOf(body: BodyId, type: string): AnchorRef {
  const shape = engine?.latestBody(body);
  if (shape === undefined) throw new Error(`no body ${body}`);
  const index = kernel.describe(shape).faces.findIndex((f) => f.type === type);
  const ref = engine?.reference(body, 'face', index) as AnchorRef | undefined;
  if (!ref) throw new Error(`no ${type} face`);
  return ref;
}

function vertexAt(body: BodyId, at: Vec3): AnchorRef {
  const shape = engine?.latestBody(body);
  if (shape === undefined) throw new Error(`no body ${body}`);
  const index = kernel.describe(shape).vertices.findIndex((v) => near(v.point, at));
  const ref = engine?.reference(body, 'vertex', index) as AnchorRef | undefined;
  if (!ref) throw new Error(`no vertex at ${at}`);
  return ref;
}

/** A reference as a sheet anchor keeps it (the engine gives a face, edge or vertex one here). */
type AnchorRef = SheetRefAnchor['ref'];

const DELETED = 'The feature this was measured on is deleted.';

const front = sheetStandardFrom('front');
const top = sheetStandardFrom('top');

function sheetWith(dimensions: Omit<SheetDimensionItem, 'kind' | 'view' | 'at'>[]): Sheet {
  return {
    id: 's1' as SheetId,
    name: 'Sheet 1',
    size: 'A3',
    orientation: 'landscape',
    scale: [1, 1],
    projection: 'first',
    decimals: 1,
    views: [
      {
        id: 'front' as SheetViewId,
        name: 'Front',
        at: [100, 100],
        from: front,
      },
      { id: 'top' as SheetViewId, name: 'Top', at: [100, 200], from: top },
    ],
    items: dimensions.map((d) => ({
      kind: 'dimension',
      view: (d.id.startsWith('top') ? 'top' : 'front') as SheetViewId,
      at: [0, 40],
      ...d,
    })),
  };
}

const dim = (
  id: string,
  type: SheetDimensionItem['type'],
  anchors: SheetAnchor[],
): Omit<SheetDimensionItem, 'kind' | 'view' | 'at'> => ({
  id: id as SheetItemId,
  type,
  anchors,
});

describe('a box, 10 × 20 × 30 (centred on the XY plane, z up)', () => {
  const doc = testDocument([
    primitive('Box1', 'box', { numbers: { length: '10 mm', width: '20 mm', height: '30 mm' } }),
  ]);
  const body = 'Box1:0' as BodyId;

  it('gives a whole edge as a line, its points, and a vertex', async () => {
    await recompute(doc);
    const vertical = edgeAt(body, [-5, -10, 15]);
    const across = edgeAt(body, [0, -10, 30]);
    const sheet = sheetWith([
      dim('d1', 'linear', [{ ref: vertical }]),
      dim('d2', 'linear', [
        { ref: across, at: 'start' },
        { ref: across, at: 'end' },
      ]),
      dim('d3', 'linear', [{ ref: across, at: 'middle' }, { ref: vertexAt(body, [5, -10, 0]) }]),
      dim('d4', 'linear', [{ free: [1, 2] }, { ref: across, at: 'centre' }]),
    ]);
    const anchors = (engine as RecomputeEngine).resolveSheet(sheet);
    const [line] = anchors['d1' as SheetItemId] ?? [];
    expect(line?.status).toBe('ok');
    expect(line?.resolved).toEqual(vertical);
    expect(line?.geometry?.type).toBe('line');
    if (line?.geometry?.type !== 'line') throw new Error('not a line');
    const ends = [line.geometry.start, line.geometry.end].map((p) => p[2]).sort((a, b) => a - b);
    expect(ends).toEqual([0, 30]);
    const [start, end] = anchors['d2' as SheetItemId] ?? [];
    const xs = [start, end].map((r) => (r?.geometry?.type === 'point' ? r.geometry.point[0] : NaN));
    expect(xs.sort()).toEqual([-5, 5]);
    expect(anchors['d3' as SheetItemId]?.map((r) => r.geometry)).toEqual([
      { type: 'point', point: [0, -10, 30] },
      { type: 'point', point: [5, -10, 0] },
    ]);
    // A free anchor is the layout's own; a line has no centre (the anchor is not lost).
    expect(anchors['d4' as SheetItemId]).toEqual([
      { status: 'ok' },
      {
        status: 'ok',
        resolved: across,
        message: 'The edge has no centre: it is not a circle or an ellipse.',
      },
    ]);
  });

  it('is detached before the first recompute, with the marker before the box, for a lost name, and on a feature the document lacks', async () => {
    engine = new RecomputeEngine(kernel, kernelFeatures(), { strictLeaks: true });
    // On the box, but no edge has that name or anything like its fingerprint.
    const lost: AnchorRef = {
      kind: 'edge',
      id: 'e[box:Box1:side:8|box:Box1:side:9]',
      fingerprint: { type: 'line', at: [500, 500, 500], dir: [1, 0, 0], size: 3 },
    };
    const sheet = sheetWith([dim('d1', 'linear', [{ ref: lost }, { free: [0, 0] }])]);
    expect(engine.resolveSheet(sheet)).toEqual({
      d1: [{ status: 'detached' }, { status: 'ok' }],
    });
    await recompute(doc);
    const vertical = edgeAt(body, [-5, -10, 15]);
    const both = sheetWith([
      dim('d1', 'linear', [{ ref: lost }]),
      dim('d2', 'linear', [{ ref: vertical }]),
    ]);
    expect(engine.resolveSheet(both)['d1' as SheetItemId]).toEqual([{ status: 'detached' }]);
    expect(engine.resolveSheet(both)['d2' as SheetItemId]?.[0]?.status).toBe('ok');
    // A feature the document doesn't have: detached with no search, even
    // with the box's own edge's fingerprint.
    const gone = { ...vertical, id: 'e[box:Gone:side:0|box:Gone:side:1]' };
    expect(engine.resolveSheet(sheetWith([dim('d3', 'linear', [{ ref: gone }])]))).toEqual({
      d3: [{ status: 'detached', message: DELETED }],
    });
    await recompute({ ...doc, timelineMarker: 0 });
    expect(engine.resolveSheet(both)['d2' as SheetItemId]).toEqual([{ status: 'detached' }]);
  });

  it('finds a renamed edge of a feature that is there by its fingerprint and says it moved', async () => {
    await recompute(doc);
    const vertical = edgeAt(body, [-5, -10, 15]);
    // Box1's, but no face of the box has these names: no related name either.
    const renamed = { ...vertical, id: 'e[box:Box1:side:8|box:Box1:side:9]' };
    const [report] =
      (engine as RecomputeEngine).resolveSheet(
        sheetWith([dim('d1', 'linear', [{ ref: renamed }])]),
      )['d1' as SheetItemId] ?? [];
    expect(report?.status).toBe('moved');
    expect(report?.resolved?.id).toBe(vertical.id);
    expect(nameRelation(renamed.id, vertical.id)).toBe(0);
    expect(report?.geometry?.type).toBe('line');
  });
});

describe('a cylinder, Ø10 × 20', () => {
  const doc = testDocument([
    primitive('Cyl1', 'cylinder', { numbers: { diameter: '10 mm', height: '20 mm' } }),
  ]);
  const body = 'Cyl1:0' as BodyId;

  it('gives its rim as a circle, its face as a circle on the axis, and its two outlines', async () => {
    await recompute(doc);
    const shape = shapeOf(body);
    const rimIndex = kernel
      .describe(shape)
      .edges.findIndex((e) => e.type === 'circle' && Math.abs(e.midpoint[2] - 20) < 1e-6);
    const rim = engine?.reference(body, 'edge', rimIndex) as AnchorRef;
    const wall = faceOf(body, 'cylinder');
    const sheet = sheetWith([
      dim('top-r', 'radius', [{ ref: rim }]),
      dim('d2', 'diameter', [{ ref: wall }]),
      dim('d3', 'diameter', [
        { ref: wall, silhouette: 1 },
        { ref: wall, silhouette: -1 },
      ]),
      dim('top-c', 'linear', [{ ref: rim, at: 'centre' }, { free: [0, 0] }]),
      dim('d5', 'diameter', [{ ref: faceOf(body, 'plane') }]),
    ]);
    const anchors = (engine as RecomputeEngine).resolveSheet(sheet);
    const circle = anchors['top-r' as SheetItemId]?.[0]?.geometry;
    expect(circle).toMatchObject({ type: 'circle', radius: 5 });
    if (circle?.type !== 'circle') throw new Error('not a circle');
    expect(near(circle.centre, [0, 0, 20])).toBe(true);
    expect(Math.abs(circle.axis[2])).toBeCloseTo(1, 9);
    const face = anchors['d2' as SheetItemId]?.[0]?.geometry;
    expect(face).toMatchObject({ type: 'circle', radius: 5 });
    if (face?.type !== 'circle') throw new Error('not a circle');
    // On the axis, level with the middle of the wall.
    expect(near(face.centre, [0, 0, 10])).toBe(true);
    // Seen from the front (along +Y) the axis is +Z: axis × direction is −X.
    const [plus, minus] = anchors['d3' as SheetItemId] ?? [];
    expect(plus?.status).toBe('ok');
    if (plus?.geometry?.type !== 'silhouette' || minus?.geometry?.type !== 'silhouette') {
      throw new Error('no outlines');
    }
    expect(plus.geometry.start[0]).toBeCloseTo(-5, 6);
    expect(plus.geometry.end[0]).toBeCloseTo(-5, 6);
    expect(minus.geometry.start[0]).toBeCloseTo(5, 6);
    expect(plus.geometry.opposite?.start[0]).toBeCloseTo(5, 6);
    expect(
      [plus.geometry.start[2], plus.geometry.end[2]]
        .sort((a, b) => a - b)
        .map((z) => Math.round(z)),
    ).toEqual([0, 20]);
    expect(anchors['top-c' as SheetItemId]?.[0]?.geometry).toMatchObject({ type: 'point' });
    // A flat face has no one radius: resolved, but no geometry.
    expect(anchors['d5' as SheetItemId]?.[0]).toMatchObject({
      status: 'ok',
      message: 'The face is not a cylinder: it has no one radius.',
    });
    expect(anchors['d5' as SheetItemId]?.[0]?.geometry).toBeUndefined();
  });

  it("an outline in a view that has none on that side, or of a view that's gone, is not lost", async () => {
    await recompute(doc);
    const wall = faceOf(body, 'cylinder');
    const sheet = sheetWith([
      dim('top-o', 'diameter', [
        { ref: wall, silhouette: 1 },
        { ref: wall, silhouette: -1 },
      ]),
    ]);
    // From above, a cylinder standing up has no outline lines.
    const [fromAbove] =
      (engine as RecomputeEngine).resolveSheet(sheet)['top-o' as SheetItemId] ?? [];
    expect(fromAbove).toMatchObject({ status: 'ok', message: expect.stringMatching(/no outline/) });
    const orphan = {
      ...sheet,
      items: sheet.items.map((i) => ({ ...i, view: 'gone' as SheetViewId })),
    };
    const [gone] = (engine as RecomputeEngine).resolveSheet(orphan)['top-o' as SheetItemId] ?? [];
    expect(gone?.message).toBe("The dimension's view is gone.");
  });
});

describe('B2 (the storage box): a dimension follows the model', () => {
  function load(dataUrl: string): ExtrudoDocument {
    const binary = atob(dataUrl.slice(dataUrl.indexOf(',') + 1));
    const json = unzipSync(Uint8Array.from(binary, (c) => c.charCodeAt(0)))['document.json'];
    if (!json) throw new Error('no document.json');
    return loadDocument(JSON.parse(strFromU8(json))).doc;
  }
  const b2doc = load(b2);
  const body = Object.keys(b2doc.bodies)[0] as BodyId;
  // A drain hole through the floor (the box is 80 × 60 × 40 from the origin,
  // its floor 4 mm thick): the only circles in the model.
  const hole = primitive('Drain', 'cylinder', {
    numbers: { diameter: '10 mm', height: '10 mm', x: '40 mm', y: '30 mm', offset: '-3 mm' },
    operation: 'cut',
  });
  const doc: ExtrudoDocument = {
    ...b2doc,
    features: [...b2doc.features, hole],
    timelineMarker: b2doc.features.length + 1,
  };
  const withHeight = (height: string): ExtrudoDocument => ({
    ...doc,
    parameters: doc.parameters.map((p) => (p.name === 'height' ? { ...p, expression: height } : p)),
  });
  const without = (id: string): ExtrudoDocument => ({
    ...doc,
    features: doc.features.filter((f) => f.id !== id),
    timelineMarker: doc.features.length - 1,
  });
  const suppressing = (id: string): ExtrudoDocument => ({
    ...doc,
    features: doc.features.map((f) => (f.id === id ? { ...f, suppressed: true } : f)),
  });

  /** The box's height edge, the pocket's floor edge and the drain's rim. */
  async function picks() {
    await recompute(doc);
    const shape = shapeOf(body);
    const edges = kernel.describe(shape).edges;
    const find = (test: (e: (typeof edges)[number]) => boolean) => {
      const index = edges.findIndex(test);
      if (index < 0) throw new Error('no such edge');
      return engine?.reference(body, 'edge', index) as AnchorRef;
    };
    return {
      height: find((e) => e.type === 'line' && Math.abs(e.length - 40) < 1e-6),
      floor: find((e) => e.type === 'line' && Math.abs(e.midpoint[2] - 4) < 1e-6),
      rim: find((e) => e.type === 'circle' && Math.abs(e.midpoint[2] - 4) < 1e-6),
    };
  }

  const length = (g: unknown) => {
    const line = g as { type: string; start: Vec3; end: Vec3 };
    if (line?.type !== 'line') return Number.NaN;
    return Math.hypot(...line.start.map((x, i) => x - (line.end[i] as number)));
  };
  const resolve = (sheet: Sheet, id: string) =>
    (engine as RecomputeEngine).resolveSheet(sheet)[id as SheetItemId] ?? [];

  it('follows a parameter change: the height edge grows with `height`', {
    timeout: 60_000,
  }, async () => {
    const { height } = await picks();
    const sheet = sheetWith([dim('d1', 'linear', [{ ref: height }])]);
    const [first] = resolve(sheet, 'd1');
    expect(first?.status).toBe('ok');
    expect(length(first?.geometry)).toBeCloseTo(40, 6);
    await recompute(withHeight('55 mm'));
    const [after] = resolve(sheet, 'd1');
    expect(after?.status).toBe('ok');
    expect(length(after?.geometry)).toBeCloseTo(55, 6);
  });

  it('detaches when its feature is deleted or rolled back, and attaches again when it is back', {
    timeout: 60_000,
  }, async () => {
    const { rim, height } = await picks();
    const sheet = sheetWith([
      dim('top-r', 'diameter', [{ ref: rim }]),
      dim('d2', 'linear', [{ ref: height }]),
    ]);
    expect(resolve(sheet, 'top-r')[0]).toMatchObject({ status: 'ok', geometry: { radius: 5 } });
    await recompute(without(hole.id));
    expect(resolve(sheet, 'top-r')).toEqual([{ status: 'detached', message: DELETED }]);
    // The box's own edge stays.
    expect(resolve(sheet, 'd2')[0]?.status).toBe('ok');
    await recompute({ ...doc, timelineMarker: doc.features.length - 1 });
    expect(resolve(sheet, 'top-r')).toEqual([{ status: 'detached' }]);
    await recompute(doc);
    expect(resolve(sheet, 'top-r')[0]).toMatchObject({
      status: 'ok',
      resolved: rim,
      geometry: { radius: 5 },
    });
  });

  // Deleting the pocket left a close match by fingerprint, the box's bottom
  // edge below the floor edge (80, not 74): before the owner's rule of
  // 2026-11-11 the dimension took it and was only `moved`.
  it("detaches when the pocket it was measured on is deleted, though its edge has a close match, and is ok when it's back", {
    timeout: 60_000,
  }, async () => {
    const { floor } = await picks();
    const sheet = sheetWith([dim('d1', 'linear', [{ ref: floor }])]);
    expect(length(resolve(sheet, 'd1')[0]?.geometry)).toBeCloseTo(74, 6);
    const pocket = doc.features[3] as Feature;
    await recompute(without(pocket.id));
    expect(resolve(sheet, 'd1')).toEqual([{ status: 'detached', message: DELETED }]);
    await recompute(doc);
    const [back] = resolve(sheet, 'd1');
    expect(back).toMatchObject({ status: 'ok', resolved: floor });
    expect(length(back?.geometry)).toBeCloseTo(74, 6);
  });

  it('detaches the same way when the pocket is suppressed, and is ok when it is unsuppressed', {
    timeout: 60_000,
  }, async () => {
    const { floor, height } = await picks();
    const sheet = sheetWith([
      dim('d1', 'linear', [{ ref: floor }]),
      dim('d2', 'linear', [{ ref: height }]),
    ]);
    const pocket = doc.features[3] as Feature;
    await recompute(suppressing(pocket.id));
    expect(resolve(sheet, 'd1')).toEqual([
      {
        status: 'detached',
        message: `${pocket.name}, the feature this was measured on, is suppressed. Unsuppress it to show the dimension again.`,
      },
    ]);
    // The box's own edge stays.
    expect(resolve(sheet, 'd2')[0]?.status).toBe('ok');
    await recompute(doc);
    const [back] = resolve(sheet, 'd1');
    expect(back).toMatchObject({ status: 'ok', resolved: floor });
    expect(length(back?.geometry)).toBeCloseTo(74, 6);
  });

  // Every feature the anchor names still there, but the pocket now goes through the floor
  // (`bottom` 0; the drain left out): its floor edge is gone, and the fingerprint (not a
  // related name) finds the pocket's bottom edge at z = 0. Still `moved`,
  // never detached: the owner's rule is about deleted and suppressed features.
  it('is moved, not detached, when every feature is there and the fingerprint finds the edge', {
    timeout: 60_000,
  }, async () => {
    const { floor } = await picks();
    const sheet = sheetWith([dim('d1', 'linear', [{ ref: floor }])]);
    // Without the drain, which would have no floor left to cut.
    const through = without(hole.id);
    await recompute({
      ...through,
      parameters: doc.parameters.map((p) =>
        p.name === 'bottom' ? { ...p, expression: '0 mm' } : p,
      ),
    });
    const [report] = resolve(sheet, 'd1');
    expect(report?.status).toBe('moved');
    expect(nameRelation(floor.id, report?.resolved?.id ?? '')).toBe(0);
    expect(length(report?.geometry)).toBeCloseTo(74, 6);
    const line = report?.geometry as { start: Vec3; end: Vec3 };
    expect([line.start[2], line.end[2]]).toEqual([0, 0]);
  });
});

describe('notes and centre lines on a plate with a hole (ADR-0143, S4)', () => {
  // A 60 × 40 × 10 plate (z 0 to 10) with a Ø8 hole through it at x = 10.
  const plate = (length: string): ExtrudoDocument =>
    testDocument([
      primitive('Plate', 'box', { numbers: { length, width: '40 mm', height: '10 mm' } }),
      primitive('Hole', 'cylinder', {
        numbers: { diameter: '8 mm', height: '10 mm', x: '10 mm' },
        operation: 'cut',
      }),
    ]);
  const body = 'Plate:0' as BodyId;
  const DRAWN_ON = 'The feature this was drawn on is deleted.';

  function notesSheet(anchors: { edge: AnchorRef; rim: AnchorRef; wall: AnchorRef }): Sheet {
    const { edge, rim, wall } = anchors;
    return {
      ...sheetWith([]),
      items: [
        {
          kind: 'leader',
          id: 'n1' as SheetItemId,
          view: 'front' as SheetViewId,
          anchor: { ref: edge },
          at: [45, 20],
          text: 'Break this edge',
        },
        {
          kind: 'leader',
          id: 'n2' as SheetItemId,
          view: 'front' as SheetViewId,
          anchor: { ref: wall },
          at: [20, 25],
          text: 'Ream',
        },
        {
          kind: 'centreMark',
          id: 'top-c1' as SheetItemId,
          view: 'top' as SheetViewId,
          anchors: [{ ref: rim }],
        },
        {
          kind: 'centreMark',
          id: 'top-c2' as SheetItemId,
          view: 'top' as SheetViewId,
          anchors: [{ ref: wall }],
        },
        {
          kind: 'centreLine',
          id: 'c3' as SheetItemId,
          view: 'front' as SheetViewId,
          anchors: [{ ref: wall }],
        },
        {
          kind: 'sticky',
          id: 'k1' as SheetItemId,
          at: [10, 10],
          size: [40, 20],
          text: 'Not anchored',
        },
      ],
    };
  }

  async function picks(doc: ExtrudoDocument) {
    await recompute(doc);
    const shape = shapeOf(body);
    const edges = kernel.describe(shape).edges;
    const rimIndex = edges.findIndex(
      (e) => e.type === 'circle' && Math.abs(e.midpoint[2] - 10) < 1e-6,
    );
    return {
      edge: edgeAt(body, [30, -20, 5]),
      rim: engine?.reference(body, 'edge', rimIndex) as AnchorRef,
      wall: faceOf(body, 'cylinder'),
    };
  }

  it('resolves each kind: an edge, a face as a point for a leader, a circle and an axis', async () => {
    const anchors = await picks(plate('60 mm'));
    const out = (engine as RecomputeEngine).resolveSheet(notesSheet(anchors));
    // Only the items with anchors, one report per anchor.
    expect(Object.keys(out).sort()).toEqual(['c3', 'n1', 'n2', 'top-c1', 'top-c2']);
    const [edge] = out['n1' as SheetItemId] ?? [];
    expect(edge).toMatchObject({
      status: 'ok',
      resolved: anchors.edge,
      geometry: { type: 'line' },
    });
    // A leader's face is a point on it: the hole wall's centroid, on its axis.
    const [dot] = out['n2' as SheetItemId] ?? [];
    expect(dot?.geometry?.type).toBe('point');
    if (dot?.geometry?.type !== 'point') throw new Error('not a point');
    expect(near(dot.geometry.point, [10, 0, 5])).toBe(true);
    const [rim] = out['top-c1' as SheetItemId] ?? [];
    expect(rim?.geometry).toMatchObject({ type: 'circle', radius: 4 });
    const [wall] = out['top-c2' as SheetItemId] ?? [];
    expect(wall?.geometry).toMatchObject({ type: 'circle', radius: 4 });
    // A centre line's face is its axis, as long as the hole.
    const [axis] = out['c3' as SheetItemId] ?? [];
    expect(axis?.status).toBe('ok');
    if (axis?.geometry?.type !== 'axis') throw new Error('not an axis');
    const { start, end } = axis.geometry;
    expect([start[0], start[1], end[0], end[1]].map((x) => Math.round(x * 1e6) / 1e6)).toEqual([
      10, 0, 10, 0,
    ]);
    expect([start[2], end[2]].sort((a, b) => a - b).map((z) => Math.round(z * 1e6) / 1e6)).toEqual([
      0, 10,
    ]);
  });

  it('a leader follows its edge when the plate gets longer', async () => {
    const anchors = await picks(plate('60 mm'));
    const sheet = notesSheet(anchors);
    await recompute(plate('80 mm'));
    const [report] = (engine as RecomputeEngine).resolveSheet(sheet)['n1' as SheetItemId] ?? [];
    expect(report?.status).not.toBe('detached');
    if (report?.geometry?.type !== 'line') throw new Error('not a line');
    expect(report.geometry.start[0]).toBeCloseTo(40, 6);
    expect(report.geometry.end[0]).toBeCloseTo(40, 6);
    // Its fingerprint point moved with it: the text follows (`followAnchors`).
    expect(report.resolved?.fingerprint?.at[0]).toBeCloseTo(40, 6);
  });

  it('the hole deleted detaches its leader, centre mark and centre line, and attaches them again when it is back', async () => {
    const doc = plate('60 mm');
    const anchors = await picks(doc);
    const sheet = notesSheet(anchors);
    await recompute({ ...doc, features: doc.features.slice(0, 1), timelineMarker: 1 });
    const gone = (engine as RecomputeEngine).resolveSheet(sheet);
    for (const id of ['n2', 'top-c1', 'top-c2', 'c3']) {
      expect(gone[id as SheetItemId], id).toEqual([{ status: 'detached', message: DRAWN_ON }]);
    }
    // The plate's own edge stays.
    expect(gone['n1' as SheetItemId]?.[0]?.status).toBe('ok');
    await recompute(doc);
    const back = (engine as RecomputeEngine).resolveSheet(sheet);
    expect(back['top-c1' as SheetItemId]?.[0]).toMatchObject({
      status: 'ok',
      resolved: anchors.rim,
      geometry: { type: 'circle', radius: 4 },
    });
    expect(back['c3' as SheetItemId]?.[0]).toMatchObject({
      status: 'ok',
      geometry: { type: 'axis' },
    });
    expect(back['n2' as SheetItemId]?.[0]?.status).toBe('ok');
  });

  it('a suppressed hole detaches them in their own words', async () => {
    const doc = plate('60 mm');
    const anchors = await picks(doc);
    const sheet = notesSheet(anchors);
    await recompute({
      ...doc,
      features: doc.features.map((f) => (f.id === 'Hole' ? { ...f, suppressed: true } : f)),
    });
    const out = (engine as RecomputeEngine).resolveSheet(sheet);
    expect(out['n2' as SheetItemId]?.[0]?.message).toBe(
      'Hole, the feature this was drawn on, is suppressed. Unsuppress it to show the note again.',
    );
    expect(out['c3' as SheetItemId]?.[0]?.message).toMatch(/show the centre line again\.$/);
    expect(out['top-c1' as SheetItemId]?.[0]?.message).toMatch(/show the centre mark again\.$/);
  });

  it("a flat face has no axis, and a centre line's axis needs a cylinder or a cone", async () => {
    const anchors = await picks(plate('60 mm'));
    const flat = faceOf(body, 'plane');
    const sheet: Sheet = {
      ...sheetWith([]),
      items: [
        {
          kind: 'centreLine',
          id: 'c1' as SheetItemId,
          view: 'front' as SheetViewId,
          anchors: [{ ref: flat }],
        },
        {
          kind: 'centreLine',
          id: 'c2' as SheetItemId,
          view: 'front' as SheetViewId,
          anchors: [{ ref: anchors.edge }, { ref: edgeAt(body, [-30, -20, 5]) }],
        },
      ],
    };
    const out = (engine as RecomputeEngine).resolveSheet(sheet);
    expect(out['c1' as SheetItemId]?.[0]).toMatchObject({
      status: 'ok',
      message: 'The face is not a cylinder or a cone: it has no axis.',
    });
    expect(out['c2' as SheetItemId]?.map((r) => r.geometry?.type)).toEqual(['line', 'line']);
  });
});
