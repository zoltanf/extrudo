/**
 * The Move/Copy dialog (P3-06, ADR-0044, FR-FT-10): bodies, a mode and a
 * copy toggle. Fields are named like the feature's inputs (`MoveInputs`),
 * so the framework's default mapping turns them into inputs and back;
 * fields of the other modes are hidden and make no input.
 *
 * - **Free move**: X, Y, Z distances and X, Y, Z turns. The in-view gizmo
 *   draws an arrow per axis (from the middle of the bodies' box face on
 *   that axis) and a ring handle per axis at the box centre, where the
 *   turns happen; dragging writes the field, which stays an expression.
 * - **Rotate**: an axis (origin or construction axis, straight edge,
 *   sketch line) and an angle, with one ring about the axis.
 * - **Point to point**: two vertices or construction points.
 */
import {
  MOVE_POINT_KINDS,
  type MoveMode,
  moveBodiesFeature,
  REVOLVE_AXIS_KINDS,
  type Vec3,
} from '@extrudo/core';
import { boundsOf } from '../viewport/bodyGeometry';
import { axisLine } from './geometry';
import { cross } from './manipulate';
import {
  type DialogContext,
  type DialogValues,
  defineFeatureDialog,
  type Manipulator,
  type ManipulatorContext,
} from './spec';

const MODES: readonly { value: MoveMode; label: string }[] = [
  { value: 'free', label: 'Free move' },
  { value: 'rotate', label: 'Rotate about axis' },
  { value: 'point-to-point', label: 'Point to point' },
];

const AXES = [
  { name: 'x', direction: [1, 0, 0], ring: [0, 1, 1] },
  { name: 'y', direction: [0, 1, 0], ring: [1, 0, 1] },
  { name: 'z', direction: [0, 0, 1], ring: [1, 1, 0] },
] as const;

const isMode = (mode: MoveMode) => (v: DialogValues) => (v.choices.mode ?? 'free') === mode;

export const moveDialog = defineFeatureDialog({
  ...moveBodiesFeature,
  command: 'move',
  fields: [
    {
      kind: 'selection',
      name: 'bodies',
      label: 'Bodies',
      accepts: ['body'],
      prompt: 'Pick bodies',
      hint: 'The bodies to move or turn.',
    },
    { kind: 'choice', name: 'mode', label: 'Move type', options: MODES, default: 'free' },
    ...AXES.map(({ name }) => ({
      kind: 'expression' as const,
      name: `d${name}`,
      label: `${name.toUpperCase()} distance`,
      unit: 'length' as const,
      default: '0 mm',
      hint: `Along the world ${name.toUpperCase()} axis. Drag the arrow, or type.`,
      shown: isMode('free'),
    })),
    ...AXES.map(({ name }) => ({
      kind: 'expression' as const,
      name: `r${name}`,
      label: `${name.toUpperCase()} angle`,
      unit: 'angle' as const,
      default: '0 deg',
      hint: `Turns about the world ${name.toUpperCase()} axis through the middle of the bodies' box, before the move.`,
      shown: isMode('free'),
    })),
    {
      kind: 'selection',
      name: 'axis',
      label: 'Axis',
      accepts: REVOLVE_AXIS_KINDS,
      max: 1,
      prompt: 'Pick an axis',
      hint: 'An origin or construction axis, a straight edge or a sketch line.',
      shown: isMode('rotate'),
    },
    {
      kind: 'expression',
      name: 'angle',
      label: 'Angle',
      unit: 'angle',
      default: '0 deg',
      hint: 'Right-handed about the axis. Drag the ring, or type.',
      shown: isMode('rotate'),
    },
    {
      kind: 'selection',
      name: 'from',
      label: 'From',
      accepts: MOVE_POINT_KINDS,
      max: 1,
      prompt: 'Pick the start point',
      hint: 'A vertex or construction point.',
      shown: isMode('point-to-point'),
    },
    {
      kind: 'selection',
      name: 'to',
      label: 'To',
      accepts: MOVE_POINT_KINDS,
      max: 1,
      prompt: 'Pick the end point',
      hint: 'The bodies move by the way from the start point to this one.',
      shown: isMode('point-to-point'),
    },
    {
      kind: 'toggle',
      name: 'copy',
      label: 'Create copy',
      default: false,
      hint: 'Keep the bodies where they are and add moved copies.',
    },
  ],
  manipulators: (values, ctx) => moveManipulators(values, ctx),
  // Moved bodies over the model's own, which stay drawn where they are.
  previewStyle: () => 'new',
});

/** The centre and half sizes of the box that holds the picked bodies' meshes. */
export function pivotOf(
  values: DialogValues,
  ctx: Pick<DialogContext, 'bodies'>,
): { centre: Vec3; half: Vec3 } | undefined {
  const meshes = (values.refs.bodies ?? [])
    .map((ref) => ctx.bodies[ref.id as keyof typeof ctx.bodies])
    .filter((mesh) => mesh !== undefined);
  const box = boundsOf(meshes)?.box;
  if (!box) return undefined;
  const centre = [0, 1, 2].map(
    (k) => ((box.min[k] ?? 0) + (box.max[k] ?? 0)) / 2,
  ) as unknown as Vec3;
  const half = [0, 1, 2].map((k) => ((box.max[k] ?? 0) - (box.min[k] ?? 0)) / 2) as unknown as Vec3;
  return { centre, half };
}

const unit = (v: Vec3): Vec3 => {
  const length = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / length, v[1] / length, v[2] / length];
};

/**
 * The in-view gizmo. Free move: an arrow per axis, starting on the box face
 * the axis points out of (so the three handles never sit on each other),
 * and a ring handle per axis at the box centre, on the diagonals between
 * the arrows. Rotate: one ring about the picked axis, starting from the
 * bodies' side of it. Point to point has none.
 */
export function moveManipulators(values: DialogValues, ctx: ManipulatorContext): Manipulator[] {
  const pivot = pivotOf(values, ctx);
  if (!pivot) return [];
  const mode = (values.choices.mode ?? 'free') as MoveMode;
  if (mode === 'free') {
    const out: Manipulator[] = [];
    AXES.forEach(({ name, direction, ring }, k) => {
      const face: Vec3 = [
        pivot.centre[0] + direction[0] * pivot.half[k as 0 | 1 | 2],
        pivot.centre[1] + direction[1] * pivot.half[k as 0 | 1 | 2],
        pivot.centre[2] + direction[2] * pivot.half[k as 0 | 1 | 2],
      ];
      out.push({ kind: 'distance', field: `d${name}`, origin: face, direction });
      out.push({
        kind: 'angle',
        field: `r${name}`,
        origin: pivot.centre,
        axis: direction,
        zero: unit(ring),
        fullTurn: true,
      });
    });
    return out;
  }
  if (mode === 'rotate') {
    const ref = values.refs.axis?.[0];
    const line = ref && axisLine(ref, ctx);
    if (!line) return [];
    const d = line.direction;
    const o = line.origin;
    const t =
      (pivot.centre[0] - o[0]) * d[0] +
      (pivot.centre[1] - o[1]) * d[1] +
      (pivot.centre[2] - o[2]) * d[2];
    const foot: Vec3 = [o[0] + t * d[0], o[1] + t * d[1], o[2] + t * d[2]];
    const out: Vec3 = [
      pivot.centre[0] - foot[0],
      pivot.centre[1] - foot[1],
      pivot.centre[2] - foot[2],
    ];
    const zero =
      Math.hypot(...out) > 1e-9
        ? unit(out)
        : unit(cross(d, Math.abs(d[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]));
    return [{ kind: 'angle', field: 'angle', origin: foot, axis: d, zero, fullTurn: true }];
  }
  return [];
}
