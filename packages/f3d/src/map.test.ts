/**
 * The mapper on hand-built decoded designs: what `readF3d` gives for a
 * washer (one sketch of two circles, one extrude of the ring between them)
 * turns into an Extrudo design that builds the same solid. Real files stay
 * out of the repository; `corpus.test.ts` reads a folder of them.
 */
import { Kernel } from '@extrudo/kernel';
import { kernelFeatures, loadOcct, RecomputeEngine } from '@extrudo/kernel/node';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ParameterValue } from './decode/parameters';
import { f3dToDesign } from './map';
import { type F3dDesign, type F3dExtrude, type F3dSketchFeature, IDENTITY } from './model';

let kernel: Kernel;

beforeAll(async () => {
  kernel = new Kernel(await loadOcct());
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
  };
  return {
    parameters: [],
    userParameters: [parameter({ name: 'thick', expression: '0.8 mm', user: true, value: 0.08 })],
    features: [sketch, extrude],
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
    return result.bodies.flatMap((body) => {
      const shape = engine.latestBody(body.id);
      return shape ? [kernel.measure(shape).volume] : [];
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
    const tilted = [...IDENTITY];
    tilted[6] = Math.SQRT1_2; // normal (0, √½, √½)
    tilted[10] = Math.SQRT1_2;
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
      { name: 'Sketch2', kind: 'Sketch', reason: 'its plane is not parallel to an origin plane' },
    ]);
  });
});
