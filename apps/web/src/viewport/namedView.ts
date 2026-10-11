/**
 * Saving and restoring named views (ADR-0008's amendment, 2026-10-10): the
 * live camera as the document's `ViewCamera`, and one back. Pure functions
 * over `View` (target + quaternion + size), so they run in Node tests.
 *
 * A perspective camera sits `perspectiveDistance(view.size)` from the target,
 * so `position` and `target` fix the size; an orthographic camera sits at a
 * distance that depends on the zoom, so its view carries `size` in the
 * document. Restoring is exact in both projections (within 1e-6).
 */

import type { ViewCamera } from '@extrudo/core';
import { Matrix4, Quaternion, Vector3 } from 'three';
import { basis, cameraPosition, FOV, type Projection, type Quat, type View } from './camera';

const v3 = (v: readonly number[]) => new Vector3(v[0], v[1], v[2]);

/** The viewport's live view as the document's `NamedView.camera`. */
export function viewToCamera(view: View, projection: Projection): ViewCamera {
  const position = cameraPosition(view, projection);
  const up = basis(view).up;
  const camera: ViewCamera = {
    projection,
    position: [position.x, position.y, position.z],
    target: [...view.target],
    up: [up.x, up.y, up.z],
  };
  if (projection === 'orthographic') camera.size = view.size;
  return camera;
}

/**
 * A saved camera as the viewport's `View`: the orientation from the saved
 * position's direction and up, and the size from the position's distance
 * (perspective) or the stored `size` (orthographic). The viewport animates to
 * it through the store's `animateTo`; this is view state, never a command.
 */
export function cameraToView(camera: ViewCamera): View {
  const position = v3(camera.position);
  const target = v3(camera.target);
  const back = position.sub(target);
  const distance = back.length();
  const m = new Matrix4().lookAt(back, new Vector3(), v3(camera.up));
  const orientation = new Quaternion().setFromRotationMatrix(m);
  const half = (FOV / 2) * (Math.PI / 180);
  return {
    target: [...camera.target],
    orientation: [orientation.x, orientation.y, orientation.z, orientation.w] as Quat,
    size: camera.projection === 'perspective' ? distance * 2 * Math.tan(half) : (camera.size ?? 1),
  };
}
