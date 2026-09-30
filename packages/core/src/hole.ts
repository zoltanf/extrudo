/**
 * The hole feature (P3-04, ADR-0049, FR-FT-07): drills holes into the bodies
 * below a plane or a flat face, at the points of a sketch or at a clicked
 * point. The kernel adds its evaluator and the web app its dialog, each in
 * its own registry keyed by `HOLE_TYPE` (ADR-0003).
 *
 * **Placement.** `plane` (an origin or construction plane, or a flat face;
 * missing: the XY plane) is where the holes start and gives their
 * direction: into a face (against its outward normal), or against a plane's
 * normal; `flip` reverses it. The holes sit at
 *
 * - the sketch points in `points` (references `<sketch>/<point>` of kind
 *   `sketchEntity`), each dropped straight onto the plane, so a sketch on
 *   the face, or on a parallel plane, both work; or, with no points,
 * - the one point `x`, `y` in the plane's sketch frame (the frame a sketch
 *   on it gets, `faceSketchFrame`): what a click on the face stores, like a
 *   primitive's placement.
 *
 * **Shape.** `type` is `simple`, `counterbore` (a wider, flat-bottomed step
 * at the top: `cbDiameter`, `cbDepth`) or `countersink` (a cone at the top:
 * `csDiameter` at the surface, `csAngle` its full opening angle). `extent`
 * is `blind` (`depth` measured from the plane to the end of the full
 * diameter; a drill point of `tipAngle` degrees adds a cone beyond it, 0 for
 * a flat bottom) or `through` (every body along the way, no depth).
 *
 * Every number is optional and has a default (`HOLE_DEFAULTS`), so a minimal
 * hole is `{}`: a 5 mm blind hole, 10 mm deep, in the XY plane at the origin.
 * The hole always cuts: it makes no body of its own.
 */
import { z } from 'zod';
import { enumInput, exprOf, refsOf } from './feature-inputs';
import type { FeatureDefinition } from './features';
import {
  BoolInputSchema,
  type ExprInput,
  type GeomRef,
  type GeomRefKind,
  type RefInput,
} from './schema';
import { originPlaneRef } from './sketch/planes';

export const HOLE_TYPE = 'hole';

/** The three shapes of hole. */
export const HOLE_KINDS = ['simple', 'counterbore', 'countersink'] as const;
export type HoleKind = (typeof HOLE_KINDS)[number];

/** How far a hole goes. */
export const HOLE_EXTENTS = ['blind', 'through'] as const;
export type HoleExtent = (typeof HOLE_EXTENTS)[number];

/** What a hole starts on: an origin or construction plane, or a flat face. */
export const HOLE_PLANE_KINDS: readonly GeomRefKind[] = ['plane', 'face'];
/** Where the holes go: sketch points. */
export const HOLE_POINT_KINDS: readonly GeomRefKind[] = ['sketchEntity'];

/** Where a hole starts without a `plane` input: the XY plane. */
export const HOLE_DEFAULT_PLANE: GeomRef = originPlaneRef('origin:xy');

/** One number input of a hole. */
export interface HoleNumber {
  name: string;
  label: string;
  unit: 'length' | 'angle';
  /** The expression the dialog starts with. */
  default: string;
  /** Its value in mm or degrees: what the kernel uses without the input. */
  value: number;
}

const length = (name: string, label: string, value: number): HoleNumber => ({
  name,
  label,
  unit: 'length',
  default: `${value} mm`,
  value,
});
const angle = (name: string, label: string, value: number): HoleNumber => ({
  name,
  label,
  unit: 'angle',
  default: `${value} deg`,
  value,
});

/** Every number input, in the order the dialog lists them. */
export const HOLE_NUMBERS: readonly HoleNumber[] = [
  length('x', 'X', 0),
  length('y', 'Y', 0),
  length('diameter', 'Diameter', 5),
  length('depth', 'Depth', 10),
  angle('tipAngle', 'Drill point', 118),
  length('cbDiameter', 'Counterbore diameter', 10),
  length('cbDepth', 'Counterbore depth', 4),
  length('csDiameter', 'Countersink diameter', 10),
  angle('csAngle', 'Countersink angle', 90),
];

export const HOLE_DEFAULTS: Readonly<Record<string, number>> = Object.fromEntries(
  HOLE_NUMBERS.map((n) => [n.name, n.value]),
);

const optionalLength = () => exprOf('length').optional();
const optionalAngle = () => exprOf('angle').optional();

export const HoleInputsSchema = z.strictObject({
  /** Where the holes start; missing or empty: the XY plane. */
  plane: refsOf(HOLE_PLANE_KINDS, 1).optional(),
  /** Sketch points (`<sketch>/<point>`). With none, the hole is at `x`, `y`. */
  points: refsOf(HOLE_POINT_KINDS).optional(),
  /** The one hole's place in the plane's sketch frame, default 0 (without `points`). */
  x: optionalLength(),
  y: optionalLength(),
  /** Default `simple`. */
  type: enumInput(HOLE_KINDS).optional(),
  /** Default `blind`. */
  extent: enumInput(HOLE_EXTENTS).optional(),
  /** Default 5 mm. */
  diameter: optionalLength(),
  /** Blind: from the plane to the end of the full diameter; default 10 mm. */
  depth: optionalLength(),
  /** Blind: the drill point's full angle, 0° for a flat bottom; default 118°. */
  tipAngle: optionalAngle(),
  /** Counterbore: the step's diameter (default 10 mm) and depth (default 4 mm). */
  cbDiameter: optionalLength(),
  cbDepth: optionalLength(),
  /** Countersink: the cone's diameter at the surface (default 10 mm) and full angle (default 90°). */
  csDiameter: optionalLength(),
  csAngle: optionalAngle(),
  /** Drill the other way: against a face's inward direction. */
  flip: BoolInputSchema.optional(),
});
export type HoleInputs = z.infer<typeof HoleInputsSchema>;

export const holeFeature: FeatureDefinition<HoleInputs> = {
  type: HOLE_TYPE,
  label: 'Hole',
  category: 'create',
  icon: 'hole',
  inputsSchema: HoleInputsSchema,
};

/** A hole's inputs with the defaults filled in, but for its numbers. */
export interface HoleSettings {
  plane: GeomRef;
  /** Sketch point references, in the order picked. */
  points: GeomRef[];
  type: HoleKind;
  extent: HoleExtent;
  flip: boolean;
  /** The `expr` inputs present, by name; a number without one takes `HOLE_DEFAULTS`. */
  exprs: ReadonlySet<string>;
}

/** Reads a hole's (valid) inputs with their defaults. */
export function holeSettings(inputs: HoleInputs): HoleSettings {
  const exprs = new Set<string>();
  for (const [name, input] of Object.entries(inputs)) {
    if ((input as { kind?: string } | undefined)?.kind === 'expr') exprs.add(name);
  }
  return {
    plane: inputs.plane?.refs[0] ?? HOLE_DEFAULT_PLANE,
    points: inputs.points?.refs ?? [],
    type: inputs.type?.value ?? 'simple',
    extent: inputs.extent?.value ?? 'blind',
    flip: inputs.flip?.value ?? false,
    exprs,
  };
}

export interface HoleInputOptions {
  plane?: GeomRef;
  /** Sketch point references (kind `sketchEntity`). */
  points?: GeomRef[];
  /** Number expressions by input name: `{ diameter: '4.5 mm', tipAngle: '90 deg' }`. */
  numbers?: Readonly<Record<string, string>>;
  type?: HoleKind;
  extent?: HoleExtent;
  flip?: boolean;
}

/**
 * A hole's inputs from plain options (tests, scripts; the dialog builds the
 * same shape). Expressions get their unit; unknown number names throw.
 */
export function holeInputs(options: HoleInputOptions = {}): HoleInputs {
  const refs = (list: GeomRef[]): RefInput => ({ kind: 'ref', refs: list });
  const inputs: Record<string, unknown> = {};
  if (options.plane) inputs.plane = refs([options.plane]);
  if (options.points) inputs.points = refs(options.points);
  for (const [name, expr] of Object.entries(options.numbers ?? {})) {
    const number = HOLE_NUMBERS.find((n) => n.name === name);
    if (!number) throw new Error(`A hole has no number "${name}".`);
    inputs[name] = { kind: 'expr', expr, unit: number.unit } satisfies ExprInput;
  }
  if (options.type) inputs.type = { kind: 'enum', value: options.type };
  if (options.extent) inputs.extent = { kind: 'enum', value: options.extent };
  if (options.flip !== undefined) inputs.flip = { kind: 'bool', value: options.flip };
  return inputs as HoleInputs;
}

// ------------------------------------------------------------------ presets

/**
 * A hole preset: what choosing it fills into the dialog's fields
 * (ADR-0049). Presets aren't stored in the document: the inputs hold the
 * plain values, so a preset can be revised without touching a design.
 */
export interface HolePreset {
  id: string;
  label: string;
  group: 'clearance' | 'insert';
  /** Expressions for the number fields, by input name. */
  exprs: Readonly<Record<string, string>>;
  /** Values for the dropdowns (`type`, `extent`), by input name. */
  choices?: Readonly<Record<string, string>>;
}

/**
 * Clearance for a metric screw, the **normal fit** of ISO 273's medium
 * series (the hole a bolt goes through with room to spare), with the
 * counterbore of an ISO 4762 socket head (head diameter and height plus
 * 0.5 and 0.3 mm) and the countersink of an ISO 10642 flat head (90°).
 * `[size, hole, counterbore Ø, counterbore depth, countersink Ø]` in mm.
 */
const CLEARANCE: readonly (readonly [string, number, number, number, number])[] = [
  ['M2', 2.4, 4.4, 2.2, 4.4],
  ['M2.5', 2.9, 5, 2.7, 5.5],
  ['M3', 3.4, 6, 3.3, 6.7],
  ['M4', 4.5, 7.5, 4.3, 9],
  ['M5', 5.5, 9, 5.3, 11.2],
  ['M6', 6.6, 10.5, 6.3, 13.4],
  ['M8', 9, 13.5, 8.3, 17.9],
];

/**
 * Holes for brass heat-set (thread) inserts pushed in with a soldering iron:
 * the hole a little under the insert's outside diameter, deep enough for the
 * insert plus room for the melted plastic, with a flat bottom. Typical
 * values for common inserts: check them against the ones you buy.
 * `[size, hole Ø, depth]` in mm.
 */
const INSERTS: readonly (readonly [string, number, number])[] = [
  ['M2', 3.2, 4.5],
  ['M2.5', 3.6, 5.5],
  ['M3', 4, 6.5],
  ['M4', 5.6, 8.5],
  ['M5', 6.4, 10.5],
];

const mm = (value: number) => `${value} mm`;

export const HOLE_PRESETS: readonly HolePreset[] = [
  ...CLEARANCE.map(
    ([size, hole, cb, cbDepth, cs]): HolePreset => ({
      id: `${size.toLowerCase()}-clearance`,
      label: `${size} clearance`,
      group: 'clearance',
      exprs: {
        diameter: mm(hole),
        cbDiameter: mm(cb),
        cbDepth: mm(cbDepth),
        csDiameter: mm(cs),
        csAngle: '90 deg',
      },
    }),
  ),
  ...INSERTS.map(
    ([size, hole, depth]): HolePreset => ({
      id: `${size.toLowerCase()}-insert`,
      label: `${size} heat-set insert`,
      group: 'insert',
      exprs: { diameter: mm(hole), depth: mm(depth), tipAngle: '0 deg' },
      choices: { type: 'simple', extent: 'blind' },
    }),
  ),
];

/** The preset with this ID. */
export function holePreset(id: string): HolePreset | undefined {
  return HOLE_PRESETS.find((p) => p.id === id);
}
