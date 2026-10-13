/**
 * The body check end to end, with the real kernel: a synthetic
 * `.f3d` design whose replay makes a 10 mm box, against a STEP of the same box
 * (editable) and of a different box (frozen: a Remove and an import). No
 * samples, no `.f3d` bytes: the replay fixture is hand-built and the STEP comes
 * from `solidStep`.
 */
import type { Design } from '@extrudo/api';
import type { AttachmentId, BodyId } from '@extrudo/core';
import { Kernel } from '@extrudo/kernel';
import { kernelFeatures, loadOcct, RecomputeEngine } from '@extrudo/kernel/node';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type {
  AsmBodyCoedge,
  AsmBodyEdge,
  AsmBodyFace,
  AsmBodyLoop,
  AsmBodySolid,
} from './asm-body';
import {
  applyBodyPlan,
  type BodyMeasure,
  bodyFiles,
  fileBodies,
  planBodies,
  probeDocument,
} from './body-check';
import { type BodyStep, solidStep } from './brep-step';
import { f3dToDesign } from './map';
import type { F3dExtrude, F3dSketchFeature } from './model';
import { type F3dDesign, IDENTITY } from './model';

type V = [number, number, number];

/** The six faces of a box, as `brep-step.ts`'s writer reads them (stream helpers, by hand). */
function boxSolid(size: number): AsmBodySolid {
  const p = (x: number, y: number, z: number): V => [x, y, z];
  const V0 = p(0, 0, 0);
  const V1 = p(size, 0, 0);
  const V2 = p(size, size, 0);
  const V3 = p(0, size, 0);
  const V4 = p(0, 0, size);
  const V5 = p(size, 0, size);
  const V6 = p(size, size, size);
  const V7 = p(0, size, size);
  const edges = new Map<string, AsmBodyEdge>();
  const edge = (a: V, b: V): AsmBodyEdge => {
    const [ka, kb] = [a.join(','), b.join(',')].sort();
    const key = `${ka}|${kb}`;
    let e = edges.get(key);
    if (!e) {
      e = {
        id: edges.size,
        curve: { kind: 'line', point: a, direction: [b[0] - a[0], b[1] - a[1], b[2] - a[2]] },
        start: a,
        end: b,
        reversed: false,
      };
      edges.set(key, e);
    }
    return e;
  };
  const quad = (a: V, b: V, c: V, d: V): AsmBodyLoop => {
    const co = (u: V, v: V): AsmBodyCoedge => {
      const e = edge(u, v);
      const forward = e.start?.[0] === u[0] && e.start[1] === u[1] && e.start[2] === u[2];
      return { forward, edge: e };
    };
    return { outer: true, coedges: [co(a, b), co(b, c), co(c, d), co(d, a)] };
  };
  const face = (point: V, normal: V, loop: AsmBodyLoop): AsmBodyFace => ({
    surface: { kind: 'plane', point, normal },
    reversed: false,
    loops: [loop],
  });
  return {
    faces: [
      face(V0, [0, 0, -1], quad(V0, V3, V2, V1)),
      face(V4, [0, 0, 1], quad(V4, V5, V6, V7)),
      face(V0, [0, -1, 0], quad(V0, V1, V5, V4)),
      face(V3, [0, 1, 0], quad(V3, V7, V6, V2)),
      face(V0, [-1, 0, 0], quad(V0, V4, V7, V3)),
      face(V1, [1, 0, 0], quad(V1, V2, V6, V5)),
    ],
  };
}

/** A square (1 cm) extruded 1 cm: a 10 mm box. */
function squareDesign(): F3dDesign {
  const at = (x: number, y: number): V => [x, y, 0];
  const points = [
    { id: 1, at: at(0, 0), incidence: 0 },
    { id: 2, at: at(1, 0), incidence: 0 },
    { id: 3, at: at(1, 1), incidence: 0 },
    { id: 4, at: at(0, 1), incidence: 0 },
  ];
  const lines = [
    {
      id: 10,
      tag: 11n,
      start: at(0, 0),
      end: at(1, 0),
      startPoint: 1,
      endPoint: 2,
      construction: false,
    },
    {
      id: 11,
      tag: 12n,
      start: at(1, 0),
      end: at(1, 1),
      startPoint: 2,
      endPoint: 3,
      construction: false,
    },
    {
      id: 12,
      tag: 13n,
      start: at(1, 1),
      end: at(0, 1),
      startPoint: 3,
      endPoint: 4,
      construction: false,
    },
    {
      id: 13,
      tag: 14n,
      start: at(0, 1),
      end: at(0, 0),
      startPoint: 4,
      endPoint: 1,
      construction: false,
    },
  ];
  const sketch: F3dSketchFeature = {
    type: 'sketch',
    id: 1,
    kind: 'Sketch',
    name: 'Sketch1',
    suppressed: false,
    parameters: [],
    sketch: {
      id: 5,
      frame: IDENTITY,
      points,
      lines,
      circulars: [],
      splines: [],
      texts: [],
    },
  };
  const tags = [11n, 12n, 13n, 14n];
  const extrude: F3dExtrude = {
    type: 'extrude',
    id: 2,
    kind: 'Extrude',
    name: 'Extrude1',
    suppressed: false,
    parameters: [
      {
        name: 'd3',
        expression: '1',
        kind: 'AlongDistance',
        unit: 'cm',
        value: 1,
        comment: '',
        user: false,
        number: 1,
        id: 0,
      },
    ],
    operation: 'new-body',
    direction: 'one-side',
    reversed: false,
    solid: true,
    start: 'profile-plane',
    profiles: [
      {
        id: 30,
        sketch: 5,
        regions: [
          {
            outer: [tags],
            inner: [],
            outerPieces: [tags.map((tag) => ({ tag, secondary: 0n, piece: 1, of: 1 }))],
            innerPieces: [],
          },
        ],
      },
    ],
    faces: [],
    participants: [],
  };
  return {
    parameters: [],
    userParameters: [],
    features: [sketch, extrude],
    bodies: [],
    problems: [],
  };
}

let kernel: Kernel;

beforeAll(async () => {
  kernel = new Kernel(await loadOcct());
});

afterAll(() => {
  kernel.dispose();
});

/** Measures every body of a computed design (volume mm³, tight bbox mm). */
async function measureDesign(
  design: Design,
  files?: Map<AttachmentId, Uint8Array>,
): Promise<Map<BodyId, BodyMeasure>> {
  const engine = new RecomputeEngine(kernel, kernelFeatures(), {
    strictLeaks: true,
    ...(files
      ? {
          files: (id: AttachmentId) => {
            const bytes = files.get(id);
            return bytes ? { bytes, mediaType: 'model/step', fileName: `${id}.step` } : undefined;
          },
        }
      : {}),
  });
  try {
    const result = await engine.recompute({ doc: design.toJSON() });
    if (result.status !== 'done') throw new Error(`recompute ${result.status}`);
    const failed = Object.values(result.features).filter((s) => s.status === 'error');
    expect(failed).toEqual([]);
    const measures = new Map<BodyId, BodyMeasure>();
    for (const body of result.bodies) {
      const shape = engine.latestBody(body.id);
      if (!shape) continue;
      const { volume, bbox } = kernel.properties(shape);
      measures.set(body.id, {
        volume,
        box: [bbox.min[0], bbox.min[1], bbox.min[2], bbox.max[0], bbox.max[1], bbox.max[2]],
      });
    }
    return measures;
  } finally {
    engine.clear();
  }
}

/** Runs probe → plan → apply and returns the plan. */
async function check(
  design: Design,
  links: ReturnType<typeof f3dToDesign>['bodies'],
  steps: BodyStep[],
) {
  const replay = await measureDesign(design);
  const probe = probeDocument(design, steps);
  const probeMeasures = await measureDesign(probe.design, probe.files);
  const measured = new Map<number, BodyMeasure>();
  for (const body of probe.bodies) {
    const measure = probeMeasures.get(body.body);
    if (measure) measured.set(body.record, measure);
  }
  const file = fileBodies(steps, links ?? [], measured);
  const plan = planBodies({
    replayed: [...replay].map(([id, measure]) => ({ id, measure })),
    file,
  });
  return { plan, replay };
}

describe('body check with a kernel', () => {
  it('keeps a matching replayed box editable', async () => {
    const { design, bodies } = f3dToDesign(squareDesign(), 'Box');
    const step = solidStep(boxSolid(1)).step as string;
    const steps: BodyStep[] = [{ record: 1, name: 'Body1', step }];
    const { plan, replay } = await check(design, bodies, steps);
    expect(plan.matched).toHaveLength(1);
    expect(plan.frozen).toEqual([]);
    expect(plan.remove).toEqual([]);
    applyBodyPlan(design, plan, steps);
    expect(design.doc.features.map((f) => f.type)).toEqual(['sketch', 'extrude']);
    const bodyId = [...replay.keys()][0] as BodyId;
    expect(design.doc.bodies[bodyId]?.name).toBe('Body1');
    const after = await measureDesign(design);
    expect(after.size).toBe(1);
    // The 10 mm box: 1 cm³ → 1000 mm³.
    expect(([...after.values()][0] as BodyMeasure).volume).toBeCloseTo(1000, 3);
  });

  it('freezes a different box: a Remove and an import body', async () => {
    const { design, bodies } = f3dToDesign(squareDesign(), 'Box');
    const step = solidStep(boxSolid(1.5)).step as string; // a 15 mm box
    const steps: BodyStep[] = [{ record: 1, name: 'Body1', step }];
    const { plan } = await check(design, bodies, steps);
    expect(plan.matched).toEqual([]);
    expect(plan.frozen).toHaveLength(1);
    expect(plan.remove).toHaveLength(1); // the leftover replayed box, taken out
    applyBodyPlan(design, plan, steps);
    const types = design.doc.features.map((f) => f.type);
    expect(types).toEqual(['sketch', 'extrude', 'remove', 'import']);
    const after = await measureDesign(design, bodyFiles(design, steps));
    expect(after.size).toBe(1);
    const measure = [...after.values()][0] as BodyMeasure;
    // The 15 mm box: 3.375 cm³ → 3375 mm³.
    expect(measure.volume).toBeCloseTo(3375, 3);
  });
});
