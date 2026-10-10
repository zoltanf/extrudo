/**
 * The mapper on hand-built decoded designs: what `readF3d` gives for a
 * washer (one sketch of two circles, one extrude of the ring between them)
 * turns into an Extrudo design that builds the same solid. Real files stay
 * out of the repository; `corpus.test.ts` reads a folder of them.
 */

import { readFileSync } from 'node:fs';
import type { SketchData } from '@extrudo/core';
import { Kernel } from '@extrudo/kernel';
import { kernelFeatures, loadOcct, RecomputeEngine } from '@extrudo/kernel/node';
import { loadFont } from '@extrudo/sketch/text';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ParameterValue } from './decode/parameters';
import { f3dToDesign } from './map';
import { type F3dDesign, type F3dExtrude, type F3dSketchFeature, IDENTITY } from './model';

let kernel: Kernel;

beforeAll(async () => {
  kernel = new Kernel(await loadOcct());
  loadFont(
    'inter-regular@1',
    readFileSync(new URL('../../fonts/fonts/inter-regular.ttf', import.meta.url)),
  );
});

afterAll(() => {
  kernel.dispose();
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

/** A circle in the sketch frame, cm, with its centre point record. */
function circle(id: number, tag: bigint, radius: number) {
  return {
    point: { id: id + 1, at: [0, 0, 0] as [number, number, number], incidence: 0 },
    circle: {
      id,
      tag,
      center: [0, 0, 0] as [number, number, number],
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

/** A washer: OD 11, ID 4.2, `thick` (0.8 mm) high, on a sketch with the given frame. */
function washer(frame = IDENTITY): F3dDesign {
  const outer = circle(10, 101n, 0.55);
  const inner = circle(20, 102n, 0.21);
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
      points: [outer.point, inner.point],
      lines: [],
      circulars: [outer.circle, inner.circle],
      splines: [],
      texts: [],
    },
  };
  const extrude: F3dExtrude = {
    type: 'extrude',
    id: 2,
    kind: 'Extrude',
    name: 'Extrude1',
    suppressed: false,
    parameters: [
      parameter({ name: 'd3', expression: 'thick', kind: 'AlongDistance', value: 0.08 }),
    ],
    operation: 'new-body',
    direction: 'one-side',
    reversed: false,
    solid: true,
    start: 'profile-plane',
    profiles: [{ id: 30, sketch: 5, regions: [{ outer: [[101n]], inner: [[102n]] }] }],
    faces: [],
  };
  return {
    parameters: [],
    userParameters: [parameter({ name: 'thick', expression: '0.8 mm', user: true, value: 0.08 })],
    features: [sketch, extrude],
    problems: [],
  };
}

type Measure = ReturnType<Kernel['measure']>;

async function volumes(f3d: F3dDesign): Promise<number[]> {
  return (await measures(f3d)).map((m) => m.volume);
}

async function measures(f3d: F3dDesign): Promise<Measure[]> {
  const { design } = f3dToDesign(f3d, 'Washer');
  expect(design.validate()).toEqual([]);
  const engine = new RecomputeEngine(kernel, kernelFeatures(), { strictLeaks: true });
  try {
    const result = await engine.recompute({ doc: design.toJSON() });
    if (result.status !== 'done') throw new Error(`recompute ${result.status}`);
    const failed = Object.values(result.features).filter((status) => status.status === 'error');
    expect(failed).toEqual([]);
    return result.bodies.flatMap((body) => {
      const shape = engine.latestBody(body.id);
      return shape ? [kernel.measure(shape)] : [];
    });
  } finally {
    engine.clear();
  }
}

const RING = Math.PI * (5.5 ** 2 - 2.1 ** 2) * 0.8;

describe('f3dToDesign', () => {
  it('keeps user parameters and drives the extrude by them', () => {
    const { design, report } = f3dToDesign(washer(), 'Washer');
    const doc = design.toJSON();
    expect(doc.parameters.map((p) => [p.name, p.expression])).toEqual([['thick', '0.8 mm']]);
    const extrude = Object.values(doc.features).find((f) => f.type === 'extrude');
    expect(extrude?.inputs.distance).toMatchObject({ expr: 'thick' });
    expect(report.imported).toEqual(['Sketch1', 'Extrude1']);
    expect(report.skipped).toEqual([]);
  });

  it('builds the ring between the selected circles', async () => {
    const [volume, ...rest] = await volumes(washer());
    expect(rest).toEqual([]);
    expect(volume).toBeCloseTo(RING, 3);
  });

  it('places a sketch on an offset plane parallel to an origin plane', async () => {
    const frame = [...IDENTITY];
    frame[11] = 1.5; // 15 mm up
    const { report } = f3dToDesign(washer(frame), 'Washer');
    expect(report.notes.join('\n')).toContain('15 mm from');
    expect(await volumes(washer(frame))).toHaveLength(1);
  });

  it('places a sketch on a plane turned about an origin axis and moved along its normal', async () => {
    // Turned 30° about X, 10 mm out along its normal.
    const [cos, sin] = [Math.cos(Math.PI / 6), Math.sin(Math.PI / 6)];
    const N: [number, number, number] = [0, -sin, cos];
    const frame = [1, 0, 0, 0, 0, cos, N[1], N[1], 0, sin, N[2], N[2], 0, 0, 0, 1];
    const f3d = washer(frame);
    const { design, report } = f3dToDesign(f3d, 'Washer');
    expect(report.skipped).toEqual([]);
    expect(design.toJSON().features.map((f) => f.type)).toEqual([
      'planeAtAngle',
      'offsetPlane',
      'sketch',
      'extrude',
    ]);
    const [m] = await measures(f3d);
    expect(m?.volume).toBeCloseTo(RING, 3);
    // The ring's centre: 10 mm out along N, plus half its 0.8 mm height.
    const centre = [0, 1, 2].map((i) => ((m?.bbox.min[i] ?? 0) + (m?.bbox.max[i] ?? 0)) / 2);
    expect(centre[0]).toBeCloseTo(0, 2);
    expect(centre[1]).toBeCloseTo(10.4 * N[1], 2);
    expect(centre[2]).toBeCloseTo(10.4 * N[2], 2);
  });

  it('reports what it leaves out, and why', () => {
    const f3d = washer();
    f3d.features.push(
      {
        type: 'other',
        id: 3,
        kind: 'Revolve',
        name: 'Revolve1',
        suppressed: false,
        parameters: [],
      },
      { type: 'other', id: 4, kind: 'Shell', name: 'Shell1', suppressed: true, parameters: [] },
    );
    // A plane along no origin axis: x (1, −1, 0)/√2, y (1, 1, −2)/√6, normal (1, 1, 1)/√3.
    const [a, b, c] = [Math.SQRT1_2, 1 / Math.sqrt(6), 1 / Math.sqrt(3)];
    const tilted = [a, b, c, 0, -a, b, c, 0, 0, -2 * b, c, 0, 0, 0, 0, 1];
    const sketch = f3d.features[0] as F3dSketchFeature;
    f3d.features.push({
      ...sketch,
      id: 6,
      name: 'Sketch2',
      sketch: { ...sketch.sketch, frame: tilted },
    });
    const { report } = f3dToDesign(f3d, 'Washer');
    expect(report.skipped).toEqual([
      { name: 'Revolve1', kind: 'Revolve', reason: 'not supported yet' },
      { name: 'Shell1', kind: 'Shell', reason: 'suppressed in Fusion' },
      { name: 'Sketch2', kind: 'Sketch', reason: 'its plane is not along an origin axis' },
    ]);
  });

  it('starts an extrude from an offset plane', async () => {
    const f3d = washer();
    const extrude = f3d.features[1] as F3dExtrude;
    extrude.start = 'offset-plane';
    extrude.parameters.push(parameter({ name: 'd4', kind: 'ProfileOffset', value: 0.5 }));
    const [m] = await measures(f3d);
    expect(m?.volume).toBeCloseTo(RING, 3);
    expect(m?.bbox.min[2]).toBeCloseTo(5, 1);
    expect(m?.bbox.max[2]).toBeCloseTo(5.8, 1);
  });

  it('turns up to a parallel face into a distance', async () => {
    const f3d = washer();
    const extrude = f3d.features[1] as F3dExtrude;
    extrude.parameters = [parameter({ name: 'd3', kind: 'Side1Offset', value: 0 })];
    extrude.faces = [
      { tags: [], surface: { kind: 'plane', point: [3, 3, -1.2], normal: [0, 0, 1] } },
    ];
    const [m] = await measures(f3d);
    expect(m?.bbox.min[2]).toBeCloseTo(-12, 1);
    expect(m?.bbox.max[2]).toBeCloseTo(0, 1);
  });

  it('draws a cubic spline as a control spline', async () => {
    const f3d = washer();
    const sketch = f3d.features[0] as F3dSketchFeature;
    sketch.sketch.points = [
      { id: 41, at: [0, 0, 0], incidence: 0 },
      { id: 42, at: [2, 0, 0], incidence: 0 },
    ];
    sketch.sketch.circulars = [];
    sketch.sketch.lines = [
      {
        id: 43,
        tag: 201n,
        start: [0, 0, 0],
        end: [2, 0, 0],
        startPoint: 41,
        endPoint: 42,
        construction: false,
      },
    ];
    const poles: [number, number, number][] = [
      [2, 0, 0],
      [2, 1.5, 0],
      [0, 1.5, 0],
      [0, 0, 0],
    ];
    sketch.sketch.splines = [
      {
        id: 44,
        tag: 202n,
        degree: 3,
        knots: [0, 0, 0, 0, 1, 1, 1, 1],
        weights: [],
        poles,
        startPoint: 42,
        endPoint: 41,
        construction: false,
      },
    ];
    const extrude = f3d.features[1] as F3dExtrude;
    extrude.profiles = [{ id: 30, sketch: 5, regions: [{ outer: [[201n, 202n]], inner: [] }] }];
    const { design } = f3dToDesign(f3d, 'Spline');
    const input = design.toJSON().features[0]?.inputs.sketch as unknown as { sketch: SketchData };
    const splines = Object.values(input.sketch.entities).filter((e) => e.type === 'spline');
    expect(splines.map((e) => e.mode)).toEqual(['control']);
    // The area between the chord and a cubic Bézier, by the shoelace formula along it.
    let area = 0;
    let prev = [20, 0];
    for (let i = 1; i <= 2000; i++) {
      const t = i / 2000;
      const b = [(1 - t) ** 3, 3 * t * (1 - t) ** 2, 3 * t ** 2 * (1 - t), t ** 3];
      const x = 10 * poles.reduce((sum, p, k) => sum + p[0] * (b[k] as number), 0);
      const y = 10 * poles.reduce((sum, p, k) => sum + p[1] * (b[k] as number), 0);
      area += (prev[0] as number) * y - x * (prev[1] as number);
      prev = [x, y];
    }
    expect(await volumes(f3d)).toEqual([expect.closeTo((Math.abs(area) / 2) * 0.8, 1)]);
  });

  it('revolves a profile about an origin axis', async () => {
    const f3d = washer();
    const sketch = f3d.features[0] as F3dSketchFeature;
    const corners: [number, number, number][] = [
      [1, 0, 0],
      [2, 0, 0],
      [2, 1, 0],
      [1, 1, 0],
    ];
    sketch.sketch.points = corners.map((at, i) => ({ id: 50 + i, at, incidence: 0 }));
    sketch.sketch.circulars = [];
    sketch.sketch.lines = corners.map((start, i) => ({
      id: 60 + i,
      tag: BigInt(300 + i),
      start,
      end: corners[(i + 1) % 4] as [number, number, number],
      startPoint: 50 + i,
      endPoint: 50 + ((i + 1) % 4),
      construction: false,
    }));
    f3d.features[1] = {
      type: 'revolve',
      id: 2,
      kind: 'Revolve',
      name: 'Revolve1',
      suppressed: false,
      parameters: [
        parameter({
          name: 'd3',
          kind: 'AlongAngle',
          unit: 'deg',
          expression: '360 deg',
          value: 2 * Math.PI,
        }),
      ],
      operation: 'new-body',
      profiles: [
        { id: 30, sketch: 5, regions: [{ outer: [[300n, 301n, 302n, 303n]], inner: [] }] },
      ],
      axis: { point: [0, 0, 0], direction: [0, 1, 0] },
    };
    const { report } = f3dToDesign(f3d, 'Tube');
    expect(report.imported).toEqual(['Sketch1', 'Revolve1']);
    expect(await volumes(f3d)).toEqual([expect.closeTo(Math.PI * (20 ** 2 - 10 ** 2) * 10, 2)]);
  });

  it('drills holes at their centres into the face they start on', async () => {
    const f3d = washer();
    f3d.features.push({
      type: 'hole',
      id: 3,
      kind: 'Hole',
      name: 'Hole1',
      suppressed: false,
      parameters: [
        parameter({ name: 'd5', kind: 'HoleDiameter', value: 0.1 }),
        parameter({ name: 'd6', kind: 'HoleDepth', value: 0.2 }),
        parameter({ name: 'd7', kind: 'TipAngle', unit: 'deg', value: (118 * Math.PI) / 180 }),
      ],
      plane: { origin: [0, 0, 0.08], x: [1, 0, 0], y: [0, 1, 0] },
      centres: [
        [0.38, 0, 0.08],
        [-0.38, 0, 0.08],
      ],
      flipped: false,
    });
    const { report } = f3dToDesign(f3d, 'Washer');
    expect(report.imported).toContain('Hole1');
    expect(await volumes(f3d)).toEqual([expect.closeTo(RING - 2 * Math.PI * 0.5 ** 2 * 0.8, 3)]);
  });

  it('repeats a cut round an origin axis', async () => {
    const f3d = washer();
    // A 1 mm hole cut through the ring at x = 3.8 mm, then repeated 4 times about Z.
    const hole = circle(40, 401n, 0.05);
    hole.circle.center = [0.38, 0, 0];
    hole.point.at = [0.38, 0, 0];
    f3d.features.push(
      {
        type: 'sketch',
        id: 3,
        kind: 'Sketch',
        name: 'Sketch2',
        suppressed: false,
        parameters: [],
        sketch: {
          id: 6,
          frame: IDENTITY,
          points: [hole.point],
          lines: [],
          circulars: [hole.circle],
          splines: [],
          texts: [],
        },
      },
      {
        ...(f3d.features[1] as F3dExtrude),
        id: 4,
        name: 'Extrude2',
        operation: 'cut',
        parameters: [parameter({ name: 'd5', kind: 'AlongDistance', value: 0.08 })],
        profiles: [{ id: 31, sketch: 6, regions: [{ outer: [[401n]], inner: [] }] }],
      },
      {
        type: 'circular-pattern',
        id: 7,
        kind: 'C-Pattern',
        name: 'C-Pattern1',
        suppressed: false,
        parameters: [
          parameter({ name: 'd6', kind: 'TotalAngle', unit: 'deg', value: 2 * Math.PI }),
        ],
        objects: 'features',
        features: [4],
        axis: { point: [0, 0, 0], direction: [0, 0, 2.075] },
        count: parameter({ name: 'countU', kind: 'countU', unit: '', value: 4 }),
      },
    );
    const { report } = f3dToDesign(f3d, 'Washer');
    expect(report.imported).toContain('C-Pattern1');
    expect(await volumes(f3d)).toEqual([expect.closeTo(RING - 4 * Math.PI * 0.5 ** 2 * 0.8, 3)]);
  });

  it('draws a text in its box, at Fusion size as capital height, and extrudes its letters', async () => {
    const f3d = washer();
    // "H" at 10 mm font size in Arial: a box 7.22 mm wide from (20, 0) mm.
    f3d.features.push(
      {
        type: 'sketch',
        id: 3,
        kind: 'Sketch',
        name: 'Sketch2',
        suppressed: false,
        parameters: [],
        sketch: {
          id: 6,
          frame: IDENTITY,
          points: [],
          lines: [],
          circulars: [],
          splines: [],
          texts: [
            { id: 50, text: 'H', font: 'Arial', height: 1, angle: 0, at: [2, 0], width: 0.722 },
          ],
        },
      },
      {
        ...(f3d.features[1] as F3dExtrude),
        id: 4,
        name: 'Extrude2',
        parameters: [parameter({ name: 'd5', kind: 'AlongDistance', value: 0.2 })],
        profiles: [{ id: 32, sketch: 6, text: 50 }],
      },
    );
    const { report } = f3dToDesign(f3d, 'Washer');
    expect(report.imported).toContain('Extrude2');
    expect(report.notes.join('\n')).toContain('text "H" in Arial is drawn in Inter');
    const [, letter] = await measures(f3d);
    // Centred in the box, standing on its bottom edge, capitals 7.16 mm high.
    expect(((letter?.bbox.min[0] ?? 0) + (letter?.bbox.max[0] ?? 0)) / 2).toBeCloseTo(23.61, 0);
    expect(letter?.bbox.min[1]).toBeCloseTo(0, 1);
    expect(letter?.bbox.max[1]).toBeCloseTo(7.16, 1);
  });

  it("moves an extrude's face along its outward normal", async () => {
    const f3d = washer();
    f3d.features.push({
      type: 'offset-faces',
      id: 3,
      kind: 'OffsetFaces',
      name: 'OffsetFaces1',
      suppressed: false,
      parameters: [],
      // The ring's top: made by Extrude1 (record 2), 0.8 mm up.
      faces: [
        {
          tags: [],
          feature: 2,
          surface: { kind: 'plane', point: [0, 0, 0.08], normal: [0, 0, 1] },
        },
      ],
      distance: parameter({ name: 'd5', kind: 'distance', value: 0.02 }),
    });
    const { report } = f3dToDesign(f3d, 'Washer');
    expect(report.imported).toContain('OffsetFaces1');
    expect(await volumes(f3d)).toEqual([expect.closeTo((RING * 1.0) / 0.8, 3)]);
  });

  it("reads Fusion's 180° drill point as flat, and its flip", async () => {
    const f3d = washer();
    f3d.features.push({
      type: 'hole',
      id: 3,
      kind: 'Hole',
      name: 'Hole1',
      suppressed: false,
      parameters: [
        parameter({ name: 'd5', kind: 'HoleDiameter', value: 0.1 }),
        parameter({ name: 'd6', kind: 'HoleDepth', value: 0.04 }),
        parameter({ name: 'd7', kind: 'TipAngle', unit: 'deg', value: Math.PI }),
      ],
      // The washer's foot (z = 0), its plane's normal up: flipped drills up into it.
      plane: { origin: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0] },
      centres: [[0.38, 0, 0]],
      flipped: true,
    });
    const { design } = f3dToDesign(f3d, 'Washer');
    const hole = design.toJSON().features.find((f) => f.type === 'hole');
    expect(hole?.inputs.tipAngle).toMatchObject({ expr: '0 deg' });
    expect(await volumes(f3d)).toEqual([expect.closeTo(RING - Math.PI * 0.5 ** 2 * 0.4, 3)]);
  });
});
