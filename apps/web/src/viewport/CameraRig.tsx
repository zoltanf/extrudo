import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo } from 'react';
import { OrthographicCamera, PerspectiveCamera } from 'three';
import { applyView } from './applyView';
import { FOV, type Projection } from './camera';
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
