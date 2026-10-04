/**
 * The primitive features (P2-10, ADR-0032, FR-FT-03): a box, a cylinder, a
 * sphere and a torus, each a parametric feature of its own type, placed on
 * an origin plane or a flat face. The kernel adds their evaluators and the
 * web app their dialogs, each in its own registry keyed by the types here
 * (ADR-0003).
 *
 * **Placement** is shared by all four: a plane (`plane`: an origin plane,
 * or a flat face of a body) gives a frame, the one a sketch on it gets
 * (`faceSketchFrame` for a face, ADR-0031); `x` and `y` put the primitive's
 * centre in that frame and `offset` lifts it off the plane along its
 * normal. A box can also turn about the normal (`rotation`). Sizes are the
 * primitive's own:
 *
 * | Type | Sizes | Sits |
 * |---|---|---|
 * | `box` | `length` (along the frame's X), `width` (Y), `height` (normal) | centred on the point, from the plane up |
 * | `cylinder` | `diameter`, `height` (normal) | its base centred on the point |
 * | `sphere` | `diameter` | centred on the point |
 * | `torus` | `diameter` (through the tube's centre), `tube` (the tube's diameter) | centred on the point, about the normal |
 *
 * A negative height puts a box or a cylinder below the plane (a cut into a
 * face). Every input is optional and has a default, so a minimal box is
 * `{}`: a 20 mm cube on the XY plane at the origin, a new body.
 */
import { BODY_OPERATIONS, type BodyOperation, enumInput, exprOf, refsOf } from './feature-inputs';
import type { FeatureDefinition } from './features';
import type { ExprInput, GeomRef, GeomRefKind, RefInput, UnitKind } from './schema';
import { originPlaneRef } from './sketch/planes';
import { z } from './zod';

export const BOX_TYPE = 'box';
export const CYLINDER_TYPE = 'cylinder';
export const SPHERE_TYPE = 'sphere';
export const TORUS_TYPE = 'torus';

export const PRIMITIVE_TYPES = [BOX_TYPE, CYLINDER_TYPE, SPHERE_TYPE, TORUS_TYPE] as const;
export type PrimitiveType = (typeof PRIMITIVE_TYPES)[number];

export function isPrimitiveType(type: string): type is PrimitiveType {
  return (PRIMITIVE_TYPES as readonly string[]).includes(type);
}

/** What a primitive can sit on: an origin plane (later construction planes) or a flat face. */
export const PLACEMENT_KINDS: readonly GeomRefKind[] = ['plane', 'face'];

/** Where a primitive sits without a `plane` input: the XY plane. */
export const DEFAULT_PLACEMENT: GeomRef = originPlaneRef('origin:xy');

/** The body operations (`BODY_OPERATIONS`): new body, join, cut, intersect. */
export const PRIMITIVE_OPERATIONS = BODY_OPERATIONS;
export type PrimitiveOperation = BodyOperation;

/** One number input of a primitive: its size, or where it sits. */
export interface PrimitiveNumber {
  /** The input's name. */
  name: string;
  label: string;
  unit: UnitKind;
  /** The expression the dialog starts with. */
  default: string;
  /** Its value in mm or degrees: what the kernel uses without the input. */
  value: number;
  /** A size that must be greater than 0 (a height may be negative instead). */
  positive?: boolean;
}

const size = (name: string, label: string, value: number, positive = true): PrimitiveNumber => ({
  name,
  label,
  unit: 'length',
  default: `${value} mm`,
  value,
  ...(positive && { positive }),
});

/** Each primitive's sizes, in the order its dialog lists them. */
export const PRIMITIVE_SIZES: Readonly<Record<PrimitiveType, readonly PrimitiveNumber[]>> = {
  box: [
    size('length', 'Length', 20),
    size('width', 'Width', 20),
    size('height', 'Height', 20, false),
  ],
  cylinder: [size('diameter', 'Diameter', 20), size('height', 'Height', 20, false)],
  sphere: [size('diameter', 'Diameter', 20)],
  torus: [size('diameter', 'Diameter', 40), size('tube', 'Tube diameter', 10)],
};

/** Where a primitive sits in its plane's frame, shared by all four; `rotation` is the box's only. */
export const PLACEMENT_NUMBERS: readonly PrimitiveNumber[] = [
  size('x', 'X', 0, false),
  size('y', 'Y', 0, false),
  size('offset', 'Offset', 0, false),
];

/** A box's turn about the plane's normal (right-handed), from the frame's X. */
export const BOX_ROTATION: PrimitiveNumber = {
  name: 'rotation',
  label: 'Rotation',
  unit: 'angle',
  default: '0 deg',
  value: 0,
};

/** Every number input of a primitive type: sizes, then placement (and a box's rotation). */
export function primitiveNumbers(type: PrimitiveType): readonly PrimitiveNumber[] {
  return [
    ...PRIMITIVE_SIZES[type],
    ...PLACEMENT_NUMBERS,
    ...(type === BOX_TYPE ? [BOX_ROTATION] : []),
  ];
}

const placementShape = {
  /**
   * The plane it sits on: an origin plane or a flat face of a body. Missing
   * or empty: the XY plane (`DEFAULT_PLACEMENT`).
   */
  plane: refsOf(PLACEMENT_KINDS, 1).optional(),
  /** The centre's place along the plane frame's X and Y, default 0. */
  x: exprOf('length').optional(),
  y: exprOf('length').optional(),
  /** How far the base (a sphere's or torus's centre) sits off the plane along its normal, default 0. */
  offset: exprOf('length').optional(),
  /** Default `new-body`. */
  operation: enumInput(PRIMITIVE_OPERATIONS).optional(),
  /**
   * The bodies to join, cut or intersect (`body` references, body IDs).
   * Empty or missing: every body the primitive touches (join) or overlaps
   * (cut, intersect).
   */
  bodies: refsOf(['body']).optional(),
};

const length = () => exprOf('length').optional();

export const BoxInputsSchema = z.strictObject({
  ...placementShape,
  /** Along the plane frame's X (turned by `rotation`); default 20 mm. */
  length: length(),
  /** Along the frame's Y; default 20 mm. */
  width: length(),
  /** Along the plane's normal from the base; negative goes below the plane. Default 20 mm. */
  height: length(),
  /** Turns the box about the normal through its centre; default 0°. */
  rotation: exprOf('angle').optional(),
});
export type BoxInputs = z.infer<typeof BoxInputsSchema>;

export const CylinderInputsSchema = z.strictObject({
  ...placementShape,
  /** Default 20 mm. */
  diameter: length(),
  /** Along the plane's normal from the base; negative goes below the plane. Default 20 mm. */
  height: length(),
});
export type CylinderInputs = z.infer<typeof CylinderInputsSchema>;

export const SphereInputsSchema = z.strictObject({
  ...placementShape,
  /** Default 20 mm. */
  diameter: length(),
});
export type SphereInputs = z.infer<typeof SphereInputsSchema>;

export const TorusInputsSchema = z.strictObject({
  ...placementShape,
  /** Through the tube's centre line; default 40 mm. */
  diameter: length(),
  /** The tube's own diameter, smaller than `diameter`; default 10 mm. */
  tube: length(),
});
export type TorusInputs = z.infer<typeof TorusInputsSchema>;

export type PrimitiveInputs = BoxInputs | CylinderInputs | SphereInputs | TorusInputs;

const definition = <I extends PrimitiveInputs>(
  type: PrimitiveType,
  label: string,
  inputsSchema: z.ZodType<I>,
): FeatureDefinition<I> => ({ type, label, category: 'create', icon: type, inputsSchema });

export const boxFeature = definition(BOX_TYPE, 'Box', BoxInputsSchema);
export const cylinderFeature = definition(CYLINDER_TYPE, 'Cylinder', CylinderInputsSchema);
export const sphereFeature = definition(SPHERE_TYPE, 'Sphere', SphereInputsSchema);
export const torusFeature = definition(TORUS_TYPE, 'Torus', TorusInputsSchema);

/** The four definitions, by type. */
export const PRIMITIVE_FEATURES: Readonly<Record<PrimitiveType, FeatureDefinition>> = {
  box: boxFeature as FeatureDefinition,
  cylinder: cylinderFeature as FeatureDefinition,
  sphere: sphereFeature as FeatureDefinition,
  torus: torusFeature as FeatureDefinition,
};

/** A primitive's inputs with every default filled in, but for its numbers. */
export interface PrimitiveSettings {
  plane: GeomRef;
  operation: PrimitiveOperation;
  /** Explicit participants (body IDs); empty means automatic. */
  bodies: string[];
  /**
   * The `expr` inputs present, by name (the kernel reads their values);
   * a number without one takes its `PrimitiveNumber.value`.
   */
  exprs: ReadonlySet<string>;
}

/** Reads a primitive's (valid) inputs with their defaults. */
export function primitiveSettings(inputs: PrimitiveInputs): PrimitiveSettings {
  const exprs = new Set<string>();
  for (const [name, input] of Object.entries(inputs)) {
    if ((input as { kind?: string } | undefined)?.kind === 'expr') exprs.add(name);
  }
  return {
    plane: inputs.plane?.refs[0] ?? DEFAULT_PLACEMENT,
    operation: inputs.operation?.value ?? 'new-body',
    bodies: (inputs.bodies?.refs ?? []).map((ref) => ref.id),
    exprs,
  };
}

export interface PrimitiveInputOptions {
  /** An origin plane or a face; default the XY plane (no input). */
  plane?: GeomRef;
  /** Size and placement expressions by input name: `{ length: '30 mm', x: '5 mm' }`. */
  numbers?: Readonly<Record<string, string>>;
  operation?: PrimitiveOperation;
  bodies?: string[];
}

/**
 * A primitive's inputs from plain options (tests, scripts; the dialog builds
 * the same shape). Expressions get their unit; `paramName`s are left to the
 * caller, as for any feature. Unknown number names throw.
 */
export function primitiveInputs(
  type: PrimitiveType,
  options: PrimitiveInputOptions = {},
): PrimitiveInputs {
  const refs = (list: GeomRef[]): RefInput => ({ kind: 'ref', refs: list });
  const inputs: Record<string, unknown> = {};
  if (options.plane) inputs.plane = refs([options.plane]);
  const numbers = primitiveNumbers(type);
  for (const [name, expr] of Object.entries(options.numbers ?? {})) {
    const number = numbers.find((n) => n.name === name);
    if (!number) throw new Error(`A ${type} has no number "${name}".`);
    inputs[name] = { kind: 'expr', expr, unit: number.unit } satisfies ExprInput;
  }
  if (options.operation) inputs.operation = { kind: 'enum', value: options.operation };
  if (options.bodies) inputs.bodies = refs(options.bodies.map((id) => ({ kind: 'body', id })));
  return inputs as PrimitiveInputs;
}
