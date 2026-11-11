/**
 * Hostile sketch records: each ends in a left-out outcome or a problem, in
 * bounded time, and nothing throws past `addSketch`; the slots after a bad
 * record keep the file's indices.
 */
import { Design } from '@extrudo/api';
import { loadPlanegcs, type PlanegcsModule, SketchSolver } from '@extrudo/sketch';
import { beforeAll, describe, expect, it } from 'vitest';
import { documentXml, fcstd, label, placement, prop } from './fixtures';
import { type FcObject, readFcstd } from './model';
import {
  decodeSketch,
  MAX_BSPLINE_POLES,
  MAX_SKETCH_CONSTRAINTS,
  MAX_SKETCH_GEOMETRY,
} from './sketch-decode';
import { bspline, constraint, line, T } from './sketch-fixtures';
import { MAX_CANDIDATES } from './sketch-map';
import { frameIsSound, placeSketch } from './sketch-place';
import { type AddSketchResult, addSketch, sketchObjects } from './sketches';

let planegcs: PlanegcsModule;
beforeAll(async () => {
  planegcs = await loadPlanegcs();
});

/** A file with one sketch of these raw geometry and constraint records. */
function file(geometry: string[], constraints: string[]): Uint8Array {
  return fcstd({
    'Document.xml': documentXml([
      {
        name: 'Sketch',
        type: 'Sketcher::SketchObject',
        props: [
          label('Sketch'),
          placement(),
          prop(
            'Geometry',
            'Part::PropertyGeometryList',
            `<GeometryList count="${geometry.length}">${geometry.join('')}</GeometryList>`,
          ),
          prop(
            'Constraints',
            'Sketcher::PropertyConstraintList',
            `<ConstraintList count="${constraints.length}">${constraints.join('')}</ConstraintList>`,
          ),
        ],
      },
    ]),
  });
}

function run(bytes: Uint8Array): { result: AddSketchResult; ms: number; object: FcObject } {
  const doc = readFcstd(bytes);
  const object = sketchObjects(doc)[0] as FcObject;
  const solver = new SketchSolver(planegcs);
  const started = Date.now();
  try {
    const design = Design.create();
    const result = addSketch(design, doc, object, { solver });
    expect(design.validate()).toEqual([]);
    return { result, ms: Date.now() - started, object };
  } finally {
    solver.dispose();
  }
}

describe('hostile sketch records', () => {
  it('leaves out constraints naming geometry out of range or past the axes', () => {
    const { result } = run(
      file(
        [line(0, 0, 10, 0)],
        [
          constraint({ type: T.horizontal, first: 99 }),
          constraint({ type: T.horizontal, first: -7 }),
          constraint({ type: T.horizontal, first: -1_000_000_000 }),
          constraint({ type: T.coincident, first: -2000, firstPos: 1, second: 0, secondPos: 1 }),
          constraint({ type: T.coincident, first: 0, firstPos: 7, second: 0, secondPos: 1 }),
          constraint({ type: T.horizontal, first: 0 }),
        ],
      ),
    );
    expect(result.outcome.perConstraint).toEqual([
      'geometry',
      'external',
      'external',
      'unsupported',
      'unsupported',
      'mapped',
    ]);
  });

  it('drops a record with NaN or 1e999 and keeps the indices after it', () => {
    const { result } = run(
      file(
        [line(0, 0, 10, 0), line(0, 0, 10, 0).replace('EndX="', 'EndX="1e999'), line(0, 5, 10, 5)],
        [
          constraint({ type: T.distanceX, first: 0, value: 'NaN' }),
          constraint({ type: T.horizontal, first: 1 }),
          constraint({ type: T.horizontal, first: 2 }),
          constraint({ type: T.distance, first: 0, value: '1e999' }),
          constraint({ type: T.horizontal, first: 0 }),
          constraint({ type: T.horizontal, first: 0, second: 'x' as unknown as number }),
        ],
      ),
    );
    expect(result.imported).toBe(true);
    expect(result.outcome.perConstraint).toEqual([
      'unreadable',
      'geometry',
      'mapped',
      'unreadable',
      'mapped',
      'unreadable',
    ]);
    expect(result.outcome.geometryLeftOut).toEqual({ unreadable: 1 });
    expect(result.outcome.problems).toHaveLength(4);
  });

  it('refuses a B-spline over the pole limit or with knots that do not fit its poles', () => {
    const poles = (n: number) =>
      Array.from({ length: n }, (_, i) => [i, i % 2] as [number, number]);
    const over = bspline(
      poles(3),
      [
        [0, 3],
        [1, 3],
      ],
      2,
      { polesCount: MAX_BSPLINE_POLES + 1 },
    );
    const many = bspline(
      poles(MAX_BSPLINE_POLES + 5),
      [
        [0, 3],
        [1, 3],
      ],
      2,
      { polesCount: 3 },
    );
    const counts = bspline(
      poles(3),
      [
        [0, 3],
        [1, 3],
      ],
      2,
      { polesCount: 4 },
    );
    const mults = bspline(
      poles(3),
      [
        [0, 2],
        [1, 2],
      ],
      2,
    );
    const { result, ms } = run(file([over, many, counts, mults], []));
    expect(result.imported).toBe(true);
    expect(result.outcome.geometryLeftOut).toEqual({ unreadable: 3, 'bspline-knots': 1 });
    expect(ms).toBeLessThan(2000);
  });

  it('refuses a B-spline whose knots span no finite range or fall together once scaled', () => {
    const poles = (n: number) =>
      Array.from({ length: n }, (_, i) => [i, i % 2] as [number, number]);
    const endless = bspline(
      poles(3),
      [
        [-1.7e308, 3],
        [1.7e308, 3],
      ],
      2,
    );
    // 1 and 2 are the same number beside 1e300, so both land on 0.5.
    const together = bspline(
      poles(5),
      [
        [-1e300, 3],
        [1, 1],
        [2, 1],
        [1e300, 3],
      ],
      2,
    );
    const { result } = run(file([endless, together], []));
    expect(result.imported).toBe(true);
    expect(result.outcome.geometryLeftOut).toEqual({ 'bspline-knots': 2 });
  });

  it('gives no plane to a frame that is not a finite position and a real rotation', () => {
    const d = Design.create();
    const frames = [
      { position: [Number.POSITIVE_INFINITY, 0, 0], rotation: [0, 0, 0, 1] },
      { position: [0, Number.NaN, 0], rotation: [0, 0, 0, 1] },
      { position: [0, 0, 0], rotation: [0, 0, 0, 0] },
      { position: [0, 0, 0], rotation: [Number.NaN, 0, 0, 1] },
    ] as const;
    for (const frame of frames) {
      expect(frameIsSound(frame)).toBe(false);
      expect(placeSketch(d, frame, 'Sketch')).toBeUndefined();
    }
    expect(frameIsSound({ position: [1, 2, 3], rotation: [0, 0, 0, 1] })).toBe(true);
    expect(d.doc.features).toEqual([]);
  });

  it(`refuses a sketch over ${MAX_SKETCH_CONSTRAINTS} constraints, in bounded time`, () => {
    // 10⁵ times the same horizontal on one line, in the short form.
    const records = Array.from({ length: 100_000 }, () => '<Constrain Type="2" First="0"/>');
    const started = Date.now();
    const { result } = run(file([line(0, 0, 10, 0)], records));
    expect(result.imported).toBe(false);
    expect(result.outcome.perConstraint).toHaveLength(100_000);
    expect(result.outcome.constraints.leftOut).toEqual({ limit: 100_000 });
    expect(Date.now() - started).toBeLessThan(10_000);
  });

  it(`vets the first ${MAX_CANDIDATES} of a sketch's constraints, the rest over the limit`, () => {
    const records = Array.from({ length: 5_000 }, () => '<Constrain Type="2" First="0"/>');
    const { result, ms } = run(file([line(0, 0, 10, 0)], records));
    expect(result.imported).toBe(true);
    const left = result.outcome.constraints.leftOut;
    expect(result.outcome.constraints.mapped).toBe(1);
    expect(left).toEqual({ overconstrains: MAX_CANDIDATES - 1, limit: 5_000 - MAX_CANDIDATES });
    expect(ms).toBeLessThan(5_000);
  });

  it('refuses a sketch over the geometry limit', () => {
    const geometry = Array.from({ length: MAX_SKETCH_GEOMETRY + 1 }, () => '<Geometry type="x"/>');
    const { result } = run(file(geometry, ['<Constrain Type="2" First="0"/>']));
    expect(result.imported).toBe(false);
    expect(result.outcome.perConstraint).toEqual(['limit']);
  });

  it('leaves out a constraint that names one thing twice', () => {
    const { result } = run(
      file(
        [line(0, 0, 10, 0), line(0, 5, 10, 5)],
        [
          constraint({ type: T.coincident, first: 0, firstPos: 1, second: 0, secondPos: 1 }),
          constraint({ type: T.parallel, first: 0, second: 0 }),
          constraint({ type: T.equal, first: 1, second: 1 }),
          constraint({
            type: T.symmetric,
            first: 0,
            firstPos: 1,
            second: 0,
            secondPos: 1,
            third: 1,
          }),
          constraint({ type: T.tangent, first: 1, second: 1 }),
          constraint({ type: T.perpendicular, first: 0, second: 0 }),
          constraint({
            type: T.distance,
            first: 0,
            firstPos: 1,
            second: 0,
            secondPos: 1,
            value: 0,
          }),
          constraint({ type: T.parallel, first: 0, second: 1 }),
        ],
      ),
    );
    expect(result.outcome.perConstraint).toEqual([...Array(7).fill('unsupported'), 'mapped']);
  });

  it('never throws on a record of the wrong shape', () => {
    const odd = [
      '<Geometry type="Part::GeomLineSegment"/>',
      '<Geometry type="Part::GeomCircle"><Circle CenterX="0" CenterY="0" Radius="-1"/></Geometry>',
      '<Geometry type="Part::GeomArcOfCircle"><ArcOfCircle CenterX="0" CenterY="0" Radius="1" StartAngle="1" EndAngle="1"/></Geometry>',
      '<Geometry type="Part::GeomCircle"><Circle CenterX="0" CenterY="0" NormalX="1" NormalZ="0" Radius="1"/></Geometry>',
      '<Geometry type="Part::GeomLineSegment"><LineSegment StartX="0" StartY="0" EndX="0" EndY="0"/></Geometry>',
      '<Geometry type="Part::GeomHyperbola"/>',
      '<Geometry/>',
    ];
    const bytes = file(odd, [
      '<Constrain Type="999999999999" First="0"/>',
      '<Constrain/>',
      '<Constrain Type="1.5" First="0"/>',
    ]);
    const decoded = decodeSketch(readFcstd(bytes).byName.get('Sketch') as FcObject);
    expect(decoded.geometry.filter((g) => g === undefined)).toHaveLength(4);
    const { result } = run(bytes);
    expect(result.imported).toBe(true);
    expect(result.outcome.geometryLeftOut).toEqual({
      unreadable: 4,
      degenerate: 1,
      'other:Part::GeomHyperbola': 1,
      'other:': 1,
    });
    expect(result.outcome.perConstraint).toEqual(['unreadable', 'unreadable', 'unreadable']);
  });
});
