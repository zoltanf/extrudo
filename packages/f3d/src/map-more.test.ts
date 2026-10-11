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
});
