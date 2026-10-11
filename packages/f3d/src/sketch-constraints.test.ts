/**
 * The file's sketch constraints and dimensions on hand-built decoded
 * sketches: what fits the geometry goes in and solves without moving it;
 * what doesn't fit, or over-constrains, is left out and counted; dimension
 * parameters keep the expressions that name them.
 */
import type { SketchData } from '@extrudo/core';
import { loadPlanegcs, type PlanegcsModule, SketchSolver } from '@extrudo/sketch';
import { beforeAll, describe, expect, it } from 'vitest';
import type { SketchDimensionRecord, SketchRelation } from './decode/constraints';
import type { ParameterValue } from './decode/parameters';
import type { SketchLine, SketchPoint } from './decode/sketch-geometry';
import { f3dToDesign } from './map';
import { type F3dDesign, type F3dExtrude, type F3dSketchFeature, IDENTITY } from './model';
import { MAX_CANDIDATES } from './sketch-constraints';

let planegcs: PlanegcsModule;

beforeAll(async () => {
  planegcs = await loadPlanegcs();
});

const parameter = (p: Partial<ParameterValue> & Pick<ParameterValue, 'name'>): ParameterValue => ({
  id: 0,
  number: 1,
  expression: '',
  kind: 'User Parameter',
  comment: '',
  user: false,
  unit: 'mm',
  value: 0,
  ...p,
});

const point = (id: number, u: number, v: number): SketchPoint => ({
  id,
  at: [u, v, 0],
  incidence: 0,
});

const line = (id: number, tag: bigint, a: SketchPoint, b: SketchPoint): SketchLine => ({
  id,
  tag,
  start: a.at,
  end: b.at,
  startPoint: a.id,
  endPoint: b.id,
  construction: false,
});

const KINDS = {
  coincident: 0x1,
  parallel: 0x10,
  perpendicular: 0x20,
  horizontal: 0x40,
  vertical: 0x80,
  equal: 0x800,
  midpoint: 0x1000,
} as const;

let nextRecord = 1000;
const relation = (kind: keyof typeof KINDS, ...loci: number[]): SketchRelation => ({
  id: nextRecord++,
  type: '60403D47-0C49-49B0-BDE8-1679608164A2',
  loci: loci.map((id) => ({ id, role: 0 })),
  sketch: 5,
  mask: KINDS[kind],
  state: 0,
  kind,
});

const dimension = (
  kind: SketchDimensionRecord['kind'],
  loci: number[],
  p: Partial<ParameterValue> & Pick<ParameterValue, 'name' | 'value'>,
  orientation?: SketchDimensionRecord['orientation'],
): SketchDimensionRecord => ({
  id: nextRecord++,
  kind,
  loci: loci.map((id) => ({ id, role: 0 })),
  ...(orientation ? { orientation } : {}),
  parameter: parameter({ kind: 'Linear Dimension-2', ...p, number: Number(p.name.slice(1)) }),
});

/**
 * A 4 × 2 cm plate on the file's XY plane (the identity frame): corners
 * p1 (0, 0), p2 (4, 0), p3 (4, 2), p4 (0, 2), sides 11–14, a lone point p5 at
 * the middle of the bottom side, and the extrude of the plate `d9` high.
 */
function plate(
  relations: SketchRelation[],
  dimensions: SketchDimensionRecord[],
  frame = IDENTITY,
): F3dDesign {
  const [p1, p2, p3, p4] = [point(1, 0, 0), point(2, 4, 0), point(3, 4, 2), point(4, 0, 2)];
  const p5 = point(6, 2, 0);
  const sketch: F3dSketchFeature = {
    type: 'sketch',
    id: 1,
    kind: 'Sketch',
    name: 'Sketch1',
    suppressed: false,
    parameters: [],
    sketch: {
      id: 5,
      frame,
      points: [p1, p2, p3, p4, p5],
      lines: [
        line(11, 111n, p1, p2),
        line(12, 112n, p2, p3),
        line(13, 113n, p3, p4),
        line(14, 114n, p4, p1),
      ],
      circulars: [],
      splines: [],
      texts: [],
      relations,
      dimensions,
    },
  };
  const outline = [111n, 112n, 113n, 114n].map((tag) => ({ tag, secondary: 0n, piece: 1, of: 1 }));
  const extrude: F3dExtrude = {
    type: 'extrude',
    id: 2,
    kind: 'Extrude',
    name: 'Extrude1',
    suppressed: false,
    parameters: [parameter({ name: 'd9', expression: 'd1 / 4', kind: 'AlongDistance', value: 1 })],
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
            outer: [[111n, 112n, 113n, 114n]],
            inner: [],
            outerPieces: [outline],
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
    userParameters: [parameter({ name: 'wide', expression: '40 mm', user: true, value: 4 })],
    features: [sketch, extrude],
    bodies: [],
    problems: [],
  };
}

const RECTANGLE = () => [
  relation('horizontal', 11),
  relation('vertical', 12),
  relation('horizontal', 13),
  relation('vertical', 14),
];

/** The first sketch's data. */
function sketchOf(doc: {
  features: { type: string; inputs: Record<string, unknown> }[];
}): SketchData {
  const sketch = doc.features.find((f) => f.type === 'sketch');
  if (!sketch) throw new Error('No sketch.');
  return (sketch.inputs.sketch as { sketch: SketchData }).sketch;
}

/** Imports with a fresh solver; returns the sketch and the report. */
function load(f3d: F3dDesign) {
  const solver = new SketchSolver(planegcs);
  try {
    const { design, report } = f3dToDesign(f3d, 'Plate', { solver });
    expect(design.validate()).toEqual([]);
    const doc = design.toJSON();
    return { doc, data: sketchOf(doc), report };
  } finally {
    solver.dispose();
  }
}

/** Solves the imported sketch as the app would: no point moves, nothing redundant. */
function solveAsApp(data: SketchData, values: Record<string, number>) {
  const solver = new SketchSolver(planegcs);
  try {
    const result = solver.solve(data, values);
    let moved = 0;
    for (const [id, p] of Object.entries(result.solution.points)) {
      const e = data.entities[id as keyof typeof data.entities];
      if (e?.type === 'point') moved = Math.max(moved, Math.hypot(p.x - e.x, p.y - e.y));
    }
    return { ...result, moved };
  } finally {
    solver.dispose();
  }
}

const types = (data: SketchData) => Object.values(data.constraints).map((c) => c.type);

describe('sketch constraints and dimensions', () => {
  it('brings the geometric constraints over and the sketch solves where it is', () => {
    const { data, report } = load(
      plate([...RECTANGLE(), relation('midpoint', 6, 11), relation('parallel', 11, 13)], []),
    );
    expect(
      types(data)
        .filter((t) => t !== 'coincident')
        .sort(),
    ).toEqual(['horizontal', 'horizontal', 'midpoint', 'vertical', 'vertical']);
    // Parallel on two lines already level is redundant: left out, not forced.
    expect(report.constraints).toMatchObject({
      constraints: 5,
      leftOut: { overconstrains: 1 },
    });
    const solved = solveAsApp(data, {});
    expect(solved.moved).toBeLessThan(1e-9);
    expect([...solved.redundant, ...solved.conflicting]).toEqual([]);
    expect(report.notes).toContain(
      'Sketch1: 1 of 6 constraints and dimensions left out (1 over-constrain the sketch).',
    );
  });

  it('names dimensions after the file, keeps their expressions and the expressions that use them', () => {
    const { doc, data, report } = load(
      plate(RECTANGLE(), [
        dimension('linear', [1, 2], { name: 'd1', expression: 'wide', value: 4 }, 'horizontal'),
        dimension('linear', [11, 13], { name: 'd2', expression: 'd1 / 2', value: 2 }),
      ]),
    );
    const dims = Object.values(data.dimensions);
    expect(
      dims.map((d) => [d.paramName, d.expr, d.type, 'orientation' in d && d.orientation]),
    ).toEqual([
      ['d1', 'wide', 'distance', 'horizontal'],
      ['d2', 'd1 / 2', 'distance', 'aligned'],
    ]);
    expect(report.constraints).toMatchObject({ constraints: 4, dimensions: 2, leftOut: {} });
    // The extrude's `d1 / 4` names an imported dimension, so it stays an expression.
    const extrude = doc.features.find((f) => f.type === 'extrude');
    expect(extrude?.inputs.distance).toMatchObject({ expr: 'd1 / 4' });
    const solved = solveAsApp(
      data,
      Object.fromEntries(Object.keys(data.dimensions).map((id, i) => [id, [40, 20][i] as number])),
    );
    expect(solved.moved).toBeLessThan(1e-9);
    expect(solved.dof).toBe(4); // the plate can still slide, and the lone point move
  });

  it('leaves out a dimension the geometry does not match and one that over-constrains', () => {
    const { doc, data, report } = load(
      plate(RECTANGLE(), [
        // 3 cm where the side is 4: a stale value.
        dimension('linear', [11], { name: 'd1', expression: '30 mm', value: 3 }, 'aligned'),
        dimension('linear', [12], { name: 'd2', expression: '20 mm', value: 2 }, 'aligned'),
        // The other vertical side, already as long as d2 through the rectangle.
        dimension('linear', [14], { name: 'd3', expression: '20 mm', value: 2 }, 'aligned'),
      ]),
    );
    expect(Object.values(data.dimensions).map((d) => d.paramName)).toEqual(['d2']);
    expect(report.constraints?.leftOut).toEqual({ mismatch: 1, overconstrains: 1 });
    // d1 was left out: the extrude keeps its value instead of `d1 / 4`.
    const extrude = doc.features.find((f) => f.type === 'extrude');
    expect(extrude?.inputs.distance).toMatchObject({ expr: '10 mm' });
  });

  it("turns horizontal into vertical where the plane's frame turns the file's axes", () => {
    // The file's sketch u axis along model Y: Extrudo's XY frame sees it upright.
    const frame = [0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    const { data } = load(
      plate(
        RECTANGLE(),
        [dimension('linear', [1, 2], { name: 'd1', expression: '40 mm', value: 4 }, 'horizontal')],
        frame,
      ),
    );
    const sides = Object.values(data.constraints).filter((c) => c.type !== 'coincident');
    expect(sides.map((c) => c.type).sort()).toEqual([
      'horizontal',
      'horizontal',
      'vertical',
      'vertical',
    ]);
    expect(Object.values(data.dimensions)[0]).toMatchObject({ orientation: 'vertical' });
    expect(
      solveAsApp(data, { [Object.keys(data.dimensions)[0] as string]: 40 }).moved,
    ).toBeLessThan(1e-9);
  });

  it('fixes the projected origin when a constraint names it', () => {
    const f3d = plate([relation('coincident', 7, 11)], []);
    const sketch = (f3d.features[0] as F3dSketchFeature).sketch;
    sketch.points.push({ ...point(7, 0, 0), tag: 100n } as SketchPoint);
    const { data, report } = load(f3d);
    expect(types(data)).toContain('fix');
    expect(types(data)).toContain('pointOnCurve');
    expect(report.constraints?.constraints).toBe(1);
  });

  it('keeps a tangent line on the side of the circle it touches', () => {
    // A line along the top of a 1 cm circle, its start on the circle: tangent,
    // and solving must not flip it to the circle's other side.
    const f3d = plate([], []);
    const sketch = (f3d.features[0] as F3dSketchFeature).sketch;
    const centre = point(20, 0, -5);
    const [s, f] = [point(21, 0, -4), point(22, 3, -4)];
    sketch.points.push(centre, s, f);
    sketch.lines.push(line(23, 123n, s, f));
    sketch.circulars.push({
      id: 24,
      tag: 124n,
      center: centre.at,
      normal: [0, 0, 1],
      xAxis: [1, 0, 0],
      radius: 1,
      startAngle: 0,
      endAngle: 2 * Math.PI,
      centerPoint: 20,
      construction: false,
    });
    sketch.relations = [
      { ...relation('coincident', 21, 24), mask: 0x1 },
      { ...relation('horizontal', 23) },
      {
        ...relation('coincident', 22, 24),
        kind: 'tangent',
        mask: 0x100,
        loci: [
          { id: 23, role: 0 },
          { id: 24, role: 0 },
        ],
      },
    ];
    const { data, report } = load(f3d);
    expect(types(data)).toEqual(expect.arrayContaining(['pointOnCurve', 'horizontal', 'tangent']));
    expect(report.constraints?.leftOut).toEqual({});
    expect(solveAsApp(data, {}).moved).toBeLessThan(1e-9);
  });

  it('imports nothing without a solver', () => {
    const { design, report } = f3dToDesign(plate(RECTANGLE(), []), 'Plate');
    const data = sketchOf(design.toJSON());
    expect(types(data).every((t) => t === 'coincident')).toBe(true);
    expect(report.constraints).toBeUndefined();
  });
  it("names a dimension itself where the file's name can't be taken, and counts on past a huge one", () => {
    const f3d = plate(RECTANGLE(), [
      // A reserved word, a name used twice: both would refuse the whole sketch.
      dimension('linear', [1, 2], { name: 'max', value: 4 }, 'horizontal'),
      dimension('linear', [12], { name: 'd2', value: 2 }, 'aligned'),
      dimension('linear', [1, 6], { name: 'd2', value: 2 }, 'horizontal'),
    ]);
    // The file's own parameters, one with a number past 2^53 (counting on from it stood still).
    f3d.parameters = [
      parameter({ name: 'd2', value: 2 }),
      parameter({ name: 'd9', value: 1 }),
      parameter({ name: 'd99999999999999999', value: 1 }),
    ];
    const { data, report } = load(f3d);
    expect(Object.values(data.dimensions).map((d) => d.paramName)).toEqual(['d10', 'd2', 'd11']);
    expect(report.constraints).toMatchObject({ dimensions: 3, leftOut: {} });
  });

  it("keeps a sketch's geometry when the solver fails on it, leaving its constraints out", () => {
    const broken = {
      solve: () => {
        throw new Error('Aborted(OOM)');
      },
      dispose: () => {},
    } as unknown as SketchSolver;
    const { design, report } = f3dToDesign(
      plate(RECTANGLE(), [dimension('linear', [12], { name: 'd2', value: 2 }, 'aligned')]),
      'Plate',
      { solver: broken },
    );
    expect(design.validate()).toEqual([]);
    const data = sketchOf(design.toJSON());
    expect(Object.values(data.entities).filter((e) => e.type === 'line')).toHaveLength(4);
    expect(new Set(types(data))).toEqual(new Set(['coincident']));
    expect(data.dimensions).toEqual({});
    expect(report.constraints).toMatchObject({
      constraints: 0,
      dimensions: 0,
      leftOut: { failed: 5 },
    });
    expect(report.imported).toContain('Sketch1');
  });

  it(`vets at most ${MAX_CANDIDATES} constraints and dimensions of a sketch`, {
    timeout: 60_000,
  }, () => {
    const many = Array.from({ length: MAX_CANDIDATES + 3 }, () => relation('horizontal', 11));
    const { report } = load(plate(many, []));
    expect(report.constraints?.constraints).toBe(1);
    expect(report.constraints?.leftOut).toEqual({
      overconstrains: MAX_CANDIDATES - 1,
      limit: 3,
    });
  });
});
