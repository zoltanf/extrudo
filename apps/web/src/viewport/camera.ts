/**
 * Camera math for the viewport (P0-05, ADR-0008). Pure functions on a plain
 * `View`, so they run in Node tests and the store can keep views as data.
 *
 * The world is Z-up, in millimetres: XY is the print bed. A view is a target
 * point, a camera orientation and a size: the visible height through the
 * target, in mm. Both projections derive from the same view, so switching
 * between perspective and orthographic keeps the model the same size on
 * screen at the target.
 */
import { Matrix4, Quaternion, Vector3 } from 'three';

export type Vec3 = readonly [number, number, number];
/** A unit quaternion, x y z w. */
export type Quat = readonly [number, number, number, number];

export interface View {
  target: Vec3;
  /** Camera-to-world rotation. The camera looks along its local −Z, with local +Y up. */
  orientation: Quat;
  /** Visible height through the target, in mm. */
  size: number;
  /**
   * Where the target shows across the view, in normalized device coordinates
   * (0 or absent: the middle; 0.2: a tenth of the width right of it). "Fit"
   * sets it so the model centres in the part of the view a floating panel
   * leaves open, while orbiting still turns about the target.
   */
  shift?: number;
}

export type Projection = 'perspective' | 'orthographic';

/** Vertical field of view of the perspective camera, in degrees. */
export const FOV = 35;
export const MIN_SIZE = 0.01;
export const MAX_SIZE = 1e6;
/** Front, right, top: the home view direction (from the target towards the camera). */
export const HOME_DIRECTION: Vec3 = [1, -1, 1];

const v3 = (v: Vec3) => new Vector3(v[0], v[1], v[2]);
const quat = (q: Quat) => new Quaternion(q[0], q[1], q[2], q[3]);
const tuple3 = (v: Vector3): Vec3 => [v.x, v.y, v.z];
const tuple4 = (q: Quaternion): Quat => {
  q.normalize();
  return [q.x, q.y, q.z, q.w];
};
const clampSize = (size: number) => Math.min(MAX_SIZE, Math.max(MIN_SIZE, size));

/** The camera's right, up and back (target → camera) directions in world space. */
export function basis(view: View): { right: Vector3; up: Vector3; back: Vector3 } {
  const q = quat(view.orientation);
  return {
    right: new Vector3(1, 0, 0).applyQuaternion(q),
    up: new Vector3(0, 1, 0).applyQuaternion(q),
    back: new Vector3(0, 0, 1).applyQuaternion(q),
  };
}

/** Distance from the target to the perspective camera for a view size. */
export function perspectiveDistance(size: number): number {
  return size / (2 * Math.tan(((FOV / 2) * Math.PI) / 180));
}

/**
 * An orientation whose camera sits in `direction` from the target. `up` is
 * world +Z, except when looking straight down (+Y up, front at the bottom of
 * the screen) or straight up (−Y up, as if the front view were tilted down).
 * An explicit `up` (a sketch plane's Y) wins unless it is parallel to
 * `direction`.
 */
export function orientationFor(direction: Vec3, preferredUp?: Vec3): Quat {
  const back = v3(direction).normalize();
  let up: Vector3;
  const given = preferredUp && v3(preferredUp).normalize();
  if (given && given.lengthSq() > 0 && Math.abs(given.dot(back)) < 0.999999) up = given;
  else if (Math.abs(back.z) > 0.999999) up = new Vector3(0, back.z > 0 ? 1 : -1, 0);
  else up = new Vector3(0, 0, 1);
  const m = new Matrix4().lookAt(back, new Vector3(), up);
  return tuple4(new Quaternion().setFromRotationMatrix(m));
}

export function homeView(): View {
  return { target: [0, 0, 0], orientation: orientationFor(HOME_DIRECTION), size: 200 };
}

/**
 * Orbits around the target: `yaw` turns about world Z (turntable), `pitch`
 * tilts about the camera's right axis. Radians, right-handed: positive yaw
 * moves the camera counter-clockwise seen from above.
 */
export function orbit(view: View, yaw: number, pitch: number): View {
  const q = quat(view.orientation);
  const turn = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), yaw);
  const tilt = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), pitch);
  return { ...view, orientation: tuple4(turn.multiply(q).multiply(tilt)) };
}

/**
 * Turns the camera about one of its own axes, around the target: `x` tilts
 * (as the right axis), `y` swings left and right, `z` rolls the view.
 * Radians, right-handed about the camera axis.
 */
export function turn(view: View, axis: 'x' | 'y' | 'z', angle: number): View {
  const a = new Vector3(axis === 'x' ? 1 : 0, axis === 'y' ? 1 : 0, axis === 'z' ? 1 : 0);
  const r = new Quaternion().setFromAxisAngle(a, angle);
  return { ...view, orientation: tuple4(quat(view.orientation).multiply(r)) };
}

/**
 * Pans by a pointer movement in pixels, so that points on the target plane
 * follow the cursor. `height` is the viewport height in pixels.
 */
export function pan(view: View, dx: number, dy: number, height: number): View {
  const { right, up } = basis(view);
  const scale = view.size / height;
  const target = v3(view.target)
    .addScaledVector(right, -dx * scale)
    .addScaledVector(up, dy * scale);
  return { ...view, target: tuple3(target) };
}

/**
 * Zooms by `factor` (< 1 zooms in) towards a point given in normalised device
 * coordinates (−1…1, +y up). The point of the target plane under it stays put:
 * in perspective the camera moves along the cursor ray.
 */
export function zoomAt(
  view: View,
  factor: number,
  ndc: readonly [number, number],
  aspect: number,
): View {
  const size = clampSize(view.size * factor);
  const f = size / view.size;
  const { right, up } = basis(view);
  const target = v3(view.target);
  const anchor = target
    .clone()
    .addScaledVector(right, ((ndc[0] - shiftOf(view)) * view.size * aspect) / 2)
    .addScaledVector(up, (ndc[1] * view.size) / 2);
  const next = anchor.clone().add(target.sub(anchor).multiplyScalar(f));
  return { ...view, target: tuple3(next), size };
}

/**
 * Frames a bounding sphere, keeping the orientation. `margin` leaves room
 * around it; the size also covers the perspective camera being closer to the
 * near side of the sphere.
 */
export function fitSphere(
  view: View,
  center: Vec3,
  radius: number,
  aspect: number,
  margin = 1.25,
): View {
  const half = ((FOV / 2) * Math.PI) / 180;
  const r = Math.max(radius, MIN_SIZE);
  const size = ((2 * r * margin) / Math.cos(half)) * Math.max(1, 1 / aspect);
  return { ...view, target: center, size: clampSize(size) };
}

/**
 * Fits an axis-aligned box as seen from the view's direction (F6): the box's
 * corners, projected on the view's right and up axes, fill the view with a
 * margin, and the target moves to the box's centre. With perspective, a
 * corner nearer the camera looks bigger, so the size is refined a few times
 * against the camera distance it gives. A flat sketch seen face-on fills
 * the view, where a bounding sphere left it at half the height.
 */
export function fitBox(
  view: View,
  min: Vec3,
  max: Vec3,
  aspect: number,
  projection: Projection,
  margin = 1.15,
): View {
  const center: Vec3 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  const { right, up, back } = basis(view);
  const corners: { x: number; y: number; z: number }[] = [];
  for (const cx of [min[0], max[0]])
    for (const cy of [min[1], max[1]])
      for (const cz of [min[2], max[2]]) {
        const d = new Vector3(cx - center[0], cy - center[1], cz - center[2]);
        corners.push({ x: d.dot(right), y: d.dot(up), z: d.dot(back) });
      }
  // The height the view needs for the corners at a camera distance (Infinity: orthographic).
  const needed = (distance: number) =>
    2 *
    Math.max(
      ...corners.map((c) => {
        const scale = Number.isFinite(distance) ? distance / Math.max(distance - c.z, 1e-6) : 1;
        return Math.max(Math.abs(c.y), Math.abs(c.x) / aspect) * scale;
      }),
    );
  let size = Math.max(needed(Infinity) * margin, FIT_MIN);
  if (projection === 'perspective') {
    for (let i = 0; i < 6; i++)
      size = Math.max(needed(perspectiveDistance(size)) * margin, FIT_MIN);
  }
  return { ...view, target: center, size: clampSize(size) };
}

/** The smallest view height (mm) "Fit" gives, for a single point or a tiny sketch. */
const FIT_MIN = 1;

/**
 * Interpolates between two views: position and shift linearly, orientation
 * by slerp, size geometrically.
 */
export function interpolate(a: View, b: View, t: number): View {
  const target = v3(a.target).lerp(v3(b.target), t);
  const orientation = quat(a.orientation).slerp(quat(b.orientation), t);
  const size = a.size * (b.size / a.size) ** t;
  return withShift(
    { target: tuple3(target), orientation: tuple4(orientation), size },
    shiftOf(a) + (shiftOf(b) - shiftOf(a)) * t,
  );
}

/** A view's `shift`, 0 when absent. */
export function shiftOf(view: View): number {
  return view.shift ?? 0;
}

/** The view with its target shown at `shift` (NDC); 0 leaves the field out. */
export function withShift(view: View, shift: number): View {
  const { shift: _, ...rest } = view;
  return shift === 0 ? rest : { ...rest, shift };
}

/** Where the camera is, for a projection. The orthographic camera sits far back along the view axis. */
export function cameraPosition(view: View, projection: Projection): Vector3 {
  const { back } = basis(view);
  const distance =
    projection === 'perspective' ? perspectiveDistance(view.size) : orthographicDistance(view);
  return v3(view.target).addScaledVector(back, distance);
}

/** Distance of the orthographic camera from the target: enough to see everything in front of it. */
export function orthographicDistance(view: View): number {
  return Math.max(view.size * 20, 1000);
}

/** The direction the camera looks in (from the camera towards the target). */
export function viewDirection(view: View): Vector3 {
  return basis(view).back.negate();
}

export interface WorldRay {
  origin: Vector3;
  /** Unit length. */
  direction: Vector3;
}

/**
 * The pick ray through a point of the view (`ndc`: −1…1, +y up), as the
 * cameras in `CameraRig` project: height `size` through the target, width
 * `size × aspect`.
 */
export function viewRay(
  view: View,
  projection: Projection,
  aspect: number,
  ndc: readonly [number, number],
): WorldRay {
  const { right, up, back } = basis(view);
  const half = view.size / 2;
  const x = ndc[0] - shiftOf(view);
  if (projection === 'orthographic') {
    const origin = v3(view.target)
      .addScaledVector(right, x * half * aspect)
      .addScaledVector(up, ndc[1] * half)
      .addScaledVector(back, orthographicDistance(view));
    return { origin, direction: back.clone().negate() };
  }
  const distance = perspectiveDistance(view.size);
  const direction = back
    .clone()
    .multiplyScalar(-distance)
    .addScaledVector(right, x * half * aspect)
    .addScaledVector(up, ndc[1] * half)
    .normalize();
  return { origin: cameraPosition(view, projection), direction };
}

/**
 * Where a world point appears in the view, in NDC (−1…1, +y up), or
 * `undefined` if it is behind the perspective camera. The inverse of `viewRay`.
 */
export function viewProject(
  view: View,
  projection: Projection,
  aspect: number,
  point: Vec3,
): [number, number] | undefined {
  const { right, up } = basis(view);
  const half = view.size / 2;
  if (projection === 'orthographic') {
    const rel = v3(point).sub(v3(view.target));
    return [rel.dot(right) / (half * aspect) + shiftOf(view), rel.dot(up) / half];
  }
  const rel = v3(point).sub(cameraPosition(view, projection));
  const depth = rel.dot(viewDirection(view));
  if (depth <= 1e-9) return undefined;
  const scale = (depth * half) / perspectiveDistance(view.size);
  return [rel.dot(right) / (scale * aspect) + shiftOf(view), rel.dot(up) / scale];
}

/**
 * Where a ray meets a plane through `origin` with `normal`, or `undefined`
 * if it runs parallel to the plane or the plane is behind it.
 */
export function rayPlane(ray: WorldRay, origin: Vec3, normal: Vec3): Vector3 | undefined {
  const n = v3(normal);
  const denom = ray.direction.dot(n);
  if (Math.abs(denom) < 1e-9) return undefined;
  const t = v3(origin).sub(ray.origin).dot(n) / denom;
  return t < 0 ? undefined : ray.origin.clone().addScaledVector(ray.direction, t);
}

/**
 * World units (mm) per screen pixel at `point`, for a view `height` px
 * tall: the same everywhere in orthographic, growing with depth in
 * perspective.
 */
export function worldPerPixel(
  view: View,
  projection: Projection,
  height: number,
  point: Vec3,
): number {
  const perPixel = view.size / Math.max(1, height);
  if (projection === 'orthographic') return perPixel;
  const eye = cameraPosition(view, projection);
  const depth = v3(point).sub(eye).dot(viewDirection(view));
  return (perPixel * Math.max(depth, 1e-6)) / perspectiveDistance(view.size);
}

/** The angle between two orientations, in radians. */
export function angleBetween(a: Quat, b: Quat): number {
  return quat(a).angleTo(quat(b));
}

/** True when two views differ by less than a hair (used to skip no-op animations). */
export function sameView(a: View, b: View): boolean {
  const scale = Math.max(a.size, b.size);
  return (
    angleBetween(a.orientation, b.orientation) < 1e-6 &&
    v3(a.target).distanceTo(v3(b.target)) < scale * 1e-6 &&
    Math.abs(a.size - b.size) < scale * 1e-6 &&
    Math.abs(shiftOf(a) - shiftOf(b)) < 1e-9
  );
}

/**
 * A cubic Bézier easing, like CSS `cubic-bezier(x1, y1, x2, y2)`. The camera
 * uses the brand's UI curve, `cubic-bezier(.2, .8, .2, 1)` (docs/05-brand.md §5).
 */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number) {
  const bez = (t: number, p1: number, p2: number) =>
    3 * (1 - t) ** 2 * t * p1 + 3 * (1 - t) * t ** 2 * p2 + t ** 3;
  return (x: number): number => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    // Bisection on x(t): monotonic for x1, x2 in [0, 1].
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2;
      if (bez(mid, x1, x2) < x) lo = mid;
      else hi = mid;
    }
    return bez((lo + hi) / 2, y1, y2);
  };
}

export const easeCamera = cubicBezier(0.2, 0.8, 0.2, 1);
