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
import { FORMAT_NAME, FORMAT_VERSION } from './format';
import { FILE_INPUT_MEDIA_TYPES, MEDIA_TYPES } from './media-types';
import { PARAMETER_NAME } from './names';
import { GeomRefSchema, Vec3Schema } from './refs';
import { attachmentFontId, SketchDataSchema } from './sketch/schema';
import { z } from './zod';

export { PARAMETER_NAME } from './names';
export * from './refs';

import {
  AttachmentIdSchema,
  BodyIdSchema,
  ComponentIdSchema,
  ConfigurationIdSchema,
  DocumentIdSchema,
  FeatureIdSchema,
  GroupIdSchema,
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
/**
 * A file of the design itself (P4-06, ADR-0066 §0): an `AttachmentId` of
 * `doc.attachments`, whose bytes the kernel reads. An `import` names its
 * STEP or mesh file this way.
 */
export const FileInputSchema = z.strictObject({
  kind: z.literal('file'),
  id: AttachmentIdSchema,
});
export type FileInput = z.infer<typeof FileInputSchema>;

/**
 * A list of names of its own (P4-12, ADR-0047 amendment): the instances a
 * pattern leaves out, as their position labels (`"2"`, `"m1"`, `"1x3"`). It
 * names positions, not faces or features, so nothing can go stale in it.
 */
export const INSTANCE_LABEL = /^(?:m?\d+)(?:xm?\d+)?$/;
export const LabelsInputSchema = z.strictObject({
  kind: z.literal('labels'),
  labels: z.array(z.string().regex(INSTANCE_LABEL, 'an instance label like 2, m1 or 1x3')),
});
export type LabelsInput = z.infer<typeof LabelsInputSchema>;

/**
 * Source code (P5-02, ADR-0070 §1): a Script feature's program, stored as the
 * text the user wrote. The kernel runs it; nothing else reads it.
 */
export const CodeInputSchema = z.strictObject({
  kind: z.literal('code'),
  value: z.string(),
});
export type CodeInput = z.infer<typeof CodeInputSchema>;

/** One feature input. Every number is an expression; there is no raw-number kind. */
export const InputSchema = z.discriminatedUnion('kind', [
  ExprInputSchema,
  EnumInputSchema,
  BoolInputSchema,
  RefInputSchema,
  SketchDataInputSchema,
  FileInputSchema,
  LabelsInputSchema,
  CodeInputSchema,
]);
export type Input = z.infer<typeof InputSchema>;
export type ExprInput = z.infer<typeof ExprInputSchema>;
export type EnumInput = z.infer<typeof EnumInputSchema>;
export type BoolInput = z.infer<typeof BoolInputSchema>;
export type RefInput = z.infer<typeof RefInputSchema>;
export type SketchDataInput = z.infer<typeof SketchDataInputSchema>;
export type LabelsInputType = z.infer<typeof LabelsInputSchema>;

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
  /**
   * The component the feature's **new** bodies join (P6-05, ADR-0081 §2 rule
   * 3): the app stamps the active component when it inserts the feature, and
   * editing the feature never changes it. Nothing in the recompute reads it.
   */
  component: ComponentIdSchema.optional(),
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
  /**
   * A third display state between shown and hidden (ADR-0030's amendment,
   * 2026-10-09): a grey see-through shape that takes no part in anything.
   * Stored as `true` only, and only with `visible: false` (the `updateBody`
   * command keeps the pair). Older readers leave the unknown key out and show
   * the body hidden (ADR-0050's lenient reading).
   */
  ghost: z.boolean().optional(),
  /**
   * The component the body belongs to (P6-05, ADR-0081 §2); absent: the body
   * is loose. Membership lives here, so a body is in at most one component.
   */
  component: ComponentIdSchema.optional(),
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

/**
 * A file that travels with the design (P4-03b, ADR-0061 §1): the bytes live
 * beside the document (storage's `writeAttachment`, the `.extrudo` file's
 * `attachments/` folder), never in it, and are content-addressed by
 * `sha256`: one file is stored once however many attachments or versions
 * name it. Fonts (`attachment:<AttachmentId>`, P4-03), imported models and
 * canvas images (P4-06, ADR-0066 §0) name one the same way. The media type
 * comes from the file name's extension (`mediaTypeOf`), never from the
 * browser's `File.type`; WOFF2 is not accepted: the font shaper can't read it.
 */
export const AttachmentSchema = z.strictObject({
  /** What the user sees, e.g. "Comic Neue Bold". */
  name: z.string().min(1).max(200),
  /** The name of the file it came from, so an export can offer it back. */
  fileName: z.string().min(1).max(255),
  mediaType: z.enum(MEDIA_TYPES),
  /** Lower case hex, the file's name in storage and in the archive. */
  sha256: z.string().regex(/^[0-9a-f]{64}$/, 'must be 64 lower case hex digits'),
  /** The file's size in bytes, for the design's attachment limit. */
  size: z.int().positive(),
});
export type Attachment = z.infer<typeof AttachmentSchema>;

/**
 * A group of neighbouring timeline features (P4-09, ADR-0065 §1, FR-TL-06):
 * the range from `first` to `last` inclusive, in timeline order. Storing the
 * range's two ends rather than its members is what keeps a group contiguous
 * through moves: a feature that lands between them joins it, and an end that
 * moves or goes away shifts to the next member inside. `normalizeGroups`
 * (`groups.ts`) applies those rules, and every command that reorders or
 * removes features ends with it; groups don't nest and don't overlap.
 */
export const GroupSchema = z.strictObject({
  id: GroupIdSchema,
  name: z.string().min(1).max(100),
  /** The feature the group starts at; both ends must exist in `features`. */
  first: FeatureIdSchema,
  /** The feature the group ends at, at or after `first` in the timeline. */
  last: FeatureIdSchema,
  /** Whether the timeline draws the group as one chip (folded). */
  collapsed: z.boolean(),
});
export type Group = z.infer<typeof GroupSchema>;

/**
 * A component (P6-05, ADR-0081 §1-2): a named, user-made set of bodies that
 * shows, hides, exports and is placed as a unit. It stores **no transform**:
 * where its bodies are is where the timeline put them (§3), and membership
 * lives on each body's metadata (`BodyMeta.component`), not in a list here.
 * Nothing in the recompute reads components, so an older reader that leaves
 * them out opens the same geometry as loose bodies.
 */
export const ComponentSchema = z.strictObject({
  id: ComponentIdSchema,
  /** Unique in the design, compared case-insensitively ("Lid" and "lid" are one name). */
  name: z.string().min(1).max(100),
  /** The same pair rule as `BodyMeta`: `ghost` only as `true`, only with `visible: false`. */
  visible: z.boolean(),
  ghost: z.boolean().optional(),
});
export type Component = z.infer<typeof ComponentSchema>;

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
    /** Folds of the timeline (P4-09, ADR-0065 §1); absent when there are none. */
    groups: z.array(GroupSchema).optional(),
    /** Components, in browser order (P6-05, ADR-0081); absent when there are none. */
    components: z.array(ComponentSchema).optional(),
    bodies: z.record(BodyIdSchema, BodyMetaSchema),
    views: z.array(NamedViewSchema),
    /** Named value sets for the customizer (P4-07); absent when there are none. */
    configurations: z.array(ConfigurationSchema).optional(),
    /** Files that travel with the design (ADR-0061); the bytes live beside the document. */
    attachments: z.record(AttachmentIdSchema, AttachmentSchema).optional(),
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
      ['groups', 'id', (doc.groups ?? []).map((g) => g.id)],
      ['configurations', 'id', (doc.configurations ?? []).map((c) => c.id)],
      // "Small" and "small" are the same configuration to a reader (P4-07).
      ['configurations', 'name', (doc.configurations ?? []).map((c) => c.name), configurationKey],
      ['components', 'id', (doc.components ?? []).map((c) => c.id)],
      // "Lid" and "lid" are the same component to a reader (ADR-0081 §2).
      ['components', 'name', (doc.components ?? []).map((c) => c.name), (n) => n.toLowerCase()],
    ];
    for (const [list, key, values, fold] of unique) reportDuplicates(ctx, list, key, values, fold);
    reportGroups(ctx, doc);
    reportComponentRefs(ctx, doc);
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
    reportFonts(ctx, doc);
    reportFiles(ctx, doc);
  });
export type ExtrudoDocument = z.infer<typeof DocumentSchema>;

/**
 * A `file` input needs the attachment it names, of a media type the feature
 * can read (P4-06, ADR-0066 §2): an `import` that names an image, or a
 * design that carries no such file, is refused. The issue names the input,
 * so the file's error points at it.
 */
function reportFiles(ctx: z.RefinementCtx, doc: z.infer<typeof DocumentSchema>): void {
  for (const [index, feature] of doc.features.entries()) {
    const allowed = FILE_INPUT_MEDIA_TYPES[feature.type];
    if (!allowed) continue;
    for (const [name, input] of Object.entries(feature.inputs)) {
      if (input.kind !== 'file') continue;
      // A plugin's own `in:` inputs are the feature's business (ADR-0077): a
      // foreign kind there is that feature's error, never the document's.
      if (feature.type === 'plugin' && name.startsWith('in:')) continue;
      const attachment = doc.attachments?.[input.id];
      if (!attachment) {
        ctx.addIssue({
          code: 'custom',
          path: ['features', index, 'inputs', name],
          message: `is attachment "${input.id}", which this design doesn't carry`,
        });
        continue;
      }
      if (allowed.includes(attachment.mediaType)) continue;
      ctx.addIssue({
        code: 'custom',
        path: ['features', index, 'inputs', name],
        message: `is "${attachment.fileName}", whose media type ${attachment.mediaType} isn't one this feature reads`,
      });
    }
  }
}

/**
 * Every `component` a body or a feature names must exist, and a component's
 * `ghost` comes only with `visible: false` (P6-05, ADR-0081 §2). The issue
 * names the body, the feature or the component, so a file's error points at it.
 */
function reportComponentRefs(ctx: z.RefinementCtx, doc: z.infer<typeof DocumentSchema>): void {
  const known = new Set<string>((doc.components ?? []).map((c) => c.id));
  const missing = (id: string) => `names component ${id}, which the design doesn't have`;
  for (const [id, meta] of Object.entries(doc.bodies)) {
    if (meta.component === undefined || known.has(meta.component)) continue;
    ctx.addIssue({
      code: 'custom',
      path: ['bodies', id, 'component'],
      message: missing(meta.component),
    });
  }
  doc.features.forEach((feature, index) => {
    if (feature.component === undefined || known.has(feature.component)) return;
    ctx.addIssue({
      code: 'custom',
      path: ['features', index, 'component'],
      message: missing(feature.component),
    });
  });
  (doc.components ?? []).forEach((component, index) => {
    if (!component.ghost || !component.visible) return;
    ctx.addIssue({
      code: 'custom',
      path: ['components', index, 'ghost'],
      message: 'is set on a visible component (a ghost is stored with visible: false)',
    });
  });
}

/**
 * A group's two ends must name features that exist, run forwards along the
 * timeline, and not share a feature with another group (P4-09, ADR-0065 §1:
 * groups don't nest and don't overlap). The issue names the group, so a file's
 * error points at the group to fix.
 */
function reportGroups(ctx: z.RefinementCtx, doc: z.infer<typeof DocumentSchema>): void {
  const at = new Map(doc.features.map((f, i) => [f.id as string, i]));
  const taken: { index: number; name: string; from: number; to: number }[] = [];
  (doc.groups ?? []).forEach((group, index) => {
    const from = at.get(group.first);
    const to = at.get(group.last);
    for (const [end, where] of [
      ['first', from],
      ['last', to],
    ] as const) {
      if (where === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['groups', index, end],
          message: `is ${group[end]}, which is not a feature of this timeline`,
        });
      }
    }
    if (from === undefined || to === undefined) return;
    if (from > to) {
      ctx.addIssue({
        code: 'custom',
        path: ['groups', index, 'last'],
        message: `comes before ${group.first}, the group "${group.name}" starts at`,
      });
      return;
    }
    const other = taken.find((g) => from <= g.to && g.from <= to);
    if (other) {
      ctx.addIssue({
        code: 'custom',
        path: ['groups', index],
        message: `overlaps the group "${other.name}"`,
      });
      return;
    }
    taken.push({ index, name: group.name, from, to });
  });
}

/**
 * A text shaped with `attachment:<id>` needs that attachment in the document
 * (ADR-0061 §1): a font nothing carries would draw as nothing at all. The
 * issue names the entity, so the file's error points at the text to fix.
 */
function reportFonts(ctx: z.RefinementCtx, doc: z.infer<typeof DocumentSchema>): void {
  for (const [index, feature] of doc.features.entries()) {
    const sketch = feature.inputs.sketch;
    if (sketch?.kind !== 'sketchData') continue;
    for (const [id, entity] of Object.entries(sketch.sketch.entities)) {
      if (entity.type !== 'text') continue;
      const attachment = attachmentFontId(entity.font);
      if (!attachment || doc.attachments?.[attachment]) continue;
      ctx.addIssue({
        code: 'custom',
        path: ['features', index, 'inputs', 'sketch', 'sketch', 'entities', id, 'font'],
        message: `is the font of attachment "${attachment}", which this design doesn't carry`,
      });
    }
  }
}

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
