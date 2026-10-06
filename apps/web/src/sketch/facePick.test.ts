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
    const face = sketchTargetAt(scene, top, topViewPx(top, 30, 30));
    expect(face).toMatchObject({ kind: 'face', item: { kind: 'face', id: 'b:1' } });
    // Where the click met the face (P3-04): its point in the world.
    expect(face?.at.map((v) => Math.round(v * 100) / 100)).toEqual([30, 30, 10]);
    // Near the origin there is no face: the XY plane is under the pointer.
    const plane = sketchTargetAt(scene, top, topViewPx(top, 5, 5));
    expect(plane).toMatchObject({ kind: 'plane', plane: 'origin:xy' });
    expect(plane?.at.map((v) => Math.round(v * 100) / 100)).toEqual([5, 5, 0]);
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
    expect(sketchTargetAt(scene, top, topViewPx(top, 0, 0))).toMatchObject({
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
    // Over the bent top face: not a target, so the XY plane under it is; a
    // dialog's To object takes the curved face itself (P4-12).
    const over = cameraFrom([0, 0, 1], { target: [5, 5, 0], size: 40 });
    expect(sketchTargetAt(scene, over, topViewPx(over, 6, 6))).toMatchObject({ kind: 'plane' });
    expect(sketchTargetAt(scene, over, topViewPx(over, 6, 6), true)).toMatchObject({
      kind: 'face',
      item: { kind: 'face', id: 'b:1' },
    });
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
    expect(sketchTargetAt(scene, top, topViewPx(top, 60, 60))).toMatchObject({
      kind: 'plane',
      plane: 'OP',
    });
    expect(sketchTargetAt(scene, top, topViewPx(top, 5, 5))).toMatchObject({
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

describe('where a click meets a face (P3-04)', () => {
  it('is on the face in a perspective view too', () => {
    const scene: PickScene = {
      bodies: [{ id: B, mesh: boxMesh([-20, -20, 0], [20, 20, 20]) }],
      sketches: [],
      occluding: true,
    };
    const home = cameraFrom([1, -1, 1], {
      target: [0, 0, 20],
      size: 80,
      projection: 'perspective',
    });
    const target = sketchTargetAt(scene, home, [home.width / 2, home.height / 2]);
    expect(target).toMatchObject({ kind: 'face' });
    expect(target?.at.map((v) => Math.round(v * 100) / 100)).toEqual([0, 0, 20]);
    const off = sketchTargetAt(scene, home, [home.width / 2 + 40, home.height / 2 + 20]);
    expect(off?.kind).toBe('face');
    expect(off?.at[2]).toBeCloseTo(20, 3);
  });
});
