/**
 * The in-app renderer's camera (ADR-0101 §6.3): a `ViewCamera` in millimetres
 * to a three.js camera, or the automatic one along the home direction, the
 * same maths as `render.py`'s `setup_camera` and `fit_distance` so both
 * engines frame the same picture. The render scene is Z up.
 */
import type { ViewCamera } from '@extrudo/core';
import { MathUtils, OrthographicCamera, PerspectiveCamera, Vector3 } from 'three';
import type { Placement } from './scenes';

/** The vertical field of view of a perspective camera, as Blender's (degrees). */
export const FOV_Y = 35;
/** Extrudo's home direction, from the model towards the camera. */
export const HOME_DIRECTION = new Vector3(1, -1, 1).normalize();
const Z_UP = new Vector3(0, 0, 1);

/**
 * How far back along `direction` the camera sits so every corner of the box
 * (centre ± extent) is inside the view with a 10% margin (`fit_distance`).
 */
export function fitDistance(extent: Vector3, direction: Vector3, aspect: number): number {
  const forward = direction.clone().negate();
  const right = forward.clone().cross(Z_UP).normalize();
  const up = right.clone().cross(forward);
  const tanY = Math.tan(MathUtils.degToRad(FOV_Y) / 2);
  const tanX = aspect * tanY;
  let distance = 0;
  const q = new Vector3();
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      for (const sz of [-1, 1]) {
        q.set(sx * extent.x, sy * extent.y, sz * extent.z);
        const need =
          Math.max(Math.abs(q.dot(right)) / tanX, Math.abs(q.dot(up)) / tanY) * 1.1 +
          q.dot(direction);
        distance = Math.max(distance, need);
      }
    }
  }
  return Math.max(distance, 1e-3);
}

/**
 * The camera of the picture. A view's camera is in the design's millimetres, so
 * it moves with the model (`placement.offset`); orthographic `size` is the frame
 * height (Blender's vertical `ortho_scale`). Near and far come from the box and
 * the scene's size.
 */
export function viewToThreeCamera(
  view: ViewCamera | undefined,
  placement: Placement,
  aspect: number,
): PerspectiveCamera | OrthographicCamera {
  const { offset, centre, radius, extent, s } = placement;
  const near = Math.max(radius / 100, 0.01);
  // The farthest thing worth drawing: the outdoor ground's corner (400·s wide) from far off.
  const far = 1000 * s + radius * 100;
  let camera: PerspectiveCamera | OrthographicCamera;
  if (view?.projection === 'orthographic') {
    const height = view.size ?? 2 * radius;
    const half = height / 2;
    camera = new OrthographicCamera(-half * aspect, half * aspect, half, -half, near, far);
  } else {
    camera = new PerspectiveCamera(FOV_Y, aspect, near, far);
  }
  if (view) {
    const position = new Vector3(...view.position).add(offset);
    const target = new Vector3(...view.target).add(offset);
    camera.up.set(...view.up).normalize();
    camera.position.copy(position);
    camera.lookAt(target);
  } else {
    const distance = fitDistance(extent, HOME_DIRECTION, aspect);
    camera.up.copy(Z_UP);
    camera.position.copy(centre).addScaledVector(HOME_DIRECTION, distance);
    camera.lookAt(centre);
  }
  camera.updateMatrixWorld();
  camera.updateProjectionMatrix();
  return camera;
}
