import { describe, expect, it } from 'vitest';
import { applyCommand } from '../commands';
import { createDocument } from '../document';
import { addParameter, removeParameter, updateParameter } from '../document-commands';
import { evaluateParameters, nextModelParameterName } from '../expr/parameters';
import type { DimensionId, FeatureId, SketchEntityId } from '../ids';
import type { ExtrudoDocument } from '../schema';
import { pid } from '../testing';
import {
  addToSketch,
  createSketch,
  removeFromSketch,
  setSketchGeometry,
  updateSketchDimension,
} from './commands';
import {
  dimensionAnchor,
  dimensionRefs,
  distanceEnds,
  isDatumLine,
  lineCrossing,
  measureDimension,
  roundEdgePoint,
} from './dimensions';
import { readSketch } from './feature';
import { originPlaneRef } from './planes';
import type { SketchData, SketchDimension, SketchEntity } from './schema';

const e = (id: string) => id as SketchEntityId;
const did = (id: string) => id as DimensionId;
const S1 = 's1' as FeatureId;

/** A 30 × 40 right triangle with its corner at the origin, a circle and an arc. */
function geometry(): SketchData {
  const entities: Record<string, SketchEntity> = {
    a: { type: 'point', x: 0, y: 0 },
    b: { type: 'point', x: 30, y: 0 },
    base: { type: 'line', start: e('a'), end: e('b'), construction: false },
    c: { type: 'point', x: 0, y: 0 },
    d: { type: 'point', x: 0, y: 40 },
    side: { type: 'line', start: e('c'), end: e('d'), construction: false },
    f: { type: 'point', x: 0, y: 40 },
    g: { type: 'point', x: 30, y: 0 },
    slope: { type: 'line', start: e('f'), end: e('g'), construction: false },
    o: { type: 'point', x: 50, y: 10 },
    hole: { type: 'circle', center: e('o'), radius: 5, construction: false },
    ac: { type: 'point', x: 50, y: 30 },
    as: { type: 'point', x: 56, y: 30 },
    ae: { type: 'point', x: 50, y: 36 },
    arc: { type: 'arc', center: e('ac'), start: e('as'), end: e('ae'), construction: false },
    top: { type: 'point', x: 10, y: 20 },
    u1: { type: 'point', x: 0, y: 10 },
    u2: { type: 'point', x: 30, y: 10 },
    upper: { type: 'line', start: e('u1'), end: e('u2'), construction: false },
  };
  return { entities, constraints: {}, dimensions: {} } as SketchData;
}

const dim = (d: Partial<SketchDimension> & Pick<SketchDimension, 'type'>) =>
  ({ expr: '0', driven: false, ...d }) as SketchDimension;

describe('measureDimension', () => {
  const sketch = geometry();
  const measure = (d: Partial<SketchDimension> & Pick<SketchDimension, 'type'>) =>
    measureDimension(sketch, dim(d));

  it('measures lengths, point distances, point-to-line and parallel lines', () => {
    expect(measure({ type: 'distance', orientation: 'aligned', a: e('slope') })).toBeCloseTo(50);
    expect(measure({ type: 'distance', orientation: 'horizontal', a: e('slope') })).toBeCloseTo(30);
    expect(measure({ type: 'distance', orientation: 'vertical', a: e('slope') })).toBeCloseTo(40);
    expect(
      measure({ type: 'distance', orientation: 'aligned', a: e('top'), b: e('o') }),
    ).toBeCloseTo(Math.hypot(40, 10));
    expect(
      measure({ type: 'distance', orientation: 'aligned', a: e('top'), b: e('base') }),
    ).toBeCloseTo(20);
    expect(
      measure({ type: 'distance', orientation: 'aligned', a: e('side'), b: e('top') }),
    ).toBeCloseTo(10);
    expect(
      measure({ type: 'distance', orientation: 'aligned', a: e('base'), b: e('upper') }),
    ).toBeCloseTo(10);
  });

  it('measures radii and diameters of circles and arcs', () => {
    expect(measure({ type: 'radius', curve: e('hole') })).toBe(5);
    expect(measure({ type: 'diameter', curve: e('hole') })).toBe(10);
    expect(measure({ type: 'radius', curve: e('arc') })).toBeCloseTo(6);
  });

  it('measures the angle between line directions, or its supplement', () => {
    // base runs +x; slope runs from (0, 40) to (30, 0).
    const between = (Math.atan2(40, 30) * 180) / Math.PI;
    expect(measure({ type: 'angle', a: e('base'), b: e('side') })).toBeCloseTo(90);
    expect(measure({ type: 'angle', a: e('base'), b: e('slope') })).toBeCloseTo(between);
    expect(measure({ type: 'angle', a: e('base'), b: e('slope'), supplement: true })).toBeCloseTo(
      180 - between,
    );
  });

  it('gives nothing for missing entities', () => {
    expect(measure({ type: 'radius', curve: e('nope') })).toBeUndefined();
    expect(measure({ type: 'angle', a: e('base'), b: e('nope') })).toBeUndefined();
  });
});

describe("distances to a circle's or an arc's edge (ADR-0112)", () => {
  /** A Ø20 circle at (0, 0), a vertical line x = 35, a point, a Ø10 circle at (40, 30), an arc. */
  function rounds(): SketchData {
    const entities: Record<string, SketchEntity> = {
      c: { type: 'point', x: 0, y: 0 },
      circle: { type: 'circle', center: e('c'), radius: 10, construction: false },
      l1: { type: 'point', x: 35, y: -50 },
      l2: { type: 'point', x: 35, y: 50 },
      wall: { type: 'line', start: e('l1'), end: e('l2'), construction: false },
      s1: { type: 'point', x: 20, y: 0 },
      s2: { type: 'point', x: 40, y: 20 },
      slant: { type: 'line', start: e('s1'), end: e('s2'), construction: false },
      p: { type: 'point', x: 30, y: 40 },
      c2: { type: 'point', x: 40, y: 30 },
      small: { type: 'circle', center: e('c2'), radius: 5, construction: false },
      ac: { type: 'point', x: 0, y: 60 },
      as: { type: 'point', x: 8, y: 60 },
      ae: { type: 'point', x: 0, y: 68 },
      arc: { type: 'arc', center: e('ac'), start: e('as'), end: e('ae'), construction: false },
    };
    return { entities, constraints: {}, dimensions: {} } as SketchData;
  }
  const distance = (
    orientation: 'aligned' | 'horizontal' | 'vertical',
    a: string,
    b: string,
    sides: { sideA?: 'near' | 'far'; sideB?: 'near' | 'far' } = {},
  ) =>
    dim({ type: 'distance', orientation, a: e(a), b: e(b), ...sides }) as Extract<
      SketchDimension,
      { type: 'distance' }
    >;
  const near = (x: number) => expect.closeTo(x, 9);

  it('measures a circle to a line from the edge facing it, or the far one', () => {
    const s = rounds();
    for (const o of ['aligned', 'horizontal'] as const) {
      expect(measureDimension(s, distance(o, 'circle', 'wall'))).toEqual(near(25));
      expect(measureDimension(s, distance(o, 'wall', 'circle'))).toEqual(near(25));
      expect(measureDimension(s, distance(o, 'circle', 'wall', { sideA: 'far' }))).toEqual(
        near(45),
      );
    }
    expect(distanceEnds(s, distance('aligned', 'circle', 'wall'))).toEqual([
      [near(10), near(0)],
      [near(35), near(0)],
    ]);
    // The line first: its end comes first too.
    expect(distanceEnds(s, distance('aligned', 'wall', 'circle', { sideB: 'far' }))).toEqual([
      [near(35), near(0)],
      [near(-10), near(0)],
    ]);
    // A slanted line y = x - 20: aligned square to it, horizontal along y = 0.
    const h = 20 / Math.SQRT2;
    expect(measureDimension(s, distance('aligned', 'circle', 'slant'))).toEqual(near(h - 10));
    expect(measureDimension(s, distance('aligned', 'circle', 'slant', { sideA: 'far' }))).toEqual(
      near(h + 10),
    );
    expect(measureDimension(s, distance('horizontal', 'circle', 'slant'))).toEqual(near(10));
    expect(measureDimension(s, distance('vertical', 'circle', 'slant'))).toEqual(near(10));
    expect(distanceEnds(s, distance('vertical', 'circle', 'slant'))).toEqual([
      [near(0), near(-10)],
      [near(0), near(-20)],
    ]);
  });

  it('measures a circle or an arc to a point, aligned, horizontal or vertical', () => {
    const s = rounds();
    expect(measureDimension(s, distance('aligned', 'p', 'circle'))).toEqual(near(40));
    expect(measureDimension(s, distance('aligned', 'p', 'circle', { sideB: 'far' }))).toEqual(
      near(60),
    );
    expect(measureDimension(s, distance('horizontal', 'circle', 'p'))).toEqual(near(20));
    expect(measureDimension(s, distance('horizontal', 'circle', 'p', { sideA: 'far' }))).toEqual(
      near(40),
    );
    expect(measureDimension(s, distance('vertical', 'circle', 'p'))).toEqual(near(30));
    // The arc counts as its whole circle (R8 at (0, 60)): its lower quadrant point.
    expect(measureDimension(s, distance('vertical', 'arc', 'p'))).toEqual(near(12));
    expect(distanceEnds(s, distance('vertical', 'arc', 'p'))).toEqual([
      [near(0), near(52)],
      [near(30), near(40)],
    ]);
    expect(measureDimension(s, distance('vertical', 'arc', 'p', { sideA: 'far' }))).toEqual(
      near(28),
    );
  });

  it('measures the gap between two circles, or across them', () => {
    const s = rounds();
    expect(measureDimension(s, distance('aligned', 'circle', 'small'))).toEqual(near(35));
    expect(
      measureDimension(s, distance('aligned', 'circle', 'small', { sideA: 'far', sideB: 'far' })),
    ).toEqual(near(65));
    expect(measureDimension(s, distance('aligned', 'circle', 'small', { sideB: 'far' }))).toEqual(
      near(45),
    );
    expect(measureDimension(s, distance('horizontal', 'circle', 'small'))).toEqual(near(25));
    expect(measureDimension(s, distance('vertical', 'small', 'circle'))).toEqual(near(15));
    expect(measureDimension(s, distance('vertical', 'small', 'arc', { sideB: 'far' }))).toEqual(
      near(33),
    );
  });

  it('puts the edge point on the circle with roundEdgePoint', () => {
    const s = rounds();
    expect(roundEdgePoint(s, e('circle'), 'near', [0, 50])).toEqual([near(0), near(10)]);
    expect(roundEdgePoint(s, e('circle'), 'far', [30, 40])).toEqual([near(-6), near(-8)]);
    expect(roundEdgePoint(s, e('circle'), 'near', [-1, 99], 'horizontal')).toEqual([
      near(-10),
      near(0),
    ]);
    expect(roundEdgePoint(s, e('circle'), 'far', [-1, 99], 'vertical')).toEqual([
      near(0),
      near(-10),
    ]);
    expect(roundEdgePoint(s, e('wall'), 'near', [0, 0])).toBeUndefined();
  });

  it('anchors the distance between the edge points and lists both entities', () => {
    const s = rounds();
    const d = distance('aligned', 'circle', 'wall');
    expect(dimensionAnchor(s, d)).toEqual([near(22.5), near(0)]);
    expect(dimensionRefs(d)).toEqual(['circle', 'wall']);
  });
});

describe('dimension anchors and ends', () => {
  const sketch = geometry();
  it('anchors distances at their middle, radii at the center, angles where the lines cross', () => {
    expect(
      dimensionAnchor(sketch, dim({ type: 'distance', orientation: 'aligned', a: e('base') })),
    ).toEqual([15, 0]);
    expect(dimensionAnchor(sketch, dim({ type: 'diameter', curve: e('hole') }))).toEqual([50, 10]);
    const crossing = dimensionAnchor(sketch, dim({ type: 'angle', a: e('base'), b: e('slope') }));
    expect(crossing?.[0]).toBeCloseTo(30);
    expect(crossing?.[1]).toBeCloseTo(0);
    // Parallel lines: between their middles.
    expect(dimensionAnchor(sketch, dim({ type: 'angle', a: e('base'), b: e('upper') }))).toEqual([
      15, 5,
    ]);
  });

  it('runs a point-to-line distance to the foot of the perpendicular', () => {
    const ends = distanceEnds(
      sketch,
      dim({ type: 'distance', orientation: 'aligned', a: e('base'), b: e('top') }) as Extract<
        SketchDimension,
        { type: 'distance' }
      >,
    );
    expect(ends).toEqual([
      [10, 20],
      [10, 0],
    ]);
  });

  it('hangs a line-to-axis distance on the sketch line, whichever is picked first', () => {
    const base = geometry();
    const entities: Record<string, SketchEntity> = {
      ...base.entities,
      l0: { type: 'point', x: -60, y: 41 },
      l1: { type: 'point', x: -30, y: 41 },
      ln: { type: 'line', start: e('l0'), end: e('l1'), construction: false },
      x0: { type: 'point', x: -50, y: 0 },
      x1: { type: 'point', x: 50, y: 0 },
      ax: { type: 'line', start: e('x0'), end: e('x1'), construction: true },
    };
    const withAxis = {
      ...base,
      entities,
      projections: {
        p1: { ref: { kind: 'axis', id: 'origin:x' }, curves: { axis: e('ax') } },
      },
    } as unknown as SketchData;
    const ends = (a: string, b: string) =>
      distanceEnds(
        withAxis,
        dim({ type: 'distance', orientation: 'aligned', a: e(a), b: e(b) }) as Extract<
          SketchDimension,
          { type: 'distance' }
        >,
      );
    const expected = [
      [-45, 41],
      [-45, 0],
    ];
    expect(ends('ln', 'ax')).toEqual(expected);
    expect(ends('ax', 'ln')).toEqual(expected);
    expect(
      dimensionAnchor(
        withAxis,
        dim({ type: 'distance', orientation: 'aligned', a: e('ln'), b: e('ax') }),
      ),
    ).toEqual([-45, 20.5]);
  });

  it('finds where lines cross, and nothing for parallel ones', () => {
    expect(
      lineCrossing(
        [
          [0, 0],
          [1, 0],
        ],
        [
          [5, 5],
          [5, 6],
        ],
      ),
    ).toEqual([5, 0]);
    expect(
      lineCrossing(
        [
          [0, 0],
          [1, 0],
        ],
        [
          [0, 1],
          [1, 1],
        ],
      ),
    ).toBeUndefined();
  });

  it('lists what each dimension refers to', () => {
    expect(dimensionRefs(dim({ type: 'distance', orientation: 'aligned', a: e('base') }))).toEqual([
      'base',
    ]);
    expect(dimensionRefs(dim({ type: 'angle', a: e('base'), b: e('side') }))).toEqual([
      'base',
      'side',
    ]);
    expect(dimensionRefs(dim({ type: 'radius', curve: e('arc') }))).toEqual(['arc']);
  });
});

/** A document with sketch `s1` holding the triangle and the given dimensions. */
function withDimensions(dimensions: Record<string, SketchDimension>): ExtrudoDocument {
  const { entities } = geometry();
  let doc = applyCommand(
    createDocument(),
    createSketch({ id: S1, plane: originPlaneRef('origin:xy') }),
  ).doc;
  doc = applyCommand(
    doc,
    addParameter({ parameter: { id: pid('w'), name: 'width', expression: '30', unit: 'length' } }),
  ).doc;
  return applyCommand(
    doc,
    addToSketch({
      feature: S1,
      entities,
      dimensions: dimensions as Record<DimensionId, SketchDimension>,
    }),
  ).doc;
}

const sketchOf = (doc: ExtrudoDocument) => {
  const f = doc.features.find((x) => x.id === S1);
  const view = f && readSketch(f);
  if (!view) throw new Error('no sketch');
  return view.data;
};

const length = (a: string, expr: string, extra: Partial<SketchDimension> = {}) =>
  dim({ type: 'distance', orientation: 'aligned', a: e(a), expr, ...extra });

describe('dimensions as parameters (FR-PAR-03)', () => {
  it('lists named driving dimensions as model parameters of their sketch', () => {
    const doc = withDimensions({
      k1: length('base', 'width', { paramName: 'd1' }),
      k2: dim({ type: 'angle', a: e('base'), b: e('slope'), expr: '50', paramName: 'd2' }),
      k3: length('side', '40', { paramName: 'd3', driven: true }),
    });
    const evaluation = evaluateParameters(doc);
    const d1 = evaluation.parameters.get('d1');
    expect(d1?.owner).toEqual({
      type: 'dimension',
      featureId: S1,
      input: 'sketch',
      dimension: 'k1',
    });
    expect(d1?.result).toMatchObject({ ok: true, value: 30 });
    expect(evaluation.parameters.get('d2')).toMatchObject({ unit: 'angle' });
    // Driven dimensions measure; they aren't parameters.
    expect(evaluation.parameters.has('d3')).toBe(false);
    expect(nextModelParameterName(doc)).toBe('d3');
  });

  it('evaluates every driving dimension, named or not, and follows parameters', () => {
    const doc = withDimensions({
      k1: length('base', 'width', { paramName: 'd1' }),
      k2: length('side', 'd1 + 10'),
      k3: length('slope', '50', { driven: true }),
    });
    const values = evaluateParameters(doc).dimensions.get(S1);
    expect(values?.get('k1')).toMatchObject({ ok: true, value: 30 });
    expect(values?.get('k2')).toMatchObject({ ok: true, value: 40 });
    expect(values?.has('k3')).toBe(false);
    expect(evaluateParameters(doc).featuresAffectedBy(['width'])).toEqual([S1]);
  });

  it('reports cycles through dimensions, and names used twice', () => {
    const cycle = withDimensions({
      k1: length('base', 'd2', { paramName: 'd1' }),
      k2: length('side', 'd1', { paramName: 'd2' }),
    });
    expect(evaluateParameters(cycle).dimensions.get(S1)?.get('k1')).toMatchObject({ ok: false });
    const doc = withDimensions({ k1: length('base', '10', { paramName: 'd1' }) });
    const twice = {
      ...doc,
      parameters: [
        ...doc.parameters,
        { id: pid('x'), name: 'd1', expression: '1', unit: 'length' as const },
      ],
    };
    const result = evaluateParameters(twice).dimensions.get(S1)?.get('k1');
    expect(result?.ok).toBe(false);
  });

  it('refuses a new dimension whose name is taken', () => {
    const doc = withDimensions({});
    expect(() =>
      applyCommand(
        doc,
        addToSketch({
          feature: S1,
          dimensions: { [did('k1')]: length('base', '10', { paramName: 'width' }) },
        }),
      ),
    ).toThrow('The name "width" is taken.');
  });

  it('carries renames into dimensions, and keeps used parameters from being deleted', () => {
    const doc = withDimensions({ k1: length('base', 'width * 2', { paramName: 'd1' }) });
    const renamed = applyCommand(
      doc,
      updateParameter({ id: pid('w'), changes: { name: 'wide' } }),
    ).doc;
    expect(sketchOf(renamed).dimensions[did('k1')]?.expr).toBe('wide * 2');
    expect(() => applyCommand(doc, removeParameter({ id: pid('w') }))).toThrow(
      '`width` is used by `d1`.',
    );
    const unnamed = withDimensions({ k1: length('base', 'width') });
    expect(() => applyCommand(unnamed, removeParameter({ id: pid('w') }))).toThrow(
      '`width` is used by Sketch1.',
    );
  });
});

describe('updateSketchDimension', () => {
  it('changes the expression and label and moves geometry in one step', () => {
    const doc = withDimensions({ k1: length('base', '30', { paramName: 'd1' }) });
    const next = applyCommand(
      doc,
      updateSketchDimension({
        feature: S1,
        id: did('k1'),
        changes: { expr: '35', label: { x: 0, y: -8 } },
        points: { [e('b')]: { x: 35, y: 0 } },
      }),
    ).doc;
    const data = sketchOf(next);
    expect(data.dimensions[did('k1')]).toMatchObject({ expr: '35', label: { x: 0, y: -8 } });
    expect(data.entities[e('b')]).toMatchObject({ x: 35, y: 0 });
  });

  it('gives up the name when made driven, and takes the next one when driving again', () => {
    const doc = withDimensions({
      k1: length('base', '30', { paramName: 'd1' }),
      k2: length('side', '40', { paramName: 'd2' }),
    });
    const driven = applyCommand(
      doc,
      updateSketchDimension({ feature: S1, id: did('k1'), changes: { driven: true } }),
    ).doc;
    expect(sketchOf(driven).dimensions[did('k1')]).toMatchObject({ driven: true });
    expect(sketchOf(driven).dimensions[did('k1')]?.paramName).toBeUndefined();
    const driving = applyCommand(
      driven,
      updateSketchDimension({ feature: S1, id: did('k1'), changes: { driven: false } }),
    ).doc;
    expect(sketchOf(driving).dimensions[did('k1')]).toMatchObject({
      driven: false,
      paramName: 'd3',
    });
  });

  it('refuses to make a dimension driven while another expression uses it', () => {
    const doc = withDimensions({
      k1: length('base', '30', { paramName: 'd1' }),
      k2: length('side', 'd1 + 10', { paramName: 'd2' }),
    });
    expect(() =>
      applyCommand(
        doc,
        updateSketchDimension({ feature: S1, id: did('k1'), changes: { driven: true } }),
      ),
    ).toThrow('`d1` is used by `d2`. Change that first.');
    expect(() =>
      applyCommand(
        doc,
        updateSketchDimension({ feature: S1, id: did('zz'), changes: { expr: '1' } }),
      ),
    ).toThrow('The sketch has no dimension "zz".');
  });
});

describe('removing dimensions and applying solves', () => {
  it('refuses to delete a dimension another expression uses, unless both go', () => {
    const doc = withDimensions({
      k1: length('base', '30', { paramName: 'd1' }),
      k2: length('side', 'd1 + 10', { paramName: 'd2' }),
    });
    expect(() =>
      applyCommand(doc, removeFromSketch({ feature: S1, dimensions: [did('k1')] })),
    ).toThrow('`d1` is used by `d2`.');
    const both = applyCommand(
      doc,
      removeFromSketch({ feature: S1, dimensions: [did('k1'), did('k2')] }),
    ).doc;
    expect(sketchOf(both).dimensions).toEqual({});
  });

  it('moves points and radii with setSketchGeometry', () => {
    const doc = withDimensions({});
    const next = applyCommand(
      doc,
      setSketchGeometry({
        feature: S1,
        points: { [e('a')]: { x: 1, y: 2 } },
        radii: { [e('hole')]: 7 },
      }),
    ).doc;
    expect(sketchOf(next).entities[e('a')]).toMatchObject({ x: 1, y: 2 });
    expect(sketchOf(next).entities[e('hole')]).toMatchObject({ radius: 7 });
    expect(() =>
      applyCommand(doc, setSketchGeometry({ feature: S1, radii: { [e('arc')]: 7 } })),
    ).toThrow('"arc" isn\'t a circle of this sketch.');
  });
});

describe('isDatumLine (ADR-0093)', () => {
  const sk = {
    entities: {
      x0: { type: 'point', x: -50, y: 0 },
      x1: { type: 'point', x: 50, y: 0 },
      ax: { type: 'line', start: 'x0', end: 'x1', construction: true },
      o: { type: 'point', x: 0, y: 0 },
      c0: { type: 'point', x: 1, y: 1 },
      c1: { type: 'point', x: 5, y: 1 },
      ln: { type: 'line', start: 'c0', end: 'c1', construction: false },
    },
    constraints: {},
    dimensions: {},
    projections: {
      p1: { ref: { kind: 'axis', id: 'origin:x' }, curves: { axis: 'ax' } },
      p2: { ref: { kind: 'point', id: 'origin:point' }, curves: { point: 'o' } },
    },
  } as unknown as SketchData;
  it('is true for a stored axis line only', () => {
    expect(isDatumLine(sk, 'ax' as SketchEntityId)).toBe(true);
    expect(isDatumLine(sk, 'ln' as SketchEntityId)).toBe(false);
    expect(isDatumLine(sk, 'o' as SketchEntityId)).toBe(false);
    expect(isDatumLine(sk, undefined)).toBe(false);
  });
});
