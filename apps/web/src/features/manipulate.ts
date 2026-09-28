/**
 * Manipulator maths (ADR-0027): where a drag along an arrow or around an
 * arc puts the value, how finely it snaps, and the expression it writes.
 * Pure, over plain 3-vectors, so it runs in Vitest.
 */
import { type ExtrudoDocument, UNITS, type UnitKind, type Vec3 } from '@extrudo/core';

export interface Ray {
  origin: Vec3;
  /** Unit length. */
  direction: Vec3;
}

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const along = (o: Vec3, d: Vec3, t: number): Vec3 => [
  o[0] + d[0] * t,
  o[1] + d[1] * t,
  o[2] + d[2] * t,
];

/**
 * The parameter `t` of the point on the line `origin + t·direction` closest
 * to the ray: where a drag along an arrow puts its head. Undefined when the
 * line runs along the view (it can't be dragged then).
 */
export function distanceAlong(origin: Vec3, direction: Vec3, ray: Ray): number | undefined {
  const w: Vec3 = sub(origin, ray.origin);
  const a = dot(direction, direction);
  const b = dot(direction, ray.direction);
  const c = dot(ray.direction, ray.direction);
  const d = dot(direction, w);
  const e = dot(ray.direction, w);
  const denom = a * c - b * b;
  if (denom < 1e-6 * a * c) return undefined;
  return (b * e - c * d) / denom;
}

/**
 * The angle (degrees, −180…180) of the point where the ray meets the plane
 * through `origin` normal to `axis`, measured from `zero` towards
 * `axis × zero`: where a drag around an arc puts its handle. Undefined when
 * the ray misses the plane or runs in it.
 */
export function angleAround(origin: Vec3, axis: Vec3, zero: Vec3, ray: Ray): number | undefined {
  const denom = dot(ray.direction, axis);
  if (Math.abs(denom) < 1e-6) return undefined;
  const t = dot(sub(origin, ray.origin), axis) / denom;
  if (t < 0) return undefined;
  const v = sub(along(ray.origin, ray.direction, t), origin);
  const y = cross(axis, zero);
  if (Math.hypot(dot(v, zero), dot(v, y)) < 1e-9) return undefined;
  return (Math.atan2(dot(v, y), dot(v, zero)) * 180) / Math.PI;
}

/**
 * A round step for dragged lengths: about three screen pixels' worth,
 * rounded down to 1, 2 or 5 times a power of ten (0.1 mm when a pixel is
 * about 0.04 mm).
 */
export function lengthStep(perPixel: number): number {
  const raw = Math.max(perPixel * 3, 1e-6);
  const power = 10 ** Math.floor(Math.log10(raw));
  const m = raw / power;
  return (m >= 5 ? 5 : m >= 2 ? 2 : 1) * power;
}

/** Dragged angles snap to whole degrees. */
export const ANGLE_STEP = 1;

/** `value` rounded to a multiple of `step`, without float noise ("0.30000000000000004"). */
export function snap(value: number, step: number): number {
  const decimals = Math.max(0, -Math.floor(Math.log10(step)) + 1);
  return Number((Math.round(value / step) * step).toFixed(decimals)) + 0;
}

/**
 * The expression a drag writes: a plain number with its unit, in the
 * document's length unit (snapped to `lengthStep` of `perPixel` in that
 * unit) or whole degrees: "12.5 mm", "15 deg". It replaces the field's
 * expression, parameters included (ADR-0027). `value` is in mm or degrees.
 */
export function draggedExpression(
  value: number,
  unit: UnitKind,
  settings: ExtrudoDocument['settings'],
  perPixel: number,
): string {
  if (unit === 'angle') return `${snap(value, ANGLE_STEP)} deg`;
  if (unit === 'length') {
    const factor = UNITS[settings.units]?.factor ?? 1;
    return `${snap(value / factor, lengthStep(perPixel / factor))} ${settings.units}`;
  }
  return String(snap(value, lengthStep(perPixel)));
}
