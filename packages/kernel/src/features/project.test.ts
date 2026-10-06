// Project's new sources (P4-12, ADR-0031's amendment) through the recompute
// engine with real OCCT: silhouettes of spheres, tori and free-form faces,
// vertices, whole bodies seen along the sketch normal, and Intersect (the
// curves where a face or body meets the sketch plane).
import {
  type BodyId,
  type ExtrudoDocument,
  type Feature,
  type FeatureId,
  FeatureRegistry,
  type GeomRef,
  loftInputs,
  originPlaneRef,
  type PrimitiveType,
  type ProjectedCurve,
  type ProjectionId,
  primitiveInputs,
  type SketchData,
  type SketchReport,
  sketchInputs,
} from '@extrudo/core';
import { SketchBuilder } from '@extrudo/sketch/fixtures';
import { detectProfiles } from '@extrudo/sketch/profiles';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { SubShapeKind } from '../history';
import { Kernel, type ShapeHandle, type Vec3 } from '../kernel';
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

const refs = (list: GeomRef[]) => ({ kind: 'ref' as const, refs: list });
const length = (expr: string) => ({ kind: 'expr' as const, expr, unit: 'length' as const });
const angle = (expr: string) => ({ kind: 'expr' as const, expr, unit: 'angle' as const });

function primitive(
  id: string,
  type: PrimitiveType,
  numbers: Record<string, string>,
  plane?: GeomRef,
): Feature {
  return {
    ...testFeature(id, type),
    inputs: primitiveInputs(type, { numbers, ...(plane && { plane }) }),
  };
}

const offsetPlane = (id: string, distance: string): Feature => ({
  ...testFeature(id, 'offsetPlane'),
  inputs: { plane: refs([originPlaneRef('origin:xy')]), distance: length(distance) },
});

type Source = { ref: GeomRef; mode?: 'intersect' };

/** A sketch on `plane` that projects (or intersects) the sources as P0, P1…, no curves yet. */
function projecting(id: string, plane: GeomRef, sources: Source[], data?: SketchData): Feature {
  const sketch: SketchData = data ?? { entities: {}, constraints: {}, dimensions: {} };
  return {
    ...testFeature(id, 'sketch'),
    inputs: sketchInputs(plane, {
      ...sketch,
      projections: Object.fromEntries(
        sources.map(({ ref, mode }, i) => [`P${i}`, { ref, curves: {}, ...(mode && { mode }) }]),
      ),
    }),
  };
}

const plane = (id: string): GeomRef => ({ kind: 'plane', id });
const body = (id: string): GeomRef => ({ kind: 'body', id });

/** The curves a projection reported (fails on a lost one). */
function curvesOf(result: Done, sketch: string, projection = 'P0'): Record<string, ProjectedCurve> {
  const report = result.reports[sketch as FeatureId] as SketchReport | undefined;
  const p = report?.projections?.[projection as ProjectionId];
  if (!p?.curves) throw new Error(`${sketch}/${projection}: ${JSON.stringify(p)}`);
  return p.curves;
}

/** A reference, with its fingerprint, to a sub-shape by index in the last recompute. */
function refAt(result: Done, kind: SubShapeKind, index: number, bodyIndex = 0): GeomRef {
  const b = result.bodies[bodyIndex];
  const ref = b && engine.reference(b.id, kind, index);
  if (!ref) throw new Error(`no ${kind} ${index}`);
  return ref;
}

function shapeOf(result: Done, bodyIndex = 0): ShapeHandle {
  const id = result.bodies[bodyIndex]?.id as BodyId;
  const shape = engine.latestBody(id);
  if (shape === undefined) throw new Error(`no body ${id}`);
  return shape;
}

const radiiOf = (curves: Record<string, ProjectedCurve>) =>
  Object.values(curves)
    .flatMap((c) => (c.type === 'circle' ? [c.radius] : []))
    .sort((a, b) => a - b);

describe('silhouettes of every surface', () => {
  it('projects a sphere above the sketch as one exact circle, as a face and as a body', async () => {
    const features = [
      primitive('SP', 'sphere', { diameter: '20 mm', x: '5 mm', y: '-3 mm' }),
      offsetPlane('OP', '40 mm'),
    ];
    const first = ok(await run(testDocument(features)));
    const face = refAt(first, 'face', 0);
    const doc = testDocument([
      ...features,
      projecting('S', plane('OP'), [{ ref: face }, { ref: body(first.bodies[0]?.id as string) }]),
    ]);
    const result = ok(await run(doc));
    for (const projection of ['P0', 'P1']) {
      const curves = Object.values(curvesOf(result, 'S', projection));
      expect(curves).toHaveLength(1);
      const circle = curves[0];
      expect(circle?.type).toBe('circle');
      if (circle?.type !== 'circle') continue;
      expect(circle.radius).toBe(10);
      expect(circle.center[0]).toBeCloseTo(5, 9);
      expect(circle.center[1]).toBeCloseTo(-3, 9);
    }
  });

  it('gives a torus seen along its axis two circles, and from the side curves on it', async () => {
    const features = [
      primitive('T', 'torus', { diameter: '40 mm', tube: '10 mm' }),
      offsetPlane('OP', '20 mm'),
    ];
    const first = ok(await run(testDocument(features)));
    const id = first.bodies[0]?.id as string;
    const result = ok(
      await run(
        testDocument([
          ...features,
          projecting('S', plane('OP'), [{ ref: body(id) }]),
          projecting('F', originPlaneRef('origin:xz'), [{ ref: body(id) }]),
        ]),
      ),
    );
    const along = curvesOf(result, 'S');
    expect(Object.values(along).map((c) => c.type)).toEqual(['circle', 'circle']);
    const [inner, outer] = radiiOf(along);
    expect(inner).toBeCloseTo(15, 6);
    expect(outer).toBeCloseTo(25, 9);

    // From the front (XZ): the tube's two cross-section circles, and the top and
    // bottom circles seen edge-on as two lines (each walked twice, once in front).
    const side = Object.values(curvesOf(result, 'F'));
    expect(side.map((c) => c.type).sort()).toEqual(['circle', 'circle', 'line', 'line']);
    const tubes = side.flatMap((c) => (c.type === 'circle' ? [c] : []));
    expect(tubes.map((c) => c.radius)).toEqual([5, 5]);
    expect(tubes.map((c) => Math.abs(c.center[0])).sort()).toEqual([20, 20]);

    // The facade's own samples lie on the torus.
    const shape = shapeOf(first);
    for (const direction of [
      [0, 1, 0],
      [0.3, 1, 2],
    ] as Vec3[]) {
      const pieces = kernel.faceSilhouettes(shape, 0, direction);
      const points = pieces.flatMap((p) => (p.type === 'polyline' ? p.points : []));
      expect(points.length).toBeGreaterThan(50);
      for (const [x, y, z] of points) {
        expect(Math.abs((Math.hypot(x, y) - 20) ** 2 + z * z - 25)).toBeLessThan(1e-6);
      }
    }
  });

  it("finds a free-form loft's silhouettes on its surface", async () => {
    const bottom = new SketchBuilder();
    bottom.circle(0, 0, 10);
    const top = new SketchBuilder();
    top.ellipse(3, 2, 14, 6, 0.4);
    const profile = (sketch: string, data: SketchData): GeomRef => ({
      kind: 'profile',
      id: `${sketch}/${detectProfiles(data)[0]?.id}`,
    });
    const features: Feature[] = [
      {
        ...testFeature('A', 'sketch'),
        inputs: sketchInputs(originPlaneRef('origin:xy'), bottom.sketch),
      },
      offsetPlane('OP', '30 mm'),
      { ...testFeature('B', 'sketch'), inputs: sketchInputs(plane('OP'), top.sketch) },
      {
        ...testFeature('L', 'loft'),
        inputs: loftInputs([profile('A', bottom.sketch), profile('B', top.sketch)]),
      },
    ];
    const first = ok(await run(testDocument(features)));
    const shape = shapeOf(first);
    const faces = kernel.describe(shape).faces;
    const side = faces.findIndex((f) => f.type !== 'plane');
    expect(side).toBeGreaterThanOrEqual(0);
    using scope = kernel.scope();
    const face = scope.track(kernel.subShape(shape, 'face', side));
    let checked = 0;
    for (const direction of [
      [0, 1, 0],
      [1, 0.5, 0.3],
    ] as Vec3[]) {
      const pieces = kernel.faceSilhouettes(shape, side, direction);
      const points = pieces.flatMap((p) => (p.type === 'polyline' ? p.points : []));
      expect(points.length).toBeGreaterThan(20);
      const step = Math.max(1, Math.floor(points.length / 25));
      for (let i = 0; i < points.length; i += step) {
        const probe = scope.track(kernel.box([1e-6, 1e-6, 1e-6], points[i] as Vec3));
        expect(kernel.distance(probe, face)).toBeLessThan(1e-4);
        checked++;
      }
    }
    expect(checked).toBeGreaterThanOrEqual(50);

    // Projected into a sketch on XZ, a smooth run is a control-point spline, not lines.
    const result = ok(
      await run(
        testDocument([
          ...features,
          projecting('F', originPlaneRef('origin:xz'), [{ ref: refAt(first, 'face', side) }]),
        ]),
      ),
    );
    // (A smooth boundary edge the contour runs along comes as that edge: a line here.)
    const silhouettes = Object.entries(curvesOf(result, 'F'))
      .filter(([k]) => k.startsWith('sil:'))
      .map(([, c]) => c);
    expect(silhouettes.length).toBeLessThan(8);
    const splines = silhouettes.filter((c) => c.type === 'spline');
    expect(splines.length).toBeGreaterThan(0);
    for (const curve of splines) expect(curve).toMatchObject({ mode: 'control' });
  });
});

describe('vertices and bodies', () => {
  it('projects a vertex to its point', async () => {
    const features = [primitive('B', 'box', { length: '20 mm', width: '10 mm', height: '5 mm' })];
    const first = ok(await run(testDocument(features)));
    const description = kernel.describe(shapeOf(first));
    const index = description.vertices.findIndex(
      (v) => v.point[0] > 0 && v.point[1] > 0 && v.point[2] > 0,
    );
    const vertex = refAt(first, 'vertex', index);
    const result = ok(
      await run(
        testDocument([
          ...features,
          projecting('S', originPlaneRef('origin:xy'), [{ ref: vertex }]),
        ]),
      ),
    );
    expect(curvesOf(result, 'S')).toEqual({ vertex: { type: 'point', at: [10, 5] } });
  });

  it('projects a box onto a plane at 30 degrees as its outline and its visible edges', async () => {
    const features: Feature[] = [
      primitive('B', 'box', { length: '20 mm', width: '10 mm', height: '5 mm' }),
      {
        ...testFeature('PA', 'planeAtAngle'),
        inputs: { axis: refs([{ kind: 'axis', id: 'origin:x' }]), angle: angle('30 deg') },
      },
    ];
    const first = ok(await run(testDocument(features)));
    const result = ok(
      await run(
        testDocument([
          ...features,
          projecting('S', plane('PA'), [{ ref: body(first.bodies[0]?.id as string) }]),
        ]),
      ),
    );
    const curves = Object.values(curvesOf(result, 'S'));
    // Seen at 30° about X the four edges along X are the outline's long sides and the
    // seen face's middle line; the eight others are seen end-on or on the short sides.
    expect(curves.every((c) => c.type === 'line')).toBe(true);
    const lines = curves.flatMap((c) => (c.type === 'line' ? [c] : []));
    const xs = lines.flatMap((l) => [l.a[0], l.b[0]]);
    expect(Math.min(...xs)).toBeCloseTo(-10, 9);
    expect(Math.max(...xs)).toBeCloseTo(10, 9);
    // Three distinct long lines (the outline's two and the edge between the seen faces).
    const long = lines.filter((l) => Math.abs(l.a[0] - l.b[0]) > 19);
    expect(new Set(long.map((l) => l.a[1].toFixed(6))).size).toBe(3);
    // No curve twice.
    expect(curves.length).toBe(new Set(curves.map((c) => JSON.stringify(c))).size);
  });

  it('reports a lost body as lost, with a warning', async () => {
    const features = [primitive('B', 'box', {})];
    const result = await run(
      testDocument([
        ...features,
        projecting('S', originPlaneRef('origin:xy'), [{ ref: body('nothing') }]),
      ]),
    );
    const report = result.reports['S' as FeatureId] as SketchReport;
    expect(report.projections?.['P0' as ProjectionId]).toEqual({ lost: true });
    expect(result.features['S' as FeatureId]?.status).toBe('warning');
    expect(result.features['S' as FeatureId]?.message).toMatch(/Lost a projected body/);
  });
});

describe('intersect', () => {
  it('cuts a cylinder with an oblique plane into one exact ellipse', async () => {
    // From z = −20 to 20, so the plane at 45° through the X axis only meets its wall.
    const features: Feature[] = [
      primitive('C', 'cylinder', { diameter: '20 mm', height: '40 mm', offset: '-20 mm' }),
      {
        ...testFeature('PB', 'planeAtAngle'),
        inputs: { axis: refs([{ kind: 'axis', id: 'origin:x' }]), angle: angle('45 deg') },
      },
    ];
    const first = ok(await run(testDocument(features)));
    const id = first.bodies[0]?.id as string;
    const side = kernel.describe(shapeOf(first)).faces.findIndex((f) => f.type === 'cylinder');
    const result = ok(
      await run(
        testDocument([
          ...features,
          projecting('S', plane('PB'), [
            { ref: body(id), mode: 'intersect' },
            { ref: refAt(first, 'face', side), mode: 'intersect' },
          ]),
        ]),
      ),
    );
    for (const projection of ['P0', 'P1']) {
      const curves = Object.values(curvesOf(result, 'S', projection));
      expect(curves.map((c) => c.type)).toEqual(['ellipse']);
      const e = curves[0];
      if (e?.type !== 'ellipse') continue;
      const semi = ([x, y]: readonly [number, number]) =>
        Math.hypot(x - e.center[0], y - e.center[1]);
      expect(semi(e.major)).toBeCloseTo(10 * Math.SQRT2, 8);
      expect(semi(e.minor)).toBeCloseTo(10, 9);
    }
  });
});
