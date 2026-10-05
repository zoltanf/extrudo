/**
 * `d.sketch(plane, build)` and the `SketchBuilder` (ADR-0068 §5): what a call
 * stores, what it can be referenced as, and that it matches what the drawing
 * tools make — benchmark B1's plate is the proof, since its fixture sketch was
 * drawn with the Rectangle and Circle tools and exported by the app.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SketchData, SketchEntity, SketchEntityId } from '@extrudo/core';
import { readArchive } from '@extrudo/storage';
import { describe, expect, it } from 'vitest';
import { Design } from './design';
import { ApiError } from './error';
import type { CircleHandle } from './sketch';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '../../../fixtures/benchmarks');
const FIXED = { now: '2026-10-05T00:00:00.000Z' };
const fixture = (name: string) => readArchive(readFileSync(join(FIXTURES, name))).doc;

/**
 * A sketch with every ID replaced by the number of the record it sits in, so two
 * sketches that differ only in their IDs can be compared (the tools' are UUIDs,
 * the API's are `s1`, `c1`, `d1`). A dimension's `paramName` and `label` are
 * left alone: the name is what the API and the app both give, and the label is
 * where a person put it, which the API stores none of.
 */
function canonical(data: SketchData): unknown {
  const ids = [
    ...Object.keys(data.entities),
    ...Object.keys(data.constraints),
    ...Object.keys(data.dimensions),
  ];
  const name = new Map(ids.map((id, i) => [id, `#${i}`]));
  const rewrite = (key: string, value: unknown): unknown =>
    typeof value === 'string' && key !== 'paramName' ? (name.get(value) ?? value) : value;
  const records = (list: Record<string, Record<string, unknown>>, keep: readonly string[] = []) =>
    Object.entries(list).map(([id, record]) => [
      name.get(id),
      Object.fromEntries(
        Object.entries(record)
          .filter(([key]) => keep.includes(key))
          .map(([key, v]) => [key, rewrite(key, v)]),
      ),
    ]);
  return {
    entities: records(data.entities as Record<string, Record<string, unknown>>),
    constraints: records(data.constraints as Record<string, Record<string, unknown>>),
    dimensions: records(data.dimensions as Record<string, Record<string, unknown>>, ['paramName']),
  };
}

/** The entities of a sketch, as `{ type: … }` records with every ID replaced by its index. */
function entities(data: SketchData): unknown[] {
  return Object.values(data.entities);
}

function constraints(data: SketchData): unknown[] {
  return Object.values(data.constraints);
}

function dimensions(data: SketchData): unknown[] {
  return Object.values(data.dimensions);
}

/** An entity's `point`-solved position, for a point ID. */
function pointOf(data: SketchData, id: SketchEntityId): [number, number] {
  const entity = data.entities[id];
  if (entity?.type !== 'point') throw new Error(`${id} is not a point`);
  return [entity.x, entity.y];
}

describe('sketch entities', () => {
  it('stores a line as its own two points and nothing else', () => {
    const d = Design.create(FIXED);
    const s = d.sketch(d.origin.xy, (k) => {
      const line = k.line([0, 0], [40, 10]);
      expect(line.start.at()).toEqual([0, 0]);
      expect(line.end.at()).toEqual([40, 10]);
      expect(line.ref()).toEqual({ kind: 'sketchEntity', id: `${line.sketch.id}/${line.id}` });
    });
    const data = s.data;
    expect(entities(data)).toEqual([
      { type: 'point', x: 0, y: 0 },
      { type: 'point', x: 40, y: 10 },
      { type: 'line', start: expect.any(String), end: expect.any(String), construction: false },
    ]);
    expect(s.plane).toEqual(d.origin.xy);
  });

  it("stores a rectangle as four lines joined and made level, with the tool's edges", () => {
    const d = Design.create(FIXED);
    const s = d.sketch(d.origin.xy, (k) => {
      const plate = k.rectangle([0, 0], [40, 20]);
      // corners: the first corner, then along +x, +y, then -x.
      expect(plate.corners.map((c) => c.id)).toHaveLength(4);
      expect(plate.bottom.start.id).toBe(plate.corners[0]?.id);
      // Each corner is the point its edge starts at; the edge before it ends at
      // its own copy of the same place (ADR-0010).
      expect(plate.top.start.id).toBe(plate.corners[2]?.id);
    });
    const data = s.data;
    expect(entities(data).filter((e) => (e as SketchEntity).type === 'line')).toHaveLength(4);
    expect(entities(data).filter((e) => (e as SketchEntity).type === 'point')).toHaveLength(8);
    expect(constraints(data)).toEqual([
      { type: 'coincident', a: expect.any(String), b: expect.any(String) },
      { type: 'coincident', a: expect.any(String), b: expect.any(String) },
      { type: 'coincident', a: expect.any(String), b: expect.any(String) },
      { type: 'coincident', a: expect.any(String), b: expect.any(String) },
      { type: 'horizontal', a: expect.any(String) },
      { type: 'vertical', a: expect.any(String) },
      { type: 'horizontal', a: expect.any(String) },
      { type: 'vertical', a: expect.any(String) },
    ]);
    // The corners are where the calls said, each edge from corner to corner.
    const ids = Object.keys(data.entities) as SketchEntityId[];
    const corners = (
      ids.filter((id) => data.entities[id]?.type === 'point') as SketchEntityId[]
    ).map((id) => pointOf(data, id));
    expect(corners).toEqual([
      [0, 0],
      [40, 0],
      [40, 0],
      [40, 20],
      [40, 20],
      [0, 20],
      [0, 20],
      [0, 0],
    ]);
  });

  it('builds a rectangle from its centre with construction diagonals', () => {
    const d = Design.create(FIXED);
    const s = d.sketch(d.origin.xy, (k) => {
      const plate = k.rectangleCentered([0, 0], [20, 10]);
      expect(plate.center?.id).toEqual(expect.any(String));
    });
    const data = s.data;
    // Four edges, two construction diagonals and the centre point.
    expect(entities(data).filter((e) => (e as SketchEntity).type === 'line')).toHaveLength(6);
    expect(entities(data).filter((e) => (e as SketchEntity).type === 'point')).toHaveLength(13);
    expect(
      constraints(data).filter((c) => (c as { type: string }).type === 'midpoint'),
    ).toHaveLength(1);
  });

  it('stores a circle with its centre, a spline with its points and a conic with its rho', () => {
    const d = Design.create(FIXED);
    const s = d.sketch(d.origin.xy, (k) => {
      k.circle([10, 10], '3 mm');
      k.circle([20, 10], 4);
      k.spline([
        [0, 20],
        [10, 30],
        [20, 20],
      ]);
      k.splineControl([
        [0, 40],
        [10, 50],
        [20, 40],
      ]);
      k.conic([30, 0], [40, 10], [50, 0], 0.5);
    });
    const data = s.data;
    const circles = entities(data).filter((e) => (e as SketchEntity).type === 'circle');
    expect(circles).toEqual([
      { type: 'circle', center: expect.any(String), radius: 3, construction: false },
      { type: 'circle', center: expect.any(String), radius: 4, construction: false },
    ]);
    const splines = entities(data).filter((e) => (e as SketchEntity).type === 'spline');
    expect(splines).toEqual([
      expect.objectContaining({
        mode: 'fit',
        points: [expect.any(String), expect.any(String), expect.any(String)],
      }),
      expect.objectContaining({ mode: 'control' }),
      expect.objectContaining({ mode: 'conic', rho: 0.5 }),
    ]);
    expect(d.validate()).toEqual([]);
  });

  it('stores an arc, an ellipse and a polyline the way the tools do', () => {
    const d = Design.create(FIXED);
    const s = d.sketch(d.origin.xy, (k) => {
      const arc = k.arc([0, 0], [10, 10], [5, 8]);
      expect(arc.start.at()[0]).toBeCloseTo(0, 9);
      expect(arc.start.at()[1]).toBeCloseTo(0, 9);
      expect(arc.end.at()[0]).toBeCloseTo(10, 9);
      expect(arc.end.at()[1]).toBeCloseTo(10, 9);
      k.arcCentered([30, 0], [40, 0], [30, 10]);
      k.ellipse([0, 30], [10, 30], [0, 35]);
      const chain = k.polyline([
        [50, 0],
        [60, 0],
        [60, 10],
      ]);
      expect(chain.lines).toHaveLength(2);
      expect(chain.points.map((p) => p.id)).toHaveLength(3);
    });
    const data = s.data;
    expect(entities(data).filter((e) => (e as SketchEntity).type === 'arc')).toEqual([
      {
        type: 'arc',
        center: expect.any(String),
        start: expect.any(String),
        end: expect.any(String),
        construction: false,
      },
      {
        type: 'arc',
        center: expect.any(String),
        start: expect.any(String),
        end: expect.any(String),
        construction: false,
      },
    ]);
    expect(entities(data).filter((e) => (e as SketchEntity).type === 'ellipse')).toHaveLength(1);
    // Two joints, one coincident each: each point belongs to one curve (ADR-0010).
    expect(
      constraints(data).filter((c) => (c as { type: string }).type === 'coincident'),
    ).toHaveLength(1);
  });

  it('builds a slot tangent all round and a polygon on a construction circle', () => {
    const d = Design.create(FIXED);
    const s = d.sketch(d.origin.xy, (k) => {
      k.slot([0, 0], [30, 0], 10);
      k.polygon([50, 0], [60, 0], 6);
    });
    const data = s.data;
    const kinds = entities(data).map((e) => (e as SketchEntity).type);
    // The slot's two sides and its construction centreline, then the polygon's six edges.
    expect(kinds.filter((t) => t === 'line')).toHaveLength(9);
    expect(kinds.filter((t) => t === 'arc')).toHaveLength(2);
    expect(kinds.filter((t) => t === 'circle')).toHaveLength(1);
    expect(
      entities(data).filter(
        (e) => (e as SketchEntity).type === 'line' && (e as { construction: boolean }).construction,
      ),
    ).toHaveLength(1);
    expect(
      constraints(data).filter((c) => (c as { type: string }).type === 'tangent'),
    ).toHaveLength(4);
    // One `equal` for the slot's two arcs, five for the hexagon's six edges.
    expect(constraints(data).filter((c) => (c as { type: string }).type === 'equal')).toHaveLength(
      6,
    );
    expect(
      constraints(data).filter((c) => (c as { type: string }).type === 'pointOnCurve'),
    ).toHaveLength(6);
  });

  it('refuses what the schema would refuse, and leaves the design as it was', () => {
    const d = Design.create(FIXED);
    const before = JSON.stringify(d.toJSON());
    expect(() =>
      d.sketch(d.origin.xy, (k) => {
        k.ellipse([0, 0], [10, 0], [10, 5]); // fine
        k.ellipse([0, 0], [10, 0], [5, 0]); // a circle
      }),
    ).toThrow(ApiError);
    expect(JSON.stringify(d.toJSON())).toBe(before);
    expect(() => d.sketch(d.origin.z, (k) => k.line([0, 0], [1, 0]))).toThrow(ApiError);
  });
});

describe('constraints and dimensions', () => {
  it('stores every constraint type of the schema', () => {
    const d = Design.create(FIXED);
    const s = d.sketch(d.origin.xy, (k) => {
      const a = k.line([0, 0], [10, 0]);
      const b = k.line([10, 0], [10, 10]);
      const circle = k.circle([5, 5], '2 mm');
      const other = k.circle([0, 0], '3 mm');
      const point = k.point([5, 5]);
      const axis = k.line([-10, 0], [10, 0]);
      k.coincident(a.end, b.start);
      k.pointOnCurve(point, a.id);
      k.parallel(a.id, b.id);
      k.perpendicular(a.id, b.id);
      k.horizontal(a.id);
      k.vertical(b.start, axis.end);
      k.concentric(circle.id, other.id);
      k.midpoint(point, axis.id);
      k.fix(other.id);
      k.tangent(circle.id, k.arc([40, 0], [50, 0], [45, 4]).id, true);
      k.equal(a.id, b.id);
      k.symmetric(circle.id, other.id, axis.id);
      // collinear takes two lines; the second one is made here.
      k.collinear(a.id, k.line([20, 0], [20, 10]).id);
      // smooth takes two curves.
      k.smooth(k.arc([60, 0], [70, 0], [65, 4]).id, k.arc([60, 10], [70, 10], [65, 14]).id);
    });
    expect(
      constraints(s.data)
        .map((c) => (c as { type: string }).type)
        .sort(),
    ).toEqual(
      [
        'coincident',
        'collinear',
        'concentric',
        'equal',
        'fix',
        'horizontal',
        'midpoint',
        'parallel',
        'perpendicular',
        'pointOnCurve',
        'smooth',
        'symmetric',
        'tangent',
        'vertical',
      ].sort(),
    );
    // The schema has exactly these types: nothing is missing.
    expect(
      sketchConstraintTypes().every((type) =>
        constraints(s.data).some((c) => (c as { type: string }).type === type),
      ),
    ).toBe(true);
  });

  it('stores a dimension of each kind, named or not', () => {
    const d = Design.create(FIXED);
    const width = d.parameter('width', '40 mm');
    const s = d.sketch(d.origin.xy, (k) => {
      const line = k.line([0, 0], [40, 0]);
      const other = k.line([0, 10], [0, 0]);
      const circle = k.circle([20, 20], '3 mm');
      const arc = k.arcCentered([40, 20], [43, 20], [40, 23]);
      k.dimension(line, width);
      k.dimension(line, '2 * width', { name: 'twice' });
      k.dimension([line.start, line.end], '40 mm', { orientation: 'horizontal' });
      k.angle(line, other, '90 deg');
      k.radius(arc, '3 mm');
      k.diameter(circle, '6 mm');
      k.reference(line, '40 mm');
    });
    const dims = dimensions(s.data) as Record<string, unknown>[];
    expect(dims.map((x) => x.type)).toEqual([
      'distance',
      'distance',
      'distance',
      'angle',
      'radius',
      'diameter',
      'distance',
    ]);
    expect(dims.map((x) => x.expr)).toEqual([
      'width',
      '2 * width',
      '40 mm',
      '90 deg',
      '3 mm',
      '6 mm',
      '40 mm',
    ]);
    expect(dims.map((x) => x.driven)).toEqual([false, false, false, false, false, false, true]);
    // A named dimension is a model parameter of its own name; an unnamed one
    // takes the next d<n>, as the app's host gives them (ADR-0016).
    expect(dims[0]?.paramName).toBe('d1');
    expect(dims[1]?.paramName).toBe('twice');
    expect(dims[2]?.paramName).toBe('d2');
    expect(d.validate()).toEqual([]);
  });

  it('measures what the entity is, the way the Dimension tool works it out', () => {
    const d = Design.create(FIXED);
    const s = d.sketch(d.origin.xy, (k) => {
      const circle = k.circle([0, 0], '3 mm');
      const arc = k.arcCentered([20, 0], [23, 0], [20, 3]);
      const line = k.line([0, 30], [10, 30]);
      const other = k.line([0, 40], [10, 50]);
      k.dimension(circle, '6 mm');
      k.dimension(arc, '3 mm');
      k.dimension(line, '10 mm');
      k.angle(line, other, '45 deg');
    });
    expect(dimensions(s.data).map((d0) => (d0 as { type: string }).type)).toEqual([
      'diameter',
      'radius',
      'distance',
      'angle',
    ]);
  });
});

describe('profile references', () => {
  it('finds the plate of a rectangle with a hole in it', () => {
    const d = Design.create(FIXED);
    const s = d.sketch(d.origin.xy, (k) => {
      k.rectangle([0, 0], [60, 40]);
      k.circle([30, 20], '8 mm');
    });
    expect(s.regions).toHaveLength(2);
    expect(s.profiles()).toHaveLength(2);
    // The plate and the hole are both regions (ADR-0020): the circle is its own.
    const plate = s.profileAt([2, 2]);
    const hole = s.profileAt([30, 20]);
    expect(plate.kind).toBe('profile');
    expect(hole.id).not.toBe(plate.id);
    expect(
      s.profilesInside([
        [0, 0],
        [60, 0],
        [60, 40],
        [0, 40],
      ]),
    ).toHaveLength(2);
    expect(() => s.profileAt([100, 100])).toThrow(/no profile at/);
    expect(s.profileOrUndefined([100, 100])).toBeUndefined();
  });

  it('gives a text its whole-text reference (ADR-0058)', () => {
    const d = Design.create(FIXED);
    const s = d.sketch(d.origin.xy, (k) => {
      const text = k.text([0, 0], [0, 10], { text: 'Hi', font: 'inter-regular@1' });
      expect(text.ref()).toEqual({ kind: 'sketchEntity', id: `${text.sketch.id}/${text.id}` });
    });
    // The upright constraint and the height dimension, as the Text tool adds.
    expect(constraints(s.data)).toEqual([
      { type: 'vertical', a: expect.any(String), b: expect.any(String) },
    ]);
    expect(dimensions(s.data)).toEqual([
      {
        type: 'distance',
        orientation: 'aligned',
        a: expect.any(String),
        b: expect.any(String),
        expr: '10 mm',
        driven: false,
        paramName: 'd1',
      },
    ]);
  });
});

describe('the whole call', () => {
  it('is one undo step, and a throw inside it changes nothing', () => {
    const d = Design.create(FIXED);
    d.sketch(d.origin.xy, (k) => k.rectangle([0, 0], [10, 10]));
    expect(d.doc.features).toHaveLength(1);
    expect(() =>
      d.sketch(d.origin.xy, (k) => {
        k.rectangle([0, 0], [10, 10]);
        throw new Error('half a sketch');
      }),
    ).toThrow('half a sketch');
    expect(d.doc.features).toHaveLength(1);
    d.state.undo();
    expect(d.doc.features).toHaveLength(0);
  });
});

describe('benchmark B1', () => {
  it('builds the plate sketch the app drew, up to its IDs and label positions', () => {
    const doc = fixture('b1-plate.extrudo');
    const sketch = doc.features[0];
    if (sketch?.type !== 'sketch') throw new Error('B1 has no sketch');

    // The same starting point as the fixture, minus its drawing: a design with
    // B1's parameters, so the model parameter names come out the same too.
    const d = Design.create({ name: doc.name, units: 'mm', ...FIXED });
    for (const parameter of doc.parameters) d.parameter(parameter.name, parameter.expression);
    const built = d.sketch(d.origin.xy, (k) => {
      const plate = k.rectangle([0, 0], [120, 80]);
      const corner = plate.corners[0];
      if (!corner) throw new Error('no corner');
      k.fix(corner);
      const holes = [
        k.circle([25, 25], '3 mm'),
        k.circle([95, 25], '3 mm'),
        k.circle([25, 55], '3 mm'),
        k.circle([95, 55], '3 mm'),
      ];
      const [first, right, far, farRight] = holes as [
        CircleHandle,
        CircleHandle,
        CircleHandle,
        CircleHandle,
      ];
      // The Circle tool's alignment: level with, or upright to, the first one.
      k.horizontal(right.center, first.center);
      k.vertical(far.center, first.center);
      k.horizontal(farRight.center, far.center);
      k.vertical(farRight.center, right.center);
      for (const hole of holes.slice(1)) k.equal(first.id, hole.id);
      k.dimension(plate.bottom, 'width');
      k.dimension(plate.left, 'depth');
      k.dimension([first.center, right.center], 'spacing');
      k.dimension([first.center, far.center], 'depth - 2 * margin');
      k.dimension([corner, first.center], 'margin', { orientation: 'horizontal' });
      k.dimension([corner, first.center], 'margin', { orientation: 'vertical' });
      k.diameter(first, 'hole');
    });

    const fixtureData = (sketch.inputs.sketch as { kind: string; sketch: SketchData }).sketch;
    // Up to the IDs, in the order they were made: the fixture's are UUIDs.
    expect(canonical(built.data)).toEqual(canonical(fixtureData));
    expect(built.regions).toHaveLength(5); // the plate and four holes
  });
});

/** Every constraint type the schema has (so the test above can't miss one). */
function sketchConstraintTypes(): string[] {
  return [
    'coincident',
    'pointOnCurve',
    'collinear',
    'concentric',
    'midpoint',
    'fix',
    'parallel',
    'perpendicular',
    'horizontal',
    'vertical',
    'tangent',
    'smooth',
    'equal',
    'symmetric',
  ];
}
