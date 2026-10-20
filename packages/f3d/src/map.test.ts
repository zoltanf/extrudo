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
import type { AsmSurface } from './asm';
import type { ProfileRegion } from './decode/extrude';
import type { ParameterValue } from './decode/parameters';
import type { Vec3 } from './decode/sketch-geometry';
import { alongSweep, bodyOrder, f3dToDesign } from './map';
import { type F3dDesign, type F3dExtrude, type F3dSketchFeature, IDENTITY } from './model';

/** A region of whole curves (each one piece of one), as the decoder gives it. */
function region(outer: bigint[][], inner: bigint[][] = []): ProfileRegion {
  const pieces = (loops: bigint[][]) =>
    loops.map((loop) => loop.map((tag) => ({ tag, secondary: 0n, piece: 1, of: 1 })));
  return { outer, inner, outerPieces: pieces(outer), innerPieces: pieces(inner) };
}

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
    profiles: [{ id: 30, sketch: 5, regions: [region([[101n]], [[102n]])] }],
    faces: [],
    participants: [],
  };
  return {
    parameters: [],
    userParameters: [parameter({ name: 'thick', expression: '0.8 mm', user: true, value: 0.08 })],
    features: [sketch, extrude],
    bodies: [],
    problems: [],
    unreadParameters: 0,
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
  it('says when a missing distance is a guess because parameter records were unreadable', () => {
    const noDistance = (unreadParameters: number) => {
      const f3d = washer();
      (f3d.features[1] as F3dExtrude).parameters = [];
      return f3dToDesign({ ...f3d, unreadParameters, problems: ['parameter #5: x'] }, 'W');
    };
    const guessed = noDistance(1);
    expect(guessed.report.notes).toContain(
      'Extrude1: its distance could not be read from the file (1 parameter record of an unknown version); imported as through everything.',
    );
    expect(guessed.report.problems).toEqual(['parameter #5: x']);
    expect(JSON.stringify(guessed.design.toJSON())).toContain('through-all');
    expect(noDistance(0).report.notes.filter((n) => n.includes('distance could not'))).toEqual([]);
  });

  it("extrudes a body's face along its outward normal (press-pull)", async () => {
    const f3d = washer();
    f3d.features.push({
      ...(f3d.features[1] as F3dExtrude),
      id: 3,
      name: 'Extrude2',
      operation: 'join',
      parameters: [parameter({ name: 'd5', kind: 'AlongDistance', value: 0.2 })],
      profiles: [],
      // The ring's top, made by Extrude1 (record 2).
      faces: [
        {
          tags: [],
          feature: 2,
          surface: { kind: 'plane', point: [0, 0, 0.08], normal: [0, 0, 1] },
        },
      ],
    });
    expect(f3dToDesign(f3d, 'Washer').report.imported).toContain('Extrude2');
    expect(await volumes(f3d)).toEqual([expect.closeTo(RING * 3.5, 3)]);
  });

  it('cuts through everything on both sides when a two-sided extrude has no distances', async () => {
    const f3d = washer();
    const cutter = circle(30, 103n, 0.4);
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
          // Halfway up the ring, so both sides have something to cut.
          frame: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0.04, 0, 0, 0, 1],
          points: [cutter.point],
          lines: [],
          circulars: [cutter.circle],
          splines: [],
          texts: [],
        },
      },
      {
        ...(f3d.features[1] as F3dExtrude),
        id: 4,
        name: 'Extrude2',
        operation: 'cut',
        direction: 'two-sides',
        parameters: [],
        profiles: [{ id: 32, sketch: 6, regions: [region([[103n]])] }],
      },
    );
    expect(await volumes(f3d)).toEqual([expect.closeTo(Math.PI * (5.5 ** 2 - 4 ** 2) * 0.8, 3)]);
  });

  it("extrudes a symmetric extrude's distance on each side of the profile (each side, not the whole length)", async () => {
    const f3d = washer();
    const extrude = f3d.features[1] as F3dExtrude;
    extrude.direction = 'symmetric';
    const { design } = f3dToDesign(f3d, 'Washer');
    const made = Object.values(design.toJSON().features).find((f) => f.type === 'extrude');
    expect(made?.inputs.symmetricMeasure).toEqual({ kind: 'enum', value: 'half' });
    // 0.8 mm either side of the sketch plane: twice the one-sided ring.
    const [m] = await measures(f3d);
    expect(m?.volume).toBeCloseTo(RING * 2, 3);
  });

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
      { name: 'Shell1', kind: 'Shell', reason: 'suppressed in the file' },
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

  it('measures an up-to-face offset along the sweep: divided by the cosine to a slanted plane', () => {
    // The file measures it along the face's normal; 0.946 is the slant seen in the corpus.
    const cos = 0.946;
    const slanted = {
      tags: [],
      surface: {
        kind: 'plane' as const,
        point: [0, 0, 2] as [number, number, number],
        normal: [0, -Math.sqrt(1 - cos * cos), -cos] as [number, number, number],
      },
    };
    expect(alongSweep(-0.95, slanted, IDENTITY)).toBeCloseTo(-0.95 / cos, 12);
    const parallel = {
      ...slanted,
      surface: { ...slanted.surface, normal: [0, 0, 1] as [number, number, number] },
    };
    expect(alongSweep(0.2, parallel, IDENTITY)).toBe(0.2);
    const round = { tags: [], surface: undefined };
    expect(alongSweep(0.2, round, IDENTITY)).toBe(0.2);
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
    extrude.profiles = [{ id: 30, sketch: 5, regions: [region([[201n, 202n]])] }];
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

  it("keeps an arc's side on the file's XZ plane, which Extrudo's frame mirrors", async () => {
    // The file's XZ sketch: x along X, y along −Z, normal +Y. A 90° arc (45° to
    // 135°, 10 mm radius) closed by its chord: the segment lies at z −7.1 to −10 mm.
    const f3d = washer([1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1]);
    const sketch = f3d.features[0] as F3dSketchFeature;
    const h = Math.SQRT1_2;
    sketch.sketch.points = [
      { id: 70, at: [0, 0, 0], incidence: 0 },
      { id: 71, at: [-h, h, 0], incidence: 0 },
      { id: 72, at: [h, h, 0], incidence: 0 },
    ];
    sketch.sketch.lines = [
      {
        id: 73,
        tag: 401n,
        start: [-h, h, 0],
        end: [h, h, 0],
        startPoint: 71,
        endPoint: 72,
        construction: false,
      },
    ];
    sketch.sketch.circulars = [
      {
        id: 74,
        tag: 402n,
        center: [0, 0, 0],
        normal: [0, 0, 1],
        xAxis: [1, 0, 0],
        radius: 1,
        startAngle: Math.PI / 4,
        endAngle: (3 * Math.PI) / 4,
        centerPoint: 70,
        startPoint: 72,
        endPoint: 71,
        construction: false,
      },
    ];
    const extrude = f3d.features[1] as F3dExtrude;
    extrude.profiles = [{ id: 30, sketch: 5, regions: [region([[401n, 402n]])] }];
    const [m, ...rest] = await measures(f3d);
    expect(rest).toEqual([]);
    expect(m?.volume).toBeCloseTo(50 * (Math.PI / 2 - 1) * 0.8, 2);
    expect(m?.bbox.min[2]).toBeCloseTo(-10, 1);
    expect(m?.bbox.max[2]).toBeCloseTo(-7.07, 1);
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
      participants: [],
      profiles: [{ id: 30, sketch: 5, regions: [region([[300n, 301n, 302n, 303n]])] }],
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
        profiles: [{ id: 31, sketch: 6, regions: [region([[401n]])] }],
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

  it("draws a text in its box, at the file's size as capital height, and extrudes its letters", async () => {
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

  it('places an older text in its box by its alignment, its height the capitals', async () => {
    const f3d = washer();
    // "H" 5 mm high, centred (3, 3) in a 20 × 10 mm box from (20, 0) mm.
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
            {
              id: 50,
              text: 'H',
              font: 'Arial',
              height: 0.5,
              angle: 0,
              at: [2, 0],
              width: 0,
              old: { mirrored: false, horizontal: 3, vertical: 3, box: [2, 1] },
            },
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
    const [, letter] = await measures(f3d);
    expect(((letter?.bbox.min[0] ?? 0) + (letter?.bbox.max[0] ?? 0)) / 2).toBeCloseTo(30, 0);
    expect(letter?.bbox.min[1]).toBeCloseTo(2.5, 1);
    expect(letter?.bbox.max[1]).toBeCloseTo(7.5, 1);
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

  it("reads the file's 180° drill point as flat, and its flip", async () => {
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

  it("puts a chamfer's first distance on the face the file's chamfer face shows", async () => {
    // The ring's outer top rim: 0.2 mm in on the top, at 60° to it (0.346 mm
    // down the side). The file's chamfer cone meets the top at r = 5.3 mm.
    const f3d = washer();
    const top: AsmSurface = { kind: 'plane', point: [0, 0, 0.08], normal: [0, 0, 1] };
    const side: AsmSurface = {
      kind: 'cone',
      center: [0, 0, 0],
      axis: [0, 0, 1],
      radius: 0.55,
      cylinder: true,
      slope: 0,
    };
    const b = 0.02 * Math.tan(Math.PI / 3);
    f3d.features.push({
      type: 'chamfer',
      id: 3,
      kind: 'Chamfer',
      name: 'Chamfer1',
      suppressed: false,
      parameters: [],
      sets: [
        {
          // The side first: the top is the face the distance goes on all the same.
          edges: [
            {
              faces: [
                { tags: [], feature: 2, surface: side },
                { tags: [], feature: 2, surface: top },
              ],
              bounds: [],
            },
          ],
          size: parameter({ name: 'd5', kind: 'leftDistance', value: 0.02 }),
          size2: parameter({ name: 'd6', kind: 'rotateAngle', unit: 'deg', value: Math.PI / 3 }),
        },
      ],
      made: [
        {
          kind: 'cone',
          center: [0, 0, 0.08],
          axis: [0, 0, 1],
          radius: 0.53,
          cylinder: false,
          slope: -0.02 / b,
        },
      ],
    });
    const { design } = f3dToDesign(f3d, 'Washer');
    const chamfer = design.toJSON().features.find((f) => f.type === 'chamfer');
    expect(chamfer?.inputs.face).toMatchObject({
      refs: [{ kind: 'face', id: expect.stringMatching(/:cap:end$/) }],
    });
    // Pappus: the bevel's triangle, ½ · 0.2 · b mm², about its centroid 5.5 − 0.2 / 3 mm out.
    const cut = 0.5 * 0.2 * (b * 10) * 2 * Math.PI * (5.5 - 0.2 / 3);
    expect(await volumes(f3d)).toEqual([expect.closeTo(RING - cut, 3)]);
  });

  it('leaves out a weak edge that only runs on from a named edge (one tangent chain)', () => {
    // On the ring's top: a short arc of its outer rim, named, and two lines at
    // its end (5.5, 0) along a face no imported feature made: one runs on
    // tangent (down Y), the other turns off (along X).
    const f3d = washer();
    const top: AsmSurface = { kind: 'plane', point: [0, 0, 0.08], normal: [0, 0, 1] };
    const plane = (point: Vec3, normal: Vec3): AsmSurface => ({ kind: 'plane', point, normal });
    const ours = (surface: AsmSurface) => ({ tags: [], feature: 2, surface });
    const other = (surface: AsmSurface) => ({ tags: [], feature: 99, surface });
    const rim = ours({
      kind: 'cone',
      center: [0, 0, 0],
      axis: [0, 0, 1],
      radius: 0.55,
      cylinder: true,
      slope: 0,
    });
    f3d.features.push({
      type: 'chamfer',
      id: 3,
      kind: 'Chamfer',
      name: 'Chamfer1',
      suppressed: false,
      parameters: [],
      sets: [
        {
          edges: [
            {
              faces: [ours(top), rim],
              bounds: [
                ours(plane([0, 0, 0], [0, -1, 0])),
                ours(plane([0.44, 0.33, 0], [0.8944272, 0.4472136, 0])),
              ],
            },
            {
              faces: [ours(top), other(plane([0.55, 0, 0], [1, 0, 0]))],
              bounds: [ours(plane([0, 0, 0], [0, 1, 0])), ours(plane([0, -1, 0], [0, -1, 0]))],
            },
            {
              faces: [ours(top), other(plane([0, 0, 0], [0, -1, 0]))],
              bounds: [ours(plane([0.55, 0, 0], [-1, 0, 0])), ours(plane([0.7, 0, 0], [1, 0, 0]))],
            },
          ],
          size: parameter({ name: 'd5', kind: 'Distance', value: 0.01 }),
        },
      ],
    });
    const { design } = f3dToDesign(f3d, 'Washer');
    const chamfer = design.toJSON().features.find((f) => f.type === 'chamfer');
    const edges = chamfer?.inputs.edges as
      | { refs: { id: string; fingerprint?: { dir?: number[] } }[] }
      | undefined;
    const refs = edges?.refs ?? [];
    expect(refs).toHaveLength(2);
    expect(refs[0]?.id).toMatch(/^e\[extrude:/);
    expect(refs[1]?.fingerprint?.dir).toEqual([1, 0, 0]);
  });
  it('rounds an edge by its two faces’ names when one is a round’s face nothing pins down', () => {
    // A chamfer of the ring's top rim, then a fillet of the edge between the
    // top and that chamfer's face, which the file's B-rep no longer has (a
    // later feature took it): no line or circle backs the fillet's edge.
    const f3d = washer();
    const top: AsmSurface = { kind: 'plane', point: [0, 0, 0.08], normal: [0, 0, 1] };
    const rim: AsmSurface = {
      kind: 'cone',
      center: [0, 0, 0],
      axis: [0, 0, 1],
      radius: 0.55,
      cylinder: true,
      slope: 0,
    };
    const ours = (surface: AsmSurface) => ({ tags: [], feature: 2, surface });
    f3d.features.push(
      {
        type: 'chamfer',
        id: 3,
        kind: 'Chamfer',
        name: 'Chamfer1',
        suppressed: false,
        parameters: [],
        sets: [
          {
            edges: [{ faces: [ours(top), ours(rim)], bounds: [] }],
            size: parameter({ name: 'd5', kind: 'Distance', value: 0.02 }),
          },
        ],
      },
      {
        type: 'fillet',
        id: 4,
        kind: 'Fillet',
        name: 'Fillet1',
        suppressed: false,
        parameters: [],
        sets: [
          {
            edges: [
              {
                faces: [ours(top), { tags: [{ token: '1', designs: [303] }], feature: 3 }],
                bounds: [],
              },
            ],
            size: parameter({ name: 'd6', kind: 'Radius', value: 0.01 }),
          },
        ],
      },
    );
    const { design, report } = f3dToDesign(f3d, 'Washer');
    expect(report.skipped).toEqual([]);
    const fillet = design.toJSON().features.find((f) => f.type === 'fillet');
    const edges = fillet?.inputs.edges as
      | { refs: { id: string; fingerprint?: unknown }[] }
      | undefined;
    const refs = edges?.refs ?? [];
    expect(refs).toHaveLength(1);
    expect(refs[0]?.id).toMatch(/^e\[.*chamfer:.*\]$/);
    // By name alone: no shape to find another edge by.
    expect(refs[0]?.fingerprint).toBeUndefined();
    expect(fillet?.inputs.skipLostEdges).toMatchObject({ value: true });
  });

  it('leaves out a profile region it cannot match when the others are found', async () => {
    // The ring, and a region along a dangling line and a curve the sketch no
    // longer has (deleted after the pick): the extrude builds the ring.
    const f3d = washer();
    const sketch = f3d.features[0] as F3dSketchFeature;
    sketch.sketch.points.push(
      { id: 41, at: [0.7, 0, 0], incidence: 0 },
      { id: 42, at: [0.9, 0, 0], incidence: 0 },
    );
    sketch.sketch.lines.push({
      id: 40,
      tag: 103n,
      start: [0.7, 0, 0],
      end: [0.9, 0, 0],
      startPoint: 41,
      endPoint: 42,
      construction: false,
    });
    const extrude = f3d.features[1] as F3dExtrude;
    extrude.profiles = [
      { id: 30, sketch: 5, regions: [region([[101n]], [[102n]]), region([[103n, 999n]])] },
    ];
    const { report } = f3dToDesign(f3d, 'Washer');
    expect(report.skipped).toEqual([]);
    expect(report.notes).toContain(
      "Extrude1: 1 profile region(s) left out: they couldn't be matched to Sketch1's curves.",
    );
    expect(await volumes(f3d)).toEqual([expect.closeTo(RING, 3)]);
    // Not one region found: skipped as before, with the region's reason.
    extrude.profiles = [{ id: 30, sketch: 5, regions: [region([[103n, 999n]])] }];
    expect(f3dToDesign(f3d, 'Washer').report.skipped).toMatchObject([
      { name: 'Extrude1', reason: "its profile couldn't be matched to Sketch1's curves" },
    ]);
  });

  describe('the bodies of an extrude that makes several', () => {
    /** A circle of radius 1 cm at (x, y), cm. */
    const disc = (id: number, tag: bigint, x: number, y = 0) => {
      const c = circle(id, tag, 1);
      c.point.at = [x, y, 0];
      c.circle.center = [x, y, 0];
      return c;
    };
    /**
     * Two discs 10 mm high, the file's first region group at x = +3 cm and the
     * second at x = −3 cm (Extrudo numbers its bodies from −x) unless placed
     * elsewhere (cm), then a 4 mm deep cut through both that names only the
     * file's `Body<cutIndex>`.
     */
    function twoDiscs(
      cutIndex: number,
      first: [number, number] = [3, 0],
      second: [number, number] = [-3, 0],
    ): F3dDesign {
      const right = disc(10, 201n, ...first);
      const left = disc(20, 202n, ...second);
      const cutter = disc(40, 203n, 0);
      cutter.circle.radius = 5;
      const sketch = (id: number, record: number, c: (typeof right)[], z: number) =>
        ({
          type: 'sketch',
          id,
          kind: 'Sketch',
          name: `Sketch${id}`,
          suppressed: false,
          parameters: [],
          sketch: {
            id: record,
            frame: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, z, 0, 0, 0, 1],
            points: c.map((x) => x.point),
            lines: [],
            circulars: c.map((x) => x.circle),
            splines: [],
            texts: [],
          },
        }) as F3dSketchFeature;
      const extrude = (p: Partial<F3dExtrude> & Pick<F3dExtrude, 'id' | 'name'>): F3dExtrude => ({
        type: 'extrude',
        kind: 'Extrude',
        suppressed: false,
        parameters: [parameter({ name: 'd1', kind: 'AlongDistance', value: 1 })],
        operation: 'new-body',
        direction: 'one-side',
        reversed: false,
        solid: true,
        start: 'profile-plane',
        profiles: [],
        faces: [],
        participants: [],
        ...p,
      });
      return {
        parameters: [],
        userParameters: [],
        features: [
          sketch(1, 5, [right, left], 0),
          extrude({
            id: 2,
            name: 'Extrude1',
            profiles: [
              {
                id: 30,
                sketch: 5,
                regions: [
                  { ...region([[201n]]), group: 0 },
                  { ...region([[202n]]), group: 1 },
                ],
              },
            ],
          }),
          sketch(3, 6, [cutter], 1),
          extrude({
            id: 4,
            name: 'Extrude2',
            operation: 'cut',
            reversed: true,
            parameters: [parameter({ name: 'd2', kind: 'AlongDistance', value: 0.4 })],
            profiles: [{ id: 31, sketch: 6, regions: [region([[203n]])] }],
            participants: [cutIndex === 1 ? 50 : 51],
          }),
        ],
        bodies: [
          { id: 50, index: 1, visible: true, creator: 2 },
          { id: 51, index: 2, visible: true, creator: 2 },
        ],
        problems: [],
        unreadParameters: 0,
      };
    }
    const DISC = Math.PI * 10 ** 2;

    it("cuts only the body the file names: its region group's place in Extrudo's order", async () => {
      const { design } = f3dToDesign(twoDiscs(1), 'Discs');
      const cut = design.toJSON().features.find((f) => f.name === 'Extrude2');
      const made = design.toJSON().features.find((f) => f.name === 'Extrude1');
      // Body1 is the first group, at +x: Extrudo's second body.
      expect(cut?.inputs.bodies).toMatchObject({ refs: [{ kind: 'body', id: `${made?.id}:1` }] });
      const shapes = await measures(twoDiscs(1));
      // Extrudo's body 0 (−x, the file's Body2) keeps its 10 mm; body 1 loses 4 mm.
      expect(shapes.map((m) => m.volume)).toEqual([
        expect.closeTo(DISC * 10, 3),
        expect.closeTo(DISC * 6, 3),
      ]);
      expect(shapes[0]?.bbox.min[0]).toBeCloseTo(-40, 6);
      const other = await measures(twoDiscs(2));
      expect(other.map((m) => m.volume)).toEqual([
        expect.closeTo(DISC * 6, 3),
        expect.closeTo(DISC * 10, 3),
      ]);
    });

    it("leaves a join's bodies to Extrudo afterwards, and shown", () => {
      const f3d = twoDiscs(1);
      const cut = f3d.features.pop() as F3dExtrude;
      // A join naming both discs, then the cut naming Body1; Body2 the file hides.
      f3d.features.push(
        { ...cut, id: 5, name: 'Extrude3', operation: 'join', participants: [50, 51] },
        cut,
      );
      (f3d.bodies[1] as { visible: boolean }).visible = false;
      const { design } = f3dToDesign(f3d, 'Discs');
      const doc = design.toJSON();
      const made = doc.features.find((f) => f.name === 'Extrude1')?.id;
      const named = (name: string) => doc.features.find((f) => f.name === name)?.inputs.bodies;
      // The join names them in the order Extrudo's default would join them,
      // not the file's (Body1 first, Extrudo's second body).
      expect(named('Extrude3')).toMatchObject({
        refs: [
          { kind: 'body', id: `${made}:0` },
          { kind: 'body', id: `${made}:1` },
        ],
      });
      // Which ID is which body after it is Extrudo's to say.
      expect(named('Extrude2')).toBeUndefined();
      expect(Object.values(doc.bodies ?? {}).some((b) => b.visible === false)).toBe(false);
    });

    const cutTargets = (f3d: F3dDesign) => {
      const { design, report } = f3dToDesign(f3d, 'Discs');
      const doc = design.toJSON();
      const made = doc.features.find((f) => f.name === 'Extrude1')?.id;
      const cut = doc.features.find((f) => f.name === 'Extrude2');
      return { made, bodies: cut?.inputs.bodies, notes: report.notes };
    };
    const DROPPED =
      "Extrude2: which of the bodies it names is which couldn't be told; it acts on every body it meets.";

    it('orders groups at one x by y, whatever order the file lists its bodies in', () => {
      // Group 0 at y = +3 cm, group 1 at y = −3 cm: the tie on x passes to y.
      const f3d = twoDiscs(1, [0, 3], [0, -3]);
      const { made, bodies, notes } = cutTargets(f3d);
      expect(bodies).toMatchObject({ refs: [{ kind: 'body', id: `${made}:1` }] });
      // Nothing about the extrudes: no region left out, no target dropped.
      expect(notes.filter((n) => n.startsWith('Extrude'))).toEqual([]);
      f3d.bodies.reverse();
      expect(cutTargets(f3d).bodies).toMatchObject({ refs: [{ kind: 'body', id: `${made}:1` }] });
    });

    it('drops the targets when two centres are closer than the kernel can be trusted to tell', () => {
      // 0.0005 mm apart along x, which orders them: past the kernel's tie, inside the slack.
      const { bodies, notes } = cutTargets(twoDiscs(1, [3, 0], [3.00005, 2.5]));
      expect(bodies).toBeUndefined();
      expect(notes).toContain(DROPPED);
    });

    it('drops the targets when the groups could come out in either order', () => {
      const f3d = twoDiscs(1);
      // Both discs on one centre: no order to tell them by.
      const sk = f3d.features[0] as F3dSketchFeature;
      for (const c of sk.sketch.circulars) c.center = [0, 0, 0];
      for (const p of sk.sketch.points) p.at = [0, 0, 0];
      (sk.sketch.circulars[1] as { radius: number }).radius = 0.5;
      const { bodies, notes } = cutTargets(f3d);
      expect(bodies).toBeUndefined();
      expect(notes).toContain(DROPPED);
    });

    it('drops the targets for several operands, a taper, regions left out or a body count the file differs on', () => {
      const operands = twoDiscs(1);
      const e1 = operands.features[1] as F3dExtrude;
      const [g0, g1] = e1.profiles[0]?.regions ?? [];
      e1.profiles = [
        { id: 30, sketch: 5, regions: [g0 as ProfileRegion] },
        { id: 32, sketch: 5, regions: [{ ...(g1 as ProfileRegion), group: 0 }] },
      ];
      const tapered = twoDiscs(1);
      (tapered.features[1] as F3dExtrude).parameters.push(
        parameter({ name: 'd9', kind: 'TaperAngle', value: 0.05, unit: 'deg' }),
      );
      const partial = twoDiscs(1);
      (partial.features[1] as F3dExtrude).profiles[0]?.regions?.push({
        ...region([[999n]]),
        group: 2,
      });
      const fewer = twoDiscs(1);
      // The file lists only Body1 of the extrude's two.
      fewer.bodies.pop();
      for (const f3d of [operands, tapered, partial, fewer]) {
        const { bodies, notes } = cutTargets(f3d);
        expect(bodies).toBeUndefined();
        expect(notes).toContain(DROPPED);
      }
    });

    it('drops the order of a group with no outline, and stays linear in bodies of one creator', () => {
      const f = twoDiscs(1).features[1] as F3dExtrude;
      for (const r of f.profiles[0]?.regions ?? []) r.outerPieces = [];
      const entry = {
        source: { frame: IDENTITY, splines: [], ellipses: [] },
        profileCurves: new Set<string>(),
        pieces: { byKey: new Map() },
      } as unknown as Parameters<typeof bodyOrder>[1];
      expect(bodyOrder(f, entry)).toBeUndefined();

      const many = twoDiscs(1);
      for (let i = 0; i < 50_000; i++)
        many.bodies.push({ id: 1000 + i, index: 3 + i, visible: true, creator: 2 });
      const started = performance.now();
      expect(cutTargets(many).bodies).toBeUndefined();
      expect(performance.now() - started).toBeLessThan(3000);
    });
  });

  describe('extrude extents from a start face', () => {
    /** A 1 mm disc's sketch (record 6) at (3.8, 0) mm in the given frame, over the ring. */
    function withDisc(frame: number[], extrude: Partial<F3dExtrude>): F3dDesign {
      const f3d = washer();
      const disc = circle(40, 301n, 0.1);
      disc.point.at = [0.38, 0, 0];
      disc.circle.center = [0.38, 0, 0];
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
            frame,
            points: [disc.point],
            lines: [],
            circulars: [disc.circle],
            splines: [],
            texts: [],
          },
        },
        {
          ...(f3d.features[1] as F3dExtrude),
          id: 4,
          name: 'Extrude2',
          start: 'face',
          profiles: [{ id: 33, sketch: 6, regions: [region([[301n]])] }],
          ...extrude,
        },
      );
      return f3d;
    }
    /** A face of the ring (made by Extrude1, record 2) on the plane z (cm); a start plane with no tags when `datum`. */
    const plane = (z: number, nz: number, datum = false) => ({
      tags: datum ? [] : [{ token: nz > 0 ? '2' : '1', designs: [2] }],
      ...(datum ? {} : { feature: 2 }),
      surface: { kind: 'plane', point: [0, 0, z], normal: [0, 0, nz] } as AsmSurface,
    });
    const SLANTED = [
      1,
      0,
      0,
      0,
      0,
      Math.sqrt(3) / 2,
      0.5,
      -0.6235,
      0,
      -0.5,
      Math.sqrt(3) / 2,
      -1,
      0,
      0,
      0,
      1,
    ];
    const FROM_PLANE = 'Extrude2: starts from a face; imported from the profile plane.';

    it("moves the start by its offset along the face's normal, which may face the other way", async () => {
      // The ring's bottom (normal −z) with an offset of −1 mm: the start is 1 mm up.
      const f3d = withDisc([...IDENTITY], {
        parameters: [
          parameter({ name: 'd5', kind: 'ProfileOffset', value: -0.1 }),
          parameter({ name: 'd6', kind: 'AlongDistance', value: 0.2 }),
        ],
        faces: [plane(0, -1)],
      });
      const [, disc] = await measures(f3d);
      expect(disc?.bbox.min[2]).toBeCloseTo(1, 2);
      expect(disc?.bbox.max[2]).toBeCloseTo(3, 2);
    });

    it('cuts from a face slanted to its sketch down to that face moved by the distance', async () => {
      // Sketch normal (0, ½, √3/2), drawn below the ring; the cut starts on the
      // ring's top (z 0.8 mm) and runs 0.5 mm along the normal into it.
      const c = Math.sqrt(3) / 2;
      const f3d = withDisc([1, 0, 0, 0, 0, c, 0.5, -0.6235, 0, -0.5, c, -1, 0, 0, 0, 1], {
        operation: 'cut',
        parameters: [parameter({ name: 'd5', kind: 'AlongDistance', value: -0.05 })],
        faces: [plane(0.08, 1)],
      });
      const { report } = f3dToDesign(f3d, 'Washer');
      expect(report.notes).toContain(
        'Extrude2: starts from a face slanted to its sketch; cut from beyond the face to its plane moved by the distance.',
      );
      // An oblique prism: its volume is the profile's area times its length.
      expect(await volumes(f3d)).toEqual([expect.closeTo(RING - Math.PI * 0.5, 3)]);
    });

    it('moves the start from a start plane by its offset along the sketch normal', async () => {
      // An origin or construction plane at z = 0 whose stored axes face −z: no outside to go by.
      const f3d = withDisc([...IDENTITY], {
        parameters: [
          parameter({ name: 'd5', kind: 'ProfileOffset', value: -0.1 }),
          parameter({ name: 'd6', kind: 'AlongDistance', value: 0.2 }),
        ],
        faces: [plane(0, -1, true)],
      });
      const [, disc] = await measures(f3d);
      expect(disc?.bbox.min[2]).toBeCloseTo(-1, 2);
      expect(disc?.bbox.max[2]).toBeCloseTo(1, 2);
    });

    it('keeps the profile plane for a slanted join, a curved start face or a slanted start plane', () => {
      const slanted = (extrude: Partial<F3dExtrude>) => {
        const { design, report } = f3dToDesign(
          withDisc(SLANTED, {
            operation: 'cut',
            parameters: [parameter({ name: 'd5', kind: 'AlongDistance', value: -0.05 })],
            faces: [plane(0.08, 1)],
            ...extrude,
          }),
          'Washer',
        );
        return { notes: report.notes, names: design.toJSON().features.map((f) => f.name) };
      };
      const cone: AsmSurface = {
        kind: 'cone',
        center: [0, 0, 0],
        axis: [0, 0, 1],
        radius: 0.55,
        cylinder: true,
        slope: 0,
      };
      for (const case_ of [
        slanted({ operation: 'join' }),
        slanted({ faces: [{ ...plane(0.08, 1), surface: cone }] }),
        slanted({ faces: [plane(0.08, 1, true)] }),
      ]) {
        expect(case_.notes).toContain(FROM_PLANE);
        // No plane made for a stop it doesn't use.
        expect(case_.names).not.toContain('Extrude2 start face plane');
      }
      expect(slanted({}).names).toContain('Extrude2 start face plane');
    });

    it("keeps the file sign of side 1's up-to offset in a two-sided extrude from a face", () => {
      // The negation was measured on one-sided extrudes only; no two-sided one starts from a face.
      const { design } = f3dToDesign(
        withDisc([...IDENTITY], {
          direction: 'two-sides',
          parameters: [
            parameter({ name: 'd5', kind: 'ProfileOffset', value: 0 }),
            parameter({ name: 'd6', kind: 'Side1Offset', value: 0.1 }),
            parameter({ name: 'd7', kind: 'AgainstDistance', value: 0.1 }),
          ],
          faces: [plane(0, -1), plane(0.08, 1)],
        }),
        'Washer',
      );
      const e2 = design.toJSON().features.find((f) => f.name === 'Extrude2');
      expect(e2?.inputs.extent).toMatchObject({ value: 'to-object' });
      expect(e2?.inputs.offset).toMatchObject({ expr: '1 mm' });
    });

    it('ends short of the face it goes up to by a positive offset when it starts from a face', async () => {
      const f3d = withDisc([...IDENTITY], {
        parameters: [
          parameter({ name: 'd5', kind: 'ProfileOffset', value: 0 }),
          parameter({ name: 'd6', kind: 'Side1Offset', value: 0.1 }),
        ],
        // From the ring's top, up to a plane 5 mm up, 1 mm short of it.
        faces: [plane(0.08, 1), plane(0.5, 1)],
      });
      const [, disc] = await measures(f3d);
      expect(disc?.bbox.min[2]).toBeCloseTo(0.8, 2);
      expect(disc?.bbox.max[2]).toBeCloseTo(4, 2);
    });
  });
});
