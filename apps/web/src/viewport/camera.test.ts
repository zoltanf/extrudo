import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import {
  basis,
  cameraPosition,
  cubicBezier,
  easeCamera,
  FOV,
  fitBox,
  fitSphere,
  homeView,
  interpolate,
  MIN_SIZE,
  orbit,
  orientationFor,
  pan,
  perspectiveDistance,
  rayPlane,
  sameView,
  turn,
  type Vec3,
  type View,
  viewDirection,
  viewProject,
  viewRay,
  worldPerPixel,
  zoomAt,
} from './camera';

const near = (actual: Vector3 | Vec3, expected: Vec3, digits = 6) => {
  const a = actual instanceof Vector3 ? [actual.x, actual.y, actual.z] : actual;
  a.forEach((c, i) => {
    expect(c).toBeCloseTo(expected[i] ?? Number.NaN, digits);
  });
};

const view = (direction: Vec3, size = 100, target: Vec3 = [0, 0, 0]): View => ({
  target,
  orientation: orientationFor(direction),
  size,
});

describe('orientationFor', () => {
  it.each<[string, Vec3, Vec3, Vec3]>([
    // name, direction (target → camera), expected screen right, expected screen up
    ['front', [0, -1, 0], [1, 0, 0], [0, 0, 1]],
    ['right', [1, 0, 0], [0, 1, 0], [0, 0, 1]],
    ['back', [0, 1, 0], [-1, 0, 0], [0, 0, 1]],
    ['left', [-1, 0, 0], [0, -1, 0], [0, 0, 1]],
    ['top', [0, 0, 1], [1, 0, 0], [0, 1, 0]],
    ['bottom', [0, 0, -1], [1, 0, 0], [0, -1, 0]],
  ])('%s view has the expected screen axes', (_, direction, right, up) => {
    const b = basis(view(direction));
    near(b.back, direction);
    near(b.right, right);
    near(b.up, up);
  });

  it('keeps +Z up in an oblique view', () => {
    const b = basis(view([1, -1, 1]));
    expect(b.up.z).toBeGreaterThan(0);
    expect(b.right.z).toBeCloseTo(0, 9);
  });

  it('takes a preferred up, unless it is parallel to the view direction', () => {
    const q = (direction: Vec3, up: Vec3) => ({
      target: [0, 0, 0] as Vec3,
      orientation: orientationFor(direction, up),
      size: 1,
    });
    const b = basis(q([0, 0, 1], [-1, 0, 0]));
    near(b.up, [-1, 0, 0]);
    near(b.right, [0, 1, 0]);
    // A sketch plane's normal and Y: the XZ plane seen from the front.
    near(basis(q([0, -1, 0], [0, 0, 1])).right, [1, 0, 0]);
    near(basis(q([0, 0, 1], [0, 0, 5])).up, [0, 1, 0]);
  });

  it('gives a unit quaternion', () => {
    const q = orientationFor([3, -4, 12]);
    expect(Math.hypot(...q)).toBeCloseTo(1, 12);
  });
});

describe('orbit and turn', () => {
  it('yaw turns about world Z and keeps the camera height', () => {
    const v = orbit(view([0, -1, 0]), Math.PI / 2, 0);
    // From the front, a quarter turn counter-clockwise (seen from above) lands on the right.
    near(basis(v).back, [1, 0, 0]);
    near(basis(v).up, [0, 0, 1]);
  });

  it('pitch tilts about the screen right axis', () => {
    const v = orbit(view([0, -1, 0]), 0, -Math.PI / 2);
    near(basis(v).back, [0, 0, 1]);
    near(basis(v).up, [0, 1, 0]);
  });

  it('does not move the target or change the size', () => {
    const v0 = view([1, -1, 1], 80, [5, 6, 7]);
    const v = orbit(v0, 0.3, -0.7);
    expect(v.target).toEqual(v0.target);
    expect(v.size).toBe(80);
  });

  it('rolls about the view axis', () => {
    const v = turn(view([0, 0, 1]), 'z', Math.PI / 2);
    near(basis(v).back, [0, 0, 1]);
    near(basis(v).up, [-1, 0, 0]);
  });

  it('swings to the neighbouring face about the screen up axis', () => {
    const v = turn(view([0, -1, 0]), 'y', Math.PI / 2);
    near(basis(v).back, [1, 0, 0]);
  });
});

describe('pan', () => {
  it('moves the target against the drag, one view size per viewport height', () => {
    const v = pan(view([0, -1, 0], 100), 50, 0, 500);
    // Dragging right by 1/10 of the height moves the scene right: the target moves left by 10 mm.
    near(v.target, [-10, 0, 0]);
    const w = pan(view([0, -1, 0], 100), 0, 50, 500);
    // Dragging down moves the target up (+Z in the front view).
    near(w.target, [0, 0, 10]);
  });
});

describe('zoomAt', () => {
  it('zooms about the centre without moving the target', () => {
    const v = zoomAt(view([0, 0, 1], 100, [1, 2, 3]), 0.5, [0, 0], 1.5);
    expect(v.size).toBe(50);
    near(v.target, [1, 2, 3]);
  });

  it('keeps the point under the cursor in place', () => {
    const v0 = view([0, 0, 1], 100);
    const aspect = 2;
    const ndc: [number, number] = [0.5, -0.25];
    const under = (v: View) => {
      const { right, up } = basis(v);
      return new Vector3(...v.target)
        .addScaledVector(right, (ndc[0] * v.size * aspect) / 2)
        .addScaledVector(up, (ndc[1] * v.size) / 2);
    };
    const before = under(v0);
    const v = zoomAt(v0, 0.8, ndc, aspect);
    near(under(v), [before.x, before.y, before.z]);
  });

  it('moves the perspective camera along the cursor ray', () => {
    const v0 = view([1, -1, 1], 100);
    const v = zoomAt(v0, 0.5, [0.3, 0.4], 1.2);
    const { right, up } = basis(v0);
    const anchor = new Vector3(...v0.target)
      .addScaledVector(right, (0.3 * 100 * 1.2) / 2)
      .addScaledVector(up, (0.4 * 100) / 2);
    const p0 = cameraPosition(v0, 'perspective').sub(anchor).normalize();
    const p1 = cameraPosition(v, 'perspective').sub(anchor).normalize();
    near(p1, [p0.x, p0.y, p0.z]);
  });

  it('clamps the size', () => {
    expect(zoomAt(view([0, 0, 1], 0.02), 0.001, [0, 0], 1).size).toBe(MIN_SIZE);
  });
});

describe('fitSphere', () => {
  it('frames the sphere with a margin, wider for a portrait viewport', () => {
    const v = fitSphere(view([1, -1, 1]), [10, 20, 30], 50, 2);
    expect(v.target).toEqual([10, 20, 30]);
    const half = ((FOV / 2) * Math.PI) / 180;
    expect(v.size).toBeCloseTo((2 * 50 * 1.25) / Math.cos(half), 9);
    expect(fitSphere(view([1, -1, 1]), [0, 0, 0], 50, 0.5).size).toBeCloseTo(v.size * 2, 9);
  });

  it('puts the whole sphere inside the perspective frustum', () => {
    const v = fitSphere(view([0, -1, 0]), [0, 0, 0], 50, 1);
    const distance = perspectiveDistance(v.size);
    const half = ((FOV / 2) * Math.PI) / 180;
    // A sphere is inside a cone of half-angle `half` when d·sin(half) ≥ r.
    expect(distance * Math.sin(half)).toBeGreaterThanOrEqual(50);
  });
});

describe('fitBox', () => {
  it('fills the view with a flat sketch seen face-on, with a margin', () => {
    // A 40 × 20 rectangle on XY from above, in a landscape view.
    const v = fitBox(view([0, 0, 1]), [-20, -10, 0], [20, 10, 0], 2, 'orthographic');
    expect(v.target).toEqual([0, 0, 0]);
    expect(v.size).toBeCloseTo(20 * 1.15, 9); // the height limits it
    // Portrait: the width limits it.
    const tall = fitBox(view([0, 0, 1]), [-20, -10, 0], [20, 10, 0], 0.5, 'orthographic');
    expect(tall.size).toBeCloseTo(80 * 1.15, 9);
    // Perspective is the same face-on (every corner is on the target plane).
    const p = fitBox(view([0, 0, 1]), [-20, -10, 0], [20, 10, 0], 2, 'perspective');
    expect(p.size).toBeCloseTo(20 * 1.15, 9);
  });

  it('is tighter than the bounding sphere', () => {
    const box = fitBox(view([0, 0, 1]), [-20, -20, 0], [20, 20, 0], 1, 'perspective');
    const sphere = fitSphere(view([0, 0, 1]), [0, 0, 0], Math.hypot(20, 20), 1);
    // A square face-on: 46 mm of view, where the sphere gave 74 (it filled 54 % of the height).
    expect(box.size).toBeCloseTo(46, 9);
    expect(box.size / sphere.size).toBeLessThan(0.63);
  });

  it('keeps every corner of a deep box inside the perspective view', () => {
    const v = fitBox(view([1, -1, 1]), [-30, -10, 0], [30, 10, 40], 1.5, 'perspective');
    const { right, up, back } = basis(v);
    const d = perspectiveDistance(v.size);
    const t = Math.tan(((FOV / 2) * Math.PI) / 180);
    for (const x of [-30, 30])
      for (const y of [-10, 10])
        for (const z of [0, 40]) {
          const rel = new Vector3(x, y, z).sub(new Vector3(...v.target));
          const depth = d - rel.dot(back);
          expect(Math.abs(rel.dot(up))).toBeLessThanOrEqual(depth * t + 1e-9);
          expect(Math.abs(rel.dot(right))).toBeLessThanOrEqual(depth * t * 1.5 + 1e-9);
        }
  });
});

describe('interpolate', () => {
  it('returns the ends at 0 and 1 and a geometric size in the middle', () => {
    const a = view([0, -1, 0], 10, [0, 0, 0]);
    const b = view([0, 0, 1], 1000, [10, 0, 0]);
    expect(sameView(interpolate(a, b, 0), a)).toBe(true);
    expect(sameView(interpolate(a, b, 1), b)).toBe(true);
    const mid = interpolate(a, b, 0.5);
    expect(mid.size).toBeCloseTo(100, 9);
    near(mid.target, [5, 0, 0]);
    // Halfway between front and top looks from the front-top edge.
    near(viewDirection(mid).negate(), [0, -Math.SQRT1_2, Math.SQRT1_2]);
  });
});

describe('easing', () => {
  it('matches the CSS curve at its ends and is monotonic', () => {
    expect(easeCamera(0)).toBe(0);
    expect(easeCamera(1)).toBe(1);
    let last = 0;
    for (let x = 0.05; x < 1; x += 0.05) {
      const y = easeCamera(x);
      expect(y).toBeGreaterThanOrEqual(last);
      last = y;
    }
    // An ease-out: well past halfway at the midpoint.
    expect(easeCamera(0.5)).toBeGreaterThan(0.8);
  });

  it('is the identity for a linear curve', () => {
    const linear = cubicBezier(1 / 3, 1 / 3, 2 / 3, 2 / 3);
    for (const x of [0.1, 0.37, 0.9]) expect(linear(x)).toBeCloseTo(x, 6);
  });
});

describe('camera position', () => {
  it('places the perspective camera so the target plane shows `size` mm', () => {
    const v = homeView();
    const d = cameraPosition(v, 'perspective').length();
    const half = ((FOV / 2) * Math.PI) / 180;
    expect(2 * d * Math.tan(half)).toBeCloseTo(v.size, 9);
  });

  it('places the orthographic camera behind the target along the view axis', () => {
    const v = view([0, 0, 1], 100, [1, 2, 3]);
    const p = cameraPosition(v, 'orthographic');
    expect(p.x).toBeCloseTo(1, 9);
    expect(p.y).toBeCloseTo(2, 9);
    expect(p.z).toBeGreaterThan(100);
  });
});

describe('picking', () => {
  const top: View = { target: [10, 20, 0], orientation: orientationFor([0, 0, 1]), size: 100 };
  const aspect = 2;

  it('casts rays through the view in both projections', () => {
    for (const projection of ['orthographic', 'perspective'] as const) {
      const centre = viewRay(top, projection, aspect, [0, 0]);
      near(rayPlane(centre, [0, 0, 0], [0, 0, 1]) ?? new Vector3(NaN), [10, 20, 0]);
      // The top-right corner of the view lands size/2 up and size × aspect / 2 right, at the target.
      const corner = viewRay(top, projection, aspect, [1, 1]);
      near(rayPlane(corner, [0, 0, 0], [0, 0, 1]) ?? new Vector3(NaN), [110, 70, 0]);
    }
  });

  it('matches the camera the viewport draws with', () => {
    const view = homeView();
    const ray = viewRay(view, 'perspective', 1.5, [0.3, -0.4]);
    // A point along the ray projects back to the same screen position.
    const p = ray.origin.clone().addScaledVector(ray.direction, 250);
    const { right, up } = basis(view);
    const eye = cameraPosition(view, 'perspective');
    const rel = p.clone().sub(eye);
    const depth = rel.dot(viewDirection(view));
    const halfHeight = depth * Math.tan(((FOV / 2) * Math.PI) / 180);
    expect(rel.dot(right) / (halfHeight * 1.5)).toBeCloseTo(0.3, 9);
    expect(rel.dot(up) / halfHeight).toBeCloseTo(-0.4, 9);
  });

  it('projects points back to where their pick ray started', () => {
    const view = homeView();
    for (const projection of ['orthographic', 'perspective'] as const) {
      const ray = viewRay(view, projection, 1.5, [0.3, -0.4]);
      const p = ray.origin.clone().addScaledVector(ray.direction, 5000);
      const ndc = viewProject(view, projection, 1.5, [p.x, p.y, p.z]) ?? [NaN, NaN];
      expect(ndc[0]).toBeCloseTo(0.3, 9);
      expect(ndc[1]).toBeCloseTo(-0.4, 9);
    }
    // Behind the perspective camera.
    const eye = cameraPosition(view, 'perspective');
    const behind = eye.clone().addScaledVector(viewDirection(view), -10);
    expect(viewProject(view, 'perspective', 1, [behind.x, behind.y, behind.z])).toBeUndefined();
  });

  it('misses planes seen edge-on or behind the camera', () => {
    const front: View = { target: [0, 0, 0], orientation: orientationFor([0, -1, 0]), size: 50 };
    expect(
      rayPlane(viewRay(front, 'orthographic', 1, [0, 0]), [0, 0, 0], [0, 0, 1]),
    ).toBeUndefined();
    const ray = viewRay(top, 'perspective', 1, [0, 0]);
    expect(rayPlane(ray, [0, 0, 1e6], [0, 0, 1])).toBeUndefined();
  });

  it('measures mm per pixel at a point', () => {
    expect(worldPerPixel(top, 'orthographic', 500, [0, 0, -300])).toBeCloseTo(0.2, 12);
    expect(worldPerPixel(top, 'perspective', 500, [10, 20, 0])).toBeCloseTo(0.2, 9);
    // Twice as far from the camera: twice the mm per pixel.
    const d = perspectiveDistance(top.size);
    expect(worldPerPixel(top, 'perspective', 500, [10, 20, -d])).toBeCloseTo(0.4, 9);
  });
});
