/**
 * Elliptical arcs on a hand-built decoded sketch: drawn as exact conics, they
 * close a profile with the file's other curves and extrude to the exact solid.
 */
import type { SketchData } from '@extrudo/core';
import { Kernel } from '@extrudo/kernel';
import { kernelFeatures, loadOcct, RecomputeEngine } from '@extrudo/kernel/node';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SketchEllipse, SketchLine, SketchPoint } from './decode/sketch-geometry';
import { f3dToDesign } from './map';
import { type F3dDesign, type F3dExtrude, type F3dSketchFeature, IDENTITY } from './model';

let kernel: Kernel;
beforeAll(async () => {
  kernel = new Kernel(await loadOcct());
});
afterAll(() => kernel.dispose());

const point = (id: number, u: number, v: number): SketchPoint => ({
  id,
  at: [u, v, 0],
  incidence: 0,
});

/**
 * Half an ellipse (a = 2 cm along x, b = 1 cm along y, centre at the origin)
 * from (2, 0) round to (−2, 0), closed by the line back along the x axis;
 * extruded 1 cm. `sweep` other than π leaves the ends where the arc ends.
 */
function halfEllipse(): F3dDesign {
  const [c, s, e] = [point(1, 0, 0), point(2, 2, 0), point(3, -2, 0)];
  const arc: SketchEllipse = {
    id: 10,
    tag: 110n,
    center: [0, 0, 0],
    major: [1, 0, 0],
    minor: [0, 1, 0],
    majorRadius: 2,
    minorRadius: 1,
    startAngle: 0,
    endAngle: Math.PI,
    centerPoint: 1,
    startPoint: 2,
    endPoint: 3,
  };
  const line: SketchLine = {
    id: 11,
    tag: 111n,
    start: e.at,
    end: s.at,
    startPoint: 3,
    endPoint: 2,
    construction: false,
  };
  const sketch: F3dSketchFeature = {
    type: 'sketch',
    id: 1,
    kind: 'Sketch',
    name: 'Sketch1',
    suppressed: false,
    parameters: [],
    sketch: {
      id: 5,
      frame: IDENTITY,
      points: [c, s, e],
      lines: [line],
      circulars: [],
      splines: [],
      texts: [],
      ellipses: [arc],
    },
  };
  const pieces = [110n, 111n].map((tag) => ({ tag, secondary: 0n, piece: 1, of: 1 }));
  const extrude: F3dExtrude = {
    type: 'extrude',
    id: 2,
    kind: 'Extrude',
    name: 'Extrude1',
    suppressed: false,
    parameters: [
      {
        id: 0,
        number: 1,
        name: 'd1',
        expression: '10 mm',
        kind: 'AlongDistance',
        comment: '',
        user: false,
        unit: 'mm',
        value: 1,
      },
    ],
    operation: 'new-body',
    direction: 'one-side',
    reversed: false,
    solid: true,
    start: 'profile-plane',
    profiles: [
      {
        id: 30,
        sketch: 5,
        regions: [{ outer: [[110n, 111n]], inner: [], outerPieces: [pieces], innerPieces: [] }],
      },
    ],
    faces: [],
    participants: [],
  };
  return {
    parameters: [],
    userParameters: [],
    features: [sketch, extrude],
    bodies: [],
    problems: [],
  };
}

describe('elliptical arcs', () => {
  it('draws an arc as conics of at most a quarter turn, ending on the file points', () => {
    const { design } = f3dToDesign(halfEllipse(), 'Half');
    const sketch = design.toJSON().features.find((f) => f.type === 'sketch');
    if (!sketch) throw new Error('No sketch.');
    const data = (sketch.inputs.sketch as { sketch: SketchData }).sketch;
    const conics = Object.values(data.entities).filter((e) => e.type === 'spline');
    expect(conics).toHaveLength(2);
    for (const c of conics)
      expect(c).toMatchObject({
        mode: 'conic',
        rho: expect.closeTo(Math.SQRT1_2 / (1 + Math.SQRT1_2), 12),
      });
    const at = (id: string) => {
      const p = data.entities[id as keyof typeof data.entities] as { x: number; y: number };
      return [p.x, p.y];
    };
    const ends = conics
      .flatMap((c) => ('points' in c ? [c.points[0], c.points[2]] : []))
      .map((id) => at(id as string));
    expect(ends).toEqual(
      expect.arrayContaining([
        [20, 0],
        [-20, 0],
        expect.arrayContaining([expect.closeTo(0, 9), expect.closeTo(10, 9)]),
      ]),
    );
  });

  it('extrudes the half ellipse to its exact volume', async () => {
    const { design } = f3dToDesign(halfEllipse(), 'Half');
    const engine = new RecomputeEngine(kernel, kernelFeatures(), { strictLeaks: true });
    try {
      const result = await engine.recompute({ doc: design.toJSON() });
      if (result.status !== 'done') throw new Error(`recompute ${result.status}`);
      expect(Object.values(result.features).filter((f) => f.status === 'error')).toEqual([]);
      const [body] = result.bodies;
      const shape = body && engine.latestBody(body.id);
      expect(shape && kernel.properties(shape).volume).toBeCloseTo((Math.PI * 20 * 10 * 10) / 2, 6);
    } finally {
      engine.clear();
    }
  });
});
