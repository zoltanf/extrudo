/**
 * Plain values for the feature inputs (ADR-0068 §3).
 *
 * What the ADR's own example passes — `distance: '10 mm'`, `edges: [ref]` —
 * rather than the stored shapes core keeps (`{ kind: 'expr', expr, unit }`).
 * `storedInputs` turns one into the other before the feature's schema sees it,
 * so a stored input is still accepted as it is: the two forms are one call.
 *
 * The unit an expression input takes and the kinds a reference input takes are
 * read off the schema's own `meta({ input: … })` (core's `feature-inputs`), so
 * `d.hole({ diameter: '5 mm' })` knows that `diameter` is a length and not a
 * plain number, and `d.extrude({ profiles: [face] })` that it takes faces.
 */

import {
  type BoolInput,
  documentFeatures,
  type EnumInput,
  type EnumInputMeta,
  type ExprInput,
  type ExprInputMeta,
  type FeatureDefinition,
  type FeatureInputs,
  type FileInput,
  type GeomRef,
  type LabelsInput,
  type RefInput,
  type RefInputMeta,
  z,
} from '@extrudo/core';
import { ParameterHandle } from './handles';

/**
 * What a stored `expr` input is given as: an expression, a plain number, or a
 * parameter handle — which stands for its name, so `height: wall` works
 * (ADR-0068 §2).
 */
export type ExprValue = string | number | ParameterHandle;
/** What a stored `ref` input is given as: one reference or several. */
export type RefValue = GeomRef | readonly GeomRef[];

/**
 * What a schema says an input is: an expression, a reference list, an enum, a
 * file or a list of labels. A file or labels input carries no metadata of its
 * own (its kind says it all), so this adds the one the JSON schema shows.
 */
export type InputMeta =
  | ExprInputMeta
  | RefInputMeta
  | EnumInputMeta
  | { kind: 'file' }
  | { kind: 'labels' };

/**
 * The plain value a stored input takes: an expression as a string, a number or
 * a parameter handle, references as one reference or a list, an enum as its own
 * value (so the union of its choices), a toggle as a boolean, a file as its
 * attachment's ID, a pattern's skip list as the position labels themselves, and
 * a sketch's content as it is.
 */
type PlainValue<T> = T extends ExprInput
  ? ExprValue
  : T extends RefInput
    ? RefValue
    : T extends EnumInput
      ? T['value']
      : T extends BoolInput
        ? boolean
        : T extends FileInput
          ? string
          : T extends LabelsInput
            ? readonly string[]
            : never;

/**
 * Core's own input type with each input written as the plain value it takes, so
 * `ExtrudeInputs` reads as `{ distance?: string; profiles?: GeomRef | GeomRef[] }`.
 * A stored input is still accepted (the two are one call), required inputs stay
 * required, optional ones optional, and an input with no plain form (a sketch's
 * content) keeps its stored shape.
 */
export type PlainInputs<I extends FeatureInputs> = {
  [K in keyof I]: PlainValue<NonNullable<I[K]>> | NonNullable<I[K]>;
};

/** Any feature's inputs in plain form, which is what `add` takes as well. */
export type ApiInputs = PlainInputs<FeatureInputs>;

/** Inputs as a call gives them: the plain form, or a stored input as it is. */
export type FeatureInputValue = FeatureInputs | ApiInputs;

/**
 * A call's inputs as stored inputs: the stored ones unchanged, the plain ones
 * filled in. An input whose plain form doesn't fit is passed on as it is, so
 * the schema is what refuses it, in its own words.
 */
export function storedInputs(type: string, inputs: FeatureInputValue): FeatureInputs {
  const definition = documentFeatures().get(type);
  const given = compact(inputs);
  if (!definition) return given;
  const stored: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(given)) {
    stored[name] = isStoredInput(value) ? value : plainInput(definition, name, value);
  }
  return stored as FeatureInputs;
}

/**
 * One plain value as the input its schema expects: an expression gets its unit,
 * references become a list (one ref for a single-reference input), an enum is
 * the string itself, a boolean a toggle, a pattern's skip list the labels it
 * names. An input the schema says nothing about keeps its value, and a boolean
 * without metadata still becomes a toggle.
 */
function plainInput(definition: FeatureDefinition, name: string, value: unknown): unknown {
  const what = inputMeta(definition, name);
  switch (what?.kind) {
    case 'expr':
      // A parameter handle stands for its name, so `height: wall` works.
      // An input of any unit (an OpenSCAD override) takes the parameter's own.
      if (value instanceof ParameterHandle) {
        return { kind: 'expr', expr: value.name, unit: what.anyUnit ? value.unit : what.unit };
      }
      return typeof value === 'number' || typeof value === 'string'
        ? { kind: 'expr', expr: String(value), unit: what.unit }
        : value;
    case 'enum':
      return typeof value === 'string' ? { kind: 'enum', value } : value;
    case 'ref':
      return referenceInput(value);
    // A file input is an attachment of the design, named by its ID (P4-06).
    case 'file':
      return typeof value === 'string' ? { kind: 'file', id: value } : value;
    // A pattern's skipped instances, given as the position labels (P4-12).
    case 'labels':
      return Array.isArray(value) && value.every((v) => typeof v === 'string')
        ? { kind: 'labels', labels: [...value] }
        : value;
    default:
      return typeof value === 'boolean' ? { kind: 'bool', value } : value;
  }
}

/** One reference or a list of them as the stored `ref` input. */
function referenceInput(value: unknown): unknown {
  if (Array.isArray(value)) return { kind: 'ref', refs: value };
  return isReference(value) ? { kind: 'ref', refs: [value] } : value;
}

/** The kinds core stores an input as (`schema.ts`'s `InputSchema`). */
const STORED_KINDS = new Set(['expr', 'enum', 'bool', 'ref', 'file', 'labels', 'sketchData']);

/**
 * Whether a value is already one of core's stored input shapes. A reference is
 * not one, though it has a `kind` too: that is what says `plane` from `ref`.
 */
function isStoredInput(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const kind = (value as { kind?: unknown }).kind;
  return typeof kind === 'string' && STORED_KINDS.has(kind);
}

function isReference(value: unknown): value is GeomRef {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as GeomRef).kind === 'string' &&
    typeof (value as GeomRef).id === 'string'
  );
}

/**
 * What an input of a feature type is, read from the input schemas' metadata
 * through their JSON schema. Read once per feature type and remembered, since
 * every call asks.
 */
export function inputMeta(definition: FeatureDefinition, name: string): InputMeta | undefined {
  let properties = metaCache.get(definition);
  if (!properties) {
    const schema = z.toJSONSchema(definition.inputsSchema) as {
      properties?: Record<string, { input?: unknown; properties?: { kind?: { const?: string } } }>;
    };
    properties = {};
    for (const [key, property] of Object.entries(schema.properties ?? {})) {
      // A file or a labels input says what it is in its own kind, with no
      // metadata beside it, so the JSON schema's `kind` is the metadata here.
      const bare = property.properties?.kind?.const;
      const fromKind = bare === 'file' || bare === 'labels' ? { kind: bare } : undefined;
      properties[key] = (property.input ?? fromKind) as never;
    }
    metaCache.set(definition, properties);
  }
  const found = properties[name] as InputMeta | undefined;
  return found?.kind ? found : undefined;
}

const metaCache = new WeakMap<FeatureDefinition, Record<string, unknown>>();

/** Drops the inputs left `undefined`, so the stored input has no holes in it. */
export function compact(inputs: FeatureInputValue): FeatureInputs {
  const kept: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(inputs)) {
    if (value !== undefined) kept[name] = value;
  }
  return kept as FeatureInputs;
}
