/**
 * The OpenSCAD export's intermediate form (P6-09, ADR-0086 §3): what a
 * feature's `csg` hook returns and what the printer (`print.ts`) writes. A
 * small tree of OpenSCAD's own operations, plus references to the body
 * versions and shared tools the version walk (`versions.ts`) names.
 *
 * Plain data, no kernel types: a hook builds it from numbers it read off the
 * resolved geometry (ADR-0086 §4).
 */
import type { BodyId } from '@extrudo/core';

/**
 * A scalar the file writes: a number, or an OpenSCAD expression over the
 * parameter variables (ADR-0086 §4, §6) with the value it has now. The
 * printer writes `expr` when there is one, else the value through
 * `scadNumber`.
 */
export type Scalar = number | ScadExpression;

export interface ScadExpression {
  /** OpenSCAD source, already in OpenSCAD's units (mm, degrees). */
  expr: string;
  /** What it evaluates to, in mm, degrees or plain units. */
  value: number;
}

export type Vec2 = readonly [Scalar, Scalar];
export type Vec3 = readonly [Scalar, Scalar, Scalar];

/** A placement as OpenSCAD's `multmatrix` takes it: three rows of four (the fourth is `[0, 0, 0, 1]`). */
export type Matrix = readonly [
  readonly [number, number, number, number],
  readonly [number, number, number, number],
  readonly [number, number, number, number],
];

export type CsgNode =
  // Transforms: each applies to its children (implicitly unioned).
  | { kind: 'translate'; v: Vec3; children: readonly CsgNode[] }
  /** `rotate(a)` with a vector of Euler angles, or `rotate(a, v)` about an axis. */
  | { kind: 'rotate'; a: Scalar | Vec3; v?: Vec3; children: readonly CsgNode[] }
  | { kind: 'scale'; v: Vec3; children: readonly CsgNode[] }
  /** Mirrors in the plane through the origin with normal `v`. */
  | { kind: 'mirror'; v: Vec3; children: readonly CsgNode[] }
  | { kind: 'multmatrix'; m: Matrix; children: readonly CsgNode[] }
  /** `#rrggbb`, and an alpha below 1 when the body is see-through. */
  | { kind: 'color'; color: string; alpha?: number; children: readonly CsgNode[] }
  // Booleans: `difference` subtracts every child after the first from it.
  | { kind: 'union' | 'difference' | 'intersection'; children: readonly CsgNode[] }
  // Solids.
  | { kind: 'cube'; size: Vec3; center?: boolean }
  | { kind: 'cylinder'; h: Scalar; r1: Scalar; r2: Scalar; center?: boolean }
  | { kind: 'sphere'; r: Scalar }
  /** `points` and `faces` as OpenSCAD wants them: faces clockwise seen from outside. */
  | {
      kind: 'polyhedron';
      points: readonly (readonly [number, number, number])[];
      faces: readonly (readonly number[])[];
    }
  // Plane shapes (in XY) and the extrusions that make solids of them.
  | { kind: 'circle'; r: Scalar }
  | { kind: 'square'; size: Vec2; center?: boolean }
  /** Outer and hole loops as `paths` (indices into `points`); no `paths`: one loop. */
  | {
      kind: 'polygon';
      points: readonly (readonly [number, number])[];
      paths?: readonly (readonly number[])[];
    }
  /** Along +Z from z 0, or centred on z 0 with `center`. */
  | {
      kind: 'linear_extrude';
      height: Scalar;
      center?: boolean;
      twist?: Scalar;
      scale?: Scalar | Vec2;
      children: readonly CsgNode[];
    }
  /** About Z, the 2D children's X being the radius; `angle` from +X, the whole turn when absent. */
  | { kind: 'rotate_extrude'; angle?: Scalar; children: readonly CsgNode[] }
  /**
   * A body as it was before the feature (`CsgContext.body`): the walk writes
   * the version's module call. `version` indexes the walk's table.
   */
  | { kind: 'version'; body: BodyId; version: number }
  /** A tool the feature shares between bodies (`CsgContext.tool`): a module when used twice or more. */
  | { kind: 'tool'; tool: number };

/** The nodes with children. */
export type CsgParent = Extract<CsgNode, { children: readonly CsgNode[] }>;

export function hasChildren(node: CsgNode): node is CsgParent {
  return 'children' in node;
}

/** `kind(children…)` for a boolean; a boolean of one child is that child. */
export function boolean(
  kind: 'union' | 'difference' | 'intersection',
  children: readonly CsgNode[],
): CsgNode {
  if (children.length === 1 && kind !== 'difference') return children[0] as CsgNode;
  return { kind, children };
}

/**
 * A torus about Z through the origin (ADR-0086 §3): a circle of radius `tube`
 * at `ring` from the axis, turned once around.
 */
export function torus(ring: Scalar, tube: Scalar): CsgNode {
  return {
    kind: 'rotate_extrude',
    children: [{ kind: 'translate', v: [ring, 0, 0], children: [{ kind: 'circle', r: tube }] }],
  };
}

/** A row-major 4×4 (or 3×4) matrix as `multmatrix` takes it. */
export function matrixOf(rows: readonly number[]): Matrix {
  if (rows.length !== 12 && rows.length !== 16) {
    throw new RangeError(`A placement has 12 or 16 numbers, not ${rows.length}.`);
  }
  const row = (i: number) =>
    [rows[i * 4], rows[i * 4 + 1], rows[i * 4 + 2], rows[i * 4 + 3]] as [
      number,
      number,
      number,
      number,
    ];
  return [row(0), row(1), row(2)];
}

/** An expression's source as an operand: in parentheses unless it is a plain name or number. */
const operand = (expr: string) =>
  /^[A-Za-z_$][\w$]*$|^\d+(\.\d+)?$/.test(expr) ? expr : `(${expr})`;

/** Half a scalar (a radius from a diameter): a number for a number. */
export function half(value: Scalar): Scalar {
  if (typeof value === 'number') return value / 2;
  return { expr: `${operand(value.expr)} / 2`, value: value.value / 2 };
}

/** A scalar negated: a number for a number. */
export function negate(value: Scalar): Scalar {
  if (typeof value === 'number') return -value;
  return { expr: `-${operand(value.expr)}`, value: -value.value };
}

/** A scalar's size, without its sign (a negative height's): a number for a number. */
export function absolute(value: Scalar): Scalar {
  if (typeof value === 'number') return Math.abs(value);
  return { expr: `abs(${value.expr})`, value: Math.abs(value.value) };
}

/** A frame's placement: its X, Y and normal as the columns, its origin as the move. */
export function frameMatrix(frame: {
  origin: readonly number[];
  x: readonly number[];
  y: readonly number[];
  normal: readonly number[];
}): Matrix {
  const { origin: o, x, y, normal: n } = frame;
  const row = (k: number) =>
    [x[k] ?? 0, y[k] ?? 0, n[k] ?? 0, o[k] ?? 0] as [number, number, number, number];
  return [row(0), row(1), row(2)];
}

/**
 * `child` transformed about `point` rather than the origin:
 * `translate(point) transform translate(-point) child`, without the moves
 * when the point is the origin.
 */
export function about(
  point: readonly number[],
  transform: (child: CsgNode) => CsgNode,
  child: CsgNode,
): CsgNode {
  if (point.every((v) => v === 0)) return transform(child);
  const [x = 0, y = 0, z = 0] = point;
  const inner: CsgNode = { kind: 'translate', v: [-x, -y, -z], children: [child] };
  return { kind: 'translate', v: [x, y, z], children: [transform(inner)] };
}
