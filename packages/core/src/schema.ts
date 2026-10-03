/**
 * The document schema, format version 1 (architecture §4.1).
 *
 * The document is plain JSON and the only source of truth; geometry is derived
 * from it (ADR-0003). Objects are strict, so validation names every key it
 * doesn't know. Adding an optional field is backward compatible and needs no
 * version bump; everything else does. `loadDocument` reads unknown keys
 * leniently (P3-13): an older Extrudo leaves out what a newer one added and
 * says so, instead of refusing the file.
 */
import { z } from 'zod';
import { FORMAT_NAME, FORMAT_VERSION } from './format';
import { PARAMETER_NAME } from './names';
import { GeomRefSchema, Vec3Schema } from './refs';
import { SketchDataSchema } from './sketch/schema';

export { PARAMETER_NAME } from './names';
export * from './refs';

import {
  BodyIdSchema,
  ConfigurationIdSchema,
  DocumentIdSchema,
  FeatureIdSchema,
  ParameterIdSchema,
  ViewIdSchema,
} from './ids';

export const LengthUnitSchema = z.enum(['mm', 'cm', 'm', 'in']);
export type LengthUnit = z.infer<typeof LengthUnitSchema>;

/** What a parameter or expression measures; P0-07 checks expressions against it. */
export const UnitKindSchema = z.enum(['length', 'angle', 'unitless']);
export type UnitKind = z.infer<typeof UnitKindSchema>;

/**
 * How an exposed parameter shows in the customizer panel (P4-07, ADR-0059 §1):
 * the object being present is what exposes it. `min`, `max` and `step` are the
 * slider's range in the parameter's **base unit** (mm, degrees, or plain), not
 * a constraint: a value outside `[min, max]` is allowed and the panel warns
 * about it. `group` is a heading in the panel; without one the parameter sits
 * at the top, and ungrouped parameters come before the groups (which are in
 * order of first appearance).
 */
export const CustomizerSchema = z.strictObject({
  min: z.number().optional(),
  max: z.number().optional(),
  /** Slider step in the base unit; must be positive. */
  step: z.number().positive().optional(),
  group: z.string().min(1).max(40).optional(),
});
export type Customizer = z.infer<typeof CustomizerSchema>;

export const ParameterSchema = z.strictObject({
  id: ParameterIdSchema,
  name: z.string().regex(PARAMETER_NAME, 'must be a letter or _ followed by letters, digits or _'),
  expression: z.string(),
  unit: UnitKindSchema,
  comment: z.string().optional(),
  /** Present = the parameter is shown in the customizer panel (P4-07). */
  customizer: CustomizerSchema.optional(),
});
export type Parameter = z.infer<typeof ParameterSchema>;

/**
 * A saved set of parameter values (P4-07, ADR-0059 §2): a named row of the
 * customizer's configuration list. Applying one sets the expression of every
 * parameter it lists; there is **no** stored "active" configuration, because
 * one goes stale after any edit or undo (`currentConfigurations` matches the
 * values instead). A value may name a parameter that no longer exists: it is
 * ignored when applying (`configurationChanges`).
 */
/** A configuration's values: a parameter ID → the expression it sets for it. */
export const ConfigurationValuesSchema = z.record(ParameterIdSchema, z.string());
export type ConfigurationValues = z.infer<typeof ConfigurationValuesSchema>;

export const ConfigurationSchema = z.strictObject({
  id: ConfigurationIdSchema,
  name: z.string().min(1).max(60),
  /** Parameter ID → the expression this configuration sets for it. */
  values: ConfigurationValuesSchema,
});
export type Configuration = z.infer<typeof ConfigurationSchema>;

/** How configuration names are compared: trimmed and folded to lower case. */
const configurationKey = (name: string) => name.trim().toLowerCase();

/**
 * Whether two configuration names are the same to a reader: "Small box" and
 * " small box " are (ADR-0059 §2). Commands refuse a second one with a name
 * like this; the schema reports it for a document that has one anyway.
 */
export function sameConfigurationName(a: string, b: string): boolean {
  return configurationKey(a) === configurationKey(b);
}

export const ExprInputSchema = z.strictObject({
  kind: z.literal('expr'),
  expr: z.string(),
  /** The model parameter (`d17`) this input shows up as in the parameters table. */
  paramName: z.string().regex(PARAMETER_NAME).optional(),
  /** What the input measures. Defaults to `length`, the common case. */
  unit: UnitKindSchema.optional(),
});
export const EnumInputSchema = z.strictObject({ kind: z.literal('enum'), value: z.string() });
export const BoolInputSchema = z.strictObject({ kind: z.literal('bool'), value: z.boolean() });
export const RefInputSchema = z.strictObject({
  kind: z.literal('ref'),
  refs: z.array(GeomRefSchema),
});
/** A sketch's 2D content (`sketch/schema.ts`); its plane is a separate `ref` input. */
export const SketchDataInputSchema = z.strictObject({
  kind: z.literal('sketchData'),
  sketch: SketchDataSchema,
});

/** One feature input. Every number is an expression; there is no raw-number kind. */
export const InputSchema = z.discriminatedUnion('kind', [
  ExprInputSchema,
  EnumInputSchema,
  BoolInputSchema,
  RefInputSchema,
  SketchDataInputSchema,
]);
export type Input = z.infer<typeof InputSchema>;
export type ExprInput = z.infer<typeof ExprInputSchema>;
export type EnumInput = z.infer<typeof EnumInputSchema>;
export type BoolInput = z.infer<typeof BoolInputSchema>;
export type RefInput = z.infer<typeof RefInputSchema>;
export type SketchDataInput = z.infer<typeof SketchDataInputSchema>;

export const FeatureInputsSchema = z.record(z.string(), InputSchema);
export type FeatureInputs = z.infer<typeof FeatureInputsSchema>;

/**
 * One timeline entry. `type` is open-ended: the feature registry (`features.ts`)
 * knows the types and checks `inputs` per type.
 */
export const FeatureSchema = z.strictObject({
  id: FeatureIdSchema,
  type: z.string().min(1),
  name: z.string().min(1),
  suppressed: z.boolean(),
  /** `false` hides the feature's own geometry (a sketch's curves) in the view (P1-12). Absent means shown. */
  visible: z.boolean().optional(),
  inputs: FeatureInputsSchema,
});
export type Feature = z.infer<typeof FeatureSchema>;

/**
 * Name, appearance and visibility of a body (ADR-0030). The body's geometry
 * is derived, never stored; its ID is the kernel's (`<feature>:<n>`).
 */
export const BodyMetaSchema = z.strictObject({
  name: z.string().min(1),
  /** `#rrggbb`; absent means the theme's default body colour. */
  color: z
    .string()
    .regex(/^#[0-9a-f]{6}$/i)
    .optional(),
  /** 0.1 (nearly clear) to 1; absent means opaque. Added in P2-08. */
  opacity: z.number().min(0.1).max(1).optional(),
  visible: z.boolean(),
});
export type BodyMeta = z.infer<typeof BodyMetaSchema>;

export const NamedViewSchema = z.strictObject({
  id: ViewIdSchema,
  name: z.string().min(1),
  camera: z.strictObject({
    projection: z.enum(['perspective', 'orthographic']),
    position: Vec3Schema,
    target: Vec3Schema,
    up: Vec3Schema,
  }),
});
export type NamedView = z.infer<typeof NamedViewSchema>;

export const SettingsSchema = z.strictObject({
  units: LengthUnitSchema,
  /** Decimal places shown for lengths and angles. */
  precision: z.int().min(0).max(8),
});
export type Settings = z.infer<typeof SettingsSchema>;

export const DocumentSchema = z
  .strictObject({
    format: z.literal(FORMAT_NAME),
    formatVersion: z.literal(FORMAT_VERSION),
    id: DocumentIdSchema,
    name: z.string().min(1),
    settings: SettingsSchema,
    parameters: z.array(ParameterSchema),
    /** The timeline, in order. */
    features: z.array(FeatureSchema),
    /**
     * How many features are active: features at index ≥ `timelineMarker` are
     * rolled back. `features.length` means the whole timeline is active.
     */
    timelineMarker: z.int().min(0),
    bodies: z.record(BodyIdSchema, BodyMetaSchema),
    views: z.array(NamedViewSchema),
    /** Named value sets for the customizer (P4-07); absent when there are none. */
    configurations: z.array(ConfigurationSchema).optional(),
    meta: z.strictObject({
      created: z.iso.datetime(),
      /** Set by storage when it saves, not by commands (so undo doesn't touch it). */
      modified: z.iso.datetime(),
      appVersion: z.string(),
    }),
  })
  .superRefine((doc, ctx) => {
    if (doc.timelineMarker > doc.features.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['timelineMarker'],
        message: `is ${doc.timelineMarker}, past the end of the timeline (${doc.features.length} features)`,
      });
    }
    const unique: [list: string, key: string, values: string[], fold?: (v: string) => string][] = [
      ['features', 'id', doc.features.map((f) => f.id)],
      ['parameters', 'id', doc.parameters.map((p) => p.id)],
      ['parameters', 'name', doc.parameters.map((p) => p.name)],
      ['views', 'id', doc.views.map((v) => v.id)],
      ['configurations', 'id', (doc.configurations ?? []).map((c) => c.id)],
      // "Small" and "small" are the same configuration to a reader (P4-07).
      ['configurations', 'name', (doc.configurations ?? []).map((c) => c.name), configurationKey],
    ];
    for (const [list, key, values, fold] of unique) reportDuplicates(ctx, list, key, values, fold);
    // A slider range isn't a constraint (ADR-0059 §1), but min above max is a
    // mistake rather than a choice, so the document says so.
    doc.parameters.forEach((p, index) => {
      const { min, max } = p.customizer ?? {};
      if (min === undefined || max === undefined || min <= max) return;
      ctx.addIssue({
        code: 'custom',
        path: ['parameters', index, 'customizer'],
        message: `min is ${min}, above max ${max}`,
      });
    });
  });
export type ExtrudoDocument = z.infer<typeof DocumentSchema>;

function reportDuplicates(
  ctx: z.RefinementCtx,
  list: string,
  key: string,
  values: readonly string[],
  /** Compares two values for sameness; defaults to exact equality. */
  fold: (value: string) => string = (value) => value,
): void {
  const seen = new Set<string>();
  values.forEach((value, index) => {
    const keyOf = fold(value);
    if (seen.has(keyOf)) {
      ctx.addIssue({
        code: 'custom',
        path: [list, index, key],
        message: `duplicate ${key} "${value}"`,
      });
    }
    seen.add(keyOf);
  });
}
