/**
 * The pattern features (P3-07, ADR-0047, FR-FT-11): copies of bodies, or
 * replays of features, in a rectangular, circular or on-path layout.
 *
 * - `rectangularPattern`: along one direction (an axis, straight edge or
 *   sketch line) and optionally a second, each with a count and a distance
 *   (between instances, or from the first to the last), optionally symmetric.
 * - `circularPattern`: about an axis, a count and an angle (the whole angle
 *   or the angle between instances).
 * - `pathPattern`: along sketch curves or edges chained end to end, a count
 *   and a distance, optionally turning each instance to the path's tangent.
 *
 * What is patterned is `objects`: `bodies` (each instance a copy, new bodies
 * or, with `join`, fused into the original) or `features` (the tool of each
 * chosen solid feature, replayed at every instance and joined or cut like
 * the feature did). The **original counts as an instance**: a count of 3
 * makes two new ones. `symmetric` keeps the original in the middle of the
 * series instead of at its start.
 *
 * The layout maths (`seriesOf`, `seriesStep`, `slotOf`) is pure and here, so
 * the kernel and the web app agree on it. The kernel adds evaluators and the
 * web app dialogs, each in its own registry keyed by the type (ADR-0003).
 */
import { z } from 'zod';
import { COIL_TYPE } from './coil';
import { EMBOSS_TYPE } from './emboss';
import { EXTRUDE_TYPE } from './extrude';
import { enumInput, exprOf, refsOf } from './feature-inputs';
import type { FeatureDefinition } from './features';
import { HOLE_TYPE } from './hole';
import { LOFT_TYPE } from './loft';
import { BOX_TYPE, CYLINDER_TYPE, SPHERE_TYPE, TORUS_TYPE } from './primitives';
import { REVOLVE_AXIS_KINDS, REVOLVE_TYPE } from './revolve';
import {
  BoolInputSchema,
  type ExprInput,
  type FeatureInputs,
  type GeomRef,
  type GeomRefKind,
} from './schema';
import { SWEEP_TYPE } from './sweep';

export const RECTANGULAR_PATTERN_TYPE = 'rectangularPattern';
export const CIRCULAR_PATTERN_TYPE = 'circularPattern';
export const PATH_PATTERN_TYPE = 'pathPattern';

export const PATTERN_TYPES = [
  RECTANGULAR_PATTERN_TYPE,
  CIRCULAR_PATTERN_TYPE,
  PATH_PATTERN_TYPE,
] as const;
export type PatternType = (typeof PATTERN_TYPES)[number];

export const PATTERN_OBJECTS = ['bodies', 'features'] as const;
export type PatternObjects = (typeof PATTERN_OBJECTS)[number];

/**
 * The feature types whose tool a pattern (or a mirror) can replay: the ones
 * that make a solid and join or cut it (extrude, revolve, the primitives,
 * sweep, loft and coil since P4-01, an emboss since P4-04) or always cut
 * (a hole, P3-04).
 */
export const PATTERNABLE_FEATURE_TYPES: readonly string[] = [
  EXTRUDE_TYPE,
  REVOLVE_TYPE,
  BOX_TYPE,
  CYLINDER_TYPE,
  SPHERE_TYPE,
  TORUS_TYPE,
  HOLE_TYPE,
  SWEEP_TYPE,
  LOFT_TYPE,
  COIL_TYPE,
  EMBOSS_TYPE,
];

/** What a rectangular pattern goes along and a circular one turns about. */
export const PATTERN_DIRECTION_KINDS: readonly GeomRefKind[] = REVOLVE_AXIS_KINDS;
/** What a path pattern follows: sketch curves and body edges. */
export const PATTERN_PATH_KINDS: readonly GeomRefKind[] = ['sketchEntity', 'edge'];

/** How a distance is read: between neighbours, or from the first instance to the last. */
export const PATTERN_MEASURES = ['spacing', 'extent'] as const;
export type PatternMeasure = (typeof PATTERN_MEASURES)[number];
/** How a circular pattern's angle is read: the whole angle, or the angle between neighbours. */
export const PATTERN_ANGLES = ['total', 'step'] as const;
export type PatternAngle = (typeof PATTERN_ANGLES)[number];

/** The most instances one pattern makes (a guard against `1000 * 1000`). */
export const MAX_PATTERN_INSTANCES = 1000;

const CommonShape = {
  /** Default `bodies`. */
  objects: enumInput(PATTERN_OBJECTS).optional(),
  /** `bodies`: the bodies to copy. */
  bodies: refsOf(['body']).optional(),
  /** `features`: the features whose tools are replayed (`feature` references, feature IDs). */
  features: refsOf(['feature']).optional(),
  /** `bodies`: fuse the copies into the original. Default false. */
  join: BoolInputSchema.optional(),
};

export const RectangularPatternInputsSchema = z.strictObject({
  ...CommonShape,
  direction1: refsOf(PATTERN_DIRECTION_KINDS, 1).optional(),
  /** A whole number, at least 1 (the original counts). Default 2. */
  count1: exprOf('unitless').optional(),
  /** Default 20 mm. */
  distance1: exprOf('length').optional(),
  /** Default `spacing`. */
  measure1: enumInput(PATTERN_MEASURES).optional(),
  symmetric1: BoolInputSchema.optional(),
  /** A second direction makes a grid; missing: a single row. */
  direction2: refsOf(PATTERN_DIRECTION_KINDS, 1).optional(),
  count2: exprOf('unitless').optional(),
  distance2: exprOf('length').optional(),
  measure2: enumInput(PATTERN_MEASURES).optional(),
  symmetric2: BoolInputSchema.optional(),
});
export type RectangularPatternInputs = z.infer<typeof RectangularPatternInputsSchema>;

export const CircularPatternInputsSchema = z.strictObject({
  ...CommonShape,
  axis: refsOf(PATTERN_DIRECTION_KINDS, 1).optional(),
  /** Default 3. */
  count: exprOf('unitless').optional(),
  /** Default 360 deg. */
  angle: exprOf('angle').optional(),
  /** Default `total`. With a whole turn, the instances are spread evenly round it. */
  measure: enumInput(PATTERN_ANGLES).optional(),
  symmetric: BoolInputSchema.optional(),
});
export type CircularPatternInputs = z.infer<typeof CircularPatternInputsSchema>;

export const PathPatternInputsSchema = z.strictObject({
  ...CommonShape,
  /** Sketch curves and edges, chained end to end. */
  path: refsOf(PATTERN_PATH_KINDS).optional(),
  /** Default 3. */
  count: exprOf('unitless').optional(),
  /** Default 20 mm. */
  distance: exprOf('length').optional(),
  /** Default `spacing`. */
  measure: enumInput(PATTERN_MEASURES).optional(),
  /** Turn each instance to the path's direction (default: keep the original's orientation). */
  aligned: BoolInputSchema.optional(),
  /** Walk the path from its other end. */
  flip: BoolInputSchema.optional(),
});
export type PathPatternInputs = z.infer<typeof PathPatternInputsSchema>;

const definition = <I extends FeatureInputs>(
  type: PatternType,
  label: string,
  icon: string,
  inputsSchema: z.ZodType<I>,
): FeatureDefinition<I> => ({ type, label, category: 'modify', icon, inputsSchema });

export const rectangularPatternFeature = definition(
  RECTANGULAR_PATTERN_TYPE,
  'Rectangular Pattern',
  'rectangular-pattern',
  RectangularPatternInputsSchema,
);
export const circularPatternFeature = definition(
  CIRCULAR_PATTERN_TYPE,
  'Circular Pattern',
  'circular-pattern',
  CircularPatternInputsSchema,
);
export const pathPatternFeature = definition(
  PATH_PATTERN_TYPE,
  'Path Pattern',
  'path-pattern',
  PathPatternInputsSchema,
);

/** The `objects` and their references, with defaults filled in. */
export interface PatternObjectSettings {
  objects: PatternObjects;
  /** Body references, each once. */
  bodies: GeomRef[];
  /** Feature references, each once, in the order they were given. */
  features: GeomRef[];
  /** Only for bodies. */
  join: boolean;
}

interface CommonInputs {
  objects?: { value: PatternObjects } | undefined;
  bodies?: { refs: GeomRef[] } | undefined;
  features?: { refs: GeomRef[] } | undefined;
  join?: { value: boolean } | undefined;
}

const once = (refs: readonly GeomRef[] | undefined): GeomRef[] => {
  const seen = new Set<string>();
  return (refs ?? []).filter((ref) => !seen.has(ref.id) && seen.add(ref.id));
};

/** What a pattern (or a mirror) works on, from its inputs. */
export function patternObjects(inputs: CommonInputs): PatternObjectSettings {
  const objects = inputs.objects?.value ?? 'bodies';
  return {
    objects,
    bodies: once(inputs.bodies?.refs),
    features: once(inputs.features?.refs),
    join: objects === 'bodies' && (inputs.join?.value ?? false),
  };
}

// ---------------------------------------------------------------- layout

/**
 * Where the instances of a series are, as indices: `count` of them, the
 * original at index 0, or (symmetric) in the middle with the extra one on
 * the far side for an even count. `-2…2` for 5 symmetric, `-1…2` for 4,
 * `0…3` for 4 that are not.
 */
export function seriesOf(count: number, symmetric: boolean): number[] {
  const first = symmetric ? -Math.floor((count - 1) / 2) : 0;
  return Array.from({ length: count }, (_, i) => first + i);
}

/**
 * The step between neighbours: `distance` itself, or (measure `extent`) the
 * distance divided into `count - 1` steps.
 */
export function seriesStep(count: number, distance: number, measure: PatternMeasure): number {
  return measure === 'extent' ? (count > 1 ? distance / (count - 1) : 0) : distance;
}

/**
 * The step of a circular pattern in the unit of `angle`: the angle itself
 * (`step`), or the whole angle divided among the instances: a whole turn
 * (360 or more, either way) into `count` equal parts (the last instance
 * doesn't land on the first), anything less into `count - 1` (the last
 * instance ends the angle).
 */
export function angularStep(
  count: number,
  angle: number,
  measure: PatternAngle,
  turn = 360,
): number {
  if (measure === 'step') return angle;
  if (count <= 1) return 0;
  return Math.abs(angle) >= turn - 1e-9 ? angle / count : angle / (count - 1);
}

/** A whole number ≥ 0 for any whole number: 0, -1, 1, -2, 2 … become 0, 1, 2, 3, 4 … */
const zigzag = (k: number) => (k >= 0 ? 2 * k : -2 * k - 1);

/**
 * A number for an instance that doesn't change when the counts around it
 * do (Cantor pairing of the zigzagged indices): it makes body IDs
 * (`<feature>:<n>`) and instance names stable while the pattern grows.
 */
export function slotOf(i: number, j = 0): number {
  const a = zigzag(i);
  const b = zigzag(j);
  return ((a + b) * (a + b + 1)) / 2 + b;
}

/**
 * A whole number for a pair of whole numbers ≥ 0 (Cantor pairing), for the
 * body ID of copy `b` of the instance in slot `a`.
 */
export const pairSlots = (a: number, b: number): number => ((a + b) * (a + b + 1)) / 2 + b;

/** An instance's label in a name: `2`, `m1` for -1, and `2x1` for a grid position. */
export function instanceLabel(i: number, j?: number): string {
  const one = (k: number) => (k < 0 ? `m${-k}` : String(k));
  return j === undefined ? one(i) : `${one(i)}x${one(j)}`;
}

// ------------------------------------------------------------- settings

export interface Series {
  count: number;
  distance: number;
  measure: PatternMeasure;
  symmetric: boolean;
}

/** A rectangular pattern's inputs with the defaults filled in (values in mm come from the kernel). */
export interface RectangularSettings extends PatternObjectSettings {
  direction1: GeomRef | undefined;
  direction2: GeomRef | undefined;
  measure1: PatternMeasure;
  measure2: PatternMeasure;
  symmetric1: boolean;
  symmetric2: boolean;
}

export function rectangularSettings(inputs: RectangularPatternInputs): RectangularSettings {
  return {
    ...patternObjects(inputs),
    direction1: inputs.direction1?.refs[0],
    direction2: inputs.direction2?.refs[0],
    measure1: inputs.measure1?.value ?? 'spacing',
    measure2: inputs.measure2?.value ?? 'spacing',
    symmetric1: inputs.symmetric1?.value ?? false,
    symmetric2: inputs.symmetric2?.value ?? false,
  };
}

export interface CircularSettings extends PatternObjectSettings {
  axis: GeomRef | undefined;
  measure: PatternAngle;
  symmetric: boolean;
}

export function circularSettings(inputs: CircularPatternInputs): CircularSettings {
  return {
    ...patternObjects(inputs),
    axis: inputs.axis?.refs[0],
    measure: inputs.measure?.value ?? 'total',
    symmetric: inputs.symmetric?.value ?? false,
  };
}

export interface PathSettings extends PatternObjectSettings {
  /** Path references, each once, in the order given. */
  path: GeomRef[];
  measure: PatternMeasure;
  aligned: boolean;
  flip: boolean;
}

export function pathSettings(inputs: PathPatternInputs): PathSettings {
  return {
    ...patternObjects(inputs),
    path: once(inputs.path?.refs),
    measure: inputs.measure?.value ?? 'spacing',
    aligned: inputs.aligned?.value ?? false,
    flip: inputs.flip?.value ?? false,
  };
}

// --------------------------------------------------------------- builders

/** What the option objects of the builders take, for tests and scripts (the dialogs build the same shapes). */
export interface PatternObjectOptions {
  /** Body IDs to copy (default when no `features`). */
  bodies?: readonly string[];
  /** Feature IDs whose tools to replay: makes `objects` `features`. */
  features?: readonly string[];
  join?: boolean;
}

function objectInputs(options: PatternObjectOptions): CommonShapeInputs {
  const out: CommonShapeInputs = {};
  if (options.features) out.objects = { kind: 'enum', value: 'features' };
  if (options.bodies) {
    out.bodies = { kind: 'ref', refs: options.bodies.map((id): GeomRef => ({ kind: 'body', id })) };
  }
  if (options.features) {
    out.features = {
      kind: 'ref',
      refs: options.features.map((id): GeomRef => ({ kind: 'feature', id })),
    };
  }
  if (options.join !== undefined) out.join = { kind: 'bool', value: options.join };
  return out;
}

type CommonShapeInputs = Partial<
  Pick<RectangularPatternInputs, 'objects' | 'bodies' | 'features' | 'join'>
>;

const expr = (value: string, unit: 'length' | 'angle' | 'unitless'): ExprInput => ({
  kind: 'expr',
  expr: value,
  unit,
});
const refTo = (ref: GeomRef) => ({ kind: 'ref' as const, refs: [ref] });

export interface RectangularOptions extends PatternObjectOptions {
  direction1?: GeomRef;
  /** Expressions: `'4'`, `'20 mm'`. */
  count1?: string;
  distance1?: string;
  measure1?: PatternMeasure;
  symmetric1?: boolean;
  direction2?: GeomRef;
  count2?: string;
  distance2?: string;
  measure2?: PatternMeasure;
  symmetric2?: boolean;
}

export function rectangularPatternInputs(options: RectangularOptions): RectangularPatternInputs {
  const o = options;
  const inputs: RectangularPatternInputs = objectInputs(o);
  if (o.direction1) inputs.direction1 = refTo(o.direction1);
  if (o.count1 !== undefined) inputs.count1 = expr(o.count1, 'unitless');
  if (o.distance1 !== undefined) inputs.distance1 = expr(o.distance1, 'length');
  if (o.measure1) inputs.measure1 = { kind: 'enum', value: o.measure1 };
  if (o.symmetric1 !== undefined) inputs.symmetric1 = { kind: 'bool', value: o.symmetric1 };
  if (o.direction2) inputs.direction2 = refTo(o.direction2);
  if (o.count2 !== undefined) inputs.count2 = expr(o.count2, 'unitless');
  if (o.distance2 !== undefined) inputs.distance2 = expr(o.distance2, 'length');
  if (o.measure2) inputs.measure2 = { kind: 'enum', value: o.measure2 };
  if (o.symmetric2 !== undefined) inputs.symmetric2 = { kind: 'bool', value: o.symmetric2 };
  return inputs;
}

export interface CircularOptions extends PatternObjectOptions {
  axis?: GeomRef;
  count?: string;
  angle?: string;
  measure?: PatternAngle;
  symmetric?: boolean;
}

export function circularPatternInputs(options: CircularOptions): CircularPatternInputs {
  const o = options;
  const inputs: CircularPatternInputs = objectInputs(o);
  if (o.axis) inputs.axis = refTo(o.axis);
  if (o.count !== undefined) inputs.count = expr(o.count, 'unitless');
  if (o.angle !== undefined) inputs.angle = expr(o.angle, 'angle');
  if (o.measure) inputs.measure = { kind: 'enum', value: o.measure };
  if (o.symmetric !== undefined) inputs.symmetric = { kind: 'bool', value: o.symmetric };
  return inputs;
}

export interface PathOptions extends PatternObjectOptions {
  path?: readonly GeomRef[];
  count?: string;
  distance?: string;
  measure?: PatternMeasure;
  aligned?: boolean;
  flip?: boolean;
}

export function pathPatternInputs(options: PathOptions): PathPatternInputs {
  const o = options;
  const inputs: PathPatternInputs = objectInputs(o);
  if (o.path) inputs.path = { kind: 'ref', refs: [...o.path] };
  if (o.count !== undefined) inputs.count = expr(o.count, 'unitless');
  if (o.distance !== undefined) inputs.distance = expr(o.distance, 'length');
  if (o.measure) inputs.measure = { kind: 'enum', value: o.measure };
  if (o.aligned !== undefined) inputs.aligned = { kind: 'bool', value: o.aligned };
  if (o.flip !== undefined) inputs.flip = { kind: 'bool', value: o.flip };
  return inputs;
}
