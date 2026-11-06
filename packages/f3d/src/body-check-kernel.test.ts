/**
 * The body check end to end, with the real kernel: a synthetic
 * `.f3d` design whose replay makes a 10 mm box, against a STEP of the same box
 * (editable) and of a different box (frozen: a Remove and an import). No
 * samples, no `.f3d` bytes: the replay fixture is hand-built and the STEP comes
 * from `solidStep`.
 */
import { Design } from '@extrudo/api';
import type { AttachmentId, BodyId, GeomRef } from '@extrudo/core';
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
  failedDeletions,
  fileBodies,
  planBodies,
  probeDocument,
} from './body-check';
import { type BaseStep, type BodyStep, solidStep } from './brep-step';
import { f3dToDesign } from './map';
import type { F3dBaseFeature, F3dEdgeFeature, F3dExtrude, F3dSketchFeature } from './model';
import { type F3dDesign, IDENTITY } from './model';

type V = [number, number, number];

/**
 * The six faces of a box, as `brep-step.ts`'s writer reads them (stream helpers,
 * by hand). With `spline`, the top face is a B-spline surface and its four edges
 * B-spline curves (degree 1: the same box, carried as splines).
 */
function boxSolid(size: number, spline = false, at = 0): AsmBodySolid {
  const p = (x: number, y: number, z: number): V => [x + at, y + at, z + at];
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
      const top = spline && a[2] === size && b[2] === size;
      e = {
        id: edges.size,
        curve: top
          ? {
              kind: 'bspline',
              spline: { degree: 1, knots: [0, 1], mults: [2, 2], points: [a, b], closed: false },
              reversed: false,
            }
          : { kind: 'line', point: a, direction: [b[0] - a[0], b[1] - a[1], b[2] - a[2]] },
        start: a,
        end: b,
        reversed: false,
        ...(top ? { range: [0, 1] as [number, number] } : {}),
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
  // u along x, v along y: the B-spline's normal (u × v) is +z, the top's outside.
  const top: AsmBodyFace = {
    surface: {
      kind: 'bspline',
      spline: {
        uDegree: 1,
        vDegree: 1,
        uKnots: [0, 1],
        uMults: [2, 2],
        vKnots: [0, 1],
        vMults: [2, 2],
        points: [
          [V4, V7],
          [V5, V6],
        ],
        uClosed: false,
        vClosed: false,
      },
      reversed: false,
    },
    reversed: false,
    loops: [quad(V4, V5, V6, V7)],
  };
  return {
    faces: [
      face(V0, [0, 0, -1], quad(V0, V3, V2, V1)),
      spline ? top : face(V4, [0, 0, 1], quad(V4, V5, V6, V7)),
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
    unreadParameters: 0,
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
  own?: Map<AttachmentId, Uint8Array>,
) {
  const replay = await measureDesign(design, own);
  const probe = probeDocument(design, steps, own);
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

  it('reads a box carried as B-splines back as the same box', async () => {
    const { design, bodies } = f3dToDesign(squareDesign(), 'Box');
    const step = solidStep(boxSolid(1, true)).step as string;
    expect(step).toContain('B_SPLINE_SURFACE_WITH_KNOTS');
    expect(step).toContain('B_SPLINE_CURVE_WITH_KNOTS');
    const steps: BodyStep[] = [{ record: 1, name: 'Body1', step }];
    const { plan } = await check(design, bodies, steps);
    // The kernel's solid measures as the replayed 10 mm box: kept editable.
    expect(plan.matched).toHaveLength(1);
    expect(plan.frozen).toEqual([]);
  });

  it('reads a box with a cavity back as the box less the cavity', () => {
    // A 3 cm box with a 1 cm cubic void at (1, 1, 1): the void's faces keep
    // the file's sense, their normals into the cavity (reversed faces).
    // Edge ids are record numbers, unique in a stream: renumber the cavity's.
    const renumbered = new Map<AsmBodyEdge, AsmBodyEdge>();
    const cavity = boxSolid(1, false, 1).faces.map((f) => ({
      ...f,
      reversed: true,
      loops: f.loops.map((l) => ({
        ...l,
        coedges: l.coedges.map((c) => {
          let edge = renumbered.get(c.edge);
          if (!edge) {
            edge = { ...c.edge, id: 100 + c.edge.id };
            renumbered.set(c.edge, edge);
          }
          return { ...c, edge };
        }),
      })),
    }));
    const step = solidStep({ ...boxSolid(3), voids: [cavity] }).step as string;
    expect(step).toContain('BREP_WITH_VOIDS');
    const shape = kernel.readStep(step);
    expect(kernel.isValid(shape)).toBe(true);
    // 27 cm³ − 1 cm³ → 26000 mm³.
    expect(kernel.properties(shape).volume).toBeCloseTo(26000, 2);
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

  it('takes a face deletion the kernel refused out of the design, and changes nothing else', async () => {
    // A 20 mm cube with a through hole. The hole's wall is deleted (works: the cube
    // is whole again), then a face that is gone (refused).
    const design = Design.create({ name: 'Cube' });
    const cube = design.box({ length: '20 mm', width: '20 mm', height: '20 mm' });
    design.hole({
      plane: cube.face('cap:end'),
      x: '10 mm',
      y: '10 mm',
      diameter: '4 mm',
      extent: 'through',
    });
    const engine = new RecomputeEngine(kernel, kernelFeatures(), { strictLeaks: true });
    let wall: GeomRef | undefined;
    try {
      const first = await engine.recompute({ doc: design.toJSON() });
      if (first.status !== 'done') throw new Error(first.status);
      const body = first.bodies[0];
      const index = body?.mesh?.faceIds?.findIndex((n) => n.startsWith('hole:')) ?? -1;
      expect(index).toBeGreaterThanOrEqual(0);
      wall = engine.reference(body?.id as BodyId, 'face', index);
    } finally {
      engine.clear();
    }
    if (!wall) throw new Error('no hole wall');
    design.removeFaces({ faces: wall } as never, { name: 'Works' });
    design.removeFaces({ faces: { kind: 'face', id: 'hole:gone' } } as never, { name: 'Gone' });
    const run = async (d: Design) => {
      const e = new RecomputeEngine(kernel, kernelFeatures(), { strictLeaks: true });
      try {
        const r = await e.recompute({ doc: d.toJSON() });
        if (r.status !== 'done') throw new Error(r.status);
        const bodies: { id: BodyId; measure: BodyMeasure }[] = [];
        for (const b of r.bodies) {
          const shape = e.latestBody(b.id);
          if (!shape) continue;
          const { volume, bbox } = kernel.properties(shape);
          bodies.push({
            id: b.id,
            measure: { volume, box: [...bbox.min, ...bbox.max] as BodyMeasure['box'] },
          });
        }
        return { features: r.features, bodies };
      } finally {
        e.clear();
      }
    };
    const before = await run(design);
    const dropped = failedDeletions(design, before.features);
    expect(dropped.map((d) => d.name)).toEqual(['Gone']);
    expect(dropped[0]?.reason).toMatch(/^Extrudo couldn't remove its faces: \S/);
    // The hole's wall deletion works: the whole 20 mm cube.
    expect(before.bodies[0]?.measure.volume).toBeCloseTo(8000, 3);
    const steps: BodyStep[] = [
      { record: 1, name: 'Body1', step: solidStep(boxSolid(2)).step as string },
    ];
    const planOf = (r: typeof before) => {
      const measure = r.bodies[0]?.measure as BodyMeasure;
      return planBodies({
        replayed: r.bodies,
        file: fileBodies(steps, [], new Map([[1, measure]])),
      });
    };
    const planBefore = planOf(before);
    expect(planBefore.matched).toHaveLength(1);
    applyBodyPlan(design, { ...planBefore, dropped }, steps);
    const names = design.doc.features.map((f) => f.name);
    expect(names).toContain('Works');
    expect(names).not.toContain('Gone');
    const after = await run(design);
    expect(Object.values(after.features).every((f) => f.status === 'ok')).toBe(true);
    expect(after.bodies).toEqual(before.bodies);
    expect(planOf(after)).toEqual(planBefore);
  });
});

/**
 * A base feature (record 40) holding a 10 mm box whose faces the file tags
 * `<k>@900` (k the face's place in `boxSolid`), the design body (51) it made,
 * and the box's STEP as the writer gives it.
 */
function baseDesign(): { f3d: F3dDesign; bases: BaseStep[] } {
  const base: F3dBaseFeature = {
    type: 'base',
    id: 40,
    kind: 'Base Feature',
    name: 'Base Feature1',
    suppressed: false,
    parameters: [],
    kept: 50,
    made: 51,
  };
  const step = solidStep(boxSolid(1)).step as string;
  return {
    f3d: {
      parameters: [],
      userParameters: [],
      features: [base],
      bodies: [{ id: 51, index: 1, visible: true, creator: 40, ops: [900] }],
      problems: [],
      unreadParameters: 0,
    },
    bases: [{ feature: 40, step, faces: [1, 2, 3, 4, 5, 6].map((k) => [`${k}@900`]) }],
  };
}

/** A 1 mm chamfer on the box's top edge along +x (between faces 2 and 6). */
function topChamfer(): F3dEdgeFeature {
  const face = (token: string, point: V, normal: V) => ({
    // The file names the face by the operation that first made it, the base
    // feature as a later change (`[op, -base]`): here an operation of no record.
    tags: [{ token, designs: [900, -901] }],
    surface: { kind: 'plane' as const, point, normal },
  });
  return {
    type: 'chamfer',
    id: 41,
    kind: 'Chamfer',
    name: 'Chamfer1',
    suppressed: false,
    parameters: [],
    sets: [
      {
        size: {
          name: 'd1',
          expression: '1 mm',
          kind: 'Distance',
          unit: 'cm',
          value: 0.1,
          comment: '',
          user: false,
          number: 1,
          id: 0,
        },
        edges: [
          { faces: [face('2', [0, 0, 1], [0, 0, 1]), face('6', [1, 0, 0], [1, 0, 0])], bounds: [] },
        ],
      },
    ],
  };
}

describe('base features', () => {
  it("imports a base feature's body at its place; a chamfer after it names its edge", async () => {
    const { f3d, bases } = baseDesign();
    f3d.features.push(topChamfer());
    const { design, report, files } = f3dToDesign(f3d, 'Box', { bases });
    expect(report.imported).toEqual(['Base Feature1', 'Chamfer1']);
    const [made, chamfer] = design.doc.features;
    expect(made).toMatchObject({ type: 'import', name: 'Base Feature1' });
    const edges = chamfer?.inputs.edges as { refs: GeomRef[] } | undefined;
    const ref = edges?.refs[0]?.id;
    expect(ref).toContain(`import:${made?.id}:face:2`);
    expect(ref).toContain(`import:${made?.id}:face:6`);
    expect(files?.size).toBe(1);
    const after = await measureDesign(design, files);
    // The box less a 1 mm × 1 mm × ½ prism along its 10 mm edge.
    expect(([...after.values()][0] as BodyMeasure).volume).toBeCloseTo(995, 3);
  });

  it('counts the base body as made by the timeline: editable, not frozen or written again', async () => {
    const { f3d, bases } = baseDesign();
    const { design, bodies, files } = f3dToDesign(f3d, 'Box', { bases });
    const steps: BodyStep[] = [{ record: 51, name: 'Body1', step: bases[0]?.step as string }];
    const { plan } = await check(design, bodies, steps, files);
    const id = design.doc.features[0]?.id as string;
    expect(plan.matched).toEqual([{ body: `${id}:0`, record: 51, name: 'Body1' }]);
    expect(plan.frozen).toEqual([]);
    expect(plan.remove).toEqual([]);
    applyBodyPlan(design, plan, steps);
    expect(design.doc.features.map((f) => f.type)).toEqual(['import']);
    expect(Object.keys(design.doc.attachments ?? {})).toHaveLength(1);
    expect([...bodyFiles(design, steps, files).keys()]).toEqual([...(files?.keys() ?? [])]);
  });

  it('says why a base feature is left out', () => {
    const { f3d } = baseDesign();
    const reason = (bases: BaseStep[]) =>
      f3dToDesign(structuredClone(f3d), 'Box', { bases }).report.skipped[0]?.reason;
    expect(reason([{ feature: 40, reason: 'unsupported geometry (helix)' }])).toBe(
      'the body it holds could not be read (unsupported geometry (helix))',
    );
    expect(reason([])).toBe('the body it holds was not found');
  });

  it('imports a base feature that holds no body as nothing, with no note', () => {
    const { f3d } = baseDesign();
    delete (f3d.features[0] as F3dBaseFeature).kept;
    const { design, report } = f3dToDesign(f3d, 'Box');
    expect(report.imported).toEqual(['Base Feature1']);
    expect(report.skipped).toEqual([]);
    expect(report.notes).toEqual([]);
    expect(design.doc.features).toEqual([]);
  });

  it('names no face of the base body that two faces tag alike', () => {
    const { f3d, bases } = baseDesign();
    f3d.features.push(topChamfer());
    const faces = bases[0]?.faces?.map(() => ['2@900']);
    const { report } = f3dToDesign(f3d, 'Box', { bases: [{ ...bases[0], feature: 40, faces }] });
    expect(report.imported).toEqual(['Base Feature1']);
  });

  it("imports the body a body move pasted when the bodies it took aren't known", async () => {
    const { f3d, bases } = baseDesign();
    // A cut and paste of bodies that made base feature 40 off the timeline; the body it cut is gone.
    f3d.features = [
      {
        type: 'other',
        id: 45,
        kind: 'CutPasteBodies',
        name: 'CutPasteBodies1',
        suppressed: false,
        parameters: [],
      },
      {
        type: 'other',
        id: 46,
        kind: 'Group',
        name: 'Group',
        suppressed: false,
        parameters: [],
        group: true,
      },
    ];
    f3d.bodyMoves = [{ id: 45, sources: [], made: [51], base: 40 }];
    const without = f3dToDesign(structuredClone(f3d), 'Box');
    expect(without.report.skipped).toEqual([
      {
        name: 'CutPasteBodies1',
        kind: 'CutPasteBodies',
        reason: 'the bodies it moves were not found',
      },
    ]);
    const { design, report, files, bodies } = f3dToDesign(f3d, 'Box', { bases });
    expect(report.imported).toEqual(['CutPasteBodies1', 'Group']);
    expect(design.doc.features).toMatchObject([{ type: 'import', name: 'CutPasteBodies1' }]);
    expect(bodies?.[0]?.hint).toBe(`${design.doc.features[0]?.id}:0`);
    expect([...(await measureDesign(design, files)).values()][0]?.volume).toBeCloseTo(1000, 3);
  });
});
