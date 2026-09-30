/**
 * The rigid transforms Move/Copy and Mirror hand to the kernel (P3-06,
 * ADR-0044), as `Kernel.transform`'s 3 × 4 matrices: the nine numbers of a
 * rotation or reflection row by row, each row followed by its translation
 * (`[r11 r12 r13 tx, r21 r22 r23 ty, r31 r32 r33 tz]`). Pure, in world mm
 * and radians.
 */
import type { Vec3 } from '../kernel';
import { cross, dot, unit } from './vec';

/** Twelve numbers: three rows of a 3 × 3 matrix, each with its translation. */
export type Matrix12 = readonly number[] & { readonly length: 12 };

const matrix = (...values: number[]): Matrix12 => values as unknown as Matrix12;

export const IDENTITY: Matrix12 = matrix(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0);

/** A move by `by`. */
export function translation(by: Vec3): Matrix12 {
  return matrix(1, 0, 0, by[0], 0, 1, 0, by[1], 0, 0, 1, by[2]);
}

/**
 * A turn of `angle` radians about the line through `origin` along
 * `direction` (Rodrigues; right-handed, counter-clockwise seen from the
 * direction's tip, like revolve).
 */
export function rotation(origin: Vec3, direction: Vec3, angle: number): Matrix12 {
  const [x, y, z] = unit(direction);
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const k = 1 - c;
  const r = [
    c + x * x * k,
    x * y * k - z * s,
    x * z * k + y * s,
    y * x * k + z * s,
    c + y * y * k,
    y * z * k - x * s,
    z * x * k - y * s,
    z * y * k + x * s,
    c + z * z * k,
  ] as [number, number, number, number, number, number, number, number, number];
  // p' = R (p - o) + o: the translation is o - R o.
  const t = (row: number) =>
    (origin[row] as number) -
    ((r[3 * row] as number) * origin[0] +
      (r[3 * row + 1] as number) * origin[1] +
      (r[3 * row + 2] as number) * origin[2]);
  return matrix(r[0], r[1], r[2], t(0), r[3], r[4], r[5], t(1), r[6], r[7], r[8], t(2));
}

/** A reflection in the plane through `point` with normal `normal`. */
export function mirror(point: Vec3, normal: Vec3): Matrix12 {
  const n = unit(normal);
  const [x, y, z] = n;
  const d = 2 * dot(n, point);
  return matrix(
    1 - 2 * x * x,
    -2 * x * y,
    -2 * x * z,
    d * x,
    -2 * y * x,
    1 - 2 * y * y,
    -2 * y * z,
    d * y,
    -2 * z * x,
    -2 * z * y,
    1 - 2 * z * z,
    d * z,
  );
}

/** `a` after `b`: the matrix that applies `b` first, then `a`. */
export function compose(a: Matrix12, b: Matrix12): Matrix12 {
  const out: number[] = [];
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 4; col++) {
      let sum = col === 3 ? (a[4 * row + 3] as number) : 0;
      for (let k = 0; k < 3; k++) sum += (a[4 * row + k] as number) * (b[4 * k + col] as number);
      out.push(sum);
    }
  }
  return out as unknown as Matrix12;
}

/** `p` transformed by `m`. */
export function apply(m: Matrix12, p: Vec3): Vec3 {
  const at = (row: number) =>
    (m[4 * row] as number) * p[0] +
    (m[4 * row + 1] as number) * p[1] +
    (m[4 * row + 2] as number) * p[2] +
    (m[4 * row + 3] as number);
  return [at(0), at(1), at(2)];
}

/** The determinant of the 3 × 3 part: 1 for a move or turn, -1 for a mirror. */
export function determinant(m: Matrix12): number {
  const row = (i: number): Vec3 => [
    m[4 * i] as number,
    m[4 * i + 1] as number,
    m[4 * i + 2] as number,
  ];
  return dot(row(0), cross(row(1), row(2)));
}

/**
 * Place on Bed (P3-10, ADR-0048): the turn and move that put a plane face,
 * whose outward normal is `normal` and which contains `point`, flat on the
 * XY plane facing down (normal -Z) at z = 0. The turn is the smallest one
 * (about the axis `normal × -Z` through `point`, so the face's own centre
 * stays where it is in X and Y; a face already up is turned half a turn
 * about X); the move is then straight down by the height of `point`. Pure.
 */
export function faceDown(normal: Vec3, point: Vec3): Matrix12 {
  const n = unit(normal);
  // n · (-Z) is the cosine of the angle to turn through; n × (-Z) = (-ny, nx, 0) the axis.
  const axis: Vec3 = [0 - n[1], n[0], 0];
  const sine = Math.hypot(axis[0], axis[1]);
  const turn =
    sine < 1e-9
      ? n[2] < 0
        ? IDENTITY
        : rotation(point, [1, 0, 0], Math.PI)
      : rotation(point, axis, Math.atan2(sine, 0 - n[2]));
  return compose(translation([0, 0, 0 - point[2]]), turn);
}
