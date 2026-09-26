import { describe, expect, it } from 'vitest';
import { applyCommand, CommandError } from '../commands';
import { createDocument } from '../document';
import { FeatureRegistry } from '../features';
import type { FeatureId } from '../ids';
import { DocumentSchema } from '../schema';
import { createDocumentStore } from '../stores';
import { sampleDocument } from '../testing';
import { createSketch } from './commands';
import {
  emptySketchData,
  readSketch,
  SketchInputsSchema,
  sketchFeature,
  sketchInputs,
} from './feature';
import {
  ORIGIN_PLANES,
  originPlaneRef,
  planeFrame,
  sketchToWorld,
  type Vec3,
  worldToSketch,
} from './planes';
import { SketchDataSchema, sketchIssues } from './schema';

const fid = (id: string) => id as FeatureId;

/** A 20 × 10 rectangle (each line with its own endpoints), a hole and an arc, with every constraint and dimension type. */
function rectangle() {
  return {
    entities: {
      p1: { type: 'point', x: 0, y: 0 },
      p2: { type: 'point', x: 20, y: 0 },
      p3: { type: 'point', x: 20, y: 10 },
      p4: { type: 'point', x: 0, y: 10 },
      q1: { type: 'point', x: 20, y: 0 },
      q2: { type: 'point', x: 20, y: 10 },
      bottom: { type: 'line', start: 'p1', end: 'p2', construction: false },
      right: { type: 'line', start: 'q1', end: 'q2', construction: false },
      top: { type: 'line', start: 'p3', end: 'p4', construction: false },
      s1: { type: 'point', x: 0, y: 10 },
      s2: { type: 'point', x: 0, y: 0 },
      left: { type: 'line', start: 's1', end: 's2', construction: false },
      c: { type: 'point', x: 10, y: 5 },
      hole: { type: 'circle', center: 'c', radius: 2, construction: false },
      c2: { type: 'point', x: 10, y: 5 },
      a1: { type: 'point', x: 14, y: 5 },
      a2: { type: 'point', x: 10, y: 9 },
      arc: { type: 'arc', center: 'c2', start: 'a1', end: 'a2', construction: true },
    },
    constraints: {
      k1: { type: 'coincident', a: 'p2', b: 'q1' },
      k2: { type: 'coincident', a: 'q2', b: 'p3' },
      k3: { type: 'horizontal', a: 'bottom' },
      k4: { type: 'vertical', a: 'p4', b: 'p1' },
      k5: { type: 'parallel', a: 'bottom', b: 'top' },
      k6: { type: 'perpendicular', a: 'bottom', b: 'right' },
      k7: { type: 'fix', entity: 'p1' },
      k8: { type: 'pointOnCurve', point: 'c', curve: 'bottom' },
      k9: { type: 'midpoint', point: 'c', of: 'top' },
      k10: { type: 'concentric', a: 'hole', b: 'arc' },
      k11: { type: 'tangent', a: 'hole', b: 'top' },
      k12: { type: 'equal', a: 'bottom', b: 'top' },
      k13: { type: 'symmetric', a: 'p1', b: 'p2', axis: 'left' },
      k14: { type: 'collinear', a: 'left', b: 'right' },
      k15: { type: 'smooth', a: 'arc', b: 'right' },
    },
    dimensions: {
      d1: { type: 'distance', orientation: 'aligned', a: 'bottom', expr: 'width', driven: false },
      d2: {
        type: 'distance',
        orientation: 'vertical',
        a: 'p1',
        b: 'p4',
        expr: '10 mm',
        paramName: 'd2',
        driven: false,
      },
      d3: { type: 'diameter', curve: 'hole', expr: '4', driven: false },
      d4: { type: 'radius', curve: 'arc', expr: '4', driven: true },
      d5: { type: 'angle', a: 'bottom', b: 'left', expr: '90 deg', driven: true },
      d6: {
        type: 'distance',
        orientation: 'aligned',
        a: 'c',
        b: 'left',
        expr: '10',
        driven: false,
      },
    },
  };
}

function issues(sketch: unknown): string[] {
  const result = SketchDataSchema.safeParse(sketch);
  return result.success ? [] : result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
}

describe('sketch schema', () => {
  it('accepts every entity, constraint and dimension type', () => {
    expect(issues(emptySketchData())).toEqual([]);
    expect(issues(rectangle())).toEqual([]);
  });

  it('survives a JSON round trip unchanged', () => {
    const sketch = SketchDataSchema.parse(rectangle());
    expect(SketchDataSchema.parse(JSON.parse(JSON.stringify(sketch)))).toEqual(sketch);
  });

  it('rejects unknown keys and types, and non-positive radii', () => {
    const r = rectangle();
    expect(
      issues({ ...r, entities: { ...r.entities, p1: { type: 'point', x: 0, y: 0, z: 1 } } }),
    ).toEqual(['entities.p1: Unrecognized key: "z"']);
    expect(issues({ ...r, entities: { ...r.entities, s: { type: 'spline' } } })).toHaveLength(1);
    expect(
      issues({ ...r, entities: { ...r.entities, hole: { ...r.entities.hole, radius: 0 } } }),
    ).toEqual(['entities.hole.radius: Too small: expected number to be >0']);
    expect(issues({ ...r, extra: true })).toEqual([': Unrecognized key: "extra"']);
  });

  it('keeps the side of a tangent or smooth joint when one is stored (P1-03)', () => {
    const r = rectangle();
    const constraints = {
      ...r.constraints,
      k11: { type: 'tangent', a: 'hole', b: 'top', reversed: true },
      k15: { type: 'smooth', a: 'arc', b: 'right', reversed: false },
    };
    expect(issues({ ...r, constraints })).toEqual([]);
    expect(
      issues({ ...r, constraints: { ...constraints, k11: { ...constraints.k11, reversed: 1 } } }),
    ).toHaveLength(1);
  });

  it('reports missing entities and entities of the wrong kind', () => {
    const r = rectangle();
    const broken = {
      ...r,
      entities: {
        ...r.entities,
        bottom: { type: 'line', start: 'p1', end: 'gone', construction: false },
        hole: { type: 'circle', center: 'left', radius: 2, construction: false },
      },
      constraints: {
        ...r.constraints,
        k3: { type: 'horizontal', a: 'hole' },
        k5: { type: 'parallel', a: 'bottom', b: 'c' },
      },
      dimensions: {
        ...r.dimensions,
        d3: { type: 'radius', curve: 'left', expr: '1', driven: false },
      },
    };
    expect(sketchIssues(SketchDataSchema.parse(r))).toEqual([]);
    expect(issues(broken)).toEqual([
      'entities.bottom.end: refers to missing entity "gone"',
      'entities.hole.center: must be a point, not a line',
      'constraints.k3.a: must be a line or a point, not a circle',
      'constraints.k5.b: must be a line, not a point',
      'dimensions.d3.curve: must be a circle or an arc, not a line',
    ]);
  });

  it('reports shapes a constraint or dimension type doesn’t take', () => {
    const r = rectangle();
    const constraints = {
      same: { type: 'coincident', a: 'p1', b: 'p1' },
      lineAndPoint: { type: 'horizontal', a: 'bottom', b: 'p2' },
      onePoint: { type: 'vertical', a: 'p1' },
      twoLines: { type: 'tangent', a: 'bottom', b: 'top' },
      mixed: { type: 'equal', a: 'bottom', b: 'hole' },
      kinds: { type: 'symmetric', a: 'p1', b: 'hole', axis: 'left' },
    };
    const dimensions = {
      point: { type: 'distance', orientation: 'aligned', a: 'p1', expr: '1', driven: false },
      skewed: {
        type: 'distance',
        orientation: 'horizontal',
        a: 'c',
        b: 'left',
        expr: '1',
        driven: false,
      },
    };
    expect(issues({ ...r, constraints, dimensions })).toEqual([
      'constraints.same: refers to the same entity twice',
      'constraints.lineAndPoint: takes a line or two points',
      'constraints.onePoint: needs a second point',
      "constraints.twoLines: can't join two lines",
      'constraints.mixed: needs two lines, or two circles or arcs',
      'constraints.kinds: needs two entities of the same kind',
      'dimensions.point: needs a second entity',
      'dimensions.skewed: to a line must be aligned',
    ]);
  });

  it('lets each point belong to one curve only', () => {
    const r = rectangle();
    const shared = {
      ...r,
      entities: {
        ...r.entities,
        right: { type: 'line', start: 'p2', end: 'q2', construction: false },
      },
    };
    expect(issues(shared)).toEqual([
      'entities.right.start: point "p2" already belongs to "bottom"; join them with a constraint',
    ]);
  });

  it('keeps one ID space for entities, constraints and dimensions', () => {
    const r = rectangle();
    expect(issues({ ...r, dimensions: { ...r.dimensions, k1: r.dimensions.d1 } })).toEqual([
      'dimensions.k1: ID is also used in constraints',
    ]);
  });
});

describe('sketch planes', () => {
  it('have right-handed frames: x × y = normal', () => {
    const cross = (a: Vec3, b: Vec3): Vec3 => [
      a[1] * b[2] - a[2] * b[1],
      a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0],
    ];
    for (const { frame } of ORIGIN_PLANES) {
      expect(cross(frame.x, frame.y).map((c) => c + 0)).toEqual([...frame.normal]);
    }
  });

  it('face the ViewCube: sketch X right and Y up in the Top, Front and Right views', () => {
    const frame = (id: string) => planeFrame({ kind: 'plane', id });
    // Top looks down −Z; Front looks along +Y (from −Y); Right looks along −X (from +X).
    expect(frame('origin:xy')).toMatchObject({ x: [1, 0, 0], y: [0, 1, 0], normal: [0, 0, 1] });
    expect(frame('origin:xz')).toMatchObject({ x: [1, 0, 0], y: [0, 0, 1], normal: [0, -1, 0] });
    expect(frame('origin:yz')).toMatchObject({ x: [0, 1, 0], y: [0, 0, 1], normal: [1, 0, 0] });
  });

  it('are known for origin planes only; faces come from the kernel', () => {
    expect(planeFrame({ kind: 'plane', id: 'origin:uv' })).toBeUndefined();
    expect(planeFrame({ kind: 'face', id: 'extrude:f2:cap:end' })).toBeUndefined();
  });

  it('map sketch points to world coordinates and back', () => {
    const xz = planeFrame(originPlaneRef('origin:xz'));
    if (!xz) throw new Error('no XZ frame');
    expect(sketchToWorld(xz, [3, 4])).toEqual([3, 0, 4]);
    expect(worldToSketch(xz, [3, -7, 4])).toEqual([3, 4]);
    const yz = planeFrame(originPlaneRef('origin:yz'));
    if (!yz) throw new Error('no YZ frame');
    expect(sketchToWorld(yz, [3, 4])).toEqual([0, 3, 4]);
  });
});

describe('sketch feature', () => {
  it('takes one plane or face and valid sketch data', () => {
    const ok = sketchInputs(originPlaneRef('origin:xy'));
    expect(SketchInputsSchema.safeParse(ok).success).toBe(true);
    const twoPlanes = {
      ...ok,
      plane: { kind: 'ref', refs: [originPlaneRef('origin:xy'), originPlaneRef('origin:xz')] },
    };
    expect(SketchInputsSchema.safeParse(twoPlanes).error?.issues[0]?.message).toBe(
      'must be one plane or face',
    );
    const edge = { ...ok, plane: { kind: 'ref', refs: [{ kind: 'edge', id: 'e' }] } };
    expect(SketchInputsSchema.safeParse(edge).success).toBe(false);
  });

  it('is checked by a feature registry', () => {
    const registry = new FeatureRegistry().register(sketchFeature);
    const doc = createDocument();
    const withSketch = applyCommand(
      doc,
      createSketch({ id: fid('s1'), plane: originPlaneRef('origin:xy') }),
    ).doc;
    expect(registry.check(withSketch)).toEqual([]);
    const broken = { ...withSketch, features: [{ ...withSketch.features[0], inputs: {} }] };
    expect(registry.check(broken as typeof withSketch)).toEqual([
      { featureId: 's1', message: 'plane: Invalid input: expected object, received undefined' },
      { featureId: 's1', message: 'sketch: Invalid input: expected object, received undefined' },
    ]);
  });

  it('reads a sketch’s plane and data, and nothing from other features', () => {
    const { doc } = applyCommand(
      sampleDocument(),
      createSketch({ id: fid('s1'), plane: originPlaneRef('origin:yz') }),
    );
    const sketch = doc.features.find((f) => f.id === 's1');
    if (!sketch) throw new Error('no sketch');
    expect(readSketch(sketch)).toEqual({
      plane: { kind: 'plane', id: 'origin:yz' },
      data: emptySketchData(),
    });
    // The sample's Sketch1 has no inputs (a placeholder), and Extrude1 isn't a sketch.
    expect(readSketch(doc.features[0] as (typeof doc.features)[0])).toBeUndefined();
    expect(readSketch(doc.features[1] as (typeof doc.features)[0])).toBeUndefined();
  });
});

describe('createSketch', () => {
  it('inserts an empty sketch at the marker with the next default name', () => {
    const doc = { ...sampleDocument(), timelineMarker: 1 };
    const { doc: next } = applyCommand(
      doc,
      createSketch({ id: fid('s1'), plane: originPlaneRef('origin:xz') }),
    );
    expect(next.features.map((f) => f.name)).toEqual(['Sketch1', 'Sketch2', 'Extrude1', 'Fillet1']);
    expect(next.timelineMarker).toBe(2);
    expect(next.features[1]).toEqual({
      id: 's1',
      type: 'sketch',
      name: 'Sketch2',
      suppressed: false,
      inputs: sketchInputs(originPlaneRef('origin:xz')),
    });
    expect(DocumentSchema.safeParse(next).success).toBe(true);
  });

  it('takes a name, and is one undo step', () => {
    const store = createDocumentStore(createDocument());
    store
      .getState()
      .dispatch(createSketch({ id: fid('s1'), plane: originPlaneRef('origin:xy'), name: 'Base' }));
    expect(store.getState().doc.features.map((f) => f.name)).toEqual(['Base']);
    expect(store.getState().undoLabel).toBe('Create sketch');
    store.getState().undo();
    expect(store.getState().doc.features).toEqual([]);
  });

  it('refuses planes that aren’t planes or faces, and unknown origin planes', () => {
    const doc = createDocument();
    const run = (plane: { kind: 'plane' | 'edge'; id: string }) => () =>
      applyCommand(doc, createSketch({ id: fid('s1'), plane }));
    expect(run({ kind: 'edge', id: 'e1' })).toThrow(
      new CommandError('A sketch needs a plane or a flat face.'),
    );
    expect(run({ kind: 'plane', id: 'origin:uv' })).toThrow(
      new CommandError('There\'s no origin plane "origin:uv".'),
    );
    // Construction planes (P3-05) are named by the topological-naming service.
    expect(run({ kind: 'plane', id: 'plane:f9' })).not.toThrow();
  });

  it('refuses an ID that exists', () => {
    const doc = sampleDocument();
    expect(() =>
      applyCommand(doc, createSketch({ id: fid('f1'), plane: originPlaneRef('origin:xy') })),
    ).toThrow('Feature f1 already exists.');
  });
});
