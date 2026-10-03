import { describe, expect, it } from 'vitest';
import { applyCommand, CommandError } from '../commands';
import { createDocument } from '../document';
import { FeatureRegistry } from '../features';
import type { ConstraintId, DimensionId, FeatureId, SketchEntityId } from '../ids';
import { DocumentSchema } from '../schema';
import { createDocumentStore } from '../stores';
import { sampleDocument } from '../testing';
import {
  addToSketch,
  createSketch,
  entityRemoval,
  removeFromSketch,
  setSketchConstruction,
  setText,
} from './commands';
import {
  emptySketchData,
  parseProfileRefId,
  profileRefId,
  readSketch,
  SketchInputsSchema,
  sketchFeature,
  sketchInputs,
  usedSketches,
} from './feature';
import {
  ORIGIN_PLANES,
  originPlaneRef,
  planeFrame,
  sketchToWorld,
  type Vec3,
  worldToSketch,
} from './planes';
import { constraintRefs, type FontId, SketchDataSchema, sketchIssues } from './schema';

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
    expect(issues({ ...r, entities: { ...r.entities, s: { type: 'bezier' } } })).toHaveLength(1);
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

  it('takes ellipses and fit-point splines (P1-05)', () => {
    const r = rectangle();
    const entities = {
      ...r.entities,
      ec: { type: 'point', x: 30, y: 0 },
      ea: { type: 'point', x: 36, y: 0 },
      eb: { type: 'point', x: 30, y: 3 },
      oval: { type: 'ellipse', center: 'ec', major: 'ea', minor: 'eb', construction: false },
      f1: { type: 'point', x: 0, y: 20 },
      f2: { type: 'point', x: 5, y: 25 },
      f3: { type: 'point', x: 10, y: 20 },
      wave: { type: 'spline', points: ['f1', 'f2', 'f3'], construction: false },
    };
    const constraints = {
      ...r.constraints,
      on: { type: 'pointOnCurve', point: 'c', curve: 'oval' },
      fixWave: { type: 'fix', entity: 'wave' },
    };
    expect(issues({ ...r, entities, constraints })).toEqual([]);

    const broken = {
      ...r,
      entities: {
        ...entities,
        short: { type: 'spline', points: ['f9'], construction: false },
        f9: { type: 'point', x: 1, y: 1 },
        twice: { type: 'spline', points: ['f1', 'f3'], construction: false },
        squashed: { type: 'ellipse', center: 'c2', major: 'c2', minor: 'a1', construction: false },
      },
      constraints: {
        ...constraints,
        onSpline: { type: 'pointOnCurve', point: 'c', curve: 'wave' },
        tangent: { type: 'tangent', a: 'oval', b: 'bottom' },
        mirror: { type: 'symmetric', a: 'oval', b: 'oval', axis: 'left' },
      },
    };
    expect(issues(broken)).toEqual([
      'entities.short.points: Too small: expected array to have >=2 items',
      'entities.twice.points.0: point "f1" already belongs to "wave"; join them with a constraint',
      'entities.twice.points.1: point "f3" already belongs to "wave"; join them with a constraint',
      'entities.squashed.center: point "c2" already belongs to "arc"; join them with a constraint',
      'entities.squashed.major: point "c2" already belongs to "arc"; join them with a constraint',
      'entities.squashed.minor: point "a1" already belongs to "arc"; join them with a constraint',
      'entities.squashed: refers to the same entity twice',
      'constraints.onSpline.curve: must be a line, circle, arc or ellipse, not a spline',
      'constraints.tangent.a: must be a line, circle or arc, not an ellipse',
      'constraints.mirror.a: must be a point, line, circle or arc, not an ellipse',
      'constraints.mirror.b: must be a point, line, circle or arc, not an ellipse',
      'constraints.mirror: refers to the same entity twice',
    ]);
  });

  it('keeps one ID space for entities, constraints and dimensions', () => {
    const r = rectangle();
    expect(issues({ ...r, dimensions: { ...r.dimensions, k1: r.dimensions.d1 } })).toEqual([
      'dimensions.k1: ID is also used in constraints',
    ]);
  });

  it('takes a text entity and keeps constraints and projections off it (P4-03)', () => {
    const r = rectangle();
    const entities = {
      ...r.entities,
      ta: { type: 'point', x: 40, y: 0 },
      tt: { type: 'point', x: 40, y: 10 },
      label: {
        type: 'text',
        anchor: 'ta',
        top: 'tt',
        text: 'Hi',
        font: 'inter-regular@1',
        align: 'left',
        construction: false,
      },
    };
    expect(issues({ ...r, entities })).toEqual([]);

    const problems = (changes: object) => issues({ ...r, entities, ...changes });
    expect(
      problems({ constraints: { ...r.constraints, fixText: { type: 'fix', entity: 'label' } } }),
    ).toEqual([
      'constraints.fixText.entity: must be a point, line, circle, arc, ellipse or spline, not a text',
    ]);
    const other = (patch: object) => ({
      entities: {
        ...entities,
        ta2: { type: 'point', x: 60, y: 0 },
        tt2: { type: 'point', x: 60, y: 10 },
        ...patch,
      },
    });
    expect(
      problems({
        ...other({
          empty: {
            type: 'text',
            anchor: 'ta2',
            top: 'tt2',
            text: '',
            font: 'inter-regular@1',
            align: 'left',
            construction: false,
          },
        }),
      }),
    ).toEqual(['entities.empty.text: Too small: expected string to have >=1 characters']);
    expect(
      problems({
        ...other({
          bad: {
            type: 'text',
            anchor: 'ta2',
            top: 'tt2',
            text: 'Hi',
            font: 'Inter Regular',
            align: 'left',
            construction: false,
          },
        }),
      }),
    ).toEqual(['entities.bad.font: Invalid string: must match pattern /^[a-z0-9-]+@[0-9]+$/']);
    expect(
      problems({
        entities: {
          ...entities,
          flat: { ...entities.label, anchor: 'tt' },
        },
      }),
    ).toEqual([
      'entities.flat.anchor: point "tt" already belongs to "label"; join them with a constraint',
      'entities.flat.top: point "tt" already belongs to "label"; join them with a constraint',
      'entities.flat: refers to the same entity twice',
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

describe('usedSketches', () => {
  const sketch = (id: string, visible?: boolean) => ({
    id: id as FeatureId,
    type: 'sketch',
    ...(visible === false && { visible }),
  });
  const features = [
    sketch('S1'),
    sketch('S2'),
    sketch('S3', false),
    { ...sketch('E1'), type: 'x' },
  ];

  it('lists the shown sketches whose profiles a feature uses, once each', () => {
    const inputs = {
      profiles: {
        kind: 'ref' as const,
        refs: [
          { kind: 'profile' as const, id: profileRefId('S2' as FeatureId, 'a') },
          { kind: 'profile' as const, id: profileRefId('S2' as FeatureId, 'b') },
          { kind: 'profile' as const, id: profileRefId('S1' as FeatureId, 'c') },
          { kind: 'face' as const, id: 'E1:top' },
        ],
      },
      // A sketch line as an axis doesn't use the sketch up.
      axis: { kind: 'ref' as const, refs: [{ kind: 'sketchEntity' as const, id: 'S2/l1' }] },
    };
    expect(usedSketches({ inputs }, features)).toEqual(['S1', 'S2']);
  });

  it('skips hidden sketches, other features and missing ones', () => {
    const refs = ['S3/a', 'E1/a', 'S9/a'].map((id) => ({ kind: 'profile' as const, id }));
    expect(usedSketches({ inputs: { profiles: { kind: 'ref', refs } } }, features)).toEqual([]);
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

describe('addToSketch', () => {
  const eid = (id: string) => id as SketchEntityId;
  const withSketch = () =>
    applyCommand(
      createDocument(),
      createSketch({ id: fid('s1'), plane: originPlaneRef('origin:xy') }),
    ).doc;
  const line = {
    entities: {
      [eid('a')]: { type: 'point', x: 0, y: 0 },
      [eid('b')]: { type: 'point', x: 10, y: 0 },
      [eid('l')]: { type: 'line', start: eid('a'), end: eid('b'), construction: false },
    },
    constraints: { ['h' as ConstraintId]: { type: 'horizontal', a: eid('l') } },
    dimensions: {
      ['d' as DimensionId]: {
        type: 'distance',
        orientation: 'aligned',
        a: eid('l'),
        expr: '10',
        driven: false,
      },
    },
  } as const;
  const data = (doc: ReturnType<typeof withSketch>) => {
    const f = doc.features[0];
    return f ? readSketch(f)?.data : undefined;
  };

  it('adds entities, constraints and dimensions, and moves existing points', () => {
    const doc = applyCommand(withSketch(), addToSketch({ feature: fid('s1'), ...line })).doc;
    expect(data(doc)).toEqual(line);
    const moved = applyCommand(
      doc,
      addToSketch({ feature: fid('s1'), points: { [eid('b')]: { x: 12, y: 0 } } }),
    ).doc;
    expect(data(moved)?.entities[eid('b')]).toEqual({ type: 'point', x: 12, y: 0 });
    expect(() => DocumentSchema.parse(moved)).not.toThrow();
  });

  it('refuses taken IDs, dangling references and unknown sketches', () => {
    const doc = applyCommand(withSketch(), addToSketch({ feature: fid('s1'), ...line })).doc;
    const add =
      (payload: Omit<Parameters<typeof addToSketch>[0], 'feature'>, feature = 's1') =>
      () =>
        applyCommand(doc, addToSketch({ feature: fid(feature), ...payload }));
    expect(add({ entities: { [eid('a')]: { type: 'point', x: 1, y: 1 } } })).toThrow(
      'The sketch already has "a".',
    );
    expect(
      add({ constraints: { ['v' as ConstraintId]: { type: 'vertical', a: eid('zz') } } }),
    ).toThrow('constraints.v.a refers to missing entity "zz"');
    expect(add({ points: { [eid('l')]: { x: 0, y: 0 } } })).toThrow(
      '"l" isn\'t a point of this sketch.',
    );
    expect(add({}, 'nope')).toThrow('There\'s no sketch "nope".');
  });
});

describe('removeFromSketch', () => {
  const eid = (id: string) => id as SketchEntityId;
  const doc = () =>
    applyCommand(
      applyCommand(
        createDocument(),
        createSketch({ id: fid('s1'), plane: originPlaneRef('origin:xy') }),
      ).doc,
      addToSketch({
        feature: fid('s1'),
        entities: {
          [eid('a')]: { type: 'point', x: 0, y: 0 },
          [eid('b')]: { type: 'point', x: 10, y: 0 },
          [eid('l')]: { type: 'line', start: eid('a'), end: eid('b'), construction: false },
        },
        constraints: {
          ['h' as ConstraintId]: { type: 'horizontal', a: eid('l') },
          ['f' as ConstraintId]: { type: 'fix', entity: eid('a') },
        },
        dimensions: {
          ['d' as DimensionId]: {
            type: 'distance',
            orientation: 'aligned',
            a: eid('l'),
            expr: '10',
            driven: false,
          },
        },
      }),
    ).doc;
  const data = (d: ReturnType<typeof doc>) => {
    const f = d.features[0];
    return f ? readSketch(f)?.data : undefined;
  };

  it('removes constraints and dimensions and leaves the geometry alone', () => {
    const result = applyCommand(
      doc(),
      removeFromSketch({
        feature: fid('s1'),
        constraints: ['h' as ConstraintId],
        dimensions: ['d' as DimensionId],
      }),
    );
    expect(Object.keys(data(result.doc)?.constraints ?? {})).toEqual(['f']);
    expect(data(result.doc)?.dimensions).toEqual({});
    expect(data(result.doc)?.entities).toEqual(data(doc())?.entities);
    expect(result.doc.features[0]).not.toBe(doc().features[0]);
  });

  it('refuses IDs the sketch does not have, changing nothing', () => {
    const remove = (payload: Omit<Parameters<typeof removeFromSketch>[0], 'feature'>) => () =>
      applyCommand(doc(), removeFromSketch({ feature: fid('s1'), ...payload }));
    expect(remove({ constraints: ['h' as ConstraintId, 'zz' as ConstraintId] })).toThrow(
      'The sketch has no constraint "zz".',
    );
    expect(remove({ dimensions: ['h' as DimensionId] })).toThrow(
      'The sketch has no dimension "h".',
    );
  });
});

describe('removing entities', () => {
  const eid = (id: string) => id as SketchEntityId;
  const pt = (x: number, y: number) => ({ type: 'point' as const, x, y });
  /** Two joined lines, a lone point on the first, a 4-point spline and a used dimension. */
  const doc = () => {
    const created = applyCommand(
      createDocument(),
      createSketch({ id: fid('s1'), plane: originPlaneRef('origin:xy') }),
    ).doc;
    return applyCommand(
      created,
      addToSketch({
        feature: fid('s1'),
        entities: {
          [eid('a1')]: pt(0, 0),
          [eid('a2')]: pt(10, 0),
          [eid('b1')]: pt(10, 0),
          [eid('b2')]: pt(10, 10),
          [eid('la')]: { type: 'line', start: eid('a1'), end: eid('a2'), construction: false },
          [eid('lb')]: { type: 'line', start: eid('b1'), end: eid('b2'), construction: false },
          [eid('p')]: pt(5, 0),
          [eid('s1')]: pt(0, 20),
          [eid('s2')]: pt(5, 25),
          [eid('s3')]: pt(10, 20),
          [eid('s4')]: pt(15, 25),
          [eid('sp')]: {
            type: 'spline',
            points: [eid('s1'), eid('s2'), eid('s3'), eid('s4')],
            construction: false,
          },
        },
        constraints: {
          ['join' as ConstraintId]: { type: 'coincident', a: eid('a2'), b: eid('b1') },
          ['on' as ConstraintId]: { type: 'pointOnCurve', point: eid('p'), curve: eid('la') },
          ['hb' as ConstraintId]: { type: 'vertical', a: eid('lb') },
          ['fs' as ConstraintId]: { type: 'fix', entity: eid('s2') },
        },
        dimensions: {
          ['da' as DimensionId]: {
            type: 'distance',
            orientation: 'aligned',
            a: eid('la'),
            expr: '10',
            driven: false,
            paramName: 'd1',
          },
          ['db' as DimensionId]: {
            type: 'distance',
            orientation: 'aligned',
            a: eid('lb'),
            expr: 'd1',
            driven: false,
            paramName: 'd2',
          },
        },
      }),
    ).doc;
  };
  const data = (d: ReturnType<typeof doc>) => {
    const f = d.features[0];
    const view = f && readSketch(f);
    if (!view) throw new Error('no sketch');
    return view.data;
  };

  it("takes a curve's points and the constraints and dimensions on them", () => {
    const r = entityRemoval(data(doc()), [eid('lb')]);
    expect(r.entities.sort()).toEqual(['b1', 'b2', 'lb']);
    expect(r.constraints.sort()).toEqual(['hb', 'join']);
    expect(r.dimensions).toEqual(['db']);
  });

  it('takes the curve a point belongs to, but not a point on it', () => {
    const r = entityRemoval(data(doc()), [eid('a1')]);
    expect(r.entities.sort()).toEqual(['a1', 'a2', 'la']);
    expect(r.constraints.sort()).toEqual(['join', 'on']);
    expect(entityRemoval(data(doc()), [eid('p')]).entities).toEqual(['p']);
  });

  it("drops a spline's point while two are left, then the spline", () => {
    const one = entityRemoval(data(doc()), [eid('s2')]);
    expect(one.entities).toEqual(['s2']);
    expect(one.splines).toEqual({ sp: ['s1', 's3', 's4'] });
    expect(one.constraints).toEqual(['fs']);
    const three = entityRemoval(data(doc()), [eid('s1'), eid('s2'), eid('s3')]);
    expect(three.splines).toEqual({});
    expect(three.entities.sort()).toEqual(['s1', 's2', 's3', 's4', 'sp']);
  });

  it('deletes geometry with its constraints and dimensions as one command', () => {
    // da's parameter is used by db, which goes too.
    const result = applyCommand(
      doc(),
      removeFromSketch({ feature: fid('s1'), entities: [eid('la'), eid('lb')] }),
    );
    const d = data(result.doc);
    expect(Object.keys(d.entities).sort()).toEqual(['p', 's1', 's2', 's3', 's4', 'sp']);
    expect(Object.keys(d.constraints)).toEqual(['fs']);
    expect(d.dimensions).toEqual({});
    expect(sketchIssues(d)).toEqual([]);
  });

  it('refuses to delete a dimension another expression still uses', () => {
    expect(() =>
      applyCommand(doc(), removeFromSketch({ feature: fid('s1'), entities: [eid('la')] })),
    ).toThrow(CommandError);
    expect(() =>
      applyCommand(doc(), removeFromSketch({ feature: fid('s1'), entities: [eid('zz')] })),
    ).toThrow('The sketch has no entity "zz".');
  });

  it('sets the construction flag on curves and skips points', () => {
    const result = applyCommand(
      doc(),
      setSketchConstruction({
        feature: fid('s1'),
        entities: [eid('la'), eid('p'), eid('sp')],
        construction: true,
      }),
    );
    const d = data(result.doc);
    expect(d.entities[eid('la')]).toMatchObject({ construction: true });
    expect(d.entities[eid('sp')]).toMatchObject({ construction: true });
    expect(d.entities[eid('lb')]).toMatchObject({ construction: false });
    expect(d.entities[eid('p')]).toEqual({ type: 'point', x: 5, y: 0 });
  });
});

describe('sketch text', () => {
  const eid = (id: string) => id as SketchEntityId;
  const pt = (x: number, y: number) => ({ type: 'point' as const, x, y });
  /** A text with its two points, the vertical constraint between them and its height dimension. */
  const doc = () => {
    const created = applyCommand(
      createDocument(),
      createSketch({ id: fid('s1'), plane: originPlaneRef('origin:xy') }),
    ).doc;
    return applyCommand(
      created,
      addToSketch({
        feature: fid('s1'),
        entities: {
          [eid('a')]: pt(0, 0),
          [eid('t')]: pt(0, 10),
          [eid('label')]: {
            type: 'text',
            anchor: eid('a'),
            top: eid('t'),
            text: 'Hi',
            font: 'inter-regular@1',
            align: 'left',
            construction: false,
          },
        },
        constraints: {
          ['up' as ConstraintId]: { type: 'vertical', a: eid('a'), b: eid('t') },
        },
        dimensions: {
          ['dh' as DimensionId]: {
            type: 'distance',
            orientation: 'vertical',
            a: eid('a'),
            b: eid('t'),
            expr: '10 mm',
            paramName: 'd1',
            driven: false,
          },
        },
      }),
    ).doc;
  };
  const data = (d: ReturnType<typeof doc>) => {
    const f = d.features[0];
    const view = f && readSketch(f);
    if (!view) throw new Error('no sketch');
    return view.data;
  };

  it('removing the text takes its two points, the vertical constraint and the height dimension', () => {
    const r = entityRemoval(data(doc()), [eid('label')]);
    expect(r.entities.sort()).toEqual(['a', 'label', 't']);
    expect(r.constraints).toEqual(['up']);
    expect(r.dimensions).toEqual(['dh']);
    const result = applyCommand(
      doc(),
      removeFromSketch({ feature: fid('s1'), entities: [eid('label')] }),
    );
    const d = data(result.doc);
    expect(Object.keys(d.entities)).toEqual([]);
    expect(d.constraints).toEqual({});
    expect(d.dimensions).toEqual({});
    expect(sketchIssues(d)).toEqual([]);
  });

  it('removing one of the text\u2019s points removes the text', () => {
    const r = entityRemoval(data(doc()), [eid('a')]);
    expect(r.entities.sort()).toEqual(['a', 'label', 't']);
    expect(r.constraints).toEqual(['up']);
    expect(r.dimensions).toEqual(['dh']);
  });

  it('edits the string, font, alignment and construction flag as one command', () => {
    const result = applyCommand(
      doc(),
      setText({
        feature: fid('s1'),
        id: eid('label'),
        patch: { text: 'Extrudo', font: 'inter-bold@1', align: 'center', construction: true },
      }),
    );
    expect(data(result.doc)?.entities[eid('label')]).toEqual({
      type: 'text',
      anchor: eid('a'),
      top: eid('t'),
      text: 'Extrudo',
      font: 'inter-bold@1',
      align: 'center',
      construction: true,
    });
    // Fields left out stay as they are.
    const partial = applyCommand(
      doc(),
      setText({ feature: fid('s1'), id: eid('label'), patch: { align: 'right' } }),
    );
    const e = data(partial.doc)?.entities[eid('label')];
    expect(e).toMatchObject({ text: 'Hi', font: 'inter-regular@1', align: 'right' });
  });

  it('refuses an invalid patch and a non-text ID, changing nothing', () => {
    const edit =
      (patch: Parameters<typeof setText>[0]['patch'], id = eid('label')) =>
      () =>
        applyCommand(doc(), setText({ feature: fid('s1'), id, patch }));
    expect(edit({ text: '' })).toThrow(CommandError);
    expect(edit({ font: 'Inter Regular' as FontId })).toThrow(CommandError);
    expect(edit({}, eid('a'))).toThrow('"a" isn\'t a text of this sketch.');
  });
});

describe('constraintRefs', () => {
  const e = (id: string) => id as SketchEntityId;
  it('lists what each constraint refers to', () => {
    expect(constraintRefs({ type: 'parallel', a: e('l1'), b: e('l2') })).toEqual(['l1', 'l2']);
    expect(constraintRefs({ type: 'pointOnCurve', point: e('p'), curve: e('c') })).toEqual([
      'p',
      'c',
    ]);
    expect(constraintRefs({ type: 'horizontal', a: e('l') })).toEqual(['l']);
    expect(constraintRefs({ type: 'vertical', a: e('p'), b: e('q') })).toEqual(['p', 'q']);
    expect(constraintRefs({ type: 'fix', entity: e('p') })).toEqual(['p']);
    expect(constraintRefs({ type: 'symmetric', a: e('p'), b: e('q'), axis: e('l') })).toEqual([
      'p',
      'q',
      'l',
    ]);
  });
});

describe('profile reference IDs', () => {
  it('join a sketch feature and a region, and split back', () => {
    const id = profileRefId('f-1' as FeatureId, 'abc123');
    expect(id).toBe('f-1/abc123');
    expect(parseProfileRefId(id)).toEqual({ feature: 'f-1', profile: 'abc123' });
    expect(parseProfileRefId('no-slash')).toBeUndefined();
    expect(parseProfileRefId('/x')).toBeUndefined();
    expect(parseProfileRefId('x/')).toBeUndefined();
  });
});
