// P4-12's construction backlog (ADR-0040 amendment) through the recompute
// engine with real OCCT: a point and a plane along a path, a point at the
// intersection of edges/planes, the bisector of two non-parallel faces and a
// tangent plane on a torus and a free-form face. Every shape is released
// (strict leaks), as the original construction tests do.
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
  ORIGIN_POINT_ID,
  originPlaneRef,
  primitiveInputs,
  type SketchData,
  sketchInputs,
  sweepInputs,
} from '@extrudo/core';
import { SketchBuilder } from '@extrudo/sketch/fixtures';
import { detectProfiles } from '@extrudo/sketch/profiles';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { SubShapeKind } from '../history';
import { Kernel, type ShapeHandle } from '../kernel';
import type { BodyMesh } from '../mesh';
import { loadOcct } from '../occt/load';
import { RecomputeEngine } from '../recompute/engine';
import { testDocument, testFeature, testFeatures } from '../recompute/testing';
import type { KernelFeatureDefinition, RecomputeResult } from '../recompute/types';
import { MESH_NORMAL } from './construction';

let kernel: Kernel;
let engine: RecomputeEngine;
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
const plain = (expr: string) => ({ kind: 'expr' as const, expr, unit: 'unitless' as const });
const enumOf = (value: string) => ({ kind: 'enum' as const, value });
const bool = (value: boolean) => ({ kind: 'bool' as const, value });

function feature(id: string, type: string, inputs: Feature['inputs'] = {}): Feature {
  return { ...testFeature(id, type), inputs };
}

const XY = originPlaneRef('origin:xy');
const XZ = originPlaneRef('origin:xz');
const YZ = originPlaneRef('origin:yz');
const ORIGIN: GeomRef = { kind: 'point', id: ORIGIN_POINT_ID };

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

/** A 60 × 40 × `height` block, x 0…60, y 0…40, z 0…`height` (body `B:0`). */
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

const round = (x: number, digits = 6) => {
  const r = Number(x.toFixed(digits));
  return Object.is(r, -0) ? 0 : r;
};
const rounded = (v: readonly number[], digits = 6) => v.map((x) => round(x, digits));

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

const near = (v: readonly number[], x: number, y: number, z: number, tol = 1e-6) =>
  Math.hypot((v[0] ?? 0) - x, (v[1] ?? 0) - y, (v[2] ?? 0) - z) < tol;

const dot3 = (a: readonly number[], b: readonly number[]) =>
  (a[0] ?? 0) * (b[0] ?? 0) + (a[1] ?? 0) * (b[1] ?? 0) + (a[2] ?? 0) * (b[2] ?? 0);

// -------------------------------------------------------------------- paths

describe('a point and a plane along a path (P4-12)', { timeout: 120_000 }, () => {
  it('a point on a box edge: a fraction at 0.25, and 7 mm from the start', async () => {
    const picked = await withShapes(block());
    const edge = pick(picked, 'B:0', 'edge', (i, shape) => {
      const e = kernel.describe(shape).edges[i];
      return e?.type === 'line' && near(e.midpoint, 30, 0, 0);
    });
    const point = (id: string, more: Feature['inputs']) =>
      feature(id, 'pointOnPath', { path: refs([edge]), ...more });
    ok(await fresh([...block(), point('P', { position: plain('0.25') })]));
    expect(rounded(report('P', 'point').point)).toEqual([15, 0, 0]);
    ok(await fresh([...block(), point('Q', { by: enumOf('length'), distance: length('7 mm') })]));
    expect(rounded(report('Q', 'point').point)).toEqual([7, 0, 0]);
  });

  it('walks a two-edge chain across the corner', async () => {
    const picked = await withShapes(block());
    const alongX = pick(picked, 'B:0', 'edge', (i, shape) => {
      const e = kernel.describe(shape).edges[i];
      return e?.type === 'line' && near(e.midpoint, 30, 0, 0);
    });
    const alongY = pick(picked, 'B:0', 'edge', (i, shape) => {
      const e = kernel.describe(shape).edges[i];
      return e?.type === 'line' && near(e.midpoint, 0, 20, 0);
    });
    ok(
      await fresh([
        ...block(),
        feature('P', 'pointOnPath', {
          path: refs([alongX, alongY]),
          by: enumOf('length'),
          distance: length('70 mm'),
        }),
      ]),
    );
    // The chain runs from the Y edge's far end (0, 40, 0): 40 mm to the
    // corner, then 30 mm along the X edge.
    expect(rounded(report('P', 'point').point)).toEqual([30, 0, 0]);
  });

  it('a plane along a sketch arc: square to the tangent at its middle', async () => {
    const b = new SketchBuilder();
    const arc = b.arc(0, 0, 20, 0, 90);
    ok(
      await fresh([
        sketch('S', b.sketch),
        feature('P', 'planeAlongPath', {
          path: refs([{ kind: 'sketchEntity', id: `S/${arc.id}` }]),
          position: plain('0.5'),
        }),
      ]),
    );
    const p = report('P', 'plane');
    const at45 = [20 * Math.SQRT1_2, 20 * Math.SQRT1_2, 0];
    // The anchor is the point on the arc; the normal is the tangent there.
    expect(rounded(p.anchor, 9)).toEqual(rounded(at45, 9));
    expect(rounded(p.frame.normal, 9)).toEqual(rounded([-Math.SQRT1_2, Math.SQRT1_2, 0], 9));
    expect(p.path?.straight).toBe(false);
  });

  it('a sweep with its profile sketched on a plane along the path', async () => {
    const picked = await withShapes(block());
    const edge = pick(picked, 'B:0', 'edge', (i, shape) => {
      const e = kernel.describe(shape).edges[i];
      return e?.type === 'line' && near(e.midpoint, 30, 0, 0);
    });
    const plane = feature('PA', 'planeAlongPath', { path: refs([edge]) });
    // A circle centered on the plane's own origin (which lies on the path).
    const b = new SketchBuilder();
    b.circle(0, 0, 3);
    const result = ok(
      await fresh([
        ...block(),
        plane,
        sketch('S', b.sketch, { kind: 'plane', id: 'PA' }),
        {
          ...testFeature('W', 'sweep'),
          inputs: sweepInputs([profileOf('S', b.sketch)], [edge]),
        },
      ]),
    );
    const sweep = result.bodies.find((body) => body.id === 'W:0');
    const shape = sweep && engine.latestBody('W:0' as never);
    expect(shape).toBeDefined();
    // A pipe of radius 3 along the 60 mm edge.
    expect(kernel.measure(shape as ShapeHandle).volume).toBeCloseTo(Math.PI * 9 * 60, -1);
  });
});

// ------------------------------------------------------------ intersections

describe('a point at an intersection (P4-12)', { timeout: 120_000 }, () => {
  it('two box edges meet at their corner', async () => {
    const picked = await withShapes(block());
    const alongX = pick(picked, 'B:0', 'edge', (i, shape) => {
      const e = kernel.describe(shape).edges[i];
      return e?.type === 'line' && near(e.midpoint, 30, 0, 0);
    });
    const alongY = pick(picked, 'B:0', 'edge', (i, shape) => {
      const e = kernel.describe(shape).edges[i];
      return e?.type === 'line' && near(e.midpoint, 0, 20, 0);
    });
    ok(
      await fresh([
        ...block(),
        feature('X', 'pointAtIntersection', { entities: refs([alongX, alongY]) }),
      ]),
    );
    expect(rounded(report('X', 'point').point)).toEqual([0, 0, 0]);
  });

  it('two skew edges are refused with their distance', async () => {
    const picked = await withShapes(block());
    const alongX = pick(picked, 'B:0', 'edge', (i, shape) => {
      const e = kernel.describe(shape).edges[i];
      return e?.type === 'line' && near(e.midpoint, 30, 0, 0);
    });
    const vertical = pick(picked, 'B:0', 'edge', (i, shape) => {
      const e = kernel.describe(shape).edges[i];
      return e?.type === 'line' && near(e.midpoint, 60, 40, 5);
    });
    const result = await fresh([
      ...block(),
      feature('X', 'pointAtIntersection', { entities: refs([alongX, vertical]) }),
    ]);
    expect(status(result, 'X').status).toBe('error');
    expect(status(result, 'X').message).toContain("don't meet");
    expect(status(result, 'X').message).toContain('40 mm apart');
  });

  it('three faces of a box meet at their corner', async () => {
    const picked = await withShapes(block());
    const outward = (nx: number, ny: number, nz: number, at: readonly [number, number, number]) =>
      pick(picked, 'B:0', 'face', (i, shape) => {
        const f = kernel.describe(shape).faces[i];
        return (
          f?.type === 'plane' &&
          near(f.direction ?? [], nx, ny, nz, 1e-6) &&
          near(f.centroid, at[0], at[1], at[2], 1)
        );
      });
    const bottom = outward(0, 0, -1, [30, 20, 0]);
    const front = outward(0, -1, 0, [30, 0, 5]);
    const left = outward(-1, 0, 0, [0, 20, 5]);
    ok(
      await fresh([
        ...block(),
        feature('X', 'pointAtIntersection', { entities: refs([bottom, front, left]) }),
      ]),
    );
    expect(rounded(report('X', 'point').point)).toEqual([0, 0, 0]);
  });

  it('an edge and a plane meet, and a missing mix says what to pick', async () => {
    const picked = await withShapes(block());
    const alongX = pick(picked, 'B:0', 'edge', (i, shape) => {
      const e = kernel.describe(shape).edges[i];
      return e?.type === 'line' && near(e.midpoint, 30, 0, 0);
    });
    ok(
      await fresh([
        ...block(),
        feature('X', 'pointAtIntersection', { entities: refs([alongX, YZ]) }),
      ]),
    );
    // The edge runs along X at y = z = 0; the YZ plane is x = 0.
    expect(rounded(report('X', 'point').point)).toEqual([0, 0, 0]);
    const none = await fresh([feature('Y', 'pointAtIntersection', { entities: refs([YZ]) })]);
    expect(status(none, 'Y').message).toContain('two edges');
  });
});

// ------------------------------------------------------------- angled midplane

describe('an angled midplane (P4-12)', { timeout: 120_000 }, () => {
  it('bisects two flat faces of a box at 45°, and flip takes the other one', async () => {
    const picked = await withShapes(block());
    const front = pick(picked, 'B:0', 'face', (i, shape) => {
      const f = kernel.describe(shape).faces[i];
      return f?.type === 'plane' && near(f.direction ?? [], 0, -1, 0);
    });
    const left = pick(picked, 'B:0', 'face', (i, shape) => {
      const f = kernel.describe(shape).faces[i];
      return f?.type === 'plane' && near(f.direction ?? [], -1, 0, 0);
    });
    const normal = [-Math.SQRT1_2, -Math.SQRT1_2, 0];
    ok(
      await fresh([
        ...block(),
        feature('M', 'midplaneAngled', { planes: refs([front, left]) }),
        feature('F', 'midplaneAngled', { planes: refs([front, left]), flip: bool(true) }),
      ]),
    );
    expect(rounded(report('M', 'plane').frame.normal)).toEqual(rounded(normal));
    expect(rounded(report('F', 'plane').frame.normal)).toEqual(
      rounded([Math.SQRT1_2, -Math.SQRT1_2, 0]),
    );
    // The bisector passes through the shared edge: the line x = 0, y = 0.
    expect(round(dot3(report('M', 'plane').anchor, [1, 1, 0]))).toBe(0);
  });

  it('refuses parallel planes and points at Midplane', async () => {
    const offset = feature('A', 'offsetPlane', { plane: refs([XY]), distance: length('20 mm') });
    const result = await fresh([
      offset,
      feature('M', 'midplaneAngled', { planes: refs([XY, { kind: 'plane', id: 'A' }]) }),
    ]);
    expect(status(result, 'M').status).toBe('error');
    expect(status(result, 'M').message).toContain('Midplane');
    // Two perpendicular planes are fine.
    const meeting = await fresh([feature('N', 'midplaneAngled', { planes: refs([XY, XZ]) })]);
    expect(status(meeting, 'N').status).toBe('ok');
    expect(rounded(report('N', 'plane').frame.normal)).toEqual(
      rounded([0, -Math.SQRT1_2, Math.SQRT1_2]),
    );
  });
});

// ------------------------------------------------------------- tangent plane

describe('a tangent plane on a torus and a free-form face (P4-12)', { timeout: 120_000 }, () => {
  it('touches a torus at the point nearest a construction point', async () => {
    const torus = feature(
      'T',
      'torus',
      primitiveInputs('torus', { numbers: { diameter: '30 mm', tube: '6 mm' } }),
    );
    // Major radius 15, minor 3: the outer equator is at radius 18.
    const near1 = feature('P', 'constructionPoint', {
      x: length('23 mm'),
    });
    ok(
      await fresh([
        torus,
        near1,
        feature('TP', 'tangentPlane', {
          face: refs([{ kind: 'face', id: 'torus:T:side:surface' }]),
          point: refs([constructionRef(near1) as GeomRef]),
        }),
      ]),
    );
    const p = report('TP', 'plane');
    expect(p.basis).toBe('surface');
    expect(rounded(p.anchor)).toEqual([18, 0, 0]);
    expect(rounded(p.frame.normal)).toEqual([1, 0, 0]);
  });

  it('falls back to the display mesh on a free-form (extruded spline) face', async () => {
    const b = new SketchBuilder();
    b.spline([
      [0, 0],
      [20, 0],
      [20, 20],
      [0, 20],
      [0, 0],
    ]);
    const result = await withShapes([
      sketch('S', b.sketch),
      {
        ...testFeature('E', 'extrude'),
        inputs: extrudeInputs([profileOf('S', b.sketch)], { distance: '10 mm' }),
      },
    ]);
    const free = pick(result, 'E:0', 'face', (i, shape) => {
      const s = kernel.surfaceGeometry(shape, i);
      return s.type !== 'plane';
    });
    ok(
      await fresh([
        sketch('S', b.sketch),
        {
          ...testFeature('E', 'extrude'),
          inputs: extrudeInputs([profileOf('S', b.sketch)], { distance: '10 mm' }),
        },
        feature('TP', 'tangentPlane', { face: refs([free]), point: refs([ORIGIN]) }),
      ]),
    );
    const p = report('TP', 'plane');
    expect(p.basis).toBe('mesh');
    expect(round(Math.hypot(...p.frame.normal))).toBe(1);
  });
});

// --------------------------------------------------- P4-12 review fixes

/** Picks the box edge whose midpoint is at `(x, y, z)` (a line). */
function edgeAt(picked: Done, x: number, y: number, z: number): GeomRef {
  return pick(picked, 'B:0', 'edge', (i, shape) => {
    const e = kernel.describe(shape).edges[i];
    return e?.type === 'line' && near(e.midpoint, x, y, z);
  });
}

/** The nearest point of a body mesh to `target`, sampled over every triangle (a reference). */
function nearestOnMesh(mesh: BodyMesh, target: readonly number[]): number[] {
  const pos = mesh.positions;
  const at = (i: number): number[] => [pos[3 * i] ?? 0, pos[3 * i + 1] ?? 0, pos[3 * i + 2] ?? 0];
  const n = 24;
  let best: number[] = [0, 0, 0];
  let bestD = Number.POSITIVE_INFINITY;
  for (let t = 0; t + 2 < mesh.indices.length; t += 3) {
    const a = at(mesh.indices[t] ?? 0);
    const b = at(mesh.indices[t + 1] ?? 0);
    const c = at(mesh.indices[t + 2] ?? 0);
    for (let i = 0; i <= n; i++) {
      for (let j = 0; j + i <= n; j++) {
        const u = i / n;
        const v = j / n;
        const w = 1 - u - v;
        const p = [
          w * (a[0] as number) + u * (b[0] as number) + v * (c[0] as number),
          w * (a[1] as number) + u * (b[1] as number) + v * (c[1] as number),
          w * (a[2] as number) + u * (b[2] as number) + v * (c[2] as number),
        ];
        const d = Math.hypot(
          (p[0] as number) - (target[0] as number),
          (p[1] as number) - (target[1] as number),
          (p[2] as number) - (target[2] as number),
        );
        if (d < bestD) {
          bestD = d;
          best = p;
        }
      }
    }
  }
  return best;
}

describe('the P4-12 review fixes', { timeout: 120_000 }, () => {
  it('crosses a circular edge with a plane exactly, not on a 24-sample chord (M2)', async () => {
    const cylinder = feature(
      'C',
      'cylinder',
      primitiveInputs('cylinder', { numbers: { diameter: '100 mm', height: '20 mm' } }),
    );
    const picked = await withShapes([cylinder]);
    // The top rim: a circle of radius 50 centred at (0, 0, 20).
    const rim = pick(picked, 'C:0', 'edge', (i, shape) => {
      const g = kernel.edgeGeometry(shape, i, 4);
      return g.type === 'circle' && near(g.conic?.center ?? [], 0, 0, 20, 1e-6);
    });
    const plane = feature('A', 'offsetPlane', {
      plane: refs([XZ]),
      distance: length('10 mm'),
    });
    ok(
      await fresh([
        cylinder,
        plane,
        feature('X', 'pointAtIntersection', {
          entities: refs([rim, { kind: 'plane', id: 'A' }]),
        }),
      ]),
    );
    const p = report('X', 'point').point;
    // The XZ plane's normal is −Y, so the offset plane is y = −10.
    expect(p[1]).toBeCloseTo(-10, 6);
    expect(p[2]).toBeCloseTo(20, 6);
    // On the circle exactly (the old chord was ~43 mm² short of x² + y² = 2500).
    expect(Math.hypot(p[0] as number, p[1] as number)).toBeCloseTo(50, 6);
    expect(Math.abs(Math.abs(p[0] as number) - Math.sqrt(2400))).toBeLessThan(1e-6);
  });

  it('touches a free-form face at its nearest mesh point, with the outward normal (M3)', async () => {
    const b = new SketchBuilder();
    b.spline([
      [0, 0],
      [20, 0],
      [20, 20],
      [0, 20],
      [0, 0],
    ]);
    const extrude = {
      ...testFeature('E', 'extrude'),
      inputs: extrudeInputs([profileOf('S', b.sketch)], { distance: '10 mm' }),
    };
    const picked = await withShapes([sketch('S', b.sketch), extrude]);
    const free = pick(picked, 'E:0', 'face', (i, shape) => {
      return kernel.surfaceGeometry(shape, i).type !== 'plane';
    });
    const target = feature('P', 'constructionPoint', {
      x: length('30 mm'),
      y: length('10 mm'),
      z: length('6 mm'),
    });
    ok(
      await fresh([
        sketch('S', b.sketch),
        extrude,
        target,
        feature('TP', 'tangentPlane', {
          face: refs([free]),
          point: refs([constructionRef(target) as GeomRef]),
        }),
      ]),
    );
    const p = report('TP', 'plane');
    expect(p.basis).toBe('mesh');
    const shape = engine.latestBody('E:0' as never) as ShapeHandle;
    const mesh = kernel.mesh(shape, MESH_NORMAL);
    const nearest = nearestOnMesh(mesh, [30, 10, 6]);
    // The touching point is the nearest point of the face, not a triangle's centroid.
    expect(
      Math.hypot(
        (p.anchor[0] as number) - (nearest[0] as number),
        (p.anchor[1] as number) - (nearest[1] as number),
        (p.anchor[2] as number) - (nearest[2] as number),
      ),
    ).toBeLessThan(0.05);
    // And the outward normal points from the body towards the target.
    expect(
      dot3(p.frame.normal, [
        30 - (p.anchor[0] as number),
        10 - (p.anchor[1] as number),
        6 - (p.anchor[2] as number),
      ]),
    ).toBeGreaterThan(0);
  });

  it('bisects two faces the same way whichever is picked first (L1)', async () => {
    const picked = await withShapes(block());
    const face = (nx: number, ny: number) =>
      pick(picked, 'B:0', 'face', (i, shape) => {
        const f = kernel.describe(shape).faces[i];
        return f?.type === 'plane' && near(f.direction ?? [], nx, ny, 0);
      });
    const front = face(0, -1);
    const left = face(-1, 0);
    const midplane = (id: string, refs2: GeomRef[], flip: boolean) =>
      feature(id, 'midplaneAngled', { planes: refs(refs2), ...(flip ? { flip: bool(true) } : {}) });
    ok(
      await fresh([
        ...block(),
        midplane('M1', [front, left], false),
        midplane('M2', [left, front], false),
        midplane('M3', [front, left], true),
        midplane('M4', [left, front], true),
      ]),
    );
    expect(rounded(report('M2', 'plane').frame.normal)).toEqual(
      rounded(report('M1', 'plane').frame.normal),
    );
    expect(rounded(report('M4', 'plane').frame.normal)).toEqual(
      rounded(report('M3', 'plane').frame.normal),
    );
  });

  it('a tangent plane on a sphere ignores a target at its centre (L2)', async () => {
    const sphere = feature(
      'S',
      'sphere',
      primitiveInputs('sphere', { numbers: { diameter: '20 mm' } }),
    );
    const centre = feature('P', 'constructionPoint', { x: length('0.000000001 mm') });
    const result = await fresh([
      sphere,
      centre,
      feature('TP', 'tangentPlane', {
        face: refs([{ kind: 'face', id: 'sphere:S:side:surface' }]),
        point: refs([constructionRef(centre) as GeomRef]),
      }),
    ]);
    expect(status(result, 'TP').status).not.toBe('error');
    const p = report('TP', 'plane');
    // The sphere's axis is world Z: the fallback normal is that, not the noise direction.
    expect(Math.abs(p.frame.normal[0] as number)).toBeLessThan(1e-6);
    expect(Math.abs(p.frame.normal[1] as number)).toBeLessThan(1e-6);
    expect(rounded(p.anchor)).toEqual([0, 0, 10]);
  });

  it('touches a torus at the exact nearest point near the tube circle (L3)', async () => {
    const torus = feature(
      'T',
      'torus',
      primitiveInputs('torus', { numbers: { diameter: '30 mm', tube: '6 mm' } }),
    );
    // 0.4 mm above the tube's centre circle (R = 15, r = 3) along the axis.
    const point = feature('P', 'constructionPoint', {
      x: length('15 mm'),
      z: length('0.4 mm'),
    });
    ok(
      await fresh([
        torus,
        point,
        feature('TP', 'tangentPlane', {
          face: refs([{ kind: 'face', id: 'torus:T:side:surface' }]),
          point: refs([constructionRef(point) as GeomRef]),
        }),
      ]),
    );
    const p = report('TP', 'plane');
    // The old 0.5 mm threshold used the circled direction and touched (18, 0, 0).
    expect(rounded(p.anchor)).toEqual([15, 0, 3]);
    expect(rounded(p.frame.normal)).toEqual([0, 0, 1]);
  });

  it('needs one tolerance: an edge in a plane is refused, a parallel one misses (L5)', async () => {
    const picked = await withShapes(block());
    const alongX = edgeAt(picked, 30, 0, 0);
    const lying = await fresh([
      ...block(),
      feature('X', 'pointAtIntersection', { entities: refs([alongX, XY]) }),
    ]);
    expect(status(lying, 'X').status).toBe('error');
    expect(status(lying, 'X').message).toContain('lies in the plane');
    const below = feature('A', 'offsetPlane', { plane: refs([XY]), distance: length('-10 mm') });
    const parallel = await fresh([
      ...block(),
      below,
      feature('Y', 'pointAtIntersection', {
        entities: refs([alongX, { kind: 'plane', id: 'A' }]),
      }),
    ]);
    expect(status(parallel, 'Y').status).toBe('error');
    expect(status(parallel, 'Y').message).toContain("doesn't meet");
  });
});

// ------------------------------------------------------ P4-12 test gaps

describe('the P4-12 test gaps', { timeout: 120_000 }, () => {
  it('walks a closed path, and clamps a fraction or length past either end', async () => {
    const b = new SketchBuilder();
    const circle = b.circle(0, 0, 20);
    const at = (id: string, more: Feature['inputs']) =>
      feature(id, 'pointOnPath', {
        path: refs([{ kind: 'sketchEntity', id: `S/${circle.id}` }]),
        ...more,
      });
    ok(await fresh([sketch('S', b.sketch), at('P', { position: plain('0.25') })]));
    // A whole circle starts at (20, 0, 0) and runs to (0, 20, 0) a quarter way.
    expect(rounded(report('P', 'point').point)).toEqual([0, 20, 0]);
    expect(report('P', 'point').path?.length).toBeCloseTo(2 * Math.PI * 20, 0);

    // An open edge: a fraction outside 0–1 clamps to its ends.
    const picked = await withShapes(block());
    const alongX = edgeAt(picked, 30, 0, 0);
    const open = (id: string, more: Feature['inputs']) =>
      feature(id, 'pointOnPath', { path: refs([alongX]), ...more });
    ok(
      await fresh([
        ...block(),
        open('Q', { position: plain('1.5') }),
        open('R', { position: plain('-0.5') }),
        open('T', { by: enumOf('length'), distance: length('70 mm') }),
      ]),
    );
    expect(rounded(report('Q', 'point').point)).toEqual([60, 0, 0]);
    expect(rounded(report('R', 'point').point)).toEqual([0, 0, 0]);
    expect(rounded(report('T', 'point').point)).toEqual([60, 0, 0]);
  });

  it('refuses two parallel edges that never meet', async () => {
    const picked = await withShapes(block());
    const a = edgeAt(picked, 30, 0, 0);
    const b = edgeAt(picked, 30, 40, 0);
    const result = await fresh([
      ...block(),
      feature('X', 'pointAtIntersection', { entities: refs([a, b]) }),
    ]);
    expect(status(result, 'X').status).toBe('error');
    expect(status(result, 'X').message).toContain('40 mm apart');
  });

  it('refuses three planes when two are parallel', async () => {
    const offset = feature('A', 'offsetPlane', { plane: refs([XY]), distance: length('20 mm') });
    const result = await fresh([
      offset,
      feature('X', 'pointAtIntersection', {
        entities: refs([XY, XZ, { kind: 'plane', id: 'A' }]),
      }),
    ]);
    expect(status(result, 'X').status).toBe('error');
    expect(status(result, 'X').message).toContain('one point');
  });

  it('puts a plane square to a vertical path, its frame following faceSketchFrame', async () => {
    const picked = await withShapes(block());
    // A vertical edge at x = 60, y = 40, running along Z.
    const vertical = edgeAt(picked, 60, 40, 5);
    ok(
      await fresh([
        ...block(),
        feature('P', 'planeAlongPath', { path: refs([vertical]), position: plain('0.5') }),
      ]),
    );
    const p = report('P', 'plane');
    expect(rounded(p.anchor)).toEqual([60, 40, 5]);
    // A vertical tangent: the plane is horizontal, X along world X.
    expect(rounded(p.frame.normal)).toEqual([0, 0, 1]);
    expect(rounded(p.frame.x)).toEqual([1, 0, 0]);
  });

  it('touches a torus inside its ring, too', async () => {
    const torus = feature(
      'T',
      'torus',
      primitiveInputs('torus', { numbers: { diameter: '30 mm', tube: '6 mm' } }),
    );
    const point = feature('P', 'constructionPoint', { x: length('5 mm') });
    ok(
      await fresh([
        torus,
        point,
        feature('TP', 'tangentPlane', {
          face: refs([{ kind: 'face', id: 'torus:T:side:surface' }]),
          point: refs([constructionRef(point) as GeomRef]),
        }),
      ]),
    );
    // Inside the ring: the nearest surface point is on the inner wall at radius 12.
    expect(rounded(report('TP', 'plane').anchor)).toEqual([12, 0, 0]);
  });

  it('meets an edge with a curved face: the first crossing, or an error when apart', async () => {
    const cylinder = feature(
      'C',
      'cylinder',
      primitiveInputs('cylinder', { numbers: { diameter: '20 mm', height: '20 mm' } }),
    );
    const box = (x: string) =>
      feature(
        'K',
        'box',
        primitiveInputs('box', {
          numbers: { length: '40 mm', width: '4 mm', height: '10 mm', x },
        }),
      );
    const wall = pick(
      await withShapes([cylinder]),
      'C:0',
      'face',
      (i, shape) => kernel.surfaceGeometry(shape, i).type === 'cylinder',
    );
    const topEdge = async (x: string) => {
      const picked = await withShapes([cylinder, box(x)]);
      return pick(picked, 'K:0', 'edge', (i, shape) => {
        const e = kernel.describe(shape).edges[i];
        return e?.type === 'line' && near(e.midpoint, Number.parseFloat(x), 2, 10);
      });
    };
    const edge = await topEdge('15 mm');
    ok(
      await fresh([
        cylinder,
        box('15 mm'),
        feature('X', 'pointAtIntersection', { entities: refs([edge, wall]) }),
      ]),
    );
    const p = report('X', 'point').point;
    expect(p[0]).toBeCloseTo(Math.sqrt(96), 3);
    expect(p[1]).toBeCloseTo(2, 3);
    expect(p[2]).toBeCloseTo(10, 3);

    const far = await topEdge('60 mm');
    const apart = await fresh([
      cylinder,
      box('60 mm'),
      feature('X', 'pointAtIntersection', { entities: refs([far, wall]) }),
    ]);
    expect(status(apart, 'X').status).toBe('error');
    expect(status(apart, 'X').message).toContain("doesn't meet the face");
  });
});
