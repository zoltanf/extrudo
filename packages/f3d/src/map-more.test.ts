/**
 * The features mapped since ADR-0083's amendment of 2026-10-11, on
 * hand-built decoded designs: a 1 mm hole cut through a washer, then
 * mirrored or repeated in a row. Real files stay out of the repository.
 */
import type { Kernel as KernelType } from '@extrudo/kernel';
import { Kernel } from '@extrudo/kernel';
import { kernelFeatures, loadOcct, RecomputeEngine } from '@extrudo/kernel/node';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ParameterValue } from './decode/parameters';
import { f3dToDesign } from './map';
import { type F3dDesign, type F3dExtrude, type F3dFeature, IDENTITY } from './model';

let kernel: KernelType;
beforeAll(async () => {
  kernel = new Kernel(await loadOcct());
});
afterAll(() => kernel.dispose());

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

/** A circle round (x, y) in a sketch on XY, cm, as the decoder gives it. */
function circle(id: number, tag: bigint, radius: number, x = 0, y = 0) {
  return {
    point: { id: id + 1, at: [x, y, 0] as [number, number, number], incidence: 0 },
    circle: {
      id,
      tag,
      center: [x, y, 0] as [number, number, number],
      normal: [0, 0, 1] as [number, number, number],
      xAxis: [1, 0, 0] as [number, number, number],
      radius,
      startAngle: 0,
      endAngle: 2 * Math.PI,
      centerPoint: id + 1,
      construction: false,
    },
  };
}

const whole = (tags: bigint[][]) =>
  tags.map((loop) => loop.map((tag) => ({ tag, secondary: 0n, piece: 1, of: 1 })));

/** A sketch of circles on XY. */
function sketch(
  id: number,
  record: number,
  name: string,
  circles: ReturnType<typeof circle>[],
): F3dFeature {
  return {
    type: 'sketch',
    id,
    kind: 'Sketch',
    name,
    suppressed: false,
    parameters: [],
    sketch: {
      id: record,
      frame: IDENTITY,
      points: circles.map((c) => c.point),
      lines: [],
      circulars: circles.map((c) => c.circle),
      splines: [],
      texts: [],
    },
  };
}

function extrude(
  id: number,
  name: string,
  sketchRecord: number,
  operation: F3dExtrude['operation'],
  outer: bigint,
  inner?: bigint,
): F3dExtrude {
  const o = [[outer]];
  const i = inner ? [[inner]] : [];
  return {
    type: 'extrude',
    id,
    kind: 'Extrude',
    name,
    suppressed: false,
    parameters: [parameter({ name: `d${id}`, kind: 'AlongDistance', value: 0.08 })],
    operation,
    direction: 'one-side',
    reversed: false,
    solid: true,
    start: 'profile-plane',
    profiles: [
      {
        id: 100 + id,
        sketch: sketchRecord,
        regions: [{ outer: o, inner: i, outerPieces: whole(o), innerPieces: whole(i) }],
      },
    ],
    faces: [],
    participants: [],
  };
}

/** A washer (OD 11, ID 4.2, 0.8 mm) with a 1 mm hole cut through it at (3.8, 0) mm. */
function washerWithHole(): F3dDesign {
  return {
    parameters: [],
    userParameters: [],
    features: [
      sketch(1, 5, 'Sketch1', [circle(10, 101n, 0.55), circle(20, 102n, 0.21)]),
      extrude(2, 'Extrude1', 5, 'new-body', 101n, 102n),
      sketch(3, 6, 'Sketch2', [circle(40, 401n, 0.05, 0.38)]),
      extrude(4, 'Extrude2', 6, 'cut', 401n),
    ],
    bodies: [],
    problems: [],
  };
}

async function volumes(f3d: F3dDesign): Promise<number[]> {
  const { design } = f3dToDesign(f3d, 'Washer');
  expect(design.validate()).toEqual([]);
  const engine = new RecomputeEngine(kernel, kernelFeatures(), { strictLeaks: true });
  try {
    const result = await engine.recompute({ doc: design.toJSON() });
    if (result.status !== 'done') throw new Error(`recompute ${result.status}`);
    const failed = Object.values(result.features).filter((s) => s.status === 'error');
    expect(failed).toEqual([]);
    return result.bodies.flatMap((body) => {
      const shape = engine.latestBody(body.id);
      return shape ? [kernel.measure(shape).volume] : [];
    });
  } finally {
    engine.clear();
  }
}

const RING = Math.PI * (5.5 ** 2 - 2.1 ** 2) * 0.8;
const HOLE = Math.PI * 0.5 ** 2 * 0.8;
const base = { suppressed: false, parameters: [] as ParameterValue[], bodies: [] as number[] };

describe('f3dToDesign: copying features', () => {
  it('mirrors a cut in a plane through the origin', async () => {
    const f3d = washerWithHole();
    f3d.features.push({
      ...base,
      type: 'mirror',
      id: 7,
      kind: 'Mirror',
      name: 'Mirror1',
      objects: 'features',
      features: [4],
      // The YZ plane: its normal x × y is +X.
      plane: { origin: [0, 0, 0], x: [0, 1, 0], y: [0, 0, 1] },
    });
    const { design, report } = f3dToDesign(f3d, 'Washer');
    expect(report.imported).toContain('Mirror1');
    const mirror = design.toJSON().features.find((f) => f.name === 'Mirror1');
    expect(mirror?.inputs.plane).toMatchObject({ refs: [{ kind: 'plane', id: 'origin:yz' }] });
    expect(await volumes(f3d)).toEqual([expect.closeTo(RING - 2 * HOLE, 3)]);
  });

  it('mirrors in a plane moved off an origin plane', () => {
    const f3d = washerWithHole();
    f3d.features.push({
      ...base,
      type: 'mirror',
      id: 7,
      kind: 'Mirror',
      name: 'Mirror1',
      objects: 'features',
      features: [4],
      plane: { origin: [0.1, 0, 0], x: [0, 1, 0], y: [0, 0, 1] },
    });
    const { design, report } = f3dToDesign(f3d, 'Washer');
    expect(report.imported).toContain('Mirror1');
    const plane = design.toJSON().features.find((f) => f.type === 'offsetPlane');
    expect(plane?.inputs.distance).toMatchObject({ expr: '1 mm' });
  });

  it('repeats a cut in a row, its distance the whole extent', async () => {
    const f3d = washerWithHole();
    f3d.features.push({
      ...base,
      type: 'rectangular-pattern',
      id: 7,
      kind: 'R-Pattern',
      name: 'R-Pattern1',
      objects: 'features',
      features: [4],
      directions: [{ point: [0, 0, 0], direction: [0, -2.075, 0] }],
      counts: [
        parameter({ name: 'd8', kind: 'countU', unit: '', value: 3 }),
        parameter({ name: 'd9', kind: 'CountV', unit: '', value: 1 }),
      ],
      parameters: [
        parameter({ name: 'd10', kind: 'uSpaceDistance', value: 0.3 }),
        parameter({ name: 'd11', kind: 'vSpaceDistance', value: 0 }),
      ],
    });
    const { design, report } = f3dToDesign(f3d, 'Washer');
    expect(report.imported).toContain('R-Pattern1');
    const pattern = design.toJSON().features.find((f) => f.name === 'R-Pattern1');
    // The file's direction runs along −Y: Extrudo's Y axis with the distance negated.
    expect(pattern?.inputs).toMatchObject({
      direction1: { refs: [{ kind: 'axis', id: 'origin:y' }] },
      distance1: { expr: '-3 mm' },
      count1: { expr: '3' },
      measure1: { value: 'extent' },
    });
    expect(pattern?.inputs.direction2).toBeUndefined();
    expect(await volumes(f3d)).toEqual([expect.closeTo(RING - 3 * HOLE, 3)]);
  });

  it('leaves out a mirror of faces, saying why', () => {
    const f3d = washerWithHole();
    f3d.features.push({
      ...base,
      type: 'mirror',
      id: 7,
      kind: 'Mirror',
      name: 'Mirror1',
      objects: 'faces',
      features: [],
      plane: { origin: [0, 0, 0], x: [0, 1, 0], y: [0, 0, 1] },
    });
    const { report } = f3dToDesign(f3d, 'Washer');
    expect(report.skipped).toContainEqual({
      name: 'Mirror1',
      kind: 'Mirror',
      reason: 'it copies faces (only features and bodies are imported)',
    });
  });

  it('sweeps a profile along a line of another sketch', async () => {
    const profile = circle(10, 101n, 0.1);
    // A sketch on XZ: (u, v) → (u, 0, v); its line runs 1 cm up Z.
    const frame = [1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1];
    const f3d: F3dDesign = {
      parameters: [],
      userParameters: [],
      features: [
        sketch(1, 5, 'Sketch1', [profile]),
        {
          type: 'sketch',
          id: 2,
          kind: 'Sketch',
          name: 'Sketch2',
          suppressed: false,
          parameters: [],
          sketch: {
            id: 6,
            frame,
            points: [
              { id: 21, at: [0, 0, 0], incidence: 0 },
              { id: 22, at: [0, 1, 0], incidence: 0 },
            ],
            lines: [
              {
                id: 20,
                tag: 201n,
                start: [0, 0, 0],
                end: [0, 1, 0],
                startPoint: 21,
                endPoint: 22,
                construction: false,
              },
            ],
            circulars: [],
            splines: [],
            texts: [],
          },
        },
        {
          ...base,
          type: 'sweep',
          id: 3,
          kind: 'Sweep',
          name: 'Sweep1',
          parameters: [
            parameter({ name: 'd1', kind: 'AlongDistance', unit: '', value: 1 }),
            parameter({ name: 'd2', kind: 'AgainstDistance', unit: '', value: 0 }),
            parameter({ name: 'd3', kind: 'TaperAngle', unit: 'deg', value: 0 }),
          ],
          operation: 'new-body',
          profiles: [
            {
              id: 30,
              sketch: 5,
              regions: [
                { outer: [[101n]], inner: [], outerPieces: whole([[101n]]), innerPieces: [] },
              ],
            },
          ],
          paths: [[{ sketch: 6, tag: 201n }]],
          pathEdges: false,
          participants: [],
        },
      ],
      bodies: [],
      problems: [],
    };
    const { report } = f3dToDesign(f3d, 'Rod');
    expect(report.imported).toContain('Sweep1');
    expect(await volumes(f3d)).toEqual([expect.closeTo(Math.PI * 10, 2)]);
  });

  it('leaves out a sweep along part of its path, or with a taper', () => {
    const f3d = washerWithHole();
    const sweep = (name: string, along: number, taper: number): F3dFeature => ({
      ...base,
      type: 'sweep',
      id: 9,
      kind: 'Sweep',
      name,
      parameters: [
        parameter({ name: 'd1', kind: 'AlongDistance', unit: '', value: along }),
        parameter({ name: 'd3', kind: 'TaperAngle', unit: 'deg', value: taper }),
      ],
      operation: 'new-body',
      profiles: [{ id: 30, sketch: 6, regions: [] }],
      paths: [[{ sketch: 5, tag: 101n }]],
      pathEdges: false,
      participants: [],
    });
    f3d.features.push(sweep('Sweep1', 0.5, 0), sweep('Sweep2', 1, 0.1));
    const { report } = f3dToDesign(f3d, 'Washer');
    expect(report.skipped).toEqual(
      expect.arrayContaining([
        { name: 'Sweep1', kind: 'Sweep', reason: 'it follows only part of its path' },
        { name: 'Sweep2', kind: 'Sweep', reason: 'it tapers (Extrudo sweeps scale instead)' },
      ]),
    );
  });

  it('splits a body in two by a plane', async () => {
    const f3d = washerWithHole();
    f3d.bodies = [{ id: 50, index: 1, visible: true, creator: 2 }];
    f3d.features.push({
      ...base,
      type: 'split',
      id: 7,
      kind: 'Split',
      name: 'Split1',
      bodies: [50],
      // The XZ plane: its normal x × y is −Y.
      plane: { origin: [0, 0, 0], x: [1, 0, 0], y: [0, 0, 1] },
    });
    const { design, report } = f3dToDesign(f3d, 'Washer');
    expect(report.imported).toContain('Split1');
    const split = design.toJSON().features.find((f) => f.name === 'Split1');
    expect(split?.inputs).toMatchObject({
      bodies: { refs: [{ kind: 'body', id: `${design.toJSON().features[1]?.id}:0` }] },
      plane: { refs: [{ kind: 'plane', id: 'origin:xz' }] },
    });
    // The hole at (3.8, 0) mm is cut in half by the plane.
    const halves = await volumes(f3d);
    expect(halves).toEqual([
      expect.closeTo((RING - HOLE) / 2, 3),
      expect.closeTo((RING - HOLE) / 2, 3),
    ]);
  });

  it("threads a rod's side, found by its crest where the thread moved it off the sketch circle", async () => {
    // A Ø10 × 10 mm rod; the file's B-rep has its side at the thread's crest, Ø9.85.
    const f3d: F3dDesign = {
      parameters: [],
      userParameters: [],
      features: [
        sketch(1, 5, 'Sketch1', [circle(10, 101n, 0.5)]),
        {
          ...extrude(2, 'Extrude1', 5, 'new-body', 101n),
          parameters: [parameter({ name: 'd2', kind: 'AlongDistance', value: 1 })],
        },
        {
          ...base,
          type: 'thread',
          id: 3,
          kind: 'Thread',
          name: 'Thread1',
          spec: {
            angle: 60,
            external: true,
            designation: 'M10x1.5',
            family: 'ISO Metric profile',
            full: false,
            major: 0.985,
            minor: 0.8141,
            pitch: 0.15,
          },
          parameters: [
            parameter({ name: 'd3', kind: 'ThreadLength', value: 0.6 }),
            parameter({ name: 'd4', kind: 'ThreadOffset', value: 0 }),
          ],
          faces: [
            {
              tags: [{ token: '3', designs: [301] }],
              feature: 2,
              surface: {
                kind: 'cone',
                center: [0, 0, 0],
                axis: [0, 0, 1],
                radius: 0.4925,
                cylinder: true,
                slope: 0,
              },
            },
          ],
        },
      ],
      bodies: [],
      problems: [],
    };
    const { design, report } = f3dToDesign(f3d, 'Rod');
    expect(report.imported).toContain('Thread1');
    const feature = design.toJSON().features.find((f) => f.name === 'Thread1');
    expect(feature?.inputs).toMatchObject({
      diameter: { expr: '9.85 mm' },
      pitch: { expr: '1.5 mm' },
      extent: { value: 'length' },
      length: { expr: '6 mm' },
      tolerance: { expr: '0 mm' },
    });
    const [volume] = await volumes(f3d);
    // A 6 mm thread cuts some of the rod away, never more than the ring down to its minor diameter.
    const rod = Math.PI * 25 * 10;
    expect(volume).toBeLessThan(rod - 1);
    expect(volume).toBeGreaterThan(rod - Math.PI * (25 - 4.0705 ** 2) * 6 - 1);
  });

  it('leaves out an internal thread on a hole wider than the thread', () => {
    const f3d = washerWithHole();
    f3d.features.push({
      ...base,
      type: 'thread',
      id: 7,
      kind: 'Thread',
      name: 'Thread1',
      // M4 in the washer's Ø4.2 hole: the file would fill the hole to Ø3.3 first.
      spec: {
        angle: 60,
        external: false,
        designation: 'M4x0.7',
        family: 'ISO Metric profile',
        full: true,
        major: 0.4,
        minor: 0.33,
        pitch: 0.07,
      },
      faces: [
        {
          tags: [{ token: '4', designs: [301] }],
          feature: 2,
          surface: {
            kind: 'cone',
            center: [0, 0, 0],
            axis: [0, 0, 1],
            radius: 0.165,
            cylinder: true,
            slope: 0,
          },
        },
      ],
    });
    const { report } = f3dToDesign(f3d, 'Washer');
    expect(report.skipped).toContainEqual({
      name: 'Thread1',
      kind: 'Thread',
      reason: 'its hole is wider than the thread (the file fills it in to the thread first)',
    });
  });

  it("names a face a pattern copied after the copy, as Extrudo's pattern names it", async () => {
    const f3d = washerWithHole();
    f3d.features.push(
      {
        ...base,
        type: 'circular-pattern',
        id: 7,
        kind: 'C-Pattern',
        name: 'C-Pattern1',
        parameters: [parameter({ name: 'd6', kind: 'TotalAngle', unit: 'deg', value: Math.PI })],
        objects: 'features',
        features: [4],
        axis: { point: [0, 0, 0], direction: [0, 0, 1] },
        count: parameter({ name: 'countU', kind: 'countU', unit: '', value: 2 }),
      },
      {
        ...base,
        type: 'chamfer',
        id: 8,
        kind: 'Chamfer',
        name: 'Chamfer1',
        sets: [
          {
            size: parameter({ name: 'd7', kind: 'Distance', value: 0.01 }),
            edges: [
              {
                // The top of the ring, and the wall of the copied hole (instance 2, the first
                // copy; its tag carries the hole's, the pattern's and the instance's ops).
                faces: [
                  {
                    tags: [{ token: '2', designs: [301] }],
                    feature: 2,
                    surface: { kind: 'plane', point: [0, 0, 0.08], normal: [0, 0, 1] },
                  },
                  {
                    tags: [{ token: '3', designs: [303, 307, 308] }],
                    feature: 4,
                    instance: { pattern: 7, code: 2 },
                    // The surface of the face it copies, at (3.8, 0) mm.
                    surface: {
                      kind: 'cone',
                      center: [0.38, 0, 0],
                      axis: [0, 0, 1],
                      radius: 0.05,
                      cylinder: true,
                      slope: 0,
                    },
                  },
                ],
                bounds: [],
              },
            ],
          },
        ],
      },
    );
    const { design, report } = f3dToDesign(f3d, 'Washer');
    expect(report.imported).toEqual(expect.arrayContaining(['C-Pattern1', 'Chamfer1']));
    const doc = design.toJSON();
    const id = (name: string) => doc.features.find((f) => f.name === name)?.id;
    const chamfer = doc.features.find((f) => f.name === 'Chamfer1');
    const ref = (chamfer?.inputs.edges as { refs: { id: string }[] } | undefined)?.refs[0]?.id;
    expect(ref).toMatch(
      new RegExp(
        `^e\\[extrude:${id('Extrude1')}:cap:end\\|pattern:${id('C-Pattern1')}:1:from:\\(extrude:${id('Extrude2')}:side:[^)]+\\)\\]$`,
      ),
    );
    // The chamfer is built on that edge.
    const [volume] = await volumes(f3d);
    expect(volume).toBeLessThan(RING - 2 * HOLE);
  });

  it('repeats a cut along a sketch line, walked from the start point the file gives', async () => {
    for (const [start, flip] of [
      [[0, 0, 0], false],
      [[0, 0.3, 0], true],
    ] as const) {
      const f3d = washerWithHole();
      f3d.features.push(
        {
          type: 'sketch',
          id: 5,
          kind: 'Sketch',
          name: 'Sketch3',
          suppressed: false,
          parameters: [],
          sketch: {
            id: 9,
            frame: IDENTITY,
            points: [
              { id: 91, at: [0, 0, 0], incidence: 0 },
              { id: 92, at: [0, 0.3, 0], incidence: 0 },
            ],
            lines: [
              {
                id: 90,
                tag: 901n,
                start: [0, 0, 0],
                end: [0, 0.3, 0],
                startPoint: 91,
                endPoint: 92,
                construction: true,
              },
            ],
            circulars: [],
            splines: [],
            texts: [],
          },
        },
        {
          ...base,
          type: 'path-pattern',
          id: 7,
          kind: 'PathPattern',
          name: 'PathPattern1',
          parameters: [parameter({ name: 'd9', kind: 'PathPatternDelta', value: 0.3 })],
          objects: 'features',
          features: [4],
          path: [{ sketch: 9, tag: 901n }],
          start: [...start],
          extent: true,
          aligned: false,
          flag: 0,
          count: parameter({ name: 'd8', kind: 'countU', unit: '', value: 2 }),
        },
      );
      const { design, report } = f3dToDesign(f3d, 'Washer');
      expect(report.imported).toContain('PathPattern1');
      const pattern = design.toJSON().features.find((f) => f.name === 'PathPattern1');
      expect(pattern?.inputs).toMatchObject({ distance: { expr: '3 mm' }, count: { expr: '2' } });
      expect(pattern?.inputs.flip !== undefined).toBe(flip);
      expect(await volumes(f3d)).toEqual([expect.closeTo(RING - 2 * HOLE, 3)]);
    }
  });

  it("names a hole's wall as Extrudo names it, so a chamfer on its rim resolves", async () => {
    const f3d = washerWithHole();
    // Replace the cut with a 1 mm hole drilled 0.8 mm into the ring's top at (3.8, 0) mm.
    f3d.features.splice(2, 2, {
      ...base,
      type: 'hole',
      id: 4,
      kind: 'Hole',
      name: 'Hole1',
      parameters: [
        parameter({ name: 'd5', kind: 'HoleDiameter', value: 0.1 }),
        parameter({ name: 'd6', kind: 'HoleDepth', value: 0.08 }),
        parameter({ name: 'd7', kind: 'TipAngle', unit: 'deg', value: Math.PI }),
      ],
      plane: { origin: [0, 0, 0.08], x: [1, 0, 0], y: [0, 1, 0] },
      centres: [[0.38, 0, 0.08]],
      flipped: false,
    });
    f3d.features.push({
      ...base,
      type: 'chamfer',
      id: 8,
      kind: 'Chamfer',
      name: 'Chamfer1',
      sets: [
        {
          size: parameter({ name: 'd8', kind: 'Distance', value: 0.01 }),
          edges: [
            {
              faces: [
                {
                  tags: [{ token: '2', designs: [301] }],
                  feature: 2,
                  surface: { kind: 'plane', point: [0, 0, 0.08], normal: [0, 0, 1] },
                },
                {
                  tags: [{ token: '3', designs: [303] }],
                  feature: 4,
                  surface: {
                    kind: 'cone',
                    center: [0.38, 0, 0],
                    axis: [0, 0, -1],
                    radius: 0.05,
                    cylinder: true,
                    slope: 0,
                  },
                },
              ],
              bounds: [],
            },
          ],
        },
      ],
    });
    const { design, report } = f3dToDesign(f3d, 'Washer');
    expect(report.imported).toEqual(expect.arrayContaining(['Hole1', 'Chamfer1']));
    const doc = design.toJSON();
    const hole = doc.features.find((f) => f.name === 'Hole1');
    const points = hole?.inputs.points as { refs: { id: string }[] } | undefined;
    const point = points?.refs[0]?.id.split('/')[1];
    const chamfer = doc.features.find((f) => f.name === 'Chamfer1');
    const ref = (chamfer?.inputs.edges as { refs: { id: string }[] } | undefined)?.refs[0]?.id;
    expect(ref).toContain(`hole:${hole?.id}:side:${point}.wall`);
    const [volume] = await volumes(f3d);
    expect(volume).toBeLessThan(RING - HOLE);
  });

  it('leaves out an offset of faces a pattern copied, saying why', () => {
    const f3d = washerWithHole();
    f3d.features.push({
      ...base,
      type: 'offset-faces',
      id: 8,
      kind: 'OffsetFaces',
      name: 'OffsetFaces1',
      distance: parameter({ name: 'd9', kind: 'distance', value: -0.02 }),
      faces: [
        {
          tags: [{ token: '3', designs: [303, 307, 308] }],
          feature: 4,
          instance: { pattern: 7, code: 2 },
        },
      ],
    });
    const { report } = f3dToDesign(f3d, 'Washer');
    expect(report.skipped).toContainEqual({
      name: 'OffsetFaces1',
      kind: 'OffsetFaces',
      reason: 'it moves faces a pattern or mirror copied (not imported yet)',
    });
  });
});
