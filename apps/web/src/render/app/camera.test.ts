/** The in-app renderer's camera (ADR-0101 §6.3): `fit_distance`'s framing and a view's camera moved with the model. */
import { OrthographicCamera, PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { FOV_Y, fitDistance, HOME_DIRECTION, viewToThreeCamera } from './camera';
import type { Placement } from './scenes';

const cube: Placement = {
  offset: new Vector3(-5, 5, 0),
  centre: new Vector3(0, 0, 50),
  radius: Math.sqrt(3) * 50,
  size: 100,
  extent: new Vector3(50, 50, 50),
  s: 100,
};

describe('fitDistance', () => {
  it("is the script's distance for a 100 mm cube at 16:9", () => {
    // By hand: the corner (50, -50, 50)·home = 50√3 adds to its farthest projection.
    const d = fitDistance(cube.extent, HOME_DIRECTION, 16 / 9);
    const tanY = Math.tan(((FOV_Y / 2) * Math.PI) / 180);
    const forward = HOME_DIRECTION.clone().negate();
    const right = forward
      .clone()
      .cross(new Vector3(0, 0, 1))
      .normalize();
    const up = right.clone().cross(forward);
    let expected = 0;
    for (const sx of [-1, 1])
      for (const sy of [-1, 1])
        for (const sz of [-1, 1]) {
          const q = new Vector3(50 * sx, 50 * sy, 50 * sz);
          expected = Math.max(
            expected,
            Math.max(Math.abs(q.dot(right)) / ((16 / 9) * tanY), Math.abs(q.dot(up)) / tanY) * 1.1 +
              q.dot(HOME_DIRECTION),
          );
        }
    expect(d).toBeCloseTo(expected, 6);
    expect(d).toBeGreaterThan(250);
    expect(d).toBeLessThan(400);
    // A taller picture needs more room for the box's width.
    expect(fitDistance(cube.extent, HOME_DIRECTION, 9 / 16)).toBeGreaterThan(d);
  });
});

describe('viewToThreeCamera', () => {
  it('frames the box along the home direction without a view, Z up', () => {
    const camera = viewToThreeCamera(undefined, cube, 16 / 9) as PerspectiveCamera;
    expect(camera).toBeInstanceOf(PerspectiveCamera);
    expect(camera.fov).toBe(35);
    const d = fitDistance(cube.extent, HOME_DIRECTION, 16 / 9);
    const expected = cube.centre.clone().addScaledVector(HOME_DIRECTION, d);
    expect(camera.position.distanceTo(expected)).toBeLessThan(1e-9);
    expect(camera.up.toArray()).toEqual([0, 0, 1]);
    const look = camera.getWorldDirection(new Vector3());
    expect(look.dot(HOME_DIRECTION)).toBeCloseTo(-1, 6);
    expect(camera.near).toBeGreaterThan(0);
    expect(camera.far).toBeGreaterThan(400 * cube.s);
  });

  it("places a view's camera in the design's millimetres, moved with the model", () => {
    const camera = viewToThreeCamera(
      { projection: 'perspective', position: [100, 0, 50], target: [0, 0, 50], up: [0, 0, 1] },
      cube,
      1,
    );
    expect(camera.position.toArray()).toEqual([95, 5, 50]);
    expect(camera.getWorldDirection(new Vector3()).x).toBeCloseTo(-1, 6);
  });

  it("takes an orthographic view's size as the frame height", () => {
    const camera = viewToThreeCamera(
      {
        projection: 'orthographic',
        position: [0, -200, 0],
        target: [0, 0, 0],
        up: [0, 0, 1],
        size: 80,
      },
      cube,
      2,
    ) as OrthographicCamera;
    expect(camera).toBeInstanceOf(OrthographicCamera);
    expect(camera.top - camera.bottom).toBe(80);
    expect(camera.right - camera.left).toBe(160);
  });
});
