// Create Sketch's pick of a flat face or an origin plane (P2-09).
import {
  type BodyId,
  type FeatureId,
  faceSketchFrame,
  fingerprintFrame,
  type SketchFrame,
} from '@extrudo/core';
import type { BodyMesh } from '@extrudo/kernel';
import { describe, expect, it } from 'vitest';
import type { PickScene } from '../selection/pick';
import { boxMesh, cameraFrom, topViewPx } from '../selection/testing';
import { isFlatFace, originPlaneAt, sketchTargetAt } from './facePick';
import { sketchFrame } from './frame';

const B = 'b' as BodyId;

/** A mesh with one face made of two triangles that don't lie in one plane. */
function bentFace(): BodyMesh {
  const mesh = boxMesh();
  const positions = new Float32Array(mesh.positions);
  // Lift one corner of the top face (face 1, nodes 4..7) out of its plane.
  positions[3 * 6 + 2] = 14;
  return { ...mesh, positions };
}

describe('sketchTargetAt', () => {
  it('takes a flat face in front of the origin planes', () => {
    const scene: PickScene = {
      bodies: [{ id: B, mesh: boxMesh([20, 20, 0], [40, 40, 10]) }],
      sketches: [],
      occluding: true,
    };
    const top = cameraFrom([0, 0, 1], { target: [0, 0, 0], size: 200 });
    expect(sketchTargetAt(scene, top, topViewPx(top, 30, 30))).toEqual({
      kind: 'face',
      item: { kind: 'face', id: 'b:1' },
    });
    // Near the origin there is no face: the XY plane is under the pointer.
    expect(sketchTargetAt(scene, top, topViewPx(top, 5, 5))).toEqual({
      kind: 'plane',
      plane: 'origin:xy',
    });
    // Outside the planes' squares, nothing.
    expect(sketchTargetAt(scene, top, topViewPx(top, -80, -80))).toBeUndefined();
  });

  it('takes the plane when it lies in front of the face', () => {
    // A box below the XY plane, seen from above: the XY plane's square covers its top.
    const scene: PickScene = {
      bodies: [{ id: B, mesh: boxMesh([-5, -5, -20], [5, 5, -10]) }],
      sketches: [],
      occluding: true,
    };
    const top = cameraFrom([0, 0, 1], { size: 200 });
    expect(sketchTargetAt(scene, top, topViewPx(top, 0, 0))).toEqual({
      kind: 'plane',
      plane: 'origin:xy',
    });
    expect(originPlaneAt(top, topViewPx(top, 0, 0))?.plane).toBe('origin:xy');
  });

  it('leaves curved faces out', () => {
    const mesh = bentFace();
    expect(isFlatFace(mesh, 1)).toBe(false);
    expect(isFlatFace(mesh, 0)).toBe(true);
    const scene: PickScene = { bodies: [{ id: B, mesh }], sketches: [], occluding: true };
    const top = cameraFrom([0, 0, 1], { target: [60, 60, 0], size: 40 });
    expect(sketchTargetAt(scene, top, topViewPx(top, 60, 60))).toBeUndefined();
  });
});

describe('sketchFrame', () => {
  const face = {
    kind: 'face' as const,
    id: 'extrude:E:cap:end',
    fingerprint: {
      type: 'plane',
      at: [1, 2, 15] as [number, number, number],
      dir: [0, 0, 1] as [number, number, number],
    },
  };
  it('takes the kernel frame of a face, else its fingerprint', () => {
    const F = 'f' as FeatureId;
    expect(sketchFrame(F, face, {})).toEqual(fingerprintFrame(face));
    const moved: SketchFrame = faceSketchFrame([0, 0, 25], [0, 0, 1]);
    expect(sketchFrame(F, face, { [F]: { frame: moved } })?.origin).toEqual([0, 0, 25]);
    expect(sketchFrame(F, { kind: 'plane', id: 'origin:xz' }, {})?.normal).toEqual([0, -1, 0]);
  });
});

describe('construction planes (P3-05)', () => {
  const frame = faceSketchFrame([0, 0, 25], [0, 0, 1]);
  const scene: PickScene = {
    bodies: [],
    sketches: [],
    occluding: true,
    planes: [{ id: 'OP', frame, anchor: [60, 60, 25], half: 20 }],
  };
  const top = cameraFrom([0, 0, 1], { size: 200 });

  it('are offered beside the origin planes, around their anchors', () => {
    expect(sketchTargetAt(scene, top, topViewPx(top, 60, 60))).toEqual({
      kind: 'plane',
      plane: 'OP',
    });
    expect(sketchTargetAt(scene, top, topViewPx(top, 5, 5))).toEqual({
      kind: 'plane',
      plane: 'origin:xy',
    });
    expect(sketchTargetAt(scene, top, topViewPx(top, 90, 60))).toBeUndefined();
  });

  it('the nearer plane wins where squares overlap', () => {
    // From above, the plane at z = 25 is nearer than the XY plane under it.
    const over = [{ id: 'OP', frame, anchor: [0, 0, 25] as const, half: 20 }];
    expect(originPlaneAt(top, topViewPx(top, 5, 5), over)).toMatchObject({ plane: 'OP' });
  });

  it('give a sketch their frame once the kernel has reported it', () => {
    const F = 'f' as FeatureId;
    const plane = { kind: 'plane' as const, id: 'OP' };
    expect(sketchFrame(F, plane, {})).toBeUndefined();
    const reports = { OP: { kind: 'plane', frame, anchor: [0, 0, 25] } } as never;
    expect(sketchFrame(F, plane, {}, reports)?.origin).toEqual([0, 0, 25]);
  });
});
