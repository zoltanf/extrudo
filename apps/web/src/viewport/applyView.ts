/**
 * Sets a three.js camera from a view (`CameraRig` does every frame). Kept
 * apart from the R3F component so node tests can check that what is drawn
 * matches `viewRay`/`viewProject`, which picking uses.
 */
import { type OrthographicCamera, PerspectiveCamera, Quaternion } from 'three';
import {
  cameraPosition,
  orthographicDistance,
  type Projection,
  perspectiveDistance,
  shiftOf,
  type View,
} from './camera';

const q = new Quaternion();

/** Sets a camera's pose and frustum from a view. */
export function applyView(
  camera: PerspectiveCamera | OrthographicCamera,
  view: View,
  projection: Projection,
  aspect: number,
): void {
  camera.position.copy(cameraPosition(view, projection));
  camera.quaternion.copy(q.set(...view.orientation));
  if (camera instanceof PerspectiveCamera) {
    const distance = perspectiveDistance(view.size);
    camera.aspect = aspect;
    camera.near = distance / 100;
    camera.far = distance * 100;
  } else {
    const half = view.size / 2;
    camera.left = -half * aspect;
    camera.right = half * aspect;
    camera.top = half;
    camera.bottom = -half;
    camera.near = 0;
    camera.far = orthographicDistance(view) * 2;
  }
  // The target shows `shift` NDC right of the middle: the frustum slides the other way.
  // (`setViewOffset` also sets a perspective camera's aspect to full width / height.)
  const shift = shiftOf(view);
  if (shift === 0) camera.clearViewOffset();
  else camera.setViewOffset(aspect, 1, (-shift * aspect) / 2, 0, aspect, 1);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
}
