/**
 * The coil feature (P4-01, ADR-0055, FR-FT-14): a spring, a section swept
 * along a helix. It is placed like a primitive (ADR-0032): a plane or flat
 * face (`plane`, default XY) gives a frame, `x` and `y` put the coil's axis
 * in it and `offset` lifts its start off the plane; the axis is the plane's
 * normal and the helix starts on the frame's X side. The kernel adds its
 * evaluator and the web app its dialog, each in its own registry keyed by
 * `COIL_TYPE` (ADR-0003).
 *
 * - `type` says which two of revolutions, height and pitch are given; the
 *   third follows (`coilTurns`).
 * - `diameter` is the helix's at the start; `taper` (an angle) widens it
 *   with height (negative narrows it).
 * - `direction`: counter-clockwise seen from above (a right-hand spring, as
 *   most threads are) or clockwise.
 * - `section`: a circle, a square, or a triangle pointing out or in, of
 *   `size` (the circle's diameter, the square's side, the triangle's base
 *   along the axis); `position` puts it inside the diameter, centred on it,
 *   or outside it.
 *
 * Every input is optional, so a minimal coil is `{}`: 5 turns 20 mm high of
 * a 2 mm wire on a 20 mm diameter on the XY plane, a new body.
 */

import { SWEEP_FACE_ROLES } from './face-roles';
import { BODY_OPERATIONS, type BodyOperation, enumInput, exprOf, refsOf } from './feature-inputs';
import type { FeatureDefinition } from './features';
import { DEFAULT_PLACEMENT, PLACEMENT_KINDS, type PrimitiveNumber } from './primitives';
import type { ExprInput, GeomRef, RefInput } from './schema';
import { z } from './zod';

export const COIL_TYPE = 'coil';

/** Which two of revolutions, height and pitch a coil is given. */
export const COIL_TYPES = ['revolutions-height', 'revolutions-pitch', 'height-pitch'] as const;
export type CoilType = (typeof COIL_TYPES)[number];

/** Which way it winds, seen from above (from the axis's tip). */
export const COIL_DIRECTIONS = ['counter-clockwise', 'clockwise'] as const;
export type CoilDirection = (typeof COIL_DIRECTIONS)[number];

/** The wire's cross-section. A triangle `out` points away from the axis, `in` towards it. */
export const COIL_SECTIONS = ['circle', 'square', 'triangle-out', 'triangle-in'] as const;
export type CoilSection = (typeof COIL_SECTIONS)[number];

/** Where the section sits against the diameter: inside it, centred on it, or outside it. */
export const COIL_POSITIONS = ['inside', 'on', 'outside'] as const;
export type CoilPosition = (typeof COIL_POSITIONS)[number];

const length = (name: string, label: string, value: number, positive = true): PrimitiveNumber => ({
  name,
  label,
  unit: 'length',
  default: `${value} mm`,
  value,
  ...(positive && { positive }),
});

/** A coil's numbers, in the order its dialog lists them (placement last). */
export const COIL_NUMBERS: readonly PrimitiveNumber[] = [
  length('diameter', 'Diameter', 20),
  {
    name: 'revolutions',
    label: 'Revolutions',
    unit: 'unitless',
    default: '5',
    value: 5,
    positive: true,
  },
  length('height', 'Height', 20),
  length('pitch', 'Pitch', 4),
  { name: 'taper', label: 'Taper angle', unit: 'angle', default: '0 deg', value: 0 },
  length('size', 'Section size', 2),
  length('x', 'X', 0, false),
  length('y', 'Y', 0, false),
  length('offset', 'Offset', 0, false),
];

/** The numbers each type uses besides the diameter, taper, size and placement. */
export const COIL_TYPE_NUMBERS: Readonly<Record<CoilType, readonly [string, string]>> = {
  'revolutions-height': ['revolutions', 'height'],
  'revolutions-pitch': ['revolutions', 'pitch'],
  'height-pitch': ['height', 'pitch'],
};

/** The most turns a coil may have. */
export const MAX_COIL_TURNS = 1000;

export const CoilInputsSchema = z.strictObject({
  /** The plane or flat face it stands on. Missing: the XY plane (`DEFAULT_PLACEMENT`). */
  plane: refsOf(PLACEMENT_KINDS, 1)
    .optional()
    .describe('The plane or flat face it stands on. Default the XY plane.'),
  /** The axis's place along the plane frame's X and Y; default 0. */
  x: exprOf('length')
    .optional()
    .describe("The axis's place along the plane frame's X; a length. Default 0."),
  y: exprOf('length')
    .optional()
    .describe("The axis's place along the plane frame's Y; a length. Default 0."),
  /** How far the coil starts off the plane along its normal; default 0. */
  offset: exprOf('length')
    .optional()
    .describe('How far the coil starts off the plane along its normal; a length. Default 0.'),
  /** Default `revolutions-height`. */
  type: enumInput(COIL_TYPES)
    .optional()
    .describe(
      'Whether the height or the pitch sets the number of turns. Default revolutions-height.',
    ),
  /** The helix's diameter at the start (through the section's centre when `on`); default 20 mm. */
  diameter: exprOf('length')
    .optional()
    .describe(
      "The helix's diameter at the start, through the section's centre when the section is on the axis; a length. Default 20 mm.",
    ),
  /** A plain number, fractions allowed; default 5. */
  revolutions: exprOf('unitless')
    .optional()
    .describe('How many turns; a plain number, fractions allowed. Default 5.'),
  /** Along the axis, start to end; default 20 mm. */
  height: exprOf('length')
    .optional()
    .describe('Along the axis, start to end; a length. Default 20 mm.'),
  /** Rise per turn; default 4 mm. */
  pitch: exprOf('length').optional().describe('Rise per turn; a length. Default 4 mm.'),
  /** Half-angle of the cone it winds on; positive widens with height. Default 0°. */
  taper: exprOf('angle')
    .optional()
    .describe(
      'Half-angle of the cone it winds on; an angle. Positive widens it with height, the default 0° keeps it even.',
    ),
  /** Default `counter-clockwise`. */
  direction: enumInput(COIL_DIRECTIONS)
    .optional()
    .describe('Which way round the axis it winds. Default counter-clockwise.'),
  /** Default `circle`. */
  section: enumInput(COIL_SECTIONS)
    .optional()
    .describe('The shape of the wire: circle, square or triangle. Default circle.'),
  /** The circle's diameter, the square's side, the triangle's base; default 2 mm. */
  size: exprOf('length')
    .optional()
    .describe(
      "The section's size: the circle's diameter, the square's side, the triangle's base; a length. Default 2 mm.",
    ),
  /** Default `on`. */
  position: enumInput(COIL_POSITIONS)
    .optional()
    .describe('The section on the helix, or on the axis. Default on.'),
  /** Default `new-body`. */
  operation: enumInput(BODY_OPERATIONS)
    .optional()
    .describe('New body, join, cut or intersect. Default new-body.'),
  /**
   * The bodies to join, cut or intersect (`body` references, body IDs).
   * Empty or missing: every body the coil touches (join) or overlaps (cut,
   * intersect).
   */
  bodies: refsOf(['body'])
    .optional()
    .describe(
      'The bodies to join, cut or intersect; by default every body the coil touches (join) or overlaps (cut, intersect).',
    ),
});
export type CoilInputs = z.infer<typeof CoilInputsSchema>;

export const coilFeature: FeatureDefinition<CoilInputs> = {
  type: COIL_TYPE,
  label: 'Coil',
  category: 'create',
  icon: 'coil',
  inputsSchema: CoilInputsSchema,
  // ADR-0068 §4, from the kernel's coil (P4-01): the sweep's own caps and one
  // side per curve of the section (`surface`, `outer`, `top`, ...).
  faceRoles: SWEEP_FACE_ROLES,
};

/** A coil's inputs with every default filled in, but for its numbers. */
export interface CoilSettings {
  plane: GeomRef;
  type: CoilType;
  direction: CoilDirection;
  section: CoilSection;
  position: CoilPosition;
  operation: BodyOperation;
  /** Explicit participants (body IDs); empty means automatic. */
  bodies: string[];
  /** The `expr` inputs present, by name; a number without one takes its `COIL_NUMBERS` value. */
  exprs: ReadonlySet<string>;
}

/** Reads a coil's (valid) inputs with their defaults. */
export function coilSettings(inputs: CoilInputs): CoilSettings {
  const exprs = new Set<string>();
  for (const [name, input] of Object.entries(inputs)) {
    if ((input as { kind?: string } | undefined)?.kind === 'expr') exprs.add(name);
  }
  return {
    plane: inputs.plane?.refs[0] ?? DEFAULT_PLACEMENT,
    type: inputs.type?.value ?? 'revolutions-height',
    direction: inputs.direction?.value ?? 'counter-clockwise',
    section: inputs.section?.value ?? 'circle',
    position: inputs.position?.value ?? 'on',
    operation: inputs.operation?.value ?? 'new-body',
    bodies: (inputs.bodies?.refs ?? []).map((ref) => ref.id),
    exprs,
  };
}

/** A coil's turns, pitch and height (mm) from the two its type gives. */
export function coilTurns(
  type: CoilType,
  n: { revolutions: number; height: number; pitch: number },
): { turns: number; pitch: number; height: number } {
  switch (type) {
    case 'revolutions-height':
      return { turns: n.revolutions, pitch: n.height / n.revolutions, height: n.height };
    case 'revolutions-pitch':
      return { turns: n.revolutions, pitch: n.pitch, height: n.revolutions * n.pitch };
    case 'height-pitch':
      return { turns: n.height / n.pitch, pitch: n.pitch, height: n.height };
  }
}

/**
 * How far a section of `size` reaches along the axis (what must fit in the
 * pitch) and across it (from its inner to its outer side): a circle and a
 * square are `size` both ways, a triangle `size` along the axis and its
 * height (an equilateral triangle's) across.
 */
export function coilSectionExtent(
  section: CoilSection,
  size: number,
): { along: number; across: number } {
  return section === 'triangle-out' || section === 'triangle-in'
    ? { along: size, across: (size * Math.sqrt(3)) / 2 }
    : { along: size, across: size };
}

/** How far the section's centre (across) lies from the helix's diameter: in, on or out. */
export function coilSectionShift(section: CoilSection, size: number, position: CoilPosition) {
  const { across } = coilSectionExtent(section, size);
  return position === 'inside' ? -across / 2 : position === 'outside' ? across / 2 : 0;
}

export interface CoilInputOptions {
  plane?: GeomRef;
  type?: CoilType;
  direction?: CoilDirection;
  section?: CoilSection;
  position?: CoilPosition;
  /** Number expressions by input name: `{ diameter: '30 mm', revolutions: '8' }`. */
  numbers?: Readonly<Record<string, string>>;
  operation?: BodyOperation;
  bodies?: string[];
}

/**
 * A coil's inputs from plain options (tests, scripts; the dialog builds the
 * same shape). Expressions get their unit; unknown number names throw.
 */
export function coilInputs(options: CoilInputOptions = {}): CoilInputs {
  const refs = (list: GeomRef[]): RefInput => ({ kind: 'ref', refs: list });
  const inputs: Record<string, unknown> = {};
  const o = options;
  if (o.plane) inputs.plane = refs([o.plane]);
  if (o.type) inputs.type = { kind: 'enum', value: o.type };
  if (o.direction) inputs.direction = { kind: 'enum', value: o.direction };
  if (o.section) inputs.section = { kind: 'enum', value: o.section };
  if (o.position) inputs.position = { kind: 'enum', value: o.position };
  for (const [name, expr] of Object.entries(o.numbers ?? {})) {
    const number = COIL_NUMBERS.find((n) => n.name === name);
    if (!number) throw new Error(`A coil has no number "${name}".`);
    inputs[name] = { kind: 'expr', expr, unit: number.unit } satisfies ExprInput;
  }
  if (o.operation) inputs.operation = { kind: 'enum', value: o.operation };
  if (o.bodies) inputs.bodies = refs(o.bodies.map((id) => ({ kind: 'body', id })));
  return inputs as CoilInputs;
}
