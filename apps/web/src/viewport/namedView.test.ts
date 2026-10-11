import { describe, expect, it } from 'vitest';
import { orientationFor, type Projection, type Quat, type View } from './camera';
import { cameraToView, viewToCamera } from './namedView';

const view: View = {
  target: [12.5, -30.25, 7.125],
  orientation: orientationFor([1, -1, 1]),
  size: 130,
};

/** Checks the saved-then-restored view against the original, within 1e-6. */
function expectRestored(view: View, projection: Projection) {
  const camera = viewToCamera(view, projection);
  const back = cameraToView(camera);
  for (const [a, b] of [
    [view.target, back.target],
    [view.orientation, back.orientation],
  ] as const) {
    expect(a).toHaveLength(b.length);
    a.forEach((c, i) => {
      expect(b[i]).toBeCloseTo(c, 6);
    });
  }
  expect(back.size).toBeCloseTo(view.size, 6);
  return camera;
}

describe('viewToCamera / cameraToView', () => {
  it('round trips a perspective view exactly', () => {
    const camera = expectRestored(view, 'perspective');
    expect(camera.projection).toBe('perspective');
    // The camera's own point, `perspectiveDistance` behind the target.
    expect(camera.position[0]).toBeGreaterThan(view.target[0]);
    // No stored size: the position's distance from the target fixes it.
    expect(camera).not.toHaveProperty('size');
  });

  it('round trips an orthographic view, which stores its size', () => {
    const camera = expectRestored({ ...view, size: 47.5 }, 'orthographic');
    expect(camera.projection).toBe('orthographic');
    expect(camera.size).toBeCloseTo(47.5, 6);
    // The orthographic camera sits far back; the size says how tall the view is.
    expect(
      Math.hypot(
        camera.position[0] - view.target[0],
        camera.position[1] - view.target[1],
        camera.position[2] - view.target[2],
      ),
    ).toBeGreaterThanOrEqual(1000);
  });

  it('round trips a straight-down view (whose up is not world Z)', () => {
    expectRestored({ ...view, orientation: orientationFor([0, 0, 1]) }, 'perspective');
    expectRestored({ ...view, orientation: orientationFor([0, 0, -1]) }, 'orthographic');
  });

  it('a saved orthographic view restores with the saved size, not the distance its position implies', () => {
    // The position alone would give a size far below the real one; the stored
    // `size` wins (this is why orthographic views carry it).
    const camera = viewToCamera({ ...view, size: 40 }, 'orthographic');
    expect(camera.size).toBe(40);
    expect(cameraToView(camera).size).toBeCloseTo(40, 6);
  });

  it('keeps the orientation a quaternion of unit length', () => {
    const back = cameraToView(viewToCamera(view, 'perspective'));
    const [x = 0, y = 0, z = 0, w = 1] = back.orientation as Quat;
    expect(Math.hypot(x, y, z, w)).toBeCloseTo(1, 6);
  });
});
