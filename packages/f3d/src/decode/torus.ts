/**
 * Torus primitives (`13BE0EF0…`, class version 0). The sizes are parameters
 * the feature owns: `MajorDiameter` (through the tube's centre) and
 * `MinorDiameter` (the tube's). Its own members, after the prologue: u32 the
 * result operation (as an extrude's: 1 join, 2 cut, 3 intersect, 4 new
 * body), a byte, four references (the two diameters' parameter owners, the
 * plane operand and one more), a byte, then a 4 × 4 row-major matrix (cm)
 * that places the torus in the frame of the plane it was made on: its centre
 * at the matrix's origin, its axis along the matrix's Z. The plane is a
 * geometry operand among its references holding the plane in model space
 * (`CC54ECAD…`): origin, x, y, and x × y the frame's Z. A body operand group
 * names the bodies it joins or cuts.
 */
import { F3dFormatError } from '../bytes';
import { readPrologue, type Segment } from '../segment';
import type { BodyOperation } from './extrude';
import type { ModelPlane } from './hole';
import type { Scope } from './scope';
import type { Vec3 } from './sketch-geometry';

export const TORUS = '13BE0EF0-467B-4F5A-BFFB-E0976171B678';

const OPERATIONS: Record<number, BodyOperation> = {
  1: 'join',
  2: 'cut',
  3: 'intersect',
  4: 'new-body',
};

/** The operation and the matrix in the plane's frame (row-major, cm). */
export function readTorusHead(
  seg: Segment,
  scope: Scope,
): { operation: BodyOperation; matrix: number[] } {
  const r = seg.reader(scope.id);
  if (readPrologue(r).leading) throw new F3dFormatError(`Torus #${scope.id}: leading block.`);
  const operation = OPERATIONS[r.u32()];
  if (!operation) throw new F3dFormatError(`Torus #${scope.id}: operation not found.`);
  r.u8();
  for (let i = 0; i < 4; i++) r.localRef();
  r.u8();
  const matrix: number[] = [];
  for (let i = 0; i < 16; i++) matrix.push(r.f64());
  const [, , , , , , , , , , , , a, b, c, d] = matrix;
  if (!matrix.every(Number.isFinite) || a !== 0 || b !== 0 || c !== 0 || d !== 1)
    throw new F3dFormatError(`Torus #${scope.id}: no placement matrix.`);
  return { operation, matrix };
}

/**
 * The torus's centre and unit axis in model space (cm): the matrix's origin
 * and Z taken from the plane's frame (origin, x, y, x × y) into the model.
 * Undefined when the plane or the axis is degenerate.
 */
export function torusPlacement(
  plane: ModelPlane,
  m: number[],
): { centre: Vec3; axis: Vec3 } | undefined {
  const { origin: O, x: X, y: Y } = plane;
  const N: Vec3 = [X[1] * Y[2] - X[2] * Y[1], X[2] * Y[0] - X[0] * Y[2], X[0] * Y[1] - X[1] * Y[0]];
  if (Math.abs(Math.hypot(...N) - 1) > 1e-6) return undefined;
  const at = (u: number, v: number, w: number, o: Vec3 | undefined): Vec3 =>
    [0, 1, 2].map(
      (i) => (o?.[i] ?? 0) + u * (X[i] as number) + v * (Y[i] as number) + w * (N[i] as number),
    ) as Vec3;
  const g = (i: number) => m[i] as number;
  const axis = at(g(2), g(6), g(10), undefined);
  const len = Math.hypot(...axis);
  if (Math.abs(len - 1) > 1e-6) return undefined;
  return { centre: at(g(3), g(7), g(11), O), axis: axis.map((v) => v / len) as Vec3 };
}
