import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo } from 'react';
import { OrthographicCamera, PerspectiveCamera, Quaternion } from 'three';
import {
  cameraPosition,
  FOV,
  orthographicDistance,
  type Projection,
  perspectiveDistance,
  type View,
} from './camera';
import type { ViewportStore } from './store';

/**
 * Drives the three.js camera from the viewport store. It owns a perspective
 * and an orthographic camera and makes the chosen one R3F's default; both are
 * `manual`, so R3F leaves their frustum alone and every frame sets it from
 * the view. The store is the only camera state.
 */
export function CameraRig({ store, projection }: { store: ViewportStore; projection: Projection }) {
  const set = useThree((s) => s.set);
  const invalidate = useThree((s) => s.invalidate);
  const cameras = useMemo(() => {
    const perspective = new PerspectiveCamera(FOV, 1, 0.1, 1000);
    const orthographic = new OrthographicCamera(-1, 1, 1, -1, 0.1, 1000);
    for (const c of [perspective, orthographic]) Object.assign(c, { manual: true });
    return { perspective, orthographic };
  }, []);

  useLayoutEffect(() => {
    set({ camera: cameras[projection] });
    invalidate();
  }, [cameras, projection, set, invalidate]);

  // Redraw on every store change (drags, animations, settings).
  useEffect(() => store.subscribe(() => invalidate()), [store, invalidate]);

  const { width, height } = useThree((s) => s.size);
  const aspect = height > 0 ? width / height : 1;

  useFrame(() => {
    const s = store.getState();
    s.step(performance.now());
    const { view, transition } = store.getState();
    applyView(cameras[projection], view, projection, aspect);
    if (transition) invalidate();
  }, -1);

  return null;
}

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
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
}
