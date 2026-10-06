/**
 * The revolve dialog (P2-07, ADR-0029, FR-FT-02): profiles or flat faces,
 * an axis (an origin axis, a sketch line or a straight edge), one side /
 * symmetric / two sides by an angle (a whole turn by default) or one side up
 * to a face, a body or a plane (P4-12), flip; new
 * body, join, cut or intersect with automatic or picked bodies. Fields are
 * named like the feature's inputs (`RevolveInputs`), so the framework's
 * default mapping turns them into inputs and back; hidden fields make no
 * input (side 2 while one-sided).
 *
 * Faces of a body propose **join** (turned out of the body, like
 * press-pull), profiles a new body, until the user picks an operation.
 */
import {
  type ExtrudoDocument,
  FULL_TURN,
  type GeomRef,
  parseSketchEntityRefId,
  REVOLVE_AXIS_KINDS,
  REVOLVE_OBJECT_KINDS,
  REVOLVE_PROFILE_KINDS,
  type RevolveOperation,
  readSketch,
  revolveFeature,
  type Vec3,
} from '@extrudo/core';
import type { PreviewToolStyle } from '@extrudo/kernel';
import { extrudeFrame } from './extrude';
import { type AxisLine, axisLine } from './geometry';
import { cross } from './manipulate';
import { proposeSweep, type Travel } from './operation';
import {
  type DialogContext,
  type DialogValues,
  defineFeatureDialog,
  type Manipulator,
  type ManipulatorContext,
} from './spec';

const DIRECTIONS = [
  { value: 'one-side', label: 'One side' },
  { value: 'symmetric', label: 'Symmetric' },
  { value: 'two-sides', label: 'Two sides' },
] as const;

const EXTENTS = [
  { value: 'angle', label: 'Angle' },
  { value: 'to-object', label: 'To object' },
] as const;

const OPERATIONS = [
  { value: 'new-body', label: 'New body' },
  { value: 'join', label: 'Join' },
  { value: 'cut', label: 'Cut' },
  { value: 'intersect', label: 'Intersect' },
] as const;

const PREVIEW_STYLE: Record<RevolveOperation, PreviewToolStyle> = {
  'new-body': 'new',
  join: 'join',
  cut: 'cut',
  intersect: 'intersect',
};

/** Turned up to an object (P4-12): one side, no angles. */
const toObject = (v: DialogValues) => v.choices.extent === 'to-object';
const twoSides = (v: DialogValues) => !toObject(v) && v.choices.direction === 'two-sides';

export const revolveDialog = defineFeatureDialog({
  ...revolveFeature,
  command: 'revolve',
  fields: [
    {
      kind: 'selection',
      name: 'profiles',
      label: 'Profiles',
      accepts: REVOLVE_PROFILE_KINDS,
      prompt: 'Pick profiles or flat faces',
      hint: 'Sketch profiles, a whole text or flat faces of bodies, all in one plane, on one side of the axis.',
      // A text is swept whole (P4-03); a bare sketch curve can't be revolved.
      wholeTexts: true,
    },
    {
      kind: 'selection',
      name: 'axis',
      label: 'Axis',
      accepts: REVOLVE_AXIS_KINDS,
      max: 1,
      prompt: 'Pick an axis',
      hint: 'A sketch line, a straight edge or an origin axis, in the profiles’ plane.',
    },
    { kind: 'choice', name: 'extent', label: 'Extent', options: EXTENTS, default: 'angle' },
    {
      kind: 'selection',
      name: 'toObject',
      label: 'To object',
      accepts: REVOLVE_OBJECT_KINDS,
      max: 1,
      prompt: 'Pick a face, a body or a plane',
      curvedFaces: true,
      hint: 'The revolve turns one side until it first meets it.',
      shown: toObject,
    },
    {
      kind: 'choice',
      name: 'direction',
      label: 'Direction',
      options: DIRECTIONS,
      default: 'one-side',
      shown: (v) => !toObject(v),
    },
    {
      kind: 'expression',
      name: 'angle',
      label: 'Angle',
      unit: 'angle',
      default: FULL_TURN,
      hint: '360° is a whole turn. Negative turns the other way. Symmetric: the whole angle.',
      shown: (v) => !toObject(v),
    },
    {
      kind: 'expression',
      name: 'angle2',
      label: 'Angle 2',
      unit: 'angle',
      default: '90 deg',
      hint: 'Side 2 turns the other way.',
      shown: twoSides,
    },
    { kind: 'toggle', name: 'flip', label: 'Flip', default: false },
    {
      kind: 'choice',
      name: 'operation',
      label: 'Operation',
      options: OPERATIONS,
      default: 'new-body',
    },
    {
      kind: 'selection',
      name: 'bodies',
      label: 'Bodies',
      accepts: ['body'],
      min: 0,
      prompt: 'Automatic',
      hint: 'The bodies to join, cut or intersect. Empty: every body the revolve reaches.',
      shown: (v) => (v.choices.operation ?? 'new-body') !== 'new-body',
    },
  ],
  validate(values, ctx) {
    const axis = values.refs.axis?.[0];
    if (axis?.kind === 'sketchEntity' && !isSketchLine(ctx.doc, axis)) {
      return { field: 'axis', message: 'Pick a straight line for the axis.' };
    }
    return undefined;
  },
  propose: (values, ctx) => proposeRevolveOperation(values, ctx),
  manipulators: (values, ctx) => revolveManipulators(values, ctx),
  previewStyle: (values) =>
    PREVIEW_STYLE[(values.choices.operation ?? 'new-body') as RevolveOperation] ?? 'new',
});

/** Whether a picked sketch curve (`<sketch>/<entity>`) is a line. */
function isSketchLine(doc: ExtrudoDocument, ref: GeomRef): boolean {
  const parsed = parseSketchEntityRefId(ref.id);
  const feature = parsed && doc.features.find((f) => f.id === parsed.feature);
  const sketch = feature && readSketch(feature);
  // A sketch the document doesn't have is the kernel's to report.
  if (!parsed || !sketch) return true;
  return sketch.data.entities[parsed.entity]?.type === 'line';
}

/**
 * The operation a revolve proposes (ADR-0029, unified with extrude's in
 * `operation.ts`, ADR-0051): profiles make a new body; faces of a body, and
 * profiles of a sketch on a body's face, join it when side 1 turns out of the
 * body, cut it when it turns into the body (a face turned about one of its
 * edges grows or carves the body, as Fusion does), and join when the turn
 * goes both ways or is a whole one. The framework applies it only while the
 * user hasn't picked an operation.
 */
export function proposeRevolveOperation(
  values: DialogValues,
  ctx: Pick<ManipulatorContext, 'value'> & Partial<DialogContext>,
): Partial<DialogValues> | undefined {
  const operation = proposeSweep(values.refs.profiles ?? [], revolveTravel(values, ctx), ctx.doc);
  return operation ? { choices: { operation } } : undefined;
}

/**
 * Which way side 1 of the revolve leaves the profiles' faces: out of their
 * body (along the outward normal), into it, or both ways (symmetric, two
 * sides, a whole turn). The first way is the one side 1 starts turning at the
 * profiles' centre, `axis × (centre − foot)` (reversed by a negative angle);
 * without an axis yet, or for a face square to the axis (which starts turning
 * along itself), it is out, the join a revolve always proposed. Undefined
 * while the angle doesn't evaluate.
 */
export function revolveTravel(
  values: DialogValues,
  ctx: Pick<ManipulatorContext, 'value'> & Partial<DialogContext>,
): Travel | undefined {
  if (toObject(values)) return undefined;
  if (values.choices.direction === 'symmetric' || twoSides(values)) return 'both';
  const angle = ctx.value('angle');
  if (angle === undefined || angle === 0) return undefined;
  if (Math.abs(angle) >= 360) return 'both';
  if (!ctx.doc || !ctx.bodies) return 'out';
  const context = {
    doc: ctx.doc,
    bodies: ctx.bodies,
    sketches: ctx.sketches,
    construction: ctx.construction,
  };
  const frame = revolveFrame(values, context);
  const normal = extrudeFrame(values.refs.profiles ?? [], context)?.normal;
  if (!frame || !normal) return 'out';
  const turning = cross(frame.axis.direction, frame.zero);
  const along =
    (turning[0] * normal[0] + turning[1] * normal[1] + turning[2] * normal[2]) * Math.sign(angle);
  return along < -1e-6 ? 'in' : 'out';
}

/**
 * Where the revolve turns: the axis (reversed by Flip, as the kernel does)
 * through the foot of the profiles' centre on it, and the way from there to
 * the centre, where the arcs start.
 */
export function revolveFrame(
  values: DialogValues,
  ctx: Pick<DialogContext, 'doc' | 'bodies' | 'sketches' | 'construction'>,
): { axis: AxisLine; zero: Vec3 } | undefined {
  const ref = values.refs.axis?.[0];
  const line = ref && axisLine(ref, ctx);
  if (!line) return undefined;
  const direction = values.toggles.flip === true ? scale(line.direction, -1) : line.direction;
  const centre = extrudeFrame(values.refs.profiles ?? [], ctx)?.origin;
  const o = line.origin;
  const d = line.direction;
  if (!centre) return undefined;
  const t = (centre[0] - o[0]) * d[0] + (centre[1] - o[1]) * d[1] + (centre[2] - o[2]) * d[2];
  const foot: Vec3 = [o[0] + t * d[0], o[1] + t * d[1], o[2] + t * d[2]];
  const out: Vec3 = [centre[0] - foot[0], centre[1] - foot[1], centre[2] - foot[2]];
  const zero = Math.hypot(...out) > 1e-9 ? unit(out) : squareTo(d);
  return { axis: { origin: foot, direction }, zero };
}

/**
 * An angle arc about the axis from the profiles' side of it: side 1 turns
 * right-handed about the axis (reversed by Flip), side 2 the other way.
 * Symmetric arcs reach half the angle. Arcs go on round a whole turn.
 */
export function revolveManipulators(values: DialogValues, ctx: ManipulatorContext): Manipulator[] {
  const frame = revolveFrame(values, ctx);
  if (!frame || toObject(values)) return [];
  const { axis, zero } = frame;
  const arc = (field: string, about: Vec3, scaleBy = 1): Manipulator => ({
    kind: 'angle',
    field,
    origin: axis.origin,
    axis: about,
    zero,
    fullTurn: true,
    ...(scaleBy !== 1 && { scale: scaleBy }),
  });
  const symmetric = values.choices.direction === 'symmetric';
  const out = [arc('angle', axis.direction, symmetric ? 0.5 : 1)];
  if (twoSides(values)) out.push(arc('angle2', scale(axis.direction, -1)));
  return out;
}

const scale = (v: Vec3, s: number): Vec3 => [v[0] * s, v[1] * s, v[2] * s];

function unit(v: Vec3): Vec3 {
  const length = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / length, v[1] / length, v[2] / length];
}

/** A unit vector square to `d`. */
function squareTo(d: Vec3): Vec3 {
  const other: Vec3 = Math.abs(d[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  return unit(cross(d, other));
}
