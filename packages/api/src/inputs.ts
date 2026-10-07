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
  type CodeInput,
  type CodeInputMeta,
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
  type UnitKind,
  z,
} from '@extrudo/core';
import { inferUnit } from './expr';
import { ParameterHandle } from './handles';

/**
 * What a stored `expr` input is given as: an expression, a plain number, a
 * parameter handle — which stands for its name, so `height: wall` works
 * (ADR-0068 §2) — or a plain object that also carries the input's own
 * parameter name (`{ expr: '10 mm', paramName: 'd1' }`), which the macro
 * emitter writes so expressions reading `d1` resolve after a round trip
 * (ADR-0073 §2).
 */
export type ExprValue = string | number | ParameterHandle | { expr: string; paramName?: string };
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
  | { kind: 'labels' }
  | CodeInputMeta;

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
            : T extends CodeInput
              ? string
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

/**
 * One open-ended input (a plugin feature's own, ADR-0077 §3), which no schema
 * types: an expression as a string (its unit read off it: a length unless it
 * ends in an angle unit) or a parameter handle (its own unit), a plain number
 * as a number, an expression of a stated unit as `{ expr, unit }`, a toggle as
 * a boolean, references as one or a list, and anything else (a choice:
 * `{ kind: 'enum', value }`) in its stored form.
 */
export type OpenInputValue =
  | string
  | number
  | boolean
  | ParameterHandle
  | { expr: string; unit: UnitKind }
  | RefValue
  | ExprInput
  | BoolInput
  | EnumInput
  | RefInput;

/** The object of open-ended inputs a call gives (`inputs: { width: '60 mm' }`). */
export type OpenInputValues = Readonly<Record<string, OpenInputValue>>;

/** Any feature's inputs in plain form, which is what `add` takes as well. */
export type ApiInputs = PlainInputs<FeatureInputs>;

/**
 * Inputs with an object of open-ended ones among them (a plugin feature's
 * `inputs`, ADR-0077 §3), which `storedInputs` spreads under their prefix.
 */
export type OpenApiInputs = Readonly<Record<string, ApiInputs[string] | OpenInputValues>>;

/** Inputs as a call gives them: the plain form, or a stored input as it is. */
export type FeatureInputValue = FeatureInputs | ApiInputs | OpenApiInputs;

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
  const open = definition.openInputs;
  for (const [name, value] of Object.entries(given)) {
    // A plugin feature's own inputs, given as one object (ADR-0077 §3): each
    // is stored under the prefix, and its kind read off the value itself.
    if (open && name === open.name && isPlainObject(value)) {
      for (const [own, input] of Object.entries(value)) {
        if (input === undefined) continue;
        stored[`${open.prefix}${own}`] = isStoredInput(input) ? input : openInput(input);
      }
      continue;
    }
    stored[name] = isStoredInput(value) ? value : plainInput(definition, name, value);
  }
  return stored as FeatureInputs;
}

/**
 * An open-ended input's plain value as a stored input (`OpenInputValue`): no
 * schema says what it is, so the value does. A string is an expression whose
 * unit is read off it, a number a plain number, a boolean a toggle.
 */
function openInput(value: unknown): unknown {
  if (value instanceof ParameterHandle) return { kind: 'expr', expr: value.name, unit: value.unit };
  if (typeof value === 'string') return { kind: 'expr', expr: value, unit: inferUnit(value) };
  if (typeof value === 'number') return { kind: 'expr', expr: String(value), unit: 'unitless' };
  if (typeof value === 'boolean') return { kind: 'bool', value };
  if (isPlainExpr(value) && typeof (value as { unit?: unknown }).unit === 'string') {
    const { expr, unit } = value as { expr: string; unit: UnitKind };
    return { kind: 'expr', expr, unit };
  }
  return referenceInput(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
      if (typeof value === 'number' || typeof value === 'string') {
        return { kind: 'expr', expr: String(value), unit: what.unit };
      }
      // A plain object keeps its own parameter name (the emitter's form).
      if (isPlainExpr(value)) {
        return {
          kind: 'expr',
          expr: value.expr,
          ...(value.paramName !== undefined ? { paramName: value.paramName } : {}),
          unit: what.unit,
        };
      }
      return value;
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
    // A Script's source, given as the text (P5-02).
    case 'code':
      return typeof value === 'string' ? { kind: 'code', value } : value;
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
const STORED_KINDS = new Set([
  'expr',
  'enum',
  'bool',
  'ref',
  'file',
  'labels',
  'sketchData',
  'code',
]);

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

/** A plain expression object (`{ expr, paramName? }`), the emitter's form. */
function isPlainExpr(value: unknown): value is { expr: string; paramName?: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { expr?: unknown }).expr === 'string'
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
