/**
 * The document schema, format version 1 (architecture §4.1).
 *
 * The document is plain JSON and the only source of truth; geometry is derived
 * from it (ADR-0003). Objects are strict: an unknown key in a version-1 file is
 * a bug, not a newer format, because newer formats have a higher
 * `formatVersion` and go through `migrations.ts`. Adding an optional field is
 * backward compatible and needs no version bump; everything else does.
 */
import { z } from 'zod';
import { FORMAT_NAME, FORMAT_VERSION } from './format';
import { PARAMETER_NAME } from './names';
import { SketchDataSchema } from './sketch/schema';

export { PARAMETER_NAME } from './names';

import {
  BodyIdSchema,
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

export const ParameterSchema = z.strictObject({
  id: ParameterIdSchema,
  name: z.string().regex(PARAMETER_NAME, 'must be a letter or _ followed by letters, digits or _'),
  expression: z.string(),
  unit: UnitKindSchema,
  comment: z.string().optional(),
});
export type Parameter = z.infer<typeof ParameterSchema>;

/**
 * A reference to geometry: an origin plane, a face, an edge, a sketch profile…
 * `id` is a persistent name from the topological-naming service (§5.2,
 * ADR-0005), never a raw index. Face, edge and vertex references also keep
 * a fingerprint of what they pointed at, used when the name doesn't resolve.
 */
export const GeomRefKindSchema = z.enum([
  'plane',
  'axis',
  'point',
  'face',
  'edge',
  'vertex',
  'profile',
  'body',
  'sketchEntity',
]);
export type GeomRefKind = z.infer<typeof GeomRefKindSchema>;

const Vec3Schema = z.tuple([z.number(), z.number(), z.number()]);

/**
 * What a referenced face, edge or vertex looked like when it was picked
 * (ADR-0005). The kernel matches it against the current geometry when the
 * reference's name no longer resolves, and warns that it guessed.
 */
export const GeomFingerprintSchema = z.strictObject({
  /** Surface type of a face (`plane`, `cylinder`, …), curve type of an edge (`line`, `circle`, …), `point` for a vertex. */
  type: z.string().min(1),
  /** Area centroid of a face, midpoint of an edge, position of a vertex (mm). */
  at: Vec3Schema,
  /** A plane's outward normal, an axis, or a line's direction. */
  dir: Vec3Schema.optional(),
  /** Area (mm²) of a face, length (mm) of an edge. */
  size: z.number().nonnegative().optional(),
  /** Persistent names of the faces around it (of the faces next to a face). */
  adj: z.array(z.string()).optional(),
});
export type GeomFingerprint = z.infer<typeof GeomFingerprintSchema>;

export const GeomRefSchema = z.strictObject({
  kind: GeomRefKindSchema,
  id: z.string().min(1),
  /** Faces, edges and vertices: the fallback when `id` doesn't resolve. Optional (added in P2-04). */
  fingerprint: GeomFingerprintSchema.optional(),
});
export type GeomRef = z.infer<typeof GeomRefSchema>;

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

/** Name, colour and visibility of a body. The body's geometry is derived, never stored. */
export const BodyMetaSchema = z.strictObject({
  name: z.string().min(1),
  color: z
    .string()
    .regex(/^#[0-9a-f]{6}$/i)
    .optional(),
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
    const unique: [list: string, key: string, values: string[]][] = [
      ['features', 'id', doc.features.map((f) => f.id)],
      ['parameters', 'id', doc.parameters.map((p) => p.id)],
      ['parameters', 'name', doc.parameters.map((p) => p.name)],
      ['views', 'id', doc.views.map((v) => v.id)],
    ];
    for (const [list, key, values] of unique) reportDuplicates(ctx, list, key, values);
  });
export type ExtrudoDocument = z.infer<typeof DocumentSchema>;

function reportDuplicates(
  ctx: z.RefinementCtx,
  list: string,
  key: string,
  values: readonly string[],
): void {
  const seen = new Set<string>();
  values.forEach((value, index) => {
    if (seen.has(value)) {
      ctx.addIssue({
        code: 'custom',
        path: [list, index, key],
        message: `duplicate ${key} "${value}"`,
      });
    }
    seen.add(value);
  });
}
