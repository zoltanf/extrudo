/**
 * The `import` feature (P4-06, ADR-0066 §2, FR-IO-05): a STEP file as a
 * non-parametric base body. The file travels with the design as an
 * attachment (ADR-0061); the kernel reads its bytes with `ctx.file` and makes
 * one body per solid, as it does for any feature that adds bodies
 * (`splitSolids`, ADR-0030). Meshes (FR-IO-06) are the same feature with a
 * mesh branch in its evaluator (ADR-0066 §3), so `units` is already an input;
 * STEP converts its own units and ignores it.
 *
 * No placement inputs: the body lands at the file's coordinates, and Move (or
 * Place on Bed) puts it elsewhere.
 *
 * An OpenSCAD file (P5-04, ADR-0071) is a model the kernel compiles to a mesh
 * first, and the feature's **overrides** set its top-level variables to the
 * values of expressions (`scadName`/`scadValue`, `scadName2`/`scadValue2` …,
 * numbered like a fillet's sets), so a `.scad` part follows the document's
 * parameters.
 */
import { type ExprInputMeta, enumInput } from './feature-inputs';
import type { FeatureDefinition } from './features';
import type { AttachmentId } from './ids';
import { MODEL_MEDIA_TYPES } from './media-types';
import type {
  EnumInput,
  ExprInput,
  Feature,
  FeatureInputs,
  FileInput,
  Input,
  UnitKind,
} from './schema';
import { ExprInputSchema, FileInputSchema } from './schema';
import { z } from './zod';

export const IMPORT_TYPE = 'import';

/** The feature type's label, and the base of its default names ("Import1"). */
export const IMPORT_LABEL = 'Import';

/** The `units` choices (`auto`: a 3MF's own unit, STL and OBJ as mm). */
export const IMPORT_UNITS = ['auto', 'mm', 'cm', 'm', 'in'] as const;

/** The `up` choices. */
export const IMPORT_UP = ['z', 'y'] as const;

/** How many of an OpenSCAD file's variables an import can override (ADR-0071 §5). */
export const SCAD_MAX_OVERRIDES = 32;

/** Override `n`'s variable name: `scadName`, `scadName2` … */
export const scadNameKey = (n: number) => (n === 1 ? 'scadName' : `scadName${n}`);

/** Override `n`'s value: `scadValue`, `scadValue2` … */
export const scadValueKey = (n: number) => (n === 1 ? 'scadValue' : `scadValue${n}`);

/** An OpenSCAD variable's name: an identifier, a special variable (`$fn`) included. */
export const SCAD_VARIABLE = /^\$?[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * An override's variable: an `enum` input whose values come from the file, so
 * the schema checks the name's form, not a list.
 */
const ScadNameInputSchema = z
  .strictObject({
    kind: z.literal('enum'),
    value: z.string().regex(SCAD_VARIABLE, 'an OpenSCAD variable name like width or $fn'),
  })
  .meta({ input: { kind: 'enum' } });

/**
 * An override's value: an expression of **any** unit, unlike `exprOf`'s one —
 * a value bound to a length parameter is a length, a tooth count a plain
 * number, and both reach OpenSCAD as the number they are in mm or degrees.
 * **Its `unit` is required**: elsewhere a missing unit means a length, which
 * for a `-D` value would turn a plain `24` into 24 of the document's length
 * unit (an inch file's 609.6). A plain value given through the API is
 * `unitless`; a parameter keeps its own unit (`anyUnit`).
 */
const ScadValueInputSchema = ExprInputSchema.refine(
  (input) => input.unit !== undefined,
  'must say its unit (length, angle or unitless)',
).meta({
  input: { kind: 'expr', unit: 'unitless', anyUnit: true } satisfies ExprInputMeta,
});

const overrides: Record<string, z.ZodType> = {};
for (let n = 1; n <= SCAD_MAX_OVERRIDES; n++) {
  overrides[scadNameKey(n)] = ScadNameInputSchema.optional().describe(
    `OpenSCAD files only: override ${n}'s variable, the name of a top-level variable of the file (\`width\`, \`$fn\`). Needs its value.`,
  );
  overrides[scadValueKey(n)] = ScadValueInputSchema.optional().describe(
    `OpenSCAD files only: override ${n}'s value, an expression (a plain number, or a length or an angle, which reach OpenSCAD in mm and degrees; a parameter given as a handle keeps its own unit). Needs its variable.`,
  );
}

const importShape = {
  /** The file: an attachment of the design with a `model/*` media type. */
  file: FileInputSchema.describe(
    'The file to import: an attachment of this design with a `model/*` media type or an OpenSCAD file (a STEP solid, a mesh, or a `.scad` file compiled to a mesh). Required.',
  ),
  /** Meshes only: what unit the file's numbers are in. STEP converts its own. */
  units: enumInput(IMPORT_UNITS)
    .optional()
    .describe(
      "Meshes only: what unit the file's numbers are in (`auto` takes a 3MF's own). STEP converts its own units. Default auto.",
    ),
  /** The file's up axis; `y` turns it +90° about X (Y-up to Z-up). */
  up: enumInput(IMPORT_UP)
    .optional()
    .describe("The file's up axis; `y` turns it +90° about X (Y-up to Z-up). Default z."),
};

export const ImportInputsSchema = z.strictObject({
  ...importShape,
  ...overrides,
}) as unknown as z.ZodType<ImportInputs>;

/** An `import`'s inputs: the file, `units`, `up`, and an OpenSCAD file's overrides. */
export type ImportInputs = {
  file: FileInput;
  units?: { kind: 'enum'; value: (typeof IMPORT_UNITS)[number] };
  up?: { kind: 'enum'; value: (typeof IMPORT_UP)[number] };
} & Record<string, Input>; // and `scadName<n>` (an `enum` of a variable name), `scadValue<n>` (an `expr`)

/** The units a mesh file's numbers are read in, and what each one means in mm. */
export const UNIT_FACTORS: Readonly<Record<(typeof IMPORT_UNITS)[number], number>> = {
  auto: 1,
  mm: 1,
  cm: 10,
  m: 1000,
  in: 25.4,
};

export const importFeature: FeatureDefinition<ImportInputs> = {
  type: IMPORT_TYPE,
  label: IMPORT_LABEL,
  category: 'create',
  icon: 'insert-svg',
  inputsSchema: ImportInputsSchema,
  // ADR-0068 §4, from the kernel's import (P4-06): the file's own faces for a
  // STEP solid, and one face for a mesh body (ADR-0066 §3), numbered `#2`, `#3`…
  // after the first so two bodies' faces can be told apart.
  faceRoles: [
    {
      pattern: 'face:<n>',
      description: "A face of the imported solid, in the order the file's B-rep has them.",
    },
    {
      pattern: 'mesh',
      description: "A mesh body's one face: a mesh is a single face of triangles (ADR-0066 §3).",
    },
  ],
};

/** The media types an `import` feature's file may have (ADR-0066 §0). */
export const IMPORT_MEDIA_TYPES = MODEL_MEDIA_TYPES;

/** An `import` feature's (valid) inputs with their defaults. */
export interface ImportSettings {
  /** The attachment the file comes from. */
  file: AttachmentId;
  /** Meshes only; `auto` unless the dialog says otherwise. */
  units: (typeof IMPORT_UNITS)[number];
  /** `z` unless the file is Y-up. */
  up: (typeof IMPORT_UP)[number];
}

export function importSettings(inputs: ImportInputs): ImportSettings {
  return {
    file: inputs.file.id,
    units: inputs.units?.value ?? 'auto',
    up: inputs.up?.value ?? 'z',
  };
}

/** One override of an OpenSCAD file's variable (ADR-0071 §5). */
export interface ScadOverride {
  /** Its number: `scadName<n>`/`scadValue<n>`. */
  n: number;
  /** The variable, or `undefined` when only the value is there. */
  name: string | undefined;
  /** The input whose expression is the value, or `undefined` when only the name is there. */
  value: string | undefined;
}

/** An import's overrides in order, every pair that has either half. */
export function scadOverrides(inputs: ImportInputs): ScadOverride[] {
  const found: ScadOverride[] = [];
  for (let n = 1; n <= SCAD_MAX_OVERRIDES; n++) {
    const name = inputs[scadNameKey(n)];
    const value = scadValueKey(n);
    const hasValue = inputs[value]?.kind === 'expr';
    if (name?.kind !== 'enum' && !hasValue) continue;
    found.push({
      n,
      name: name?.kind === 'enum' ? name.value : undefined,
      value: hasValue ? value : undefined,
    });
  }
  return found;
}

export interface ImportInputOptions {
  /** The attachment the file is; the caller writes its bytes first (ADR-0061 §2). */
  file: AttachmentId;
  /** Meshes only: what unit the file's numbers are in. */
  units?: (typeof IMPORT_UNITS)[number];
  /** The file's up axis. */
  up?: (typeof IMPORT_UP)[number];
  /**
   * An OpenSCAD file's overrides, in order: a variable and an expression, and
   * the expression's unit (default `unitless`; a value bound to a length
   * parameter is a `length`).
   */
  overrides?: readonly { name: string; value: string; unit?: UnitKind }[];
}

/**
 * An `import` feature's inputs from plain options (tests, scripts; the dialog
 * builds the same shape). `file` is required: a feature without a file is
 * nothing.
 */
export function importInputs(options: ImportInputOptions): ImportInputs {
  const inputs: ImportInputs = {
    file: { kind: 'file', id: options.file },
    ...(options.units && { units: { kind: 'enum', value: options.units } }),
    ...(options.up && { up: { kind: 'enum', value: options.up } }),
  };
  (options.overrides ?? []).slice(0, SCAD_MAX_OVERRIDES).forEach((override, i) => {
    inputs[scadNameKey(i + 1)] = { kind: 'enum', value: override.name } satisfies EnumInput;
    inputs[scadValueKey(i + 1)] = {
      kind: 'expr',
      expr: override.value,
      unit: override.unit ?? 'unitless',
    } satisfies ExprInput;
  });
  return inputs;
}

/**
 * The attachment an `import` feature names, or `undefined` for any other
 * feature (or one whose inputs don't parse). Who uses it: the `Recomputer`,
 * to send the file's bytes to the worker before the recompute or preview that
 * needs them (ADR-0066 §0).
 */
export function importFileOf(feature: Pick<Feature, 'type' | 'inputs'>): AttachmentId | undefined {
  if (feature.type !== IMPORT_TYPE) return undefined;
  const parsed = ImportInputsSchema.safeParse(feature.inputs as FeatureInputs);
  return parsed.success ? parsed.data.file.id : undefined;
}
