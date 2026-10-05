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
 */
import { z } from 'zod';
import { enumInput } from './feature-inputs';
import type { FeatureDefinition } from './features';
import type { AttachmentId } from './ids';
import { MODEL_MEDIA_TYPES } from './media-types';
import type { Feature, FeatureInputs } from './schema';
import { FileInputSchema } from './schema';

export const IMPORT_TYPE = 'import';

/** The feature type's label, and the base of its default names ("Import1"). */
export const IMPORT_LABEL = 'Import';

/** The `units` choices (`auto`: a 3MF's own unit, STL and OBJ as mm). */
export const IMPORT_UNITS = ['auto', 'mm', 'cm', 'm', 'in'] as const;

/** The `up` choices. */
export const IMPORT_UP = ['z', 'y'] as const;

export const ImportInputsSchema = z.strictObject({
  /** The file: an attachment of the design with a `model/*` media type. */
  file: FileInputSchema,
  /** Meshes only: what unit the file's numbers are in. STEP converts its own. */
  units: enumInput(IMPORT_UNITS).optional(),
  /** The file's up axis; `y` turns it +90° about X (Y-up to Z-up). */
  up: enumInput(IMPORT_UP).optional(),
});
export type ImportInputs = z.infer<typeof ImportInputsSchema>;

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

export interface ImportInputOptions {
  /** The attachment the file is; the caller writes its bytes first (ADR-0061 §2). */
  file: AttachmentId;
  /** Meshes only: what unit the file's numbers are in. */
  units?: (typeof IMPORT_UNITS)[number];
  /** The file's up axis. */
  up?: (typeof IMPORT_UP)[number];
}

/**
 * An `import` feature's inputs from plain options (tests, scripts; the dialog
 * builds the same shape). `file` is required: a feature without a file is
 * nothing.
 */
export function importInputs(options: ImportInputOptions): ImportInputs {
  return {
    file: { kind: 'file', id: options.file },
    ...(options.units && { units: { kind: 'enum', value: options.units } }),
    ...(options.up && { up: { kind: 'enum', value: options.up } }),
  } as ImportInputs;
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
