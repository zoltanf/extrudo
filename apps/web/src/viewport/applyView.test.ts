import { OrthographicCamera, PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { applyView } from './applyView';
import { FOV, homeView, type View, viewProject, viewRay, withShift } from './camera';

describe('applyView', () => {
  // What three.js draws must be where picking (`viewRay`, `viewProject`) looks, also
  // when a fit shifted the target to the side of a floating panel.
  for (const shift of [0, 0.3]) {
    for (const projection of ['perspective', 'orthographic'] as const) {
      it(`draws where viewProject says (${projection}, shift ${shift})`, () => {
        const view: View = withShift({ ...homeView(), size: 80 }, shift);
        const aspect = 1.6;
        const camera =
          projection === 'perspective'
            ? new PerspectiveCamera(FOV, 1, 0.1, 1000)
            : new OrthographicCamera(-1, 1, 1, -1, 0.1, 1000);
        applyView(camera, view, projection, aspect);
        for (const point of [
          [0, 0, 0],
          [30, -10, 5],
          [-25, 40, -12],
        ] as const) {
          const drawn = new Vector3(...point).project(camera);
          const picked = viewProject(view, projection, aspect, point) ?? [Number.NaN, 0];
          expect(drawn.x).toBeCloseTo(picked[0], 9);
          expect(drawn.y).toBeCloseTo(picked[1], 9);
          // …and the pick ray through that point of the view passes through it.
          const ray = viewRay(view, projection, aspect, picked);
          const off = new Vector3(...point).sub(ray.origin);
          const along = off.dot(ray.direction);
          expect(off.addScaledVector(ray.direction, -along).length()).toBeLessThan(1e-6);
        }
        // The target shows `shift` right of the middle.
        expect(new Vector3(...view.target).project(camera).x).toBeCloseTo(shift, 9);
      });
    }
  }
});
