/**
 * The body links (`ImportResult.bodies`) and the writer's `record`/`component`
 * fields. Synthetic designs only; no real file.
 */
import { describe, expect, it } from 'vitest';
import { bodiesStep } from './brep-step';
import { f3dToDesign } from './map';
import type { F3dExtrude, F3dFeature, F3dSketchFeature } from './model';
import { type F3dDesign, IDENTITY } from './model';

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

function washer(): F3dDesign {
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
      frame: IDENTITY,
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
    parameters: [],
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
            outer: [[101n]],
            inner: [[102n]],
            outerPieces: [[{ tag: 101n, secondary: 0n, piece: 1, of: 1 }]],
            innerPieces: [[{ tag: 102n, secondary: 0n, piece: 1, of: 1 }]],
          },
        ],
      },
    ],
    faces: [],
    participants: [],
  };
  return {
    parameters: [],
    userParameters: [],
    features: [sketch, extrude] as F3dFeature[],
    bodies: [],
    problems: [],
    unreadParameters: 0,
  };
}

describe('body links', () => {
  it('links a body to the replayed body its creator made (hint)', () => {
    const f3d = washer();
    f3d.bodies.push({ id: 50, index: 3, visible: true, creator: 2 });
    const { design, bodies } = f3dToDesign(f3d, 'Washer');
    const made = design.toJSON().features.find((f) => f.name === 'Extrude1');
    expect(bodies).toEqual([{ record: 50, name: 'Body3', hint: `${made?.id}:0` }]);
  });

  it('leaves out hidden bodies, and hints nothing the replay does not know', () => {
    const f3d = washer();
    f3d.bodies.push({ id: 51, index: 4, visible: false, creator: 2 });
    f3d.bodies.push({ id: 52, index: 5, visible: true, creator: 999 });
    const { bodies } = f3dToDesign(f3d, 'Washer');
    expect(bodies).toEqual([{ record: 52, name: 'Body5' }]);
  });
});

describe('BodyStep fields', () => {
  it('fills record, name and component even without a stream', () => {
    const f3d = washer();
    f3d.bodies.push({ id: 50, index: 3, visible: true, creator: 2, component: 7 });
    const steps = bodiesStep(new Map(), f3d);
    expect(steps).toEqual([
      {
        record: 50,
        name: 'Body3',
        component: 7,
        reason: 'no B-rep stream for this body',
      },
    ]);
  });
});
