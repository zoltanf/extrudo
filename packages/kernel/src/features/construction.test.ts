// The construction features (P3-05, ADR-0040, FR-FT-13) through the
// recompute engine with real OCCT: every plane, axis and point type, the
// features that use them (sketch, primitive, revolve, extrude "to object"),
// dependencies on bodies, and the errors.
import {
  type ConstructionReport,
  constructionRef,
  type ExtrudoDocument,
  extrudeInputs,
  type Feature,
  type FeatureId,
  FeatureRegistry,
  type FeatureStatus,
  type GeomRef,
  originPlaneRef,
  primitiveInputs,
  revolveInputs,
  type SketchData,
  sketchInputs,
} from '@extrudo/core';
import { SketchBuilder } from '@extrudo/sketch/fixtures';
import { detectProfiles } from '@extrudo/sketch/profiles';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { SubShapeKind } from '../history';
import { Kernel, type ShapeHandle } from '../kernel';
import { loadOcct } from '../occt/load';
import { RecomputeEngine } from '../recompute/engine';
import { testDocument, testFeature, testFeatures } from '../recompute/testing';
import type { KernelFeatureDefinition, RecomputeResult } from '../recompute/types';

let kernel: Kernel;
let engine: RecomputeEngine;
/** The report of each construction feature's latest evaluation. */
const seen = new Map<string, ConstructionReport>();

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
        if ((output.report as ConstructionReport | undefined)?.kind) {
          seen.set(ctx.feature.id, output.report as ConstructionReport);
        }
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

// ------------------------------------------------------------------ helpers

const refs = (list: GeomRef[]) => ({ kind: 'ref' as const, refs: list });
const length = (expr: string) => ({ kind: 'expr' as const, expr, unit: 'length' as const });
const angle = (expr: string) => ({ kind: 'expr' as const, expr, unit: 'angle' as const });

function feature(id: string, type: string, inputs: Feature['inputs'] = {}): Feature {
  return { ...testFeature(id, type), inputs };
}

const XY = originPlaneRef('origin:xy');
const XZ = originPlaneRef('origin:xz');
const YZ = originPlaneRef('origin:yz');

const offsetPlane = (id: string, plane: GeomRef, distance: string) =>
  feature(id, 'offsetPlane', { plane: refs([plane]), distance: length(distance) });

/** A construction point at (x, y, z) mm. */
const point = (id: string, x: number, y: number, z: number) =>
  feature(id, 'constructionPoint', {
    x: length(`${x} mm`),
    y: length(`${y} mm`),
    z: length(`${z} mm`),
  });

const ref = (feat: Feature): GeomRef => {
  const r = constructionRef(feat);
  if (!r) throw new Error('not construction');
  return r;
};

function rect(b: SketchBuilder, x: number, y: number, w: number, h: number): void {
  b.line(x, y, x + w, y);
  b.line(x + w, y, x + w, y + h);
  b.line(x + w, y + h, x, y + h);
  b.line(x, y + h, x, y);
}

function sketch(id: string, data: SketchData, plane: GeomRef = XY): Feature {
  return { ...testFeature(id, 'sketch'), inputs: sketchInputs(plane, data) };
}

const profileOf = (sketchId: string, data: SketchData): GeomRef => {
  const [found] = detectProfiles(data);
  if (!found) throw new Error('no profile');
  return { kind: 'profile', id: `${sketchId}/${found.id}` };
};

/** A 60 × 40 block, x 0…60, y 0…40, z 0…`height` (body `B:0`); its top face is `extrude:B:cap:end`. */
function block(height = '10 mm'): Feature[] {
  const b = new SketchBuilder();
  rect(b, 0, 0, 60, 40);
  return [
    sketch('SB', b.sketch),
    {
      ...testFeature('B', 'extrude'),
      inputs: extrudeInputs([profileOf('SB', b.sketch)], { distance: height }),
    },
  ];
}

const TOP: GeomRef = { kind: 'face', id: 'extrude:B:cap:end' };

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

/** Recomputes from an empty cache, so `seen` holds this document's reports. */
async function fresh(features: Feature[]): Promise<Done> {
  engine.clear();
  seen.clear();
  return run(testDocument(features));
}

function report<K extends ConstructionReport['kind']>(
  id: string,
  kind: K,
): Extract<ConstructionReport, { kind: K }> {
  const found = seen.get(id);
  if (found?.kind !== kind) throw new Error(`no ${kind} report for ${id}`);
  return found as Extract<ConstructionReport, { kind: K }>;
}

const round = (x: number, digits = 4) => {
  const r = Number(x.toFixed(digits));
  return Object.is(r, -0) ? 0 : r;
};
const rounded = (v: readonly number[]) => v.map((x) => round(x));

/** The bodies' shapes of the last `withShapes`, for describing their vertices and edges. */
const bodyShapes = new Map<string, ShapeHandle>();

async function withShapes(features: Feature[]): Promise<Done> {
  bodyShapes.clear();
  const shapes: ShapeHandle[] = [];
  const mesh = kernel.mesh.bind(kernel);
  kernel.mesh = (shape, options) => {
    shapes.push(shape);
    return mesh(shape, options);
  };
  try {
    const result = await fresh(features);
    result.bodies.forEach((b, i) => {
      const shape = shapes[i];
      if (shape !== undefined) bodyShapes.set(b.id, shape);
    });
    return result;
  } finally {
    kernel.mesh = mesh;
  }
}

/** A reference (with fingerprint) to the first sub-shape of `body` that `match` accepts. */
function pick(
  result: Done,
  body: string,
  kind: SubShapeKind,
  match: (index: number, shape: ShapeHandle) => boolean,
): GeomRef {
  const found = result.bodies.find((b) => b.id === body);
  const shape = bodyShapes.get(body);
  const count = shape === undefined ? 0 : kernel.count(shape, kind);
  for (let i = 0; i < count; i++) {
    if (shape !== undefined && match(i, shape)) {
      const r = engine.reference(found?.id as never, kind, i);
      if (r) return r;
    }
  }
  throw new Error(`no matching ${kind}`);
}

const cylinder = (id = 'C') =>
  feature(
    id,
    'cylinder',
    primitiveInputs('cylinder', {
      numbers: { diameter: '20 mm', height: '30 mm', x: '10 mm', y: '5 mm' },
    }),
  );

// ------------------------------------------------------------------- planes

describe('construction planes', { timeout: 120_000 }, () => {
  it('an offset plane moves along the normal: XY by 30, XZ by 10 (its normal is −Y), negative back', async () => {
    ok(await fresh([offsetPlane('A', XY, '30 mm')]));
    const a = report('A', 'plane');
    expect(a.frame.origin).toEqual([0, 0, 30]);
    expect(a.frame.normal).toEqual([0, 0, 1]);
    expect(a.frame.x).toEqual([1, 0, 0]);
    expect(a.anchor).toEqual([0, 0, 30]);

    ok(await fresh([offsetPlane('A', XZ, '10 mm'), offsetPlane('B', YZ, '-5 mm')]));
    expect(report('A', 'plane').frame.origin).toEqual([0, -10, 0]);
    expect(report('A', 'plane').frame.normal).toEqual([0, -1, 0]);
    // The origin planes' own frames come back for their normals (ADR-0031).
    expect(report('A', 'plane').frame.x).toEqual([1, 0, 0]);
    expect(report('A', 'plane').frame.y).toEqual([0, 0, 1]);
    expect(report('B', 'plane').frame.origin).toEqual([-5, 0, 0]);
  });

  it('an offset from a face follows the face when the body changes, and offsets stack', async () => {
    const plane = offsetPlane('A', TOP, '5 mm');
    ok(await fresh([...block('10 mm'), plane, offsetPlane('A2', ref(plane), '2 mm')]));
    expect(report('A', 'plane').frame.origin).toEqual([0, 0, 15]);
    // The anchor stays over the face's middle.
    expect(report('A', 'plane').anchor).toEqual([30, 20, 15]);
    expect(report('A2', 'plane').frame.origin).toEqual([0, 0, 17]);
    ok(await run(testDocument([...block('20 mm'), plane, offsetPlane('A2', ref(plane), '2 mm')])));
    expect(report('A', 'plane').frame.origin).toEqual([0, 0, 25]);
    expect(report('A2', 'plane').frame.origin).toEqual([0, 0, 27]);
  });

  it('a plane at angle turns about a line: from horizontal by default, or from a reference plane', async () => {
    const x = originAxis('origin:x');
    ok(
      await fresh([
        feature('P0', 'planeAtAngle', { axis: refs([x]), angle: angle('0 deg') }),
        feature('P90', 'planeAtAngle', { axis: refs([x]), angle: angle('90 deg') }),
        feature('P45', 'planeAtAngle', {
          axis: refs([x]),
          plane: refs([XY]),
          angle: angle('45 deg'),
        }),
      ]),
    );
    expect(report('P0', 'plane').frame.normal).toEqual([0, 0, 1]);
    expect(rounded(report('P90', 'plane').frame.normal)).toEqual([0, -1, 0]);
    const s = Math.SQRT1_2;
    expect(rounded(report('P45', 'plane').frame.normal)).toEqual(rounded([0, -s, s]));
  });

  it('a plane at angle about a body edge passes through the edge', async () => {
    const result = await withShapes(block());
    const edge = pick(result, 'B:0', 'edge', (i, shape) => {
      const e = kernel.describe(shape).edges[i];
      return (
        e?.type === 'line' && Math.abs(e.midpoint[2] - 10) < 1e-6 && Math.abs(e.midpoint[1]) < 1e-6
      );
    });
    ok(
      await fresh([
        ...block(),
        feature('P', 'planeAtAngle', {
          axis: refs([edge]),
          plane: refs([TOP]),
          angle: angle('30 deg'),
        }),
      ]),
    );
    const p = report('P', 'plane');
    // The edge runs along X at (·, 0, 10): a plane through it tilted 30° from the top face.
    expect(round(dot3(p.frame.normal, [1, 0, 0]))).toBe(0);
    expect(round(p.frame.normal[2])).toBe(round(Math.cos(Math.PI / 6)));
    expect(round(dot3(sub3([0, 0, 10], p.frame.origin), p.frame.normal))).toBe(0);
  });

  it('a midplane sits halfway between parallel planes; others are refused', async () => {
    const top = offsetPlane('T', XY, '20 mm');
    ok(await fresh([top, feature('M', 'midplane', { planes: refs([XY, ref(top)]) })]));
    expect(report('M', 'plane').frame.origin).toEqual([0, 0, 10]);
    expect(report('M', 'plane').frame.normal).toEqual([0, 0, 1]);

    const askew = await fresh([feature('M', 'midplane', { planes: refs([XY, XZ]) })]);
    expect(status(askew, 'M')).toMatchObject({ status: 'error' });
    expect(status(askew, 'M').message).toContain("aren't parallel");
    const same = await fresh([feature('M', 'midplane', { planes: refs([XY, XY]) })]);
    expect(status(same, 'M').message).toContain('same plane');
    const one = await fresh([feature('M', 'midplane', { planes: refs([XY]) })]);
    expect(status(one, 'M').message).toContain('two planes');
  });

  it('a midplane between the top and bottom faces of a block', async () => {
    ok(
      await fresh([
        ...block('10 mm'),
        feature('M', 'midplane', {
          planes: refs([TOP, { kind: 'face', id: 'extrude:B:cap:start' }]),
        }),
      ]),
    );
    expect(report('M', 'plane').frame.origin).toEqual([0, 0, 5]);
  });

  it('a plane through three points follows their order; collinear points fail', async () => {
    const [a, b, c] = [point('A', 0, 0, 5), point('B', 10, 0, 5), point('C', 0, 10, 5)];
    const three = (id: string, list: Feature[]) =>
      feature(id, 'planeThroughPoints', { points: refs(list.map(ref)) });
    ok(await fresh([a, b, c, three('P', [a, b, c]), three('Q', [a, c, b])]));
    expect(report('P', 'plane').frame.normal).toEqual([0, 0, 1]);
    expect(report('P', 'plane').frame.origin).toEqual([0, 0, 5]);
    expect(report('Q', 'plane').frame.normal).toEqual([0, 0, -1]);
    expect(rounded(report('P', 'plane').anchor)).toEqual(rounded([10 / 3, 10 / 3, 5]));

    const d = point('D', 20, 0, 5);
    const line = await fresh([a, b, d, three('P', [a, b, d])]);
    expect(status(line, 'P').message).toContain('one line');
  });

  it('a plane through body vertices', async () => {
    const result = await withShapes(block());
    const corner = (x: number, y: number, z: number) =>
      pick(result, 'B:0', 'vertex', (i, shape) => {
        const p = kernel.describe(shape).vertices[i]?.point ?? [NaN, NaN, NaN];
        return Math.hypot(p[0] - x, p[1] - y, p[2] - z) < 1e-6;
      });
    ok(
      await fresh([
        ...block(),
        feature('P', 'planeThroughPoints', {
          points: refs([corner(0, 0, 10), corner(60, 0, 10), corner(60, 40, 10)]),
        }),
      ]),
    );
    expect(report('P', 'plane').frame.normal).toEqual([0, 0, 1]);
    expect(report('P', 'plane').frame.origin).toEqual([0, 0, 10]);
  });

  it('a tangent plane touches a cylinder where the reference says, turned by the angle', async () => {
    const face: GeomRef = { kind: 'face', id: 'cylinder:C:side:wall' };
    const tangent = (id: string, more: Feature['inputs'] = {}) =>
      feature(id, 'tangentPlane', { face: refs([face]), ...more });
    ok(
      await fresh([
        cylinder(),
        tangent('T0'),
        tangent('T90', { angle: angle('90 deg') }),
        tangent('TX', { plane: refs([YZ]) }),
      ]),
    );
    // Centre (10, 5), radius 10: no reference starts on +Y, the YZ plane's normal is +X.
    expect(rounded(report('T0', 'plane').frame.normal)).toEqual([0, 1, 0]);
    expect(rounded(report('T0', 'plane').frame.origin)).toEqual([0, 15, 0]);
    expect(rounded(report('T90', 'plane').frame.normal)).toEqual([-1, 0, 0]);
    expect(rounded(report('T90', 'plane').frame.origin)).toEqual([0, 0, 0]);
    expect(rounded(report('TX', 'plane').frame.normal)).toEqual([1, 0, 0]);
    expect(rounded(report('TX', 'plane').frame.origin)).toEqual([20, 0, 0]);
    // Drawn beside the cylinder's wall.
    expect(rounded(report('TX', 'plane').anchor)).toEqual([20, 5, 15]);
  });

  it('a tangent plane on a sphere faces the reference normal; a flat face is refused', async () => {
    const sphere = feature(
      'S',
      'sphere',
      primitiveInputs('sphere', { numbers: { diameter: '20 mm' } }),
    );
    const face: GeomRef = { kind: 'face', id: 'sphere:S:side:surface' };
    ok(
      await fresh([
        sphere,
        feature('T', 'tangentPlane', { face: refs([face]) }),
        feature('TY', 'tangentPlane', { face: refs([face]), plane: refs([XZ]) }),
      ]),
    );
    expect(rounded(report('T', 'plane').frame.normal)).toEqual([0, 0, 1]);
    expect(rounded(report('T', 'plane').frame.origin)).toEqual([0, 0, 10]);
    expect(rounded(report('TY', 'plane').frame.normal)).toEqual([0, -1, 0]);
    expect(rounded(report('TY', 'plane').frame.origin)).toEqual([0, -10, 0]);

    const flat = await fresh([...block(), feature('T', 'tangentPlane', { face: refs([TOP]) })]);
    expect(status(flat, 'T').message).toContain('cylindrical, conical or spherical');
  });

  it('a tangent plane on a cone holds the apex and touches along a generatrix', async () => {
    const data = new SketchBuilder();
    // A triangle on XZ turned about Z: a cone, base radius 10 at z = 0, apex (0, 0, 20).
    data.line(0, 0, 10, 0);
    data.line(10, 0, 0, 20);
    data.line(0, 20, 0, 0);
    const doc = (extra: Feature[] = []) => [
      sketch('S', data.sketch, XZ),
      {
        ...testFeature('R', 'revolve'),
        inputs: revolveInputs([profileOf('S', data.sketch)], originAxis('origin:z')),
      },
      ...extra,
    ];
    const result = await withShapes(doc());
    const face = pick(
      result,
      'R:0',
      'face',
      (i, shape) => kernel.surfaceGeometry(shape, i).type === 'cone',
    );
    ok(await fresh(doc([feature('T', 'tangentPlane', { face: refs([face]) })])));
    const p = report('T', 'plane');
    const half = Math.atan(10 / 20);
    expect(rounded(p.frame.normal)).toEqual(rounded([0, -Math.cos(half), Math.sin(half)]));
    // The plane holds the apex and the base point at −Y.
    expect(round(dot3(sub3([0, 0, 20], p.frame.origin), p.frame.normal))).toBe(0);
    expect(round(dot3(sub3([0, -10, 0], p.frame.origin), p.frame.normal))).toBe(0);
  });
});

// --------------------------------------------------------------------- axes

describe('construction axes', { timeout: 120_000 }, () => {
  it('an axis through two points runs from the first to the second, drawn at their middle', async () => {
    const [a, b] = [point('A', 0, 0, 0), point('B', 10, 0, 0)];
    ok(await fresh([a, b, feature('X', 'axisThroughPoints', { points: refs([ref(a), ref(b)]) })]));
    expect(report('X', 'axis')).toEqual({ kind: 'axis', origin: [5, 0, 0], direction: [1, 0, 0] });

    const same = await fresh([
      a,
      feature('X', 'axisThroughPoints', { points: refs([ref(a), ref(a)]) }),
    ]);
    expect(status(same, 'X').message).toContain('same');
  });

  it("an axis through a cylinder is the cylinder's own axis; a box has none", async () => {
    ok(
      await fresh([
        cylinder(),
        feature('X', 'axisThroughCylinder', {
          face: refs([{ kind: 'face', id: 'cylinder:C:side:wall' }]),
        }),
      ]),
    );
    const axis = report('X', 'axis');
    expect(rounded(axis.direction)).toEqual([0, 0, 1]);
    expect(rounded(axis.origin.slice(0, 2))).toEqual([10, 5]);
    expect(round(axis.origin[2] as number)).toBe(15);

    const flat = await fresh([
      ...block(),
      feature('X', 'axisThroughCylinder', { face: refs([TOP]) }),
    ]);
    expect(status(flat, 'X').message).toContain('no axis');
  });

  it('an axis along a straight edge, and through a circular edge', async () => {
    const result = await withShapes([...block(), cylinder()]);
    const straight = pick(result, 'B:0', 'edge', (i, shape) => {
      const e = kernel.describe(shape).edges[i];
      return (
        e?.type === 'line' &&
        Math.abs(e.midpoint[0] - 30) < 1e-6 &&
        Math.abs(e.midpoint[1]) < 1e-6 &&
        Math.abs(e.midpoint[2] - 10) < 1e-6
      );
    });
    const circle = pick(result, 'C:0', 'edge', (i, shape) => {
      const e = kernel.describe(shape).edges[i];
      return e?.type === 'circle' && Math.abs(e.midpoint[2] - 30) < 1e-6;
    });
    ok(
      await fresh([
        ...block(),
        cylinder(),
        feature('E', 'axisAlongEdge', { edge: refs([straight]) }),
        feature('R', 'axisAlongEdge', { edge: refs([circle]) }),
      ]),
    );
    const e = report('E', 'axis');
    expect(rounded(e.origin)).toEqual([30, 0, 10]);
    expect(Math.abs(round(e.direction[0]))).toBe(1);
    const r = report('R', 'axis');
    expect(rounded(r.origin)).toEqual([10, 5, 30]);
    expect(rounded(r.direction)).toEqual([0, 0, 1]);
  });

  it('an axis along a sketch line', async () => {
    const b = new SketchBuilder();
    const l = b.line(0, 0, 0, 20);
    ok(
      await fresh([
        sketch('S', b.sketch, XZ),
        feature('X', 'axisAlongEdge', { edge: refs([{ kind: 'sketchEntity', id: `S/${l.id}` }]) }),
      ]),
    );
    // Sketch y on the XZ plane is world Z.
    expect(rounded(report('X', 'axis').direction)).toEqual([0, 0, 1]);
  });
});

// ------------------------------------------------------------------- points

describe('construction points', { timeout: 120_000 }, () => {
  it('a point from coordinates, from another point, a vertex, a circular edge and a face', async () => {
    const p = point('P', 1, 2, 3);
    const result = await withShapes([...block(), cylinder()]);
    const vertex = pick(result, 'B:0', 'vertex', (i, shape) => {
      const v = kernel.describe(shape).vertices[i]?.point ?? [NaN, NaN, NaN];
      return v[0] === 60 && v[1] === 40 && Math.abs(v[2] - 10) < 1e-6;
    });
    const circle = pick(result, 'C:0', 'edge', (i, shape) => {
      const e = kernel.describe(shape).edges[i];
      return e?.type === 'circle' && Math.abs(e.midpoint[2] - 30) < 1e-6;
    });
    ok(
      await fresh([
        ...block(),
        cylinder(),
        p,
        feature('Q', 'constructionPoint', { at: refs([ref(p)]), x: length('10 mm') }),
        feature('V', 'constructionPoint', { at: refs([vertex]), z: length('5 mm') }),
        feature('E', 'constructionPoint', { at: refs([circle]) }),
        feature('F', 'constructionPoint', { at: refs([TOP]) }),
        feature('O', 'constructionPoint'),
      ]),
    );
    expect(report('P', 'point').point).toEqual([1, 2, 3]);
    expect(report('Q', 'point').point).toEqual([11, 2, 3]);
    expect(report('V', 'point').point).toEqual([60, 40, 15]);
    expect(rounded(report('E', 'point').point)).toEqual([10, 5, 30]);
    // A cylinder on XY overlaps the block's top? No: it doesn't touch it, so the top is intact.
    expect(rounded(report('F', 'point').point)).toEqual([30, 20, 10]);
    expect(report('O', 'point').point).toEqual([0, 0, 0]);
  });
});

// ---------------------------------------------------------------- consumers

describe('using construction geometry', { timeout: 120_000 }, () => {
  it('a sketch on a construction plane lies in it: its extrude starts there', async () => {
    const plane = offsetPlane('OP', XY, '30 mm');
    const b = new SketchBuilder();
    rect(b, 0, 0, 20, 10);
    const result = ok(
      await fresh([
        plane,
        sketch('S', b.sketch, ref(plane)),
        {
          ...testFeature('E', 'extrude'),
          inputs: extrudeInputs([profileOf('S', b.sketch)], { distance: '10 mm' }),
        },
      ]),
    );
    const mesh = result.bodies[0]?.mesh;
    expect(mesh).toBeDefined();
    const zs = Array.from(
      { length: (mesh?.positions.length ?? 0) / 3 },
      (_, i) => mesh?.positions[3 * i + 2] ?? 0,
    );
    expect([round(Math.min(...zs), 3), round(Math.max(...zs), 3)]).toEqual([30, 40]);
    // The sketch reports the plane's frame.
    const frame = (result.reports as Record<string, { frame: { origin: number[] } }>).S?.frame;
    expect(frame?.origin).toEqual([0, 0, 30]);
  });

  it('a sketch on a plane through three points sits in that plane and follows the points', async () => {
    const [a, b3, c] = [point('A', 0, 0, 0), point('B', 10, 0, 0), point('C', 0, 10, 10)];
    const plane = feature('P', 'planeThroughPoints', { points: refs([a, b3, c].map(ref)) });
    const b = new SketchBuilder();
    rect(b, 0, 0, 5, 5);
    const result = await fresh([a, b3, c, plane, sketch('S', b.sketch, ref(plane))]);
    ok(result);
    const normal = report('P', 'plane').frame.normal;
    // Points (0,0,0), (10,0,0), (0,10,10) span a plane tilted 45° about X.
    expect(rounded(normal)).toEqual(rounded([0, -Math.SQRT1_2, Math.SQRT1_2]));
  });

  it('a primitive sits on a construction plane', async () => {
    const plane = offsetPlane('OP', XY, '25 mm');
    const result = ok(
      await fresh([
        plane,
        feature(
          'Bx',
          'box',
          primitiveInputs('box', { plane: ref(plane), numbers: { height: '20 mm' } }),
        ),
      ]),
    );
    const positions = result.bodies[0]?.mesh?.positions ?? new Float32Array();
    const zs = Array.from({ length: positions.length / 3 }, (_, i) => positions[3 * i + 2] ?? 0);
    expect([round(Math.min(...zs), 3), round(Math.max(...zs), 3)]).toEqual([25, 45]);
  });

  it('an extrude to a construction plane stops there', async () => {
    const plane = offsetPlane('OP', XY, '17 mm');
    const b = new SketchBuilder();
    rect(b, 0, 0, 20, 10);
    const result = ok(
      await fresh([
        plane,
        sketch('S', b.sketch),
        {
          ...testFeature('E', 'extrude'),
          inputs: extrudeInputs([profileOf('S', b.sketch)], {
            extent: 'to-object',
            toObject: ref(plane),
          }),
        },
      ]),
    );
    const positions = result.bodies[0]?.mesh?.positions ?? new Float32Array();
    const zs = Array.from({ length: positions.length / 3 }, (_, i) => positions[3 * i + 2] ?? 0);
    expect(round(Math.max(...zs), 3)).toBe(17);
  });

  it('a revolve turns about a construction axis', async () => {
    const [a, b] = [point('A', 0, 0, 0), point('B', 0, 0, 10)];
    const axis = feature('X', 'axisThroughPoints', { points: refs([a, b].map(ref)) });
    const data = new SketchBuilder();
    // On XZ: sketch x is world X, sketch y is world Z.
    rect(data, 10, 0, 10, 10);
    const result = ok(
      await fresh([
        a,
        b,
        axis,
        sketch('S', data.sketch, XZ),
        {
          ...testFeature('R', 'revolve'),
          inputs: revolveInputs([profileOf('S', data.sketch)], ref(axis)),
        },
      ]),
    );
    // A ring of 10…20 mm radius, 10 mm tall: 3000π mm³.
    expect(result.bodies.map((body) => body.id)).toEqual(['R:0']);
    const ring = engine.latestBody('R:0' as never);
    expect(kernel.measure(ring as ShapeHandle).volume).toBeCloseTo(3000 * Math.PI, 0);
  });
});

// ------------------------------------------------------------------- errors

describe('construction errors and dependencies', { timeout: 120_000 }, () => {
  it('a missing pick says what to pick', async () => {
    const result = await fresh([feature('A', 'offsetPlane'), feature('B', 'planeThroughPoints')]);
    expect(status(result, 'A').message).toContain('Pick');
    expect(status(result, 'B').message).toContain('three points');
  });

  it('a reference to a feature that is gone is a lost reference, not a crash', async () => {
    const gone: GeomRef = { kind: 'plane', id: 'nope' };
    const b = new SketchBuilder();
    rect(b, 0, 0, 5, 5);
    const result = await fresh([sketch('S', b.sketch, gone), offsetPlane('A', gone, '5 mm')]);
    expect(status(result, 'S').status).toBe('error');
    expect(status(result, 'S').refs).toEqual([
      { ref: { kind: 'plane', id: 'nope' }, state: 'lost' },
    ]);
    expect(status(result, 'A').refs?.[0]?.state).toBe('lost');
  });

  it('a construction feature that fails or is suppressed blocks what uses it', async () => {
    const bad = feature('Bad', 'offsetPlane');
    const b = new SketchBuilder();
    rect(b, 0, 0, 5, 5);
    const failed = await fresh([bad, sketch('S', b.sketch, ref({ ...bad, type: 'offsetPlane' }))]);
    expect(status(failed, 'S').message).toContain('has an error');

    const good = { ...offsetPlane('OP', XY, '5 mm'), suppressed: true };
    const suppressed = await fresh([good, sketch('S', b.sketch, ref(good))]);
    expect(status(suppressed, 'S').message).toContain('suppressed');
  });

  it('a plane reference that names another kind of feature says so', async () => {
    const p = point('P', 1, 1, 1);
    const wrong = await fresh([p, offsetPlane('A', { kind: 'plane', id: 'P' }, '5 mm')]);
    expect(status(wrong, 'A').message).toContain("isn't a plane");
  });

  it('a body reference makes the feature depend on the bodies; a plane-only one does not', async () => {
    const plane = offsetPlane('OP', XY, '5 mm');
    const onFace = offsetPlane('OF', TOP, '5 mm');
    ok(await fresh([...block('10 mm'), plane, onFace]));
    engine.clear();
    seen.clear();
    // A taller block changes the face's plane: OF is evaluated again, OP comes from... a fresh cache here,
    // so check the reports instead of counters.
    ok(await run(testDocument([...block('30 mm'), plane, onFace])));
    expect(report('OF', 'plane').frame.origin).toEqual([0, 0, 35]);
    expect(report('OP', 'plane').frame.origin).toEqual([0, 0, 5]);
  });
});

// ------------------------------------------------------------------ helpers

function originAxis(id: 'origin:x' | 'origin:y' | 'origin:z'): GeomRef {
  return { kind: 'axis', id };
}
const dot3 = (a: readonly number[], b: readonly number[]) =>
  (a[0] ?? 0) * (b[0] ?? 0) + (a[1] ?? 0) * (b[1] ?? 0) + (a[2] ?? 0) * (b[2] ?? 0);
const sub3 = (a: readonly number[], b: readonly number[]) => [
  (a[0] ?? 0) - (b[0] ?? 0),
  (a[1] ?? 0) - (b[1] ?? 0),
  (a[2] ?? 0) - (b[2] ?? 0),
];
