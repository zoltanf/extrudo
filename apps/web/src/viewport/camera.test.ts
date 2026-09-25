import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import {
  basis,
  cameraPosition,
  cubicBezier,
  easeCamera,
  FOV,
  fitSphere,
  homeView,
  interpolate,
  MIN_SIZE,
  orbit,
  orientationFor,
  pan,
  perspectiveDistance,
  sameView,
  turn,
  type Vec3,
  type View,
  viewDirection,
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
